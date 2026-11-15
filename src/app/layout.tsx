import type { Metadata } from 'next'
import '@fontsource-variable/dm-sans'
import '@fontsource/instrument-serif/400.css'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'SaathiCare', template: '%s | SaathiCare' },
  description: 'An accessible care circle for medication check-ins and doctor appointments.',
  icons: { icon: '/mark.svg' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>
}
