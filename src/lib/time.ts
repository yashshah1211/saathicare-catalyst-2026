import { Temporal } from '@js-temporal/polyfill'

export const MINUTE = 60_000
export const DAY = 24 * 60 * MINUTE
export const MAX_SNOOZES = 3

export function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function localDay(at: number, timezone: string) {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timezone).toPlainDate().toString()
}

export function nextDay(day: string) {
  return Temporal.PlainDate.from(day).add({ days: 1 }).toString()
}

export function localInstant(day: string, time: string, timezone: string) {
  return Temporal.PlainDateTime.from(`${day}T${time}`).toZonedDateTime(timezone, { disambiguation: 'compatible' }).epochMilliseconds
}

export function toLocalInput(at: number, timezone: string) {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timezone).toPlainDateTime().toString({ smallestUnit: 'minute' })
}

export function clockTime(at: number, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(at)
}

export function dayLabel(at: number, timezone: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(at)
}
