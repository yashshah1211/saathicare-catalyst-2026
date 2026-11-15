'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Bell, CalendarDays, Check, ChevronRight, CircleCheck, Clock3, LayoutGrid, ListChecks, Pill, Plus, Sparkles, TriangleAlert, Type, Users } from 'lucide-react'
import type { Activity, DashboardData, Dose, DoseAction, Handoff } from '@/lib/model'
import { clockTime, dayLabel, localDay, MAX_SNOOZES, MINUTE } from '@/lib/time'
import { CirclePanel, RoutinePanel } from './manage'

type View = 'today' | 'routine' | 'circle' | 'handoff'
const views = [
  { key: 'today', label: 'Today', icon: LayoutGrid },
  { key: 'routine', label: 'My routine', icon: ListChecks },
  { key: 'circle', label: 'Care circle', icon: Users },
  { key: 'handoff', label: 'Care handoff', icon: Sparkles },
] as const

const captions: Record<Activity['kind'], string> = {
  taken: 'Marked taken', snoozed: 'Reminder postponed', skipped: 'Marked skipped', missed: 'Missed check-in',
  appointment: 'Upcoming appointment', acknowledged: 'Caregiver acknowledged alert',
}

export type Mutate = <T = unknown>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, message?: string) => Promise<T | undefined>

interface Props {
  data: DashboardData
  now: number
  demo?: boolean
  ready?: boolean
  onDose: (dose: Dose, action: DoseAction) => void
  onAcknowledge: (id: string) => void
  onHandoff: () => Promise<Handoff | undefined>
  mutate?: Mutate
  busy?: boolean
  notice?: string
  error?: string
  large: boolean
  setLarge: (large: boolean) => void
}

function Timeline({ items, timezone }: { items: Activity[]; timezone: string }) {
  if (!items.length) return <p className="muted small">Check-ins will appear here when they are recorded.</p>
  return <ol className="timeline">{items.map((item) => <li key={item.id}>
    <span className={`timeline-icon ${item.kind === 'missed' ? 'warn' : 'success'}`}>
      {item.kind === 'missed' ? <TriangleAlert size={16} aria-hidden /> : item.kind === 'snoozed' ? <Clock3 size={16} aria-hidden /> : <Check size={16} aria-hidden />}
    </span>
    <div><strong>{captions[item.kind]}</strong><p>{item.label}</p><time dateTime={new Date(item.at).toISOString()}>{dayLabel(item.at, timezone)} · {clockTime(item.at, timezone)}</time></div>
  </li>)}</ol>
}

function DoseCard({ record, timezone, now, canEdit, busy, onDose }: { record: Dose; timezone: string; now: number; canEdit: boolean; busy?: boolean; onDose: Props['onDose'] }) {
  const active = canEdit && (record.status === 'missed' || (record.status === 'pending' && now >= record.activeAt - 10 * MINUTE) || (record.status === 'snoozed' && now >= record.activeAt))
  const label = record.status === 'pending' ? (now >= record.activeAt - 10 * MINUTE ? 'Due now' : 'Upcoming')
    : { taken: 'Taken', skipped: 'Skipped', snoozed: 'Remind me later', missed: 'Missed check-in' }[record.status]
  const tone = record.status === 'taken' ? 'success' : record.status === 'missed' || label === 'Due now' ? 'warn' : 'neutral'
  const carryOver = localDay(record.dueAt, timezone) !== localDay(now, timezone)
  return <li className={`dose-card ${active ? 'dose-active' : ''}`}>
    <div className="dose-head">
      <span className={`icon-tile ${tone}`}>{record.status === 'taken' ? <CircleCheck size={24} aria-hidden /> : <Pill size={23} aria-hidden />}</span>
      <div className="grow"><h3>{record.medicationName}</h3><p className="muted">{carryOver && `${dayLabel(record.dueAt, timezone)} at `}{clockTime(record.dueAt, timezone)}{record.instructions && ` · ${record.instructions}`}</p>
        {record.status === 'snoozed' && <p className="muted small">Reminder at {clockTime(record.activeAt, timezone)}</p>}</div>
      <span className={`status ${tone}`}>{label}</span>
    </div>
    {active && <div className="dose-actions">
      <button className="button button-primary" disabled={busy} onClick={() => onDose(record, 'taken')}><Check size={19} aria-hidden /> Taken</button>
      {record.status !== 'missed' && record.snoozes < MAX_SNOOZES && <button className="button button-outline" disabled={busy} onClick={() => onDose(record, 'snoozed')}><Clock3 size={18} aria-hidden /> Remind me later</button>}
      <button className="button button-quiet" disabled={busy} onClick={() => onDose(record, 'skipped')}>Skip</button>
    </div>}
  </li>
}

