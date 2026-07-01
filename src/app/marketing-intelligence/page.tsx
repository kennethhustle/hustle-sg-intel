/**
 * Performance Intelligence — CEO & Growth Team Dashboard
 *
 * Data sources:
 * - Meta Ads: Meta Ad Library API (auto-refreshed 4 AM SGT daily)
 * - Google Reviews/Ratings: Google Places API (auto-refreshed 4 AM SGT daily)
 * - Google Ads: Estimated from Google Ads Transparency (manually updated)
 * - SF Runs & Respondents: Supabase sf_courses table (live)
 */

import type { ReactNode } from 'react'
import { AppLayout } from '@/components/layout/app-layout'
import { createClient } from '@/lib/supabase/server'
import { RefreshStatus } from '@/components/marketing/refresh-status'
import type { RefreshLog } from '@/components/marketing/refresh-status'

export const revalidate = 300

type ThreatLevel = 'VERY HIGH' | 'HIGH' | 'MEDIUM' | 'LOW'

interface Competitor {
  name: string; color: string; isHustle?: boolean
  metaAds: number; googleAds: number; googleRating: number; googleReviews: number
  sfRuns: number; sfRespondents: number
  reviewUrl: string; metaAdsUrl: string; googleAdsUrl: string; sfUrl: string
  threatScore?: number; threatLevel?: ThreatLevel
  metaRank?: number; reviewRank?: number; googleAdsRank?: number
}

function computeScores(data: Competitor[]): Competitor[] {
  const maxReviews = Math.max(...data.map(c => c.googleReviews))
  const maxGoogleAds = Math.max(...data.map(c => c.googleAds))
  const maxMetaAds = Math.max(...data.map(c => c.metaAds))
  const maxRespondents = Math.max(...data.map(c => c.sfRespondents))
  const maxRuns = Math.max(...data.map(c => c.sfRuns))
  const scored = data.map(c => {
    const score = (c.googleReviews/maxReviews)*20 + (c.googleAds/maxGoogleAds)*25 + (c.metaAds/maxMetaAds)*25 + (c.sfRespondents/maxRespondents)*20 + (c.sfRuns/maxRuns)*10
    const threatLevel: ThreatLevel = score>=60?'VERY HIGH':score>=35?'HIGH':score>=18?'MEDIUM':'LOW'
    return { ...c, threatScore: Math.round(score*10)/10, threatLevel }
  })
  const byMeta=[...scored].sort((a,b)=>b.metaAds-a.metaAds)
  const byReviews=[...scored].sort((a,b)=>b.googleReviews-a.googleReviews)
  const byGoogleAds=[...scored].sort((a,b)=>b.googleAds-a.googleAds)
  return scored.map(c=>({...c, metaRank:byMeta.findIndex(x=>x.name===c.name)+1, reviewRank:byReviews.findIndex(x=>x.name===c.name)+1, googleAdsRank:byGoogleAds.findIndex(x=>x.name===c.name)+1}))
}

const THREAT_STYLE: Record<ThreatLevel, { badge: string; bar: string; dot: string }> = {
  'VERY HIGH': { badge:'bg-red-950/70 text-red-400 border-red-800/60', bar:'bg-red-500', dot:'bg-red-500' },
  'HIGH':      { badge:'bg-orange-950/60 text-orange-400 border-orange-800/60', bar:'bg-orange-500', dot:'bg-orange-500' },
  'MEDIUM':    { badge:'bg-yellow-950/50 text-yellow-400 border-yellow-800/50', bar:'bg-yellow-500', dot:'bg-yellow-500' },
  'LOW':       { badge:'bg-slate-800 text-slate-400 border-slate-700', bar:'bg-slate-500', dot:'bg-slate-500' },
}

