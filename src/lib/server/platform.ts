import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { z } from 'zod'

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

function admin() {
  if (process.env.K_SERVICE && (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new ApiError(503, 'Firebase emulators are unavailable on Cloud Run.')
  }
  if (getApps().length) return getApp()
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) throw new ApiError(503, 'Firebase is not configured. You can still explore the demo.')
  return initializeApp({ projectId, credential: applicationDefault() })
}

export function db() { return getFirestore(admin()) }
export function auth() { return getAuth(admin()) }

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.REMINDER_FROM_EMAIL && process.env.APP_URL)
}

export interface Actor { uid: string; email: string; verified: boolean }

export async function authenticate(request: Request): Promise<Actor> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/i)?.[1]
  if (!bearer || bearer.length > 8192) throw new ApiError(401, 'Sign in to continue.')
  const firebaseAuth = auth()
  try {
    const token = await firebaseAuth.verifyIdToken(bearer, true)
    return { uid: token.uid, email: (token.email ?? '').toLowerCase(), verified: token.email_verified === true }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && [
      'auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token', 'auth/argument-error',
      'auth/user-disabled', 'auth/user-not-found',
    ].includes(String(error.code))) throw new ApiError(401, 'Your session expired. Sign in again.')
    throw error
  }
}

export async function input<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'Expected JSON.')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'Missing request body.')
  const decoder = new TextDecoder()
  let bytes = 0
  let raw = ''
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > 16_384) {
      await reader.cancel()
      throw new ApiError(413, 'Request is too large.')
    }
    raw += decoder.decode(part.value, { stream: true })
  }
  let data: unknown
  try { data = JSON.parse(raw + decoder.decode()) } catch { throw new ApiError(400, 'Invalid JSON.') }
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join('.')
    throw new ApiError(400, field ? `${field}: ${issue.message}` : 'Check the submitted fields.')
  }
  return parsed.data
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function failure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status)
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'unexpected'
  console.error('SaathiCare request failed', { code: /^[\w/-]{1,60}$/.test(code) ? code : 'unexpected' })
  return json({ error: 'Service temporarily unavailable. Try again.' }, 503)
}
