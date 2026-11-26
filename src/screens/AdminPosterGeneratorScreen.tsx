import { useEffect, useRef, useState } from 'react'
import AdminNavigation from '../components/AdminNavigation'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import { supabase } from '../lib/supabase'
import { POSTER_DEGREES, POSTER_TRACKS, formatPosterDate, fullPosterName } from '../lib/posterTracks.mjs'
import { removePortraitBackground } from '../lib/posterPortrait'
import { downloadPoster, loadPosterArtwork, renderPoster } from '../lib/renderPoster'
import './AdminPosterGeneratorScreen.css'

function localDate() {
  const date = new Date()
  const number = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${number(date.getMonth() + 1)}-${number(date.getDate())}`
}

export default function AdminPosterGeneratorScreen() {
  const [userId, setUserId] = useState<string | undefined>()
  const [authReady, setAuthReady] = useState(false)
  const access = useAdminCheckoutAccess(userId)

  const [trackId, setTrackId] = useState(POSTER_TRACKS[0].id)
  const track = POSTER_TRACKS.find(option => option.id === trackId) || POSTER_TRACKS[0]
  const [name, setName] = useState('')
  const [date, setDate] = useState(localDate)
  const [school, setSchool] = useState('')
  const [company, setCompany] = useState('')
  const [artwork, setArtwork] = useState<HTMLImageElement | null>(null)
  const [originalPhoto, setOriginalPhoto] = useState<HTMLImageElement | null>(null)
  const [cutoutPhoto, setCutoutPhoto] = useState<HTMLImageElement | null>(null)
  const [useOriginal, setUseOriginal] = useState(false)
  const [photoStatus, setPhotoStatus] = useState('Upload a candidate portrait to remove its background automatically.')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [renderError, setRenderError] = useState('')
  const [scalePercent, setScalePercent] = useState(100)
  const [xOffsetPercent, setXOffsetPercent] = useState(0)
  const [yOffsetPercent, setYOffsetPercent] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const photoRequestRef = useRef(0)
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) { setUserId(session?.user.id); setAuthReady(true) }
    })
    void supabase.auth.getUser()
      .then(({ data }) => { if (active) setUserId(data.user?.id) })
      .catch(() => { if (active) setUserId(undefined) })
      .finally(() => { if (active) setAuthReady(true) })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!access.allowed) return
    let active = true
    void loadPosterArtwork()
      .then(image => { if (active) setArtwork(image) })
      .catch(error => { if (active) setRenderError(error instanceof Error ? error.message : 'Artwork unavailable.') })
    return () => { active = false }
  }, [access.allowed])

  useEffect(() => () => {
    photoRequestRef.current++
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
  }, [])

  const portrait = useOriginal ? originalPhoto : cutoutPhoto || originalPhoto
  useEffect(() => {
    if (!artwork || !canvasRef.current || !access.allowed) return
    try {
      renderPoster(canvasRef.current, artwork, { track, name, date, school, company, portrait, scalePercent, xOffsetPercent, yOffsetPercent })
      setRenderError('')
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : 'Could not render the poster.')
    }
  }, [artwork, access.allowed, track, name, date, school, company, portrait, scalePercent, xOffsetPercent, yOffsetPercent])

  async function loadPhoto(blob: Blob) {
    const url = URL.createObjectURL(blob)
    objectUrlsRef.current.push(url)
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('This image could not be opened. Choose another portrait.'))
      image.src = url
    })
  }

  async function handlePhoto(file: File) {
    const request = ++photoRequestRef.current
    setOriginalPhoto(null)
    setCutoutPhoto(null)
    setUseOriginal(false)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
      setPhotoStatus('Use a PNG, JPEG or WebP photo smaller than 20 MB.')
      return
    }
    setPhotoBusy(true)
    setPhotoStatus('Preparing portrait and removing background on this device...')
    try {
      const original = await loadPhoto(file)
      if (request !== photoRequestRef.current) return
      setOriginalPhoto(original)
      // Yield one frame so the processing state can be painted before inference starts.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const blob = await removePortraitBackground(file)
      if (request !== photoRequestRef.current) return
      const cutout = await loadPhoto(blob)
      if (request !== photoRequestRef.current) return
      setCutoutPhoto(cutout)
      setPhotoStatus('Background removed. Check the hair and shoulder edges in the preview.')
    } catch {
      if (request === photoRequestRef.current) setPhotoStatus('Automatic removal was unavailable. The original photo is still available. Check your connection and try another photo.')
    } finally {
      if (request === photoRequestRef.current) setPhotoBusy(false)
    }
  }

  const canDownload = Boolean(access.allowed && artwork && name.trim() && school.trim() && formatPosterDate(date) && portrait && !photoBusy && !renderError)

  if (!authReady || !access.checked) return <section className="screen admin-poster"><p role="status">Checking administrator access...</p></section>
  if (!access.allowed) return <section className="screen admin-poster"><AdminNavigation /><h1>Poster Generator</h1><p role="alert">Administrator access is required to use this tool.</p></section>

  return <section className="screen admin-poster">
    <AdminNavigation />
    <header className="admin-poster__heading">
      <h1>POSTER GENERATOR</h1>
      <p>Create a Hyperion congratulatory poster for any licensure track. Everything stays in this browser until you download.</p>
    </header>

    <div className="admin-poster__grid">
      <div className="admin-poster__fields">
        <h2>CANDIDATE DETAILS</h2>
        <label htmlFor="poster-track">Licensure track</label>
        <select id="poster-track" value={trackId} onChange={event => setTrackId(event.target.value)}>
          {POSTER_TRACKS.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
        </select>

        <label htmlFor="poster-name">Full name</label>
        <input id="poster-name" value={name} maxLength={120} placeholder="e.g. Sheldon R. Abarquez" onChange={event => setName(event.target.value)} />
        <small className="admin-poster__hint">Appears as: {fullPosterName(trackId, name) || `${track.prefix} [FULL NAME]`.trim()}</small>

        <label htmlFor="poster-degree">Degree or qualification</label>
        <input id="poster-degree" readOnly value={POSTER_DEGREES.find(option => option.value === track.defaultDegree)?.label ?? track.defaultDegree} />

        <label htmlFor="poster-date">Examination date</label>
        <input id="poster-date" type="date" value={date} onChange={event => setDate(event.target.value)} />

        <label htmlFor="poster-school">School or university</label>
        <input id="poster-school" value={school} maxLength={120} placeholder="e.g. University of Cebu METC" onChange={event => setSchool(event.target.value)} />

        <label htmlFor="poster-company">Company or sponsor (optional)</label>
        <input id="poster-company" value={company} maxLength={100} placeholder="Leave blank to match the sample" onChange={event => setCompany(event.target.value)} />

        <h2>CANDIDATE PHOTO</h2>
        <label htmlFor="poster-photo">Upload portrait</label>
        <input id="poster-photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void handlePhoto(file) }} />
        <p className="admin-poster__hint" role="status" aria-live="polite">{photoStatus}</p>
        {cutoutPhoto && <label className="admin-poster__checkbox"><input type="checkbox" checked={useOriginal} onChange={event => setUseOriginal(event.target.checked)} />Use original photo without background removal</label>}

        <div className="admin-poster__sliders">
          <label htmlFor="poster-scale">Portrait size <output>{scalePercent}%</output></label>
          <input id="poster-scale" type="range" min="70" max="140" step="5" value={scalePercent} onChange={event => setScalePercent(Number(event.target.value))} />
          <label htmlFor="poster-horizontal">Move horizontally <output>{xOffsetPercent > 0 ? '+' : ''}{xOffsetPercent}%</output></label>
          <input id="poster-horizontal" type="range" min="-16" max="16" step="1" value={xOffsetPercent} onChange={event => setXOffsetPercent(Number(event.target.value))} />
          <label htmlFor="poster-vertical">Move vertically <output>{yOffsetPercent > 0 ? '+' : ''}{yOffsetPercent}%</output></label>
          <input id="poster-vertical" type="range" min="-13" max="13" step="1" value={yOffsetPercent} onChange={event => setYOffsetPercent(Number(event.target.value))} />
          <button type="button" className="btn btn-outline" onClick={() => { setScalePercent(100); setXOffsetPercent(0); setYOffsetPercent(0) }}>RESET PHOTO POSITION</button>
        </div>
      </div>

      <aside className="admin-poster__preview">
        <div className="admin-poster__preview-heading"><h2>LIVE PREVIEW</h2><span>Square 2048 × 2048 PNG</span></div>
        <canvas ref={canvasRef} className="admin-poster__canvas" role="img" aria-label="Hyperion congratulatory poster preview" />
        {renderError && <p role="alert" className="admin-poster__error">{renderError}</p>}
        <button type="button" className="btn btn-primary admin-poster__download" disabled={!canDownload} onClick={() => { if (canvasRef.current) downloadPoster(canvasRef.current, fullPosterName(trackId, name)) }}>
          DOWNLOAD POSTER PNG
        </button>
        <p className="admin-poster__hint">The exam title and rank follow your selected track. The Facebook handle and website are included automatically.</p>
      </aside>
    </div>
  </section>
}
