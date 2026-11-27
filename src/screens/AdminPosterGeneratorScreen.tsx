import { useEffect, useRef, useState } from 'react'
import AdminNavigation from '../components/AdminNavigation'
import { useOfflineAdminAccess, useOnlineStatus } from '../hooks/useOfflineAdminAccess'
import { usePosterPortraitGestures } from '../hooks/usePosterPortraitGestures'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import { supabase } from '../lib/supabase'
import { POSTER_TRACKS, formatPosterDate, fullPosterName } from '../lib/posterTracks.mjs'
import { createPosterCaption, POSTER_CAPTION_STYLES } from '../lib/posterCaptions.mjs'
import type { PortraitFrame } from '../lib/posterAlpha.mjs'
import { preparePortraitAssets, removePortraitBackground } from '../lib/posterPortrait'
import { downloadPoster, loadPosterArtwork, renderPoster, type PosterArtwork } from '../lib/renderPoster'
import './AdminPosterGeneratorScreen.css'

const DEFAULT_POSITION = { scalePercent: 100, xOffsetPercent: 0, yOffsetPercent: 0 }

function localDate() {
  const date = new Date()
  const number = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${number(date.getMonth() + 1)}-${number(date.getDate())}`
}

export default function AdminPosterGeneratorScreen() {
  const [userId, setUserId] = useState<string | undefined>()
  const [authReady, setAuthReady] = useState(false)
  const online = useOnlineStatus()
  const onlineAccess = useAdminCheckoutAccess(online ? userId : undefined)
  const offlineAccess = useOfflineAdminAccess(true, userId)
  const access = online ? onlineAccess : offlineAccess
  const [offlineAssetsReady, setOfflineAssetsReady] = useState<boolean | null>(null)

  const [trackId, setTrackId] = useState(POSTER_TRACKS[0].id)
  const track = POSTER_TRACKS.find(option => option.id === trackId) || POSTER_TRACKS[0]
  const [name, setName] = useState('')
  const [date, setDate] = useState(localDate)
  const [school, setSchool] = useState('')
  const [company, setCompany] = useState('')
  const [captionStyle, setCaptionStyle] = useState(0)
  const [captionStatus, setCaptionStatus] = useState<{ caption: string; message: string } | null>(null)
  const caption = createPosterCaption(trackId, captionStyle, { name, date, school, company })
  const captionRef = useRef<HTMLTextAreaElement>(null)
  const [artwork, setArtwork] = useState<PosterArtwork | null>(null)
  const [originalPhoto, setOriginalPhoto] = useState<HTMLImageElement | null>(null)
  const [cutoutPhoto, setCutoutPhoto] = useState<{ image: HTMLImageElement; frame: PortraitFrame } | null>(null)
  const [useOriginal, setUseOriginal] = useState(false)
  const [photoStatus, setPhotoStatus] = useState('Upload a candidate portrait to remove its background automatically.')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [renderError, setRenderError] = useState('')
  const [position, setPosition] = useState(DEFAULT_POSITION)
  const { scalePercent, xOffsetPercent, yOffsetPercent } = position
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const portraitLayerRef = useRef<HTMLCanvasElement | null>(null)
  const photoRequestRef = useRef(0)
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    if (!supabase || !online) {
      setAuthReady(!supabase)
      return
    }
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

  useEffect(() => {
    if (!access.allowed) return
    let active = true
    void loadPosterArtwork()
      .then(image => { if (active) setArtwork(image) })
      .catch(error => { if (active) setRenderError(error instanceof Error ? error.message : 'Artwork unavailable.') })
    return () => { active = false }
  }, [access.allowed])

  useEffect(() => {
    if (!access.allowed) return
    let active = true
    void preparePortraitAssets(online)
      .then(ready => { if (active) setOfflineAssetsReady(ready) })
      .catch(() => { if (active) setOfflineAssetsReady(false) })
    return () => { active = false }
  }, [access.allowed, online])

  useEffect(() => () => {
    photoRequestRef.current++
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
  }, [])

  const portrait = useOriginal ? originalPhoto : cutoutPhoto?.image || originalPhoto
  const portraitFrame = useOriginal ? undefined : cutoutPhoto?.frame
  const gestures = usePosterPortraitGestures(canvasRef, portraitLayerRef,
    Boolean(access.allowed && artwork && portrait && !photoBusy && !renderError), position, setPosition)
  useEffect(() => {
    if (!artwork || !canvasRef.current || !access.allowed) return
    try {
      portraitLayerRef.current = renderPoster(canvasRef.current, artwork, { track, name, date, school, company, portrait, portraitFrame, ...position }) ?? null
      setRenderError('')
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : 'Could not render the poster.')
    }
  }, [artwork, access.allowed, track, name, date, school, company, portrait, portraitFrame, position])

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

  function resetPhotoPosition() {
    setPosition(DEFAULT_POSITION)
  }

  async function handlePhoto(file: File) {
    const request = ++photoRequestRef.current
    gestures.select(false)
    setOriginalPhoto(null)
    setCutoutPhoto(null)
    setUseOriginal(false)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
      setPhotoBusy(false)
      setPhotoStatus('Use a PNG, JPEG or WebP photo smaller than 20 MB.')
      return
    }
    resetPhotoPosition()
    setPhotoBusy(true)
    setPhotoStatus('Preparing portrait and removing background on this device...')
    try {
      const original = await loadPhoto(file)
      if (request !== photoRequestRef.current) return
      setOriginalPhoto(original)
      // Yield one frame so the processing state can be painted before inference starts.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const { blob, frame } = await removePortraitBackground(file)
      if (request !== photoRequestRef.current) return
      const cutout = await loadPhoto(blob)
      if (request !== photoRequestRef.current) return
      setCutoutPhoto({ image: cutout, frame })
      setPhotoStatus('Background removed and portrait positioned. Adjust it in the preview or use the sliders.')
    } catch {
      if (request === photoRequestRef.current) setPhotoStatus('Automatic removal was unavailable. The original photo is still available. Check your connection and try another photo.')
    } finally {
      if (request === photoRequestRef.current) setPhotoBusy(false)
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption)
      setCaptionStatus({ caption, message: 'Caption copied.' })
    } catch {
      captionRef.current?.focus({ preventScroll: true })
      captionRef.current?.select()
      setCaptionStatus({ caption, message: 'Use your device’s copy command to copy the selected caption.' })
    }
  }

  const canDownload = Boolean(access.allowed && artwork && name.trim() && school.trim() && formatPosterDate(date) && portrait && !photoBusy && !renderError)

  if ((online && !authReady) || !access.checked) return <section className="screen admin-poster"><p role="status">Checking administrator access...</p></section>
  if (!access.allowed) return <section className="screen admin-poster"><AdminNavigation /><h1>Poster Generator</h1><p role="alert">{online ? 'Administrator access is required to use this tool.' : 'Reconnect to verify admin access for this device.'}</p></section>

  return <section className="screen admin-poster">
    <AdminNavigation />
    <header className="admin-poster__heading">
      <h1>POSTER GENERATOR</h1>
      <p>Create a Hyperion congratulatory poster for any licensure track. Everything stays in this browser until you download.</p>
      <p className="admin-poster__hint" role="status">
        {offlineAssetsReady && offlineAccess.allowed
          ? 'Ready to use offline on this device.'
          : !online ? 'Reconnect to finish preparing automatic background removal.'
          : offlineAssetsReady === false ? 'Offline setup could not finish. Reopen this page to retry.'
          : 'Preparing offline access on this device…'}
      </p>
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
          <input id="poster-scale" type="range" min="70" max="140" step="1" value={scalePercent} onChange={event => setPosition({ ...position, scalePercent: Number(event.target.value) })} />
          <label htmlFor="poster-horizontal">Move horizontally <output>{xOffsetPercent > 0 ? '+' : ''}{xOffsetPercent}%</output></label>
          <input id="poster-horizontal" type="range" min="-16" max="16" step="1" value={xOffsetPercent} onChange={event => setPosition({ ...position, xOffsetPercent: Number(event.target.value) })} />
          <label htmlFor="poster-vertical">Move vertically <output>{yOffsetPercent > 0 ? '+' : ''}{yOffsetPercent}%</output></label>
          <input id="poster-vertical" type="range" min="-13" max="13" step="1" value={yOffsetPercent} onChange={event => setPosition({ ...position, yOffsetPercent: Number(event.target.value) })} />
          <button type="button" className="btn btn-outline" onClick={resetPhotoPosition}>RESET PHOTO POSITION</button>
        </div>

        <h2>CONGRATULATORY POST</h2>
        <label htmlFor="poster-caption-style">Caption style</label>
        <select id="poster-caption-style" value={captionStyle} onChange={event => setCaptionStyle(Number(event.target.value))}>
          {POSTER_CAPTION_STYLES.map((style, index) => <option value={index} key={style}>{style}</option>)}
        </select>
        <label htmlFor="poster-caption">Caption</label>
        <textarea id="poster-caption" ref={captionRef} rows={7} readOnly value={caption}
          placeholder="Enter the candidate’s name to generate a caption." />
        <button type="button" className="btn btn-outline admin-poster__copy-caption" disabled={!caption} onClick={() => void copyCaption()}>
          Copy caption
        </button>
        <p className="admin-poster__hint" role="status">{captionStatus?.caption === caption ? captionStatus.message : ''}</p>
      </div>

      <aside className="admin-poster__preview"
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) gestures.select(false) }}
        onKeyDown={event => { if (event.key === 'Escape' && gestures.active) gestures.select(false) }}>
        <div className="admin-poster__preview-heading"><h2>LIVE PREVIEW</h2><span>Square 2048 × 2048 PNG</span></div>
        {portrait && !photoBusy && <div className="admin-poster__portrait-tools">
          <button type="button" className="btn btn-outline" aria-pressed={gestures.active}
            disabled={!artwork || Boolean(renderError)} onClick={() => gestures.select(!gestures.active)}>
            Adjust portrait in preview
          </button>
          <p id="poster-gesture-help" className="admin-poster__hint">
            {gestures.active ? 'Drag to move. Scroll or pinch to resize.' : 'Click or tap the portrait to select it.'}
          </p>
        </div>}
        <canvas ref={canvasRef} className={`admin-poster__canvas${gestures.active ? ' admin-poster__canvas--editing' : ''}`}
          tabIndex={gestures.active ? 0 : -1} role="img" aria-label="Hyperion congratulatory poster preview"
          aria-describedby={portrait && !photoBusy ? 'poster-gesture-help' : undefined}
          onPointerDown={gestures.onPointerDown} onPointerMove={gestures.onPointerMove}
          onPointerUp={gestures.endPointer} onPointerCancel={gestures.endPointer}
          onLostPointerCapture={gestures.endPointer} />
        {renderError && <p role="alert" className="admin-poster__error">{renderError}</p>}
        <button type="button" className="btn btn-primary admin-poster__download" disabled={!canDownload} onClick={() => { if (canvasRef.current) downloadPoster(canvasRef.current, fullPosterName(trackId, name)) }}>
          DOWNLOAD POSTER PNG
        </button>
        <p className="admin-poster__hint">The exam title and rank follow your selected track. The Facebook handle and website are included automatically.</p>
      </aside>
    </div>
  </section>
}
