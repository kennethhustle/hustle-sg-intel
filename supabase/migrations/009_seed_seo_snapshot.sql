-- Migration 009: seed data for the SEO snapshot tables created in migration 008
-- (seo_keywords, seo_rankings, seo_snapshot_meta).
--
-- Source: hardcoded VERIFIED_KEYWORDS / CATEGORIES / THREATS previously embedded
-- in src/app/search-intelligence/page.tsx. All rankings verified via live
-- Google Search (gl=sg, pws=0, hl=en) on 22 Jun 2026 by the Hustle SG team.
--
-- NOTE: migration 008 already created seo_keywords / seo_rankings /
-- seo_snapshot_meta with columns: seo_rankings(checked_at, source, verified_by,
-- notes, url, page_title) — NOT the simplified shape sketched in the task
-- description. This migration seeds the REAL schema from 008 and only adds
-- `CREATE TABLE IF NOT EXISTS` as a safety net in case 008 has not been
-- applied to a given environment.

CREATE TABLE IF NOT EXISTS seo_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword TEXT UNIQUE NOT NULL,
  category TEXT,
  intent TEXT,
  notes TEXT,
  source_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_rankings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword_id UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  competitor_name TEXT,
  position INTEGER,
  is_ad BOOLEAN DEFAULT false,
  url TEXT,
  page_title TEXT,
  checked_at TIMESTAMPTZ NOT NULL,
  source TEXT CHECK (source IN ('manual','api')) DEFAULT 'manual',
  verified_by TEXT,
  notes TEXT,
  UNIQUE(keyword_id, competitor_id, competitor_name, checked_at)
);

CREATE TABLE IF NOT EXISTS seo_snapshot_meta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  verified_at DATE NOT NULL,
  verified_by TEXT,
  method TEXT DEFAULT 'Manual Google Search (gl=sg, pws=0, hl=en)',
  next_review_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_rankings_keyword ON seo_rankings(keyword_id, checked_at DESC);

