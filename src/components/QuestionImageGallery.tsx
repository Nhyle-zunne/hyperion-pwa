import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import './QuestionImageGallery.css'
import { createPortal } from 'react-dom'
import type { Question, TrackId } from '../types/question'
import type { QuestionImageRef } from '../lib/questionMedia'
import { loadQuestionImage } from '../lib/questionMediaCache'
import { useLicenseStore } from '../stores/licenseStore'
import { useSearchParams } from 'react-router-dom'
import { paidProductCodeForTrackId } from '../lib/supabase'

type Loaded = { url: string; error?: string }

export default function QuestionImageGallery({ question, placement }: { question: Pick<Question, 'id' | 'track' | 'imageAttachments'>; placement: 'question' | 'explanation' }) {
  const [, setParams] = useSearchParams()
  const images = question.imageAttachments?.filter(ref => ref.placement === placement) || []
  const owner = useLicenseStore(state => state.entitlementUserId)
  const unlocked = useLicenseStore(state => state.isTrackUnlocked(question.track))
  if (!images.length) return null
  if (!unlocked) return <button type="button" className="btn btn-outline"
    aria-haspopup="dialog"
    style={{ display: 'block', width: '100%', minHeight: 48, padding: 14, margin: '1rem 0', borderRadius: 0, whiteSpace: 'normal', textAlign: 'center' }}
    onClick={() => {
      const code = paidProductCodeForTrackId(question.track)
      if (!code) return
      setParams(current => {
        const params = new URLSearchParams(current)
        params.set('purchase', '1')
        params.set('purchase_product', code)
        return params
      }, { replace: true })
    }}>UNLOCK FULL REVIEWER TO VIEW IMAGES</button>
  if (!owner) return <p role="status">Sign in to view this track's licensed diagrams.</p>
  // Changing account or entitlement remounts the image session and closes zoom.
  const scope = JSON.stringify([question.track, question.id, placement, images, owner])
  return <ImageSession key={scope} track={question.track} images={images} />
}

function ImageSession({ track, images }: { track: TrackId; images: QuestionImageRef[] }) {
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})
  const [zoom, setZoom] = useState<{ url: string; alt: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const refs = JSON.stringify(images)
  useEffect(() => {
    const controller = new AbortController()
    const urls: string[] = []
    setLoaded({})
    setZoom(null)
    for (const ref of images) void (async () => {
      try {
        const blob = await loadQuestionImage(track, ref, false, controller.signal)
        if (controller.signal.aborted) return
        const url = URL.createObjectURL(blob)
        urls.push(url)
        setLoaded(old => ({ ...old, [ref.sha256]: { url } }))
      } catch (error) {
        if (controller.signal.aborted) return
        setLoaded(old => ({ ...old, [ref.sha256]: { url: '', error: error instanceof Error ? error.message : 'Image unavailable' } }))
      }
    })()
    return () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url) }
    // The serialized refs retain stable identity across unrelated screen renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, refs, attempt])
  return <div style={{ display: 'grid', gap: 12, margin: '1rem 0' }} aria-label="Question diagrams">
    {images.map(ref => {
      const image = loaded[ref.sha256]
      return <figure key={ref.sha256} style={{ margin: 0 }}>
        {image?.url ? <button type="button" title="Tap to enlarge diagram" aria-label={'Enlarge diagram: ' + ref.alt}
          style={{ display: 'block', width: 'min(72%, 520px)', maxWidth: '100%', marginInline: 'auto', padding: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'zoom-in' }}
          onClick={() => setZoom({ url: image.url, alt: ref.alt })}>
          <img src={image.url} alt={ref.alt}
            style={{ display: 'block', width: '100%', maxHeight: 'min(38dvh, 360px)', objectFit: 'contain', objectPosition: 'center' }}
            onError={() => { setZoom(null); setLoaded(old => ({ ...old, [ref.sha256]: { url: '', error: 'This diagram could not be displayed.' } })) }} />
        </button> : <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 8 }}>
          <p role={image?.error ? 'alert' : 'status'}>{image?.error || 'Loading diagram from saved or published media…'}</p>
          {image?.error && <button type="button" className="btn btn-outline" onClick={() => setAttempt(value => value + 1)}>Retry image</button>}
        </div>}
      </figure>
    })}
    {zoom && <ImageZoom image={zoom} close={() => setZoom(null)} />}
  </div>
}

