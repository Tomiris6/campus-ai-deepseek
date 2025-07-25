// query_knowledge_base.js

require('dotenv').config();

const { Pool } = require('pg');
const fetch = require('node-fetch');

// Database configuration
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.on('connect', (client) => {
    console.log('Database connected successfully for query script.');
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Function to generate embedding for a given text using Ollama (same as before)
async function generateEmbedding(text) {
    try {
        const response = await fetch('http://localhost:11434/api/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'bge-large', // Ensure this matches the model used for embedding your data
                prompt: text,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const data = await response.json();
        return data.embedding;
    } catch (error) {
        console.error(`Error generating embedding for query: "${text.substring(0, 50)}..."`, error.message);
        return null;
    }
}

// Function to query the knowledge base
async function queryKnowledgeBase(queryText, topK = 3) {
    let client;
    try {
        client = await pool.connect();
        console.log(`Generating embedding for query: "${queryText}"`);
        const queryEmbedding = await generateEmbedding(queryText);

        if (!queryEmbedding) {
            console.error('Failed to generate embedding for the query.');
            return [];
        }

        console.log(`Searching knowledge base for top ${topK} similar entries...`);

        // Perform similarity search using the L2 distance operator (<=>)
        // Order by distance and limit to topK results
        const res = await client.query(
            `SELECT 
                id, 
                content_text, 
                source_table, 
                source_id, 
                embedding <=> $1::vector AS distance
             FROM 
                knowledge_base
             ORDER BY 
                distance
             LIMIT $2;`,
            [JSON.stringify(queryEmbedding), topK] // Ensure the query embedding is also stringified JSON
        );

        console.log(`Found ${res.rows.length} relevant entries.`);
        return res.rows;

    } catch (error) {
        console.error('Error querying knowledge base:', error.stack);
        return [];
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
    }
}

// Example usage:
const userQuery = "What extracurricular activities are available?"; // You can change this query
queryKnowledgeBase(userQuery, 3)
    .then(results => {
        if (results.length > 0) {
            console.log("\n--- Relevant Information Found ---");
            results.forEach((row, index) => {
                console.log(`\nResult ${index + 1} (Distance: ${row.distance.toFixed(4)}):`);
                console.log(`Source: ${row.source_table} (ID: ${row.source_id})`);
                console.log(`Content: ${row.content_text}`);
            });
            console.log("----------------------------------");
        } else {
            console.log("No relevant information found.");
        }
    })
    .catch(error => {
        console.error("Script execution error:", error);
    });