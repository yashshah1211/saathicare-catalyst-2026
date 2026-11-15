'use client'

import { useState, type FormEvent } from 'react'
import { CalendarDays, Copy, Pill, Plus, Settings2, Users, X } from 'lucide-react'
import type { Appointment, DashboardData, Medication } from '@/lib/model'
import { clockTime, dayLabel, toLocalInput } from '@/lib/time'
import type { Mutate } from './dashboard'

interface Props { data: DashboardData; mutate?: Mutate; busy?: boolean }

function text(form: FormData, field: string) { return String(form.get(field) ?? '') }

export function RoutinePanel({ data, mutate, busy }: Props) {
  const [medOpen, setMedOpen] = useState<Medication | 'new'>()
  const [appointmentOpen, setAppointmentOpen] = useState<Appointment | 'new'>()
  const editing = !!mutate && data.role !== 'viewer'
  const med = medOpen === 'new' ? undefined : medOpen
  const appt = appointmentOpen === 'new' ? undefined : appointmentOpen

  async function saveMed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    if (await mutate(med ? `/medications/${med.id}` : '/medications', med ? 'PUT' : 'POST', {
      name: text(form, 'name'), instructions: text(form, 'instructions'), timezone: text(form, 'timezone'),
      times: text(form, 'times').split(',').map((time) => time.trim()),
    }, 'Medication saved.')) setMedOpen(undefined)
  }

  async function saveAppt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    if (await mutate(appt ? `/appointments/${appt.id}` : '/appointments', appt ? 'PUT' : 'POST', {
      title: text(form, 'title'), location: text(form, 'location'), timezone: text(form, 'timezone'), localStart: text(form, 'start'),
    }, 'Appointment saved.')) setAppointmentOpen(undefined)
  }

  return <div className="stack manage-stack">
    <section className="panel">
      <div className="row between wrap"><h2 className="panel-heading"><Pill size={21} aria-hidden /> Medications</h2>{editing && <button className="button button-primary" onClick={() => setMedOpen('new')}><Plus size={18} aria-hidden /> Add medication</button>}</div>
      {medOpen && <form className="form-box" key={med?.id ?? 'new'} onSubmit={saveMed}>
        <h3>{med ? 'Edit medication' : 'Add medication'}</h3>
        <div className="fields">
          <label>Medication name<input name="name" required maxLength={90} defaultValue={med?.name} /></label>
          <label>Schedule timezone<input name="timezone" required maxLength={65} defaultValue={med?.timezone ?? data.profile.timezone} /></label>
          <label>Dose times <span className="field-hint">24-hour time, separated by commas</span><input name="times" required maxLength={55} placeholder="08:00, 19:00" defaultValue={med?.times.join(', ')} /></label>
          <label>Instructions from your care team<input name="instructions" maxLength={220} defaultValue={med?.instructions} /></label>
        </div>
        <div className="row wrap"><button className="button button-primary" disabled={busy}>Save medication</button><button className="button button-quiet" type="button" onClick={() => setMedOpen(undefined)}>Cancel</button></div>
      </form>}
      {!data.medications.length && <p className="muted">No medications added yet.</p>}
      <ul className="item-list">{data.medications.map((item) => <li key={item.id}><div><strong>{item.name}</strong><p className="muted">{item.times.join(', ')} · {item.timezone}</p>{item.instructions && <p className="small muted">{item.instructions}</p>}</div>
        {editing && <div className="row wrap"><button className="button button-outline" aria-label={`Edit ${item.name}`} onClick={() => setMedOpen(item)}>Edit</button><button className="button button-quiet" disabled={busy} aria-label={`Remove ${item.name}`} onClick={async () => {
          if (window.confirm(`Remove ${item.name} from the routine?`)) {
            if (await mutate(`/medications/${item.id}`, 'DELETE', undefined, 'Medication removed.') && med?.id === item.id) setMedOpen(undefined)
          }
        }}>Remove</button></div>}
      </li>)}</ul>
    </section>
    <section className="panel">
      <div className="row between wrap"><h2 className="panel-heading"><CalendarDays size={21} aria-hidden /> Appointments</h2>{editing && <button className="button button-primary" onClick={() => setAppointmentOpen('new')}><Plus size={18} aria-hidden /> Add appointment</button>}</div>
      {appointmentOpen && <form className="form-box" key={appt?.id ?? 'new'} onSubmit={saveAppt}>
        <h3>{appt ? 'Edit appointment' : 'Add appointment'}</h3>
        <div className="fields">
          <label>Visit name<input name="title" required maxLength={90} defaultValue={appt?.title} /></label>
          <label>Location<input name="location" maxLength={160} defaultValue={appt?.location} /></label>
          <label>Local date and time<input type="datetime-local" name="start" required defaultValue={appt && toLocalInput(appt.startsAt, appt.timezone)} /></label>
          <label>Appointment timezone<input name="timezone" required maxLength={65} defaultValue={appt?.timezone ?? data.profile.timezone} /></label>
        </div>
        <div className="row wrap"><button className="button button-primary" disabled={busy}>Save appointment</button><button className="button button-quiet" type="button" onClick={() => setAppointmentOpen(undefined)}>Cancel</button></div>
      </form>}
      {!data.appointments.length && <p className="muted">No upcoming appointments.</p>}
      <ul className="item-list">{data.appointments.map((item) => <li key={item.id}><div><strong>{item.title}</strong><p className="muted">{dayLabel(item.startsAt, item.timezone)} at {clockTime(item.startsAt, item.timezone)} · {item.timezone}</p>{item.location && <p className="small muted">{item.location}</p>}</div>
        {editing && <div className="row wrap"><button className="button button-outline" aria-label={`Edit ${item.title}`} onClick={() => setAppointmentOpen(item)}>Edit</button><button className="button button-quiet" disabled={busy} aria-label={`Remove ${item.title}`} onClick={async () => {
          if (window.confirm(`Remove ${item.title}?`)) {
            if (await mutate(`/appointments/${item.id}`, 'DELETE', undefined, 'Appointment removed.') && appt?.id === item.id) setAppointmentOpen(undefined)
          }
        }}>Remove</button></div>}
      </li>)}</ul>
    </section>
  </div>
}

