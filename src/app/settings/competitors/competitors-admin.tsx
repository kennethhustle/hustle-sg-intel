'use client'

import { Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Search, Pencil, Trash2, Eye, EyeOff,
  Upload, ExternalLink, RefreshCw, AlertTriangle,
  CheckCircle, AlertCircle, XCircle, Archive, ArchiveRestore,
  ChevronLeft, ChevronRight, Loader2, ExternalLinkIcon,
} from 'lucide-react'
import type { Competitor, HealthAuxData } from './page'
import { CompetitorModal } from './competitor-modal'

// ─── Status model ───────────────────────────────────────────────────────────
// archived_at set -> Archived (regardless of active); else active=true -> Active; else -> Inactive.
type Status = 'active' | 'inactive' | 'archived'

function getStatus(c: Competitor): Status {
  if (c.archived_at) return 'archived'
  if (c.active) return 'active'
  return 'inactive'
}

const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
}

// ─── Data Health ──────────────────────────────────────────────────────────────
// Precedence (highest priority first):
//   1. "Refresh failing"        — latest data_refresh_logs row for this competitor is 'failed'
//   2. "Verification overdue"   — google_ads_verified_at is null or >30 days old
//   3. Complete / Partial / Incomplete — based on field completeness (original logic, extended
//      to also check competitor_data_sources aliases for myskillsfuture in addition to the
//      legacy myskillsfuture_provider_name column).
// Rationale: operational failures (refresh failing) are the most actionable/urgent signal for
// an admin to act on, followed by stale manual data, then general completeness.
type HealthLabel = 'Complete' | 'Partial' | 'Incomplete' | 'Refresh failing' | 'Verification overdue'

function getHealth(
  c: Competitor,
  opts: { hasMysfAlias: boolean; latestRefreshStatus: string | null; googleAdsVerifiedAt: string | null }
): { label: HealthLabel; color: string; icon: 'green' | 'yellow' | 'red' } {
  const hasSocial = !!(c.facebook_url || c.instagram_url || c.linkedin_company_slug)
  const hasSF     = !!c.myskillsfuture_provider_name || opts.hasMysfAlias
  const hasAds    = (c.meta_ads_count ?? 0) > 0

  if (opts.latestRefreshStatus === 'failed') {
    return { label: 'Refresh failing', color: 'text-red-400 border-red-800/50 bg-red-950/30', icon: 'red' }
  }

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  const TODAY = new Date('2026-07-06T00:00:00Z').getTime()
  const verifiedAt = opts.googleAdsVerifiedAt ? new Date(opts.googleAdsVerifiedAt).getTime() : null
  if (!verifiedAt || TODAY - verifiedAt > THIRTY_DAYS_MS) {
    return { label: 'Verification overdue', color: 'text-amber-400 border-amber-800/50 bg-amber-950/30', icon: 'yellow' }
  }

  if (c.website && hasSocial && hasSF && hasAds) {
    return { label: 'Complete',  color: 'text-emerald-400 border-emerald-800/50 bg-emerald-950/30', icon: 'green' }
  }
  if (c.website && (hasSocial || hasSF)) {
    return { label: 'Partial',   color: 'text-amber-400  border-amber-800/50  bg-amber-950/30',  icon: 'yellow' }
  }
  return { label: 'Incomplete', color: 'text-red-400    border-red-800/50    bg-red-950/30',    icon: 'red' }
}

const HealthIcon = ({ icon }: { icon: 'green' | 'yellow' | 'red' }) =>
  icon === 'green'  ? <CheckCircle  className="h-3 w-3 text-emerald-400" /> :
  icon === 'yellow' ? <AlertCircle  className="h-3 w-3 text-amber-400"  /> :
                      <XCircle      className="h-3 w-3 text-red-400"    />

