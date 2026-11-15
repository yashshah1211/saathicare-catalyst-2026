import { timingSafeEqual } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { ApiError, failure, json } from '@/lib/server/platform'
import { runReminders } from '@/lib/server/reminders'

const oidc = new OAuth2Client()
export const maxDuration = 120

async function authorized(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/i)?.[1]
  if (!token || token.length > 8192) return false
  const { DEV_SCHEDULER_KEY: dev, SCHEDULER_AUDIENCE: audience, SCHEDULER_SERVICE_ACCOUNT: email } = process.env
  if (process.env.NODE_ENV === 'development' && dev && Buffer.byteLength(dev) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(dev), Buffer.from(token))) return true
  if (!audience || !email) return false
  try {
    const payload = (await oidc.verifyIdToken({ idToken: token, audience })).getPayload()
    return payload?.email === email && payload.email_verified === true
  } catch { return false }
}

export async function POST(request: Request) {
  try {
    if (!await authorized(request)) throw new ApiError(401, 'Scheduler authentication required.')
    const result = await runReminders()
    console.info('SaathiCare reminder tick', result)
    return json(result, result.errors ? 503 : 200)
  } catch (error) { return failure(error) }
}