export function CirclePanel({ data, mutate, busy }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitation, setInvitation] = useState<{ code: string; expiresAt: number }>()
  const [copied, setCopied] = useState('')
  const { profile, members, role } = data
  const owner = role === 'owner'

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    const result = await mutate<{ code: string; expiresAt: number }>('/invitations', 'POST', { email: text(form, 'email'), role: text(form, 'role') }, 'Invitation created.')
    if (result) { setInvitation(result); setInviteOpen(false); setCopied('') }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    await mutate('/settings', 'PUT', {
      doseEmail: form.has('doseEmail'), appointmentEmail: form.has('appointmentEmail'), escalation: form.has('escalation'),
      aiConsent: form.has('aiConsent'), graceMinutes: Number(form.get('graceMinutes')),
    }, 'Care preferences saved.')
  }

  return <>
    <section className="panel">
      <div className="row wrap between"><h2 className="panel-heading"><Users size={22} aria-hidden /> {owner ? 'People with access' : 'Your access'}</h2>{owner && mutate && <button className="button button-primary" onClick={() => setInviteOpen(!inviteOpen)}><Plus size={17} aria-hidden /> Invite caregiver</button>}</div>
      {inviteOpen && <form className="form-box" onSubmit={submitInvite}>
        <div className="fields"><label>Caregiver email<input name="email" type="email" required maxLength={254} /></label>
          <label>Permission<select name="role" defaultValue="viewer"><option value="viewer">Can view and acknowledge alerts</option><option value="editor">Can view and update the routine</option></select></label></div>
        <p className="small muted">Share the one-time code privately. Only the person with this verified email can redeem it within 48 hours.</p>
        <div className="row wrap"><button className="button button-primary" disabled={busy}>Create passcode</button><button className="button button-quiet" type="button" onClick={() => setInviteOpen(false)}>Cancel</button></div>
      </form>}
      {invitation && <div className="form-box"><div className="row wrap between"><h3>Share this passcode</h3><button className="button button-quiet" aria-label="Close passcode" onClick={() => setInvitation(undefined)}><X size={20} aria-hidden /></button></div>
        <p className="small muted">Expires {dayLabel(invitation.expiresAt, profile.timezone)} at {clockTime(invitation.expiresAt, profile.timezone)}. Copy it before closing.</p>
        <div className="row wrap"><code className="passcode">{invitation.code}</code><button className="button button-outline" onClick={async () => {
          try { await navigator.clipboard.writeText(invitation.code); setCopied('Copied.') } catch { setCopied('Select the code to copy it manually.') }
        }}><Copy size={17} aria-hidden /> Copy</button></div><p className="small" role="status">{copied}</p>
      </div>}
      <ul className="item-list">{members.map((member) => <li key={member.id}>
        <div><strong>{member.email}</strong><p className="muted">{member.role === 'owner' ? 'Owner' : member.role === 'editor' ? 'Caregiver · Can edit' : 'Caregiver · Can view'}{member.optedIn && ' · Alerts enabled'}</p></div>
        {owner && member.role !== 'owner' && mutate && <button className="button button-quiet" disabled={busy} onClick={() => {
          if (window.confirm(`Remove access for ${member.email}?`)) void mutate(`/members/${member.id}`, 'DELETE', undefined, 'Caregiver access removed.')
        }}>Remove access</button>}
      </li>)}</ul>
      {owner && !!data.invitations.length && <><h3>Pending invitations</h3><ul className="item-list">{data.invitations.map((item) => <li key={item.id}><div><strong>{item.email}</strong><p className="muted small">Expires {dayLabel(item.expiresAt, profile.timezone)} at {clockTime(item.expiresAt, profile.timezone)}</p></div><button className="button button-outline" disabled={busy} onClick={() => void mutate?.(`/invitations/${item.id}`, 'DELETE', undefined, 'Invitation revoked.')}>Revoke</button></li>)}</ul></>}
    </section>
    {owner && mutate && <section className="panel"><h2 className="panel-heading"><Settings2 size={21} aria-hidden /> Care preferences</h2>
      {!data.emailAvailable && <p className="banner warn small">Email delivery is disabled for this deployment. Missed check-ins still appear in your care circle.</p>}
      <form className="preference-form" onSubmit={saveSettings}>
        <label><input type="checkbox" name="doseEmail" defaultChecked={profile.doseEmail} /> Email me upcoming medication check-ins</label>
        <label><input type="checkbox" name="appointmentEmail" defaultChecked={profile.appointmentEmail} /> Email me upcoming appointments</label>
        <label><input type="checkbox" name="escalation" defaultChecked={profile.escalation} /> Email approved, opted-in caregivers after a missed check-in</label>
        <label><input type="checkbox" name="aiConsent" defaultChecked={profile.aiConsent} /> Let Gemini select event types for care handoffs</label>
        <p className="muted small">Gemini receives event categories and their order. Names, medication details, timestamps, and appointment details stay in SaathiCare.</p>
        <label className="grace-field">Grace period for newly scheduled check-ins (minutes)<input type="number" name="graceMinutes" min={15} max={180} required defaultValue={profile.graceMinutes} /></label>
        <button className="button button-primary" disabled={busy}>Save preferences</button>
      </form>
    </section>}
    {!owner && mutate && <section className="panel"><h2 className="panel-heading"><Settings2 size={21} aria-hidden /> Alert preferences</h2>
      {!data.emailAvailable && <p className="banner warn small">Email delivery is disabled for this deployment. You can view and acknowledge shared alerts here.</p>}
      <p className="muted">Get missed check-in emails when the profile owner has enabled sharing.</p><button className="button button-outline" disabled={busy} onClick={() => void mutate('/members', 'PUT', { optedIn: !members[0]?.optedIn }, 'Alert preferences saved.')}>{members[0]?.optedIn ? 'Turn off alert emails' : 'Turn on alert emails'}</button></section>}
  </>
}
