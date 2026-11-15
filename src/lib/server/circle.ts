import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { DocumentReference } from 'firebase-admin/firestore'
import type { Activity, Invitation, Member, Notification } from '../model'
import { DAY, MINUTE } from '../time'
import { ApiError, type Actor, db } from './platform'
import { access, audit, inbox, membershipIndex, profileRef, requireVerified } from './store'

interface StoredInvite extends Invitation { secretHash: string; attempts: number }

function digest(secret: string) { return createHash('sha256').update(secret).digest() }

export async function invite(profile: DocumentReference, actor: Actor, email: string, role: 'editor' | 'viewer', now = Date.now()) {
  const codeId = randomBytes(12).toString('base64url')
  const secret = randomBytes(16).toString('base64url')
  const invitation: StoredInvite = { id: codeId, email, role, expiresAt: now + 2 * DAY, state: 'open', secretHash: digest(secret).toString('hex'), attempts: 0 }
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner'])
    if (actor.email === email) throw new ApiError(400, 'Choose a different email address.')
    const active = await tx.get(profile.collection('invitations').where('expiresAt', '>', now).limit(40))
    if (active.size >= 40) throw new ApiError(409, 'Too many recent invitations. Try again after an invitation expires.')
    tx.create(profile.collection('invitations').doc(codeId), invitation)
    tx.create(db().collection('invitationLookup').doc(codeId), { profileId: profile.id })
    audit(tx, profile, 'invitation.created', now, actor)
  })
  return { code: `${codeId}.${secret}`, expiresAt: invitation.expiresAt }
}

export async function revoke(profile: DocumentReference, actor: Actor, id: string, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner'])
    const ref = profile.collection('invitations').doc(id)
    const snapshot = await tx.get(ref)
    if (snapshot.get('state') !== 'open') return
    tx.update(ref, { state: 'revoked' })
    tx.delete(db().collection('invitationLookup').doc(id))
    audit(tx, profile, 'invitation.revoked', now, actor)
  })
}

export async function accept(actor: Actor, code: string, now = Date.now()) {
  requireVerified(actor)
  const [id, secret] = code.split('.')
  const rateRef = db().collection('users').doc(actor.uid).collection('limits').doc('invitations')
  const result = await db().runTransaction(async (tx) => {
    const rate = await tx.get(rateRef)
    const window = Math.floor(now / (15 * MINUTE))
    const attempts = rate.get('window') === window ? Number(rate.get('attempts')) : 0
    if (attempts >= 10) return { status: 429 } as const
    const lookup = await tx.get(db().collection('invitationLookup').doc(id))
    const profileId = lookup.get('profileId') as string | undefined
    if (!profileId) {
      tx.set(rateRef, { window, attempts: attempts + 1 })
      return { status: 400 } as const
    }
    const profile = profileRef(profileId)
    const ref = profile.collection('invitations').doc(id)
    const [invitationRecord, profileRecord] = await Promise.all([tx.get(ref), tx.get(profile)])
    const record = invitationRecord.data() as StoredInvite | undefined
    if (!record || !profileRecord.exists || record.email !== actor.email || record.state !== 'open' || now >= record.expiresAt) {
      tx.set(rateRef, { window, attempts: attempts + 1 })
      return { status: 400 } as const
    }
    if (!timingSafeEqual(digest(secret), Buffer.from(record.secretHash, 'hex'))) {
      const count = record.attempts + 1
      tx.update(ref, { attempts: count, state: count >= 5 ? 'locked' : 'open' })
      tx.set(rateRef, { window, attempts: attempts + 1 })
      if (count >= 5) {
        tx.delete(lookup.ref)
        audit(tx, profile, 'invitation.locked', now, actor)
      }
      return { status: 400 } as const
    }
    const memberships = profile.collection('memberships')
    const [existing, memberCount] = await Promise.all([tx.get(memberships.doc(actor.uid)), tx.get(memberships.limit(21))])
    if (!existing.exists && memberCount.size >= 21) return { status: 409 } as const
    tx.update(ref, { state: 'used', usedAt: now })
    tx.delete(lookup.ref)
    if (!existing.exists) {
      tx.create(memberships.doc(actor.uid), { id: actor.uid, feedId: id, role: record.role, email: actor.email, optedIn: false } satisfies Member)
      tx.set(membershipIndex(actor.uid, profileId), { joinedAt: now })
    }
    audit(tx, profile, 'invitation.accepted', now, actor)
    return { profileId } as const
  })
  if ('profileId' in result) return { profileId: result.profileId }
  if (result.status === 429) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.')
  if (result.status === 409) throw new ApiError(409, 'This care circle has reached its member limit.')
  throw new ApiError(400, 'This invitation is invalid, expired, or assigned to a different email.')
}

export async function optIn(profile: DocumentReference, actor: Actor, optedIn: boolean, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['editor', 'viewer'])
    tx.update(profile.collection('memberships').doc(actor.uid), { optedIn, email: actor.email })
    audit(tx, profile, 'member.preferences.updated', now, actor)
  })
}

export async function removeMember(profile: DocumentReference, actor: Actor, id: string, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    await access(tx, profile, actor, ['owner'])
    if (id === actor.uid) throw new ApiError(400, 'The profile owner cannot be removed.')
    const ref = profile.collection('memberships').doc(id)
    const member = await tx.get(ref)
    if (!member.exists) return
    tx.delete(ref)
    tx.delete(membershipIndex(id, profile.id))
    audit(tx, profile, 'member.removed', now, actor)
  })
}

export async function acknowledge(profile: DocumentReference, actor: Actor, id: string, now = Date.now()) {
  await db().runTransaction(async (tx) => {
    const { member } = await access(tx, profile, actor, ['editor', 'viewer'])
    const ref = inbox(profile, member).doc(id)
    const notification = (await tx.get(ref)).data() as Notification | undefined
    if (!notification || notification.kind !== 'missed') throw new ApiError(404, 'Care circle alert does not exist.')
    if (notification.acknowledgedAt) return
    tx.update(ref, { acknowledgedAt: now })
    const activityId = `${id}_ack`
    tx.create(profile.collection('activity').doc(activityId), { id: activityId, kind: 'acknowledged', label: notification.label, at: now } satisfies Activity)
    audit(tx, profile, 'notification.acknowledged', now, actor)
  })
}