-- ─── seo_keywords ───────────────────────────────────────────────────────────
INSERT INTO seo_keywords (keyword, category, source_url, notes) VALUES
  ('ai course singapore', 'AI & GenAI',
   'https://www.google.com/search?q=ai+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'Top 4 organic spots taken by SMU Academy, SkillsFuture, AI Singapore, NUS-ISS. Info-Tech first tracked competitor at ~#5. Hustle absent.'),
  ('generative ai course singapore', 'AI & GenAI',
   'https://www.google.com/search?q=generative+ai+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'SMU Academy #1, SkillsFuture #2. Vertical is strongest tracked competitor at #3 overall. Info-Tech buying ads.'),
  ('chatgpt course singapore', 'AI & GenAI',
   'https://www.google.com/search?q=chatgpt+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'Info-Tech owns this keyword outright at #1. Vertical #6, BELLS #7. No Hustle presence.'),
  ('digital marketing course singapore', 'Digital Marketing',
   'https://www.google.com/search?q=digital+marketing+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'SMU Academy #1. Equinet #2 organic — stronger than ASK here. Heicoders running ads. ASK around #8. Hustle absent.'),
  ('seo course singapore', 'SEO',
   'https://www.google.com/search?q=seo+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'ASK Training ranks #1 overall (beats Equinet). Equinet #3. OOm #8. Also: OOm, Equinet, Vertical all appear in Google Maps local pack.'),
  ('google ads course singapore', 'Digital Marketing',
   'https://www.google.com/search?q=google+ads+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'ASK Training #1, Equinet #3. No other tracked competitors present. Hustle absent.'),
  ('content creation course singapore', 'Content & Creative',
   'https://www.google.com/search?q=content+creation+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'Equinet #1, ASK #2. Republic Polytechnic #3, SMU #4. Hustle SG completely absent despite running this type of course.'),
  ('python course singapore', 'Data & Tech',
   'https://www.google.com/search?q=python+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'NTUC #1, SkillsFuture #2, SMU #3. Heicoders first tracked competitor around #5 (also in Maps local pack). Hustle absent.'),
  ('data analytics course singapore', 'Data & Tech',
   'https://www.google.com/search?q=data+analytics+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'Top 8 entirely: NUS, SMU, NTUC, Aventis, NTU, PSB, Le Wagon, LSBF. None of the 10 tracked competitors appear. Vertical and Heicoders only mentioned in Reddit discussions.'),
  ('photography course singapore', 'Photography',
   'https://www.google.com/search?q=photography+course+singapore&gl=sg&hl=en&num=10&pws=0',
   'School of Photography SG #1, NAFA #3, LASALLE #4, Nikon School #6. Hustle SG does NOT appear in top 10. OOm appears with a blog list article only.'),
  ('ai for business singapore', 'AI & GenAI',
   'https://www.google.com/search?q=ai+for+business+singapore+course&gl=sg&hl=en&num=10&pws=0',
   'NTUC, SMU, SUSS, NUS dominate. Vertical appears around #8. Info-Tech buying ads. Hustle completely absent despite this being their stated positioning.')
ON CONFLICT (keyword) DO NOTHING;

-- ─── seo_snapshot_meta ──────────────────────────────────────────────────────
INSERT INTO seo_snapshot_meta (verified_at, verified_by, method, next_review_at, notes)
SELECT '2026-06-22', 'Hustle SG team', 'Manual Google Search (gl=sg, pws=0, hl=en)', '2026-07-22',
       'Initial manual SEO snapshot migrated from hardcoded search-intelligence page constants (migration 009).'
WHERE NOT EXISTS (SELECT 1 FROM seo_snapshot_meta WHERE verified_at = '2026-06-22');

-- ─── seo_rankings ───────────────────────────────────────────────────────────
-- competitor_id resolved via subselect on competitors.name where the ranking
-- competitor is one of the 10 tracked providers; otherwise NULL + competitor_name
-- text only (e.g. universities / government providers are out of scope for
-- competitor_id but still recorded as organic occupants of the SERP is skipped —
-- we only seed TRACKED competitor + ad rows here, matching the page's `results` arrays).

-- ai course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'InfoTech Academy'), 'InfoTech Academy', 5, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'Heicoders Academy'), 'Heicoders Academy', 8, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'InfoTech Academy'), 'InfoTech Academy', NULL, true, '2026-06-22T00:00:01Z', 'manual', 'Hustle SG team', 'Paid ad placement')
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- generative ai course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'generative ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'Vertical Institute'), 'Vertical Institute', 3, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'generative ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'InfoTech Academy'), 'InfoTech Academy', 4, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'generative ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'Heicoders Academy'), 'Heicoders Academy', 6, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'generative ai course singapore'),
   (SELECT id FROM competitors WHERE name = 'InfoTech Academy'), 'InfoTech Academy', NULL, true, '2026-06-22T00:00:01Z', 'manual', 'Hustle SG team', 'Paid ad placement')
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- chatgpt course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'chatgpt course singapore'),
   (SELECT id FROM competitors WHERE name = 'InfoTech Academy'), 'InfoTech Academy', 1, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'chatgpt course singapore'),
   (SELECT id FROM competitors WHERE name = 'Vertical Institute'), 'Vertical Institute', 6, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'chatgpt course singapore'),
   (SELECT id FROM competitors WHERE name = 'BELLS Institute'), 'BELLS Institute', 7, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL)
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- digital marketing course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'digital marketing course singapore'),
   (SELECT id FROM competitors WHERE name = 'Equinet Academy'), 'Equinet Academy', 2, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'digital marketing course singapore'),
   (SELECT id FROM competitors WHERE name = 'Heicoders Academy'), 'Heicoders Academy', NULL, true, '2026-06-22T00:00:01Z', 'manual', 'Hustle SG team', 'Paid ad placement'),
  ((SELECT id FROM seo_keywords WHERE keyword = 'digital marketing course singapore'),
   (SELECT id FROM competitors WHERE name = 'ASK Training'), 'ASK Training', 8, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL)
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- seo course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'seo course singapore'),
   (SELECT id FROM competitors WHERE name = 'ASK Training'), 'ASK Training', 1, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'seo course singapore'),
   (SELECT id FROM competitors WHERE name = 'Equinet Academy'), 'Equinet Academy', 3, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'seo course singapore'),
   (SELECT id FROM competitors WHERE name = 'OOm Pte Ltd'), 'OOm Pte Ltd', 8, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL)
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- google ads course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'google ads course singapore'),
   (SELECT id FROM competitors WHERE name = 'ASK Training'), 'ASK Training', 1, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'google ads course singapore'),
   (SELECT id FROM competitors WHERE name = 'Equinet Academy'), 'Equinet Academy', 3, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL)
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- content creation course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'content creation course singapore'),
   (SELECT id FROM competitors WHERE name = 'Equinet Academy'), 'Equinet Academy', 1, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'content creation course singapore'),
   (SELECT id FROM competitors WHERE name = 'ASK Training'), 'ASK Training', 2, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL)
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- python course singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'python course singapore'),
   (SELECT id FROM competitors WHERE name = 'Heicoders Academy'), 'Heicoders Academy', 5, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL)
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;

-- data analytics course singapore — zero tracked-competitor rankings (uncontested by tracked set)
-- (no rows: results = [] in source data)

-- photography course singapore — zero tracked-competitor rankings
-- (no rows: results = [] in source data)

-- ai for business singapore
INSERT INTO seo_rankings (keyword_id, competitor_id, competitor_name, position, is_ad, checked_at, source, verified_by, notes)
VALUES
  ((SELECT id FROM seo_keywords WHERE keyword = 'ai for business singapore'),
   (SELECT id FROM competitors WHERE name = 'Vertical Institute'), 'Vertical Institute', 8, false, '2026-06-22T00:00:00Z', 'manual', 'Hustle SG team', NULL),
  ((SELECT id FROM seo_keywords WHERE keyword = 'ai for business singapore'),
   (SELECT id FROM competitors WHERE name = 'InfoTech Academy'), 'InfoTech Academy', NULL, true, '2026-06-22T00:00:01Z', 'manual', 'Hustle SG team', 'Paid ad placement')
ON CONFLICT (keyword_id, competitor_id, competitor_name, checked_at) DO NOTHING;
