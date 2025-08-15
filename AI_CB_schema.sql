-- Enable the pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the 'pages' table with a dedicated ID as the primary key
CREATE TABLE IF NOT EXISTS pages (
    id               SERIAL PRIMARY KEY,
    url              TEXT NOT NULL UNIQUE, -- URL must be unique but is not the primary key
    scraped_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    title            TEXT,
    content          TEXT,
    h1_tags          TEXT,
    h2_tags          TEXT,
    h3_tags          TEXT,
    meta_description TEXT,
    meta_keywords    TEXT,
    page_depth       INTEGER DEFAULT 0,
    retry_count      INTEGER DEFAULT 0,
    status           TEXT DEFAULT 'success'
);

-- Create the 'knowledge_base' table for storing text chunks and their embeddings
CREATE TABLE IF NOT EXISTS knowledge_base (
    id           SERIAL PRIMARY KEY,
    content_text TEXT,
    source_url   TEXT,
    source_table TEXT,
    source_id    TEXT,
    embedding    VECTOR(1536), -- Assuming an embedding dimension of 1536
    created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster querying on the 'pages' table
CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title);
CREATE INDEX IF NOT EXISTS idx_pages_content ON pages USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_pages_h2_tags ON pages USING gin(to_tsvector('english', h2_tags));
CREATE INDEX IF NOT EXISTS idx_pages_depth ON pages(page_depth);
CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_scraped_at ON pages(scraped_at);

-- Create an IVFFlat index on the 'embedding' column for fast vector similarity search
CREATE INDEX IF NOT EXISTS idx_kb_embedding_vector
    ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