export function Dashboard({ data, now, demo, ready = true, onDose, onAcknowledge, onHandoff, mutate, busy, notice, error, large, setLarge }: Props) {
  const [view, setView] = useState<View>('today')
  const [summary, setSummary] = useState<Handoff>()
  const [loadingSummary, setLoadingSummary] = useState(false)
  const { profile, role, doses, appointments, activity } = data
  const next = appointments[0]
  const taken = doses.filter((dose) => dose.status === 'taken').length
  const first = profile.name.split(' ')[0]

  async function buildSummary() {
    setView('handoff')
    setLoadingSummary(true)
    try { setSummary(await onHandoff()) } finally { setLoadingSummary(false) }
  }

  return <div className={`dashboard ${large ? 'text-large' : ''}`} aria-busy={!ready}>
    <aside className="rail" aria-label="Care dashboard">
      <div className="rail-profile"><span className="avatar" aria-hidden>{profile.name.charAt(0).toUpperCase()}</span><div><strong>{profile.name}</strong><span>{role === 'owner' ? 'Your care profile' : role === 'editor' ? 'Caregiver access' : 'View-only access'}</span></div></div>
      <nav aria-label="Care navigation">{views.map(({ key, label, icon: Icon }) => <button disabled={!ready} className={view === key ? 'rail-active' : ''} aria-current={view === key ? 'page' : undefined} key={key} onClick={() => setView(key)}><Icon size={20} aria-hidden /> {key === 'routine' && role !== 'owner' ? 'Shared routine' : label}<ChevronRight className="rail-chevron" size={14} aria-hidden /></button>)}</nav>
      <button disabled={!ready} className="button button-outline large-toggle" aria-pressed={large} onClick={() => setLarge(!large)}><Type size={19} aria-hidden /> {large ? 'Standard text' : 'Larger text'}</button>
    </aside>
    <main id="main" className="dashboard-main">
      {error && <p className="banner warn" role="alert">{error}</p>}
      <div className="sr-only" role="status" aria-live="polite">{notice ?? ''}</div>
      {notice && <p className="banner success" aria-hidden>{notice}</p>}
      {view === 'today' && <>
        <div className="section-heading"><div><p className="muted date-heading">{dayLabel(now, profile.timezone)}</p><h1>{role === 'owner' ? `Hello, ${first}.` : `${first}’s care today`}</h1><p className="muted">{role === 'owner' ? 'Here’s your care routine for today.' : 'See the shared routine and recent check-ins.'}</p></div>
          <span className="status neutral"><Clock3 size={15} aria-hidden /> {profile.timezone.replaceAll('_', ' ')}</span></div>
        <div className="dashboard-columns">
          <section aria-labelledby="medications-today">
            <div className="progress-card">
              <div><h2 id="medications-today">Today’s medications</h2><p>{taken} of {doses.length} marked taken</p></div>
              <div className="progress-track" role="progressbar" aria-label="Medications taken" aria-valuemin={0} aria-valuemax={doses.length || 1} aria-valuenow={taken}><span style={{ width: `${doses.length ? taken / doses.length * 100 : 0}%` }} /></div>
            </div>
            {doses.length ? <ul className="dose-list">{doses.map((record) => <DoseCard key={record.id} record={record} now={now} timezone={profile.timezone} canEdit={role !== 'viewer'} onDose={onDose} busy={busy || !ready} />)}</ul>
              : <div className="panel empty"><Pill size={26} aria-hidden /><p>No medication check-ins scheduled for today.</p>{role !== 'viewer' && <button className="button button-outline" onClick={() => setView('routine')}><Plus size={17} aria-hidden /> Manage routine</button>}</div>}
          </section>
          <div className="stack">
            <section className="panel" aria-labelledby="next-visit"><h2 className="panel-heading" id="next-visit"><CalendarDays size={22} aria-hidden /> Next appointment</h2>
              {next ? <><h3>{next.title}</h3><p className="muted">{dayLabel(next.startsAt, next.timezone)} at {clockTime(next.startsAt, next.timezone)}</p><p className="muted">{next.location}</p><button disabled={!ready} className="button button-text" onClick={() => setView('routine')}>View appointment <ArrowRight size={17} aria-hidden /></button></>
                : <p className="muted">No upcoming appointments.</p>}
            </section>
            <section className="panel" aria-labelledby="recent-activity"><h2 className="panel-heading" id="recent-activity"><ListChecks size={22} aria-hidden /> Recent activity</h2><Timeline items={activity.slice(0, 4)} timezone={profile.timezone} /></section>
            <button disabled={!ready} className="button button-outline handoff-shortcut" onClick={buildSummary}><Sparkles size={19} aria-hidden /> Open care summary <ArrowRight size={17} aria-hidden /></button>
          </div>
        </div>
      </>}
      {view === 'routine' && <><div className="section-heading"><div><h1>{role === 'owner' ? 'My routine' : 'Shared routine'}</h1><p className="muted">Medications and upcoming doctor visits.</p></div></div><RoutinePanel data={data} mutate={mutate} busy={busy} /></>}
      {view === 'circle' && <>
        <div className="section-heading"><div><h1>Care circle</h1><p className="muted">Manage shared access and missed check-in alerts.</p></div></div>
        <div className="stack">
          <CirclePanel data={data} mutate={mutate} busy={busy} />
          {(!demo || role !== 'owner') && <section className="panel"><h2 className="panel-heading"><Bell size={21} aria-hidden /> Notifications</h2>
            {!data.notifications.length && <p className="muted">No alerts yet.</p>}
            <ul className="item-list">{data.notifications.map((n) => <li key={n.id}><div><strong>{n.kind === 'missed' ? 'Missed check-in' : n.kind === 'dose' ? 'Medication reminder' : 'Appointment reminder'}</strong><p className="muted">{n.label} · {dayLabel(n.at, profile.timezone)}</p><p className="small muted">{demo ? 'Simulated alert' : { queued: 'Email queued', sent: 'Accepted by email provider', failed: 'Email could not be sent', canceled: 'Email canceled', uncertain: 'Email delivery unconfirmed' }[n.status]}</p></div>
              {n.kind === 'missed' && (n.acknowledgedAt ? <span className="status success">Acknowledged</span> : <button className="button button-outline" disabled={busy} onClick={() => onAcknowledge(n.id)}>Acknowledge</button>)}</li>)}</ul>
          </section>}
        </div>
      </>}
      {view === 'handoff' && <>
        <div className="section-heading"><div><h1>Care handoff</h1><p className="muted">Recent check-ins and the next appointment, with sources you can verify.</p></div></div>
        <section className="panel summary-panel" aria-labelledby="summary-title">
          <div className="row between wrap"><h2 className="panel-heading" id="summary-title"><Sparkles size={23} aria-hidden /> Care summary</h2><button className="button button-outline" disabled={loadingSummary} onClick={buildSummary}>{summary ? 'Refresh summary' : 'Build summary'}</button></div>
          {loadingSummary ? <p role="status" className="muted">Preparing your summary…</p> : summary ? <>
            <p className="small muted">{summary.mode === 'gemini' ? 'Gemini selected these source records. Event details come from your care circle.' : 'Record-based summary. No AI was used.'}</p>
            {!summary.items.length && <p className="muted">No recent check-ins or upcoming appointment to summarize.</p>}
            <ol className="summary-list">{summary.items.map((item) => <li key={item.id}><div><strong>{captions[item.kind]} · {item.label}</strong><p className="muted small">{dayLabel(item.at, profile.timezone)} at {clockTime(item.at, profile.timezone)}</p></div>
              <details><summary>View source</summary><p className="small muted">{item.kind === 'appointment' ? 'Appointment' : 'Activity event'} ID <code>{item.id}</code></p></details></li>)}</ol>
          </> : <p className="muted">Build a summary to review the recorded events together.</p>}
        </section>
        <section className="panel full-timeline" aria-labelledby="all-activity"><h2 className="panel-heading" id="all-activity"><ListChecks size={22} aria-hidden /> Activity timeline</h2><Timeline items={activity} timezone={profile.timezone} /></section>
      </>}
      {demo && <footer className="dashboard-footer"><span>Fictional demo data · No emails sent</span><Link href="/care?mode=register">Create your care circle <ArrowRight size={16} aria-hidden /></Link></footer>}
    </main>
  </div>
}
