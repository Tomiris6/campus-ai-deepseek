-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Updated pages table
CREATE TABLE IF NOT EXISTS pages (
    url            TEXT PRIMARY KEY,
    scraped_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    title          TEXT,
    content        TEXT,
    h1_tags        TEXT,
    h2_tags        TEXT,
    h3_tags        TEXT,
    meta_description TEXT,
    meta_keywords  TEXT,
    page_depth     INTEGER  DEFAULT 0,
    retry_count    INTEGER  DEFAULT 0,
    status         TEXT     DEFAULT 'success'
);

-- Knowledge-base table (unchanged except created_at)
CREATE TABLE IF NOT EXISTS knowledge_base (
    id           SERIAL PRIMARY KEY,
    content_text TEXT,
    source_url   TEXT,
    source_table TEXT,
    source_id    TEXT,
    embedding    VECTOR(1536),
    created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pages_title       ON pages(title);
CREATE INDEX IF NOT EXISTS idx_pages_content     ON pages USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_pages_h2_tags     ON pages USING gin(to_tsvector('english', h2_tags));
CREATE INDEX IF NOT EXISTS idx_pages_depth       ON pages(page_depth);
CREATE INDEX IF NOT EXISTS idx_pages_status      ON pages(status);
CREATE INDEX IF NOT EXISTS idx_pages_scraped_at  ON pages(scraped_at);

CREATE INDEX IF NOT EXISTS idx_kb_embedding_vector
    ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
