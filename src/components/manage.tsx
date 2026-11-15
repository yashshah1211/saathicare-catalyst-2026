'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Copy, Plus, Settings2, Users, X } from 'lucide-react'
import type { DashboardData, Profile, Role } from '@/lib/model'
import { clockTime, dayLabel } from '@/lib/time'
import type { Mutate } from './dashboard'

interface Props {
  data: DashboardData
  mutate?: Mutate
  busy?: boolean
}

interface InvitationResult {
  code: string
  expiresAt: number
}

const memberLabels: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Caregiver · Can edit',
  viewer: 'Caregiver · Can view',
}

function PasscodePanel({ invitation, timezone, onClose }: {
  invitation: InvitationResult
  timezone: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState('')
  const title = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    title.current?.focus()
  }, [])

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(invitation.code)
      setCopied('Copied.')
    } catch {
      setCopied('Select the code to copy it manually.')
    }
  }

  return (
    <div className="form-box">
      <div className="row wrap between">
        <h3 ref={title} tabIndex={-1}>Share this passcode</h3>
        <button className="button button-quiet" aria-label="Close passcode" onClick={onClose}>
          <X size={20} aria-hidden />
        </button>
      </div>
      <p className="small muted">
        Expires {dayLabel(invitation.expiresAt, timezone)} at {clockTime(invitation.expiresAt, timezone)}.
        Copy it before closing.
      </p>
      <div className="row wrap">
        <code className="passcode">{invitation.code}</code>
        <button className="button button-outline" onClick={copyCode}>
          <Copy size={17} aria-hidden /> Copy
        </button>
      </div>
      <p className="small" role="status">{copied}</p>
    </div>
  )
}

function CarePreferences({ profile, emailAvailable, mutate, busy }: {
  profile: Profile
  emailAvailable: boolean
  mutate: Mutate
  busy?: boolean
}) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await mutate('/settings', 'PUT', {
      doseEmail: form.has('doseEmail'),
      appointmentEmail: form.has('appointmentEmail'),
      escalation: form.has('escalation'),
      aiConsent: form.has('aiConsent'),
      graceMinutes: Number(form.get('graceMinutes')),
    }, 'Care preferences saved.')
  }

  return (
    <section className="panel">
      <h2 className="panel-heading"><Settings2 size={21} aria-hidden /> Care preferences</h2>
      {!emailAvailable && (
        <p className="banner warn small">
          Email delivery is disabled for this deployment. Missed check-ins still appear in your care circle.
        </p>
      )}
      <form className="preference-form" onSubmit={save}>
        <label>
          <input type="checkbox" name="doseEmail" defaultChecked={profile.doseEmail} />
          Email me upcoming medication check-ins
        </label>
        <label>
          <input type="checkbox" name="appointmentEmail" defaultChecked={profile.appointmentEmail} />
          Email me upcoming appointments
        </label>
        <label>
          <input type="checkbox" name="escalation" defaultChecked={profile.escalation} />
          Email approved, opted-in caregivers after a missed check-in
        </label>
        <label>
          <input type="checkbox" name="aiConsent" defaultChecked={profile.aiConsent} />
          Let Gemini select event types for care handoffs
        </label>
        <p className="muted small">
          Gemini receives event categories and their order. Names, medication details, timestamps,
          and appointment details stay in SaathiCare.
        </p>
        <label className="grace-field">
          Grace period for newly scheduled check-ins (minutes)
          <input type="number" name="graceMinutes" min={15} max={180} required defaultValue={profile.graceMinutes} />
        </label>
        <button className="button button-primary" disabled={busy}>Save preferences</button>
      </form>
    </section>
  )
}

function AlertPreferences({ optedIn, emailAvailable, mutate, busy }: {
  optedIn?: boolean
  emailAvailable: boolean
  mutate: Mutate
  busy?: boolean
}) {
  return (
    <section className="panel">
      <h2 className="panel-heading"><Settings2 size={21} aria-hidden /> Alert preferences</h2>
      {!emailAvailable && (
        <p className="banner warn small">
          Email delivery is disabled for this deployment. You can view and acknowledge shared alerts here.
        </p>
      )}
      <p className="muted">Get missed check-in emails when the profile owner has enabled sharing.</p>
      <button
        className="button button-outline"
        disabled={busy}
        onClick={() => void mutate('/members', 'PUT', { optedIn: !optedIn }, 'Alert preferences saved.')}
      >
        {optedIn ? 'Turn off alert emails' : 'Turn on alert emails'}
      </button>
    </section>
  )
}

