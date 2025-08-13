// query_knowledge_base_local.js - Updated to work with OpenAI embeddings

/*
SONNENT AI CAMPUS GUIDE SYSTEM PROMPT:

You are Sonnent, a highly capable, friendly, and knowledgeable AI campus guide for [School Name]. 
Your job is to help users navigate and understand all aspects of the school's website, using information 
retrieved from a knowledge base built by web-scraping and embedding the entire site.

**Your Capabilities:**
- You have access to a large, up-to-date knowledge base containing all website content, processed into vector embeddings for semantic search.
- For every user question, you receive the most relevant information chunks, retrieved by comparing the user's query embedding with the stored website embeddings.
- You can answer complex, multi-part, or follow-up questions by synthesizing information from multiple retrieved chunks.
- You can clarify, break down, and answer ambiguous or compound queries step by step.

**APIs and Functionality Used:**
- **OpenAI Embedding API**: Used to generate vector embeddings for both website content and user queries, enabling accurate semantic search and retrieval.
- **DeepSeek or Azure OpenAI LLM API**: Used to generate natural, conversational responses based on the retrieved context and user queries.
- **Azure Speech SDK (optional)**: Used for speech-to-text and text-to-speech features, allowing spoken interaction with users.

**How to Respond:**
- Always use the provided "Relevant Information from Knowledge Base" first.
- If the answer is not found, use the "Basic School Information" provided.
- Never speculate or invent information. If you don't know, say:  
  "I apologize, but I don't have enough information to answer that question. Please contact [School Name] directly for more details. Let me know if you have any other questions."
- Speak in a warm, conversational, and engaging tone, as if you are a real person guiding a guest.
- Use clear, concise, and naturally spoken language suitable for students, parents, and staff.
- Do not reference written text, visuals, or formatting. Instead, describe feelings or expressions if needed (e.g., "smiling warmly").
- Avoid jargon or overly formal language.
- Provide contact details only if present in the retrieved context.

**Context Provided:**
- "Relevant Information from Knowledge Base": This is the most relevant content from the website, retrieved using semantic search.
- "Basic School Information": General facts about the school.

**If the user asks a very broad or multi-part question:**
- Break it down into manageable parts and answer each clearly.
- If needed, ask clarifying questions to better assist the user.

**Example Workflow:**
1. Receive user query and relevant context.
2. Use the context to answer as fully as possible.
3. If the answer is not found, use basic info.
4. If still not found, politely decline and suggest contacting the school.

---
Basic School Information:  
[Insert school info here]

---
Relevant Information from Knowledge Base:  
[Insert retrieved context here]
*/

const { Pool } = require('pg');
const axios = require('axios');
const { encoding_for_model } = require('@dqbd/tiktoken');
const OpenAI = require('openai');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10),
});

// Initialize Azure OpenAI client for embeddings (works in Hong Kong)
const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
    defaultQuery: { 'api-version': '2024-02-15-preview' },
    defaultHeaders: {
        'api-key': process.env.AZURE_OPENAI_API_KEY,
    },
});

const openrouterBaseUrl = 'https://openrouter.ai/api/v1';
const openrouterApiKey = process.env.OPENROUTER_API_KEY;

const tokenizer = encoding_for_model('gpt-3.5-turbo');

function countTokens(text) {
    if (!text) return 0;
    return tokenizer.encode(text).length;
}

// Azure OpenAI Embedding Function (disabled due to deployment issues)
async function getOpenAIEmbedding(text) {
    try {
        // Azure OpenAI embedding temporarily disabled - using local fallback
        console.log('Using local embedding (Azure OpenAI disabled)...');
        return textToVector(text);
    } catch (error) {
        console.error('Error getting Azure OpenAI embedding:', error.message);
        // Fallback to local embedding if Azure OpenAI fails
        console.log('Falling back to local embedding...');
        return textToVector(text);
    }
}

