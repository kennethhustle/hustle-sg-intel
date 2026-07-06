# Implementation Notes — Intelligence System Overhaul (6 Jul 2026)

## What changed

### Architecture (cached intelligence layer)
Dashboard pages already read from Supabase only; that is preserved. All external fetching lives in cron/refresh routes. Every refresh job now logs to `data_refresh_logs` (start/end, status, record counts, errors, trigger type, competitor scope).

### Cron schedule (vercel.json) — aligned to the 12:00am SGT window
Staggered jobs (Option B) were chosen over one master job because the Puppeteer run-count scrape alone can approach Vercel's 300s limit.

| UTC | SGT | Job | Module logged |
|---|---|---|---|
| 16:00 | 00:00 | /api/cron/sf-refresh (SF course catalog) | sf_courses |
| 16:05 | 00:05 | /api/cron/myskillsfuture-refresh | sf_courses |
| 16:10 | 00:10 | /api/cron/runcount-refresh (Puppeteer) | runcounts |
| 16:25 | 00:25 | /api/cron/marketing-refresh (Meta/Places) | marketing |
| 16:35 | 00:35 | /api/cron/hiring-refresh | hiring |
| 16:45 | 00:45 | /api/cron/social-refresh (+ alert generation) | social, alerts |
| 16:55 | 00:55 | /api/cron/courses-refresh (website catalogs — now scheduled) | course_catalog |
| 17:15 | 01:15 | /api/cron/ai-insights (scores + Claude) | ai_insights |

### Migrations (schema drift fixed — DB now rebuildable from repo)
- **005_cached_intelligence_tables.sql** — versions the previously ad-hoc tables (`data_refresh_logs`, `sf_courses`, `provider_top_runs`, `social_snapshots`, `social_content_themes`, `competitor_marketing_data`) idempotently, plus new columns: sf_courses change-detection (first/last_seen, is_active, category_cluster), social manual-verify fields, Google-Ads manual-data honesty fields, and new `marketing_snapshots` history table.
- **006_competitor_management.sql** — competitor module toggles (track_courses/hiring/marketing/social/seo, include_in_opportunity_engine), archived_at, and `competitor_data_sources` alias table (seeded with the MySkillsFuture provider names formerly hardcoded — incl. Hustle's two entities).
- **007_insights_scoring_alerts.sql** — richer `strategic_insights` (confidence, evidence, recommended_action, owner, timeframe, categories, opportunity_score; new insight types), new `opportunity_scores` table, alert evidence/action fields.
- **008_seo_intelligence.sql** + **009_seed_seo_snapshot.sql** — SEO keywords/rankings/snapshot-meta tables, seeded from the previously hardcoded 22 Jun 2026 snapshot.

**Manual step:** run `supabase db push` (or apply 005→009 in the Supabase SQL editor, in order). All statements are idempotent against the existing production DB.

### Backend
- Provider aliases now read from `competitor_data_sources` (hardcoded map deleted from `sf_courses.ts`).
- All ingestion respects active/archived + module toggles, and takes an optional `competitorId` for scoped runs.
- `POST /api/refresh/competitor/[id]` — per-competitor refresh (admin/analyst, rate-limited 5 min, logs every module).
- `src/lib/services/alerts/generate.ts` — rule-based alerts: new/removed courses, run-count surges, Meta-ads changes, review growth, hiring spikes (with strategic interpretation), data-quality failures/staleness, manual-data-overdue. 3-day dedup.
- Marketing refresh: retry logic, `marketing_snapshots` daily history, sf_respondents bug fixed.

### AI Opportunity Engine
- `ai/payload.ts` builds a comprehensive payload (courses incl. cluster totals/new/removed/fees, marketing incl. manual-flagged Google Ads, hiring buckets, SEO snapshot, YouTube+verified social, alerts, freshness, recent titles for dedup).
- Prompt: 3–8 insights (no filler), new types, evidence bullets, confidence, recommended_action, owner, timeframe; forbidden from speculating on unavailable/stale data. Zod-validated with one retry. Insights persist 7 days (history).
- `scoring/opportunity.ts`: transparent 0–100 score per category cluster = Demand×35% + Competition-Gap×25% + Hustle-Fit×20% + Urgency×20%, with full breakdown + evidence stored for the explainable UI. `GET /api/opportunities`.

### UI
- SEO module now DB-driven with "MANUAL SEO SNAPSHOT" banner, verified/next-review dates.
- Hardcoded threat radar/growth alerts/recommendations removed or replaced with DB/rule-derived, labelled content.
- `DataSourceBadge` (live/cached/manual/static/ai/unavailable) used across modules; Google Ads clearly marked manual with verification-overdue warnings.
- Live Data Feed indicator now reflects real health from `data_refresh_logs` (green/yellow/red/grey) via `/api/refresh-health`; dashboard shows a per-module Refresh Health card.
- Course Intel: category clusters with GAP chips, new/deactivated course lists, median fees; timing copy corrected.
- Competitor admin: status (Active/Inactive/Archived) + tier filters, module toggle switches, alias editor, per-competitor Refresh button, extended health badges, pagination, CSV upsert-by-slug with new columns.
- New `/competitors/[slug]` profile pages (courses, hiring, social, SEO, marketing, alerts, AI mentions — all labelled).

## Environment variables (unchanged set)
Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `GOOGLE_PLACES_API_KEY`, `CRON_SECRET`. Optional: `META_AD_LIBRARY_ACCESS_TOKEN`, `ANTHROPIC_MODEL` (defaults to claude-3-5-sonnet-20241022 — consider upgrading).

## Remaining limitations / temporary fallbacks
1. `course-intelligence/page.tsx` keeps a display-only provider-name → display-name map (GROUP) and debug-provider list. Tracking is DB-driven; unmapped providers fall back to their raw name. Worth migrating the page to group by `competitor_id` later.
2. SEO remains a manual snapshot (no rank-tracking API connected). Update via the seo_* tables; the UI shows verification/next-review dates.
3. IG/FB/LinkedIn/TikTok scraping remains blocked by the platforms; use manual verified entries (`social_snapshots.data_source='verified_manual'`) or a paid API.
4. Google Ads counts remain manual (`competitor_marketing_data.google_ads` + verified_at/source_url/notes/entered_by).
5. Per-competitor refresh runs Puppeteer run counts inline; heavy usage may approach route timeouts — a queue/worker (e.g. Browserless, Inngest, or a separate worker) is the recommended next step if competitor count grows.
6. `competitor_activity` and `audit_logs` tables remain unused (documented, not removed). `generateAlertSummary()` in claude.ts is still unused.
7. Repo has no package-lock.json — commit one to pin dependency versions (fresh installs currently resolve newer packages; type fixes for that drift are included).
