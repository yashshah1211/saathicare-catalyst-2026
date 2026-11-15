import type { DocumentReference, Transaction } from 'firebase-admin/firestore'
import type { z } from 'zod'
import type { Activity, Appointment, DashboardData, Dose, Invitation, Medication, Member, Notification, Profile, Role } from '../model'
import { DAY, localDay, localInstant, MAX_SNOOZES, MINUTE, nextDay } from '../time'
import type { appointmentInput, doseInput, medicationInput, profileInput, settingsInput } from '../validation'
import { ApiError, type Actor, db, emailConfigured } from './platform'

export type Job = { profileId: string; refId: string; nextAt: number } & (
  | { kind: 'roll'; revision: number; day: string }
  | { kind: 'dose' | 'missed' | 'appointment'; revision: number }
  | { kind: 'mail'; feedId: string }
)

export function profileRef(id: string) { return db().collection('careProfiles').doc(id) }
export function membershipIndex(uid: string, id: string) { return db().collection('users').doc(uid).collection('profiles').doc(id) }
export function jobRef(id: string) { return db().collection('reminderJobs').doc(id) }

export function audit(tx: Transaction, profile: DocumentReference, operation: string, now: number, actor?: Actor) {
  tx.create(profile.collection('auditEvents').doc(), { operation, at: now, actorId: actor?.uid ?? 'scheduler' })
}

export function requireVerified(actor: Actor) {
  if (!actor.verified || !actor.email) throw new ApiError(403, 'Verify your email before opening a care circle.')
}

export async function access(tx: Transaction, profile: DocumentReference, actor: Actor, allowed: Role[] = ['owner', 'editor', 'viewer']) {
  requireVerified(actor)
  const [membership, record] = await Promise.all([tx.get(profile.collection('memberships').doc(actor.uid)), tx.get(profile)])
  const member = membership.data() as Member | undefined
  if (!member || !record.exists || !allowed.includes(member.role)) throw new ApiError(403, 'You do not have access to this action.')
  return { member, data: record.data() as Profile }
}

export async function listProfiles(actor: Actor) {
  requireVerified(actor)
  const index = await db().collection('users').doc(actor.uid).collection('profiles').get()
  return db().runTransaction(async (tx) => {
    const available = await Promise.all(index.docs.map(async (item) => {
      const profile = profileRef(item.id)
      const [record, member] = await Promise.all([tx.get(profile), tx.get(profile.collection('memberships').doc(actor.uid))])
      const data = record.data() as Profile | undefined
      return data && member.exists ? { id: item.id, name: data.name, role: (member.data() as Member).role } : null
    }))
    return available.filter((item) => item !== null)
  }, { readOnly: true })
}

export async function createProfile(actor: Actor, values: z.infer<typeof profileInput>, now = Date.now()) {
  requireVerified(actor)
  const profile = db().collection('careProfiles').doc()
  const user = db().collection('users').doc(actor.uid)
  const data: Profile = { id: profile.id, ...values, ownerId: actor.uid, doseEmail: false, appointmentEmail: false, escalation: false, aiConsent: false, graceMinutes: 45 }
  await db().runTransaction(async (tx) => {
    const account = await tx.get(user)
    const owned = Number(account.get('ownedProfiles') ?? 0)
    if (owned >= 10) throw new ApiError(409, 'This account has reached the ten-profile limit.')
    tx.set(user, { ownedProfiles: owned + 1 }, { merge: true })
    tx.create(profile, data)
    tx.create(profile.collection('memberships').doc(actor.uid), { id: actor.uid, feedId: actor.uid, email: actor.email, role: 'owner', optedIn: false })
    tx.create(membershipIndex(actor.uid, profile.id), { joinedAt: now })
    audit(tx, profile, 'profile.created', now, actor)
  })
  return data
}

