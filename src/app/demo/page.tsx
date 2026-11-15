import type { Metadata } from 'next'
import { DemoWorkspace } from '@/components/demo-workspace'

export const metadata: Metadata = { title: 'Interactive demo' }

export default function Demo() { return <DemoWorkspace /> }
