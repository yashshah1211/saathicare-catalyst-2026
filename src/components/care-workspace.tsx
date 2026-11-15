'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { getApp, getApps, initializeApp } from 'firebase/app'
import { browserSessionPersistence, connectAuthEmulator, createUserWithEmailAndPassword, initializeAuth, onIdTokenChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth, type User, getAuth } from 'firebase/auth'
import { ArrowRight, HeartHandshake, LogOut } from 'lucide-react'
import type { DashboardData, Dose, DoseAction, Handoff, Profile, Role } from '@/lib/model'
import { Brand } from './brand'
import { Dashboard, type Mutate } from './dashboard'

type ProfileLink = { id: string; name: string; role: Role }
type Mode = 'signin' | 'register' | 'reset'

async function connect() {
  if (getApps().length) return getAuth(getApp())
  const response = await fetch('/api/firebase-config', { cache: 'no-store' })
  if (!response.ok) throw new Error('Could not load sign-in. Refresh the page to retry.')
  const { enabled, apiKey, projectId, authDomain, appId, authEmulatorHost } = await response.json()
  if (!enabled) throw new Error('Sign-in is unavailable. You can still explore the fictional demo.')
  if (getApps().length) return getAuth(getApp())
  const auth = initializeAuth(initializeApp({ apiKey, projectId, authDomain, appId }), { persistence: browserSessionPersistence })
  if (authEmulatorHost) connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true })
  return auth
}

async function api<T>(user: User, path: string, method = 'GET', body?: unknown) {
  const token = await user.getIdToken()
  const response = await fetch(`/api/care${path}`, { method, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result.error || 'The request did not complete. Try again.')
  }
  return await response.json() as T
}

function authError(error: unknown) {
  if (typeof error !== 'object' || !error || !('code' in error)) return 'Sign-in could not be completed. Try again.'
  switch (error.code) {
    case 'auth/invalid-email': return 'Enter a valid email address.'
    case 'auth/weak-password': return 'Choose a stronger password.'
    case 'auth/email-already-in-use': return 'Try signing in or resetting your password.'
    case 'auth/too-many-requests': return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': return 'That email and password do not match.'
    default: return 'Sign-in or email sending could not be completed. Try again.'
  }
}

