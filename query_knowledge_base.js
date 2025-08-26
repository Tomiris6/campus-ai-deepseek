// query_knowledge_base.js

const { Pool } = require('pg');
const axios = require('axios');
const { get_encoding } = require("tiktoken");
const encoding = get_encoding("cl100k_base");
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
const SEMANTIC_SIM_THRESHOLD = 0.89;


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


async function breakDownQuery(query) {
    const prompt = `Parse this user query into 3-4 specific sub-questions. Return ONLY a valid JSON array of strings.

Examples:
Input: "What is the school mission and what clubs are available?"
Output: ["What is the school mission?", "What clubs are available?"]

Input: "Who is the principal and what are the admission requirements?"  
Output: ["Who is the principal?", "What are the admission requirements?"]

User Query: "${query}"`;

    const payload = {
        model: 'meta-llama/llama-3.3-8b-instruct:free', // Or another fast, reliable model like 'openai/gpt-3.5-turbo' or 'google/gemma-7b-it'
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0,
        // response_format: { type: "json_object" } // Enforce JSON output where possible
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

        // --- ROBUST JSON PARSING ---
        let jsonArray;
        try {
            // First, try to parse the whole string
            jsonArray = JSON.parse(rawContent);
        } catch {
            // If that fails, search for a JSON array within a markdown code block
            const match = rawContent.match(/\[[\s\S]*?\]/);
            if (match && match[0]) {
                try {
                    jsonArray = JSON.parse(match[0]);
                } catch (e) {
                    console.error('Failed to parse extracted JSON array:', e.message);
                    throw new Error('Could not parse JSON from AI response.');
                }
            } else {
                throw new Error('No valid JSON array found in AI output');
            }
        }

        // The final response might be an object with a key containing the array
        // Example: { "sub_questions": ["q1", "q2"] }
        if (typeof jsonArray === 'object' && !Array.isArray(jsonArray)) {
            const possibleArray = Object.values(jsonArray).find(Array.isArray);
            if (possibleArray) {
                return possibleArray;
            }
        }

        return Array.isArray(jsonArray) ? jsonArray : [query]; // Final fallback

    } catch (error) {
        console.error('Error breaking down query with AI:', error.response?.data || error.message);

        // --- SECONDARY FIX: Simple, rule-based fallback logic ---
        console.warn('AI query breakdown failed. Falling back to simple keyword splitting.');
        const parts = query.split(/\s+(?:and|or|but|,|then|what about)\s+/i).filter(Boolean);

        // Return the split parts if successful, otherwise the original query as a last resort
        return parts.length > 1 ? parts : [query];
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


async function getVectorContext(embedding, limit = 10) {
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
        // MODIFIED: Using a proper tokenizer for accuracy
        const chunkTokens = encoding.encode(chunk).length;

        // A buffer is still a good idea
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


async function queryKnowledgeBase(userQuery, userId = 'anonymous', sessionId = 'no-session') {
    console.log(`\n[2. RAG Pipeline Started]`);
    const key = normalizeQuery(userQuery);
    pruneExpired();

    const queryEmbedding = await getEmbedding(userQuery);

    console.log('\n  → [Cache Check]');

    // This top-level cache check is the ONLY cache check. It looks for a final, previously-generated answer.
    for (const [cacheKey, entry] of cache.entries()) {
        if (entry.embedding) {
            const sim = cosineSimilarity(queryEmbedding, entry.embedding);
            console.log(`    - Similarity vs "${cacheKey}": ${sim.toFixed(4)}`);
            if (sim > SEMANTIC_SIM_THRESHOLD) {
                markUsed(cacheKey);
                console.log(`    ✅ Semantic Cache HIT with similarity ${sim.toFixed(4)}`);
                // If we get a hit, we return the cached FINAL ANSWER and a flag.
                // The 'context' here is actually the final answer from a previous run.
                return { context: entry.value, cacheHit: true };
            }
        }
    }

    console.log('    - ❌ Semantic cache MISS for the main query.');

    // --- Query Breakdown ---
    console.log(`\n  → [AI Query Breakdown]`);
    let questions;
    if (userQuery.length > 60 || /\b(and|or|but|,|then)\b/i.test(userQuery)) {
        questions = await breakDownQuery(userQuery);
    } else {
        questions = [userQuery];
    }
    console.log(`    - Decomposed into ${questions.length} sub-questions:`);
    questions.forEach(q => console.log(`      - "${q}"`));

    // --- Sub-Question Processing ---
    console.log(`\n  → [Sub-Question Processing]`);
    const processingPromises = questions.map(async (q) => {
        const qEmbedding = await getEmbedding(q);
        const chunks = await getVectorContext(qEmbedding, 15);
        console.log(`    - For "${q}": 📂 Vector search retrieved ${chunks.length} chunks.`);

        // --- BUGGY LOGIC COMMENTED OUT AS REQUESTED ---
        // This was the old, incorrect logic that cached raw, irrelevant context.
        // It has been removed from the flow and is only here for reference.
        /*
        const subKey = normalizeQuery(q);
        for (const [cacheKey, entry] of cache.entries()) {
            if (entry.embedding && cosineSimilarity(qEmbedding, entry.embedding) > SEMANTIC_SIM_THRESHOLD) {
                console.log(`    - For "${q}": ✅ Sub-question cache HIT.`);
                markUsed(cacheKey);
                return entry.value.split('\n\n');
            }
        }
        const subContext = chunks.join('\n\n');
        if (subContext.trim()) {
            pruneSize();
            cache.set(subKey, { value: subContext, timestamp: now(), embedding: qEmbedding });
            markUsed(subKey);
        }
        */
        // --- END OF BUGGY LOGIC ---

        return chunks;
    });

    const allChunkSets = await Promise.all(processingPromises);
    const candidateChunks = allChunkSets.flat();
    const uniqueChunks = Array.from(new Set(candidateChunks));

    // --- Context Consolidation ---
    console.log('\n[3. Context Consolidation]');
    const finalContext = selectChunksWithinTokenLimit(uniqueChunks, 12000 - 3000);
    console.log(`- ✅ Assembled ${finalContext.split('\n\n').length} unique chunks for the final prompt.`);
    console.log('- Chunks Sent to LLM (Preview):');
    finalContext.split('\n\n').slice(0, 5).forEach((chunk, i) => {
        const preview = chunk.replace(/\s+/g, ' ').substring(0, 80);
        console.log(`  [Chunk ${i + 1}] ${preview}...`);
    });
    if (finalContext.split('\n\n').length > 5) {
        console.log(`  ... (and ${finalContext.split('\n\n').length - 5} more)`);
    }

    // On a cache miss, we return the assembled CONTEXT, the query embedding, the key, and the cacheHit=false flag.
    return { context: finalContext, embedding: queryEmbedding, key: key, cacheHit: false };
}






module.exports = { queryKnowledgeBase, cache, normalizeQuery, now, pruneSize, markUsed };
