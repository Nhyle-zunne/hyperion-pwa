import { useNavigate } from 'react-router-dom'

const sectionStyle = { marginBottom: '1.25rem' } as const
const headingStyle = { color: 'var(--text)', fontSize: '1.05rem', fontWeight: 800, marginBottom: '0.55rem' } as const
const paragraphStyle = { margin: '0 0 0.65rem', lineHeight: 1.7 } as const

export default function TermsScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back</button>
      <h1 className="page-title">Terms of Use</h1>
      <p className="subtitle">Hyperion Maritime Reviewer</p>

      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.6 }}>
        <p style={paragraphStyle}><strong>Effective Date:</strong> October 29, 2026 · <strong>Last Updated:</strong> October 29, 2026</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}>These Terms of Use ("Terms") apply to Hyperion Maritime Reviewer, including our Android application, website, and Progressive Web Application ("Hyperion," "we," "our," or "us"). By accessing or using Hyperion, you agree to these Terms. If you do not agree, do not use the service.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}><strong>Important before you buy:</strong> Google Play subscriptions for the Android app and licenses purchased on hyperionmaritime.org are separate products with separate billing, access records, cancellation/refund processes, and platform-specific conditions. They are not automatically transferable or interchangeable, even if the same email address is used.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Our <a href="/privacy-policy">Privacy Policy</a> explains how personal information is handled and forms part of the information you should review before using the website or app.</p>
      </div>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>1. Educational Purpose; No Guarantee of Results</h2>
        <p style={paragraphStyle}>Hyperion provides study materials, question banks, practice sessions, drills, mock examinations, and related learning tools to support maritime licensing examination preparation. Hyperion is an independent study aid and is not an official MARINA, government, licensing authority, or examination-provider service unless expressly stated otherwise.</p>
        <p style={paragraphStyle}>We do not guarantee that any question will appear on an actual examination, that all material is complete or error-free, or that using Hyperion will result in passing an examination, obtaining a license, or securing employment. Your result depends on many factors beyond our control. Always verify important information against current official rules, publications, and instructions.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>2. Eligibility and Accounts</h2>
        <p style={paragraphStyle}>You must provide accurate information when creating or using a website account and keep your sign-in methods secure. Website sign-in is provided through Google. You are responsible for activity performed through your account and must notify us if you believe your account has been accessed without authorization.</p>
        <p style={paragraphStyle}>Do not impersonate another person, create accounts for deceptive purposes, or attempt to access another user's account or data. Account access is personal and may not be sold, transferred, or shared except where we expressly authorize it in writing.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>3. Free Access, Licenses, and Platform-Specific Purchases</h2>
        <p style={paragraphStyle}>Some features or question sets may be available without payment; other tracks, features, or content may require a license, subscription, or other authorization. Always read the exact product, platform, price, access duration, renewal terms, and conditions displayed before confirming a purchase. Offers, features, availability, and prices may differ between Google Play and hyperionmaritime.org.</p>

        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>3.1 Google Play subscriptions (Android app)</h3>
        <p style={paragraphStyle}>A subscription purchased inside the Android app through Google Play is billed and managed by Google Play and is associated with the Google Play account and purchase entitlement recognized by the app. It is an auto-renewing subscription unless the applicable offer states otherwise. Google Play may charge for each renewal unless you cancel in accordance with its current instructions and deadline. Uninstalling the Android app does not cancel the subscription. Cancellation generally stops future renewals; access for the already-paid period is determined by the subscription's status and Google Play's rules.</p>
        <p style={paragraphStyle}>Manage or cancel an Android subscription in <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">Google Play subscriptions</a>, using the Google account that made the purchase. For Play billing and refund requests, use Google Play's current help and refund process. A website account deletion, website purchase, or support request to Hyperion does not cancel a Google Play subscription.</p>

        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>3.2 Website/PWA licenses (hyperionmaritime.org)</h3>
        <p style={paragraphStyle}>A license purchased through the Bond Store or Checkout on hyperionmaritime.org is linked to the Hyperion website account signed in at the time of purchase. Website checkout is processed through PayMongo and may offer payment methods such as GCash, Maya, QR Ph, or card, subject to current availability. A manual QR payment is a payment submission for review; the website license is not activated until Hyperion verifies the payment and grants the entitlement. A submitted transaction reference or screenshot is not, by itself, proof of approval.</p>
        <p style={paragraphStyle}>Website access is purchased for the fixed duration shown for the selected track (for example, one week, one month, or one year) and is governed by the expiry shown in your account. Website/PWA plans do not automatically renew unless the specific checkout offer expressly states otherwise. When the fixed term expires, access to that paid track may end until you make a new purchase or are granted another valid license. For a website payment problem or refund request, email hyperionmaritimex@gmail.com with your website order reference. Requests are reviewed under applicable law and the conditions shown at purchase; submitting a request or deleting your website account does not automatically approve a refund. Website payment verification and any refund inquiry must be handled through Hyperion's website/support process, not through Google Play.</p>

        <h3 style={{ ...headingStyle, fontSize: '0.95rem' }}>3.3 These licenses are separate and cannot be transferred</h3>
        <p style={paragraphStyle}>A Google Play subscription does not automatically unlock a website/PWA license. A license purchased on hyperionmaritime.org does not activate a Google Play subscription or grant the Android app's subscription entitlement. Android device-bound offline activation passes, where offered, are also separate and remain subject to their own in-app terms. Using the same Google email on both platforms does not merge the purchases, move their expiry dates, or transfer the benefits. Website and Google Play purchases cannot be automatically combined, exchanged, or credited against each other.</p>
        <p style={paragraphStyle}>Before paying, confirm that the product is offered for the platform where you intend to use it. If you believe you purchased on the wrong platform, contact <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a> with the relevant receipt or website order reference before making another purchase. We cannot promise that a purchase, refund, or entitlement can be moved between platforms.</p>
        <p style={{ ...paragraphStyle, marginBottom: 0 }}>Do not share, resell, duplicate, manipulate, or attempt to bypass a license, activation code, subscription check, or other access control. We may investigate suspected misuse and, where reasonably necessary and permitted by law, restrict or suspend access to protect the service, users, and content.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>4. Acceptable Use</h2>
        <p style={paragraphStyle}>You may use Hyperion for personal, lawful study and examination preparation. You must not:</p>
        <ul>
          <li>copy, scrape, redistribute, publish, sell, or commercially exploit questions, explanations, software, or other content without permission;</li>
          <li>reverse engineer, decompile, interfere with, or attempt to compromise the service, except where applicable law expressly permits it;</li>
          <li>bypass authentication, licensing, rate limits, or other technical protections;</li>
          <li>upload malicious code, disrupt service operation, or access systems or data without authorization; or</li>
          <li>use Hyperion in a way that violates law, another person's rights, or the integrity of an examination.</li>
        </ul>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>5. Intellectual Property and Study Content</h2>
        <p style={paragraphStyle}>The Hyperion name, branding, application software, interface, original explanations, and other materials owned by Hyperion are protected by applicable intellectual-property laws. These Terms grant you a limited, revocable, non-exclusive, non-transferable right to use the service for personal study, subject to these Terms and any applicable license.</p>
        <p style={paragraphStyle}>Some subject matter may be based on public regulations, reference materials, or third-party content. Rights in those materials remain with their respective owners. If you believe content hosted by Hyperion infringes your rights or is materially inaccurate, contact us with enough detail for us to review it.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>6. Study Data and Device Storage</h2>
        <p style={paragraphStyle}>The Android application stores study progress and preferences locally on your device as described in the Privacy Policy. Uninstalling the app or clearing its data may permanently remove local progress. The website/PWA also uses browser storage for offline operation and local state; when you are signed in and connectivity is available, supported study data is synchronized to your website account. Not every device-local item or cached asset is necessarily synchronized or recoverable. Clearing browser/app storage may remove local-only data.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>7. Privacy</h2>
        <p style={paragraphStyle}>Our collection and use of personal information are described in the <a href="/privacy-policy">Privacy Policy</a>. By using account-based website features, you acknowledge that you have had an opportunity to read that policy. Please do not send passwords, authentication codes, or payment card details through support channels.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>8. Availability and Changes</h2>
        <p style={paragraphStyle}>We may update, improve, suspend, or discontinue all or part of Hyperion, including content, question banks, features, and supported devices. We aim to keep the service useful and available but do not guarantee uninterrupted access, compatibility with every device or browser, or permanent availability of any particular feature. We may perform maintenance, security updates, or content corrections without advance notice where reasonably necessary.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>9. Suspension and Termination</h2>
        <p style={paragraphStyle}>You may stop using Hyperion at any time. You may request deletion of your website account through Account → Delete account (or by contacting support as described in the Privacy Policy). Website account deletion is permanent and removes website account-linked access and data when the deletion process completes; it is not a way to cancel or refund a Google Play subscription. A deletion request may be blocked until pending website payment submissions or unresolved PayMongo sessions have been safely cancelled or reconciled, or where support must preserve an administrative audit trail.</p>
        <p style={paragraphStyle}><strong>Website account inactivity and automatic deletion.</strong> If a website account has no active website license, 30 consecutive days without authenticated website activity marks the account as inactive. A separate 30-day grace period then applies before the account becomes eligible for automated deletion, so the normal inactivity-based threshold is about 60 days from the last recorded access. An account with an active website license is protected from inactivity-based deletion while that license remains active. When a website license expires, at least a 30-day renewal grace period applies; the account-retention deadline is the later of that renewal-grace deadline and the inactivity-plus-grace deadline. If no new valid website license is granted and the applicable deadline has passed, the website account and its account-linked website access and learning progress may be permanently deleted. Merely starting checkout or submitting a manual payment does not activate a license; pending website payment checks are held for resolution before automated deletion, but do not extend licensed access unless the payment is approved and an entitlement is granted. Administrator accounts and accounts needed to preserve administrative audit records are excluded from automated deletion. This policy is about website/PWA accounts and does not cancel Google Play subscriptions or delete locally stored Android-app study data.</p>
        <p style={paragraphStyle}>You must cancel any Google Play subscription separately through <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">Google Play subscriptions</a>. Deleting a website account does not cancel or refund Play billing, delete Google Play's transaction record, or clear study data stored locally inside the Android app. Uninstalling the Android app also does not cancel a Google Play subscription.</p>
        <p style={paragraphStyle}>We may suspend or terminate access where we reasonably believe you have violated these Terms, attempted fraud or unauthorized access, created a security risk, or where necessary to comply with law or protect the service and its users. Where appropriate and legally permitted, we will take reasonable steps to explain the reason for a restriction.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>10. Disclaimers and Limitation of Liability</h2>
        <p style={paragraphStyle}>To the extent permitted by applicable law, Hyperion is provided on an "as is" and "as available" basis. We make no warranties that the service or its content will be uninterrupted, fully accurate, complete, current, or suitable for every user's needs.</p>
        <p style={paragraphStyle}>To the extent permitted by law, Hyperion is not liable for indirect, incidental, special, consequential, or punitive losses, loss of data, lost opportunities, or examination outcomes arising from use of or inability to use the service. Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, including any mandatory consumer rights or remedies.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>11. Third-Party Services</h2>
        <p style={paragraphStyle}>Hyperion may rely on third-party services, including Google and Google Play (sign-in and Android billing), Firebase (Android app configuration/analytics components), Supabase (website authentication and backend), PayMongo (website hosted checkout and payment processing), Meta/Facebook (support messages you choose to send), and Cloudflare (website hosting, delivery, and security). Their services are governed by their own terms and privacy policies. We do not control their independent systems or retention rules, except that our own use of their services remains subject to applicable law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>12. Changes to These Terms</h2>
        <p style={paragraphStyle}>We may revise these Terms to reflect changes in Hyperion, our practices, or applicable law. We will post the revised text on this page and update the "Last Updated" date. Where required by law, we will provide additional notice or seek consent. Continued use after revised Terms take effect means you accept the updated Terms to the extent permitted by law.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>13. Governing Law and Contact</h2>
        <p style={paragraphStyle}>These Terms are intended to be interpreted consistently with applicable laws of the Philippines, without removing any mandatory rights that may apply to you under the laws of your place of residence. Any dispute will be handled by a competent forum under applicable law.</p>
        <p style={paragraphStyle}><strong>Service:</strong> Hyperion Maritime Reviewer</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Email:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">https://hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Android Application ID:</strong> com.nhyle.hyperionmaritime</p>
      </section>
    </div>
  )
}
