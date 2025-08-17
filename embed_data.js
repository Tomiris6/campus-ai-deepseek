// embed_data.js

require('dotenv').config();

const { Pool } = require('pg');
const fetch = require('node-fetch');
const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { default: pLimit } = require('p-limit'); // --- NEW: Import the p-limit library ---

// ---------- Config ----------
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'bge-large';
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const VERBOSE = String(process.env.VERBOSE || 'true').toLowerCase() === 'true';
const MAX_ERROR_BODY_PREVIEW = 300;

// ---------- DB ----------
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
});

pool.on('connect', () => {
    logHeader('Database connected successfully for embedding script.');
});

pool.on('error', (err) => {
    logError('Unexpected error on idle client', err);
    process.exit(1);
});

// ---------- Utils ----------
function divider(label) {
    const line = '─'.repeat(40);
    return label ? `${line} ${label} ${line}` : `${line}${line}`;
}

function preview(text, len = 80) {
    if (!text) return 'N/A';
    const s = String(text).replace(/\s+/g, ' ').trim();
    return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

function logHeader(msg) {
    console.log('\n' + divider(msg));
}

function logInfo(...args) {
    console.log('ℹ️ ', ...args);
}

function logSuccess(...args) {
    console.log('✅', ...args);
}

function logWarn(...args) {
    console.warn('⚠️ ', ...args);
}

function logError(msg, err) {
    console.error('❌', msg, err ? `\n   → ${err.stack || err}` : '');
}

function hrtimeMs(start) {
    const diff = process.hrtime(start);
    return Math.round((diff[0] * 1e9 + diff[1]) / 1e6);
}

// ---------- Embeddings ----------
async function generateEmbedding(text) {
    const payload = { model: OLLAMA_EMBEDDING_MODEL, prompt: text };
    const maxRetries = 3;
    const retryDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const tStart = process.hrtime();
        try {
            const response = await fetch(`${OLLAMA_API_URL}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                timeout: 20000,
            });

            const ms = hrtimeMs(tStart);

            if (!response.ok) {
                const errorBody = await response.text();
                const previewBody = preview(errorBody, MAX_ERROR_BODY_PREVIEW);
                throw new Error(`Ollama API error: ${response.status} ${response.statusText} (${ms} ms). Body: ${previewBody}`);
            }

            const data = await response.json();
            if (!data || !data.embedding) {
                throw new Error(`No embedding returned in response (${ms} ms)`);
            }

            if (VERBOSE) logSuccess(`Embedding generated in ${ms} ms (dim: ${data.embedding.length || 'unknown'})`);
            return data.embedding;
        } catch (err) {
            logWarn(`Attempt ${attempt}/${maxRetries} failed to generate embedding: ${err.message}`);
            if (attempt === maxRetries) throw err;
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
    }
}

// ---------- Main ----------
async function processPages() {
    let client;
    const totals = { pages: 0, embedded: 0, failed: 0, skipped: 0, totalChunkProcessingMs: 0 };
    const tGlobal = process.hrtime();

    // --- NEW: Create a limiter that allows 4 concurrent requests ---
    const limit = pLimit(4);

    try {
        client = await pool.connect();
        logHeader('Starting embedding process for pages');
        const tFetch = process.hrtime();
        const res = await client.query('SELECT id, url, title, h1_tags, h2_tags, h3_tags, content FROM pages');
        const fetchMs = hrtimeMs(tFetch);
        totals.pages = res.rows.length;

        if (totals.pages === 0) {
            logWarn(`No pages found (query took ${fetchMs} ms). Exiting.`);
            return;
        }

        logInfo(`Found ${totals.pages} pages (fetched in ${fetchMs} ms).`);
        const tTruncate = process.hrtime();
        await client.query('TRUNCATE TABLE knowledge_base RESTART IDENTITY');
        logInfo(`Cleared knowledge_base table in ${hrtimeMs(tTruncate)} ms.`);

        for (let i = 0; i < res.rows.length; i++) {
            const page = res.rows[i];
            const idx = i + 1;
            const tPageStart = process.hrtime();

            const contentParts = [
                `Title: ${page.title || 'N/A'}.`,
                `H1 Tags: ${page.h1_tags || 'N/A'}.`,
                `H2 Tags: ${page.h2_tags || 'N/A'}.`,
                `H3 Tags: ${page.h3_tags || 'N/A'}.`,
                `Content: ${page.content || 'N/A'}.`
            ];
            const contentText = contentParts.join('\n');

            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1500,
                chunkOverlap: 300,
            });

            const chunks = await splitter.splitText(contentText);
            logHeader(`Processing Page ${idx}/${totals.pages}`);
            logInfo(`URL: ${page.url || 'N/A'}`);
            logInfo(`Title: ${preview(page.title, 100)}`);
            logInfo(`Chars: ${contentText.length}, Chunks: ${chunks.length}`);

            if (chunks.length === 0) {
                totals.skipped++;
                logWarn('Skipping page as it resulted in no chunks.');
                continue;
            }

            try {
                const validChunks = chunks.filter(chunk => chunk.length >= 5 && /\w/.test(chunk));
                logInfo(`Creating ${validChunks.length} embedding tasks...`);
                const tEmbed = process.hrtime();

                // --- MODIFIED: Use the limiter to control concurrency ---
                // Create an array of promise-returning functions
                const embeddingTasks = validChunks.map(chunk => {
                    return limit(() => generateEmbedding(chunk));
                });

                // Execute all tasks with the concurrency limit
                const embeddings = await Promise.all(embeddingTasks);
                logSuccess(`All ${embeddings.length} embeddings generated in ${hrtimeMs(tEmbed)} ms.`);

                const tInsert = process.hrtime();
                for (let j = 0; j < validChunks.length; j++) {
                    const chunk = validChunks[j];
                    const embedding = embeddings[j];
                    if (embedding) { // Only insert if embedding was successful
                        await client.query(
                            `INSERT INTO knowledge_base (content_text, source_url, source_table, source_id, embedding)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [chunk, page.url, 'pages', page.id, JSON.stringify(embedding)]
                        );
                        totals.embedded++;
                    } else {
                        totals.failed++;
                    }
                }
                logSuccess(`Inserted ${totals.embedded} chunks into DB in ${hrtimeMs(tInsert)} ms.`);
            } catch (parallelError) {
                totals.failed += chunks.length;
                logError(`An error occurred during embedding for page ${page.url}`, parallelError);
            }

            const pageElapsedMs = hrtimeMs(tPageStart);
            totals.totalChunkProcessingMs += pageElapsedMs;
            logSuccess(`Finished processing page in ${pageElapsedMs} ms.`);
        }

        logHeader('Finished embedding all pages');
        const totalElapsedMs = hrtimeMs(tGlobal);
        const avgTimePerPage = totals.pages > 0 ? (totals.totalChunkProcessingMs / totals.pages) : 0;
        const report = {
            'Total Pages': totals.pages,
            'Chunks Embedded': totals.embedded,
            'Chunks Failed/Skipped': `${totals.failed}/${totals.skipped}`,
            'Total Runtime (ms)': totalElapsedMs,
            'Avg. Time Per Page (ms)': avgTimePerPage.toFixed(2)
        };
        console.log(divider('Summary'));
        console.table(report);
    } catch (err) {
        logError('Unexpected error during embedding process:', err);
    } finally {
        if (client) client.release();
        await pool.end();
        logInfo('Database pool closed.');
    }
}

// Run
processPages().catch(e => {
    logError('Fatal error in embedding script:', e);
    process.exit(1);
});