function ImageZoom({ image, close }: { image: { url: string; alt: string }; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const imageElement = useRef<HTMLImageElement>(null)
  const activePointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; percent: number } | null>(null)
  const percentRef = useRef(100)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const boundPan = (offset: { x: number; y: number }, percent: number) => {
    const area = viewport.current
    const img = imageElement.current
    if (!area || !img?.naturalWidth || !img.naturalHeight || percent <= 100) return { x: 0, y: 0 }
    const width = area.clientWidth
    const height = area.clientHeight
    if (!width || !height) return { x: 0, y: 0 }
    const fittedWidth = Math.min(width, height * img.naturalWidth / img.naturalHeight)
    const fittedHeight = fittedWidth * img.naturalHeight / img.naturalWidth
    const maxX = Math.max(0, (fittedWidth * percent / 100 - width) / 2)
    const maxY = Math.max(0, (fittedHeight * percent / 100 - height) / 2)
    return {
      x: Math.max(-maxX, Math.min(maxX, offset.x)),
      y: Math.max(-maxY, Math.min(maxY, offset.y))
    }
  }
  const setMagnification = (percent: number) => {
    const next = Math.max(100, Math.min(250, Math.round(percent)))
    percentRef.current = next
    setZoomPercent(next)
    setPan(current => boundPan(current, next))
  }
  const adjust = (step: number) => setMagnification(percentRef.current + step)
  const reset = () => { setMagnification(100); setPan({ x: 0, y: 0 }) }
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
    if (activePointers.current.size === 2) {
      const [a, b] = [...activePointers.current.values()]
      pinch.current = { distance: Math.max(1, distance(a, b)), percent: percentRef.current }
    }
    setDragging(percentRef.current > 100 && activePointers.current.size === 1)
  }
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = activePointers.current.get(event.pointerId)
    if (!previous) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (activePointers.current.size >= 2) {
      if (!pinch.current) return
      const [a, b] = [...activePointers.current.values()]
      setMagnification(pinch.current.percent * distance(a, b) / pinch.current.distance)
    } else if (percentRef.current > 100) {
      setPan(current => boundPan({
        x: current.x + event.clientX - previous.x,
        y: current.y + event.clientY - previous.y
      }, percentRef.current))
    }
  }
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(event.pointerId)
    if (activePointers.current.size < 2) pinch.current = null
    setDragging(false)
  }
  const panWithKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (percentRef.current <= 100) return
    const delta = ({
      ArrowLeft: { x: 36, y: 0 }, ArrowRight: { x: -36, y: 0 },
      ArrowUp: { x: 0, y: 36 }, ArrowDown: { x: 0, y: -36 }
    } as Record<string, { x: number; y: number }>)[event.key]
    if (!delta) return
    event.preventDefault()
    setPan(current => boundPan({ x: current.x + delta.x, y: current.y + delta.y }, percentRef.current))
  }

  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    const priorBodyOverflow = document.body.style.overflow
    const priorRootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    element.showModal()
    const resize = () => setPan(current => boundPan(current, percentRef.current))
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.deltaY) setMagnification(percentRef.current + (event.deltaY < 0 ? 25 : -25))
    }
    const area = viewport.current
    area?.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('resize', resize)
    return () => {
      area?.removeEventListener('wheel', wheel)
      window.removeEventListener('resize', resize)
      activePointers.current.clear()
      element.close()
      document.body.style.overflow = priorBodyOverflow
      document.documentElement.style.overflow = priorRootOverflow
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
    // Refs and setState are stable; install viewer listeners only while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(<dialog ref={dialog} aria-label="Enlarged question diagram"
    className="question-diagram-zoom"
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="question-diagram-zoom-content">
      <div role="toolbar" aria-label="Diagram zoom controls" className="question-diagram-toolbar">
        <button type="button" className="btn btn-outline" aria-label="Zoom out"
          disabled={zoomPercent <= 100} onClick={() => adjust(-25)}>−</button>
        <output aria-label="Image zoom percentage" className="question-diagram-percentage">{zoomPercent}%</output>
        <button type="button" className="btn btn-outline" aria-label="Zoom in"
          disabled={zoomPercent >= 250} onClick={() => adjust(25)}>+</button>
        <button type="button" className="btn btn-outline" aria-label="Reset zoom"
          disabled={zoomPercent === 100} onClick={reset}>Reset</button>
        <button type="button" className="btn question-diagram-close" aria-label="Close image"
          onClick={close}>Close image ✕</button>
      </div>
      <div ref={viewport} role="group" tabIndex={0} aria-label="Zoomable diagram viewport"
        className="question-diagram-viewport"
        style={{ cursor: zoomPercent > 100 ? dragging ? 'grabbing' : 'grab' : 'default' }}
        onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={pointerUp} onPointerCancel={pointerUp}
        onLostPointerCapture={pointerUp} onKeyDown={panWithKeys}>
        <img ref={imageElement} src={image.url} alt={image.alt} draggable={false}
          onLoad={() => setPan(current => boundPan(current, percentRef.current))}
          style={{ transform: 'translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0) scale(' + (zoomPercent / 100) + ')' }} />
      </div>
    </div>
  </dialog>, document.body)
}
