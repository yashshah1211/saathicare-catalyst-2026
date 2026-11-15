import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { CalendarDays, Pill, Plus } from 'lucide-react'
import type { Appointment, DashboardData, Medication } from '@/lib/model'
import { clockTime, dayLabel, toLocalInput } from '@/lib/time'
import type { Mutate } from './dashboard'

interface RoutineProps {
  data: DashboardData
  mutate?: Mutate
  busy?: boolean
}

interface EditorPanelProps {
  timezone: string
  mutate?: Mutate
  busy?: boolean
}

function field(form: FormData, name: string) {
  return String(form.get(name) ?? '')
}

function useRoutineEditor<T>(firstField: RefObject<HTMLInputElement | null>) {
  const [selection, setSelection] = useState<T | 'new'>()
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selection) firstField.current?.focus()
  }, [firstField, selection])

  function open(value: T | 'new', opener: HTMLButtonElement) {
    trigger.current = opener
    if (selection === value) firstField.current?.focus()
    setSelection(value)
  }

  function close(fallback?: HTMLButtonElement | null) {
    setSelection(undefined)
    const target = fallback ?? trigger.current
    if (target?.isConnected) target.focus()
  }

  const existing = selection === 'new' ? undefined : selection
  return { selection, existing, open, close }
}