function Section({ children, className='' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-slate-900/50 border border-slate-800 rounded-xl p-5 ${className}`}>{children}</div>
}
function H2({ children, sub }: { children: ReactNode; sub?: string }) {
  return <div className="mb-4"><h2 className="text-base font-bold text-white tracking-tight">{children}</h2>{sub&&<p className="text-xs text-slate-500 mt-0.5">{sub}</p>}</div>
}
function Rank({ n }: { n: number }) {
  return <span className={`font-mono font-bold text-sm ${n===1?'text-yellow-400':n<=3?'text-white':'text-slate-400'}`}>#{n}</span>
}
function ThreatBadge({ level }: { level: ThreatLevel }) {
  const s=THREAT_STYLE[level]
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide border ${s.badge}`}>{level}</span>
}
function buildRecommendation(h: Competitor, topGoogleAds: Competitor): string[] {
  const recs: string[]=[]
  if((h.reviewRank??10)>5) recs.push(`Google Reviews rank #${h.reviewRank} — run a post-course review campaign to move into top 5.`)
  if((h.googleAdsRank??10)>5) recs.push(`Google Ads rank #${h.googleAdsRank} — increase Google search ad spend; ${topGoogleAds.name} outspends by ${topGoogleAds.googleAds-h.googleAds} ads.`)
  if((h.metaRank??10)>3) recs.push(`Meta Ads rank #${h.metaRank} — at ${h.metaAds} active ads, there is room to increase social ad volume.`)
  recs.push(`Maintain ${h.sfRuns} upcoming SF runs to stay top 3 in market capacity.`)
  return recs.slice(0,2)
}

async function getData() {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('competitors')
    .select(`id, name, color, is_hustle, competitor_marketing_data (google_reviews, google_rating, google_ads, meta_ads, sf_runs, sf_respondents, review_url, meta_ads_url, google_ads_url, sf_url)`)
    .eq('active', true).order('name')
  const { data: logs } = await supabase
    .from('data_refresh_logs')
    .select('id, started_at, completed_at, status, duration_seconds, records_updated, error_message, triggered_by')
    .eq('module', 'marketing').order('started_at', { ascending: false }).limit(10)
  const latestLog: RefreshLog | null = (logs?.[0] as RefreshLog) ?? null
  const lastSuccessfulLog: RefreshLog | null = (logs?.find(l => l.status==='success'||l.status==='partial') as RefreshLog) ?? null
  type MktRow = { google_reviews:number|null; google_rating:number|null; google_ads:number|null; meta_ads:number|null; sf_runs:number|null; sf_respondents:number|null; review_url:string|null; meta_ads_url:string|null; google_ads_url:string|null; sf_url:string|null }
  type CompRow = { id:string; name:string; color:string; is_hustle:boolean; competitor_marketing_data: MktRow|MktRow[]|null }
  const mapped: Competitor[] = ((rows??[]) as CompRow[]).map(r => {
    const mkt = Array.isArray(r.competitor_marketing_data) ? r.competitor_marketing_data[0] : r.competitor_marketing_data
    return { name:r.name, color:r.color??'#6366f1', isHustle:r.is_hustle, metaAds:mkt?.meta_ads??0, googleAds:mkt?.google_ads??0, googleRating:mkt?.google_rating??0, googleReviews:mkt?.google_reviews??0, sfRuns:mkt?.sf_runs??0, sfRespondents:mkt?.sf_respondents??0, reviewUrl:mkt?.review_url??'#', metaAdsUrl:mkt?.meta_ads_url??'#', googleAdsUrl:mkt?.google_ads_url??'#', sfUrl:mkt?.sf_url??'#' }
  })
  return { competitors: mapped, latestLog, lastSuccessfulLog }
}

