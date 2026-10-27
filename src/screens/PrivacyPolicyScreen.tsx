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
        <p style={paragraphStyle}><strong>Effective Date:</strong> October 27, 2026 · <strong>Last Updated:</strong> October 27, 2026</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Privacy Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}>Hyperion Maritime ("Hyperion," "we," "our," or "us") provides Hyperion Maritime Reviewer, an examination-preparation service for maritime deck officers, marine engineers, radio operators, and other eligible candidates. It is available as an Android application and as a website and Progressive Web Application (PWA). This policy explains what information we collect, why, who receives it, how long we keep it, and the choices and rights you have.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>If you do not agree with this policy, please do not use our services.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>1. Summary</h2>
        <ul>
          <li>The Android app has no Hyperion sign-in account; its study progress and preferences are stored locally on the device. Google Play manages Android subscriptions separately.</li>
          <li>The website/PWA uses Google sign-in through Supabase and can synchronize supported study progress, including session history, bookmarks, study-time records, and the daily check-in streak, with the signed-in website account.</li>
          <li>Google Play subscriptions and website/PWA licenses are separate purchases. The same email address does not combine, transfer, or activate them across platforms.</li>
          <li>Website purchases are processed through PayMongo checkout or submitted for manual QR-payment review. We record the order and payment status needed to manage the website license.</li>
          <li>The Android build includes Firebase Analytics/Remote Config components. Google may process app-use and technical information as described below. Hyperion does not display third-party advertisements and does not sell personal information.</li>
          <li>You can request deletion of your website account as described below; website deletion does not cancel a Google Play subscription or erase locally stored Android study data.</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>2. Information We Collect</h2>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>2.1 Android App</h3>
        <p style={paragraphStyle}><strong>Study data stored on your device.</strong> Practice and mock-exam progress, competency-drill answers, bookmarks, mistakes notebook, study time, and preferences are stored in the Android app's private local storage. The Android app does not use the website's Google sign-in account to synchronize this local study data. We generally cannot access or recover local-only progress for you. Clearing app storage or uninstalling the app can remove it.</p>
        <p style={paragraphStyle}><strong>Google Play purchases and subscriptions.</strong> Google Play Billing processes purchases and subscription renewals. The Android app checks eligible purchase/product and subscription status through Google Play Billing and may retain purchase-token/product/status information locally to recognize access and re-check subscription status. Google Play handles billing credentials and keeps its own purchase records under Google's terms and privacy practices. A Google Play subscription is separate from a website/PWA license and is not automatically linked to a website account.</p>
        <p style={paragraphStyle}><strong>Device-bound activation and license integrity.</strong> Some Android license/activation features use a device-specific terminal code derived from an Android device identifier so an eligible offline activation pass can be bound to that device. If you voluntarily share that code or an activation/license reference with Hyperion support, we may use it to investigate or process the related license request. Do not send government ID numbers or other unrelated sensitive information through support.</p>
        <p style={paragraphStyle}><strong>Firebase Analytics and Remote Config.</strong> The current Android build includes Firebase Analytics and Firebase Remote Config components. When Analytics collection is active, Google may automatically process app-instance identifiers, app launches/sessions and interaction events, app version, and related app/device technical information. Remote Config may contact Google to retrieve configuration values. Google processes this information under its own policies and applicable settings. The Android manifest removes the advertising ID permission, and Hyperion does not display third-party advertisements.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}><strong>Permissions.</strong> The Android manifest requests Internet and network-state access. It does not request access to contacts, photos, the camera, microphone, or precise location. If you send a device code, screenshot, or other information to us through support, we process the information you choose to share.</p>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>2.2 Website and PWA</h3>
        <ul>
          <li><strong>Sign-in information:</strong> email address, display name, profile picture (if provided), Google/provider account identifier, and authentication/session data. Google authenticates you through Supabase; Hyperion does not receive your Google password.</li>
          <li><strong>Profile information:</strong> full name and, if you choose to provide them, company and school. These details may be saved to your website account profile and used in website order/payment records.</li>
          <li><strong>License and order information:</strong> your account ID, purchased track(s), selected week/month/year term, price and currency, order reference, payment method, checkout/payment provider identifiers, payment reference, status, timestamps, expiry/entitlement state, and related support/reconciliation records.</li>
          <li><strong>Website checkout through PayMongo:</strong> PayMongo and the selected payment method provider may process your name/email, transaction amount, payment credentials or account details (for example, card/e-wallet/bank information), device/network data, and fraud/security information under their own policies. Hyperion's website forms do not ask you to enter a card number or card security code directly; our records primarily contain order/payment references, payment method, amount and status, and the customer/profile fields needed to administer the order.</li>
          <li><strong>Manual QR-payment submissions:</strong> your full name, selected product and term, transaction/reference number, optional company/school and notes, submission status, and review records. Manual payment does not activate a license until a payment is verified. If you choose to send a payment screenshot to our Facebook page or by email, that image and its contents are also processed by Meta or your email provider. Check screenshots for unrelated financial or personal details before sending.</li>
          <li><strong>Synced learning data:</strong> supported study-session history and metadata, saved/resumable progress, answers/progress, bookmarks, mistakes/review records, study-time entries, mock-exam progress, and daily app-open check-in streak information may be stored in your account-linked learning-progress record. Some local preferences or cached assets may remain only in your browser/device and may not synchronize.</li>
          <li><strong>Browser and offline storage:</strong> localStorage, IndexedDB, service-worker/PWA caches, and similar browser storage may be used for authentication state, settings, local progress, and eligible offline app/content data. Clearing browser storage may remove local-only data or require you to sign in again.</li>
          <li><strong>Technical and security data:</strong> IP address, browser/device type, app version, request and error metadata, timestamps, and similar information may be processed by hosting, delivery, authentication, payment, or security providers to operate, troubleshoot, and protect the Website.</li>
        </ul>
        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>2.3 Support Communications</h3>
        <p style={paragraphStyle}>If you contact us by email, Meta Messenger, or another channel, we process the information you send (contact details, account reference, message content, and troubleshooting details) to respond and keep reasonable support records.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>3. How We Use Information</h2>
        <p style={paragraphStyle}>We use information to create and manage Website accounts, authenticate users, deliver requested examination content and study features, verify purchases and promotional codes, manage access to examination tracks, prevent fraud and misuse, maintain and secure our services, respond to support requests, comply with legal obligations, and protect legal rights.</p>
        <p style={paragraphStyle}>We use Google sign-in for authentication and the account information described in this policy. Website account and purchase information is used to provide the specific license ordered, verify and reconcile payments, manage expiry and account access, prevent fraud and duplicate payments, respond to support requests, secure the service, and meet legal obligations. We do not sell personal information or use website purchase data to create advertising profiles. Payment and account decisions may involve service checks and, for manual QR submissions, human review.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>4. Legal Bases</h2>
        <p style={paragraphStyle}>Where data protection law such as the GDPR applies, we rely on performance of a contract, legitimate interests (including security and fraud prevention), legal obligations, and consent where separately requested. You may withdraw consent at any time.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>5. Service Providers and Data Sharing</h2>
        <ul>
          <li><strong>Supabase</strong> — website sign-in, database, account-linked progress, and backend functions: <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</li>
          <li><strong>Google and Google Play</strong> — Google sign-in, Android subscription billing, and Google account services: <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</li>
          <li><strong>Firebase</strong> — Android app analytics and remote configuration components, as described above: <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noreferrer">Firebase privacy and security information</a>.</li>
          <li><strong>PayMongo</strong> — hosted website checkout and payment processing: <a href="https://www.paymongo.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</li>
          <li><strong>Cloudflare</strong> — website hosting, content delivery, and security: <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Privacy Policy</a>.</li>
          <li><strong>Meta</strong> — Facebook Page/Messenger support, if you choose to contact or send payment screenshots through those channels: <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">Privacy Policy</a>.</li>
        </ul>
        <p style={paragraphStyle}>We share only the information reasonably needed for those providers to perform the described services, and may disclose information where required by law or valid legal process, to investigate fraud or protect users and systems, or to a successor if our business or assets are transferred, subject to applicable law. We do not sell personal information or disclose it for third-party behavioral advertising. Providers process information under their own policies and may retain their own transaction or support records.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>6. Advertising, Analytics, and Tracking</h2>
        <p style={paragraphStyle}>Hyperion does not display third-party advertisements or sell personal information for advertising. The Android build includes Firebase Analytics; when enabled, it may process app-instance identifiers and app-use/interaction events as described in Section 2. We do not intentionally use those events to build advertising profiles. The Android manifest removes the advertising ID permission. The Website/PWA uses browser storage and service-worker caches for sign-in, settings, progress, security, and supported offline features; hosting and security services may also process technical request logs. We will update this policy if our material data practices change and provide notice or obtain consent where required by law.</p>
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
