-- Migration 0004: Add source column to distinguish manual vs automated screening queries
-- Created: 2026-02-16
-- Purpose: Enable filtering of automated AML screening queries from manual watchlist UI queries

-- Add source column to search_query table
ALTER TABLE search_query ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

-- Source values:
-- 'manual' - Query typed directly in the watchlist UI (default)
-- 'aml-screening' - Automated screening triggered by aml-svc on client/UBO create/update
