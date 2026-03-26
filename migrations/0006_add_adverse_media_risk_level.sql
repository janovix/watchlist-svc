-- Migration 0006: Add adverse_media_risk_level for list view badge coloring (low/medium/high)

ALTER TABLE search_query ADD COLUMN adverse_media_risk_level TEXT;
