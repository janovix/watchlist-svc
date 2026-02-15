-- Migration 0003: Add search_query table for persistent query audit trail
-- Created: 2026-02-13
-- Purpose: Store all search queries with aggregated results from multiple search types

CREATE TABLE IF NOT EXISTS search_query (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'person',
  birth_date TEXT,
  countries TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- OFAC Sanctions results (synchronous)
  ofac_status TEXT NOT NULL DEFAULT 'pending',
  ofac_result TEXT,
  ofac_count INTEGER NOT NULL DEFAULT 0,

  -- SAT 69B Sanctions results (synchronous)
  sat69b_status TEXT NOT NULL DEFAULT 'pending',
  sat69b_result TEXT,
  sat69b_count INTEGER NOT NULL DEFAULT 0,

  -- UN Sanctions results (synchronous)
  un_status TEXT NOT NULL DEFAULT 'pending',
  un_result TEXT,
  un_count INTEGER NOT NULL DEFAULT 0,
  
  -- PEP Official results (async via pep_search container)
  pep_official_status TEXT NOT NULL DEFAULT 'pending',
  pep_official_result TEXT,
  pep_official_count INTEGER NOT NULL DEFAULT 0,
  
  -- PEP AI results (async via pep_grok container, person only)
  pep_ai_status TEXT NOT NULL DEFAULT 'skipped',
  pep_ai_result TEXT,
  
  -- Adverse Media results (async via adverse_media_grok container)
  adverse_media_status TEXT NOT NULL DEFAULT 'pending',
  adverse_media_result TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_search_query_org_created ON search_query(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_query_org_status ON search_query(organization_id, status);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_search_query_updated_at
AFTER UPDATE ON search_query
FOR EACH ROW
BEGIN
  UPDATE search_query SET updated_at = datetime('now') WHERE id = NEW.id;
END;

