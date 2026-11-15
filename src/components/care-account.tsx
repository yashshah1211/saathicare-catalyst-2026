import type { FormEvent } from 'react'
import { ArrowRight, HeartHandshake } from 'lucide-react'
import type { AccountMode } from './use-care-workspace'

const accountCopy: Record<AccountMode, { title: string; submit: string }> = {
  signin: { title: 'Sign in to SaathiCare', submit: 'Sign in' },
  register: { title: 'Create your account', submit: 'Create account' },
  reset: { title: 'Reset your password', submit: 'Send reset email' },
}

interface AccountMessages {
  error: string
  notice: string
}

interface SignInProps extends AccountMessages {
  mode: AccountMode
  authReady: boolean
  checkingSession: boolean
  busy: boolean
  onModeChange: (mode: AccountMode) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function Feedback({ error, notice }: AccountMessages) {
  return (
    <>
      {error && <p className="banner warn" role="alert">{error}</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
    </>
  )
}

export function SignInPanel({ mode, authReady, checkingSession, busy, error, notice, onModeChange, onSubmit }: SignInProps) {
  const { title, submit } = accountCopy[mode]
  const registering = mode === 'register'
  const signingIn = mode === 'signin'

  return (
    <main id="main" className="site-width account-shell">
      <section className="panel account-card">
        <span className="icon-tile success"><HeartHandshake size={25} aria-hidden /></span>
        <h1>{title}</h1>
        <Feedback error={error} notice={notice} />
        {!authReady && !error && <p role="status" className="muted">Connecting to sign-in…</p>}

        {authReady && (
          <>
            <form className="account-form" onSubmit={onSubmit}>
              <label>
                Email address
                <input type="email" name="email" autoComplete="email" required maxLength={254} />
              </label>
              {mode !== 'reset' && (
                <label>
                  Password {registering && <span className="field-hint">Use at least 8 characters</span>}
                  <input
                    type="password"
                    name="password"
                    minLength={registering ? 8 : undefined}
                    maxLength={128}
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    required
                  />
                </label>
              )}
              <button className="button button-primary" disabled={busy || checkingSession}>
                {submit} <ArrowRight size={18} aria-hidden />
              </button>
            </form>
            <div className="account-links">
              <button
                className="button button-text"
                onClick={() => onModeChange(signingIn ? 'register' : 'signin')}
              >
                {signingIn ? 'Create an account' : 'Back to sign in'}
              </button>
              {signingIn && (
                <button className="button button-text" onClick={() => onModeChange('reset')}>
                  Forgot password
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

interface VerifyEmailProps extends AccountMessages {
  email: string | null
  busy: boolean
  onCheck: () => void
  onResend: () => void
}

export function VerifyEmailPanel({ email, busy, error, notice, onCheck, onResend }: VerifyEmailProps) {
  return (
    <main id="main" className="site-width account-shell">
      <section className="panel account-card">
        <h1>Verify your email</h1>
        <p className="muted">Open the verification link sent to <strong>{email}</strong>, then return here.</p>
        <Feedback error={error} notice={notice} />
        <div className="row wrap">
          <button className="button button-primary" disabled={busy} onClick={onCheck}>
            I’ve verified my email
          </button>
          <button className="button button-outline" disabled={busy} onClick={onResend}>
            Resend email
          </button>
        </div>
      </section>
    </main>
  )
}
