import { useEffect, useRef, useState } from 'react'
import AdminNavigation from '../components/AdminNavigation'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import { useOfflineAdminAccess, useOnlineStatus } from '../hooks/useOfflineAdminAccess'
import { decodeQrPixels, renderQrPng } from '../lib/qrImageEditor.mjs'
import { parseQrPhPayload, replaceQrPhRecipientName } from '../lib/qrPhNameEditor.mjs'
import { supabase } from '../lib/supabase'
import './AdminPosterGeneratorScreen.css'
import './AdminQrEditorScreen.css'

export default function AdminQrEditorScreen() {
  const [userId, setUserId] = useState<string | undefined>()
  const [authReady, setAuthReady] = useState(false)
  const online = useOnlineStatus()
  const onlineAccess = useAdminCheckoutAccess(online ? userId : undefined)
  const offlineAccess = useOfflineAdminAccess(true, userId)
  const access = online ? onlineAccess : offlineAccess

  useEffect(() => {
    if (!supabase || !online) { setAuthReady(!supabase); return }
    setAuthReady(false)
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setUserId(session?.user.id); setAuthReady(true) }
    })
    void supabase.auth.getUser()
      .then(({ data }) => { if (active) setUserId(data.user?.id) })
      .catch(() => { if (active) setUserId(undefined) })
      .finally(() => { if (active) setAuthReady(true) })
    return () => { active = false; subscription.unsubscribe() }
  }, [online])

  if ((online && !authReady) || !access.checked) return <section className="screen admin-poster"><p role="status">Checking administrator access...</p></section>
  if (!access.allowed) return <section className="screen admin-poster"><AdminNavigation /><h1>QR Code Editor</h1><p role="alert">{online ? 'Administrator access is required to use this tool.' : 'Reconnect to verify admin access for this device.'}</p></section>
  return <QrEditorWorkspace key={userId} />
}

function QrEditorWorkspace() {
  const [payload, setPayload] = useState('')
  const [originalName, setOriginalName] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [preview, setPreview] = useState<{ payload: string; url: string } | null>(null)
  const [uploadStatus, setUploadStatus] = useState('Upload your QR Ph person-to-person payment QR screenshot to begin.')
  const [busy, setBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const uploadRequest = useRef(0)

  useEffect(() => () => { uploadRequest.current++ }, [])

  let editedPayload = ''
  let nameError = ''
  if (payload) {
    try { editedPayload = replaceQrPhRecipientName(payload, recipientName) }
    catch (error) { nameError = error instanceof Error ? error.message : 'Invalid recipient name.' }
  }
  const previewUrl = preview?.payload === editedPayload ? preview.url : ''

  useEffect(() => {
    let active = true
    setPreview(null)
    setPreviewError('')
    if (editedPayload) {
      void renderQrPng(editedPayload)
        .then(url => { if (active) setPreview({ payload: editedPayload, url }) })
        .catch(() => { if (active) setPreviewError('Could not generate the QR image. Try a shorter name.') })
    }
    return () => { active = false }
  }, [editedPayload])

  async function handleUpload(file: File) {
    const request = ++uploadRequest.current
    setPayload('')
    setOriginalName('')
    setRecipientName('')
    setPreview(null)
    setBusy(true)
    setUploadStatus('Reading your QR code on this device...')
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
        throw new Error('Use a PNG, JPG or WebP image smaller than 10 MB.')
      }
      const bitmap = await createImageBitmap(file)
      try {
        const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('This browser could not read the QR image.')
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const decoded = decodeQrPixels(context.getImageData(0, 0, canvas.width, canvas.height))
        const details = parseQrPhPayload(decoded)
        if (request !== uploadRequest.current) return
        setPayload(decoded)
        setOriginalName(details.recipientName)
        setRecipientName(details.recipientName)
        setUploadStatus('QR Ph payment code loaded. The receiving-account data will remain unchanged.')
      } finally { bitmap.close() }
    } catch (error) {
      if (request === uploadRequest.current) {
        setUploadStatus(error instanceof Error ? error.message : 'Could not read this QR code.')
      }
    } finally {
      if (request === uploadRequest.current) setBusy(false)
    }
  }

  return <section className="screen admin-poster admin-qr">
    <AdminNavigation />
    <header className="admin-poster__heading">
      <h1>QR CODE EDITOR</h1>
      <p>Upload a QR Ph person-to-person payment code, change its embedded recipient name, and download a new scannable QR. Images and payment details stay on this device.</p>
    </header>

    <div className="admin-poster__grid">
      <div className="admin-poster__fields">
        <h2>1. UPLOAD PAYMENT QR</h2>
        <label htmlFor="qr-editor-file">QR code image</label>
        <input id="qr-editor-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void handleUpload(file) }} />
        <p role="status" aria-live="polite" className="admin-poster__hint">{uploadStatus}</p>

        <h2>2. EDIT RECIPIENT NAME</h2>
        {payload ? <>
          <div className="admin-qr__original"><span>Original QR name</span><strong>{originalName}</strong></div>
          <label htmlFor="qr-editor-name">New QR recipient name</label>
          <input id="qr-editor-name" value={recipientName} maxLength={25} autoComplete="off"
            aria-invalid={Boolean(nameError)} aria-describedby="qr-editor-name-hint"
            onChange={event => setRecipientName(event.target.value)} />
          <p id="qr-editor-name-hint" className="admin-poster__hint">Maximum 25 standard English characters. Preview updates automatically.</p>
          {nameError && <p className="admin-poster__error" role="alert">{nameError}</p>}
        </> : <p className="admin-poster__hint">Your QR's original name will appear here after upload.</p>}

        <div className="admin-qr__notice" role="note">
          <strong>Before using it for payments</strong>
          <p>Editing the QR name does not rename the bank account. A payment app may still show the bank-registered name or reject a changed QR. Test a scan and verify the recipient account before sharing it.</p>
        </div>
      </div>

      <aside className="admin-poster__preview">
        <div className="admin-poster__preview-heading"><h2>QR PREVIEW</h2><span>1024 × 1024 PNG</span></div>
        <div className="admin-qr__image">
          {previewUrl ? <img src={previewUrl} alt={`Edited payment QR for ${recipientName}`} />
            : <p role="status">{busy ? 'Scanning image…' : payload && !nameError ? 'Generating QR preview…' : 'Your edited QR will appear here.'}</p>}
        </div>
        {previewError && <p role="alert" className="admin-poster__error">{previewError}</p>}
        {previewUrl && <a className="btn btn-primary admin-poster__download" href={previewUrl} download="hyperion-edited-qr-ph.png">DOWNLOAD QR PNG</a>}
        {previewUrl && <p className="admin-qr__caption">Encoded name: <strong>{recipientName.trim()}</strong></p>}
        <p className="admin-poster__hint">The downloaded image is a new QR code, not a bank-issued payment confirmation.</p>
      </aside>
    </div>
  </section>
}
