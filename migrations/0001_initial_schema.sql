-- Migration: Initial Watchlist Service Schema
-- Description: Complete watchlist service schema including original WatchlistTarget and new OFAC SDN entries
-- All column names use snake_case for consistency across all services

-- Drop legacy tables if they exist
DROP TABLE IF EXISTS tasks;

-- Drop all existing tables to ensure clean state
DROP TABLE IF EXISTS watchlist_vector_state;
DROP TABLE IF EXISTS watchlist_ingestion_run;
DROP TABLE IF EXISTS watchlist_target;
DROP TABLE IF EXISTS ofac_sdn_entry;

-- ============================================================================
-- Original Watchlist Domain (CSV-based)
-- ============================================================================

-- Watchlist target table (original, used by search/PEP/ingestion flows)
CREATE TABLE watchlist_target (
    id TEXT PRIMARY KEY NOT NULL,
    schema TEXT,
    name TEXT,
    aliases TEXT,                                  -- JSON array
    birth_date TEXT,
    countries TEXT,                                -- JSON array
    addresses TEXT,                                -- JSON array
    identifiers TEXT,                              -- JSON array
    sanctions TEXT,                                -- JSON array
    phones TEXT,                                   -- JSON array
    emails TEXT,                                   -- JSON array
    program_ids TEXT,                              -- JSON array
    dataset TEXT,
    first_seen TEXT,
    last_seen TEXT,
    last_change TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- OFAC SDN Domain (NEW - XML-based)
-- ============================================================================

-- OFAC SDN Entry table - Specially Designated Nationals and Blocked Persons
-- Contains sanctions data from OFAC's SDN Advanced XML file
-- Note: Search is via Vectorize, so no secondary indexes needed (only PK)
CREATE TABLE ofac_sdn_entry (
    id TEXT PRIMARY KEY NOT NULL,              -- FixedRef from DistinctParty
    party_type TEXT NOT NULL,                  -- Individual, Entity, Vessel, Aircraft
    primary_name TEXT NOT NULL,                -- Primary name from Identity
    aliases TEXT,                              -- JSON array of alias names
    birth_date TEXT,                           -- ISO 8601 date string
    birth_place TEXT,                          -- Place of birth text
    addresses TEXT,                            -- JSON array of address strings
    identifiers TEXT,                          -- JSON array of {type, number, country, issueDate, expirationDate}
    remarks TEXT,                              -- Additional comments/remarks
    source_list TEXT NOT NULL,                 -- SDN, Non-SDN, SSI, etc.
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- Ingestion Domain
-- ============================================================================

-- Watchlist ingestion run table (track ingestion runs)
CREATE TABLE watchlist_ingestion_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'csv_url',   -- 'sdn_xml', 'csv_url', etc.
    status TEXT NOT NULL,                          -- 'pending', 'running', 'completed', 'failed'
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    stats TEXT,                                    -- JSON object with counts, errors, etc.
    error_message TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Progress tracking fields (updated during ingestion for polling)
    progress_phase TEXT,                           -- 'idle', 'initializing', 'downloading', 'parsing', 'inserting', 'completed', 'failed'
    progress_records_processed INTEGER,            -- Number of records processed so far
    progress_total_estimate INTEGER,               -- Estimated total records
    progress_percentage INTEGER,                   -- Completion percentage (0-100)
    progress_current_batch INTEGER,                -- Current batch number
    progress_updated_at DATETIME                   -- Last progress update timestamp
);

-- ============================================================================
-- Vector State Domain
-- ============================================================================

-- Watchlist vector state table (track vector indexing sync)
-- Associated with watchlist_target (original flow)
CREATE TABLE watchlist_vector_state (
    target_id TEXT PRIMARY KEY NOT NULL,
    last_indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_indexed_change TEXT,                      -- ISO 8601 datetime string
    vector_id TEXT NOT NULL,                       -- same as target_id
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_id) REFERENCES watchlist_target(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Watchlist target indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_target_schema ON watchlist_target(schema);
CREATE INDEX IF NOT EXISTS idx_watchlist_target_name ON watchlist_target(name);
CREATE INDEX IF NOT EXISTS idx_watchlist_target_dataset ON watchlist_target(dataset);

-- OFAC SDN Entry indexes: None - search is via Vectorize, lookup by PK only

-- Watchlist ingestion run indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_status ON watchlist_ingestion_run(status);
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_started_at ON watchlist_ingestion_run(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_ingestion_run_source_type ON watchlist_ingestion_run(source_type);

-- Watchlist vector state indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_vector_state_last_indexed_at ON watchlist_vector_state(last_indexed_at);
