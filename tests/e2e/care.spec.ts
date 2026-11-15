import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { localDay, MINUTE, toLocalInput } from '../../src/lib/time'

const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST
const ownerEmail = process.env.SAATHICARE_TEST_OWNER_EMAIL
const caregiverEmail = process.env.SAATHICARE_TEST_CAREGIVER_EMAIL
const configuredPassword = process.env.SAATHICARE_TEST_PASSWORD

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/care')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Set up a care circle' })).toBeVisible()
}

test('verified users create a routine and a read-only caregiver joins by passcode', async ({ page, browser }) => {
  test.skip(!emulator && !(ownerEmail && caregiverEmail && configuredPassword), 'Needs Firebase emulators or two fresh, verified synthetic accounts.')
  test.setTimeout(90_000)
  const password = configuredPassword || `Care-test-${randomUUID()}`
  const owner = ownerEmail || `owner-${randomUUID()}@example.test`
  const caregiver = caregiverEmail || `caregiver-${randomUUID()}@example.test`
  if (emulator) {
    const projectId = process.env.FIREBASE_PROJECT_ID || ''
    if (!projectId.startsWith('demo-')) throw new Error('Use a demo project with the emulators.')
    const admin = getAuth(getApps()[0] ?? initializeApp({ projectId }))
    await Promise.all([admin.createUser({ email: owner, password, emailVerified: true }), admin.createUser({ email: caregiver, password, emailVerified: true })])
  }

  await signIn(page, owner, password)
  const now = Date.now()
  const due = now + 7 * MINUTE
  const zone = localDay(now, 'Asia/Kolkata') === localDay(due, 'Asia/Kolkata') ? 'Asia/Kolkata' : 'UTC'
  await page.getByLabel('Your display name').fill('Fictional Smoke Profile')
  await page.getByLabel('Timezone').fill(zone)
  await page.getByRole('button', { name: 'Create profile' }).click()
  await expect(page.getByRole('heading', { name: 'Hello, Fictional.' })).toBeVisible()
  await page.getByRole('button', { name: 'My routine' }).click()
  await page.getByRole('button', { name: 'Add medication' }).click()
  await page.getByLabel('Medication name').fill('Example tablet')
  await page.getByLabel('Dose times').fill(toLocalInput(due, zone).split('T')[1])
  await page.getByRole('button', { name: 'Save medication' }).click()
  await expect(page.getByRole('status')).toContainText('Medication saved.')
  await page.getByRole('button', { name: 'Add appointment' }).click()
  await page.getByLabel('Visit name').fill('Fictional clinic visit')
  await page.getByLabel('Location').fill('Example clinic')
  await page.getByLabel('Local date and time').fill(toLocalInput(now + 120 * MINUTE, zone))
  await page.getByRole('button', { name: 'Save appointment' }).click()
  await expect(page.getByRole('status')).toContainText('Appointment saved.')
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('button', { name: 'Taken', exact: true }).click()
  await expect(page.getByText('1 of 1 marked taken')).toBeVisible()
  await page.getByRole('button', { name: 'Open care summary' }).click()
  await expect(page.getByText('Record-based summary. No AI was used.')).toBeVisible()

  await page.getByRole('button', { name: 'Care circle', exact: true }).click()
  await page.getByRole('button', { name: 'Invite caregiver' }).click()
  await page.getByLabel('Caregiver email').fill(caregiver)
  await page.getByRole('button', { name: 'Create passcode' }).click()
  const passcode = await page.locator('.passcode').innerText()
  await page.getByRole('button', { name: 'Close passcode' }).click()
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const second = await context.newPage()
    await signIn(second, caregiver, password)
    await second.getByLabel('Invitation passcode').fill(passcode)
    await second.getByRole('button', { name: 'Join care circle' }).click()
    await expect(second.getByRole('heading', { name: 'Fictional’s care today' })).toBeVisible()
    await second.getByRole('button', { name: 'Shared routine' }).click()
    await expect(second.getByText('Fictional clinic visit')).toBeVisible()
    await expect(second.getByRole('button', { name: 'Add medication' })).toHaveCount(0)
    await second.getByRole('button', { name: 'Care circle', exact: true }).click()
    await second.getByRole('button', { name: 'Turn on alert emails' }).click()
    await expect(second.getByRole('button', { name: 'Turn off alert emails' })).toBeVisible()
  } finally { await context.close() }

  if (process.env.SAATHICARE_TEST_GEMINI === '1') {
    await page.getByLabel('Let Gemini select event types for care handoffs').check()
    await page.getByRole('button', { name: 'Save preferences' }).click()
    await expect(page.getByRole('status')).toContainText('Care preferences saved.')
    await page.getByRole('button', { name: 'Care handoff' }).click()
    await page.getByRole('button', { name: /summary/i }).click()
    await expect(page.getByText('Gemini selected these source records.', { exact: false })).toBeVisible({ timeout: 20_000 })
  }
})
