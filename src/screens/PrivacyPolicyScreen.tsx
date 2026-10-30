import { useNavigate } from 'react-router-dom'

const sectionStyle = { marginBottom: '1.25rem' } as const
const headingStyle = { color: 'var(--text)', fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.55rem' } as const
const subheadingStyle = { ...headingStyle, fontSize: '0.95rem' } as const
const paragraphStyle = { margin: '0 0 0.7rem', lineHeight: 1.7 } as const
const listStyle = { paddingLeft: '1.2rem', margin: '0 0 0.7rem', lineHeight: 1.7 } as const

export default function PrivacyPolicyScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      <h1 className="page-title">Privacy Policy</h1>
      <p className="subtitle">Hyperion Maritime Reviewer · Android, Website and PWA</p>

      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.65 }}>
        <p style={paragraphStyle}><strong>Effective Date:</strong> October 31, 2026 · <strong>Last Updated:</strong> October 31, 2026</p>
        <p style={paragraphStyle}><strong>Personal Information Controller / Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">https://hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Privacy Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}>Hyperion Maritime ("Hyperion", "we", "our", or "us") provides Hyperion Maritime Reviewer through an Android application and the hyperionmaritime.org website and Progressive Web Application ("PWA"). This policy explains the personal information and device or account data processed by each platform, why it is used, the service providers involved, retention, and how you can exercise your privacy rights.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Please read this policy before using account, licensing, payment, or synchronization features. You may use many Android study features without signing in to a Hyperion account.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>1. At a Glance</h2>
        <ul style={listStyle}>
          <li>Android study records are saved locally first. When you sign in to a Hyperion account and an internet connection is available, bookmarks, mistakes/review records, study-time segments, and completed session history are automatically synchronized with the same account used by the website/PWA. Android sign-in remains optional; records that have not synchronized remain on the device.</li>
          <li>Google sign-in on Android is optional. When you sign in, Hyperion uses your Supabase account to synchronize eligible license entitlements and supported study progress between the Android app and website/PWA. Study synchronization runs when a connection is available and does not prevent offline study.</li>
          <li>Website/PWA users can sign in with Google. Supported website learning progress can be synchronized with that signed-in Hyperion account across supported browsers and devices.</li>
          <li>Google Play subscriptions are billed and managed by Google Play. Website/PWA licenses are purchased through the website and processed through PayMongo or reviewed after a manual QR payment submission. These are separate billing products, although eligible entitlements can be linked to the same Hyperion account when you sign in and synchronize.</li>
          <li>Hyperion does not display third-party advertisements or sell personal information for advertising.</li>
          <li>You can permanently delete a signed-in Hyperion account from the website or Android app. Account deletion does not cancel Google Play billing or erase Android study data stored locally on your device.</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>2. Information Processed</h2>

        <h3 style={subheadingStyle}>2.1 Android Application</h3>
        <p style={paragraphStyle}><strong>Local study information.</strong> The app stores study activity such as selected answers, practice and mock-exam progress, saved or resumable sessions, bookmarks, mistakes/review records, study-time segments, streak and history information, and app preferences in private local application storage. When you sign in to a Hyperion account, supported records (currently bookmarks, mistakes/review records, study-time segments, and completed session history) are synchronized with that account when an internet connection is available. The app continues to work offline; changes made offline are kept locally until a later synchronization. Google sign-in is optional. Records that have not synchronized remain device-local and may be lost if you clear app storage or uninstall the app. Android system backup is disabled for the app.</p>
        <p style={paragraphStyle}><strong>Optional Hyperion account and sign-in.</strong> If you choose Continue with Google, Google provides an identity token that is exchanged with Supabase Auth. Hyperion and Supabase process the account email address, provider identity/user ID, account metadata made available by Google, and authentication/session information. The app stores its sign-in session in Android encrypted preferences. Hyperion does not receive your Google password.</p>
        <p style={paragraphStyle}><strong>License synchronization.</strong> When signed in and you choose to synchronize, the app reads eligible website and Google Play entitlements belonging to your authenticated Hyperion account. The account database stores license track, status, source, purchase or order reference, and expiry information needed to recognize access. A signed-in app may also send an authenticated account-activity timestamp to Hyperion, at most once every 15 minutes, to support account security and inactivity-retention checks.</p>
        <p style={paragraphStyle}><strong>Google Play purchases.</strong> Google Play Billing processes Android purchases and subscription renewals. The app locally stores purchase tokens and plan/status/expiry information in protected app storage so it can recognize the purchase and re-check ownership. When you link a purchase to a signed-in Hyperion account, the purchase token is sent to Hyperion's backend so it can be verified with the Google Play Developer API. Hyperion stores the purchase token and a SHA-256 token hash with product, subscription status, expiry, and account-link records. For new purchases made while signed in, the app supplies a privacy-preserving identifier derived from your Hyperion account ID to help prevent the purchase from being linked to a different Hyperion account. Older purchases may not contain that identifier. Google Play continues to control billing credentials and its own purchase records.</p>
        <p style={paragraphStyle}><strong>Device-bound activation and promo-code checks.</strong> Some offline activation or licensing features use a terminal code derived from Android's secure device identifier. That code is used for local device binding and may be shared with Hyperion support when you choose to provide it. When a promotional activation is successfully recorded, the app can send the terminal code, promo-code value, activation timestamp, device model, Android version, and app package identifier to Google Cloud Firestore for license administration. Firebase Remote Config is used by certain promo-code and activation-status checks and may contact Google to retrieve configuration values.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}><strong>Permissions and sensors.</strong> The current Android manifest requests Internet and network-state access. It removes the Google advertising ID permission and does not request contacts, photos, camera, microphone, or location permissions. If you voluntarily send us a screenshot, device code, or other support information, we process what you choose to share.</p>

        <h3 style={subheadingStyle}>2.2 Website and PWA</h3>
        <ul style={listStyle}>
          <li><strong>Account and authentication:</strong> email address, Google/provider user identifier, display name and other profile information made available by Google, account metadata, and authentication/session data. Google authenticates you through Supabase; Hyperion does not receive your Google password.</li>
          <li><strong>Profile details:</strong> the name you save to your account and optional company or school details. These may be used to identify and administer your account and website orders.</li>
          <li><strong>Orders and website licenses:</strong> user/account ID, selected track, week/month/year term, amount and currency, order and checkout references, payment method, provider identifiers, payment/reference status, timestamps, entitlement state, and expiry information.</li>
          <li><strong>PayMongo checkout:</strong> PayMongo and the selected payment method provider process the information required to complete and protect a payment. Depending on the chosen method, that can include payer name and email, payment credentials or account details, transaction amount, device/network information, and fraud or security signals. Hyperion's website checkout does not ask you to enter a full card number or card security code directly into a Hyperion form. Hyperion receives order, payment-reference, payment-method, amount, status, and related checkout information needed to administer the purchase.</li>
          <li><strong>Manual QR-payment submissions:</strong> your account, name, selected product and term, amount, transaction/reference number, optional company/school and notes, proof image if submitted, submission status, and administrative review records. A manual submission does not activate a license until it has been verified and approved. If you send a payment screenshot through Facebook/Messenger or email, the relevant provider also processes that image. Avoid including unrelated personal or financial details in a screenshot.</li>
          <li><strong>Account-linked learning progress:</strong> Android currently synchronizes bookmarks, mistakes/review records, completed session history and metadata, and study-time entries after optional sign-in when online. Website/PWA learning progress also includes its supported saved/resumable sessions, answers and progress state, mock-exam progress, and daily check-in/streak information. The learning-progress service validates access to saved question content before it stores or returns a snapshot.</li>
          <li><strong>Browser and offline storage:</strong> localStorage, IndexedDB, service-worker caches, and similar browser storage may hold sign-in state, settings, local progress, and offline application/content data. Clearing browser storage can remove local-only data or require you to sign in again.</li>
          <li><strong>Account activity timestamps:</strong> the website records recent authenticated activity and the signed-in Android app reports account activity when a saved Hyperion session is restored or synchronized. The signed-in Android app reports account activity when you sign in, restore a saved session, or synchronize/refresh your account session. The backend limits activity timestamp updates to at most once every 15 minutes per account. These timestamps support account security, the administrator's last-activity view, and the disclosed inactivity-retention process; they are not precise location tracking.</li>
          <li><strong>Technical and security information:</strong> hosting, authentication, database, payment, and security providers may process IP address, browser/device type, request time, app or browser version, error/request metadata, and related network information to deliver, troubleshoot, and protect the services.</li>
        </ul>

        <h3 style={subheadingStyle}>2.3 Support Communications</h3>
        <p style={paragraphStyle}>If you contact us by email, Facebook Page/Messenger, or another support channel, we process the contact details, account/order reference, message, screenshots, device details, and troubleshooting information you choose to send so we can respond, investigate the issue, and keep reasonable support records.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>3. How and Why We Use Information</h2>
        <p style={paragraphStyle}>We use information to create and secure accounts; authenticate users; provide question banks, reviewer tools, and learning features; save and restore supported website progress; verify purchases; link and enforce entitlements; process orders and payments; prevent fraud, duplicate claims, and unauthorized access; reconcile provider notifications; administer account activity and retention; provide customer support; maintain service reliability; and comply with applicable legal obligations or protect legal rights.</p>
        <p style={paragraphStyle}>We process only the information reasonably needed for these purposes. We do not use your study answers or website order information to create advertising profiles. Manual payment submissions may be reviewed by a person. Automated checks may verify purchase status, account ownership, entitlement expiry, or access eligibility.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>4. Legal Bases and Privacy Principles</h2>
        <p style={paragraphStyle}>Under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and Regulations, personal information is handled according to the principles of transparency, legitimate purpose, and proportionality. Depending on the processing activity, we rely on a lawful basis such as taking steps at your request or performing a contract, consent where it is specifically requested, legitimate interests in operating and securing the service, or compliance with a legal obligation. Where another privacy law applies, additional rights or requirements may also apply.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>5. Service Providers and Sharing</h2>
        <ul style={listStyle}>
          <li><strong>Supabase</strong> — Google-based authentication, account sessions, database, account-linked progress, entitlement records, and backend functions: <a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">Supabase Privacy Policy</a>.</li>
          <li><strong>Google and Google Play</strong> — Google sign-in, Play Billing, purchase verification through the Google Play Developer API, Firebase Remote Config, and Google Cloud Firestore activation records: <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a> and <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noreferrer">Firebase privacy information</a>.</li>
          <li><strong>PayMongo</strong> — hosted website checkout, payment processing, and payment status/reference information: <a href="https://www.paymongo.com/privacy" target="_blank" rel="noreferrer">PayMongo Privacy Policy</a>.</li>
          <li><strong>Cloudflare</strong> — website/PWA hosting, content delivery, and security: <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare Privacy Policy</a>.</li>
          <li><strong>Meta</strong> — Facebook Page/Messenger support when you choose to contact us or send a screenshot through those channels: <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noreferrer">Meta Privacy Policy</a>.</li>
          <li><strong>Email providers</strong> — delivery and storage of messages you send to or receive from our support email address, under the provider's own terms and privacy practices.</li>
        </ul>
        <p style={paragraphStyle}>We share information with these providers only as reasonably needed for them to perform the described services. We may also disclose information when required by law or valid legal process, to investigate fraud or protect users and systems, or as part of a business transfer where permitted by law. Providers may process information in accordance with their own policies and may retain independent payment, security, or support records.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>6. Advertising, Analytics, and Tracking</h2>
        <p style={paragraphStyle}>Hyperion does not display third-party advertisements. We do not sell personal information for advertising. The Android app removes the Google advertising ID permission. The current Android source includes Firebase Remote Config for promo-code and activation-status checks and uses Google Firestore for certain activation records. The Android build has no Firebase Analytics SDK dependency after October 31, 2026, and no Hyperion analytics event collection is intended by the current app code. Website browser storage and service-worker caches are used for authentication, settings, progress, offline support, and security; hosting and security providers may process technical request logs.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>7. Data Retention</h2>
        <ul style={listStyle}>
          <li><strong>Android study data:</strong> remains in the app's private storage until you clear app storage or uninstall the app. When you are signed in, supported bookmarks, mistakes/review records, study-time segments, and completed session history are also stored in your private account-linked learning-progress snapshot. Records that have not synchronized remain only on the device. Account deletion removes the linked cloud copy but does not erase local Android study records.</li>
          <li><strong>Android sign-in session and cached entitlements:</strong> remain in encrypted app storage while needed for account sign-in and license recognition. Signing out clears the Hyperion account entitlement cache. Google Play's own purchase records are retained separately by Google.</li>
          <li><strong>Website account and learning progress:</strong> are retained while the account and service are active, until you delete the account, or until the automated inactivity-retention process completes, subject to necessary security, audit, backup, payment, or legal exceptions.</li>
          <li><strong>Automated account retention:</strong> for an account with no active website or linked Google Play entitlement, 30 consecutive days without a recorded authenticated account-activity timestamp marks it inactive, followed by a separate 30-day grace period. A valid active website or linked Google Play entitlement defers inactivity-based deletion. After a license expires, a renewal grace period of at least 30 days applies; automated deletion is considered only after both the expiry-based grace period and the inactivity-plus-grace deadline have passed, using the later deadline. Pending or unresolved website payments, administrator status, or a need to preserve administrative audit records can defer or exclude automated deletion.</li>
          <li><strong>Website payment and license records:</strong> are used to grant access, verify payments, manage expiry, resolve payment questions, prevent duplicate transactions, and meet legal or accounting obligations. The account-deletion flow removes account-linked website orders and entitlements when it completes, but some provider records, backups, security logs, or records required or permitted by law may remain.</li>
          <li><strong>Support messages and device activation records:</strong> may be retained for a reasonable period needed to resolve the request, administer a license, maintain security, or establish or defend legal claims.</li>
          <li><strong>Third-party records:</strong> Google Play, PayMongo, Google Cloud, Meta, and other providers may retain their own billing, payment, technical, or support records under their separate policies and legal requirements. Hyperion cannot delete records held independently by those providers through your Hyperion account.</li>
        </ul>
        <p style={paragraphStyle}>Retention periods depend on the type of information, its purpose, legal requirements, payment/security needs, and provider rules. Backups and technical logs may take additional time to expire or be overwritten.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>8. Account Deletion and Your Choices</h2>
        <h3 style={subheadingStyle}>8.1 Delete your Hyperion account</h3>
        <p style={paragraphStyle}>After signing in, you can start permanent account deletion on the website through <a href="/account?tab=delete">Account → Delete account</a>, or in the Android app through the app drawer → My Hyperion Account → Delete Account. The app and website use the same authenticated account-deletion service. You can also email <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a> from the email address associated with your account and ask for help. We may need to verify that you control the account.</p>
        <p style={paragraphStyle}>Deletion is permanent, not temporary deactivation. When the server confirms deletion, it deletes the Hyperion sign-in account and associated account-linked records, including website and linked Google Play entitlement records, website orders/payment submissions, and account-linked website learning progress. The deletion process may refuse to continue while a website payment submission or checkout is pending, while an unresolved PayMongo checkout requires reconciliation, or where an administrative audit trail must be preserved. Resolve the payment issue or contact support before retrying.</p>
        <p style={paragraphStyle}><strong>Active-license warning:</strong> deleting an account removes website/PWA licenses linked to that account and removes the server-side link for Google Play entitlements associated with it. Any access that depends on the deleted Hyperion account will stop. Read the in-app or website warning carefully before confirming.</p>
        <p style={paragraphStyle}><strong>Google Play is separate:</strong> deleting your Hyperion account does not cancel a Google Play subscription, stop future Play renewals, or issue a refund. Google may continue billing the Google Play account that made the purchase until the subscription is cancelled through <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noreferrer">Google Play subscriptions</a>. An active Play purchase may remain recognized locally by the Android app while Google Play reports it as active, but deleting the Hyperion account removes its server-side account link. Newer purchases bound to a specific Hyperion account may not be linkable to a different Hyperion account afterward.</p>
        <p style={paragraphStyle}>Account deletion does not erase study data stored locally inside the Android app or clear browser-only data on your devices. Clear app storage/uninstall the Android app or clear browser storage separately if you also want to remove those local copies. Data already held by Google, Google Play, PayMongo, Meta, or another provider is subject to that provider's own deletion and retention rules. No account-deletion process can promise to remove independent provider records.</p>

        <h3 style={subheadingStyle}>8.2 Device and browser choices</h3>
        <p style={paragraphStyle}>You can sign out of your Hyperion account in the Android account dialog or website account area. Signing out clears the app's Hyperion account session and linked entitlement cache, but does not cancel a Google Play subscription or remove the Play purchase from the device. Clearing Android app storage or uninstalling the app removes local study data and locally stored app information. Clearing browser storage may remove local PWA data, cached assets, and sign-in state.</p>

        <h3 style={subheadingStyle}>8.3 Privacy rights</h3>
        <p style={paragraphStyle}>Subject to applicable law and any lawful exceptions, you may have the right to be informed, access and correct personal information, object to or restrict certain processing, request erasure or blocking, request data portability, withdraw consent where processing relies on consent, seek damages, and file a complaint with the relevant privacy authority. We may need to verify your identity before responding.</p>
        <p style={paragraphStyle}>To exercise a right, contact <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a>. Do not send passwords, one-time authentication codes, or full payment-card details.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>You may also contact the <a href="https://privacy.gov.ph" target="_blank" rel="noreferrer">National Privacy Commission of the Philippines</a> if you are not satisfied with our response or wish to make a complaint.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>9. Data Security</h2>
        <p style={paragraphStyle}>We use reasonable technical and organizational safeguards, including HTTPS/TLS, authenticated backend requests, restricted server-side access, database access controls, purchase verification, Android's application sandbox, and encrypted Android storage for account sessions and entitlement caches. No electronic system is completely secure. If a personal data breach requires notification under applicable law, we will provide the notices required by law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>10. International Processing</h2>
        <p style={paragraphStyle}>Our service providers may process information in countries other than the Philippines, including countries where Google, Supabase, PayMongo, Cloudflare, Meta, or their subprocessors operate. Cross-border processing is subject to the safeguards and legal requirements applicable to the relevant provider and processing activity.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>11. Children's Privacy</h2>
        <p style={paragraphStyle}>Hyperion is designed for adult maritime candidates and is not directed to children under 18. We do not knowingly collect personal information from children under 18. If you believe a child has provided personal information to Hyperion, contact <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a> so we can review the request.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>12. Platform Billing and License Information</h2>
        <h3 style={subheadingStyle}>12.1 Google Play subscriptions</h3>
        <p style={paragraphStyle}>Google Play handles Android subscription billing, renewals, cancellation, and billing records. Manage or cancel a Play subscription through <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noreferrer">Google Play subscriptions</a> using the Google account that made the purchase. Uninstalling the app, signing out of Hyperion, or deleting a Hyperion account does not cancel Play billing. Google Play controls the applicable cancellation, access, and refund rules.</p>
        <h3 style={subheadingStyle}>12.2 Website/PWA licenses</h3>
        <p style={paragraphStyle}>Website licenses are linked to the signed-in Hyperion account and are offered for the track and fixed duration displayed at checkout. Website plans do not automatically renew unless a particular offer expressly says otherwise. PayMongo checkout is verified against the website order; manual QR transfers require review and activate only after approval. A website payment or refund question should be sent to <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a> with the website order reference.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Google Play and website purchases are billed through different systems. When you sign in with the same Hyperion account and complete synchronization, eligible entitlements from either source may be recognized by the other platform. This does not change which provider bills the purchase or who controls cancellation and refunds.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>13. Changes to This Policy</h2>
        <p style={paragraphStyle}>We may update this policy when our services, providers, or legal obligations change. The revised policy will be posted here with an updated date. Where required by law, we will provide additional notice or obtain consent before a material change takes effect.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>14. Contact</h2>
        <p style={paragraphStyle}><strong>Service / Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Privacy Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">https://hyperionmaritime.org</a></p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}><strong>Android Application ID:</strong> com.nhyle.hyperionmaritime</p>
      </section>
    </div>
  )
}
