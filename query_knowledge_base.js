// query_knowledge_base.js

const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();


// ---------- Cache Setup ----------
const cache = new Map();              // key → { value, timestamp, embedding }
const lruQueue = [];                  // Array of keys, most-recent at end
const CACHE_TTL_MS = 5 * 60 * 1000;   // <-- MODIFIED: Hardcoded to 5 minutes
const CACHE_MAX_SIZE = 20;


// ---------- DB & API Setup ----------
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
});


const openrouterBaseUrl = 'https://openrouter.ai/api/v1';
const openrouterApiKey = process.env.API_KEY;
const ollamaBaseUrl = 'http://localhost:11434';


// ---------- Utilities ----------
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
const SEMANTIC_SIM_THRESHOLD = 0.80;


// Retry wrapper for API calls
async function axiosPostWithRetries(url, data, headers, maxRetries = 3, baseDelay = 1000) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await axios.post(url, data, { headers, timeout: 20000 });
        } catch (error) {
            attempt++;
            if (attempt === maxRetries) throw error;
            const delay = baseDelay * 2 ** attempt + Math.random() * 100;
            console.warn(`Request failed (attempt ${attempt}), retrying in ${delay.toFixed(0)} ms...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
}


// Break down complex queries into sub-questions
async function breakDownQuery(query) {
    const prompt = `Parse this user query into 3-4 specific sub-questions. Return ONLY a valid JSON array of strings.


Examples:
Input: "What is the school mission and what clubs are available?"
Output: ["What is the school mission?", "What clubs are available?"]


Input: "Who is the principal and what are the admission requirements?"  
Output: ["Who is the principal?", "What are the admission requirements?"]


User Query: "${query}"`;


    const payload = {
        model: 'meta-llama/llama-3.2-3b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0,
    };


    try {
        const response = await axiosPostWithRetries(
            `${openrouterBaseUrl}/chat/completions`,
            payload,
            {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openrouterApiKey}`
            }
        );


        let rawContent = response.data.choices[0].message.content.trim();
        let jsonArray;
        try {
            jsonArray = JSON.parse(rawContent);
        } catch {
            const match = rawContent.match(/\[[\s\S]*\]/);
            if (match) jsonArray = JSON.parse(match);
            else throw new Error('No valid JSON array found in AI output');
        }


        return Array.isArray(jsonArray) ? jsonArray : [query];
    } catch (error) {
        console.error('Error breaking down query:', error.response?.data || error.message);
        return [query];
    }
}


async function getEmbedding(text) {
    try {
        console.time(`Embedding for "${text.substring(0, 30)}..."`);
        const response = await axios.post(`${ollamaBaseUrl}/api/embeddings`, {
            model: 'bge-large',
            prompt: text,
        }, { timeout: 10000 });
        console.timeEnd(`Embedding for "${text.substring(0, 30)}..."`);
        return response.data.embedding;
    } catch (error) {
        console.error(`Error getting embedding for text:`, error.response?.data || error.message);
        throw error;
    }
}


async function getVectorContext(embedding, limit = 15) {
    try {
        const vectorRows = (await pool.query(
            `SELECT content_text, embedding <-> $1 AS distance
             FROM knowledge_base
             ORDER BY distance
             LIMIT $2;`,
            [JSON.stringify(embedding), limit]
        )).rows;


        const uniqueChunks = Array.from(new Set(vectorRows.map(r => r.content_text)));


        console.log(`\n--- Vector Retrieval ---`);
        console.log(`Vector search returned ${vectorRows.length} chunks:`);


        vectorRows.forEach((r, i) => {
            const preview = r.content_text.substring(0, 100).replace(/\n/g, ' ') + (r.content_text.length > 100 ? '...' : '');
            console.log(`  [V${i + 1}] ${preview}`);
        });


        console.log(`After deduplication, total unique chunks: ${uniqueChunks.length}`);


        return uniqueChunks;
    } catch (error) {
        console.error('Error in vector retrieval:', error.message || error);
        return [];
    }
}


function selectChunksWithinTokenLimit(chunks, maxTokens) {
    const selectedChunks = [];
    let tokenCount = 0;
    for (const chunk of chunks) {
        // Removed the now-deleted countTokens function and its dependency
        // This is a placeholder for a more robust token counting method if needed
        const chunkTokens = chunk.length / 4;
        if (tokenCount + chunkTokens > maxTokens * 0.9) {
            break;
        }
        selectedChunks.push(chunk);
        tokenCount += chunkTokens;
    }
    console.log(`Selected ${selectedChunks.length} chunks with total tokens: ${tokenCount}`);
    return selectedChunks.join('\n\n');
}


