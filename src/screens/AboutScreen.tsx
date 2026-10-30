import { useNavigate } from 'react-router-dom'

const sectionStyle = { marginBottom: '1.25rem' } as const
const headingStyle = { color: 'var(--text)', fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.55rem' } as const
const paragraphStyle = { margin: '0 0 0.7rem', lineHeight: 1.7 } as const
const listStyle = { paddingLeft: '1.2rem', margin: '0 0 0.7rem', lineHeight: 1.7 } as const

export default function AboutScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      <h1 className="page-title">About Hyperion</h1>
      <p className="subtitle">Maritime Licensure Reviewer · Android, Website and PWA</p>

      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.7 }}>
        <p style={{ fontSize: '1.08rem', fontWeight: 850, color: 'var(--text)', marginTop: 0 }}>Learning shouldn’t be a luxury.</p>
        <p style={paragraphStyle}>Hyperion Maritime Reviewer is an independent study companion for maritime candidates preparing for theoretical licensure examinations. It brings question-based practice, competency-focused review, timed mock examinations, and revision tools together so learners can study at their own pace and focus on the subjects they need to strengthen.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Hyperion is an independent educational resource. It is not an official government, MARINA, maritime administration, or examination-authority service, and it does not guarantee examination results or professional certification.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>What you can review</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <p style={paragraphStyle}>The reviewer organizes learning content across five maritime pathways:</p>
          <ul style={listStyle}>
            <li>OIC-NW Deck — Operational Level</li>
            <li>Deck Management Level — including Chief Mate and Master Mariner preparation</li>
            <li>OIC-EW Engine — Operational Level</li>
            <li>Engine Management Level — including Second Engineer and Chief Engineer preparation</li>
            <li>GMDSS GOC — Radio Operator preparation</li>
          </ul>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Available tracks, competencies, question sets, and feature access may vary by platform, app version, and license.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Tools for your study routine</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <ul style={{ ...listStyle, marginBottom: 0 }}>
            <li>Practice sessions and competency-focused drills.</li>
            <li>Quick Scan and question-bank search for targeted revision.</li>
            <li>Timed mock examinations and performance review.</li>
            <li>Bookmarks, mistakes notebook, and saved/resumable sessions.</li>
            <li>Study history, session logs, study-time summaries, and streak tracking.</li>
            <li>Offline-capable Android study features and an installable PWA with supported offline caching.</li>
          </ul>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Android and website accounts</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <p style={paragraphStyle}><strong>Android sign-in is optional.</strong> You can use local study features and make Google Play purchases without signing in to a Hyperion account. Signing in with Google allows the app to connect to your Hyperion account.</p>
          <p style={paragraphStyle}><strong>Website/PWA accounts.</strong> Sign-in is used for website account features, checkout, license management, and supported cloud learning-progress synchronization.</p>
          <p style={paragraphStyle}><strong>License synchronization.</strong> When you sign in to both platforms using the same Hyperion account and synchronization succeeds, eligible active website licenses and Google Play entitlements may be recognized across Android and the website. This is entitlement synchronization; it does not copy Android study history to the website or website study progress to Android.</p>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Using the same email address alone does not link purchases. You must sign in to the same Hyperion account. Google Play continues to bill and manage its subscriptions, while website purchases continue to be handled through website checkout and PayMongo. Their billing, cancellations, and refund processes remain separate.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Access and payments</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <p style={paragraphStyle}><strong>Google Play:</strong> Android subscriptions are purchased, billed, renewed, and cancelled through Google Play using the Google account that made the purchase. Check the offer shown by Google Play for the exact price, duration, and renewal terms.</p>
          <p style={paragraphStyle}><strong>Website/PWA:</strong> website licenses are purchased through the Bond Store and Checkout. PayMongo handles hosted checkout; manual QR-payment submissions require verification and approval before access is activated. Website plans are fixed-term for the duration displayed at purchase and do not automatically renew unless an offer expressly says otherwise.</p>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Offline activation passes, where offered, are separate device-bound licenses. Before purchasing, confirm the platform, track, duration, price, and terms displayed in the relevant checkout.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Accuracy and responsible use</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <p style={paragraphStyle}>We aim to maintain useful study material, but questions, explanations, and references may contain errors or become outdated. Use current official publications, maritime regulations, and examination instructions as the final authority when preparing for a licensing examination.</p>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Use Hyperion for personal learning, respect intellectual-property rights, and do not redistribute protected question banks or attempt to bypass access controls. Do not rely on the reviewer as an operational manual for real-world vessel operations.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Privacy and account deletion</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <p style={paragraphStyle}>Android study progress is stored locally. Supported website/PWA learning progress can be synchronized with your signed-in Hyperion account. Account license synchronization is separate from study-progress synchronization.</p>
          <p style={paragraphStyle}>You can start permanent account deletion from the website Account area or the Android app's My Hyperion Account dialog. Deleting your Hyperion account removes account-linked licenses and data but does not cancel a Google Play subscription or erase local Android study data. Read the full Privacy Policy before proceeding.</p>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/privacy-policy')}>Read Privacy Policy</button>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Contact and support</h2>
        <div className="card" style={{ lineHeight: 1.7 }}>
          <p style={paragraphStyle}>For account, license, payment, content, or technical support, contact Hyperion through the channels below.</p>
          <p style={paragraphStyle}><strong>Email:</strong> <a href="mailto:hyperionmaritimex@gmail.com" style={{ color: 'var(--accent)' }}>hyperionmaritimex@gmail.com</a></p>
          <p style={{ ...paragraphStyle, marginBottom: '0.85rem' }}><strong>Facebook:</strong> <a href="https://www.facebook.com/hyperionbynhyle/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>facebook.com/hyperionbynhyle/</a></p>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/terms')}>Read Terms of Use</button>
        </div>
      </section>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>Hyperion Maritime Reviewer · hyperionmaritime.org</p>
    </div>
  )
}