// Local embedding functions (same as embed_data_local.js)
function textToVector(text, vectorSize = 384) {
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2);
    
    // Add synonyms for important concepts
    const synonymMap = {
        'admission': ['enroll', 'application', 'apply', 'entrance', 'join'],
        'requirement': ['criteria', 'condition', 'prerequisite'],
        'process': ['procedure', 'step', 'method'],
        'student': ['pupil', 'learner', 'candidate']
    };
    
    const expandedWords = [...words];
    words.forEach(word => {
        if (synonymMap[word]) {
            expandedWords.push(...synonymMap[word]);
        }
    });
    
    const vector = new Array(vectorSize).fill(0);
    
    // Simple hash-based embedding with enhanced weights for important terms
    expandedWords.forEach(word => {
        const hash1 = simpleHash(word) % vectorSize;
        const hash2 = (simpleHash(word + 'salt') % vectorSize + vectorSize) % vectorSize;
        const hash3 = (simpleHash('prefix' + word) % vectorSize + vectorSize) % vectorSize;
        
        // Give higher weights to admission-related terms
        const weight = ['admission', 'enroll', 'application', 'requirement', 'process'].includes(word) ? 2.0 : 1.0;
        
        vector[hash1] += 1 * weight;
        vector[hash2] += 0.5 * weight;
        vector[hash3] += 0.3 * weight;
    });
    
    // Normalize vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
        for (let i = 0; i < vector.length; i++) {
            vector[i] = vector[i] / magnitude;
        }
    }
    
    return vector;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

// Calculate cosine similarity
function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function breakDownQuery(query) {
    // Use local query processing to avoid API calls and rate limits
    console.log('Using local query breakdown to avoid API rate limits');
    
    const queryLower = query.toLowerCase().trim();
    
    // Check if it's a complex query that needs breakdown
    const hasConjunctions = queryLower.includes(' and ') || queryLower.includes(' or ');
    const hasCommas = queryLower.includes(',');
    const isLongQuery = queryLower.split(' ').length > 10;
    const hasMultipleQuestions = (queryLower.match(/\?/g) || []).length > 1;
    
    if (!hasConjunctions && !hasCommas && !isLongQuery && !hasMultipleQuestions) {
        // Simple query - just return the original
        return [query];
    }
    
    // For complex queries, try to split intelligently
    const subQueries = [];
    
    if (hasMultipleQuestions) {
        // Split on question marks
        const parts = query.split('?').filter(part => part.trim());
        parts.forEach(part => {
            const trimmed = part.trim();
            if (trimmed) {
                subQueries.push(trimmed + (trimmed.endsWith('?') ? '' : '?'));
            }
        });
    } else if (hasConjunctions) {
        // Split on 'and' or 'or'
        const parts = query.split(/\s+(and|or)\s+/i);
        for (let i = 0; i < parts.length; i += 2) {
            const part = parts[i];
            if (part && part.trim()) {
                subQueries.push(part.trim());
            }
        }
    } else if (hasCommas) {
        // Split on commas
        const parts = query.split(',');
        parts.forEach(part => {
            const trimmed = part.trim();
            if (trimmed) subQueries.push(trimmed);
        });
    } else {
        // Long query - just use the original
        subQueries.push(query);
    }
    
    // Limit to max 3 sub-queries to avoid too many searches
    const finalQueries = subQueries.slice(0, 3);
    
    // If we only got one result, add the original query as a backup
    if (finalQueries.length === 1 && finalQueries[0] !== query) {
        finalQueries.push(query);
    }
    
    return finalQueries.length > 0 ? finalQueries : [query];
}

