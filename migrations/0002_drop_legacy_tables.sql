-- Migration: Drop legacy watchlist_target and watchlist_vector_state tables
-- Date: 2026-02-13
-- Description: Remove CSV-based watchlist tables as they are no longer used.
--              OFAC, UNSC, and SAT 69-B now have their own dedicated tables.

-- Drop legacy tables
DROP TABLE IF EXISTS watchlist_vector_state;
DROP TABLE IF EXISTS watchlist_target;
