'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { FlaskConical, RotateCcw } from 'lucide-react'
import { demoData, demoHandoff, demoNow } from '@/lib/demo'
import type { Dose, DoseAction } from '@/lib/model'
import { MINUTE } from '@/lib/time'
import { Brand } from './brand'
import { Dashboard } from './dashboard'

const subscribe = () => () => undefined
const clientReady = () => true
const serverReady = () => false

export function DemoWorkspace() {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [data, setData] = useState(demoData)
  const [large, setLarge] = useState(false)
  const [notice, setNotice] = useState('')
  const [run, setRun] = useState(0)

  function respond(dose: Dose, status: DoseAction) {
    setData((current) => ({ ...current,
      doses: current.doses.map((item) => item.id === dose.id ? { ...item, status, respondedAt: demoNow,
        ...(status === 'snoozed' ? { activeAt: demoNow + 15 * MINUTE, snoozes: item.snoozes + 1 } : {}) } : item),
      activity: [{ id: `${dose.id}-${status}`, kind: status, label: dose.medicationName, at: demoNow }, ...current.activity],
    }))
    setNotice(status === 'taken' ? 'Check-in recorded as taken.' : status === 'snoozed' ? 'Reminder postponed by 15 minutes.' : 'Check-in recorded as skipped.')
  }

  function acknowledge(id: string) {
    const alert = data.notifications.find((item) => item.id === id)
    if (!alert || alert.acknowledgedAt) return
    setData((current) => ({ ...current, notifications: current.notifications.map((item) => item.id === id ? { ...item, acknowledgedAt: demoNow } : item),
      activity: [{ id: `${id}-ack`, kind: 'acknowledged', at: demoNow, label: alert.label }, ...current.activity] }))
    setNotice('Missed check-in alert acknowledged.')
  }

  return <>
    <header className="site-header"><div className="site-width header-inner"><Brand /><div className="row"><span className="status demo-badge"><FlaskConical size={16} aria-hidden /> Fictional demo</span><Link href="/care" className="button button-outline">Sign in</Link></div></div></header>
    <div className="site-width workspace">
      <div className="demo-controls"><div className="segmented" role="group" aria-label="Demo view">
        <button disabled={!ready} aria-pressed={data.role === 'owner'} onClick={() => { setData({ ...data, role: 'owner' }); setNotice('') }}>Elder view</button>
        <button disabled={!ready} aria-pressed={data.role === 'editor'} onClick={() => { setData({ ...data, role: 'editor' }); setNotice('') }}>Caregiver view</button>
      </div><button disabled={!ready} className="button button-quiet" onClick={() => { setData(demoData()); setNotice('Demo reset.'); setRun(run + 1) }}><RotateCcw size={17} aria-hidden /> Reset demo</button></div>
      <Dashboard key={`${run}-${data.role}`} data={{ ...data, members: data.role === 'editor' ? data.members.filter((m) => m.role === 'editor') : data.members }}
        demo ready={ready} now={demoNow} onDose={respond} onAcknowledge={acknowledge} onHandoff={async () => demoHandoff(data)} notice={notice} large={large} setLarge={setLarge} />
    </div>
  </>
}
