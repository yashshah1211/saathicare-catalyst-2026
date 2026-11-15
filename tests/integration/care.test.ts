import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { accept, acknowledge, invite, optIn, removeMember, revoke } from '../../src/lib/server/circle'
import { handoff } from '../../src/lib/server/handoff'
import { type Actor, db } from '../../src/lib/server/platform'
import { runReminders } from '../../src/lib/server/reminders'
import { createProfile, dashboard, deleteAppointment, deleteMedication, inbox, listProfiles, profileRef, respondToDose, saveAppointment, saveMedication, settings } from '../../src/lib/server/store'
import { DAY, localInstant, MINUTE } from '../../src/lib/time'

const tz = 'Asia/Kolkata'
const now = localInstant('2026-11-15', '09:55', tz)
const makeActor = (name: string, verified = true): Actor => ({ uid: randomUUID(), email: `${name}-${randomUUID()}@example.test`, verified })
const owner = makeActor('owner')
const viewer = makeActor('viewer')
const editor = makeActor('editor')
const outsider = makeActor('outsider')
const unverified = makeActor('unverified', false)
const medication = { name: 'Example tablet', instructions: 'Fictional instructions', times: ['10:00', '12:00'], timezone: tz }
let profile: ReturnType<typeof profileRef>

async function appointmentReminderFixture(at: number, localStart: string) {
  const actor = makeActor('appointment-owner')
  const target = profileRef((await createProfile(actor, { name: 'Reminder fixture', timezone: tz }, at)).id)
  await settings(target, actor, { doseEmail: false, appointmentEmail: true, escalation: false, aiConsent: false, graceMinutes: 45 }, at)
  await saveAppointment(target, actor, { title: 'Example visit', location: '', timezone: tz, localStart }, undefined, at)
  return { actor, target }
}

