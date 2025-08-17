-- =============================================================================
-- Campus AI Chatbot - Full Database Schema
--
-- Instructions:
-- 1. Connect to your PostgreSQL database.
-- 2. Copy the entire content of this file.
-- 3. Paste it into your SQL client (like psql, DBeaver, or pgAdmin) and run it.
--
-- This script is safe to run multiple times. It will only create tables
-- and indexes if they do not already exist.
-- =============================================================================


-- Step 1: Enable the 'pgvector' extension
-- This adds the special capabilities needed to search for text based on meaning.
CREATE EXTENSION IF NOT EXISTS vector;


-- -----------------------------------------------------------------------------
-- Table 1: `pages`
-- Stores the full content of each webpage scraped from the school's website.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pages (
    id SERIAL PRIMARY KEY,              -- A unique number for each page record.
    url TEXT NOT NULL UNIQUE,           -- The URL of the scraped page (must be unique).
    scraped_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, -- When the page was scraped.
    title TEXT,                         -- The title of the webpage.
    content TEXT,                       -- The main text content of the page.
    h1_tags TEXT,                       -- All H1 headings found on the page.
    h2_tags TEXT,                       -- All H2 headings.
    h3_tags TEXT,                       -- All H3 headings.
    meta_description TEXT,              -- The page's meta description for SEO.
    meta_keywords TEXT,                 -- The page's meta keywords.
    page_depth INTEGER DEFAULT 0,       -- How many clicks away from the start page (0 is the homepage).
    retry_count INTEGER DEFAULT 0,      -- How many times the scraper had to retry this page.
    status TEXT DEFAULT 'success'       -- The final status of the scrape ('success', 'failed').
);


-- -----------------------------------------------------------------------------
-- Table 2: `knowledge_base`
-- Stores small, searchable chunks of text and their vector embeddings (AI-readable format).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_base (
    id SERIAL PRIMARY KEY,              -- A unique number for each text chunk.
    content_text TEXT,                  -- The small piece of text.
    source_url TEXT,                    -- The original URL this text came from.
    source_table TEXT,                  -- The table this text came from (always 'pages').
    source_id TEXT,                     -- The ID of the row in the source table.
    embedding VECTOR(1536),             -- The special vector representation of the text.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP -- When this chunk was created.
);


-- -----------------------------------------------------------------------------
-- Table 3: `chat_history` (NEW TABLE)
-- Logs every interaction with the chatbot for debugging and analysis.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,              -- A unique number for each chat message log.
    user_id TEXT NOT NULL,              -- The unique ID for the user's browser.
    session_id TEXT NOT NULL,           -- The unique ID for the user's current session/visit.
    user_message TEXT,                  -- The exact message the user sent.
    assistant_response TEXT,            -- The exact response the chatbot gave.
    retrieved_context TEXT,             -- The relevant info the AI found in the knowledge_base.
    final_prompt TEXT,                  -- The full prompt sent to the AI model.
    latency_ms INTEGER,                 -- How long the request took in milliseconds.
    status TEXT DEFAULT 'success',      -- The status of the request ('success' or 'error').
    error_message TEXT,                 -- If an error occurred, the details are stored here.
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP -- When this interaction happened.
);


-- =============================================================================
-- Step 2: Create Indexes
-- These act like a book's index, making database lookups much faster.
-- =============================================================================

-- Indexes for the 'pages' table
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_scraped_at ON pages(scraped_at);

-- Index for the 'knowledge_base' table for fast semantic search
CREATE INDEX IF NOT EXISTS idx_kb_embedding_vector
ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Indexes for the new 'chat_history' table
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_status ON chat_history(status);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at);

-- =============================================================================
-- End of Script
-- =============================================================================
