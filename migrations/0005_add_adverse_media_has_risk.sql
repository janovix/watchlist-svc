-- Migration 0005: Add adverse_media_has_risk to search_query for list view indicators
-- SQLite: 0 = false, 1 = true

ALTER TABLE search_query ADD COLUMN adverse_media_has_risk INTEGER NOT NULL DEFAULT 0;
