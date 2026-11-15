import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmailDelivery } from '../../src/lib/server/email'
import { emailConfig, emailConfigured } from '../../src/lib/server/platform'

const { createTransport, sendMail } = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ createTransport }))

const sender = 'fictional-sender@gmail.com'
const reminder = { id: 'fixture-reminder', to: 'recipient@example.test', kind: 'missed' as const, label: 'Private fixture label' }

describe('email provider configuration and Gmail SMTP', () => {
  beforeEach(() => {
    sendMail.mockReset()
    createTransport.mockReset().mockReturnValue({ sendMail })
    vi.stubEnv('REMINDER_EMAIL_ENABLED', 'true')
    vi.stubEnv('REMINDER_EMAIL_PROVIDER', 'gmail')
    vi.stubEnv('APP_URL', 'https://saathicare.example.test')
    vi.stubEnv('GMAIL_SMTP_USER', sender)
    vi.stubEnv('GMAIL_SMTP_APP_PASSWORD', randomUUID())
    vi.stubEnv('RESEND_API_KEY', randomUUID())
    vi.stubEnv('REMINDER_FROM_EMAIL', 'different-sender@example.test')
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ['REMINDER_EMAIL_ENABLED', undefined],
    ['REMINDER_EMAIL_ENABLED', 'false'],
    ['REMINDER_EMAIL_ENABLED', 'TRUE'],
    ['REMINDER_EMAIL_PROVIDER', undefined],
    ['REMINDER_EMAIL_PROVIDER', 'typo'],
    ['GMAIL_SMTP_USER', undefined],
    ['GMAIL_SMTP_USER', 'sender@example.test,other@example.test'],
    ['GMAIL_SMTP_APP_PASSWORD', '  '],
    ['APP_URL', 'http://saathicare.example.test'],
    ['APP_URL', 'not a URL'],
  ])('closes the sending gate for %s=%s', (name, value) => {
    vi.stubEnv(name, value)
    expect(emailConfigured()).toBe(false)
    expect(createEmailDelivery(emailConfig())).toBeNull()
    expect(createTransport).not.toHaveBeenCalled()
  })

  it('recognizes Resend only when it is selected and configured', () => {
    vi.stubEnv('REMINDER_EMAIL_PROVIDER', 'resend')
    expect(emailConfigured()).toBe(true)
    expect(createEmailDelivery(emailConfig())?.provider).toBe('resend')
    expect(createTransport).not.toHaveBeenCalled()
    vi.stubEnv('RESEND_API_KEY', undefined)
    expect(emailConfigured()).toBe(false)
  })

  it('uses TLS and the authenticated sender and sends only generic reminder content', async () => {
    expect(emailConfigured()).toBe(true)
    sendMail.mockResolvedValue({ accepted: [reminder.to] })
    const delivery = createEmailDelivery(emailConfig())!
    expect(delivery.provider).toBe('gmail')
    expect(await delivery.send(reminder)).toBe('sent')
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com', port: 465, secure: true, pool: false,
      auth: { user: sender, pass: expect.any(String) },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledWith({
      from: sender, to: reminder.to, subject: expect.stringContaining('SaathiCare'),
      text: expect.stringContaining('https://saathicare.example.test/care'), signal: expect.any(AbortSignal),
    })
    expect(sendMail.mock.calls[0][0].text).not.toContain(reminder.label)
    expect(sendMail.mock.calls[0][0].text).not.toContain(reminder.id)
  })

  it.each([
    [{ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }, 'failed'],
    [{ command: 'RCPT TO', responseCode: 450 }, 'failed'],
    [{ command: 'DATA', responseCode: 550 }, 'failed'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'uncertain'],
    [{ code: 'EABORT' }, 'uncertain'],
    [{ command: 'QUIT', responseCode: 421 }, 'uncertain'],
  ])('records a rejected or ambiguous transport result as %j → %s', async (failure, expected) => {
    sendMail.mockRejectedValue(failure)
    expect(await createEmailDelivery(emailConfig())?.send(reminder)).toBe(expected)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('requires explicit acceptance of the exact recipient', async () => {
    sendMail.mockResolvedValue({ accepted: ['other@example.test'] })
    expect(await createEmailDelivery(emailConfig())?.send(reminder)).toBe('uncertain')
  })

  it('refuses anything other than a single recipient address', async () => {
    const delivery = createEmailDelivery(emailConfig())!
    expect(await delivery.send({ ...reminder, to: 'one@example.test,two@example.test' })).toBe('failed')
    expect(sendMail).not.toHaveBeenCalled()
  })
})
