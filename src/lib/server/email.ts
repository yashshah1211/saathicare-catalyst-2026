import { createTransport } from 'nodemailer'
import { z } from 'zod'
import type { Notification } from '../model'
import type { EmailConfig } from './platform'

type Email = { id: string; to: string; kind: Notification['kind'] }
type Outcome = 'sent' | 'failed'

export type Delivery =
  | { provider: 'gmail'; send: (mail: Email) => Promise<Outcome | 'uncertain'> }
  | { provider: 'resend'; send: (mail: Email) => Promise<Outcome | 'retry'> }

const emailCopy = {
  dose: ['A SaathiCare check-in is coming up', 'Open SaathiCare to review and record your scheduled check-in.'],
  appointment: ['A SaathiCare appointment is coming up', 'Open SaathiCare to view your upcoming appointment.'],
  missed: ['A SaathiCare check-in needs attention', 'A shared care circle has a missed check-in. Open SaathiCare to review the alert and acknowledge it.'],
} as const

function messageContent(kind: Email['kind'], careUrl: string) {
  const [subject, message] = emailCopy[kind]
  return { subject, text: `${message}\n\n${careUrl}\n\nManage email preferences in your care circle.` }
}

function isSmtpRejection(error: unknown) {
  if (!error || typeof error !== 'object' || !('responseCode' in error) || !('command' in error)) return false
  const { responseCode, command } = error
  return typeof responseCode === 'number' && responseCode >= 400 && responseCode < 600
    && typeof command === 'string' && /^(?:AUTH(?: .+)?|MAIL FROM|RCPT TO|DATA)$/.test(command)
}

export function createEmailDelivery(config: EmailConfig | null): Delivery | null {
  if (!config) return null
  if (config.provider === 'gmail') {
    const transport = createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true, pool: false,
      auth: { user: config.user, pass: config.appPassword },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    })
    return {
      provider: 'gmail',
      async send(mail) {
        if (!z.email().safeParse(mail.to).success) return 'failed'
        try {
          const info = await transport.sendMail({
            from: config.user, to: mail.to, ...messageContent(mail.kind, config.careUrl), signal: AbortSignal.timeout(15_000),
          })
          return info.accepted.length === 1 && info.accepted[0].toLowerCase() === mail.to.toLowerCase() ? 'sent' : 'uncertain'
        } catch (error) {
          // SMTP diagnostics can contain account or recipient details. Keep only the outcome.
          return isSmtpRejection(error) ? 'failed' : 'uncertain'
        }
      },
    }
  }

  return {
    provider: 'resend',
    async send(mail) {
      const result = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `saathicare/${mail.id}` },
        body: JSON.stringify({ from: config.from, to: [mail.to], ...messageContent(mail.kind, config.careUrl) }),
      })
      if (result.ok) {
        const body = await result.json()
        return typeof body.id === 'string' && body.id ? 'sent' : 'retry'
      }
      return result.status === 408 || result.status === 409 || result.status === 429 || result.status >= 500 ? 'retry' : 'failed'
    },
  }
}