export function CareWorkspace({ register }: { register: boolean }) {
  const [auth, setAuth] = useState<Auth>()
  const [user, setUser] = useState<User | null>()
  const [verified, setVerified] = useState(false)
  const [mode, setMode] = useState<Mode>(register ? 'register' : 'signin')
  const [profiles, setProfiles] = useState<ProfileLink[]>([])
  const [active, setActive] = useState('')
  const [data, setData] = useState<DashboardData>()
  const [manage, setManage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [notice, setNotice] = useState('')
  const [large, setLarge] = useState(false)
  const [now, setNow] = useState(0)
  const current = useRef({ uid: '', profile: '' })
  const busyRef = useRef(false)
  const requestVersion = useRef(0)

  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | undefined
    connect().then((firebase) => {
      if (!alive) return
      setAuth(firebase)
      unsubscribe = onIdTokenChanged(firebase, (next) => {
        const uid = next?.uid || ''
        if (uid !== current.current.uid) {
          current.current = { uid, profile: '' }
          requestVersion.current++
          setProfiles([]); setActive(''); setData(undefined); setManage(false); setProfileError('')
        }
        setUser(next)
        setVerified(next?.emailVerified === true)
      })
    }).catch((error: Error) => { if (alive) setError(error.message) })
    return () => { alive = false; unsubscribe?.() }
  }, [])

  const loadProfiles = useCallback(async (account: User, preferred = '') => {
    const list = await api<ProfileLink[]>(account, '/profiles')
    if (current.current.uid !== account.uid) return
    setProfiles(list)
    const id = [preferred, current.current.profile].find((value) => list.some((item) => item.id === value)) || list[0]?.id || ''
    current.current.profile = id
    setActive(id)
  }, [])

  useEffect(() => {
    if (user && verified) void loadProfiles(user).catch((error: Error) => { if (current.current.uid === user.uid) setError(error.message) })
  }, [loadProfiles, user, verified])

  const loadDashboard = useCallback(async (account: User, id: string) => {
    const version = ++requestVersion.current
    try {
      const result = await api<DashboardData>(account, `/profiles/${id}`)
      if (current.current.uid === account.uid && current.current.profile === id && requestVersion.current === version) {
        setData(result); setNow(Date.now()); setProfileError('')
      }
    } catch (error) {
      if (current.current.uid === account.uid && current.current.profile === id && requestVersion.current === version) {
        setData(undefined)
        setProfileError(error instanceof Error ? error.message : 'Unable to load this care profile.')
      }
    }
  }, [])

  useEffect(() => {
    if (!user || !verified || !active) return
    const initial = setTimeout(() => void loadDashboard(user, active), 0)
    const timer = setInterval(() => { if (!busyRef.current && document.visibilityState === 'visible') void loadDashboard(user, active) }, 25_000)
    return () => { clearTimeout(initial); clearInterval(timer) }
  }, [active, loadDashboard, user, verified])

  async function accountAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth || busyRef.current) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    setError(''); setNotice(''); setBusy(true); busyRef.current = true
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email)
        setNotice('If an account exists for that address, a reset link will arrive by email.')
      } else if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        await sendEmailVerification(credential.user)
        setNotice('Verification email sent.')
      } else await signInWithEmailAndPassword(auth, email, password)
    } catch (error) { setError(authError(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function profileAction(event: FormEvent<HTMLFormElement>, join: boolean) {
    event.preventDefault()
    if (!user || busyRef.current) return
    const form = new FormData(event.currentTarget)
    const account = user
    setBusy(true); busyRef.current = true; setError(''); setNotice('')
    try {
      const id = join
        ? (await api<{ profileId: string }>(account, '/join', 'POST', { code: form.get('code') })).profileId
        : (await api<Profile>(account, '/profiles', 'POST', { name: form.get('name'), timezone: form.get('timezone') })).id
      await loadProfiles(account, id)
      if (current.current.uid === account.uid) { setManage(false); setNotice(join ? 'You joined the care circle.' : 'Your care profile is ready.') }
    } catch (error) { if (current.current.uid === account.uid && error instanceof Error) setError(error.message) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const mutate: Mutate = async <T,>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, message?: string) => {
    if (!user || !active || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    const uid = user.uid
    const sameProfile = () => current.current.uid === uid && current.current.profile === active
    try {
      const result = await api<T>(user, `/profiles/${active}${path}`, method, body)
      if (!sameProfile()) return
      if (method !== 'POST' || path !== '/handoff') await loadDashboard(user, active)
      if (sameProfile() && message) setNotice(message)
      return sameProfile() ? result : undefined
    } catch (error) {
      if (sameProfile() && error instanceof Error) setError(error.message)
    } finally { busyRef.current = false; setBusy(false) }
  }

  function respond(dose: Dose, action: DoseAction) {
    const message = { taken: 'Check-in recorded as taken.', snoozed: 'Reminder postponed by 15 minutes.', skipped: 'Check-in recorded as skipped.' }[action]
    void mutate(`/doses/${dose.id}`, 'PUT', { action, expectedStatus: dose.status, expectedSnoozes: dose.snoozes }, message)
  }

  return <>
    <header className="site-header"><div className="site-width header-inner"><Brand />{user
      ? <button className="button button-outline" onClick={() => { setError(''); setNotice(''); if (auth) void signOut(auth).catch(() => setError('Could not sign out. Try again.')) }}><LogOut size={17} aria-hidden /> Sign out</button>
      : <Link className="button button-outline" href="/demo">Explore Demo <ArrowRight size={16} aria-hidden /></Link>}</div></header>
    {!user && <main id="main" className="site-width account-shell"><section className="panel account-card">
      <span className="icon-tile success"><HeartHandshake size={25} aria-hidden /></span>
      <h1>{mode === 'register' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in to SaathiCare'}</h1>
      {error && <p className="banner warn" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
      {!auth && !error && <p role="status" className="muted">Connecting to sign-in…</p>}
      {auth && <form className="account-form" onSubmit={accountAction}>
        <label>Email address<input type="email" name="email" autoComplete="email" required maxLength={254} /></label>
        {mode !== 'reset' && <label>Password {mode === 'register' && <span className="field-hint">Use at least 8 characters</span>}<input type="password" name="password" minLength={mode === 'register' ? 8 : undefined} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required /></label>}
        <button className="button button-primary" disabled={busy || user === undefined}>{mode === 'register' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'} <ArrowRight size={18} aria-hidden /></button>
      </form>}
      {!!auth && <div className="account-links"><button className="button button-text" onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(''); setNotice('') }}>{mode === 'signin' ? 'Create an account' : 'Back to sign in'}</button>
        {mode === 'signin' && <button className="button button-text" onClick={() => { setMode('reset'); setError(''); setNotice('') }}>Forgot password</button>}</div>}
    </section></main>}
    {user && !verified && <main id="main" className="site-width account-shell"><section className="panel account-card"><h1>Verify your email</h1><p className="muted">Open the verification link sent to <strong>{user.email}</strong>, then return here.</p>
      {error && <p className="banner warn" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
      <div className="row wrap"><button className="button button-primary" disabled={busy} onClick={async () => {
        setError(''); setNotice(''); setBusy(true)
        try { await user.reload(); await user.getIdToken(true); setVerified(user.emailVerified); if (!user.emailVerified) setNotice('Verification is still pending. Check your inbox and spam folder.') }
        catch (error) { setError(authError(error)) } finally { setBusy(false) }
      }}>I’ve verified my email</button><button className="button button-outline" disabled={busy} onClick={async () => {
        setError(''); setNotice(''); setBusy(true)
        try { await sendEmailVerification(user); setNotice('Verification email sent.') } catch (error) { setError(authError(error)) } finally { setBusy(false) }
      }}>Resend email</button></div>
    </section></main>}
    {user && verified && <div className="site-width workspace">
      <div className="profile-controls row wrap between">
        {!!profiles.length && <label className="row wrap">Care profile <select value={active} onChange={(event) => {
          requestVersion.current++; current.current.profile = event.target.value; setActive(event.target.value); setData(undefined); setError(''); setNotice(''); setProfileError(''); setManage(false)
        }}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {!!profiles.length && <button className="button button-outline" onClick={() => { setManage(!manage); setError(''); setNotice('') }}>{manage ? 'Back to dashboard' : 'New profile or join'}</button>}
      </div>
      {(!active || manage) ? <main id="main" className="onboarding">
        <div className="section-heading"><div><h1>Set up a care circle</h1><p className="muted">Create your own care profile, or join with an invitation from someone you trust.</p></div></div>
        {error && <p className="banner warn" role="alert">{error}</p>}
        <div className="onboarding-grid"><section className="panel"><h2>Create your care profile</h2><form className="account-form" onSubmit={(event) => void profileAction(event, false)}>
          <label>Your display name<input name="name" required maxLength={90} autoComplete="name" /></label><label>Timezone<input name="timezone" defaultValue="Asia/Kolkata" required maxLength={65} /></label><button className="button button-primary" disabled={busy}>Create profile</button>
        </form></section>
        <section className="panel"><h2>Join a care circle</h2><form className="account-form" onSubmit={(event) => void profileAction(event, true)}>
          <label>Invitation passcode<input name="code" required maxLength={39} autoComplete="off" spellCheck={false} /></label><button className="button button-outline" disabled={busy}>Join care circle</button>
        </form></section></div>
      </main> : data?.profile.id === active ? <Dashboard key={active} data={data} now={now} error={error} notice={notice} busy={busy}
        onDose={respond} onAcknowledge={(id) => void mutate(`/notifications/${id}`, 'PUT', undefined, 'Missed check-in alert acknowledged.')}
        onHandoff={() => mutate<Handoff>('/handoff', 'POST')} mutate={mutate} large={large} setLarge={setLarge} />
        : <main id="main" className="account-shell">{profileError ? <section className="panel"><p role="alert">{profileError}</p><button className="button button-outline" onClick={() => void loadDashboard(user, active)}>Retry</button></section> : <p role="status">Loading care profile…</p>}</main>}
    </div>}
  </>
}