function normalizeQuery(query) {
    return query.trim().replace(/^["']|["']$/g, '').toLowerCase();
}


function now() {
    return Date.now();
}


// Remove expired entries before any cache access
function pruneExpired() {
    const cutoff = now() - CACHE_TTL_MS;
    for (const [key, { timestamp }] of cache.entries()) {
        if (timestamp < cutoff) {
            cache.delete(key);
            const idx = lruQueue.indexOf(key);
            if (idx !== -1) lruQueue.splice(idx, 1);
        }
    }
}


// Update LRU order: move key to the end
function markUsed(key) {
    const idx = lruQueue.indexOf(key);
    if (idx !== -1) lruQueue.splice(idx, 1);
    lruQueue.push(key);
}


// Evict oldest if over capacity
function pruneSize() {
    while (lruQueue.length > CACHE_MAX_SIZE) {
        const oldestKey = lruQueue.shift();
        cache.delete(oldestKey);
    }
}


async function queryKnowledgeBase(userQuery) {
    const key = normalizeQuery(userQuery);
    pruneExpired();

    // Step 1: Compute embedding for the main query (for caching final response)
    const queryEmbedding = await getEmbedding(userQuery);

    // Step 2 & 3: Check cache for full query (no changes here)
    for (const [cacheKey, entry] of cache.entries()) {
        if (entry.embedding && cosineSimilarity(queryEmbedding, entry.embedding) > SEMANTIC_SIM_THRESHOLD) {
            markUsed(cacheKey);
            console.log('✅ Semantic cache hit for key:', JSON.stringify(cacheKey));
            return { context: entry.value, embedding: entry.embedding, key: cacheKey };
        }
    }
    if (cache.has(key)) {
        markUsed(key);
        console.log('✅ Cache hit for key:', JSON.stringify(key));
        return { context: cache.get(key).value, embedding: cache.get(key).embedding, key };
    }

    console.log('❌ Cache miss for key:', JSON.stringify(key));
    console.log(`\n=== Starting queryKnowledgeBase for user query: "${userQuery}" ===`);
    const overallStart = Date.now();

    // Step 3: Standard string-match cache lookup (normalized key)
    console.log('\n=== CACHE DEBUGGING START ===');
    console.log('Normalized key:', JSON.stringify(key));
    console.log('Cache size before check:', cache.size);
    console.log('All current cache keys:', Array.from(cache.keys()));
    console.log('=== CACHE DEBUGGING END ===\n');

    // Query breakdown logic (no changes here)
    let questions;
    let usedAISplit = false;
    if (userQuery.length > 60 || /\b(and|or|but|,|then)\b/i.test(userQuery)) {
        questions = await breakDownQuery(userQuery);
        usedAISplit = true;
    } else {
        questions = [userQuery];
    }
    if (!usedAISplit) {
        questions = [userQuery];
    }

    console.log('Generated sub-questions:', questions);

    // --- NEW: Parallel Processing of Sub-Questions ---
    const processingPromises = questions.map(async (q) => {
        const subKey = normalizeQuery(q);
        const qEmbedding = await getEmbedding(q);

        // Check cache for sub-question first
        for (const [cacheKey, entry] of cache.entries()) {
            if (entry.embedding && cosineSimilarity(qEmbedding, entry.embedding) > SEMANTIC_SIM_THRESHOLD) {
                console.log(`✅ Parallel semantic cache hit for sub-question "${q}"`);
                markUsed(cacheKey);
                return entry.value.split('\n\n'); // Return cached chunks
            }
        }

        // If no cache hit, retrieve from DB and then cache it
        try {
            console.log(`\n--- Fetching context for sub-question: "${q}" ---`);
            const chunks = await getVectorContext(qEmbedding, 15);
            const subContext = chunks.join('\n\n');
            if (subContext.trim()) {
                pruneSize();
                cache.set(subKey, { value: subContext, timestamp: now(), embedding: qEmbedding });
                markUsed(subKey);
                console.log('✅ Sub-question context cached for key:', JSON.stringify(subKey));
            }
            return chunks;
        } catch (error) {
            console.error(`Error retrieving chunks for "${q}":`, error.message || error);
            return []; // Return an empty array on error to not break Promise.all
        }
    });

    const allChunkSets = await Promise.all(processingPromises);
    const candidateChunks = allChunkSets.flat();
    // --- END NEW ---

    // Deduplicate and process the final context (no changes here)
    const uniqueChunks = Array.from(new Set(candidateChunks));
    console.log(`\nTotal unique chunks from all sub-questions: ${uniqueChunks.length}`);

    const MAX_CONTEXT_TOKENS = 16000;
    const RESERVED_TOKENS = 3000;
    const finalContext = selectChunksWithinTokenLimit(uniqueChunks, MAX_CONTEXT_TOKENS - RESERVED_TOKENS);

    console.log(`Final chunks sent to LLM: ${finalContext.split('\n\n').length}`);
    console.log(`Total processing time: ${(Date.now() - overallStart) / 1000}s`);

    return { context: finalContext, embedding: queryEmbedding, key };
}



module.exports = { queryKnowledgeBase, cache, normalizeQuery, now, pruneSize, markUsed };
