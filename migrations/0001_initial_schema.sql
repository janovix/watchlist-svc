-- Migration: Initial Watchlist Service Schema
-- Description: Complete watchlist service schema including original WatchlistTarget and new OFAC SDN entries
-- All column names use snake_case for consistency across all services

-- Drop legacy tables if they exist
DROP TABLE IF EXISTS tasks;

-- Drop all existing tables to ensure clean state
DROP TABLE IF EXISTS watchlist_identifier;
DROP TABLE IF EXISTS watchlist_vector_state;
DROP TABLE IF EXISTS watchlist_ingestion_run;
DROP TABLE IF EXISTS watchlist_target;
DROP TABLE IF EXISTS ofac_sdn_entry;
DROP TABLE IF EXISTS sat_69b_entry;

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
    progress_updated_at DATETIME,                  -- Last progress update timestamp
    -- Vectorization thread tracking
    vectorize_thread_id TEXT                       -- ID del thread de vectorización (si aplica)
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

-- ============================================================================
-- Watchlist Identifier Domain (NEW - for hybrid search)
-- ============================================================================

-- Watchlist identifier table - Stores normalized identifiers for exact matching
-- Used for hybrid search to match documents like passports, RFCs, NITs, etc.
CREATE TABLE watchlist_identifier (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    dataset TEXT NOT NULL,                  -- e.g., "ofac_sdn", "csv_target"
    record_id TEXT NOT NULL,                -- FK to ofac_sdn_entry.id or watchlist_target.id
    identifier_type TEXT,                   -- e.g., "PASSPORT", "RFC", "NIT"
    identifier_raw TEXT NOT NULL,           -- Original identifier value
    identifier_norm TEXT NOT NULL,          -- Normalized (uppercase, stripped) for exact lookup
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Watchlist identifier indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_identifier_norm ON watchlist_identifier(identifier_norm);
CREATE INDEX IF NOT EXISTS idx_watchlist_identifier_dataset_record ON watchlist_identifier(dataset, record_id);

-- ============================================================================
-- SAT 69-B Domain (NEW - CSV-based)
-- ============================================================================

-- SAT 69-B Entry table - Listado completo de contribuyentes Art. 69-B del CFF
-- Contains data from Mexican tax authority (SAT) about taxpayers with presumably non-existent operations
-- Note: Search is via Vectorize, so no secondary indexes needed (only PK)
CREATE TABLE sat_69b_entry (
    id TEXT PRIMARY KEY NOT NULL,              -- RFC (used as unique identifier)
    row_number INTEGER,                         -- Original row number from CSV
    rfc TEXT NOT NULL,                          -- RFC del contribuyente (tax ID)
    taxpayer_name TEXT NOT NULL,               -- Nombre del Contribuyente
    taxpayer_status TEXT NOT NULL,             -- Situacion: Presunto, Desvirtuado, Definitivo, Sentencia Favorable
    -- Presumption phase (Phase 1)
    presumption_sat_notice TEXT,               -- Numero y fecha de oficio global de presuncion SAT
    presumption_sat_date TEXT,                 -- Publicacion pagina SAT presuntos
    presumption_dof_notice TEXT,               -- Numero y fecha de oficio global de presuncion DOF
    presumption_dof_date TEXT,                 -- Publicacion DOF presuntos
    -- Rebuttal phase (Phase 2)
    rebuttal_sat_notice TEXT,                  -- Numero y fecha de oficio global de contribuyentes que desvirtuaron SAT
    rebuttal_sat_date TEXT,                    -- Publicacion pagina SAT desvirtuados
    rebuttal_dof_notice TEXT,                  -- Numero y fecha de oficio global de contribuyentes que desvirtuaron DOF
    rebuttal_dof_date TEXT,                    -- Publicacion DOF desvirtuados
    -- Definitive phase (Phase 3)
    definitive_sat_notice TEXT,                -- Numero y fecha de oficio global de definitivos SAT
    definitive_sat_date TEXT,                  -- Publicacion pagina SAT definitivos
    definitive_dof_notice TEXT,                -- Numero y fecha de oficio global de definitivos DOF
    definitive_dof_date TEXT,                  -- Publicacion DOF definitivos
    -- Favorable sentence phase (Phase 4)
    favorable_sat_notice TEXT,                 -- Numero y fecha de oficio global de sentencia favorable SAT
    favorable_sat_date TEXT,                   -- Publicacion pagina SAT sentencia favorable
    favorable_dof_notice TEXT,                 -- Numero y fecha de oficio global de sentencia favorable DOF
    favorable_dof_date TEXT,                   -- Publicacion DOF sentencia favorable
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SAT 69-B Entry indexes: None - search is via Vectorize, lookup by PK and RFC only
CREATE INDEX IF NOT EXISTS idx_sat_69b_entry_rfc ON sat_69b_entry(rfc);
