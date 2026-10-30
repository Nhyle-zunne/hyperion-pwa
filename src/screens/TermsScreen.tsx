import { useNavigate } from 'react-router-dom'

const sectionStyle = { marginBottom: '1.25rem' } as const
const headingStyle = { color: 'var(--text)', fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.55rem' } as const
const subheadingStyle = { ...headingStyle, fontSize: '0.95rem' } as const
const paragraphStyle = { margin: '0 0 0.7rem', lineHeight: 1.7 } as const
const listStyle = { paddingLeft: '1.2rem', margin: '0 0 0.7rem', lineHeight: 1.7 } as const

export default function TermsScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      <h1 className="page-title">Terms of Use</h1>
      <p className="subtitle">Hyperion Maritime Reviewer · Android, Website and PWA</p>

      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.65 }}>
        <p style={paragraphStyle}><strong>Effective Date:</strong> October 30, 2026 · <strong>Last Updated:</strong> October 30, 2026</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">https://hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}>These Terms of Use ("Terms") apply to the Hyperion Maritime Reviewer Android application, website, and Progressive Web Application ("Hyperion", "we", "our", or "us"). By installing, accessing, creating an account, or using a feature, you agree to the Terms that apply to that feature. If you do not agree, do not use the service.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}><strong>Important before you buy:</strong> Google Play Billing and website checkout are different payment systems. Eligible license entitlements from either source may be linked to the same Hyperion account when you sign in and synchronize, but this does not merge purchases, change who bills you, or change which provider handles cancellation and refunds.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Please also read our <a href="/privacy-policy">Privacy Policy</a>, which explains platform-specific information handling, account synchronization, retention, and deletion.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>1. Educational Purpose and No Guarantee of Results</h2>
        <p style={paragraphStyle}>Hyperion provides maritime examination-preparation materials and learning tools, including question banks, practice sessions, quick-scan/review tools, bookmarks, mistake-review features, study history, study-time summaries, and mock examinations. Available content and features depend on the track, platform, app version, and license.</p>
        <p style={paragraphStyle}>Hyperion is an independent educational resource. It is not MARINA, a government service, a maritime administration, a licensing board, or an examination authority, and it is not affiliated with, endorsed by, or authorized by those bodies. References to STCW, competencies, functions, examination terminology, or Tables of Specifications are used for educational organization and context only.</p>
        <p style={paragraphStyle}>We do not guarantee that a question will appear on an official examination, that all answers or explanations are complete or error-free, that the service will always reflect the latest official material, or that using Hyperion will result in a passing mark, Certificate of Competency, endorsement, employment, or other professional outcome. Use current official publications, instructions, approved training, and competent professional judgment as the final authority.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Hyperion is an academic preparation aid, not an operational manual. Do not rely on it as the sole or primary authority for real-world navigation, bridge or engine-room watchkeeping, radio operations, vessel handling, safety decisions, or other operational activities.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>2. Eligibility, Sign-In, and Account Security</h2>
        <p style={paragraphStyle}>Hyperion is designed for adult maritime candidates. You must provide accurate information when creating or using a website/Hyperion account, keep your authentication methods secure, and promptly tell us if you believe your account has been accessed without authorization.</p>
        <p style={paragraphStyle}><strong>Android:</strong> Google sign-in is optional. You can use local study features and Google Play Billing without creating or signing in to a Hyperion account. If you choose to sign in with Google, the app creates or accesses a Hyperion account through Supabase. You should use the same Hyperion account on the app and website when you want eligible licenses to synchronize.</p>
        <p style={paragraphStyle}><strong>Website/PWA:</strong> account-based features, website checkout, license management, and cloud learning-progress synchronization require you to sign in. Google authenticates the account; Hyperion does not receive your Google password.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Accounts and access are personal. Do not impersonate another person, access another user's account or data, sell or share account credentials, or use Hyperion for deceptive or unlawful purposes.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>3. Free Features, Licenses, and Purchases</h2>
        <p style={paragraphStyle}>Some tracks, sample questions, or features may be available without payment. Other tracks or access periods require a paid entitlement, approved manual license, or valid offline activation pass. Always check the platform, track, price, term, renewal information, and access conditions displayed before confirming a purchase.</p>

        <h3 style={subheadingStyle}>3.1 Google Play subscriptions (Android)</h3>
        <p style={paragraphStyle}>Purchases made through the Android app's Google Play checkout are processed and billed by Google Play. Subscription duration, price, trial/introductory offers, renewal timing, and other terms are those shown in the Google Play purchase flow. Unless the specific offer states otherwise, subscriptions renew automatically until cancelled through Google Play. Google may charge the account used for the purchase for each renewal.</p>
        <p style={paragraphStyle}>You are responsible for managing or cancelling a Play subscription through <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">Google Play subscriptions</a> or the Google Play Store account that made the purchase. Uninstalling Hyperion, signing out, changing the Hyperion account, or deleting a Hyperion account does not cancel a Google Play subscription. Cancellation generally stops future renewals; access through the already-paid period and any refund are governed by Google Play's current rules and decision.</p>

        <h3 style={subheadingStyle}>3.2 Website/PWA licenses</h3>
        <p style={paragraphStyle}>A website license is purchased through the Bond Store/Checkout at <a href="https://hyperionmaritime.org/account?tab=payments">hyperionmaritime.org</a> and is linked to the signed-in Hyperion account used at checkout. Website plans are fixed-term licenses for the track and duration selected (for example, week, month, or year) and displayed before payment. They do not automatically renew unless a particular offer expressly says otherwise.</p>
        <p style={paragraphStyle}>PayMongo hosted checkout processes website payments using the payment methods currently available in the checkout flow. A manual QR payment is a submission for review; entering a transaction reference or sending proof does not itself activate a license. Manual access is granted only after Hyperion verifies and approves the payment. The account dashboard displays the recorded license and expiry details.</p>
        <p style={paragraphStyle}>Website payment, order, or refund questions should be sent to <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a> with the website order reference. A request is reviewed under applicable law and the purchase conditions. Submitting a request, cancelling a pending checkout, or deleting an account does not automatically establish a refund entitlement or guarantee a refund.</p>

        <h3 style={subheadingStyle}>3.3 Linking eligible licenses across platforms</h3>
        <p style={paragraphStyle}>Google Play purchases and website licenses remain separate transactions. When you sign in to the Android app and website using the same Hyperion account and synchronization succeeds, the service can recognize eligible active entitlements from either source on the other platform. This is account-based license recognition; it does not move the original purchase, change its billing provider, change its cancellation or refund process, or turn one purchase into a different product.</p>
        <p style={paragraphStyle}>Using the same email address alone does not link purchases. You must sign in to the same Hyperion account and complete synchronization. Google Play purchases remain owned and billed through the Google Play account that made them. A Play purchase token is linked to one Hyperion account by the server; account ownership checks may prevent the same purchase from being linked to a different Hyperion account. New purchases made while signed in may include a privacy-preserving account identifier. Older purchases may not contain that identifier and are subject to the existing first-link and purchase-token ownership checks.</p>
        <p style={paragraphStyle}>Do not assume a purchase can be transferred between Hyperion accounts, between Google Play accounts, or between payment systems. Contact support before making another purchase if you believe a payment or license was associated with the wrong account.</p>

        <h3 style={subheadingStyle}>3.4 Offline activation passes</h3>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Where available, a signed offline activation pass is a separate device-bound license. It is verified by the Android app and may be limited to the device and term encoded in the pass. It is not a Google Play subscription or a website license, does not change those purchases, and may not be transferable to another device.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>4. Acceptable Use</h2>
        <p style={paragraphStyle}>You may use Hyperion for personal, lawful study and examination preparation. You must not:</p>
        <ul style={listStyle}>
          <li>copy, scrape, extract, redistribute, publish, sell, or commercially exploit question banks, explanations, software, or protected content without permission;</li>
          <li>share or resell accounts, purchase tokens, license keys, offline activation passes, or other credentials or access entitlements;</li>
          <li>bypass authentication, license checks, subscription verification, content controls, rate limits, or other technical protections;</li>
          <li>reverse engineer, decompile, modify, interfere with, or attempt to compromise the service except where applicable law expressly permits it;</li>
          <li>upload malicious code, disrupt service operation, or access systems or data without authorization; or</li>
          <li>use Hyperion in a way that violates law, another person's rights, or the integrity of an examination.</li>
        </ul>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>We may investigate suspected misuse and, where reasonably necessary and permitted by law, restrict access to protect users, service integrity, intellectual property, and payment/license systems.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>5. Intellectual Property and Study Content</h2>
        <p style={paragraphStyle}>The Hyperion name, branding, software, interface, original explanations, and other materials owned by Hyperion are protected by applicable intellectual-property laws. Subject to these Terms and any paid or offline license, we grant you a limited, personal, revocable, non-exclusive, non-transferable right to use the relevant service for individual educational review.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Some subject matter may refer to public regulations, standards, or third-party materials. Rights in those materials remain with their respective owners. If you believe content hosted by Hyperion infringes your rights or is materially inaccurate, contact us with enough detail for review.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>6. Study Data, Offline Use, and Synchronization</h2>
        <p style={paragraphStyle}>The Android app stores study progress and preferences locally on the device. That local study history is not uploaded to or merged with the website account. Clearing app storage or uninstalling Android may permanently remove local study records and offline app data.</p>
        <p style={paragraphStyle}>The website/PWA uses browser storage and service-worker caches for local state and offline operation. When you are signed in and online, supported website learning data may be synchronized with your Hyperion account. Not every browser-local item, cache, setting, or device-specific record is necessarily synchronized or recoverable. Clearing browser storage can remove local-only data or require you to sign in again.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Account license synchronization between Android and the website is distinct from study-progress synchronization. It does not mean Android study history is copied to the website or vice versa.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>7. Privacy</h2>
        <p style={paragraphStyle}>Our collection and use of personal information are described in the <a href="/privacy-policy">Privacy Policy</a>. Please read it before using account, payment, synchronization, or support features. Do not send passwords, one-time authentication codes, or full payment-card details through support channels.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>8. Availability, Maintenance, and Changes</h2>
        <p style={paragraphStyle}>We may update, correct, improve, suspend, or discontinue features, question banks, content, or supported devices. We aim to keep Hyperion useful and available but do not guarantee uninterrupted operation, compatibility with every device or browser, or permanent availability of a particular feature or question. Maintenance, security changes, or content corrections may be made when reasonably necessary.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>9. Account Deletion, Suspension, and Termination</h2>
        <h3 style={subheadingStyle}>9.1 Voluntary account deletion</h3>
        <p style={paragraphStyle}>After signing in, you can start permanent account deletion through Website Account → Delete account or Android app drawer → My Hyperion Account → Delete Account. Both platforms use the same authenticated deletion service. The process requires an explicit typed confirmation.</p>
        <p style={paragraphStyle}>When deletion completes, it removes the Hyperion sign-in account and associated account-linked website orders/payment submissions, website entitlements, linked Google Play entitlement and purchase-link records, and account-linked website learning progress. It does not remove Android study records stored locally on the device or cancel Google Play billing.</p>
        <p style={paragraphStyle}><strong>Active license warning:</strong> any website/PWA license linked to the deleted account and any server-side Google Play entitlement link for that account will be removed. Access that depends on the deleted Hyperion account will end. Google Play subscriptions are billed separately and may continue to renew and charge the Google account until cancelled through Google Play. Manage Play billing separately at <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">Google Play subscriptions</a>. Google and other providers may retain their own records.</p>
        <p style={paragraphStyle}>The deletion service may refuse to proceed while pending website payment submissions, open checkouts, unresolved PayMongo sessions, or required administrative audit-trail dependencies remain. Resolve the issue or contact support before retrying. Deletion is permanent and does not automatically grant a refund or transfer a license to another account.</p>

        <h3 style={subheadingStyle}>9.2 Automated account retention</h3>
        <p style={paragraphStyle}>For an account with no active website or linked Google Play entitlement, 30 consecutive days without a recorded authenticated account-activity timestamp marks the account inactive, followed by a separate 30-day grace period. Active entitlements defer inactivity-based deletion. When a license expires, at least a 30-day expiry-based grace period applies; automated deletion is considered only after both the expiry-based grace period and the inactivity-plus-grace deadline have passed, using the later deadline. Pending payment checks, administrator status, or an administrative audit dependency may defer or exclude deletion. This process concerns Hyperion accounts and does not cancel Google Play subscriptions or erase Android study data stored locally.</p>

        <h3 style={subheadingStyle}>9.3 Suspension</h3>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>We may suspend or terminate access if we reasonably believe you have violated these Terms, attempted fraud or unauthorized access, created a security risk, or where necessary to comply with law or protect the service and its users. Where appropriate and legally permitted, we will take reasonable steps to explain the reason for a restriction.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>10. Disclaimers and Limitation of Liability</h2>
        <p style={paragraphStyle}>To the extent permitted by applicable law, Hyperion is provided on an "as is" and "as available" basis. We make no warranty that the service or content will be uninterrupted, complete, error-free, current, or suitable for every user's requirements.</p>
        <p style={paragraphStyle}>To the extent permitted by law, Hyperion is not liable for indirect, incidental, special, consequential, or punitive losses, loss of data, lost opportunities, or examination outcomes arising from use of or inability to use the service. Nothing in these Terms excludes or limits liability or consumer rights that cannot lawfully be excluded or limited under applicable law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>11. Third-Party Services</h2>
        <p style={paragraphStyle}>Hyperion relies on third-party services including Google and Google Play (Google sign-in, Android billing, and purchase verification), Firebase Remote Config and Google Cloud Firestore (certain Android activation and promo-code functions), Supabase (authentication, database, and backend functions), PayMongo (website checkout and payment processing), Cloudflare (website hosting, delivery, and security), and Meta/Facebook or email providers when you choose to contact support through those channels. Their services are governed by their own terms and privacy policies. We do not control their independent systems, billing decisions, or retention rules, except that our own use of those services remains subject to applicable law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>12. Changes to These Terms</h2>
        <p style={paragraphStyle}>We may revise these Terms to reflect changes in Hyperion, our practices, or applicable law. We will post the revised text on this page and update the "Last Updated" date. Where required by law, we will provide additional notice or seek consent. Continued use after revised Terms take effect means you accept the updated Terms to the extent permitted by law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>13. Governing Law and Contact</h2>
        <p style={paragraphStyle}>These Terms are intended to be interpreted consistently with applicable laws of the Philippines, without removing any mandatory rights that may apply to you under the laws of your place of residence. Any dispute will be handled by a competent forum under applicable law.</p>
        <p style={paragraphStyle}><strong>Service / Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Email:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">https://hyperionmaritime.org</a></p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}><strong>Android Application ID:</strong> com.nhyle.hyperionmaritime</p>
      </section>
    </div>
  )
}
