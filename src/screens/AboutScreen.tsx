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
          <p style={paragraphStyle}>The Android app and website may offer different account and storage experiences. The website/PWA supports account sign-in and account-linked access features. Some features or tracks may be free, while others may require an eligible license or subscription.</p>
          <p style={{ ...paragraphStyle, marginBottom: 0 }}>Website license requests may be reviewed before access is granted. Access is governed by the offer displayed to you and our <button type="button" onClick={() => navigate('/terms')} style={{ display: 'inline', border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>Terms of Use</button>.</p>
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
          <p style={paragraphStyle}>The information Hyperion handles depends on whether you use the Android app or the website/PWA. Our Privacy Policy describes account sign-in, locally stored study progress, license verification, service providers, retention, and account-deletion options.</p>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/privacy-policy')}>Read Privacy Policy</button>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>Contact and support</h2>
        <div className="card" style={{ lineHeight: 1.65 }}>
          <p style={paragraphStyle}>For account, license, content, or technical support, contact Hyperion through the channels below.</p>
          <p style={paragraphStyle}><strong>Email:</strong> <a href="mailto:hyperionmaritimex@gmail.com" style={{ color: 'var(--accent)' }}>hyperionmaritimex@gmail.com</a></p>
          
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/terms')}>Read Terms of Use</button>
        </div>
      </section>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>Hyperion Maritime Reviewer · hyperionmaritime.org</p>
    </div>
  )
}
