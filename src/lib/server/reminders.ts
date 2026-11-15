import { randomUUID } from 'node:crypto'
import type { DocumentReference, Transaction } from 'firebase-admin/firestore'
import type { Activity, Appointment, Dose, Medication, Member, Notification, Profile } from '../model'
import { MINUTE, nextDay } from '../time'
import { createEmailDelivery, type Delivery } from './email'
import { auth, db, emailConfig } from './platform'
import { audit, inbox, type Job, jobRef, profileRef, rollMedication, scheduleDay } from './store'

interface Mail extends Notification {
  uid: string
  to: string
  sourceId: string
  revision: number
  slot: number
  firstAttemptAt?: number
  deliveryProvider?: Delivery['provider']
  lease?: string
  attempts: number
}

async function prepareMail(tx: Transaction, profile: DocumentReference, member: Member, kind: Mail['kind'], source: { id: string; occurrence: string; label: string; revision: number; slot: number }, now: number) {
  const id = `${kind}_${source.occurrence}_${source.slot}_${member.feedId}`
  const ref = inbox(profile, member).doc(id)
  const existing = (await tx.get(ref)).data() as Mail | undefined
  const mail: Mail = { id, kind, at: now, label: source.label, status: 'queued', uid: member.id, to: member.email,
    sourceId: source.id, revision: source.revision, slot: source.slot, attempts: 0 }
  return () => {
    // An edit to details can replace an unclaimed email. A previously attempted email retains its key and result.
    if (existing && (existing.firstAttemptAt !== undefined || !['queued', 'canceled'].includes(existing.status))) return
    tx.set(ref, mail)
    tx.set(jobRef(`mail_${id}`), { profileId: profile.id, refId: id, kind: 'mail', nextAt: now, feedId: member.feedId } satisfies Job)
  }
}

async function materialize(jobDoc: DocumentReference, now: number) {
  return db().runTransaction(async (tx) => {
    const job = (await tx.get(jobDoc)).data() as Job | undefined
    if (!job || job.nextAt > now || job.kind === 'mail') return
    const profile = profileRef(job.profileId)
    const data = (await tx.get(profile)).data() as Profile | undefined
    if (!data) { tx.delete(jobDoc); return }

    if (job.kind === 'roll') {
      const med = (await tx.get(profile.collection('medications').doc(job.refId))).data() as Medication | undefined
      if (!med || med.revision !== job.revision) { tx.delete(jobDoc); return }
      scheduleDay(tx, profile, med, job.day, now, data.graceMinutes)
      rollMedication(tx, profile, med, nextDay(job.day))
      return
    }

    if (job.kind === 'appointment') {
      const appointment = (await tx.get(profile.collection('appointments').doc(job.refId))).data() as Appointment | undefined
      const owner = data.appointmentEmail ? (await tx.get(profile.collection('memberships').doc(data.ownerId))).data() as Member | undefined : undefined
      if (owner && appointment?.revision === job.revision && appointment.startsAt > now) {
        const enqueue = await prepareMail(tx, profile, owner, 'appointment', {
          id: appointment.id, occurrence: `${appointment.id}_${appointment.startsAt}`, label: appointment.title, revision: job.revision, slot: 0,
        }, now)
        enqueue()
      }
      tx.delete(jobDoc)
      return
    }

    const ref = profile.collection('doseEvents').doc(job.refId)
    const dose = (await tx.get(ref)).data() as (Dose & { revision: number }) | undefined
    if (!dose || (dose.status !== 'pending' && dose.status !== 'snoozed')) { tx.delete(jobDoc); return }
    const med = (await tx.get(profile.collection('medications').doc(dose.medicationId))).data() as Medication | undefined
    if (!med || med.revision !== job.revision || dose.revision !== job.revision) { tx.delete(jobDoc); return }

    const source = { id: dose.id, occurrence: `${dose.medicationId}_${dose.dueAt}`, label: dose.medicationName, revision: job.revision, slot: dose.snoozes }
    if (job.kind === 'dose') {
      const owner = data.doseEmail && now < dose.missedAt ? (await tx.get(profile.collection('memberships').doc(data.ownerId))).data() as Member | undefined : undefined
      if (owner) {
        const enqueue = await prepareMail(tx, profile, owner, 'dose', source, now)
        enqueue()
      }
    } else {
      const recipients = data.escalation ? await tx.get(profile.collection('memberships').where('optedIn', '==', true).limit(20)) : null
      const caregivers = (recipients?.docs ?? []).map((record) => record.data() as Member).filter((member) => member.role !== 'owner')
      const alerts = await Promise.all(caregivers.map((member) => prepareMail(tx, profile, member, 'missed', source, now)))
      tx.update(ref, { status: 'missed' })
      const id = `${dose.id}_missed`
      tx.create(profile.collection('activity').doc(id), { id, kind: 'missed', label: dose.medicationName, at: now } satisfies Activity)
      for (const enqueue of alerts) enqueue()
      audit(tx, profile, 'dose.missed', now)
    }
    tx.delete(jobDoc)
  })
}

