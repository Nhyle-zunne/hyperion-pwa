import { useNavigate } from 'react-router-dom'

const sectionStyle = { marginBottom: '1.25rem' } as const
const headingStyle = { color: 'var(--text)', fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.55rem' } as const
const paragraphStyle = { margin: '0 0 0.7rem', lineHeight: 1.7 } as const

export default function AboutScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      <h1 className="page-title">About Hyperion</h1>
      <p className="subtitle">Maritime Licensure Reviewer</p>

      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.65 }}>
        <p style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', marginTop: 0 }}>Learning shouldn’t be a luxury.</p>
        <p style={paragraphStyle}>Hyperion Maritime Reviewer is a study companion built to help maritime candidates prepare with a more accessible and organized way to review. It brings question-based practice and revision tools together so learners can study at their own pace, revisit difficult topics, and track their learning activity.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Hyperion is an independent educational resource. It is not an official government, MARINA, or examination-authority application, and it does not guarantee examination results.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>What you can review</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <p style={paragraphStyle}>Hyperion organizes maritime reviewer content across deck, engine, and radio-operator pathways, including:</p>
          <ul style={{ paddingLeft: '1.2rem', margin: '0 0 0.7rem' }}>
            <li>OIC-NW Deck (Operational Level)</li>
            <li>Chief Mate and Master Mariner (Deck Management Level)</li>
            <li>OIC-EW Engine (Operational Level)</li>
            <li>Second Engineer and Chief Engineer (Engine Management Level)</li>
            <li>GMDSS GOC (Radio Operator)</li>
          </ul>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Available tracks, question sets, and features may differ by app version, account, or license.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Tools for your study routine</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <ul style={{ paddingLeft: '1.2rem', margin: 0 }}>
            <li>Practice sessions and competence-focused review.</li>
            <li>Quick browsing and revision of available questions.</li>
            <li>Mock examinations to help you practice under exam-like conditions.</li>
            <li>Bookmarks and review tools to revisit challenging material.</li>
            <li>Study history and time summaries where supported by your version and settings.</li>
          </ul>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Access and accounts</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <p style={paragraphStyle}>Hyperion has separate Android-app and website/PWA licensing systems. They are not one shared subscription, even if you use the same email address or Google account on both platforms. Features, prices, access periods, renewal rules, and available tracks may differ.</p>
          <p style={paragraphStyle}><strong>Google Play subscriptions:</strong> A subscription purchased inside the Android app is billed and managed through Google Play. It applies to the eligible Android-app access described in the Google Play offer. It does not automatically unlock a website/PWA license.</p>
          <p style={paragraphStyle}><strong>Website/PWA licenses:</strong> A license purchased at <a href="https://hyperionmaritime.org/account?tab=payments" style={{ color: 'var(--accent)' }}>hyperionmaritime.org</a> is linked to the Hyperion account signed in on the website. Website checkout is processed through PayMongo; QR transfers submitted through manual payment require verification before access is activated. Website access is sold for the duration shown at purchase and does not automatically renew unless the checkout expressly states otherwise.</p>
          <p style={paragraphStyle}>A website/PWA purchase does not activate a Google Play subscription or an Android device-bound offline activation pass. A Google Play subscription does not activate a website/PWA license. These purchases, their cancellation/refund processes, and their access records cannot be transferred or combined automatically. Please check which platform you are buying for before paying.</p>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Website license activation and access are governed by the offer displayed at checkout and our <button type="button" onClick={() => navigate('/terms')} style={{ display: 'inline', border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Terms of Use</button>.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Accuracy and responsible use</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <p style={paragraphStyle}>We aim to make Hyperion useful and keep its content maintained, but questions, explanations, and references may contain errors or become outdated. Use current official publications and instructions as the final authority when preparing for a licensing examination.</p>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Please use the reviewer for personal learning, respect intellectual-property rights, and do not redistribute protected question banks or attempt to bypass access controls.</p>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Privacy</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <p style={paragraphStyle}>Information handling differs by platform. The Android app stores study data locally and uses Google Play Billing for Play purchases; the website/PWA uses Google sign-in, account-linked learning progress, and separate website payment and license records. Our Privacy Policy explains these differences, the third-party providers involved, retention, and deletion options.</p>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/privacy-policy')}>Read Privacy Policy</button>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Contact and support</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <p style={paragraphStyle}>For account, license, content, or technical support, contact Hyperion through the channels below.</p>
          <p style={paragraphStyle}><strong>Email:</strong> <a href="mailto:hyperionmaritimex@gmail.com" style={{ color: 'var(--accent)' }}>hyperionmaritimex@gmail.com</a></p>
          <p style={{ ...paragraphStyle, marginBottom: '0.85rem' }}><strong>Contact us:</strong> <a href="https://www.facebook.com/hyperionbynhyle/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>facebook.com/hyperionbynhyle/</a></p>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/terms')}>Read Terms of Use</button>
        </div>
      </section>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>Hyperion Maritime Reviewer · hyperionmaritime.org</p>
    </div>
  )
}
