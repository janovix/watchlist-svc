-- Migration number: 0002 	 2025-01-XX
-- Remove the old tasks table from the template/demo app
DROP TABLE IF EXISTS tasks;

-- Create watchlist_target table (one row per CSV id)
CREATE TABLE IF NOT EXISTS watchlist_target (
    id TEXT PRIMARY KEY NOT NULL,
    schema TEXT,
    name TEXT,
    aliases TEXT, -- JSON array of strings
    birth_date TEXT,
    countries TEXT, -- JSON array of strings
    addresses TEXT, -- JSON array of strings
    identifiers TEXT, -- JSON array of strings
    sanctions TEXT, -- JSON array of strings
    phones TEXT, -- JSON array of strings
    emails TEXT, -- JSON array of strings
    program_ids TEXT, -- JSON array of strings
    dataset TEXT,
    first_seen TEXT, -- ISO 8601 datetime string
    last_seen TEXT, -- ISO 8601 datetime string
    last_change TEXT, -- ISO 8601 datetime string
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create watchlist_ingestion_run table (track ingestion runs)
CREATE TABLE IF NOT EXISTS watchlist_ingestion_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL, -- 'running', 'completed', 'failed'
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    stats TEXT, -- JSON object with counts, errors, etc.
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create watchlist_vector_state table (track vector indexing sync)
CREATE TABLE IF NOT EXISTS watchlist_vector_state (
    target_id TEXT PRIMARY KEY NOT NULL,
    last_indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_indexed_change TEXT, -- ISO 8601 datetime string from last_change
    vector_id TEXT NOT NULL, -- same as target_id
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_id) REFERENCES watchlist_target(id) ON DELETE CASCADE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_watchlist_target_schema ON watchlist_target(schema);
CREATE INDEX IF NOT EXISTS idx_watchlist_target_dataset ON watchlist_target(dataset);
CREATE INDEX IF NOT EXISTS idx_watchlist_target_last_change ON watchlist_target(last_change);
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_status ON watchlist_ingestion_run(status);
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_started_at ON watchlist_ingestion_run(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_vector_state_last_indexed_at ON watchlist_vector_state(last_indexed_at);
