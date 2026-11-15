# SaathiCare · PromptWars x Catalyst 2026

**SaathiCare** gives older adults a clear daily routine for medications and appointments, with a care circle that they control. Family can join with an expiring one-time passcode tied to their verified email. A missed check-in is recorded once and can alert opted-in caregivers with the profile owner’s consent. A caregiver can acknowledge the alert, while the handoff shows the recorded sources behind the summary.

**Live** [Homepage](https://saathicare-171294241490.asia-south1.run.app) · [Interactive demo](https://saathicare-171294241490.asia-south1.run.app/demo)

## 90-second demo

| Time | What to show |
| --- | --- |
| 0–15s | Open SaathiCare and choose **Explore Demo**. Point out the fictional-data label and the elder’s large, simple today view. |
| 15–35s | Mark the midday check-in **Taken**. Watch daily progress move from one to two and the latest event appear in Recent activity. |
| 35–48s | Open **View appointment** and show the clinic, local date, and time. |
| 48–65s | Return to **Today** and choose **Open care summary**. Expand the missed-check-in source and describe how the summary is tied to recorded events. |
| 65–80s | Switch to **Caregiver view**, open **Care circle**, and acknowledge the simulated alert. Show the acknowledgment reflected in the activity timeline. |
| 80–90s | Explain that the live app uses verified sign-in, Firestore membership, a scheduled reminder worker, and consent-gated Gemini selection. |

## Google integrations

| Integration | Where to verify |
| --- | --- |
| Cloud Run, Mumbai | Public homepage, demo, and `/api/health` responded successfully. |
| Firebase Authentication | Verified synthetic accounts signed in to the deployed workspace. Unsigned profile requests returned HTTP 401. |
| Firestore, Mumbai | The live browser test persisted a profile, dose check-in, appointment, and invitation. A direct Firestore read using the signed-in browser identity returned HTTP 403. |
| Cloud Scheduler | Cloud Run logged successful OIDC-authenticated reminder ticks from the dedicated Scheduler identity. |
| Gemini | The live synthetic profile enabled consent and generated a Gemini-selected handoff with traceable source records. |

Live reminder email is disabled in this deployment. Missed check-ins remain visible in the shared timeline. Emulator tests verify the escalation and email deduplication logic with a controlled provider response.
