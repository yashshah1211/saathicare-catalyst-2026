import { Bell, Check, Clock3, ListChecks, Sparkles, TriangleAlert } from 'lucide-react'
import type { Activity, Handoff, Notification } from '@/lib/model'
import { clockTime, dayLabel } from '@/lib/time'

const activityLabels: Record<Activity['kind'], string> = {
  taken: 'Marked taken',
  snoozed: 'Reminder postponed',
  skipped: 'Marked skipped',
  missed: 'Missed check-in',
  appointment: 'Upcoming appointment',
  acknowledged: 'Caregiver acknowledged alert',
}

const notificationLabels: Record<Notification['kind'], string> = {
  missed: 'Missed check-in',
  dose: 'Medication reminder',
  appointment: 'Appointment reminder',
}

const deliveryLabels: Record<Notification['status'], string> = {
  queued: 'Email queued',
  sent: 'Accepted by email provider',
  failed: 'Email could not be sent',
  canceled: 'Email canceled',
  uncertain: 'Email delivery unconfirmed',
}

export function Timeline({ items, timezone }: { items: Activity[]; timezone: string }) {
  if (!items.length) {
    return <p className="muted small">Check-ins will appear here when they are recorded.</p>
  }

  return (
    <ol className="timeline">
      {items.map((item) => {
        const missed = item.kind === 'missed'
        const Icon = missed ? TriangleAlert : item.kind === 'snoozed' ? Clock3 : Check

        return (
          <li key={item.id}>
            <span className={`timeline-icon ${missed ? 'warn' : 'success'}`}>
              <Icon size={16} aria-hidden />
            </span>
            <div>
              <strong>{activityLabels[item.kind]}</strong>
              <p>{item.label}</p>
              <time dateTime={new Date(item.at).toISOString()}>
                {dayLabel(item.at, timezone)} · {clockTime(item.at, timezone)}
              </time>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

interface NotificationsProps {
  items: Notification[]
  timezone: string
  demo?: boolean
  busy?: boolean
  onAcknowledge: (id: string) => void
}

export function NotificationsPanel({ items, timezone, demo, busy, onAcknowledge }: NotificationsProps) {
  return (
    <section className="panel">
      <h2 className="panel-heading"><Bell size={21} aria-hidden /> Notifications</h2>
      {!items.length && <p className="muted">No alerts yet.</p>}
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{notificationLabels[item.kind]}</strong>
              <p className="muted">{item.label} · {dayLabel(item.at, timezone)}</p>
              <p className="small muted">{demo ? 'Simulated alert' : deliveryLabels[item.status]}</p>
            </div>
            {item.kind === 'missed' && (
              item.acknowledgedAt
                ? <span className="status success">Acknowledged</span>
                : (
                  <button
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => onAcknowledge(item.id)}
                  >
                    Acknowledge
                  </button>
                )
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function SummaryContent({ summary, timezone }: { summary: Handoff; timezone: string }) {
  const explanation = summary.mode === 'gemini'
    ? 'Gemini selected these source records. Event details come from your care circle.'
    : 'Record-based summary. No AI was used.'

  return (
    <>
      <p className="small muted">{explanation}</p>
      {!summary.items.length && (
        <p className="muted">No recent check-ins or upcoming appointment to summarize.</p>
      )}
      <ol className="summary-list">
        {summary.items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{activityLabels[item.kind]} · {item.label}</strong>
              <p className="muted small">
                {dayLabel(item.at, timezone)} at {clockTime(item.at, timezone)}
              </p>
            </div>
            <details>
              <summary>View source</summary>
              <p className="small muted">
                {item.kind === 'appointment' ? 'Appointment' : 'Activity event'} ID <code>{item.id}</code>
              </p>
            </details>
          </li>
        ))}
      </ol>
    </>
  )
}

interface HandoffProps {
  activity: Activity[]
  timezone: string
  summary?: Handoff
  loading: boolean
  onBuild: () => void
}

export function HandoffPanel({ activity, timezone, summary, loading, onBuild }: HandoffProps) {
  return (
    <>
      <section className="panel summary-panel" aria-labelledby="summary-title">
        <div className="row between wrap">
          <h2 className="panel-heading" id="summary-title">
            <Sparkles size={23} aria-hidden /> Care summary
          </h2>
          <button className="button button-outline" disabled={loading} onClick={onBuild}>
            {summary ? 'Refresh summary' : 'Build summary'}
          </button>
        </div>
        {loading && <p role="status" className="muted">Preparing your summary…</p>}
        {!loading && summary && <SummaryContent summary={summary} timezone={timezone} />}
        {!loading && !summary && <p className="muted">Build a summary to review the recorded events together.</p>}
      </section>
      <section className="panel full-timeline" aria-labelledby="all-activity">
        <h2 className="panel-heading" id="all-activity">
          <ListChecks size={22} aria-hidden /> Activity timeline
        </h2>
        <Timeline items={activity} timezone={timezone} />
      </section>
    </>
  )
}
