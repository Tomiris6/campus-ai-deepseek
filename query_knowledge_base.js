const { Pool } = require('pg');
const axios = require('axios');
const { encoding_for_model } = require('@dqbd/tiktoken');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
});

const openrouterBaseUrl = 'https://openrouter.ai/api/v1';
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const ollamaBaseUrl = 'http://localhost:11434';

const tokenizer = encoding_for_model('gpt-3.5-turbo');

function countTokens(text) {
    if (!text) return 0;
    return tokenizer.encode(text).length;
}

async function breakDownQuery(query) {
    const prompt = `
You are a highly-skilled query parser and refiner. The user will provide a query. Your task is to break down the query into a list of specific, answerable questions to be used for a retrieval-augmented generation (RAG) system.

- If the user's query is already simple and specific, strictly use the user's asked question and provide one slightly modified version that captures the same intent.
- If the user's query is complex or has multiple topics, break it down into exactly 3 specific sub-questions.

The output must be a valid JSON array of strings, with each string being a specific question. Do not include any extra text before or after the JSON array.

Example Input (Complex):
"What is the mission of the school and what extracurricular activities are available for students?"
JSON Output: ["What is the mission of the school?", "What extracurricular activities are available for students?", "Can you tell me about the school's mission and available clubs?"]

Example Input (Simple):
"What is the school's main phone number?"
JSON Output: ["What is the school's main phone number?", "Can you provide the primary contact number for the school?"]

Now, generate the JSON array for this query:
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
        const response = await axios.post(`${openrouterBaseUrl}/chat/completions`, payload, {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${openrouterApiKey}`,
            },
            timeout: 10000,
        });
        console.timeEnd('Multi-Query Generation');

        const rawContent = response.data.choices[0].message.content.trim();
        const jsonArray = JSON.parse(rawContent);

        console.log('\n--- Multi-Query Generation ---');
        console.log(`Original User Query: "${query}"`);
        console.log(`Generated Query Variations (${jsonArray.length} total queries for search):`);
        jsonArray.forEach((q, i) => console.log(`  ${i + 1}. "${q}"`));

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

async function fullTextSearch(query, limit = 5) {
    const sql = `
    SELECT content_text
    FROM knowledge_base
    WHERE content_text_tsv @@ plainto_tsquery('english', $1)
    LIMIT $2;
  `;
    try {
        const { rows } = await pool.query(sql, [query, limit]);
        return rows.map(row => row.content_text);
    } catch (error) {
        console.error('Error performing full-text search:', error.message);
        return [];
    }
}

async function getHybridContext(query, embedding, limit = 5) {
    try {
        const vectorRows = (await pool.query(
            `SELECT content_text, embedding <-> $1 AS distance
       FROM knowledge_base
       ORDER BY distance
       LIMIT $2;`,
            [JSON.stringify(embedding), limit]
        )).rows;

        const fullTextRows = await fullTextSearch(query, limit);

        console.log(`\n--- Hybrid Retrieval for query: "${query}" ---`);
        console.log(`Vector search returned ${vectorRows.length} chunks:`);
        vectorRows.forEach((r, i) => {
            const preview = r.content_text.substring(0, 100).replace(/\n/g, ' ') + (r.content_text.length > 100 ? '...' : '');
            console.log(`  [V${i + 1}] ${preview}`);
        });
        console.log(`Full-text keyword search returned ${fullTextRows.length} chunks:`);
        fullTextRows.forEach((text, i) => {
            const preview = text.substring(0, 100).replace(/\n/g, ' ') + (text.length > 100 ? '...' : '');
            console.log(`  [K${i + 1}] ${preview}`);
        });

        const allChunks = [...vectorRows.map(r => r.content_text), ...fullTextRows];
        const uniqueChunks = Array.from(new Set(allChunks));

        console.log(`After deduplication, total unique chunks: ${uniqueChunks.length}`);

        return uniqueChunks;
    } catch (error) {
        console.error('Error in hybrid retrieval:', error.message || error);
        return [];
    }
}

function selectChunksWithinTokenLimit(chunks, maxTokens) {
    const selectedChunks = [];
    let tokenCount = 0;
    for (const chunk of chunks) {
        const chunkTokens = countTokens(chunk);
        if (tokenCount + chunkTokens > maxTokens) {
            break;
        }
        selectedChunks.push(chunk);
        tokenCount += chunkTokens;
    }
    console.log(`Selected ${selectedChunks.length} chunks with total tokens: ${tokenCount}`);
    return selectedChunks.join('\n\n');
}

async function queryKnowledgeBase(userQuery) {
    console.log(`\n=== Starting queryKnowledgeBase for user query: "${userQuery}" ===`);
    const overallStart = Date.now();

    let questions = await breakDownQuery(userQuery);
    console.log(`Total sub-questions generated: ${questions.length}`);

    if (!questions.includes(userQuery)) questions.unshift(userQuery);

    let candidateChunks = [];
    for (const q of questions) {
        try {
            console.log(`\n--- Processing sub-question: "${q}" ---`);
            const startEmbedding = Date.now();
            const embedding = await getEmbedding(q);
            console.log(`Embedding generated in ${(Date.now() - startEmbedding) / 1000}s`);

            const startRetrieve = Date.now();
            const chunks = await getHybridContext(q, embedding, 10);
            console.log(`Retrieved ${chunks.length} chunks in ${(Date.now() - startRetrieve) / 1000}s`);

            candidateChunks.push(...chunks);
        } catch (error) {
            console.error(`Error retrieving chunks for "${q}":`, error.message || error);
        }
    }

    candidateChunks = Array.from(new Set(candidateChunks));
    console.log(`Total unique chunks from all sub-questions: ${candidateChunks.length}`);

    const MAX_CONTEXT_TOKENS = 16000;
    const RESERVED_TOKENS = 2000;
    const availableTokens = MAX_CONTEXT_TOKENS - RESERVED_TOKENS;

    const chunkSelectionStart = Date.now();
    const finalContext = selectChunksWithinTokenLimit(candidateChunks, availableTokens);
    console.log(`Chunk selection took ${(Date.now() - chunkSelectionStart) / 1000}s`);

    console.log(`Final chunks sent to LLM: ${finalContext ? finalContext.split('\n\n').length : 0}`);
    console.log(`Total processing time: ${(Date.now() - overallStart) / 1000}s`);

    return finalContext;
}

module.exports = { queryKnowledgeBase, countTokens };
