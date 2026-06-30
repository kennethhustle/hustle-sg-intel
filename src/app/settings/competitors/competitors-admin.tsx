'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, Pencil, Trash2, Eye, EyeOff,
  Upload, ExternalLink, RefreshCw, AlertTriangle,
  CheckCircle, AlertCircle, XCircle,
} from 'lucide-react'
import type { Competitor } from './page'
import { CompetitorModal } from './competitor-modal'

// ─── Data Health ──────────────────────────────────────────────────────────────
function getHealth(c: Competitor): { label: string; color: string; icon: 'green' | 'yellow' | 'red' } {
  const hasSocial = !!(c.facebook_url || c.instagram_url || c.linkedin_company_slug)
  const hasSF     = !!c.myskillsfuture_provider_name
  const hasAds    = (c.meta_ads_count ?? 0) > 0

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

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium shadow-xl
      ${type === 'success' ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-300' : 'bg-red-950/90 border-red-700/60 text-red-300'}`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      {msg}
    </div>
  )
}

// ─── CSV parse ────────────────────────────────────────────────────────────────
const CSV_COLS = ['name','website','country','industry','facebook_url','instagram_url',
  'linkedin_company_slug','tiktok_url','youtube_url','myskillsfuture_provider_name',
  'google_business_name','color','notes']

function parseCSV(text: string): Partial<Competitor>[] {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { if (CSV_COLS.includes(h) && vals[i]) row[h] = vals[i] })
    return row as Partial<Competitor>
  }).filter(r => r.name)
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CompetitorsAdmin({ initialCompetitors }: { initialCompetitors: Competitor[] }) {
  const router = useRouter()
  const [competitors, setCompetitors] = useState<Competitor[]>(initialCompetitors)
  const [search, setSearch]           = useState('')
  const [filter, setFilter]           = useState<'all' | 'active' | 'inactive'>('all')
  const [modalOpen, setModalOpen]     = useState(false)
  const [editing, setEditing]         = useState<Competitor | null>(null)
  const [toast, setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Competitor | null>(null)
  const [busy, setBusy]               = useState<string | null>(null) // id of row being actioned
  const fileRef                       = useRef<HTMLInputElement>(null)

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    let list = competitors
    if (filter === 'active')   list = list.filter(c => c.active)
    if (filter === 'inactive') list = list.filter(c => !c.active)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.website ?? '').toLowerCase().includes(q) ||
        (c.industry ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [competitors, filter, search])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    competitors.length,
    active:   competitors.filter(c => c.active).length,
    complete: competitors.filter(c => getHealth(c).icon === 'green').length,
  }), [competitors])

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
    if (!res.ok) { showToast('Update failed', 'error'); return }
    await reload()
    showToast(`${c.name} ${c.active ? 'disabled' : 'enabled'}.`, 'success')
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setBusy(confirmDelete.id)
    const res = await fetch(`/api/competitors/${confirmDelete.id}`, { method: 'DELETE' })
    setBusy(null)
    setConfirmDelete(null)
    if (!res.ok) { showToast('Delete failed', 'error'); return }
    await reload()
    showToast(`${confirmDelete.name} removed (soft delete — data preserved).`, 'success')
  }

  // ── CSV import ─────────────────────────────────────────────────────────────
  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const rows = parseCSV(text)
    if (!rows.length) { showToast('No valid rows found in CSV', 'error'); return }

    let added = 0
    for (const row of rows) {
      const res = await fetch('/api/competitors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row),
      })
      if (res.ok) added++
    }
    await reload()
    showToast(`Imported ${added} of ${rows.length} competitors.`, added > 0 ? 'success' : 'error')
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
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs font-mono uppercase tracking-wide transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-900/60 text-slate-500 hover:text-slate-300'}`}
            >
              {f}
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
                {['', 'Competitor', 'Website', 'Industry', 'Data Health', 'Meta Ads', 'Reviews', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-mono text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-600 text-sm">
                    No competitors found.
                  </td>
                </tr>
              )}
              {visible.map((c, idx) => {
                const health = getHealth(c)
                const isLoading = busy === c.id
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-slate-800/40 last:border-0 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-900/20'} ${!c.active ? 'opacity-50' : ''} hover:bg-slate-800/20`}
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
                            {!c.active && (
                              <span className="text-[9px] font-mono bg-slate-800 text-slate-500 border border-slate-700 px-1.5 py-px rounded">INACTIVE</span>
                            )}
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
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-semibold tracking-wide ${health.color}`}>
                        <HealthIcon icon={health.icon} />
                        {health.label}
                      </span>
                      <div className="flex items-center gap-2 mt-1.5 text-[9px] font-mono text-slate-700">
                        <span title="Facebook"  className={c.facebook_url   ? 'text-sky-600'    : ''}>FB</span>
                        <span title="Instagram" className={c.instagram_url  ? 'text-pink-600'   : ''}>IG</span>
                        <span title="LinkedIn"  className={c.linkedin_company_slug ? 'text-blue-600' : ''}>LI</span>
                        <span title="TikTok"   className={c.tiktok_url     ? 'text-emerald-600': ''}>TK</span>
                        <span title="YouTube"  className={c.youtube_url    ? 'text-red-600'    : ''}>YT</span>
                        <span title="MySF"     className={c.myskillsfuture_provider_name ? 'text-indigo-500' : ''}>SF</span>
                      </div>
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

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Edit */}
                        <button
                          disabled={isLoading}
                          onClick={() => { setEditing(c); setModalOpen(true) }}
                          title="Edit"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-indigo-950/40 transition-colors disabled:opacity-40"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        {/* Toggle active */}
                        <button
                          disabled={isLoading}
                          onClick={() => handleToggleActive(c)}
                          title={c.active ? 'Disable' : 'Enable'}
                          className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${c.active ? 'text-slate-500 hover:text-amber-400 hover:bg-amber-950/40' : 'text-slate-600 hover:text-emerald-400 hover:bg-emerald-950/40'}`}
                        >
                          {c.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>

                        {/* Delete */}
                        {!c.is_hustle && (
                          <button
                            disabled={isLoading}
                            onClick={() => setConfirmDelete(c)}
                            title="Remove (soft delete)"
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CSV hint ── */}
      <p className="text-[10px] font-mono text-slate-700">
        CSV import columns: name, website, country, industry, facebook_url, instagram_url, linkedin_company_slug, tiktok_url, youtube_url, myskillsfuture_provider_name, google_business_name, color, notes
      </p>

      {/* ── Add/Edit Modal ── */}
      {modalOpen && (
        <CompetitorModal
          competitor={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}

      {/* ── Confirm Delete Dialog ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#09090f] border border-red-800/50 rounded-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-semibold">Remove {confirmDelete.name}?</p>
                <p className="text-sm text-slate-400 mt-1">
                  This performs a soft delete. All historical intelligence data for this competitor is preserved.
                  The competitor will no longer appear in live dashboards.
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
                onClick={handleDelete}
                className="px-4 py-2 bg-red-900/60 hover:bg-red-800/60 text-red-300 text-sm font-medium rounded-lg border border-red-700/50 transition-colors"
              >
                Remove Competitor
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
