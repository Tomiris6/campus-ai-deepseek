-- Enable pgvector extension for vector support
CREATE EXTENSION IF NOT EXISTS vector;

-- Table to store scraped web pages
CREATE TABLE IF NOT EXISTS pages (
    url TEXT PRIMARY KEY,
    scraped_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    title TEXT,
    content TEXT,
    h1_tags TEXT,
    h2_tags TEXT,
    h3_tags TEXT,
    meta_description TEXT,
    meta_keywords TEXT
);

-- Knowledge base table storing text chunks and vector embeddings
CREATE TABLE IF NOT EXISTS knowledge_base (
    id SERIAL PRIMARY KEY,
    content_text TEXT,
    source_url TEXT,
    source_table TEXT,
    source_id TEXT,
    embedding VECTOR(1536)
);

-- Index for fast lookup on titles
CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title);

-- Vector index on embeddings for efficient similarity search
CREATE INDEX IF NOT EXISTS idx_kb_embedding_vector ON knowledge_base USING ivfflat(embedding vector_cosine_ops) WITH (lists = 100);
