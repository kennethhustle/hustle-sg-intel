'use client'

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { Competitor } from './page'

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
    }
  )

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const set = (k: keyof Competitor, v: string | number | null) =>
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
                  <option value="Primary">Primary</option>
                  <option value="Mid">Mid</option>
                  <option value="Emerging">Emerging</option>
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