// ─── Module chips ─────────────────────────────────────────────────────────────
const MODULE_CHIPS: { key: keyof Competitor; letter: string; title: string }[] = [
  { key: 'track_courses', letter: 'C', title: 'Courses' },
  { key: 'track_hiring', letter: 'H', title: 'Hiring' },
  { key: 'track_marketing', letter: 'M', title: 'Marketing' },
  { key: 'track_social', letter: 'S', title: 'Social' },
  { key: 'track_seo', letter: 'SEO', title: 'SEO' },
  { key: 'include_in_opportunity_engine', letter: 'OE', title: 'Opportunity Engine' },
]

function ModuleChips({ c }: { c: Competitor }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {MODULE_CHIPS.map(m => {
        const on = Boolean(c[m.key])
        return (
          <span
            key={m.key}
            title={`${m.title}: ${on ? 'on' : 'off'}`}
            className={`text-[9px] font-mono font-bold px-1 py-px rounded border ${
              on
                ? 'text-indigo-300 border-indigo-700/60 bg-indigo-950/40 opacity-100'
                : 'text-slate-600 border-slate-800 bg-slate-900/40 opacity-40'
            }`}
          >
            {m.letter}
          </span>
        )
      })}
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium shadow-xl max-w-md
      ${type === 'success' ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-300' : 'bg-red-950/90 border-red-700/60 text-red-300'}`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      <span>{msg}</span>
    </div>
  )
}

// ─── CSV parse ────────────────────────────────────────────────────────────────
const CSV_COLS = ['name','website','country','industry','facebook_url','instagram_url',
  'linkedin_company_slug','tiktok_url','youtube_url','myskillsfuture_provider_name',
  'google_business_name','color','notes','tier',
  'track_courses','track_hiring','track_marketing','track_social','track_seo',
  'myskillsfuture_provider_aliases']

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { if (CSV_COLS.includes(h) && vals[i]) row[h] = vals[i] })
    return row
  }).filter(r => r.name)
}

const BOOL_CSV_KEYS = ['track_courses', 'track_hiring', 'track_marketing', 'track_social', 'track_seo'] as const

function csvRowToPayload(row: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'myskillsfuture_provider_aliases') continue
    if ((BOOL_CSV_KEYS as readonly string[]).includes(k)) {
      payload[k] = v.trim().toLowerCase() === 'true'
    } else {
      payload[k] = v
    }
  }
  return payload
}

// ─── Row action helpers ───────────────────────────────────────────────────────
type RefreshModuleResult = { module: string; status: 'success' | 'partial' | 'failed' | 'skipped'; message?: string }

