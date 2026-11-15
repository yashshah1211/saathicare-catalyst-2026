import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  browserSessionPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth'
import type { DashboardData, Dose, DoseAction, Profile, Role } from '@/lib/model'
import type { Mutate } from './dashboard'

export type AccountMode = 'signin' | 'register' | 'reset'
export type ProfileAction = 'create' | 'join'
type ProfileLink = { id: string; name: string; role: Role }

const signInUnavailable = 'Could not load sign-in. Refresh the page to retry.'
const doseMessages: Record<DoseAction, string> = {
  taken: 'Check-in recorded as taken.',
  snoozed: 'Reminder postponed by 15 minutes.',
  skipped: 'Check-in recorded as skipped.',
}

async function connectFirebase() {
  if (getApps().length) return getAuth(getApp())

  let response: Response
  try {
    response = await fetch('/api/firebase-config', { cache: 'no-store' })
  } catch {
    throw new Error(signInUnavailable)
  }
  if (!response.ok) throw new Error(signInUnavailable)

  const { enabled, apiKey, projectId, authDomain, appId, authEmulatorHost } = await response.json()
  if (!enabled) throw new Error('Sign-in is unavailable. You can still explore the fictional demo.')
  if (getApps().length) return getAuth(getApp())

  const app = initializeApp({ apiKey, projectId, authDomain, appId })
  const auth = initializeAuth(app, { persistence: browserSessionPersistence })
  if (authEmulatorHost) {
    connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true })
  }
  return auth
}