function MedicationsPanel({ items, timezone, mutate, busy }: EditorPanelProps & { items: Medication[] }) {
  const firstField = useRef<HTMLInputElement>(null)
  const editor = useRoutineEditor<Medication>(firstField)
  const medication = editor.existing
  const addButton = useRef<HTMLButtonElement>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    const path = medication ? `/medications/${medication.id}` : '/medications'
    const result = await mutate(path, medication ? 'PUT' : 'POST', {
      name: field(form, 'name'),
      instructions: field(form, 'instructions'),
      timezone: field(form, 'timezone'),
      times: field(form, 'times').split(',').map((time) => time.trim()),
    }, 'Medication saved.')
    if (result) editor.close()
  }

  async function remove(item: Medication) {
    if (!mutate || !window.confirm(`Remove ${item.name} from the routine?`)) return
    const result = await mutate(`/medications/${item.id}`, 'DELETE', undefined, 'Medication removed.')
    if (result && medication?.id === item.id) editor.close(addButton.current)
  }

  return (
    <section className="panel">
      <div className="row between wrap">
        <h2 className="panel-heading"><Pill size={21} aria-hidden /> Medications</h2>
        {mutate && (
          <button
            ref={addButton}
            className="button button-primary"
            onClick={(event) => editor.open('new', event.currentTarget)}
          >
            <Plus size={18} aria-hidden /> Add medication
          </button>
        )}
      </div>
      {editor.selection && (
        <form className="form-box" key={medication?.id ?? 'new'} onSubmit={save}>
          <h3>{medication ? 'Edit medication' : 'Add medication'}</h3>
          <div className="fields">
            <label>
              Medication name
              <input ref={firstField} name="name" required maxLength={90} defaultValue={medication?.name} />
            </label>
            <label>
              Schedule timezone
              <input name="timezone" required maxLength={65} defaultValue={medication?.timezone ?? timezone} />
            </label>
            <label>
              Dose times <span className="field-hint">24-hour time, separated by commas</span>
              <input
                name="times"
                required
                maxLength={55}
                placeholder="08:00, 19:00"
                defaultValue={medication?.times.join(', ')}
              />
            </label>
            <label>
              Instructions from your care team
              <input name="instructions" maxLength={220} defaultValue={medication?.instructions} />
            </label>
          </div>
          <div className="row wrap">
            <button className="button button-primary" disabled={busy}>Save medication</button>
            <button className="button button-quiet" type="button" onClick={() => editor.close()}>Cancel</button>
          </div>
        </form>
      )}
      {!items.length && <p className="muted">No medications added yet.</p>}
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.name}</strong>
              <p className="muted">{item.times.join(', ')} · {item.timezone}</p>
              {item.instructions && <p className="small muted">{item.instructions}</p>}
            </div>
            {mutate && (
              <div className="row wrap">
                <button
                  className="button button-outline"
                  aria-label={`Edit ${item.name}`}
                  onClick={(event) => editor.open(item, event.currentTarget)}
                >
                  Edit
                </button>
                <button
                  className="button button-quiet"
                  disabled={busy}
                  aria-label={`Remove ${item.name}`}
                  onClick={() => void remove(item)}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function AppointmentsPanel({ items, timezone, mutate, busy }: EditorPanelProps & { items: Appointment[] }) {
  const firstField = useRef<HTMLInputElement>(null)
  const editor = useRoutineEditor<Appointment>(firstField)
  const appointment = editor.existing
  const addButton = useRef<HTMLButtonElement>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    const path = appointment ? `/appointments/${appointment.id}` : '/appointments'
    const result = await mutate(path, appointment ? 'PUT' : 'POST', {
      title: field(form, 'title'),
      location: field(form, 'location'),
      timezone: field(form, 'timezone'),
      localStart: field(form, 'start'),
    }, 'Appointment saved.')
    if (result) editor.close()
  }

  async function remove(item: Appointment) {
    if (!mutate || !window.confirm(`Remove ${item.title}?`)) return
    const result = await mutate(`/appointments/${item.id}`, 'DELETE', undefined, 'Appointment removed.')
    if (result && appointment?.id === item.id) editor.close(addButton.current)
  }

  return (
    <section className="panel">
      <div className="row between wrap">
        <h2 className="panel-heading"><CalendarDays size={21} aria-hidden /> Appointments</h2>
        {mutate && (
          <button
            ref={addButton}
            className="button button-primary"
            onClick={(event) => editor.open('new', event.currentTarget)}
          >
            <Plus size={18} aria-hidden /> Add appointment
          </button>
        )}
      </div>
      {editor.selection && (
        <form className="form-box" key={appointment?.id ?? 'new'} onSubmit={save}>
          <h3>{appointment ? 'Edit appointment' : 'Add appointment'}</h3>
          <div className="fields">
            <label>
              Visit name
              <input ref={firstField} name="title" required maxLength={90} defaultValue={appointment?.title} />
            </label>
            <label>
              Location
              <input name="location" maxLength={160} defaultValue={appointment?.location} />
            </label>
            <label>
              Local date and time
              <input
                type="datetime-local"
                name="start"
                required
                defaultValue={appointment && toLocalInput(appointment.startsAt, appointment.timezone)}
              />
            </label>
            <label>
              Appointment timezone
              <input name="timezone" required maxLength={65} defaultValue={appointment?.timezone ?? timezone} />
            </label>
          </div>
          <div className="row wrap">
            <button className="button button-primary" disabled={busy}>Save appointment</button>
            <button className="button button-quiet" type="button" onClick={() => editor.close()}>Cancel</button>
          </div>
        </form>
      )}
      {!items.length && <p className="muted">No upcoming appointments.</p>}
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <p className="muted">
                {dayLabel(item.startsAt, item.timezone)} at {clockTime(item.startsAt, item.timezone)} · {item.timezone}
              </p>
              {item.location && <p className="small muted">{item.location}</p>}
            </div>
            {mutate && (
              <div className="row wrap">
                <button
                  className="button button-outline"
                  aria-label={`Edit ${item.title}`}
                  onClick={(event) => editor.open(item, event.currentTarget)}
                >
                  Edit
                </button>
                <button
                  className="button button-quiet"
                  disabled={busy}
                  aria-label={`Remove ${item.title}`}
                  onClick={() => void remove(item)}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RoutinePanel({ data, mutate, busy }: RoutineProps) {
  const editor = data.role === 'viewer' ? undefined : mutate
  const { timezone } = data.profile

  return (
    <div className="stack manage-stack">
      <MedicationsPanel items={data.medications} timezone={timezone} mutate={editor} busy={busy} />
      <AppointmentsPanel items={data.appointments} timezone={timezone} mutate={editor} busy={busy} />
    </div>
  )
}
