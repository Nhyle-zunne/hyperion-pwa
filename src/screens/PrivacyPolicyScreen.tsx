import { useNavigate } from 'react-router-dom'

const sectionStyle = { marginBottom: '1.25rem' } as const
const headingStyle = { color: 'var(--text)', fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.55rem' } as const
const paragraphStyle = { margin: '0 0 0.65rem', lineHeight: 1.7 } as const

export default function PrivacyPolicyScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      <h1 className="page-title">Privacy Policy</h1>
      <p className="subtitle">Hyperion Maritime Reviewer</p>
      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.6 }}>
        <p style={paragraphStyle}><strong>Effective Date:</strong> October 26, 2026 · <strong>Last Updated:</strong> October 26, 2026</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Privacy Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}>Hyperion Maritime ("Hyperion," "we," "our," or "us") provides Hyperion Maritime Reviewer, an examination-preparation service for maritime deck officers, marine engineers, radio operators, and other eligible candidates. It is available as an Android application and as a website and Progressive Web Application (PWA). This policy explains what information we collect, why, who receives it, how long we keep it, and the choices and rights you have.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>If you do not agree with this policy, please do not use our services.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>1. Summary</h2>
        <ul><li>The Android App has no sign-in or user accounts; study progress is stored on your device.</li><li>The Website/PWA lets you sign in with Google or Facebook through Supabase Auth.</li><li>Android purchases are handled by Google Play Billing; we do not receive payment card details.</li><li>Licensing and promotional codes are checked online through Google Firebase services.</li><li>We do not sell personal information or show third-party advertising.</li><li>You can request deletion of your Website account as described below.</li></ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>2. Information We Collect</h2>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>2.1 Android App</h3>
        <p style={paragraphStyle}><strong>Study data stored on your device.</strong> Practice and mock exam progress, competency drill answers, bookmarks, mistakes notebook, study time, and app preferences stay in the app's private storage. We do not receive this data and cannot access, recover, or delete it for you. Clear app data in Android Settings → Apps → Hyperion Maritime → Storage, or uninstall the app, to remove it.</p>
        <p style={paragraphStyle}><strong>Google Play purchases.</strong> Google Play Billing processes transactions. Our app and licensing service may process Google Play order IDs, product and subscription identifiers, purchase tokens, purchase times, and subscription status to verify purchases, grant access, and prevent fraud. Google handles payment details under its own policies.</p>
        <p style={paragraphStyle}><strong>Promotional codes and license checks.</strong> We may process a submitted code or license reference, a device or terminal identifier used for license verification, app package name and version, device manufacturer/model and Android version, validation results, and timestamps.</p>
        <p style={paragraphStyle}><strong>What the Android App does not do.</strong> It does not ask for your name, email, phone number, contacts, photos, microphone, camera, or location. It does not contain third-party advertising or third-party analytics SDKs.</p>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>2.2 Website and PWA</h3>
        <ul><li><strong>Sign-in information:</strong> email address, display name, profile picture (if provided), provider account identifier, and authentication session data when you choose Google or Facebook sign-in. We never receive your Google or Facebook password.</li><li><strong>Account and license data:</strong> your Hyperion account identifier, license status, and access entitlements.</li><li><strong>Study data:</strong> information a Website feature saves or synchronizes to your account, if any.</li><li><strong>Browser storage:</strong> localStorage, cookies, or similar technologies needed to keep you signed in and remember settings.</li><li><strong>Technical data:</strong> such as IP address and browser type, processed by hosting and infrastructure providers to deliver and secure the Website.</li></ul>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>2.3 Support Communications</h3>
        <p style={paragraphStyle}>If you contact us by email, Meta Messenger, or another channel, we process the information you send (contact details, account reference, message content, and troubleshooting details) to respond and keep reasonable support records.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>3. How We Use Information</h2>
        <p style={paragraphStyle}>We use information to create and manage Website accounts, authenticate users, deliver requested examination content and study features, verify purchases and promotional codes, manage access to examination tracks, prevent fraud and misuse, maintain and secure our services, respond to support requests, comply with legal obligations, and protect legal rights.</p>
        <p style={paragraphStyle}>We do not use Google or Facebook sign-in to access information in your social accounts beyond what is described in this policy. We do not use your information for profiling, behavioral advertising, or automated decisions that have legal or similarly significant effects on you.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>4. Legal Bases</h2>
        <p style={paragraphStyle}>Where data protection law such as the GDPR applies, we rely on performance of a contract, legitimate interests (including security and fraud prevention), legal obligations, and consent where separately requested. You may withdraw consent at any time.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>5. Service Providers and Data Sharing</h2>
        <ul><li><strong>Supabase</strong> — Website authentication and backend: <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</li><li><strong>Google</strong> — Google sign-in, Google Play Billing, Firebase Remote Config, and Cloud Firestore: <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</li><li><strong>Meta</strong> — Facebook Login: <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">Privacy Policy</a>.</li><li>Hosting, content delivery, and security providers that help operate the Website.</li></ul>
        <p style={paragraphStyle}>We may disclose information where required by law or valid legal process, to investigate fraud or protect users and systems, or to a successor if our business or assets are transferred, subject to applicable law. We do not sell personal information or share it with third parties for their own advertising purposes.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>6. Advertising, Analytics, and Tracking</h2>
        <p style={paragraphStyle}>Hyperion does not display third-party ads and does not use advertising identifiers for tracking. The Android App does not include third-party analytics SDKs. The Website uses storage and cookies essential for sign-in, settings, and security. If we add non-essential analytics or tracking, we will update this policy and obtain consent where required by law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>7. Data Retention</h2>
        <ul><li>Android study data stays on your device until you clear app data or uninstall.</li><li>Website account data is kept while your account is active and processed for deletion after a verified request, subject to legal exceptions.</li><li>Authentication records are kept while your account is active and removed with the account, where applicable.</li><li>Purchase, license, and promotional-code records may be retained as needed to verify entitlements, prevent fraud, and meet tax, accounting, or legal requirements.</li><li>Support communications may be retained for a reasonable period after resolution.</li></ul>
        <p style={paragraphStyle}>Backups and logs may take additional time to be overwritten. Google Play transaction records are held by Google under its own retention rules.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>8. Your Choices, Deletion, and Rights</h2>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>8.1 Deleting your Website account</h3>
        <p style={paragraphStyle}>You can delete your Website account through Account → Delete Account, or visit <a href="https://hyperionmaritime.org/delete-account">hyperionmaritime.org/delete-account</a>. You can also email <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a> from the address associated with your account with the subject “Delete my account.”</p>
        <p style={paragraphStyle}>Deletion is permanent, not temporary deactivation. We delete or de-identify your profile, sign-in identifiers, license links, and synced study data after a verified request, except limited records we must retain as described in this policy. Deleting your account may remove your ability to sign in or restore account-linked access. Facebook Login can also be removed under Facebook Settings → Apps and Websites.</p>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>8.2 Android App data</h3>
        <p style={paragraphStyle}>Because the Android App has no accounts and keeps study data on your device, clear app data in Android Settings → Apps → Hyperion Maritime → Storage. To request removal of license-verification records associated with a device identifier or promotional code, email us with enough information to locate them. Google Play purchase records are managed through your Google account.</p>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>8.3 Your rights</h3>
        <p style={paragraphStyle}>Depending on where you live, you may have rights to be informed, access, correct, erase or block, object to or restrict processing, data portability, withdraw consent, and seek remedies for unlawful processing. These may include rights under the Philippine Data Privacy Act of 2012 (RA 10173), GDPR/UK GDPR, and CCPA/CPRA where applicable. We do not sell or share personal information as those laws define those terms, and we do not discriminate against you for exercising applicable rights.</p>
        <p style={paragraphStyle}>To exercise a right, email <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a>. We may need to verify your identity. Please do not send passwords, authentication codes, or payment card details.</p>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>8.4 Complaints</h3>
        <p style={paragraphStyle}>You may contact the <a href="https://privacy.gov.ph" target="_blank" rel="noreferrer">National Privacy Commission of the Philippines</a> or your local data protection authority if you are not satisfied with our response.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>9. Data Security</h2>
        <p style={paragraphStyle}>We use reasonable technical and organizational measures, including HTTPS/TLS, authentication and session controls, backend access restrictions, Android's application sandbox, and license-verification controls. No system is completely secure. If a breach affects personal information, we will notify affected users and authorities as required by law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>10. International Processing</h2>
        <p style={paragraphStyle}>Our providers may process information in countries other than your own, including the United States and other countries where they operate. Where required, transfers rely on provider safeguards such as standard contractual clauses or equivalent mechanisms.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>11. Children's Privacy</h2>
        <p style={paragraphStyle}>Hyperion Maritime Reviewer is intended for adults and candidates preparing for maritime licensing. It is not directed to children under 18, and we do not knowingly collect personal information from anyone under 18. If you believe a child has provided personal information, contact <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a>.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>12. Subscriptions and Cancellation</h2>
        <p style={paragraphStyle}>Android subscriptions are managed by Google Play. Manage or cancel them through Google Play Store → Profile → Payments & subscriptions → Subscriptions. Cancelling a subscription does not delete locally stored study data or a Website account. If a license is revoked, access changes according to the applicable license terms.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>13. Changes to This Policy</h2>
        <p style={paragraphStyle}>We may update this policy as our app, providers, or legal obligations change. We will post revised policy text here and update the “Last Updated” date. Where required by law, we will provide additional notice or ask for consent.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>14. Contact</h2>
        <p style={paragraphStyle}><strong>Service:</strong> Hyperion Maritime Reviewer</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Privacy Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">https://hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Android Application ID:</strong> com.nhyle.hyperionmaritime</p>
      </section>
    </div>
  )
}