export function CirclePanel({ data, mutate, busy }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitation, setInvitation] = useState<InvitationResult>()
  const inviteButton = useRef<HTMLButtonElement>(null)
  const emailField = useRef<HTMLInputElement>(null)
  const { profile, members, role } = data
  const owner = role === 'owner'

  useEffect(() => {
    if (inviteOpen) emailField.current?.focus()
  }, [inviteOpen])

  function closeInvite() {
    setInviteOpen(false)
    inviteButton.current?.focus()
  }

  function closePasscode() {
    setInvitation(undefined)
    inviteButton.current?.focus()
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mutate) return
    const form = new FormData(event.currentTarget)
    const result = await mutate<InvitationResult>('/invitations', 'POST', {
      email: String(form.get('email') ?? ''),
      role: String(form.get('role') ?? ''),
    }, 'Invitation created.')

    if (result) {
      setInvitation(result)
      setInviteOpen(false)
    }
  }

  function removeAccess(memberId: string, email: string) {
    if (mutate && window.confirm(`Remove access for ${email}?`)) {
      void mutate(`/members/${memberId}`, 'DELETE', undefined, 'Caregiver access removed.')
    }
  }

  return (
    <>
      <section className="panel">
        <div className="row wrap between">
          <h2 className="panel-heading">
            <Users size={22} aria-hidden /> {owner ? 'People with access' : 'Your access'}
          </h2>
          {owner && mutate && (
            <button
              ref={inviteButton}
              className="button button-primary"
              aria-expanded={inviteOpen}
              onClick={() => inviteOpen ? closeInvite() : setInviteOpen(true)}
            >
              <Plus size={17} aria-hidden /> Invite caregiver
            </button>
          )}
        </div>

        {inviteOpen && (
          <form className="form-box" onSubmit={submitInvite}>
            <div className="fields">
              <label>
                Caregiver email
                <input ref={emailField} name="email" type="email" required maxLength={254} />
              </label>
              <label>
                Permission
                <select name="role" defaultValue="viewer">
                  <option value="viewer">Can view and acknowledge alerts</option>
                  <option value="editor">Can view and update the routine</option>
                </select>
              </label>
            </div>
            <p className="small muted">
              Share the one-time code privately. Only the person with this verified email can redeem it within 48 hours.
            </p>
            <div className="row wrap">
              <button className="button button-primary" disabled={busy}>Create passcode</button>
              <button className="button button-quiet" type="button" onClick={closeInvite}>Cancel</button>
            </div>
          </form>
        )}
        {invitation && (
          <PasscodePanel
            key={invitation.code}
            invitation={invitation}
            timezone={profile.timezone}
            onClose={closePasscode}
          />
        )}

        <ul className="item-list">
          {members.map((member) => (
            <li key={member.id}>
              <div>
                <strong>{member.email}</strong>
                <p className="muted">{memberLabels[member.role]}{member.optedIn && ' · Alerts enabled'}</p>
              </div>
              {owner && member.role !== 'owner' && mutate && (
                <button
                  className="button button-quiet"
                  disabled={busy}
                  onClick={() => removeAccess(member.id, member.email)}
                >
                  Remove access
                </button>
              )}
            </li>
          ))}
        </ul>
        {owner && !!data.invitations.length && (
          <>
            <h3>Pending invitations</h3>
            <ul className="item-list">
              {data.invitations.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.email}</strong>
                    <p className="muted small">
                      Expires {dayLabel(item.expiresAt, profile.timezone)} at {clockTime(item.expiresAt, profile.timezone)}
                    </p>
                  </div>
                  <button
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => void mutate?.(`/invitations/${item.id}`, 'DELETE', undefined, 'Invitation revoked.')}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {mutate && (
        owner ? (
          <CarePreferences profile={profile} emailAvailable={data.emailAvailable} mutate={mutate} busy={busy} />
        ) : (
          <AlertPreferences
            optedIn={members[0]?.optedIn}
            emailAvailable={data.emailAvailable}
            mutate={mutate}
            busy={busy}
          />
        )
      )}
    </>
  )
}
