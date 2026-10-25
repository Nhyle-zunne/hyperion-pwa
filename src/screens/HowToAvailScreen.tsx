import { useNavigate } from 'react-router-dom'

export default function HowToAvailScreen() {
  const navigate = useNavigate()
  return <div className="screen">
    <button onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '.9rem' }}>← Back</button>
    <h1 className="page-title">How to Subscribe</h1>
    <p className="subtitle">Purchase reviewer access through your Hyperion account.</p>
    <div className="card"><ol style={{ paddingLeft: '1.2rem', lineHeight: 1.7 }}>
      <li>Create a Hyperion account or sign in.</li>
      <li>Open Account and choose Payments & profile.</li>
      <li>Select the exam track and follow the listed annual price.</li>
      <li>Send payment using the displayed QR code, then provide your transaction/reference number and proof as instructed.</li>
      <li>Press Submit for Review. Access becomes available after payment is manually approved.</li>
    </ol><button className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/account')}>Open Account</button></div>
  </div>
}
