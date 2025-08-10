// query_knowledge_base.js

const { Pool } = require('pg');
const axios = require('axios');
const { encoding_for_model } = require('@dqbd/tiktoken');
const cache = new Map();  // Simple in-memory cache
require('dotenv').config();

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

const tokenizer = encoding_for_model('gpt-3.5-turbo');

function countTokens(text) {
    if (!text) return 0;
    return tokenizer.encode(text).length;
}

async function axiosPostWithRetries(url, data, headers, maxRetries = 3, baseDelay = 1000) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const response = await axios.post(url, data, { headers, timeout: 20000 });  // Increased timeout
            return response;
        } catch (error) {
            attempt++;
            if (attempt === maxRetries) {
                throw error;  // Stop retrying after max attempts
            }
            const delay = baseDelay * 2 ** attempt + Math.random() * 100;  // Exponential backoff with jitter
            console.warn(`Request failed (attempt ${attempt}), retrying after ${delay.toFixed(0)} ms...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

async function breakDownQuery(query) {
    const prompt = `You are an expert query parser and refiner for a retrieval-augmented generation (RAG) system. Break down the user query into 3-4 specific, clear, answerable questions.
- Ignore minor spelling or grammatical errors and focus on the meaning and intent.
- Provide examples with numbered JSON arrays exactly matching the format.
- Make each sub-question distinct, focused, and answerable independently.
- Avoid vague or speculative sub-questions.

**VERY IMPORTANT INSTRUCTION** 
    - Format output very strictly as a **JSON** array of strings with no -->**extra text** <--.

Examples:
1. "What is the mission of the school and what extracurricular activities are available?"
JSON Output: ["What is the mission of the school?", "What extracurricular activities are available?"]

2. "Who is the current principal and what extracurricular clubs exist?"
JSON Output: ["Who is the current principal?", "What extracurricular clubs exist?"]

Now, generate the **----->JSON<-----** array for this user query:
User Query: "${query}"
JSON Output:`;

    const payload = {
        model: 'deepseek/deepseek-chat-v3-0324:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0,
        stream: false,
    };

    try {
        console.time('Multi-Query Generation');
        const response = await axiosPostWithRetries(
            `${openrouterBaseUrl}/chat/completions`,
            payload,
            {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openrouterApiKey}`
            }
        );
        console.timeEnd('Multi-Query Generation');

        let rawContent = response.data.choices[0].message.content.trim();

        let jsonArray;
        try {
            // First attempt: strict parse
            jsonArray = JSON.parse(rawContent);
        } catch {
            // Second attempt: extract [...] part only
            const match = rawContent.match(/\[[\s\S]*\]/);
            if (match) {
                jsonArray = JSON.parse(match[0]);
            } else {
                throw new Error('No valid JSON array found in AI output');
            }
        }

        console.log('\n--- Multi-Query Generation ---');
        console.log(`Original User Query: "${query}"`);
        console.log(`Generated Query Variations (${jsonArray.length} total queries for search):`);
        jsonArray.forEach((q, i) => console.log(` ${i + 1}. "${q}"`));

        return Array.isArray(jsonArray) ? jsonArray : [query];

    } catch (error) {
        console.error('Error breaking down query:', error.response?.data || error.message);
        return [query]; // fallback to original query
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


async function getVectorContext(embedding, limit = 20) {
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
        const chunkTokens = countTokens(chunk);
        // Pick chunk only if a comfortable margin exists to avoid going too close to limit
        if (tokenCount + chunkTokens > maxTokens * 0.9) {
            break;
        }
        selectedChunks.push(chunk);
        tokenCount += chunkTokens;
    }
    console.log(`Selected ${selectedChunks.length} chunks with total tokens: ${tokenCount}`);
    return selectedChunks.join('\n\n');
}

async function queryKnowledgeBase(userQuery) {
    // Check if cached
    if (cache.has(userQuery)) {
        console.log('Cache hit for query:', userQuery);
        return cache.get(userQuery);
    }

    console.log('Cache miss, processing query:', userQuery);
    console.log(`\n=== Starting queryKnowledgeBase for user query: "${userQuery}" ===`);
    const overallStart = Date.now();

    let questions;
    let usedAISplit = false;

    try {
        if (userQuery.length > 60 || /\b(and|or|but|,|then)\b/i.test(userQuery)) {
            console.log('Complex query detected: Using AI for splitting the question.');
            questions = await breakDownQuery(userQuery);
            usedAISplit = true;
        } else {
            console.log('Simple query detected: Skipping AI question splitting.');
            questions = [userQuery];
        }
    } catch (e) {
        console.log('Error during AI breakdown, processing as single query.');
        questions = [userQuery];
    }

    console.log(`Total sub-questions generated: ${questions.length}`);

    // If AI split is NOT used, include the original query
    if (!usedAISplit && !questions.includes(userQuery)) {
        questions.unshift(userQuery);
    }

    let candidateChunks = [];

    for (const q of questions) {
        try {
            console.log(`\n--- Processing sub-question: "${q}" ---`);
            const startEmbedding = Date.now();
            const embedding = await getEmbedding(q);
            console.log(`Embedding generated in ${(Date.now() - startEmbedding) / 1000}s`);

            const startRetrieve = Date.now();
            const chunks = await getVectorContext(embedding, 20);
            console.log(`Retrieved ${chunks.length} chunks in ${(Date.now() - startRetrieve) / 1000}s`);

            candidateChunks.push(...chunks);
        } catch (error) {
            console.error(`Error retrieving chunks for "${q}":`, error.message || error);
        }
    }

    candidateChunks = Array.from(new Set(candidateChunks));
    console.log(`Total unique chunks from all sub-questions: ${candidateChunks.length}`);

    const MAX_CONTEXT_TOKENS = 8000;
    const RESERVED_TOKENS = 3000;
    const availableTokens = MAX_CONTEXT_TOKENS - RESERVED_TOKENS;

    const chunkSelectionStart = Date.now();
    const finalContext = selectChunksWithinTokenLimit(candidateChunks, availableTokens);
    console.log(`Chunk selection took ${(Date.now() - chunkSelectionStart) / 1000}s`);
    console.log(`Final chunks sent to LLM: ${finalContext ? finalContext.split('\n\n').length : 0}`);
    console.log(`Total processing time: ${(Date.now() - overallStart) / 1000}s`);

    cache.set(userQuery, finalContext);
    return finalContext;
}


module.exports = { queryKnowledgeBase, countTokens };