export async function dashboard(profile: DocumentReference, actor: Actor, now = Date.now()): Promise<DashboardData> {
  return db().runTransaction(async (tx) => {
    const { member, data } = await access(tx, profile, actor)
    const today = localDay(now, data.timezone)
    const start = localInstant(today, '00:00', data.timezone)
    const end = localInstant(nextDay(today), '00:00', data.timezone)
    const [medications, doses, appointments, activity, members, invitations, notifications] = await Promise.all([
      tx.get(profile.collection('medications').limit(40)),
      tx.get(profile.collection('doseEvents').where('dueAt', '>=', start - DAY).where('dueAt', '<', end).orderBy('dueAt')),
      tx.get(profile.collection('appointments').where('startsAt', '>=', now).orderBy('startsAt').limit(80)),
      tx.get(profile.collection('activity').orderBy('at', 'desc').limit(30)),
      member.role === 'owner' ? tx.get(profile.collection('memberships').limit(21)) : null,
      member.role === 'owner' ? tx.get(profile.collection('invitations').where('expiresAt', '>', now).limit(40)) : null,
      tx.get(inbox(profile, member).orderBy('at', 'desc').limit(20)),
    ])
    const currentMedications = medications.docs.map((doc) => doc.data() as Medication)
    const revisions = new Map(currentMedications.map((med) => [med.id, med.revision]))
    return {
      profile: data, role: member.role, emailAvailable: emailConfigured(),
      members: members?.docs.map((doc) => doc.data() as Member) ?? [member],
      invitations: invitations?.docs.flatMap((doc) => {
        const { id, email, role, expiresAt, state } = doc.data() as Invitation
        return state === 'open' ? [{ id, email, role, expiresAt, state }] : []
      }) ?? [],
      medications: currentMedications,
      doses: doses.docs.flatMap((doc) => {
        const dose = doc.data() as Dose & { revision: number }
        const resolved = dose.status === 'taken' || dose.status === 'skipped'
        // Keep a previous evening check-in visible when its grace period or snooze runs into today.
        if (dose.dueAt < start && (dose.missedAt < start || (resolved && (dose.respondedAt ?? 0) < start))) return []
        return resolved || dose.status === 'missed' || revisions.get(dose.medicationId) === dose.revision ? [dose] : []
      }),
      appointments: appointments.docs.map((doc) => doc.data() as Appointment),
      activity: activity.docs.map((doc) => doc.data() as Activity),
      notifications: notifications.docs.map((doc) => {
        const { id, kind, at, label, status, acknowledgedAt } = doc.data() as Notification
        return { id, kind, at, label, status, acknowledgedAt }
      }),
    }
  }, { readOnly: true })
}

export function inbox(profile: DocumentReference, member: Member) {
  return profile.collection('notificationFeeds').doc(member.feedId).collection('notifications')
}

export async function settings(profile: DocumentReference, actor: Actor, values: z.infer<typeof settingsInput>, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner'])
    tx.update(profile, values)
    tx.update(profile.collection('memberships').doc(actor.uid), { email: actor.email })
    audit(tx, profile, 'profile.preferences.updated', now, actor)
  })
}

export function scheduleDay(tx: Transaction, profile: DocumentReference, med: Medication, day: string, now: number, grace: number, recorded = new Set<number>()) {
  for (const [slot, time] of med.times.entries()) {
    const dueAt = localInstant(day, time, med.timezone)
    // A schedule change applies prospectively. An overdue worker can still materialize existing days.
    if (dueAt < med.updatedAt || recorded.has(dueAt)) continue
    const id = `${med.id}_${med.revision}_${day}_${slot}`
    const dose: Dose = { id, medicationId: med.id, medicationName: med.name, instructions: med.instructions, dueAt,
      activeAt: dueAt, missedAt: dueAt + grace * MINUTE, status: 'pending', snoozes: 0 }
    tx.create(profile.collection('doseEvents').doc(id), { ...dose, revision: med.revision })
    tx.set(jobRef(`dose_${id}`), { kind: 'dose', profileId: profile.id, refId: id, revision: med.revision, nextAt: Math.max(now, dueAt - 10 * MINUTE) } satisfies Job)
    tx.set(jobRef(`missed_${id}`), { kind: 'missed', profileId: profile.id, refId: id, revision: med.revision, nextAt: dose.missedAt } satisfies Job)
  }
}

export function rollMedication(tx: Transaction, profile: DocumentReference, med: Medication, day: string) {
  tx.set(jobRef(`roll_${med.id}`), { kind: 'roll', profileId: profile.id, refId: med.id, revision: med.revision, day,
    nextAt: localInstant(day, '00:00', med.timezone) - 12 * 60 * MINUTE } satisfies Job)
}

export async function saveMedication(profile: DocumentReference, actor: Actor, values: z.infer<typeof medicationInput>, id?: string, now = Date.now()) {
  const collection = profile.collection('medications')
  const medRef = id ? collection.doc(id) : collection.doc()
  return db().runTransaction(async (tx) => {
    const { data } = await access(tx, profile, actor, ['owner', 'editor'])
    const previous = id ? (await tx.get(medRef)).data() as Medication | undefined : undefined
    if (id && !previous) throw new ApiError(404, 'Medication no longer exists.')
    if (!id && (await tx.get(collection.limit(40))).size >= 40) throw new ApiError(409, 'This profile has reached the forty-medication limit.')
    const med: Medication = { ...values, times: values.times.toSorted(), id: medRef.id, revision: (previous?.revision ?? 0) + 1, updatedAt: now }
    const today = localDay(now, med.timezone)
    const records = previous ? await tx.get(profile.collection('doseEvents').where('dueAt', '>=', now).where('dueAt', '<', now + 3 * DAY)) : null
    const recorded = new Set(records?.docs.map((doc) => doc.data() as Dose)
      .filter((dose) => dose.medicationId === med.id && ['taken', 'skipped', 'missed'].includes(dose.status)).map((dose) => dose.dueAt))
    tx.set(medRef, med)
    scheduleDay(tx, profile, med, today, now, data.graceMinutes, recorded)
    scheduleDay(tx, profile, med, nextDay(today), now, data.graceMinutes, recorded)
    rollMedication(tx, profile, med, nextDay(nextDay(today)))
    audit(tx, profile, id ? 'medication.updated' : 'medication.created', now, actor)
    return med
  })
}

