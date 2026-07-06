'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Plus, Pencil, Trash2, Check } from 'lucide-react'
import type { Competitor } from './page'
import type { CompetitorDataSource, CompetitorDataSourceType } from '@/lib/types'

const INPUT = 'w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors'
const LABEL = 'block text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-1'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  )
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-t border-slate-800/60 pt-4 mt-2">
      <p className="text-xs font-semibold text-white tracking-wide">{title}</p>
      <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>
    </div>
  )
}

// ─── Toggle switch ────────────────────────────────────────────────────────────
// @radix-ui/react-switch is a project dependency but there is no existing
// switch/toggle component to reuse the styling precedent from, so this is a
// lightweight styled button toggle matching the modal's dark slate theme
// (bg-slate-800 track / indigo-600 when on), consistent with the rest of the
// form controls (INPUT/LABEL constants above).
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between w-full gap-3 px-3 py-2 bg-slate-800/40 border border-slate-700/60 rounded-lg hover:border-slate-600 transition-colors"
    >
      <span className="text-xs text-slate-300">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-slate-700'
        }`}
      >
        <span
          className="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </span>
    </button>
  )
}

// ─── Data Source Aliases (edit mode only) ──────────────────────────────────────
const SOURCE_TYPES: CompetitorDataSourceType[] = [
  'myskillsfuture', 'mycareersfuture', 'google_business', 'meta_ads',
  'google_ads', 'jobstreet', 'indeed', 'careers_page', 'website', 'social', 'seo_domain',
]

const SOURCE_TYPE_LABELS: Record<CompetitorDataSourceType, string> = {
  myskillsfuture: 'MySkillsFuture',
  mycareersfuture: 'MyCareersFuture',
  google_business: 'Google Business',
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  jobstreet: 'JobStreet',
  indeed: 'Indeed',
  careers_page: 'Careers Page',
  website: 'Website',
  social: 'Social',
  seo_domain: 'SEO Domain',
}

function DataSourceAliasesSection({ competitorId }: { competitorId: string }) {
  const [sources, setSources] = useState<CompetitorDataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState<CompetitorDataSourceType | null>(null)
  const [newIdentifier, setNewIdentifier] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newIsPrimary, setNewIsPrimary] = useState(false)
  const [newNotes, setNewNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editIdentifier, setEditIdentifier] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editIsPrimary, setEditIsPrimary] = useState(false)
  const [editNotes, setEditNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/competitors/${competitorId}/sources`)
      if (res.ok) {
        const json = await res.json()
        setSources(json.data ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [competitorId])

  useEffect(() => { load() }, [load])

  const grouped = SOURCE_TYPES.map(type => ({
    type,
    rows: sources.filter(s => s.source_type === type),
  })).filter(g => g.rows.length > 0 || g.type === adding)

  const startAdd = (type: CompetitorDataSourceType) => {
    setAdding(type)
    setNewIdentifier('')
    setNewUrl('')
    setNewIsPrimary(false)
    setNewNotes('')
    setError('')
  }

  const submitAdd = async () => {
    if (!adding || !newIdentifier.trim()) { setError('Identifier is required.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/competitors/${competitorId}/sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: adding,
          identifier: newIdentifier.trim(),
          url: newUrl.trim() || null,
          notes: newNotes.trim() || null,
          is_primary: newIsPrimary,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Failed to add alias')
        return
      }
      setAdding(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (s: CompetitorDataSource) => {
    setEditingId(s.id)
    setEditIdentifier(s.identifier)
    setEditUrl(s.url ?? '')
    setEditIsPrimary(s.is_primary)
    setEditNotes(s.notes ?? '')
    setError('')
  }

  const submitEdit = async () => {
    if (!editingId || !editIdentifier.trim()) { setError('Identifier is required.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/competitors/${competitorId}/sources`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          identifier: editIdentifier.trim(),
          url: editUrl.trim() || null,
          notes: editNotes.trim() || null,
          is_primary: editIsPrimary,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.error ?? 'Failed to update alias')
        return
      }
      setEditingId(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (sourceId: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/competitors/${competitorId}/sources?sourceId=${sourceId}`, { method: 'DELETE' })
      if (res.ok) await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SectionHeader
        title="Data Source Aliases"
        sub="A competitor can map to multiple provider names — e.g. Hustle SG has two MySkillsFuture entities."
      />
      {loading ? (
        <p className="text-xs text-slate-600 flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading aliases…</p>
      ) : (
        <div className="space-y-3">
          {error && <p className="text-xs text-red-400 font-mono">✗ {error}</p>}

          {grouped.map(g => (
            <div key={g.type} className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-300">{SOURCE_TYPE_LABELS[g.type]}</p>
                {adding !== g.type && (
                  <button
                    type="button"
                    onClick={() => startAdd(g.type)}
                    className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-mono uppercase"
                  >
                    <Plus className="h-3 w-3" /> Add alias
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {g.rows.map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-900/50 rounded px-2 py-1.5">
                    {editingId === s.id ? (
                      <>
                        <input className={`${INPUT} py-1`} value={editIdentifier} onChange={e => setEditIdentifier(e.target.value)} placeholder="Identifier" />
                        <input className={`${INPUT} py-1`} value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL (optional)" />
                        <input className={`${INPUT} py-1`} value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes (optional)" />
                        <label className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                          <input type="checkbox" checked={editIsPrimary} onChange={e => setEditIsPrimary(e.target.checked)} /> primary
                        </label>
                        <button type="button" disabled={busy} onClick={submitEdit} className="p-1 text-emerald-400 hover:text-emerald-300 shrink-0"><Check className="h-3.5 w-3.5" /></button>
                        <button type="button" disabled={busy} onClick={() => setEditingId(null)} className="p-1 text-slate-500 hover:text-white shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-200 flex-1 truncate" title={s.identifier}>{s.identifier}</span>
                        {s.is_primary && <span className="text-[9px] text-indigo-400 font-mono uppercase shrink-0">primary</span>}
                        {s.notes && <span className="text-[10px] text-slate-500 shrink-0 truncate max-w-[100px]" title={s.notes}>{s.notes}</span>}
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:text-sky-400 text-[10px] shrink-0 truncate max-w-[100px]">
                            link
                          </a>
                        )}
                        <button type="button" disabled={busy} onClick={() => startEdit(s)} className="p-1 text-slate-500 hover:text-indigo-400 shrink-0"><Pencil className="h-3 w-3" /></button>
                        <button type="button" disabled={busy} onClick={() => remove(s.id)} className="p-1 text-slate-500 hover:text-red-400 shrink-0"><Trash2 className="h-3 w-3" /></button>
                      </>
                    )}
                  </div>
                ))}

                {adding === g.type && (
                  <div className="flex items-center gap-2 text-xs bg-slate-900/50 rounded px-2 py-1.5">
                    <input className={`${INPUT} py-1`} value={newIdentifier} onChange={e => setNewIdentifier(e.target.value)} placeholder="Identifier (required)" autoFocus />
                    <input className={`${INPUT} py-1`} value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="URL (optional)" />
                    <input className={`${INPUT} py-1`} value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Notes (optional)" />
                    <label className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                      <input type="checkbox" checked={newIsPrimary} onChange={e => setNewIsPrimary(e.target.checked)} /> primary
                    </label>
                    <button type="button" disabled={busy} onClick={submitAdd} className="p-1 text-emerald-400 hover:text-emerald-300 shrink-0"><Check className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={busy} onClick={() => setAdding(null)} className="p-1 text-slate-500 hover:text-white shrink-0"><X className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Add a brand-new source type not yet represented */}
          <div>
            <select
              className={INPUT}
              value=""
              onChange={e => { if (e.target.value) startAdd(e.target.value as CompetitorDataSourceType) }}
            >
              <option value="">+ Add alias for another source type…</option>
              {SOURCE_TYPES.filter(t => !grouped.some(g => g.type === t)).map(t => (
                <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </>
  )
}

export function CompetitorModal({
  competitor,
  onClose,
  onSave,
}: {
  competitor: Competitor | null
  onClose: () => void
  onSave: (data: Partial<Competitor>) => Promise<void>
}) {
  const isEdit = !!competitor

  const [form, setForm] = useState<Partial<Competitor>>(
    competitor ?? {
      name: '', short_name: '', website: '', country: 'Singapore',
      industry: 'Training & Education', color: '#6366f1', tier: 'Mid',
      notes: '', display_order: 99,
      facebook_url: '', instagram_url: '', linkedin_company_slug: '',
      tiktok_url: '', youtube_url: '', threads_url: '', twitter_url: '',
      google_business_name: '', review_url: '', meta_ads_page: '',
      google_ads_domain: '',
      myskillsfuture_provider_name: '', mycareersfuture_name: '',
      meta_ads_count: 0, google_ads_est: 0,
      google_rating: undefined, google_review_count: undefined,
      track_courses: true, track_hiring: true, track_marketing: true,
      track_social: true, track_seo: true, include_in_opportunity_engine: true,
    }
  )

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const set = (k: keyof Competitor, v: string | number | boolean | null) =>
    setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name?.trim()) { setError('Name is required.'); return }
    setError('')
    setSaving(true)
    try {
      await onSave(form)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#09090f] border border-slate-800 rounded-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <p className="text-white font-semibold">{isEdit ? `Edit ${competitor.name}` : 'Add Competitor'}</p>
            <p className="text-xs text-slate-500 mt-0.5">All fields optional except Name. Changes appear on dashboards instantly.</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

            {/* ── Section 1: Basic Info ── */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Company Name *">
                <input className={INPUT} value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="e.g. ASK Training" required />
              </Field>
              <Field label="Short Name">
                <input className={INPUT} value={form.short_name ?? ''} onChange={e => set('short_name', e.target.value)} placeholder="e.g. ASK" />
              </Field>
              <Field label="Website">
                <input className={INPUT} type="url" value={form.website ?? ''} onChange={e => set('website', e.target.value)} placeholder="https://example.com" />
              </Field>
              <Field label="Display Order">
                <input className={INPUT} type="number" value={form.display_order ?? 99} onChange={e => set('display_order', parseInt(e.target.value) || 99)} />
              </Field>
              <Field label="Country">
                <input className={INPUT} value={form.country ?? ''} onChange={e => set('country', e.target.value)} placeholder="Singapore" />
              </Field>
              <Field label="Industry">
                <input className={INPUT} value={form.industry ?? ''} onChange={e => set('industry', e.target.value)} placeholder="Training & Education" />
              </Field>
              <Field label="Tier">
                <select className={INPUT} value={form.tier ?? 'Mid'} onChange={e => set('tier', e.target.value)}>
                  <option value="High">High</option>
                  <option value="Mid">Mid</option>
                  <option value="Low">Low</option>
                </select>
              </Field>
              <Field label="Theme Color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color ?? '#6366f1'}
                    onChange={e => set('color', e.target.value)}
                    className="h-9 w-12 rounded-lg border border-slate-700 bg-slate-800 cursor-pointer p-0.5"
                  />
                  <input className={`${INPUT} flex-1`} value={form.color ?? ''} onChange={e => set('color', e.target.value)} placeholder="#6366f1" />
                </div>
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={`${INPUT} resize-none`} rows={2} value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Internal notes…" />
            </Field>

            {/* ── Section 2: Social Media ── */}
            <SectionHeader title="Social Media" sub="URLs for social profile linking across all intel modules" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Facebook URL">
                <input className={INPUT} type="url" value={form.facebook_url ?? ''} onChange={e => set('facebook_url', e.target.value)} placeholder="https://facebook.com/…" />
              </Field>
              <Field label="Instagram URL">
                <input className={INPUT} type="url" value={form.instagram_url ?? ''} onChange={e => set('instagram_url', e.target.value)} placeholder="https://instagram.com/…" />
              </Field>
              <Field label="LinkedIn Company Slug">
                <input className={INPUT} value={form.linkedin_company_slug ?? ''} onChange={e => set('linkedin_company_slug', e.target.value)} placeholder="ask-training" />
              </Field>
              <Field label="TikTok URL">
                <input className={INPUT} type="url" value={form.tiktok_url ?? ''} onChange={e => set('tiktok_url', e.target.value)} placeholder="https://tiktok.com/@…" />
              </Field>
              <Field label="YouTube URL">
                <input className={INPUT} type="url" value={form.youtube_url ?? ''} onChange={e => set('youtube_url', e.target.value)} placeholder="https://youtube.com/@…" />
              </Field>
              <Field label="Threads URL">
                <input className={INPUT} type="url" value={form.threads_url ?? ''} onChange={e => set('threads_url', e.target.value)} placeholder="https://threads.net/…" />
              </Field>
              <Field label="Twitter / X URL">
                <input className={INPUT} type="url" value={form.twitter_url ?? ''} onChange={e => set('twitter_url', e.target.value)} placeholder="https://x.com/…" />
              </Field>
            </div>

            {/* ── Section 3: Intelligence Links ── */}
            <SectionHeader title="Intelligence Links" sub="Source URLs used in the Ads Performance Intel module" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Google Business Name">
                <input className={INPUT} value={form.google_business_name ?? ''} onChange={e => set('google_business_name', e.target.value)} placeholder="e.g. ASK Training Singapore" />
              </Field>
              <Field label="Google Review URL">
                <input className={INPUT} type="url" value={form.review_url ?? ''} onChange={e => set('review_url', e.target.value)} placeholder="https://google.com/maps/…" />
              </Field>
              <Field label="Meta Ads Library URL">
                <input className={INPUT} type="url" value={form.meta_ads_page ?? ''} onChange={e => set('meta_ads_page', e.target.value)} placeholder="https://facebook.com/ads/library/…" />
              </Field>
              <Field label="Google Ads Domain">
                <input className={INPUT} value={form.google_ads_domain ?? ''} onChange={e => set('google_ads_domain', e.target.value)} placeholder="asktraining.com.sg" />
              </Field>
            </div>

            {/* ── Section 4: Platform Integration ── */}
            <SectionHeader title="Platform Integration" sub="Exact names used in government portals for automatic matching" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="MySF Provider Name (exact)">
                <input className={INPUT} value={form.myskillsfuture_provider_name ?? ''} onChange={e => set('myskillsfuture_provider_name', e.target.value)} placeholder="@ASK TRAINING PTE. LTD." />
              </Field>
              <Field label="MyCareersFuture Employer Name">
                <input className={INPUT} value={form.mycareersfuture_name ?? ''} onChange={e => set('mycareersfuture_name', e.target.value)} placeholder="ASK Training" />
              </Field>
            </div>
            <p className="text-[10px] text-slate-600">
              This single MySF field is kept for backwards compatibility. For competitors with multiple provider
              entities (e.g. Hustle SG), use the Data Source Aliases section below as the authoritative source.
            </p>

            {/* ── Section 5: Ads & Reviews Data ── */}
            <SectionHeader title="Ads & Reviews Data" sub="Manually verified figures — update after each audit" />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Meta Ads Count">
                <input className={INPUT} type="number" min={0} value={form.meta_ads_count ?? 0} onChange={e => set('meta_ads_count', parseInt(e.target.value) || 0)} />
              </Field>
              <Field label="Google Ads (estimated)">
                <input className={INPUT} type="number" min={0} value={form.google_ads_est ?? 0} onChange={e => set('google_ads_est', parseInt(e.target.value) || 0)} />
              </Field>
              <Field label="Google Rating">
                <input className={INPUT} type="number" min={0} max={5} step={0.1} value={form.google_rating ?? ''} onChange={e => set('google_rating', parseFloat(e.target.value) || 0)} placeholder="4.8" />
              </Field>
              <Field label="Google Review Count">
                <input className={INPUT} type="number" min={0} value={form.google_review_count ?? ''} onChange={e => set('google_review_count', parseInt(e.target.value) || 0)} placeholder="1478" />
              </Field>
            </div>

            {/* ── Section 6: Module Tracking ── */}
            <SectionHeader title="Module Tracking" sub="Control which refresh pipelines and modules include this competitor" />
            <div className="grid grid-cols-2 gap-3">
              <Toggle label="Track Courses (SkillsFuture)" checked={form.track_courses ?? true} onChange={v => set('track_courses', v)} />
              <Toggle label="Track Hiring" checked={form.track_hiring ?? true} onChange={v => set('track_hiring', v)} />
              <Toggle label="Track Marketing" checked={form.track_marketing ?? true} onChange={v => set('track_marketing', v)} />
              <Toggle label="Track Social" checked={form.track_social ?? true} onChange={v => set('track_social', v)} />
              <Toggle label="Track SEO" checked={form.track_seo ?? true} onChange={v => set('track_seo', v)} />
              <Toggle label="Include in Opportunity Engine" checked={form.include_in_opportunity_engine ?? true} onChange={v => set('include_in_opportunity_engine', v)} />
            </div>

            {/* ── Section 7: Data Source Aliases (edit mode only) ── */}
            {isEdit && competitor?.id && (
              <DataSourceAliasesSection competitorId={competitor.id} />
            )}

          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-800 shrink-0">
            {error && (
              <p className="text-xs text-red-400 font-mono mb-3">✗ {error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg border border-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Competitor'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
