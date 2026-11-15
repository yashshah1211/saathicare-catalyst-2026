import type { Metadata } from 'next'
import { CareWorkspace } from '@/components/care-workspace'

export const metadata: Metadata = { title: 'Your care circle', robots: { index: false, follow: false } }

export default async function Care({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  return <CareWorkspace register={(await searchParams).mode === 'register'} />
}
