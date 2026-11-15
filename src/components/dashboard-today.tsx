import { ArrowRight, CalendarDays, Check, CircleCheck, Clock3, ListChecks, Pill, Plus, Sparkles } from 'lucide-react'
import type { Appointment, DashboardData, Dose, DoseAction, DoseStatus } from '@/lib/model'
import { clockTime, dayLabel, localDay, MAX_SNOOZES, MINUTE } from '@/lib/time'
import { Timeline } from './dashboard-activity'

const recordedLabels: Record<Exclude<DoseStatus, 'pending'>, string> = {
  taken: 'Taken',
  skipped: 'Skipped',
  snoozed: 'Remind me later',
  missed: 'Missed check-in',
}

interface DoseCardProps {
  record: Dose
  timezone: string
  now: number
  canEdit: boolean
  busy?: boolean
  onDose: (dose: Dose, action: DoseAction) => void
}

function DoseCard({ record, timezone, now, canEdit, busy, onDose }: DoseCardProps) {
  const { status } = record
  const pendingDue = status === 'pending' && now >= record.activeAt - 10 * MINUTE
  const snoozedDue = status === 'snoozed' && now >= record.activeAt
  const missed = status === 'missed'
  const canRespond = canEdit && (pendingDue || snoozedDue || missed)
  const label = status === 'pending' ? (pendingDue ? 'Due now' : 'Upcoming') : recordedLabels[status]
  const tone = status === 'taken' ? 'success' : missed || pendingDue ? 'warn' : 'neutral'
  const Icon = status === 'taken' ? CircleCheck : Pill
  const carryOver = localDay(record.dueAt, timezone) !== localDay(now, timezone)

  return (
    <li className={`dose-card ${canRespond ? 'dose-active' : ''}`}>
      <div className="dose-head">
        <span className={`icon-tile ${tone}`}><Icon size={status === 'taken' ? 24 : 23} aria-hidden /></span>
        <div className="grow">
          <h3>{record.medicationName}</h3>
          <p className="muted">
            {carryOver && `${dayLabel(record.dueAt, timezone)} at `}
            {clockTime(record.dueAt, timezone)}
            {record.instructions && ` · ${record.instructions}`}
          </p>
          {status === 'snoozed' && (
            <p className="muted small">Reminder at {clockTime(record.activeAt, timezone)}</p>
          )}
        </div>
        <span className={`status ${tone}`}>{label}</span>
      </div>
      {canRespond && (
        <div className="dose-actions">
          <button className="button button-primary" disabled={busy} onClick={() => onDose(record, 'taken')}>
            <Check size={19} aria-hidden /> Taken
          </button>
          {!missed && record.snoozes < MAX_SNOOZES && (
            <button className="button button-outline" disabled={busy} onClick={() => onDose(record, 'snoozed')}>
              <Clock3 size={18} aria-hidden /> Remind me later
            </button>
          )}
          <button className="button button-quiet" disabled={busy} onClick={() => onDose(record, 'skipped')}>
            Skip
          </button>
        </div>
      )}
    </li>
  )
}

function NextAppointment({ appointment, ready, onView }: {
  appointment?: Appointment
  ready: boolean
  onView: () => void
}) {
  return (
    <section className="panel" aria-labelledby="next-visit">
      <h2 className="panel-heading" id="next-visit">
        <CalendarDays size={22} aria-hidden /> Next appointment
      </h2>
      {appointment ? (
        <>
          <h3>{appointment.title}</h3>
          <p className="muted">
            {dayLabel(appointment.startsAt, appointment.timezone)} at {clockTime(appointment.startsAt, appointment.timezone)}
          </p>
          <p className="muted">{appointment.location}</p>
          <button disabled={!ready} className="button button-text" onClick={onView}>
            View appointment <ArrowRight size={17} aria-hidden />
          </button>
        </>
      ) : <p className="muted">No upcoming appointments.</p>}
    </section>
  )
}

interface TodayProps {
  data: DashboardData
  now: number
  ready: boolean
  busy?: boolean
  onDose: DoseCardProps['onDose']
  onOpenRoutine: () => void
  onOpenHandoff: () => void
}

export function TodayPanel({ data, now, ready, busy, onDose, onOpenRoutine, onOpenHandoff }: TodayProps) {
  const { profile, role, doses, appointments, activity } = data
  const { timezone } = profile
  const taken = doses.filter((dose) => dose.status === 'taken').length
  const progress = doses.length ? taken / doses.length * 100 : 0
  const first = profile.name.split(' ')[0]
  const owner = role === 'owner'
  const canEdit = role !== 'viewer'

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="muted date-heading">{dayLabel(now, timezone)}</p>
          <h1>{owner ? `Hello, ${first}.` : `${first}’s care today`}</h1>
          <p className="muted">
            {owner ? 'Here’s your care routine for today.' : 'See the shared routine and recent check-ins.'}
          </p>
        </div>
        <span className="status neutral">
          <Clock3 size={15} aria-hidden /> {timezone.replaceAll('_', ' ')}
        </span>
      </div>
      <div className="dashboard-columns">
        <section aria-labelledby="medications-today">
          <div className="progress-card">
            <div>
              <h2 id="medications-today">Today’s medications</h2>
              <p>{taken} of {doses.length} marked taken</p>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Medications taken"
              aria-valuemin={0}
              aria-valuemax={doses.length || 1}
              aria-valuenow={taken}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          {doses.length ? (
            <ul className="dose-list">
              {doses.map((record) => (
                <DoseCard
                  key={record.id}
                  record={record}
                  now={now}
                  timezone={timezone}
                  canEdit={canEdit}
                  onDose={onDose}
                  busy={busy || !ready}
                />
              ))}
            </ul>
          ) : (
            <div className="panel empty">
              <Pill size={26} aria-hidden />
              <p>No medication check-ins scheduled for today.</p>
              {canEdit && (
                <button className="button button-outline" onClick={onOpenRoutine}>
                  <Plus size={17} aria-hidden /> Manage routine
                </button>
              )}
            </div>
          )}
        </section>
        <div className="stack">
          <NextAppointment appointment={appointments[0]} ready={ready} onView={onOpenRoutine} />
          <section className="panel" aria-labelledby="recent-activity">
            <h2 className="panel-heading" id="recent-activity">
              <ListChecks size={22} aria-hidden /> Recent activity
            </h2>
            <Timeline items={activity.slice(0, 4)} timezone={timezone} />
          </section>
          <button disabled={!ready} className="button button-outline handoff-shortcut" onClick={onOpenHandoff}>
            <Sparkles size={19} aria-hidden /> Open care summary <ArrowRight size={17} aria-hidden />
          </button>
        </div>
      </div>
    </>
  )
}