function slugifyForCsv(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CompetitorsAdmin({
  initialCompetitors,
  currentUserRole,
  healthAux,
}: {
  initialCompetitors: Competitor[]
  currentUserRole: string
  healthAux: HealthAuxData
}) {
  const router = useRouter()
  const isAdmin = currentUserRole === 'admin'
  const [competitors, setCompetitors] = useState<Competitor[]>(initialCompetitors)
  const [search, setSearch]           = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')
  const [tierFilter, setTierFilter]   = useState<'all' | 'High' | 'Mid' | 'Low'>('all')
  const [modalOpen, setModalOpen]     = useState(false)
  const [editing, setEditing]         = useState<Competitor | null>(null)
  const [toast, setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Competitor | null>(null)
  const [confirmHardDelete, setConfirmHardDelete] = useState<Competitor | null>(null)
  const [busy, setBusy]               = useState<string | null>(null) // id of row being actioned
  const [refreshResults, setRefreshResults] = useState<{ id: string; results: RefreshModuleResult[] } | null>(null)
  const [page, setPage]               = useState(1)
  const [importSummary, setImportSummary] = useState<{ created: number; updated: number; failed: { row: string; error: string }[] } | null>(null)
  const fileRef                       = useRef<HTMLInputElement>(null)
  const PAGE_SIZE = 25

  // Auxiliary data for extended health badge computation — loaded server-side
  // in page.tsx (getHealthAuxData) and passed down as props. Reloaded on
  // full page refresh (router.refresh()) after mutating actions.
  const mysfAliasSet = useMemo(() => new Set(healthAux.mysfAliasCompetitorIds), [healthAux])
  const latestRefreshMap = useMemo(
    () => new Map(Object.entries(healthAux.latestRefreshByCompetitor)),
    [healthAux]
  )
  const googleAdsVerifiedMap = useMemo(
    () => new Map(Object.entries(healthAux.googleAdsVerifiedAtByCompetitor)),
    [healthAux]
  )

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4500)
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let list = competitors
    if (statusFilter !== 'all') list = list.filter(c => getStatus(c) === statusFilter)
    if (tierFilter !== 'all') list = list.filter(c => c.tier === tierFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.website ?? '').toLowerCase().includes(q) ||
        (c.industry ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [competitors, statusFilter, tierFilter, search])

  // Reset to page 1 whenever filters change the visible set size materially
  useEffect(() => { setPage(1) }, [statusFilter, tierFilter, search])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return visible.slice(start, start + PAGE_SIZE)
  }, [visible, page])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    competitors.length,
    active:   competitors.filter(c => getStatus(c) === 'active').length,
    complete: competitors.filter(c => getHealth(c, {
      hasMysfAlias: mysfAliasSet.has(c.id),
      latestRefreshStatus: latestRefreshMap.get(c.id)?.status ?? null,
      googleAdsVerifiedAt: googleAdsVerifiedMap.get(c.id) ?? null,
    }).icon === 'green').length,
  }), [competitors, mysfAliasSet, latestRefreshMap, googleAdsVerifiedMap])

  // ── Reload from server ─────────────────────────────────────────────────────
  const reload = async () => {
    const res = await fetch('/api/competitors')
    if (res.ok) {
      const data = await res.json()
      setCompetitors(data)
    }
  }

  // ── CRUD handlers ──────────────────────────────────────────────────────────
  const handleSave = async (body: Partial<Competitor>) => {
    const isEdit = !!editing
    const url    = isEdit ? `/api/competitors/${editing!.id}` : '/api/competitors'
    const method = isEdit ? 'PUT' : 'POST'

    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'Save failed')
    }
    await reload()
    setModalOpen(false)
    setEditing(null)
    router.refresh()
    showToast(isEdit ? `${body.name} updated.` : `${body.name} added.`, 'success')
  }

  const handleToggleActive = async (c: Competitor) => {
    setBusy(c.id)
    const res = await fetch(`/api/competitors/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !c.active }),
    })
    setBusy(null)
    if (!res.ok) { const err = await res.json().catch(() => ({})); showToast(err.error ?? 'Update failed', 'error'); return }
    await reload()
    showToast(`${c.name} ${c.active ? 'deactivated' : 'reactivated'}.`, 'success')
  }

  const handleArchive = async () => {
    if (!confirmDelete) return
    setBusy(confirmDelete.id)
    const res = await fetch(`/api/competitors/${confirmDelete.id}`, { method: 'DELETE' })
    setBusy(null)
    setConfirmDelete(null)
    if (!res.ok) { const err = await res.json().catch(() => ({})); showToast(err.error ?? 'Archive failed', 'error'); return }
    await reload()
    showToast(`${confirmDelete.name} archived (historical data preserved).`, 'success')
  }

  const handleRestore = async (c: Competitor) => {
    setBusy(c.id)
    const res = await fetch(`/api/competitors/${c.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: true }),
    })
    setBusy(null)
    if (!res.ok) { const err = await res.json().catch(() => ({})); showToast(err.error ?? 'Restore failed', 'error'); return }
    await reload()
    showToast(`${c.name} restored.`, 'success')
  }

  // Row counts across child tables are only known after the DELETE?mode=hard
  // call actually runs (the API returns affected_rows) — there is no dry-run
  // endpoint, so the confirm dialog shows a generic warning, and the actual
  // affected-row summary is surfaced in the success toast after deletion.
  const openHardDeleteConfirm = (c: Competitor) => {
    setConfirmHardDelete(c)
  }

  const handleHardDelete = async () => {
    if (!confirmHardDelete) return
    setBusy(confirmHardDelete.id)
    const res = await fetch(`/api/competitors/${confirmHardDelete.id}?mode=hard`, { method: 'DELETE' })
    setBusy(null)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      showToast(err.error ?? 'Hard delete failed', 'error')
      setConfirmHardDelete(null)
      return
    }
    const data = await res.json()
    const affected: Record<string, number> = data.affected_rows ?? {}
    const affectedSummary = Object.entries(affected)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
    await reload()
    router.refresh()
    setConfirmHardDelete(null)
    showToast(
      `${confirmHardDelete.name} permanently deleted.` + (affectedSummary ? ` Removed related rows — ${affectedSummary}.` : ''),
      'success'
    )
  }

  const handleRefresh = async (c: Competitor) => {
    setBusy(c.id)
    setRefreshResults(null)
    try {
      const res = await fetch(`/api/refresh/competitor/${c.id}`, { method: 'POST' })
      if (res.status === 429) {
        showToast(`${c.name} was refreshed recently — try again in a few minutes.`, 'error')
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast(err.error ?? 'Refresh failed', 'error')
        return
      }
      const data = await res.json()
      setRefreshResults({ id: c.id, results: data.results ?? [] })
      const failedCount = (data.results ?? []).filter((r: RefreshModuleResult) => r.status === 'failed').length
      showToast(
        failedCount > 0
          ? `${c.name} refreshed with ${failedCount} module(s) failing.`
          : `${c.name} refreshed successfully.`,
        failedCount > 0 ? 'error' : 'success'
      )
      await reload()
      router.refresh() // re-fetch server-side health aux data (refresh logs, verified_at)
    } catch {
      showToast('Refresh request failed — please try again.', 'error')
    } finally {
      setBusy(null)
    }
  }

  // ── CSV import (upsert-by-slug, per-row validation, summary) ───────────────
  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const rows = parseCSV(text)
    if (!rows.length) { showToast('No valid rows found in CSV', 'error'); return }

    let created = 0
    let updated = 0
    const failed: { row: string; error: string }[] = []

    for (const row of rows) {
      if (!row.name || !row.name.trim()) {
        failed.push({ row: row.name || '(blank)', error: 'Name is required' })
        continue
      }

      const slug = slugifyForCsv(row.name)
      const existing = competitors.find(c => c.slug === slug)
      const payload = csvRowToPayload(row)

      try {
        if (existing) {
          const res = await fetch(`/api/competitors/${existing.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failed.push({ row: row.name, error: err.error ?? `HTTP ${res.status}` })
            continue
          }
          updated++
          const savedComp = await res.json()

          // myskillsfuture_provider_aliases: pipe-separated -> one competitor_data_sources row each
          if (row.myskillsfuture_provider_aliases) {
            const aliases = row.myskillsfuture_provider_aliases.split('|').map(a => a.trim()).filter(Boolean)
            for (const alias of aliases) {
              await fetch(`/api/competitors/${savedComp.id}/sources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_type: 'myskillsfuture', identifier: alias }),
              }).catch(() => null)
            }
          }
        } else {
          const res = await fetch('/api/competitors', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            failed.push({ row: row.name, error: err.error ?? `HTTP ${res.status}` })
            continue
          }
          created++
          const savedComp = await res.json()

          if (row.myskillsfuture_provider_aliases) {
            const aliases = row.myskillsfuture_provider_aliases.split('|').map(a => a.trim()).filter(Boolean)
            for (const alias of aliases) {
              await fetch(`/api/competitors/${savedComp.id}/sources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_type: 'myskillsfuture', identifier: alias }),
              }).catch(() => null)
            }
          }
        }
      } catch (err) {
        failed.push({ row: row.name, error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }

    await reload()
    setImportSummary({ created, updated, failed })
    showToast(`Import complete: ${created} created, ${updated} updated, ${failed.length} failed.`, failed.length > 0 ? 'error' : 'success')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">Competitor Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">Changes propagate to all Intel modules instantly. No code required.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSV} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <button
            onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" /> Add Competitor
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Competitors', value: stats.total, color: 'text-white' },
          { label: 'Active',            value: stats.active,   color: 'text-emerald-400' },
          { label: 'Fully Configured',  value: stats.complete, color: 'text-indigo-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filter/Search bar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search competitors…"
            className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <div className="flex rounded-lg border border-slate-800 overflow-hidden">
          {(['all', 'active', 'inactive', 'archived'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-2 text-xs font-mono uppercase tracking-wide transition-colors ${statusFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-900/60 text-slate-500 hover:text-slate-300'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-slate-800 overflow-hidden">
          {(['all', 'High', 'Mid', 'Low'] as const).map(f => (
            <button
              key={f}
              onClick={() => setTierFilter(f)}
              className={`px-3 py-2 text-xs font-mono uppercase tracking-wide transition-colors ${tierFilter === f ? 'bg-indigo-600 text-white' : 'bg-slate-900/60 text-slate-500 hover:text-slate-300'}`}
            >
              {f === 'all' ? 'all tiers' : f}
            </button>
          ))}
        </div>
        <button onClick={reload} className="p-2 text-slate-500 hover:text-slate-300 bg-slate-900/60 border border-slate-800 rounded-lg transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-slate-800/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60">
                {['', 'Competitor', 'Website', 'Industry', 'Data Health', 'Modules', 'Meta Ads', 'Reviews', 'Last Refreshed', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-mono text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-slate-600 text-sm">
                    No competitors found.
                  </td>
                </tr>
              )}
              {paginated.map((c, idx) => {
                const status = getStatus(c)
                const health = getHealth(c, {
                  hasMysfAlias: mysfAliasSet.has(c.id),
                  latestRefreshStatus: latestRefreshMap.get(c.id)?.status ?? null,
                  googleAdsVerifiedAt: googleAdsVerifiedMap.get(c.id) ?? null,
                })
                const isLoading = busy === c.id
                const lastRefresh = latestRefreshMap.get(c.id)?.started_at ?? null
                const rowResults = refreshResults?.id === c.id ? refreshResults.results : null

                return (
                  <Fragment key={c.id}>
                  <tr
                    className={`border-b border-slate-800/40 last:border-0 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-900/20'} ${status !== 'active' ? 'opacity-50' : ''} hover:bg-slate-800/20`}
                  >
                    {/* Color dot */}
                    <td className="px-4 py-3 w-8">
                      <div className="w-3 h-3 rounded-full border border-white/10" style={{ backgroundColor: c.color }} />
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-semibold text-white text-sm">{c.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {c.short_name && (
                              <span className="text-[10px] font-mono text-slate-600 bg-slate-800 px-1.5 py-px rounded">
                                {c.short_name}
                              </span>
                            )}
                            {c.is_hustle && (
                              <span className="text-[9px] font-mono bg-violet-900/50 text-violet-400 border border-violet-800/60 px-1.5 py-px rounded">YOU</span>
                            )}
                            <span className={`text-[9px] font-mono px-1.5 py-px rounded border ${
                              status === 'archived' ? 'bg-slate-800 text-slate-500 border-slate-700' :
                              status === 'inactive' ? 'bg-amber-950/40 text-amber-500 border-amber-800/50' :
                              'bg-emerald-950/30 text-emerald-500 border-emerald-800/40'
                            }`}>
                              {STATUS_LABEL[status].toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Website */}
                    <td className="px-4 py-3">
                      {c.website ? (
                        <a href={c.website} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-sky-500 hover:text-sky-400 transition-colors flex items-center gap-1">
                          {c.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-slate-700 text-xs">—</span>
                      )}
                    </td>

                    {/* Industry */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-xs text-slate-400">{c.industry ?? '—'}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{c.country ?? ''}</p>
                    </td>

                    {/* Data Health */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-semibold tracking-wide whitespace-nowrap ${health.color}`}>
                        <HealthIcon icon={health.icon} />
                        {health.label}
                      </span>
                      <div className="flex items-center gap-2 mt-1.5 text-[9px] font-mono text-slate-700">
                        <span title="Facebook"  className={c.facebook_url   ? 'text-sky-600'    : ''}>FB</span>
                        <span title="Instagram" className={c.instagram_url  ? 'text-pink-600'   : ''}>IG</span>
                        <span title="LinkedIn"  className={c.linkedin_company_slug ? 'text-blue-600' : ''}>LI</span>
                        <span title="TikTok"   className={c.tiktok_url     ? 'text-emerald-600': ''}>TK</span>
                        <span title="YouTube"  className={c.youtube_url    ? 'text-red-600'    : ''}>YT</span>
                        <span title="MySF"     className={(c.myskillsfuture_provider_name || mysfAliasSet.has(c.id)) ? 'text-indigo-500' : ''}>SF</span>
                      </div>
                    </td>

                    {/* Modules */}
                    <td className="px-4 py-3">
                      <ModuleChips c={c} />
                    </td>

                    {/* Meta Ads */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-mono font-bold text-white text-sm">{c.meta_ads_count ?? 0}</p>
                      <p className="text-[10px] text-slate-600">active ads</p>
                    </td>

                    {/* Google Reviews */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-mono font-bold text-white text-sm">
                        {c.google_review_count ? c.google_review_count.toLocaleString() : '—'}
                      </p>
                      {c.google_rating && (
                        <p className="text-[10px] text-amber-500 font-mono">★ {Number(c.google_rating).toFixed(1)}</p>
                      )}
                    </td>

                    {/* Last Refreshed */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-xs text-slate-400">
                        {lastRefresh ? new Date(lastRefresh).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never'}
                      </p>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* View profile */}
                        <Link
                          href={`/competitors/${c.slug}`}
                          title="View profile"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-950/40 transition-colors"
                        >
                          <ExternalLinkIcon className="h-3.5 w-3.5" />
                        </Link>

                        {/* Edit */}
                        <button
                          disabled={isLoading}
                          onClick={() => { setEditing(c); setModalOpen(true) }}
                          title="Edit"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-950/40 transition-colors disabled:opacity-40"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        {/* Refresh */}
                        <button
                          disabled={isLoading}
                          onClick={() => handleRefresh(c)}
                          title="Refresh now"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-950/40 transition-colors disabled:opacity-40"
                        >
                          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        </button>

                        {/* Toggle active (hidden when archived — use Restore instead) */}
                        {status !== 'archived' && (
                          <button
                            disabled={isLoading}
                            onClick={() => handleToggleActive(c)}
                            title={c.active ? 'Deactivate' : 'Reactivate'}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${c.active ? 'text-slate-500 hover:text-amber-400 hover:bg-amber-950/40' : 'text-slate-600 hover:text-emerald-400 hover:bg-emerald-950/40'}`}
                          >
                            {c.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}

                        {/* Archive / Restore */}
                        {status === 'archived' ? (
                          <button
                            disabled={isLoading}
                            onClick={() => handleRestore(c)}
                            title="Restore"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-400 hover:bg-emerald-950/40 transition-colors disabled:opacity-40"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          !c.is_hustle && (
                            <button
                              disabled={isLoading}
                              onClick={() => setConfirmDelete(c)}
                              title="Archive"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-950/40 transition-colors disabled:opacity-40"
                            >
                              <Archive className="h-3.5 w-3.5" />
                            </button>
                          )
                        )}

                        {/* Hard delete — admin only */}
                        {isAdmin && !c.is_hustle && (
                          <button
                            disabled={isLoading}
                            onClick={() => openHardDeleteConfirm(c)}
                            title="Delete permanently"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {rowResults && (
                    <tr className="bg-slate-900/40 border-b border-slate-800/40">
                      <td></td>
                      <td colSpan={9} className="px-4 py-2">
                        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono">
                          <span className="text-slate-500 uppercase tracking-wide">Refresh results:</span>
                          {rowResults.map(r => (
                            <span
                              key={r.module}
                              className={`px-1.5 py-0.5 rounded border ${
                                r.status === 'success' ? 'text-emerald-400 border-emerald-800/50 bg-emerald-950/30' :
                                r.status === 'partial' ? 'text-amber-400 border-amber-800/50 bg-amber-950/30' :
                                r.status === 'skipped' ? 'text-slate-500 border-slate-700 bg-slate-900/40' :
                                'text-red-400 border-red-800/50 bg-red-950/30'
                              }`}
                              title={r.message}
                            >
                              {r.module}: {r.status}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ── */}
      {visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <p>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}</p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── CSV hint ── */}
      <p className="text-[10px] font-mono text-slate-700">
        CSV import columns: name, website, country, industry, facebook_url, instagram_url, linkedin_company_slug, tiktok_url, youtube_url,
        myskillsfuture_provider_name, myskillsfuture_provider_aliases (pipe-separated), google_business_name, color, notes, tier,
        track_courses, track_hiring, track_marketing, track_social, track_seo (true/false). Import upserts by slug — matching rows are updated, not duplicated.
      </p>

      {/* ── Import summary ── */}
      {importSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#09090f] border border-slate-800 rounded-2xl w-full max-w-lg mx-4 p-6 max-h-[80vh] flex flex-col">
            <p className="text-white font-semibold mb-3">Import Summary</p>
            <div className="flex items-center gap-4 mb-4 text-sm">
              <span className="text-emerald-400 font-mono">{importSummary.created} created</span>
              <span className="text-sky-400 font-mono">{importSummary.updated} updated</span>
              <span className="text-red-400 font-mono">{importSummary.failed.length} failed</span>
            </div>
            {importSummary.failed.length > 0 && (
              <div className="overflow-y-auto flex-1 space-y-1.5 mb-4">
                {importSummary.failed.map((f, i) => (
                  <div key={i} className="text-xs bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
                    <span className="text-red-300 font-medium">{f.row}</span>
                    <span className="text-slate-500"> — {f.error}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setImportSummary(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      {modalOpen && (
        <CompetitorModal
          competitor={editing}
          onClose={() => { setModalOpen(false); setEditing(null); router.refresh() }}
          onSave={handleSave}
        />
      )}

      {/* ── Confirm Archive Dialog ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#09090f] border border-amber-800/50 rounded-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-semibold">Archive {confirmDelete.name}?</p>
                <p className="text-sm text-slate-400 mt-1">
                  This sets the competitor to Archived and Inactive. All historical intelligence data for this competitor is preserved.
                  The competitor will no longer appear in live dashboards. You can restore it later.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                className="px-4 py-2 bg-amber-900/60 hover:bg-amber-800/60 text-amber-300 text-sm font-medium rounded-lg border border-amber-700/50 transition-colors"
              >
                Archive Competitor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Hard Delete Dialog ── */}
      {confirmHardDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#09090f] border border-red-800/50 rounded-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-semibold">Permanently delete {confirmHardDelete.name}?</p>
                <p className="text-sm text-slate-400 mt-1">
                  This is irreversible. All historical intelligence data — SF courses, marketing data, job postings,
                  social snapshots, SEO rankings, refresh logs, and data source aliases — associated with this competitor
                  will be permanently lost. Consider Archive instead if you may need this data again. A summary of
                  affected rows will be shown after deletion completes.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmHardDelete(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleHardDelete}
                className="px-4 py-2 bg-red-900/60 hover:bg-red-800/60 text-red-300 text-sm font-medium rounded-lg border border-red-700/50 transition-colors"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
