import { useNavigate } from 'react-router-dom'

const steps = [
  {
    title: 'Step 1 · Open the Safari menu',
    image: '/install/ios/step-1.jpeg',
    alt: 'Safari browser menu on iPhone',
    text: 'Open hyperionmaritime.org in Safari. Tap the page menu beside the address bar.'
  },
  {
    title: 'Step 2 · Tap Share',
    image: '/install/ios/step-2.jpeg',
    alt: 'Share option in the Safari menu',
    text: 'Choose Share from the browser menu.'
  },
  {
    title: 'Step 3 · Show more actions',
    image: '/install/ios/step-3.jpeg',
    alt: 'Safari share sheet with the View More control',
    text: 'In the share sheet, tap the down arrow or View More to show the full list of actions.'
  },
  {
    title: 'Step 4 · Add to Home Screen',
    image: '/install/ios/step-4.jpeg',
    alt: 'Add to Home Screen option in Safari',
    text: 'Scroll through the actions and choose Add to Home Screen.'
  },
  {
    title: 'Step 5 · Tap Add',
    image: '/install/ios/step-5.jpeg',
    alt: 'Add to Home Screen confirmation screen',
    text: 'Keep the name Hyperion Maritime. Leave Open as Web App enabled if it is offered, then tap Add.'
  },
  {
    title: 'Step 6 · Launch Hyperion',
    image: '/install/ios/step-6.jpeg',
    alt: 'Hyperion Maritime icon on the iPhone Home Screen',
    text: 'Find the Hyperion Maritime icon on your Home Screen and tap it to open the app.'
  }
]

export default function IOSInstallGuideScreen() {
  const navigate = useNavigate()
  return (
    <main style={{ maxWidth: 1120, width: '100%', boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(1rem, 4vw, 2rem)', color: 'var(--text)' }}>
      <button type="button" className="btn btn-outline" onClick={() => navigate(-1)} style={{ marginBottom: '1rem' }}>← Back</button>
      <header style={{ marginBottom: '1.4rem' }}>
        <div style={{ color: 'var(--accent)', fontWeight: 900, letterSpacing: '.12em', fontSize: '.75rem' }}>HYPERION MARITIME · iOS / APPLE</div>
        <h1 style={{ margin: '.4rem 0', fontSize: 'clamp(1.6rem, 4vw, 2.2rem)' }}>Add Hyperion to your iPhone or iPad</h1>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 760, marginBottom: 0 }}>On iPhone and iPad, Safari does not allow a website to trigger the Home Screen installation sheet automatically. Follow these six steps once to add Hyperion like an app.</p>
      </header>
      <section aria-label="Installation steps with screenshots" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', padding: '0 0 .8rem', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
          {steps.map((step, index) => (
            <article key={step.image} style={{ flex: '0 0 min(78vw, 330px)', minWidth: 0, scrollSnapAlign: 'start', border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg-card)', overflow: 'hidden' }}>
              <div style={{ padding: '.85rem .9rem', minHeight: 58, display: 'flex', alignItems: 'center', fontWeight: 850, lineHeight: 1.35, borderBottom: '1px solid var(--border)' }}>
                <span style={{ display: 'inline-grid', placeItems: 'center', width: 30, height: 30, flex: '0 0 30px', marginRight: '.55rem', borderRadius: 999, background: 'var(--accent)', color: 'white', fontSize: '.85rem' }}>{index + 1}</span>
                {step.title.replace(/^Step \\d+ · /, '')}
              </div>
              <div style={{ padding: '.65rem', background: 'var(--bg-elevated)' }}>
                <img src={step.image} alt={step.alt} loading="lazy" style={{ display: 'block', width: '100%', height: 430, objectFit: 'contain', objectPosition: 'top center', borderRadius: 8, background: '#fff' }} />
              </div>
              <p style={{ margin: 0, padding: '.8rem .9rem 1rem', color: 'var(--text-muted)', fontSize: '.88rem', lineHeight: 1.5 }}>{step.text}</p>
            </article>
          ))}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '.8rem', margin: '.35rem 0 0' }}>Swipe horizontally from left to right to view all six screenshots.</p>
      </section>
      <section style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 'clamp(1rem, 3vw, 1.5rem)', background: 'var(--bg-card)' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.25rem' }}>Instructions</h2>
        <ol style={{ paddingLeft: '1.35rem', marginBottom: 0, lineHeight: 1.75 }}>
          <li><strong>Open Safari.</strong> Visit <a href="https://hyperionmaritime.org" style={{ color: 'var(--accent)' }}>hyperionmaritime.org</a> in Safari itself. If the link opened inside another app, use that app's Share menu to open it in Safari first.</li>
          <li><strong>Open the page menu.</strong> Tap the menu icon beside Safari's address bar.</li>
          <li><strong>Choose Share.</strong> In the browser menu, tap Share.</li>
          <li><strong>Find Add to Home Screen.</strong> If the action is hidden, tap View More or the down arrow, then scroll until Add to Home Screen appears.</li>
          <li><strong>Confirm the name.</strong> Keep the app name as Hyperion Maritime. If the Open as Web App switch appears, leave it on.</li>
          <li><strong>Tap Add and launch.</strong> Tap Add in the top corner, return to your Home Screen, and open the new Hyperion Maritime icon.</li>
        </ol>
      </section>
    </main>
  )
}
