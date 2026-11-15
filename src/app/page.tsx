import Image from 'next/image'
import { ArrowRight, CalendarDays, CircleCheck, HeartHandshake, Pill, ShieldCheck } from 'lucide-react'
import { Brand } from '@/components/brand'

const features = [
  { icon: Pill, title: 'See today’s routine', description: 'Know what’s due, check it off, or ask for a reminder later.' },
  { icon: CalendarDays, title: 'Keep appointments in view', description: 'Share the next visit, time, and place with the people you choose.' },
  { icon: HeartHandshake, title: 'Check in with your circle', description: 'Let trusted family know when a check-in is missed, with your permission.' },
]

export default function Home() {
  return <>
    <header className="site-header"><div className="site-width header-inner">
      <Brand />
      <nav aria-label="Main navigation"><a className="button button-outline" href="/care">Sign in <ArrowRight size={16} aria-hidden /></a></nav>
    </div></header>
    <main id="main" className="site-width landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-kicker"><span aria-hidden /> Everyday care, together</p>
          <h1 id="hero-title">Care that connects.<br />Independence<br className="desktop-break" /> that lasts.</h1>
          <p className="hero-intro">Keep track of medications and doctor visits, and share updates with the people you trust.</p>
          <div className="row hero-actions">
            <a className="button button-primary" href="/demo">Explore Demo <ArrowRight size={20} aria-hidden /></a>
            <a className="button button-outline" href="/care?mode=register">Create care circle</a>
          </div>
          <p className="small muted hero-note"><ShieldCheck size={17} aria-hidden /> You choose who sees your care routine.</p>
        </div>
        <div className="hero-art">
          <div className="hero-photo"><Image src="/care-at-home.webp" alt="An older woman uses her phone at home with her daughter beside her" width={1120} height={900} priority sizes="(max-width: 760px) 100vw, 47vw" /></div>
          <div className="hero-check" aria-hidden>
            <span className="icon-tile success"><CircleCheck size={24} /></span><div><strong>A check-in, shared</strong><span>Morning routine recorded</span></div>
          </div>
        </div>
      </section>
      <section className="feature-strip" aria-label="What you can do with SaathiCare">
        {features.map(({ icon: Icon, title, description }) => <article key={title}><Icon size={25} aria-hidden /><div><h2>{title}</h2><p>{description}</p></div></article>)}
      </section>
    </main>
    <footer className="site-width site-footer"><span>SaathiCare</span><p>For routine coordination. Follow your care team’s instructions for medication and treatment.</p></footer>
  </>
}