async function fullTextSearch(query, limit = 5) {
    // Extract key terms from query for better search
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    const searchTerms = [...queryWords];
    
    // Add synonyms for admission-related queries
    if (query.toLowerCase().includes('admission') || query.toLowerCase().includes('apply')) {
        searchTerms.push('admission', 'enroll', 'application', 'discretionary', 'places', 'f.1', 'form');
    }
    
    const sql = `
    SELECT content_text, source_url
    FROM knowledge_base
    WHERE ${searchTerms.map((_, i) => `content_text ILIKE $${i + 1}`).join(' OR ')}
    ORDER BY (
        CASE 
            WHEN content_text ILIKE '%admission%' THEN 10
            WHEN content_text ILIKE '%enroll%' THEN 8
            WHEN content_text ILIKE '%application%' THEN 8
            WHEN content_text ILIKE '%discretionary%' THEN 7
            ELSE 1
        END
    ) DESC
    LIMIT $${searchTerms.length + 1};
  `;
    
    try {
        const params = searchTerms.map(term => `%${term}%`).concat([limit]);
        const { rows } = await pool.query(sql, params);
        return rows.map(row => row.content_text);
    } catch (error) {
        console.error('Error performing full-text search:', error.message);
        return [];
    }
}

async function getHybridContext(query, embedding, limit = 5) {
    try {
        // Get all embeddings from database
        const allRows = await pool.query(`SELECT content_text, embedding FROM knowledge_base WHERE embedding IS NOT NULL`);
        
        // Calculate similarities
        const similarities = allRows.rows.map(row => {
            const storedEmbedding = row.embedding; // Already an array from REAL[]
            const similarity = cosineSimilarity(embedding, storedEmbedding);
            return {
                content_text: row.content_text,
                similarity: similarity
            };
        });
        
        // Sort by similarity and take top results
        const vectorRows = similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

        const fullTextRows = await fullTextSearch(query, limit);

        console.log(`\n--- Hybrid Retrieval for query: "${query}" ---`);
        console.log(`Vector search returned ${vectorRows.length} chunks:`);
        vectorRows.forEach((r, i) => {
            const preview = r.content_text.substring(0, 100).replace(/\n/g, ' ') + (r.content_text.length > 100 ? '...' : '');
            console.log(`  [V${i + 1}] (${r.similarity.toFixed(3)}) ${preview}`);
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
        if (tokenCount + chunkTokens <= maxTokens) {
            selectedChunks.push(chunk);
            tokenCount += chunkTokens;
        } else {
            break;
        }
    }
    return selectedChunks;
}

async function queryKnowledgeBase(query) {
    console.log(`\n=== Starting queryKnowledgeBase for user query: "${query}" ===`);
    console.time('Multi-Query Generation');

    const subQuestions = await breakDownQuery(query);
    console.timeEnd('Multi-Query Generation');

    console.log('\n--- Multi-Query Generation ---');
    console.log(`Original User Query: "${query}"`);
    console.log(`Generated Query Variations (${subQuestions.length} total queries for search):`);
    subQuestions.forEach((q, i) => console.log(`  ${i + 1}. "${q}"`));
    console.log(`Total sub-questions generated: ${subQuestions.length}`);

    const allUniqueChunks = new Set();

    for (const subQuestion of subQuestions) {
        console.log(`\n--- Processing sub-question: "${subQuestion}" ---`);
        try {
            // Generate Azure OpenAI embedding for query (with local fallback)
            const embedding = await getOpenAIEmbedding(subQuestion);
            
            // Get context using hybrid search
            const chunks = await getHybridContext(subQuestion, embedding, 3);
            chunks.forEach(chunk => allUniqueChunks.add(chunk));
        } catch (error) {
            console.error(`Error retrieving chunks for "${subQuestion}":`, error.message);
        }
    }

    const uniqueChunksArray = Array.from(allUniqueChunks);
    console.log(`Total unique chunks from all sub-questions: ${uniqueChunksArray.length}`);

    console.time('Chunk selection');
    const selectedChunks = selectChunksWithinTokenLimit(uniqueChunksArray, 4000);
    const totalTokens = selectedChunks.reduce((sum, chunk) => sum + countTokens(chunk), 0);
    console.log(`Selected ${selectedChunks.length} chunks with total tokens: ${totalTokens}`);
    console.timeEnd('Chunk selection');

    console.log(`Final chunks sent to LLM: ${selectedChunks.length}`);
    console.log(`=== Query processing completed ===`);
    return selectedChunks.join('\n\n');
}

module.exports = { queryKnowledgeBase, countTokens };
