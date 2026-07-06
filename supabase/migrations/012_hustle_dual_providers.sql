-- Migration 012: correct Hustle's MySkillsFuture provider aliases.
-- Hustle Singapore has TWO provider entities on MySkillsFuture:
--   1. HUSTLE ACADEMY                (TP_ALIAS_Suggest=HUSTLE%20ACADEMY)
--   2. HUSTLE INSTITUTE PTE. LTD.    (TP_ALIAS_Suggest=HUSTLE%20INSTITUTE%20PTE.%20LTD.)
-- The previously seeded alias 'HUSTLE ACADEMY PTE. LTD.' does not match the
-- real TP_ALIAS and returned no courses — deactivate it and add the correct one.

-- Deactivate the incorrect alias (kept for reference, not deleted)
UPDATE competitor_data_sources
SET is_active = false,
    notes = COALESCE(notes || ' · ', '') || 'Deactivated 2026-07: incorrect TP_ALIAS — replaced by HUSTLE ACADEMY',
    updated_at = NOW()
WHERE source_type = 'myskillsfuture'
  AND identifier = 'HUSTLE ACADEMY PTE. LTD.';

-- Add the correct Hustle Academy alias
INSERT INTO competitor_data_sources (competitor_id, source_type, identifier, is_primary, is_active, notes)
SELECT c.id, 'myskillsfuture', 'HUSTLE ACADEMY', false, true,
       'Second Hustle provider entity on MySkillsFuture — displayed separately as "Hustle Academy"'
FROM competitors c
WHERE c.is_hustle = true AND c.archived_at IS NULL
ORDER BY c.created_at
LIMIT 1
ON CONFLICT (competitor_id, source_type, identifier) DO UPDATE
  SET is_active = true, updated_at = NOW();

-- Friendly display names for provider entities (used when one competitor
-- has multiple MySkillsFuture entities and rows must be shown separately)
ALTER TABLE competitor_data_sources
  ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE competitor_data_sources SET display_name = 'Hustle Academy'
WHERE source_type = 'myskillsfuture' AND identifier = 'HUSTLE ACADEMY';

UPDATE competitor_data_sources SET display_name = 'Hustle Institute'
WHERE source_type = 'myskillsfuture' AND identifier = 'HUSTLE INSTITUTE PTE. LTD.';
