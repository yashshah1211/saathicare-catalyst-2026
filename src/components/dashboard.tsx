'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronRight, LayoutGrid, ListChecks, Sparkles, Type, Users } from 'lucide-react'
import type { DashboardData, Dose, DoseAction, Handoff, Role } from '@/lib/model'
import { HandoffPanel, NotificationsPanel } from './dashboard-activity'
import { TodayPanel } from './dashboard-today'
import { CirclePanel } from './manage'
import { RoutinePanel } from './routine-panel'

type View = 'today' | 'routine' | 'circle' | 'handoff'

const views = [
  { key: 'today', label: 'Today', icon: LayoutGrid },
  { key: 'routine', label: 'My routine', icon: ListChecks },
  { key: 'circle', label: 'Care circle', icon: Users },
  { key: 'handoff', label: 'Care handoff', icon: Sparkles },
] as const

const roleLabels: Record<Role, string> = {
  owner: 'Your care profile',
  editor: 'Caregiver access',
  viewer: 'View-only access',
}

export type Mutate = <T = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  message?: string,
) => Promise<T | undefined>

interface Props {
  data: DashboardData
  now: number
  demo?: boolean
  ready?: boolean
  onDose: (dose: Dose, action: DoseAction) => void
  onAcknowledge: (id: string) => void
  onHandoff: () => Promise<Handoff | undefined>
  mutate?: Mutate
  busy?: boolean
  notice?: string
  error?: string
  large: boolean
  setLarge: (large: boolean) => void
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="section-heading">
      <div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
    </div>
  )
}

export function Dashboard({
  data,
  now,
  demo,
  ready = true,
  onDose,
  onAcknowledge,
  onHandoff,
  mutate,
  busy,
  notice,
  error,
  large,
  setLarge,
}: Props) {
  const [view, setView] = useState<View>('today')
  const [summary, setSummary] = useState<Handoff>()
  const [loadingSummary, setLoadingSummary] = useState(false)
  const { profile, role } = data
  const routineTitle = role === 'owner' ? 'My routine' : 'Shared routine'

  async function buildSummary() {
    setView('handoff')
    setLoadingSummary(true)
    try {
      setSummary(await onHandoff())
    } finally {
      setLoadingSummary(false)
    }
  }

  return (
    <div className={`dashboard ${large ? 'text-large' : ''}`} aria-busy={!ready}>
      <aside className="rail" aria-label="Care dashboard">
        <div className="rail-profile">
          <span className="avatar" aria-hidden>{profile.name.charAt(0).toUpperCase()}</span>
          <div>
            <strong>{profile.name}</strong>
            <span>{roleLabels[role]}</span>
          </div>
        </div>
        <nav aria-label="Care navigation">
          {views.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              disabled={!ready}
              className={view === key ? 'rail-active' : ''}
              aria-current={view === key ? 'page' : undefined}
              onClick={() => setView(key)}
            >
              <Icon size={20} aria-hidden /> {key === 'routine' ? routineTitle : label}
              <ChevronRight className="rail-chevron" size={14} aria-hidden />
            </button>
          ))}
        </nav>
        <button
          disabled={!ready}
          className="button button-outline large-toggle"
          aria-pressed={large}
          onClick={() => setLarge(!large)}
        >
          <Type size={19} aria-hidden /> {large ? 'Standard text' : 'Larger text'}
        </button>
      </aside>

      <main id="main" className="dashboard-main">
        {error && <p className="banner warn" role="alert">{error}</p>}
        <div className="sr-only" role="status" aria-live="polite">{notice ?? ''}</div>
        {notice && <p className="banner success" aria-hidden>{notice}</p>}

        {view === 'today' && (
          <TodayPanel
            data={data}
            now={now}
            ready={ready}
            busy={busy}
            onDose={onDose}
            onOpenRoutine={() => setView('routine')}
            onOpenHandoff={buildSummary}
          />
        )}
        {view === 'routine' && (
          <>
            <SectionHeading title={routineTitle} description="Medications and upcoming doctor visits." />
            <RoutinePanel data={data} mutate={mutate} busy={busy} />
          </>
        )}
        {view === 'circle' && (
          <>
            <SectionHeading title="Care circle" description="Manage shared access and missed check-in alerts." />
            <div className="stack">
              <CirclePanel data={data} mutate={mutate} busy={busy} />
              {(!demo || role !== 'owner') && (
                <NotificationsPanel
                  items={data.notifications}
                  timezone={profile.timezone}
                  demo={demo}
                  busy={busy}
                  onAcknowledge={onAcknowledge}
                />
              )}
            </div>
          </>
        )}
        {view === 'handoff' && (
          <>
            <SectionHeading
              title="Care handoff"
              description="Recent check-ins and the next appointment, with sources you can verify."
            />
            <HandoffPanel
              activity={data.activity}
              timezone={profile.timezone}
              summary={summary}
              loading={loadingSummary}
              onBuild={buildSummary}
            />
          </>
        )}
        {demo && (
          <footer className="dashboard-footer">
            <span>Fictional demo data · No emails sent</span>
            <Link href="/care?mode=register">
              Create your care circle <ArrowRight size={16} aria-hidden />
            </Link>
          </footer>
        )}
      </main>
    </div>
  )
}
