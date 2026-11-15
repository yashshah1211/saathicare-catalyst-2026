# SaathiCare

**Care that connects. Independence that lasts.** SaathiCare gives older adults a daily medication and appointment routine they can share with trusted caregivers. The older adult controls access, editing, and consent for caregiver alerts. Missed check-ins surface in a shared timeline, caregivers can acknowledge them, and care handoffs link back to the records behind each item.

- [Public Cloud Run app](https://saathicare-171294241490.asia-south1.run.app)
- [Interactive fictional demo](https://saathicare-171294241490.asia-south1.run.app/demo)
- [Submission description and 90-second script](SUBMISSION.md)

Production runs Cloud Run revision `saathicare-quality-0f2f7746` in Mumbai from [verified source commit `0f2f77461f8039004e9b9ddae2646b9096609658`](https://github.com/yashshah1211/saathicare-catalyst-2026/commit/0f2f77461f8039004e9b9ddae2646b9096609658). The controlled Gmail test reached the recipient’s inbox on the earlier SMTP revision. Automated reminder email is disabled in production, and the scheduled reminder-to-inbox journey remains unverified.

## Run locally

Use Node.js 22 or later. Firebase emulators also require Java 21.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000/demo` for the fictional demo. To use a Firebase project, copy `.env.example` to `.env.local`, set the Firebase web configuration and use Google Application Default Credentials for the server. Enable email/password sign-in and deploy `firestore.rules` before opening the app to users. The dashboard opens after email verification.

For isolated development, start the emulators in one terminal and run Next.js in another. Set `FIREBASE_PROJECT_ID=demo-saathicare`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8088` in `.env.local`. Authentication verification links appear in the emulator output. The `demo-` prefix keeps the emulator project independent from Google Cloud.

```sh
npx firebase-tools emulators:start --project demo-saathicare --only auth,firestore
npm run dev -- --webpack
```

## Verification

The [Node 22 workflow](.github/workflows/verify.yml) installs from the lockfile and runs TypeScript, ESLint, unit tests, and the production build. Run Firestore and browser tests with the emulator setup below.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

With `FIREBASE_PROJECT_ID=demo-saathicare` set in the environment:

```sh
npx firebase-tools emulators:exec --project demo-saathicare --only auth,firestore "npm run test:integration"
```

Use `SAATHICARE_TEST_URL` to point the browser smoke tests at a deployed service. For the full signed-in browser journey, run `npm run test:e2e` under the Firebase emulators with `FIREBASE_PROJECT_ID=demo-saathicare`. The browser suite otherwise runs the fictional demo journeys. Emulator integration tests cover Firestore transactions, timezone and recurrence logic, expiring and single-use invitations, role rejection, concurrent check-ins, and escalation and email idempotency with a controlled delivery result.

## Challenge coverage

| Challenge requirement | Implementation | Verification |
| --- | --- | --- |
| Medication schedules and adherence | [Schedule CRUD and check-ins](src/lib/server/store.ts), [timezone and DST rules](src/lib/time.ts), [elder dashboard](src/components/dashboard.tsx) | [Time unit tests](tests/unit/time.test.ts), [Firestore tests](tests/integration/care.test.ts), and [browser check-ins](tests/e2e/demo.spec.ts) cover scheduling, midnight snooze, and duplicate protection. |
| Doctor appointments | [Appointment CRUD](src/lib/server/store.ts) and [routine management](src/components/manage.tsx) | [Firestore tests](tests/integration/care.test.ts) exercise creation, editing, and deletion. [Browser tests](tests/e2e/care.spec.ts) verify a shared visit. |
| Secure caretaker passcodes | [Email-bound, expiring invitations](src/lib/server/circle.ts) | [Firestore tests](tests/integration/care.test.ts) cover expiry, retry limits, revocation, and replay. [Browser tests](tests/e2e/care.spec.ts) exercise joining as a caregiver. |
| Role-specific permissions and revocation | [Authenticated care routes](src/app/api/care/%5B...parts%5D/route.ts), [membership checks](src/lib/server/store.ts), and [access revocation](src/lib/server/circle.ts) | [Firestore tests](tests/integration/care.test.ts) reject outsiders and read-only writes. Revoked members lose access. |
| Upcoming dose, missed check-in, and appointment reminders | [Scheduled worker](src/lib/server/reminders.ts) and [email adapters](src/lib/server/email.ts) | [Firestore tests](tests/integration/care.test.ts) exercise all three reminder types with simulated delivery. [SMTP unit tests](tests/unit/email.test.ts) cover the sending gate and transport outcomes. Live mailbox delivery was verified for one isolated test. Automated delivery remains disabled and unverified end to end. |
| Elder autonomy, accessibility, and collaboration | [Invite, consent, and routine controls](src/components/manage.tsx), [larger-text dashboard and timeline](src/components/dashboard.tsx) | [Browser tests](tests/e2e/demo.spec.ts) check the keyboard skip link, larger text, mobile overflow, and caregiver acknowledgment. [Firestore tests](tests/integration/care.test.ts) verify two-sided alert consent. |
| Innovation beyond reminders | [Consent-gated Gemini selection and deterministic handoff](src/lib/server/handoff.ts), [source details and acknowledgments](src/components/dashboard.tsx) | [Browser tests](tests/e2e/demo.spec.ts) check source details and acknowledgments. A consenting synthetic production profile returned Gemini selections that matched its Firestore records. |

## Google services

| Integration | Source and behavior |
| --- | --- |
| Cloud Run and Cloud Build | The [Dockerfile](Dockerfile) builds the app. The deployed [health route](https://saathicare-171294241490.asia-south1.run.app/api/health) verifies service reachability. |
| Firebase Authentication | The [browser workspace](src/components/care-workspace.tsx) uses email/password sign-in. The [server](src/lib/server/platform.ts) verifies Firebase ID tokens and checks revocation on each protected request. |
| Firestore | [Profile-scoped reads and writes](src/lib/server/store.ts) hold schedules, dose events, memberships, and notification feeds. [Security rules](firestore.rules) deny direct browser access. |
| Cloud Scheduler | The [worker endpoint](src/app/api/internal/reminders/route.ts) validates the dedicated identity and exact OIDC audience, then drains indexed `reminderJobs` in bounded batches. |
| Gemini on Vertex AI | The [handoff service](src/lib/server/handoff.ts) sends event categories and their order after owner consent. Source IDs, names, medication details, and timestamps stay in SaathiCare. |
| Secret Manager and Gmail SMTP | Cloud Run injects the pinned App Password at runtime. The [Gmail adapter](src/lib/server/email.ts) uses implicit TLS and tracks provider acceptance, rejection, or uncertainty. |

## Security and scheduling

The Firebase browser client handles authentication only. Firestore rules deny direct client access. Every profile read or write checks membership in a transaction. The owner chooses either view-only or edit access and can revoke membership. Invitations use 128-bit secrets stored as hashes and are bound to a verified email. Codes expire after 48 hours and lock after five incorrect secret attempts by the intended recipient.

Dose schedules recur in their own IANA timezone. Appointments store a UTC instant and their display timezone. For daylight-saving changes, a nonexistent local time shifts forward by the gap and an ambiguous time uses the earlier occurrence. The scheduler materializes the next day in advance. Medication email is normally due 10 minutes before a dose, appointment email 24 hours before a visit, and a missed check-in after the configured grace period. Snooze defers the check-in by 15 minutes and resets its grace window. Changing the grace period applies to newly scheduled check-ins. Missed events appear in the timeline whether or not caregiver email is enabled.

Delivery uses a stable event-and-recipient key and a Firestore lease. For Gmail SMTP, the worker records an attempt before calling SMTP. An unresolved attempt is marked uncertain and is never replayed, including after a lease expires or the provider changes. A definitive SMTP rejection is recorded as failed. Resend retries on the same provider within its idempotency window. Workers recheck current consent, membership, and the verified recipient address before sending. Email consent defaults to off. Owners must enable escalation and caregivers must separately opt in. App emails omit medication names, appointment details, and profile names. The product supports routine coordination. Follow your clinician’s instructions for medication and treatment.

## Cloud Run deployment

Enable Cloud Run, Cloud Build, Artifact Registry, Firestore, Firebase Authentication, Cloud Scheduler, and Secret Manager in a billing-enabled Google Cloud project. Create the default Firestore database in `asia-south1`, and deploy the Firestore rules with `firebase deploy --only firestore:rules --project PROJECT_ID` after setting up Firebase. An Identity Platform project can also use the Firebase Auth SDK with an API key restricted to Identity Toolkit and Secure Token. Add the Cloud Run hostname to the auth configuration's authorized domains.

The Cloud Build identity needs `roles/run.builder` for source builds. Use a dedicated Cloud Run service account with `roles/datastore.user` and `roles/firebaseauth.viewer`. For Vertex AI, enable `aiplatform.googleapis.com`, grant the runtime account `roles/aiplatform.user`, and set `GEMINI_VERTEX_PROJECT` and `GEMINI_MODEL`. Gemini uses the model’s global endpoint. The caller that configures the scheduler needs permission to act as its dedicated service account. Cloud Scheduler's Google-managed service agent needs its standard Cloud Scheduler Service Agent role.

Run the PowerShell deployment script with a local environment YAML containing public Firebase web configuration. Add an optional sender address and cloud settings from `.env.example` as YAML entries. Keep the configuration file outside the source directory or name it with a `.env` prefix so upload and Git ignore it. Use Secret Manager for server-side API keys.

```powershell
./scripts/deploy.ps1 -Project PROJECT_ID -EnvFile .env.cloud.yaml -ConfigureScheduler
```

### Reminder email configuration

Sending defaults to off. Either provider requires `REMINDER_EMAIL_ENABLED=true`, an explicit `REMINDER_EMAIL_PROVIDER`, and an HTTPS `APP_URL`. Configure these through Cloud Run runtime environment variables and Secret Manager. Deploy with `REMINDER_EMAIL_ENABLED=false` until a delivery test is approved.

| Provider | Runtime values |
| --- | --- |
| `gmail` | Set `GMAIL_SMTP_USER` to the dedicated Gmail account. Map `GMAIL_SMTP_APP_PASSWORD` to Secret Manager secret `saathicare-gmail-app-password`, version `1` for the SaathiCare project. SMTP uses implicit TLS on `smtp.gmail.com:465`. |
| `resend` | Set `REMINDER_FROM_EMAIL` to a verified sender and map `RESEND_API_KEY` from Secret Manager. |

For Gmail, the Cloud Run runtime identity needs `roles/secretmanager.secretAccessor` on that specific secret. Validate mailbox delivery with an approved recipient separately from provider acceptance. A timeout or an interrupted worker can leave an uncertain outcome. This prevents a retry from duplicating a Gmail message that may already have been accepted.

### Gmail delivery verification

On 15 November 2026, an isolated one-shot test reused the Gmail SMTP adapter from Cloud Run revision `saathicare-smtp-06bc25d2`. It sent one synthetic message using the configured Secret Manager credential. Gmail accepted the message, and the recipient confirmed it arrived in their inbox.

Production has `REMINDER_EMAIL_ENABLED=false`. Cloud Scheduler has run the production worker successfully with that setting. Firestore emulator tests cover reminder jobs, consent, and duplicate-send controls using simulated delivery. The end-to-end journey from a scheduled reminder to a real inbox remains unverified.

The public demo sends no email and does not call Gemini. The live handoff always has a deterministic fallback when Gemini is disabled or unavailable. This release is a hackathon MVP and has no medical triage, emergency monitoring, or clinical decision logic.

Finalized Taken or Skipped check-ins have no correction workflow. The browser checks cover the primary desktop and mobile paths and selected accessibility behaviors.