export async function deleteMedication(profile: DocumentReference, actor: Actor, id: string, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner', 'editor'])
    const medication = profile.collection('medications').doc(id)
    if (!(await tx.get(medication)).exists) return
    tx.delete(medication)
    tx.delete(jobRef(`roll_${id}`))
    audit(tx, profile, 'medication.deleted', now, actor)
  })
}

export async function saveAppointment(profile: DocumentReference, actor: Actor, values: z.infer<typeof appointmentInput>, id?: string, now = Date.now()) {
  const collection = profile.collection('appointments')
  const ref = id ? collection.doc(id) : collection.doc()
  const [day, time] = values.localStart.split('T')
  let startsAt: number
  try { startsAt = localInstant(day, time, values.timezone) } catch { throw new ApiError(400, 'Enter a valid appointment date and time.') }
  if (startsAt <= now || startsAt > now + 2 * 366 * DAY) throw new ApiError(400, 'Choose a future appointment date within the next two years.')
  return db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner', 'editor'])
    const previous = id ? (await tx.get(ref)).data() as Appointment | undefined : undefined
    if (id && !previous) throw new ApiError(404, 'Appointment no longer exists.')
    if (!id && (await tx.get(collection.where('startsAt', '>=', now).limit(80))).size >= 80) throw new ApiError(409, 'This profile has reached the upcoming appointment limit.')
    const appointment: Appointment = { id: ref.id, title: values.title, location: values.location,
      timezone: values.timezone, startsAt, revision: (previous?.revision ?? 0) + 1 }
    tx.set(ref, appointment)
    tx.set(jobRef(`appointment_${ref.id}`), { kind: 'appointment', profileId: profile.id, refId: ref.id, revision: appointment.revision, nextAt: Math.max(now, startsAt - DAY) } satisfies Job)
    audit(tx, profile, id ? 'appointment.updated' : 'appointment.created', now, actor)
    return appointment
  })
}

export async function deleteAppointment(profile: DocumentReference, actor: Actor, id: string, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner', 'editor'])
    const ref = profile.collection('appointments').doc(id)
    if (!(await tx.get(ref)).exists) return
    tx.delete(ref)
    tx.delete(jobRef(`appointment_${id}`))
    audit(tx, profile, 'appointment.deleted', now, actor)
  })
}

export async function respondToDose(profile: DocumentReference, actor: Actor, id: string, values: z.infer<typeof doseInput>, now = Date.now()) {
  const ref = profile.collection('doseEvents').doc(id)
  return db().runTransaction(async (tx) => {
    const { data } = await access(tx, profile, actor, ['owner', 'editor'])
    const dose = (await tx.get(ref)).data() as (Dose & { revision: number }) | undefined
    if (!dose) throw new ApiError(404, 'Check-in does not exist.')
    const { action, expectedStatus, expectedSnoozes } = values
    if (dose.status !== expectedStatus || dose.snoozes !== expectedSnoozes) {
      if (dose.status === action && dose.snoozes === expectedSnoozes + Number(action === 'snoozed')) return dose
      throw new ApiError(409, 'This check-in changed. Refresh and try again.')
    }
    if (dose.status === 'taken' || dose.status === 'skipped') {
      if (dose.status === action) return dose
      throw new ApiError(409, 'This check-in is already recorded.')
    }
    if (now < dose.activeAt - 10 * MINUTE || (dose.status === 'snoozed' && now < dose.activeAt)) throw new ApiError(409, 'This check-in is not due yet.')
    const med = (await tx.get(profile.collection('medications').doc(dose.medicationId))).data() as Medication | undefined
    if (dose.status !== 'missed' && (!med || med.revision !== dose.revision)) throw new ApiError(409, 'This schedule changed. Refresh to see the current routine.')
    if (action === 'snoozed' && (dose.status === 'missed' || dose.snoozes >= MAX_SNOOZES)) throw new ApiError(409, 'This check-in cannot be postponed again.')
    const snoozed = action === 'snoozed'
    const activeAt = snoozed ? now + 15 * MINUTE : dose.activeAt
    const updated = { ...dose, status: action, respondedAt: now, snoozes: dose.snoozes + Number(snoozed), activeAt,
      missedAt: snoozed ? activeAt + data.graceMinutes * MINUTE : dose.missedAt }
    tx.set(ref, updated)
    const activityId = `${id}_${action}_${updated.snoozes}`
    tx.create(profile.collection('activity').doc(activityId), { id: activityId, kind: action, label: dose.medicationName, at: now } satisfies Activity)
    const reminder = { profileId: profile.id, refId: id, revision: dose.revision }
    if (snoozed) {
      tx.set(jobRef(`dose_${id}`), { ...reminder, kind: 'dose', nextAt: updated.activeAt } satisfies Job)
      tx.set(jobRef(`missed_${id}`), { ...reminder, kind: 'missed', nextAt: updated.missedAt } satisfies Job)
    } else {
      tx.delete(jobRef(`dose_${id}`))
      tx.delete(jobRef(`missed_${id}`))
    }
    audit(tx, profile, `dose.${action}`, now, actor)
    return updated
  })
}
