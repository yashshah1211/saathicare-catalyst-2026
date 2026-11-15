import { GoogleGenAI, Type } from '@google/genai'
import { z } from 'zod'
import type { DocumentReference } from 'firebase-admin/firestore'
import type { Activity, Appointment, Handoff } from '../model'
import { DAY } from '../time'
import { db, type Actor } from './platform'
import { access, audit } from './store'

export async function handoff(profile: DocumentReference, actor: Actor, now = Date.now()): Promise<Handoff> {
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  const key = process.env.GEMINI_API_KEY
  const project = process.env.GEMINI_VERTEX_PROJECT
  const { items, allowed } = await db().runTransaction(async (tx) => {
    const { data } = await access(tx, profile, actor)
    const quotaRef = profile.collection('limits').doc('handoff')
    const configured = data.aiConsent && !!(key || project)
    const [activity, upcoming, quota] = await Promise.all([
      tx.get(profile.collection('activity').where('at', '>=', now - 2 * DAY).orderBy('at', 'desc').limit(12)),
      tx.get(profile.collection('appointments').where('startsAt', '>=', now).orderBy('startsAt').limit(1)),
      configured ? tx.get(quotaRef) : null,
    ])
    const eventItems = activity.docs.map((doc) => doc.data() as Activity)
    const appointment = upcoming.docs[0]?.data() as Appointment | undefined
    const items = [...eventItems, ...(appointment ? [{ id: appointment.id, kind: 'appointment', label: appointment.title, at: appointment.startsAt } satisfies Activity] : [])]
    const day = Math.floor(now / DAY)
    const used = quota?.get('day') === day ? Number(quota.get('count')) : 0
    const allowed = configured && used < 8 && items.length > 0
    if (allowed) {
      tx.set(quotaRef, { day, count: used + 1 })
      audit(tx, profile, 'handoff.gemini.requested', now, actor)
    }
    return { allowed, items }
  })

  const next = items.find((item) => item.kind === 'appointment')
  const recent = items.filter((item) => item.kind !== 'appointment')
  const missed = recent.find((item) => item.kind === 'missed')
  const fallback = [...new Set([missed, ...recent.slice(0, 3), next].filter((item) => item !== undefined))]
  if (!allowed) return { mode: 'records', items: fallback }

  try {
    const ai = new GoogleGenAI(key ? { apiKey: key } : { vertexai: true, project, location: 'global', apiVersion: 'v1' })
    // Send only categories and ephemeral positions. Render language from the selected records locally.
    const candidates = items.map((item, i) => ({ source: i, event: item.kind }))
    const result = await ai.models.generateContent({
      model,
      contents: JSON.stringify(candidates),
      config: {
        abortSignal: AbortSignal.timeout(12_000),
        systemInstruction: 'Select up to five source numbers for a caregiver handoff from this list of already-recorded events. Prioritize a missed check-in and the next appointment if present, then recent actions. Lower numbers represent newer past events. Return only JSON with the source numbers in presentation order. Do not interpret clinical risk or give advice.',
        responseMimeType: 'application/json',
        responseSchema: { type: Type.OBJECT, required: ['sources'], properties: { sources: { type: Type.ARRAY, items: { type: Type.INTEGER } } } },
      },
    })
    const { sources } = z.object({ sources: z.array(z.number().int().min(0).max(items.length - 1)).min(1).max(5) }).strict().parse(JSON.parse(result.text ?? ''))
    const selected = [...new Set(sources)].map((i) => items[i])
    for (const essential of [missed, next]) if (essential && !selected.includes(essential)) return { mode: 'records', items: fallback }
    return { mode: 'gemini', items: selected }
  } catch {
    console.warn('SaathiCare Gemini handoff unavailable')
    return { mode: 'records', items: fallback }
  }
}