async function stillRelevant(tx: Transaction, profile: DocumentReference, data: Profile, member: Member, mail: Mail, now: number) {
  if (mail.kind === 'missed') return data.escalation && member.role !== 'owner' && member.optedIn
  if (member.role !== 'owner') return false
  if (mail.kind === 'appointment') {
    if (!data.appointmentEmail) return false
    const appt = (await tx.get(profile.collection('appointments').doc(mail.sourceId))).data() as Appointment | undefined
    return appt?.revision === mail.revision && appt.startsAt > now
  }
  if (!data.doseEmail) return false
  const dose = (await tx.get(profile.collection('doseEvents').doc(mail.sourceId))).data() as Dose | undefined
  if (!dose || !['pending', 'snoozed'].includes(dose.status) || dose.snoozes !== mail.slot || now >= dose.missedAt) return false
  const med = (await tx.get(profile.collection('medications').doc(dose.medicationId))).data() as Medication | undefined
  return med?.revision === mail.revision
}

async function claim(jobDoc: DocumentReference, now: number, provider?: Delivery['provider']) {
  return db().runTransaction(async (tx) => {
    const job = (await tx.get(jobDoc)).data() as Job | undefined
    if (!job || job.kind !== 'mail' || job.nextAt > now) return null
    const profile = profileRef(job.profileId)
    const ref = profile.collection('notificationFeeds').doc(job.feedId).collection('notifications').doc(job.refId)
    const mail = (await tx.get(ref)).data() as Mail | undefined
    if (!mail || mail.status !== 'queued') { tx.delete(jobDoc); return null }
    const [dataRecord, memberRecord] = await Promise.all([tx.get(profile), tx.get(profile.collection('memberships').doc(mail.uid))])
    const data = dataRecord.data() as Profile | undefined
    const member = memberRecord.data() as Member | undefined
    const relevant = data && member?.feedId === job.feedId && member.email === mail.to && await stillRelevant(tx, profile, data, member, mail, now)
    // Only Resend can replay an attempted send, on the same provider and within its idempotency window.
    const attemptedAt = mail.firstAttemptAt
    const canReplay = attemptedAt === undefined || (provider === 'resend' && (mail.deliveryProvider ?? 'resend') === provider
      && now - attemptedAt < 20 * 60 * MINUTE)
    if (!relevant || !canReplay || !provider) {
      const unsentStatus = relevant ? 'failed' : 'canceled'
      tx.update(ref, { status: attemptedAt === undefined ? unsentStatus : 'uncertain' })
      tx.delete(jobDoc)
      return null
    }
    const lease = randomUUID()
    const attempt = provider === 'resend' ? { deliveryProvider: provider, firstAttemptAt: mail.firstAttemptAt ?? now } : {}
    tx.update(ref, { lease, attempts: mail.attempts + 1, ...attempt })
    tx.update(jobDoc, { nextAt: now + 2 * MINUTE })
    return { mail, ref, lease }
  })
}

async function startSmtpAttempt(ref: DocumentReference, lease: string, now: number) {
  return db().runTransaction(async (tx) => {
    const record = await tx.get(ref)
    if (record.get('lease') !== lease || record.get('status') !== 'queued' || record.get('firstAttemptAt') !== undefined) return false
    // Commit an irreversible attempt before SMTP. A crash after this write cannot cause a second send.
    tx.update(ref, { deliveryProvider: 'gmail', firstAttemptAt: now })
    return true
  })
}

async function dispatch(jobDoc: DocumentReference, now: number, delivery: Delivery | null, checkAddress: (uid: string, email: string) => Promise<boolean>) {
  const claimed = await claim(jobDoc, now, delivery?.provider)
  if (!claimed || !delivery) return
  const { mail, ref, lease } = claimed
  let result: Awaited<ReturnType<Delivery['send']>> | 'canceled' = 'retry'
  let smtpStarted = false
  try {
    if (!await checkAddress(mail.uid, mail.to)) {
      result = 'canceled'
    } else if (delivery.provider === 'gmail') {
      smtpStarted = await startSmtpAttempt(ref, lease, now)
      if (!smtpStarted) return
      result = await delivery.send(mail)
    } else {
      result = await delivery.send(mail)
    }
  } catch {
    result = smtpStarted ? 'uncertain' : 'retry'
  }
  await db().runTransaction(async (tx) => {
    const record = await tx.get(ref)
    if (record.get('lease') !== lease || record.get('status') !== 'queued') return
    if (result === 'retry') {
      const backoff = Math.min(120, 2 ** Math.min(mail.attempts + 1, 7))
      tx.update(jobDoc, { nextAt: now + backoff * MINUTE })
      return
    }
    tx.update(ref, { status: result === 'canceled' && mail.firstAttemptAt !== undefined ? 'uncertain' : result })
    tx.delete(jobDoc)
  })
}

async function verifiedAddress(uid: string, email: string) {
  try {
    const user = await auth().getUser(uid)
    return !user.disabled && user.emailVerified && user.email?.toLowerCase() === email
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'auth/user-not-found') return false
    throw error
  }
}

export async function runReminders(now = Date.now(), delivery = createEmailDelivery(emailConfig()), checkAddress = verifiedAddress) {
  let evaluated = 0
  let errors = 0
  for (let batch = 0; batch < 5; batch++) {
    const due = await db().collection('reminderJobs').where('nextAt', '<=', now).orderBy('nextAt').limit(12).get()
    if (due.empty) break
    const results = await Promise.allSettled(due.docs.map((doc) => doc.get('kind') === 'mail'
      ? dispatch(doc.ref, now, delivery, checkAddress) : materialize(doc.ref, now)))
    evaluated += results.length
    errors += results.filter((result) => result.status === 'rejected').length
    if (errors) break
  }
  return { evaluated, errors, emailConfigured: delivery !== null }
}
