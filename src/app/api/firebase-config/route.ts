import { json } from '@/lib/server/platform'

export function GET() {
  const { FIREBASE_WEB_API_KEY: apiKey, FIREBASE_PROJECT_ID: projectId, FIREBASE_AUTH_DOMAIN: authDomain, FIREBASE_WEB_APP_ID: appId } = process.env
  const authEmulatorHost = process.env.NODE_ENV === 'development' ? process.env.FIREBASE_AUTH_EMULATOR_HOST : undefined
  if (!projectId || (!apiKey && !authEmulatorHost)) return json({ enabled: false })
  return json({ enabled: true, apiKey: apiKey || 'local-emulator', projectId, authDomain, appId, authEmulatorHost })
}