async function api<T>(user: User, path: string, method = 'GET', body?: unknown) {
  const token = await user.getIdToken()
  const response = await fetch(`/api/care${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result.error || 'The request did not complete. Try again.')
  }
  return await response.json() as T
}

function authError(error: unknown) {
  if (typeof error !== 'object' || !error || !('code' in error)) {
    return 'Sign-in could not be completed. Try again.'
  }
  switch (error.code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/weak-password':
      return 'Choose a stronger password.'
    case 'auth/email-already-in-use':
      return 'Try signing in or resetting your password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match.'
    default:
      return 'Sign-in or email sending could not be completed. Try again.'
  }
}

export function useCareWorkspace(register: boolean) {
  const [auth, setAuth] = useState<Auth>()
  const [user, setUser] = useState<User | null>()
  const [verified, setVerified] = useState(false)
  const [mode, setMode] = useState<AccountMode>(register ? 'register' : 'signin')
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

    connectFirebase().then((firebase) => {
      if (!alive) return
      setAuth(firebase)
      unsubscribe = onIdTokenChanged(firebase, (next) => {
        const uid = next?.uid || ''
        if (uid !== current.current.uid) {
          current.current = { uid, profile: '' }
          requestVersion.current++
          setProfiles([])
          setActive('')
          setData(undefined)
          setManage(false)
          setProfileError('')
        }
        setUser(next)
        setVerified(next?.emailVerified === true)
      })
    }).catch((error: Error) => {
      if (alive) setError(error.message)
    })

    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])

  const loadProfiles = useCallback(async (account: User, preferred = '') => {
    const list = await api<ProfileLink[]>(account, '/profiles')
    if (current.current.uid !== account.uid) return
    const selected = [preferred, current.current.profile].find((id) => list.some((entry) => entry.id === id))
    const id = selected || list[0]?.id || ''
    setProfiles(list)
    current.current.profile = id
    setActive(id)
  }, [])

  useEffect(() => {
    if (!user || !verified) return
    void loadProfiles(user).catch((error: Error) => {
      if (current.current.uid === user.uid) setError(error.message)
    })
  }, [loadProfiles, user, verified])

  const loadDashboard = useCallback(async (account: User, id: string) => {
    const version = ++requestVersion.current
    const stillActive = () => (
      current.current.uid === account.uid &&
      current.current.profile === id &&
      requestVersion.current === version
    )

    try {
      const result = await api<DashboardData>(account, `/profiles/${id}`)
      if (!stillActive()) return
      setData(result)
      setNow(Date.now())
      setProfileError('')
    } catch (error) {
      if (!stillActive()) return
      setData(undefined)
      setProfileError(error instanceof Error ? error.message : 'Unable to load this care profile.')
    }
  }, [])

  useEffect(() => {
    if (!user || !verified || !active) return
    const initial = setTimeout(() => void loadDashboard(user, active), 0)
    const timer = setInterval(() => {
      if (!busyRef.current && document.visibilityState === 'visible') {
        void loadDashboard(user, active)
      }
    }, 25_000)
    return () => {
      clearTimeout(initial)
      clearInterval(timer)
    }
  }, [active, loadDashboard, user, verified])

  function clearFeedback() {
    setError('')
    setNotice('')
  }

  function beginAction() {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    clearFeedback()
    return true
  }

  function endAction() {
    busyRef.current = false
    setBusy(false)
  }

  function changeMode(next: AccountMode) {
    setMode(next)
    clearFeedback()
  }

  async function accountAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth || !beginAction()) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')

    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email)
        setNotice('If an account exists for that address, a reset link will arrive by email.')
      } else if (mode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email, password)
        await sendEmailVerification(credential.user)
        setNotice('Verification email sent.')
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
    } catch (error) {
      setError(authError(error))
    } finally {
      endAction()
    }
  }

  async function checkVerification() {
    if (!user || !beginAction()) return
    try {
      await user.reload()
      await user.getIdToken(true)
      setVerified(user.emailVerified)
      if (!user.emailVerified) setNotice('Verification is still pending. Check your inbox and spam folder.')
    } catch (error) {
      setError(authError(error))
    } finally {
      endAction()
    }
  }

  async function resendVerification() {
    if (!user || !beginAction()) return
    try {
      await sendEmailVerification(user)
      setNotice('Verification email sent.')
    } catch (error) {
      setError(authError(error))
    } finally {
      endAction()
    }
  }

  function signOut() {
    clearFeedback()
    if (auth) void firebaseSignOut(auth).catch(() => setError('Could not sign out. Try again.'))
  }

  function selectProfile(id: string) {
    requestVersion.current++
    current.current.profile = id
    setActive(id)
    setData(undefined)
    clearFeedback()
    setProfileError('')
    setManage(false)
  }

  function toggleSetup() {
    setManage(!manage)
    clearFeedback()
  }

  function retryProfile() {
    if (user && active) void loadDashboard(user, active)
  }

  async function profileAction(event: FormEvent<HTMLFormElement>, action: ProfileAction) {
    event.preventDefault()
    if (!user || !beginAction()) return
    const form = new FormData(event.currentTarget)
    const account = user

    try {
      const joining = action === 'join'
      const id = joining
        ? (await api<{ profileId: string }>(account, '/join', 'POST', { code: form.get('code') })).profileId
        : (await api<Profile>(account, '/profiles', 'POST', {
          name: form.get('name'),
          timezone: form.get('timezone'),
        })).id
      await loadProfiles(account, id)
      if (current.current.uid === account.uid) {
        setManage(false)
        setNotice(joining ? 'You joined the care circle.' : 'Your care profile is ready.')
      }
    } catch (error) {
      if (current.current.uid === account.uid && error instanceof Error) setError(error.message)
    } finally {
      endAction()
    }
  }

  const mutate: Mutate = async <T,>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, message?: string) => {
    if (!user || !active || !beginAction()) return
    const uid = user.uid
    const sameProfile = () => current.current.uid === uid && current.current.profile === active

    try {
      const result = await api<T>(user, `/profiles/${active}${path}`, method, body)
      if (!sameProfile()) return
      if (method !== 'POST' || path !== '/handoff') await loadDashboard(user, active)
      if (!sameProfile()) return
      if (message) setNotice(message)
      return result
    } catch (error) {
      if (sameProfile() && error instanceof Error) setError(error.message)
    } finally {
      endAction()
    }
  }

  function respond(dose: Dose, action: DoseAction) {
    void mutate(`/doses/${dose.id}`, 'PUT', {
      action,
      expectedStatus: dose.status,
      expectedSnoozes: dose.snoozes,
    }, doseMessages[action])
  }

  return {
    account: {
      user,
      verified,
      authReady: !!auth,
      mode,
      changeMode,
      accountAction,
      checkVerification,
      resendVerification,
      signOut,
    },
    profile: {
      profiles,
      active,
      selectProfile,
      data,
      now,
      profileError,
      retryProfile,
      manage,
      toggleSetup,
      profileAction,
      mutate,
      respond,
    },
    busy,
    error,
    notice,
    large,
    setLarge,
  }
}
