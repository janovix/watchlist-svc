-- Add environment column to search_query for per-environment data isolation.
-- Existing data defaults to 'production'.
ALTER TABLE search_query ADD COLUMN environment TEXT NOT NULL DEFAULT 'production';
CREATE INDEX idx_search_query_org_env ON search_query(organization_id, environment);
