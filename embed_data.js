// embed_data.js

require('dotenv').config();

const { Pool } = require('pg');
const fetch = require('node-fetch');

// Database configuration
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
});

pool.on('connect', () => {
    console.log('Database connected successfully for embedding script.');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(1);
});

// Ollama embedding config
const OLLAMA_EMBEDDING_MODEL = 'bge-large';
const OLLAMA_API_URL = 'http://localhost:11434';

async function generateEmbedding(text) {
    const payload = {
        model: OLLAMA_EMBEDDING_MODEL,
        prompt: text,
    };

    const maxRetries = 3;
    const retryDelay = 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(`${OLLAMA_API_URL}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                timeout: 15000,
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Ollama API error: ${response.status} ${response.statusText}. Response body: ${errorBody}`);
            }

            const data = await response.json();
            if (!data.embedding) {
                throw new Error('No embedding returned in response');
            }
            return data.embedding;
        } catch (err) {
            console.warn(`Attempt ${attempt} failed to generate embedding: ${err.message}`);
            if (attempt === maxRetries) {
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

async function processPages() {
    let client;
    try {
        client = await pool.connect();

        console.log('Starting embedding process for pages...');

        const res = await client.query('SELECT url, title, h1_tags, h2_tags, h3_tags, content FROM pages');
        if (res.rows.length === 0) {
            console.log('No pages found. Exiting.');
            return;
        }

        console.log(`Found ${res.rows.length} pages to process.`);

        await client.query('TRUNCATE TABLE knowledge_base RESTART IDENTITY');
        console.log('Cleared knowledge_base table.');

        for (const page of res.rows) {
            const contentParts = [
                `Title: ${page.title || 'N/A'}.`,
                `H1 Tags: ${page.h1_tags || 'N/A'}.`,
                `H2 Tags: ${page.h2_tags || 'N/A'}.`,
                `H3 Tags: ${page.h3_tags || 'N/A'}.`,
                `Content: ${page.content || 'N/A'}.`
            ];
            const contentText = contentParts.join('\n');

            try {
                const embedding = await generateEmbedding(contentText);

                await client.query(
                    `INSERT INTO knowledge_base (content_text, source_url, source_table, source_id, embedding)
            VALUES ($1, $2, $3, $4, $5)`,
                    [contentText, page.url, 'pages', 'N/A', JSON.stringify(embedding)]
                );

                console.log(`Embedded and saved: ${page.url}`);
            } catch (embedError) {
                console.error(`Failed to embed page ${page.url}: ${embedError.message}`);
            }
        }

        console.log('Finished embedding all pages.');
    } catch (err) {
        console.error('Unexpected error during embedding process:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

// Run the processing function when the script is executed
processPages().catch(e => {
    console.error('Fatal error in embedding script:', e);
    process.exit(1);
});
