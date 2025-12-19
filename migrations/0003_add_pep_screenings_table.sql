-- Migration number: 0003 	 2025-12-19
-- Create pep_screenings table for audit logging of PEP screening requests

CREATE TABLE IF NOT EXISTS pep_screenings (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL, -- ISO 8601 datetime string
    full_name TEXT NOT NULL,
    birth_date TEXT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    is_pep INTEGER NOT NULL, -- 0 or 1
    confidence REAL NOT NULL, -- 0.0 to 1.0
    needs_disambiguation INTEGER NOT NULL, -- 0 or 1
    result_json TEXT NOT NULL, -- stringified response JSON (excluding raw if too large)
    raw_json TEXT NULL, -- stringified raw provider payload (may be large)
    error TEXT NULL,
    latency_ms INTEGER NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pep_screenings_full_name_birth_date_created_at 
    ON pep_screenings(full_name, birth_date, created_at);
CREATE INDEX IF NOT EXISTS idx_pep_screenings_created_at 
    ON pep_screenings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pep_screenings_is_pep 
    ON pep_screenings(is_pep);
