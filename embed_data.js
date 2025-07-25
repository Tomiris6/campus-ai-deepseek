// embed_data.js - FINAL VERSION WITH EXACT COLUMN NAMES FROM school_data.sql

// Load environment variables from .env file
require('dotenv').config();

const { Pool } = require('pg');
const fetch = require('node-fetch'); // Ensure node-fetch is installed (npm install node-fetch@2)

// Database configuration using environment variables
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Test database connection
pool.on('connect', (client) => {
    console.log('Database connected successfully for embedding script at:', new Date());
});

pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
});

// Function to generate embedding for a given text using Ollama
async function generateEmbedding(text) {
    try {
        const response = await fetch('http://localhost:11434/api/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'bge-large', // Ensure this model is pulled in Ollama
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
        console.error(`Error generating embedding for text: "${text.substring(0, 50)}..."`, error.message);
        return null;
    }
}

// Generic function to process and embed data from a table
async function processTable(client, tableName, queryColumns, documentTextFormatter) {
    console.log(`\nFetching data from ${tableName} table to populate knowledge_base...`);
    // Ensure 'id' and all specified queryColumns are selected
    const selectColumns = ['id', ...queryColumns].join(', ');
    const res = await client.query(`SELECT ${selectColumns} FROM ${tableName}`);
    console.log(`Found ${res.rows.length} rows to process from ${tableName}.`);

    for (const row of res.rows) {
        const documentText = documentTextFormatter(row);
        // console.log(`Generating embedding for ${tableName} ID ${row.id}: "${documentText.substring(0, 50)}..."`); // Uncomment for verbose logging

        const embedding = await generateEmbedding(documentText);

        if (embedding) {
            // console.log(`Successfully generated embedding for ${tableName} ID ${row.id}.`); // Uncomment for verbose logging
            const insertQuery = `
                INSERT INTO knowledge_base (content_text, embedding, source_table, source_id)
                VALUES ($1, $2::vector, $3, $4)
                ON CONFLICT (source_table, source_id) DO UPDATE
                SET content_text = EXCLUDED.content_text,
                    embedding = EXCLUDED.embedding;
            `; // ON CONFLICT ensures idempotency (updates if row already exists based on source_table, source_id)
            await client.query(insertQuery, [documentText, JSON.stringify(embedding), tableName, row.id]);
            // console.log(`Saved entry for ${tableName} ID ${row.id} to knowledge_base.`); // Uncomment for verbose logging
        } else {
            console.warn(`Could not generate embedding for ${tableName} ID ${row.id}. Skipping.`);
        }
    }
}

// Main function to fetch data and generate and SAVE embeddings to knowledge_base
async function processDataAndGenerateEmbeddings() {
    let client;
    try {
        client = await pool.connect();
        console.log('Starting data embedding process...');

        // 1. Process school_info table
        // Columns: category, question, answer, keywords
        await processTable(client, 'school_info', ['category', 'question', 'answer', 'keywords'], (row) =>
            `Category: ${row.category}\nQuestion: ${row.question}\nAnswer: ${row.answer}\nKeywords: ${row.keywords ? row.keywords.join(', ') : 'N/A'}`
        );

        // 2. Process school_hours table
        // Columns: day_of_week, opening_time, closing_time, notes
        await processTable(client, 'school_hours', ['day_of_week', 'opening_time', 'closing_time', 'notes'], (row) =>
            `School Hours - Day: ${row.day_of_week}\nOpening Time: ${row.opening_time}\nClosing Time: ${row.closing_time}\nNotes: ${row.notes || 'N/A'}`
        );

        // 3. Process facilities table
        // Columns: name, description, location, availability, keywords
        await processTable(client, 'facilities', ['name', 'description', 'location', 'availability', 'keywords'], (row) =>
            `Facility Name: ${row.name}\nDescription: ${row.description}\nLocation: ${row.location || 'N/A'}\nAvailability: ${row.availability || 'N/A'}\nKeywords: ${row.keywords ? row.keywords.join(', ') : 'N/A'}`
        );

        // 4. Process faqs table
        // Columns: question, answer, category, keywords, popularity
        await processTable(client, 'faqs', ['question', 'answer', 'category', 'keywords', 'popularity'], (row) =>
            `FAQ - Category: ${row.category}\nQuestion: ${row.question}\nAnswer: ${row.answer}\nKeywords: ${row.keywords ? row.keywords.join(', ') : 'N/A'}`
        );

        console.log('\nFinished processing all data and saving embeddings to knowledge_base.');

    } catch (error) {
        console.error('Error in processDataAndGenerateEmbeddings:', error.stack);
    } finally {
        if (client) {
            client.release();
        }
        await pool.end(); // Always end the pool connection
    }
}

// Execute the main function
processDataAndGenerateEmbeddings();