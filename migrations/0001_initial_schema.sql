-- Migration: Initial Watchlist Service Schema
-- Description: Complete watchlist service schema for watchlist targets, ingestion runs, and vector state
-- All column names use snake_case for consistency across all services

-- Drop legacy tables if they exist
DROP TABLE IF EXISTS tasks;

-- Drop all existing tables to ensure clean state
DROP TABLE IF EXISTS watchlist_vector_state;
DROP TABLE IF EXISTS watchlist_ingestion_run;
DROP TABLE IF EXISTS watchlist_target;

-- ============================================================================
-- Watchlist Domain
-- ============================================================================

-- Watchlist targets table (one row per CSV id)
CREATE TABLE watchlist_target (
    id TEXT PRIMARY KEY NOT NULL,
    schema TEXT,
    name TEXT,
    aliases TEXT,
    birth_date TEXT,
    countries TEXT,
    addresses TEXT,
    identifiers TEXT,
    sanctions TEXT,
    phones TEXT,
    emails TEXT,
    program_ids TEXT,
    dataset TEXT,
    first_seen TEXT,
    last_seen TEXT,
    last_change TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Watchlist ingestion run table (track ingestion runs)
CREATE TABLE watchlist_ingestion_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    stats TEXT,
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Watchlist vector state table (track vector indexing sync)
CREATE TABLE watchlist_vector_state (
    target_id TEXT PRIMARY KEY NOT NULL,
    last_indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_indexed_change TEXT,
    vector_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_id) REFERENCES watchlist_target(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Watchlist target indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_target_schema ON watchlist_target(schema);
CREATE INDEX IF NOT EXISTS idx_watchlist_target_dataset ON watchlist_target(dataset);
CREATE INDEX IF NOT EXISTS idx_watchlist_target_last_change ON watchlist_target(last_change);

-- Watchlist ingestion run indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_status ON watchlist_ingestion_run(status);
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_started_at ON watchlist_ingestion_run(started_at DESC);

-- Watchlist vector state indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_vector_state_last_indexed_at ON watchlist_vector_state(last_indexed_at);