export default async function PerformanceIntelligencePage() {
  const { competitors: RAW_DATA, latestLog, lastSuccessfulLog } = await getData()
  const COMPETITORS = computeScores(RAW_DATA.length>0?RAW_DATA:[])
  const sorted_threat=[...COMPETITORS].sort((a,b)=>(b.threatScore??0)-(a.threatScore??0))
  const sorted_meta=[...COMPETITORS].sort((a,b)=>b.metaAds-a.metaAds)
  const sorted_reviews=[...COMPETITORS].sort((a,b)=>b.googleReviews-a.googleReviews)
  const sorted_googleAds=[...COMPETITORS].sort((a,b)=>b.googleAds-a.googleAds)
  const topMetaBuyer=sorted_meta[0], topGoogleAds=sorted_googleAds[0], topReviews=sorted_reviews[0]
  const hustle=COMPETITORS.find(c=>c.isHustle)
  const hustleThreatRank=sorted_threat.findIndex(c=>c.isHustle)+1
  const RECOMMENDATIONS=hustle?buildRecommendation(hustle,topGoogleAds):[]
  const ALERTS=hustle&&topReviews?[
    { severity:'critical', text:`${sorted_reviews[0].name} has ${sorted_reviews[0].googleReviews.toLocaleString()} Google reviews — ${Math.round(sorted_reviews[0].googleReviews/(hustle.googleReviews||1))}× Hustle's ${hustle.googleReviews.toLocaleString()}.`, sub:'Dominant social proof. Hustle needs an urgent, sustained review campaign to close this gap.' },
    { severity:'critical', text:`${sorted_meta[0].metaAds===sorted_meta[1].metaAds?`${sorted_meta[0].name} + ${sorted_meta[1].name} each running ${sorted_meta[0].metaAds} active Meta ads`:`${sorted_meta[0].name} running ${sorted_meta[0].metaAds} active Meta ads`} — highest in market.`, sub:'Both focus: AI-Powered Marketing, Finance, HR, Supply Chain training.' },
    { severity:'critical', text:`${[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns)[0].name} has ${[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns)[0].sfRuns} upcoming SF course runs — most scheduled capacity in market.`, sub:'Dominant across both paid demand and SkillsFuture scheduling. Students find them first.' },
    { severity:'high', text:`${sorted_googleAds[0].name} estimated ~${sorted_googleAds[0].googleAds} active Google ads — ${Math.round(sorted_googleAds[0].googleAds/(hustle.googleAds||1))}× Hustle's ~${hustle.googleAds}.`, sub:'Capturing high-intent search traffic across all training categories.' },
    { severity:'high', text:`${sorted_meta[4]?.name??'Top-5 Meta spender'} running ${sorted_meta[4]?.metaAds??'—'} active Meta ads with ${sorted_meta[4]?.googleReviews.toLocaleString()??'—'} Google reviews.`, sub:'Competing head-on in paid social — track their ad creative closely.' },
    { severity:'medium', text:`${sorted_reviews[1].name} has ${sorted_reviews[1].googleReviews.toLocaleString()} Google reviews (${sorted_reviews[1].googleRating} ★) — #2 in market for social proof.`, sub:`Hustle trails by ${(sorted_reviews[1].googleReviews-hustle.googleReviews).toLocaleString()} reviews.` },
  ]:[]

  if(COMPETITORS.length===0) return (
    <AppLayout><div className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center"><div className="text-center space-y-3"><p className="text-white font-bold text-lg">No data yet</p><p className="text-slate-500 text-sm">Run the SQL migration to seed competitor data, then refresh.</p></div></div></AppLayout>
  )

  const maxMeta=sorted_meta[0].metaAds, maxGAds=sorted_googleAds[0].googleAds, maxRev=sorted_reviews[0].googleReviews

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Marketing Intelligence</h1>
            <p className="text-xs text-slate-500 mt-0.5">Who is buying demand · Google presence · Meta advertising · Auto-refreshes 4 AM SGT daily</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/50 border border-emerald-800/50 text-[11px] text-emerald-400 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live Data</span>
            <RefreshStatus latestLog={latestLog} lastSuccessfulLog={lastSuccessfulLog} />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Section><p className="text-[10px] font-bold tracking-widest text-red-400 uppercase mb-3">Top Meta Ad Buyer</p><div className="flex items-center gap-2 mb-1"><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor:topMetaBuyer.color}}/><p className="text-sm font-bold text-white truncate">{topMetaBuyer.name}</p></div><p className="text-3xl font-black text-red-400 mb-0.5">{topMetaBuyer.metaAds}</p><p className="text-xs text-slate-500">active Meta ads</p>{hustle&&<div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-400">Hustle: <span className="text-white font-bold">{hustle.metaAds} ads</span> — rank <span className="text-indigo-400 font-bold">#{hustle.metaRank}</span></div>}</Section>
          <Section><p className="text-[10px] font-bold tracking-widest text-blue-400 uppercase mb-3">Top Google Advertiser</p><div className="flex items-center gap-2 mb-1"><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor:topGoogleAds.color}}/><p className="text-sm font-bold text-white truncate">{topGoogleAds.name}</p></div><p className="text-3xl font-black text-blue-400 mb-0.5">~{topGoogleAds.googleAds}</p><p className="text-xs text-slate-500">estimated Google ads</p>{hustle&&<div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-400">Hustle: <span className="text-white font-bold">~{hustle.googleAds} ads</span> — rank <span className="text-indigo-400 font-bold">#{hustle.googleAdsRank}</span></div>}</Section>
          <Section><p className="text-[10px] font-bold tracking-widest text-yellow-400 uppercase mb-3">Top Google Reviews</p><div className="flex items-center gap-2 mb-1"><div className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor:topReviews.color}}/><p className="text-sm font-bold text-white truncate">{topReviews.name}</p></div><p className="text-3xl font-black text-yellow-400 mb-0.5">{topReviews.googleReviews.toLocaleString()}</p><p className="text-xs text-slate-500">{topReviews.googleRating} ★ Google rating</p>{hustle&&<div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-400">Hustle: <span className="text-white font-bold">{hustle.googleReviews}</span> reviews — rank <span className="text-indigo-400 font-bold">#{hustle.reviewRank}</span></div>}</Section>
          {hustle?(<Section className="border-indigo-800/50 bg-indigo-950/20"><p className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase mb-3">Hustle Position</p><p className="text-3xl font-black text-indigo-400 mb-1">#{hustleThreatRank}</p><p className="text-xs text-slate-500 mb-3">overall threat rank</p><div className="space-y-1.5 text-[11px]"><div className="flex justify-between"><span className="text-slate-500">Meta Ads</span><span className="text-white font-bold">#{hustle.metaRank} of {COMPETITORS.length}</span></div><div className="flex justify-between"><span className="text-slate-500">Google Ads</span><span className="text-white font-bold">#{hustle.googleAdsRank} of {COMPETITORS.length}</span></div><div className="flex justify-between"><span className="text-slate-500">Google Reviews</span><span className="text-orange-400 font-bold">#{hustle.reviewRank} of {COMPETITORS.length}</span></div><div className="flex justify-between"><span className="text-slate-500">Threat Level</span><ThreatBadge level={hustle.threatLevel!}/></div></div></Section>):(<Section><p className="text-slate-500 text-xs">Hustle SG not found in database.</p></Section>)}
        </div>
        <Section>
          <H2 sub="Ranked by threat score. Includes all tracked competitors.">Competitor Performance Table</H2>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-[10px] text-slate-500 font-bold tracking-widest uppercase border-b border-slate-800"><th className="text-left pb-3 pr-4">Competitor</th><th className="text-right pb-3 px-4">Google Rating</th><th className="text-right pb-3 px-4">Google Reviews</th><th className="text-right pb-3 px-4">Google Ads</th><th className="text-right pb-3 px-4">Meta Ads</th><th className="text-right pb-3 pl-4">Threat Level</th></tr></thead>
            <tbody className="divide-y divide-slate-800/60">{sorted_threat.map((c,i)=>(
              <tr key={c.name} className={`${c.isHustle?'bg-indigo-950/20':'hover:bg-slate-800/20'} transition-colors`}>
                <td className="py-3 pr-4"><div className="flex items-center gap-2.5"><span className="text-slate-600 text-xs w-4 shrink-0 font-mono">{i+1}</span><div className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor:c.color}}/><span className={`font-semibold ${c.isHustle?'text-indigo-300':'text-white'}`}>{c.name}{c.isHustle&&<span className="ml-1.5 text-[10px] text-indigo-500 font-normal">YOU</span>}</span></div></td>
                <td className="py-3 px-4 text-right"><a href={c.reviewUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-80"><span className="text-yellow-400 font-bold">{c.googleRating}</span><span className="text-slate-600 text-xs"> ★</span></a></td>
                <td className="py-3 px-4 text-right"><div className="flex items-center justify-end gap-2"><div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden"><div className="h-full bg-yellow-500 rounded-full" style={{width:`${(c.googleReviews/maxRev)*100}%`}}/></div><a href={c.reviewUrl} target="_blank" rel="noopener noreferrer" className="text-white hover:text-yellow-400 font-mono text-xs w-14 text-right transition-colors underline decoration-slate-700 hover:decoration-yellow-400">{c.googleReviews.toLocaleString()}</a></div></td>
                <td className="py-3 px-4 text-right"><div className="flex items-center justify-end gap-2"><div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{width:`${(c.googleAds/maxGAds)*100}%`}}/></div><a href={c.googleAdsUrl} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-blue-400 font-mono text-xs w-10 text-right transition-colors underline decoration-slate-700 hover:decoration-blue-400">~{c.googleAds}</a></div></td>
                <td className="py-3 px-4 text-right"><div className="flex items-center justify-end gap-2"><div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{width:`${(c.metaAds/maxMeta)*100}%`}}/></div><a href={c.metaAdsUrl} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-red-400 font-mono text-xs w-8 text-right transition-colors underline decoration-slate-700 hover:decoration-red-400">{c.metaAds}</a></div></td>
                <td className="py-3 pl-4 text-right"><ThreatBadge level={c.threatLevel!}/></td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="text-[10px] text-slate-600 mt-3">Threat Score = Google Reviews 20% · Google Ads 25% · Meta Ads 25% · SF Attendees 20% · SF Runs 10% · Google Ads estimated via Transparency · Meta Ads live from Ad Library API</p>
        </Section>
        <div className="grid grid-cols-2 gap-4">
          <Section><H2 sub="Top performer in each channel">Market Leaders</H2><div className="space-y-4">{[{icon:'🏆',label:'Most Google Reviews',winner:sorted_reviews[0],value:sorted_reviews[0].googleReviews.toLocaleString(),sub:`${sorted_reviews[0].googleRating} ★ · ${sorted_reviews[1]?.name} trails by ${(sorted_reviews[0].googleReviews-(sorted_reviews[1]?.googleReviews??0)).toLocaleString()}`,color:'text-yellow-400'},{icon:'🏆',label:'Most Meta Ads',winner:sorted_meta[0],value:`${sorted_meta[0].metaAds} ads`,sub:sorted_meta[0].metaAds===sorted_meta[1]?.metaAds?`Tied with ${sorted_meta[1].name} · Both running ${sorted_meta[1].metaAds} active ads`:`#2 ${sorted_meta[1]?.name} running ${sorted_meta[1]?.metaAds??0} active ads`,color:'text-red-400'},{icon:'🏆',label:'Most Google Ads',winner:sorted_googleAds[0],value:`~${sorted_googleAds[0].googleAds} ads`,sub:`${Math.round(sorted_googleAds[0].googleAds/(sorted_googleAds[1]?.googleAds||1))}× more than #2 ${sorted_googleAds[1]?.name}`,color:'text-blue-400'},{icon:'🏆',label:'Most SF Course Runs',winner:[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns)[0],value:`${[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns)[0].sfRuns} runs`,sub:'Dominates SkillsFuture scheduling availability',color:'text-orange-400'}].map(item=>(<div key={item.label} className="flex items-start gap-3"><span className="text-base mt-0.5 shrink-0">{item.icon}</span><div className="flex-1 min-w-0"><p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mb-0.5">{item.label}</p><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor:item.winner.color}}/><span className="text-white font-bold text-sm">{item.winner.name}</span><span className={`font-mono font-black text-sm ${item.color}`}>{item.value}</span></div><p className="text-[11px] text-slate-500 mt-0.5">{item.sub}</p></div></div>))}</div></Section>
          {hustle?(<Section className="border-indigo-800/40 bg-indigo-950/10"><H2 sub="Where Hustle stands — and what to do">Hustle vs Market</H2><div className="space-y-3 mb-5">{[{label:'Google Reviews',hustleVal:`${hustle.googleReviews} reviews`,rank:hustle.reviewRank!,leaderVal:`${sorted_reviews[0].name}: ${sorted_reviews[0].googleReviews.toLocaleString()}`,urgent:hustle.reviewRank!>5},{label:'Meta Ads',hustleVal:`${hustle.metaAds} active`,rank:hustle.metaRank!,leaderVal:`${sorted_meta[0].name}: ${sorted_meta[0].metaAds}`,urgent:hustle.metaRank!>5},{label:'Google Ads',hustleVal:`~${hustle.googleAds} ads`,rank:hustle.googleAdsRank!,leaderVal:`${sorted_googleAds[0].name}: ~${sorted_googleAds[0].googleAds}`,urgent:hustle.googleAdsRank!>5},{label:'SF Course Runs',hustleVal:`${hustle.sfRuns} upcoming`,rank:[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns).findIndex(c=>c.isHustle)+1,leaderVal:`${[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns)[0].name}: ${[...COMPETITORS].sort((a,b)=>b.sfRuns-a.sfRuns)[0].sfRuns}`,urgent:false}].map(row=>(<div key={row.label} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center"><span className="text-slate-500 text-xs w-28 shrink-0">{row.label}</span><div className="flex items-center gap-2"><span className={`text-xs font-bold ${row.urgent?'text-orange-400':'text-white'}`}>{row.hustleVal}</span><span className="text-[10px] text-slate-600 truncate">vs {row.leaderVal}</span></div><Rank n={row.rank}/></div>))}<div className="pt-3 border-t border-slate-800 flex items-center justify-between"><span className="text-slate-500 text-xs">Overall Threat Level</span><ThreatBadge level={hustle.threatLevel!}/></div></div><div className="bg-slate-800/40 rounded-lg p-3 space-y-2"><p className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase">Recommended Actions</p>{RECOMMENDATIONS.map((r,i)=>(<p key={i} className="text-xs text-slate-300 leading-relaxed flex gap-2"><span className="text-indigo-400 shrink-0 font-bold">{i+1}.</span>{r}</p>))}</div></Section>):(<Section><p className="text-slate-500 text-xs">Hustle SG not found in database.</p></Section>)}
        </div>
        {ALERTS.length>0&&(<Section><H2 sub="Signals that require management attention">Growth Alerts</H2><div className="space-y-2">{ALERTS.map((a,i)=>{const styles={critical:{badge:'bg-red-950/60 border-red-800/60 text-red-400',label:'🚨 CRITICAL'},high:{badge:'bg-orange-950/50 border-orange-800/50 text-orange-400',label:'⚠️ HIGH'},medium:{badge:'bg-yellow-950/40 border-yellow-800/40 text-yellow-400',label:'📊 MEDIUM'},low:{badge:'bg-slate-800 border-slate-700 text-slate-400',label:'💡 LOW'}}[a.severity as 'critical'|'high'|'medium'|'low'];return(<div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-800/60 hover:bg-slate-800/50 transition-colors"><span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${styles.badge} shrink-0 mt-0.5`}>{styles.label}</span><div><p className="text-sm text-white font-medium leading-snug">{a.text}</p><p className="text-xs text-slate-500 mt-0.5">{a.sub}</p></div></div>)})}</div></Section>)}
        <div className="text-[10px] text-slate-700 flex flex-wrap gap-4 pb-2">
          <a href="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=SG" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">Meta Ads: Meta Ad Library (auto-refreshed daily)</a>
          <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">Google Reviews: Google Places API (auto-refreshed daily)</a>
          <a href="https://adstransparency.google.com/?region=SG" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">Google Ads: Google Ads Transparency (manually updated)</a>
          {latestLog?.completed_at&&<span>Last refresh: {new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(latestLog.completed_at))} SGT</span>}
        </div>
      </div>
    </AppLayout>
  )
}
