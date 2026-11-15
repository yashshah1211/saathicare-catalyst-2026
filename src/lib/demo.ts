import type { Activity, DashboardData, Dose, Handoff } from './model'

export const demoNow = Date.UTC(2026, 10, 15, 7, 30)
const hour = 3_600_000
const minute = 60_000

function dose(id: string, medicationName: string, instructions: string, dueAt: number, status: Dose['status']): Dose {
  return { id, medicationId: id, medicationName, instructions, dueAt, activeAt: dueAt, missedAt: dueAt + 45 * minute,
    status, snoozes: 0, ...(status === 'taken' ? { respondedAt: dueAt + 5 * minute } : {}) }
}

export function demoData(): DashboardData {
  const timezone = 'Asia/Kolkata'
  const doses = [
    dose('morning', 'Morning tablet', 'Morning routine', demoNow - 5 * hour, 'taken'),
    dose('midday', 'Midday tablet', 'Lunch routine', demoNow - 15 * minute, 'pending'),
    dose('evening', 'Evening tablet', 'Evening routine', demoNow + 6 * hour, 'pending'),
  ]
  return {
    profile: { id: 'fictional', name: 'Meera Rao', timezone, ownerId: 'meera', doseEmail: true, appointmentEmail: true, escalation: true, aiConsent: false, graceMinutes: 45 },
    role: 'owner',
    emailAvailable: false,
    doses,
    medications: doses.map((record, index) => ({ id: record.id, name: record.medicationName, instructions: record.instructions, times: [['08:00'], ['12:45'], ['19:00']][index], timezone, revision: 1, updatedAt: demoNow })),
    appointments: [{ id: 'follow-up', title: 'Routine follow-up', location: 'Greenview Family Clinic', startsAt: demoNow + 2 * 24 * hour - 2 * hour - 30 * minute, timezone, revision: 1 }],
    activity: [
      { id: 'morning-taken', kind: 'taken', at: demoNow - 5 * hour + 5 * minute, label: doses[0].medicationName },
      { id: 'yesterday-missed', kind: 'missed', at: demoNow - 17 * hour - 15 * minute, label: 'Evening tablet' },
    ],
    members: [{ id: 'meera', feedId: 'meera', email: 'meera@example.test', role: 'owner', optedIn: false },
      { id: 'anika', feedId: 'anika', email: 'anika@example.test', role: 'editor', optedIn: true }],
    invitations: [],
    notifications: [{ id: 'anika-missed', kind: 'missed', at: demoNow - 17 * hour - 15 * minute, label: 'Evening tablet', status: 'queued' }],
  }
}

export function demoHandoff(data: DashboardData): Handoff {
  const next = data.appointments[0]
  const appointment: Activity[] = next ? [{ id: next.id, kind: 'appointment', at: next.startsAt, label: next.title }] : []
  const missed = data.activity.find((item) => item.kind === 'missed')
  return { mode: 'records', items: [...new Set([...(missed ? [missed] : []), ...data.activity.slice(0, 3), ...appointment])] }
}
