export type Role = 'owner' | 'editor' | 'viewer'
export type DoseStatus = 'pending' | 'taken' | 'snoozed' | 'skipped' | 'missed'
export type DoseAction = 'taken' | 'snoozed' | 'skipped'

export interface Profile {
  id: string
  name: string
  timezone: string
  ownerId: string
  doseEmail: boolean
  appointmentEmail: boolean
  escalation: boolean
  aiConsent: boolean
  graceMinutes: number
}

export interface Member {
  id: string
  feedId: string
  email: string
  role: Role
  optedIn: boolean
}

export interface Medication {
  id: string
  name: string
  instructions: string
  times: string[]
  timezone: string
  revision: number
  updatedAt: number
}

export interface Dose {
  id: string
  medicationId: string
  medicationName: string
  instructions: string
  dueAt: number
  activeAt: number
  missedAt: number
  status: DoseStatus
  snoozes: number
  respondedAt?: number
}

export interface Appointment {
  id: string
  title: string
  location: string
  startsAt: number
  timezone: string
  revision: number
}

export interface Invitation {
  id: string
  email: string
  role: Exclude<Role, 'owner'>
  expiresAt: number
  state: 'open' | 'used' | 'revoked' | 'locked'
}

export interface Activity {
  id: string
  kind: 'taken' | 'snoozed' | 'skipped' | 'missed' | 'appointment' | 'acknowledged'
  label: string
  at: number
}

export interface Notification {
  id: string
  kind: 'dose' | 'appointment' | 'missed'
  at: number
  label: string
  status: 'queued' | 'sent' | 'failed' | 'canceled' | 'uncertain'
  acknowledgedAt?: number
}

export interface DashboardData {
  profile: Profile
  role: Role
  emailAvailable: boolean
  members: Member[]
  invitations: Invitation[]
  medications: Medication[]
  doses: Dose[]
  appointments: Appointment[]
  activity: Activity[]
  notifications: Notification[]
}

export interface Handoff {
  mode: 'records' | 'gemini'
  items: Activity[]
}
