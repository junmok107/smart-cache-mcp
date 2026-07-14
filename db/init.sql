-- Smart Cache MCP — PostgreSQL schema
-- Ref: proposal section 7 (DB schema)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- cache_entries: cached tool-call results with embeddings for fuzzy matching
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cache_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mcp_endpoint    TEXT,
    tool_name       TEXT NOT NULL,
    arguments_hash  TEXT,                 -- SHA-256 of arguments, used as exact-match fallback
    arguments_raw   JSONB,
    embedding       vector(768),          -- multilingual-e5-base embedding
    result          JSONB,
    result_tokens   INTEGER,
    importance      SMALLINT,             -- 1-5, AI-assigned, drives TTL
    hit_count       INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);

-- HNSW index for cosine-similarity vector search
CREATE INDEX IF NOT EXISTS idx_cache_embedding ON cache_entries
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_cache_tool ON cache_entries (tool_name);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries (expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_hash ON cache_entries (arguments_hash);
CREATE INDEX IF NOT EXISTS idx_cache_priority ON cache_entries (importance, hit_count, last_accessed);

-- ---------------------------------------------------------------------------
-- mcp_registry: registered downstream MCP server aliases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_registry (
    alias       TEXT PRIMARY KEY,
    endpoint    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- cache_logs: per-lookup history used for cache_stats reporting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cache_logs (
    id            BIGSERIAL PRIMARY KEY,
    tool_name     TEXT,
    cache_hit     BOOLEAN,
    similarity    REAL,
    tokens_saved  INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_tool ON cache_logs (tool_name, created_at);
