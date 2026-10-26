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
        <p style={paragraphStyle}><strong>Effective Date:</strong> October 26, 2026 · <strong>Last Updated:</strong> October 26, 2026</p>
        <p style={paragraphStyle}><strong>Developer:</strong> Hyperion Maritime</p>
        <p style={paragraphStyle}><strong>Website:</strong> <a href="https://hyperionmaritime.org">hyperionmaritime.org</a></p>
        <p style={paragraphStyle}><strong>Contact:</strong> <a href="mailto:hyperionmaritimex@gmail.com">hyperionmaritimex@gmail.com</a></p>
        <p style={paragraphStyle}>These Terms of Use ("Terms") apply to Hyperion Maritime Reviewer, including our Android application, website, and Progressive Web Application ("Hyperion," "we," "our," or "us"). By accessing or using Hyperion, you agree to these Terms. If you do not agree, do not use the service.</p>
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
        <h2 style={headingStyle}>3. Free Access, Licenses, and Paid Features</h2>
        <p style={paragraphStyle}>Some features or question sets may be available without payment; other tracks, features, or content may require an eligible license, subscription, or other authorization. The access shown for your account is subject to the applicable offer and license conditions.</p>
        <p style={paragraphStyle}>Do not share, resell, duplicate, manipulate, or attempt to bypass a license, activation code, subscription check, or other access control. We may investigate suspected misuse and, where reasonably necessary and permitted by law, restrict or suspend access to protect the service, users, and content.</p>
        <p style={paragraphStyle}>Purchases made through Google Play are processed under Google Play's applicable terms and billing procedures. Subscription management and cancellation are handled through Google Play. Any price, duration, renewal, eligibility, or refund conditions presented at the point of purchase also apply, subject to applicable law. We do not promise refunds outside the rights and procedures that apply to your purchase.</p>
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
        <p style={paragraphStyle}>The Android application stores study progress and preferences locally on your device as described in the Privacy Policy. Uninstalling the app or clearing its data may permanently remove locally stored progress. Website features may use browser storage or account-linked services for sign-in, settings, or study features. Do not assume that progress is backed up or recoverable unless the relevant feature clearly says it is synchronized.</p>
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
        <p style={paragraphStyle}>You may stop using Hyperion at any time. You may request deletion of your website account using the method described in the Privacy Policy. Account deletion does not automatically cancel a subscription purchased through Google Play; manage that subscription separately through Google Play.</p>
        <p style={paragraphStyle}>We may suspend or terminate access where we reasonably believe you have violated these Terms, attempted fraud or unauthorized access, created a security risk, or where necessary to comply with law or protect the service and its users. Where appropriate and legally permitted, we will take reasonable steps to explain the reason for a restriction.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>10. Disclaimers and Limitation of Liability</h2>
        <p style={paragraphStyle}>To the extent permitted by applicable law, Hyperion is provided on an "as is" and "as available" basis. We make no warranties that the service or its content will be uninterrupted, fully accurate, complete, current, or suitable for every user's needs.</p>
        <p style={paragraphStyle}>To the extent permitted by law, Hyperion is not liable for indirect, incidental, special, consequential, or punitive losses, loss of data, lost opportunities, or examination outcomes arising from use of or inability to use the service. Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited, including any mandatory consumer rights or remedies.</p>
      </section>

      <section style={sectionStyle}>
        <h2 style={headingStyle}>11. Third-Party Services</h2>
        <p style={paragraphStyle}>Hyperion may rely on third-party services such as Google, Supabase, hosting providers, and app stores. Those services are governed by their own terms and privacy policies. We are not responsible for third-party services that we do not control, except where applicable law provides otherwise.</p>
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
