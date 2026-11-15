import { z } from 'zod'
import { validTimezone } from './time'

const name = z.string().trim().min(1).max(90)
const timezone = z.string().max(65).refine(validTimezone, 'Enter a valid IANA timezone, such as Asia/Kolkata.')
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,180}$/)
export const profileInput = z.object({ name, timezone }).strict()
export const settingsInput = z.object({
  doseEmail: z.boolean(), appointmentEmail: z.boolean(), escalation: z.boolean(), aiConsent: z.boolean(),
  graceMinutes: z.number().int().min(15).max(180),
}).strict()
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const medicationInput = z.object({
  name, instructions: z.string().trim().max(220), timezone,
  times: z.array(time).min(1).max(8).refine((times) => new Set(times).size === times.length, 'Enter each dose time once.'),
}).strict()
export const appointmentInput = z.object({
  title: name, location: z.string().trim().max(160), timezone,
  localStart: z.string().regex(/^20\d\d-\d\d-\d\dT\d\d:\d\d$/),
}).strict()
export const inviteInput = z.object({ email: z.email().trim().toLowerCase().max(254), role: z.enum(['editor', 'viewer']) }).strict()
export const acceptInput = z.object({ code: z.string().trim().regex(/^[\w-]{16}\.[\w-]{22}$/) }).strict()
export const doseInput = z.object({ action: z.enum(['taken', 'snoozed', 'skipped']), expectedStatus: z.enum(['pending', 'taken', 'snoozed', 'skipped', 'missed']), expectedSnoozes: z.number().int().min(0).max(3) }).strict()
export const optInInput = z.object({ optedIn: z.boolean() }).strict()
