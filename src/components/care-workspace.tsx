'use client'

import type { FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, LogOut } from 'lucide-react'
import type { Handoff } from '@/lib/model'
import { Brand } from './brand'
import { SignInPanel, VerifyEmailPanel } from './care-account'
import { Dashboard } from './dashboard'
import { useCareWorkspace, type ProfileAction } from './use-care-workspace'

interface ProfileSetupProps {
  error: string
  busy: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>, action: ProfileAction) => void
}

function ProfileSetup({ error, busy, onSubmit }: ProfileSetupProps) {
  return (
    <main id="main" className="onboarding">
      <div className="section-heading">
        <div>
          <h1>Set up a care circle</h1>
          <p className="muted">Create your own care profile, or join with an invitation from someone you trust.</p>
        </div>
      </div>
      {error && <p className="banner warn" role="alert">{error}</p>}
      <div className="onboarding-grid">
        <section className="panel">
          <h2>Create your care profile</h2>
          <form className="account-form" onSubmit={(event) => onSubmit(event, 'create')}>
            <label>
              Your display name
              <input name="name" required maxLength={90} autoComplete="name" />
            </label>
            <label>
              Timezone
              <input name="timezone" defaultValue="Asia/Kolkata" required maxLength={65} />
            </label>
            <button className="button button-primary" disabled={busy}>Create profile</button>
          </form>
        </section>
        <section className="panel">
          <h2>Join a care circle</h2>
          <form className="account-form" onSubmit={(event) => onSubmit(event, 'join')}>
            <label>
              Invitation passcode
              <input name="code" required maxLength={39} autoComplete="off" spellCheck={false} />
            </label>
            <button className="button button-outline" disabled={busy}>Join care circle</button>
          </form>
        </section>
      </div>
    </main>
  )
}

function ProfileLoading({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <main id="main" className="account-shell">
      {error ? (
        <section className="panel">
          <p role="alert">{error}</p>
          <button className="button button-outline" onClick={onRetry}>Retry</button>
        </section>
      ) : <p role="status">Loading care profile…</p>}
    </main>
  )
}

export function CareWorkspace({ register }: { register: boolean }) {
  const { account, profile, busy, error, notice, large, setLarge } = useCareWorkspace(register)
  const { user, verified } = account
  const { active, data, manage, mutate, profiles } = profile
  const showSetup = !active || manage

  return (
    <>
      <header className="site-header">
        <div className="site-width header-inner">
          <Brand />
          {user ? (
            <button className="button button-outline" onClick={account.signOut}>
              <LogOut size={17} aria-hidden /> Sign out
            </button>
          ) : (
            <Link className="button button-outline" href="/demo">
              Explore Demo <ArrowRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      </header>

      {!user && (
        <SignInPanel
          mode={account.mode}
          authReady={account.authReady}
          checkingSession={user === undefined}
          busy={busy}
          error={error}
          notice={notice}
          onModeChange={account.changeMode}
          onSubmit={account.accountAction}
        />
      )}
      {user && !verified && (
        <VerifyEmailPanel
          email={user.email}
          busy={busy}
          error={error}
          notice={notice}
          onCheck={account.checkVerification}
          onResend={account.resendVerification}
        />
      )}
      {user && verified && (
        <div className="site-width workspace">
          <div className="profile-controls row wrap between">
            {!!profiles.length && (
              <>
                <label className="row wrap">
                  Care profile
                  <select value={active} onChange={(event) => profile.selectProfile(event.target.value)}>
                    {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <button className="button button-outline" onClick={profile.toggleSetup}>
                  {manage ? 'Back to dashboard' : 'New profile or join'}
                </button>
              </>
            )}
          </div>

          {showSetup && <ProfileSetup error={error} busy={busy} onSubmit={profile.profileAction} />}
          {!showSetup && data?.profile.id === active && (
            <Dashboard
              key={active}
              data={data}
              now={profile.now}
              error={error}
              notice={notice}
              busy={busy}
              onDose={profile.respond}
              onAcknowledge={(id) => {
                void mutate(`/notifications/${id}`, 'PUT', undefined, 'Missed check-in alert acknowledged.')
              }}
              onHandoff={() => mutate<Handoff>('/handoff', 'POST')}
              mutate={mutate}
              large={large}
              setLarge={setLarge}
            />
          )}
          {!showSetup && data?.profile.id !== active && (
            <ProfileLoading error={profile.profileError} onRetry={profile.retryProfile} />
          )}
        </div>
      )}
    </>
  )
}