describe('Firestore care circle and reminder pipeline', () => {
  beforeAll(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_PROJECT_ID?.startsWith('demo-')) throw new Error('Start the Firestore emulator with a demo project before running integration tests.')
    profile = profileRef((await createProfile(owner, { name: 'Example elder', timezone: tz }, now)).id)
  })

  it('enforces email verification and profile scope, then accepts each passcode at most once', async () => {
    await expect(dashboard(profile, outsider, now)).rejects.toMatchObject({ status: 403 })
    await expect(createProfile(unverified, { name: 'Example', timezone: tz }, now)).rejects.toMatchObject({ status: 403 })
    const grant = await invite(profile, owner, viewer.email, 'viewer', now)
    await expect(accept(outsider, grant.code, now)).rejects.toMatchObject({ status: 400 })
    const attempts = await Promise.allSettled([accept(viewer, grant.code, now), accept(viewer, grant.code, now)])
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await listProfiles(viewer)).toEqual([{ id: profile.id, name: 'Example elder', role: 'viewer' }])
    await expect(saveMedication(profile, viewer, medication, undefined, now)).rejects.toMatchObject({ status: 403 })
    await expect(invite(profile, viewer, editor.email, 'editor', now)).rejects.toMatchObject({ status: 403 })
    const expiring = await invite(profile, owner, editor.email, 'editor', now)
    await expect(accept(editor, expiring.code, now + 2 * DAY)).rejects.toMatchObject({ status: 400 })
    const revoked = await invite(profile, owner, editor.email, 'editor', now)
    await revoke(profile, owner, revoked.code.split('.')[0], now)
    await expect(accept(editor, revoked.code, now)).rejects.toMatchObject({ status: 400 })
    const locked = await invite(profile, owner, editor.email, 'editor', now)
    const [id, secret] = locked.code.split('.')
    const incorrect = `${id}.${secret[0] === 'a' ? 'b' : 'a'}${secret.slice(1)}`
    for (let i = 0; i < 5; i++) await expect(accept(editor, incorrect, now)).rejects.toMatchObject({ status: 400 })
    await expect(accept(editor, locked.code, now)).rejects.toMatchObject({ status: 400 })
    const active = await invite(profile, owner, editor.email, 'editor', now)
    await expect(accept(editor, active.code, now)).resolves.toEqual({ profileId: profile.id })
  })

  it('accepts authorized CRUD and writes duplicate confirmations only once', async () => {
    const med = await saveMedication(profile, editor, medication, undefined, now)
    expect(med.times).toEqual(['10:00', '12:00'])
    const edited = await saveMedication(profile, owner, { ...medication, name: 'Example tablet edited' }, med.id, now)
    expect(edited.revision).toBe(2)
    const appointment = await saveAppointment(profile, editor, { title: 'Clinic visit', location: 'Clinic', timezone: tz, localStart: '2026-11-15T14:00' }, undefined, now)
    expect(appointment.startsAt).toBe(localInstant('2026-11-15', '14:00', tz))
    await saveAppointment(profile, owner, { title: 'Clinic visit updated', location: 'Clinic', timezone: tz, localStart: '2026-11-15T15:00' }, appointment.id, now)
    const current = await dashboard(profile, owner, now)
    expect(current.appointments.map((item) => item.title)).toEqual(['Clinic visit updated'])
    expect(current.doses).toHaveLength(2)
    const [first] = current.doses
    const command = { action: 'taken', expectedSnoozes: 0, expectedStatus: 'pending' } as const
    await expect(respondToDose(profile, viewer, first.id, command, now)).rejects.toMatchObject({ status: 403 })
    await Promise.all([respondToDose(profile, owner, first.id, command, now), respondToDose(profile, editor, first.id, command, now)])
    const result = await dashboard(profile, owner, now)
    expect(result.activity.filter((item) => item.kind === 'taken')).toHaveLength(1)
    expect(result.doses[0].respondedAt).toBe(now)
    await saveMedication(profile, owner, { ...medication, name: 'Example tablet' }, med.id, now + MINUTE)
    expect((await dashboard(profile, owner, now + MINUTE)).doses.filter((item) => item.dueAt === first.dueAt)).toHaveLength(1)
  })

  it('processes upcoming and missed events once and requires two-sided alert consent', async () => {
    await settings(profile, owner, { doseEmail: true, appointmentEmail: true, escalation: true, aiConsent: false, graceMinutes: 45 }, now)
    await optIn(profile, viewer, true, now)
    const sent: Array<{ id: string; to: string; kind: string }> = []
    const deliver = async (email: (typeof sent)[number]) => { sent.push(email); return 'sent' as const }
    const valid = async () => true
    const beforeSecond = localInstant('2026-11-15', '11:55', tz)
    const run = async (at: number) => {
      const delivery = { provider: 'resend', send: deliver } as const
      const ticks = await Promise.all([runReminders(at, delivery, valid), runReminders(at, delivery, valid)])
      expect(ticks.map((tick) => tick.errors)).toEqual([0, 0])
    }
    await run(beforeSecond)
    const ownerDashboard = await dashboard(profile, owner, beforeSecond)
    expect(sent.map((item) => item.kind).sort()).toEqual(['appointment', 'dose'])
    const appointment = ownerDashboard.appointments[0]
    await saveAppointment(profile, owner, { title: 'Same visit, new room', location: 'Room 2', timezone: tz, localStart: '2026-11-15T15:00' }, appointment.id, beforeSecond)
    await saveMedication(profile, owner, { ...medication, name: 'Same scheduled dose, new label' }, ownerDashboard.medications[0].id, beforeSecond)
    await run(beforeSecond)
    expect(sent).toHaveLength(2)
    const second = (await dashboard(profile, owner, beforeSecond)).doses[1]
    const command = { action: 'snoozed', expectedSnoozes: 0, expectedStatus: 'pending' } as const
    await Promise.all([respondToDose(profile, owner, second.id, command, beforeSecond), respondToDose(profile, owner, second.id, command, beforeSecond)])
    await run(beforeSecond + 14 * MINUTE)
    expect(sent).toHaveLength(2)
    await run(beforeSecond + 15 * MINUTE)
    await run(beforeSecond + 60 * MINUTE)
    await run(beforeSecond + 61 * MINUTE)
    expect(sent.filter((item) => item.kind === 'dose')).toHaveLength(2)
    expect(sent.filter((item) => item.kind === 'missed').map((item) => item.to)).toEqual([viewer.email])
    expect(new Set(sent.map((item) => item.id)).size).toBe(sent.length)
    const view = await dashboard(profile, viewer, beforeSecond + 61 * MINUTE)
    expect(view.activity.filter((item) => item.kind === 'missed')).toHaveLength(1)
    expect(view.notifications).toHaveLength(1)
    await Promise.all([acknowledge(profile, viewer, view.notifications[0].id, now), acknowledge(profile, viewer, view.notifications[0].id, now)])
    expect((await handoff(profile, viewer, beforeSecond + 61 * MINUTE)).mode).toBe('records')
    expect((await dashboard(profile, editor, beforeSecond + 61 * MINUTE)).notifications).toHaveLength(0)
    await removeMember(profile, owner, viewer.uid, now)
    await expect(dashboard(profile, viewer, now)).rejects.toMatchObject({ status: 403 })
    const grant = await invite(profile, owner, viewer.email, 'viewer', now)
    await accept(viewer, grant.code, now)
    expect((await dashboard(profile, viewer, now)).notifications).toHaveLength(0)
    await deleteMedication(profile, owner, ownerDashboard.medications[0].id, now)
    await deleteAppointment(profile, owner, ownerDashboard.appointments[0].id, now)
    expect((await dashboard(profile, owner, now)).medications).toHaveLength(0)
    expect((await dashboard(profile, owner, now)).appointments).toHaveLength(0)
    expect((await db().collection('reminderJobs').where('kind', '==', 'mail').get()).size).toBe(0)
  })

  it('keeps a postponed evening dose visible after local midnight', async () => {
    const evening = localInstant('2026-11-19', '23:50', tz)
    const lateProfile = profileRef((await createProfile(owner, { name: 'Evening routine', timezone: tz }, evening - MINUTE)).id)
    await saveMedication(lateProfile, owner, { ...medication, times: ['23:50'] }, undefined, evening - MINUTE)
    const previous = (await dashboard(lateProfile, owner, evening)).doses[0]
    await respondToDose(lateProfile, owner, previous.id, { action: 'snoozed', expectedSnoozes: 0, expectedStatus: 'pending' }, evening)
    const afterMidnight = evening + 15 * MINUTE
    expect((await dashboard(lateProfile, owner, afterMidnight)).doses.map((dose) => dose.status)).toEqual(['snoozed', 'pending'])
    await respondToDose(lateProfile, owner, previous.id, { action: 'taken', expectedSnoozes: 1, expectedStatus: 'snoozed' }, afterMidnight)
    expect((await dashboard(lateProfile, owner, afterMidnight)).doses[0].status).toBe('taken')
  })

  it('does not replay an SMTP attempt after a worker loses its lease', async () => {
    const at = localInstant('2026-11-20', '11:00', tz)
    const { actor, target } = await appointmentReminderFixture(at, '2026-11-20T16:00')
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<'sent'>()
    const send = vi.fn(() => { started.resolve(); return response.promise })
    const delivery = { provider: 'gmail', send } as const
    const verified = async () => true
    const tick = runReminders(at, delivery, verified)
    try {
      await Promise.race([started.promise, tick.then(() => { throw new Error('The SMTP attempt did not start.') })])
      expect((await runReminders(at, delivery, verified)).errors).toBe(0)
      expect((await runReminders(at + 2 * MINUTE, delivery, verified)).errors).toBe(0)
      expect(send).toHaveBeenCalledTimes(1)
      expect((await dashboard(target, actor, at)).notifications[0].status).toBe('uncertain')
    } finally {
      response.resolve('sent')
      await tick
    }
    expect((await dashboard(target, actor, at)).notifications[0].status).toBe('uncertain')
  })

  it('replays a legacy Resend attempt only on Resend with its original notification ID', async () => {
    const at = localInstant('2026-11-21', '11:00', tz)
    const { actor, target } = await appointmentReminderFixture(at, '2026-11-21T16:00')
    const send = vi.fn<(mail: { id: string }) => Promise<'retry'>>().mockResolvedValue('retry')
    const resend = { provider: 'resend', send } as const
    const verified = async () => true
    expect((await runReminders(at, resend, verified)).errors).toBe(0)
    const { members, notifications } = await dashboard(target, actor, at)
    const ref = inbox(target, members[0]).doc(notifications[0].id)
    await ref.update({ deliveryProvider: FieldValue.delete() })
    expect((await runReminders(at + 2 * MINUTE, resend, verified)).errors).toBe(0)
    expect(send.mock.calls.map(([mail]) => mail.id)).toEqual([notifications[0].id, notifications[0].id])
    const sendGmail = vi.fn(async () => 'sent' as const)
    expect((await runReminders(at + 6 * MINUTE, { provider: 'gmail', send: sendGmail }, verified)).errors).toBe(0)
    expect(sendGmail).not.toHaveBeenCalled()
    expect((await dashboard(target, actor, at)).notifications[0].status).toBe('uncertain')
  })

  it('retains an in-app reminder when outbound delivery is disabled', async () => {
    const at = localInstant('2026-11-22', '11:00', tz)
    const { actor, target } = await appointmentReminderFixture(at, '2026-11-22T16:00')
    const verify = vi.fn(async () => true)
    expect(await runReminders(at, null, verify)).toMatchObject({ errors: 0, emailConfigured: false })
    expect(verify).not.toHaveBeenCalled()
    expect((await dashboard(target, actor, at)).notifications[0]).toMatchObject({ kind: 'appointment', status: 'failed' })
  })

  it('retries a verification failure but never replays a thrown Gmail submission', async () => {
    const at = localInstant('2026-11-23', '11:00', tz)
    const { actor, target } = await appointmentReminderFixture(at, '2026-11-23T16:00')
    const verify = vi.fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('Synthetic address lookup failure'))
      .mockResolvedValue(true)
    const send = vi.fn(async () => { throw new Error('Synthetic SMTP disconnect') })
    const delivery = { provider: 'gmail', send } as const

    expect((await runReminders(at, delivery, verify)).errors).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect((await dashboard(target, actor, at)).notifications[0].status).toBe('queued')
    expect((await runReminders(at + MINUTE, delivery, verify)).errors).toBe(0)
    expect(verify).toHaveBeenCalledTimes(1)

    expect((await runReminders(at + 2 * MINUTE, delivery, verify)).errors).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect((await dashboard(target, actor, at)).notifications[0].status).toBe('uncertain')
    expect((await runReminders(at + 6 * MINUTE, delivery, verify)).errors).toBe(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect((await dashboard(target, actor, at)).notifications[0].status).toBe('uncertain')
  })
})
