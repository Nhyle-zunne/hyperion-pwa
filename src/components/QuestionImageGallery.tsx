import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Question, TrackId } from '../types/question'
import type { QuestionImageRef } from '../lib/questionMedia'
import { loadLicensedQuestionImage } from '../lib/questionMediaCache'
import { useLicenseStore } from '../stores/licenseStore'

type Loaded = { url: string; error?: string }

export default function QuestionImageGallery({ question, placement }: { question: Pick<Question, 'id' | 'track' | 'imageAttachments'>; placement: 'question' | 'explanation' }) {
  const images = question.imageAttachments?.filter(ref => ref.placement === placement) || []
  const owner = useLicenseStore(state => state.entitlementUserId)
  const unlocked = useLicenseStore(state => state.isTrackUnlocked(question.track))
  if (!images.length) return null
  if (!unlocked) return <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>This question's diagram requires a licensed track.</p>
  if (!owner) return <p role="status">Sign in to download this question's diagram.</p>
  // Discard thumbnails and zoom synchronously when the account or question changes.
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
        const blob = await loadLicensedQuestionImage(track, ref, controller.signal)
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
          <span aria-hidden="true" style={{ display: 'block', padding: '5px 0 2px', fontSize: '.78rem', fontWeight: 650, color: 'var(--text-muted)' }}>🔍 Zoom</span>
        </button> : <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 8 }}>
          <p role={image?.error ? 'alert' : 'status'}>{image?.error || 'Loading diagram from protected storage…'}</p>
          {image?.error && <button type="button" className="btn btn-outline" onClick={() => setAttempt(value => value + 1)}>Retry image</button>}
        </div>}
        <figcaption style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginTop: 5, textAlign: 'center' }}>{ref.alt}</figcaption>
      </figure>
    })}
    {zoom && <ImageZoom image={zoom} close={() => setZoom(null)} />}
  </div>
}

function ImageZoom({ image, close }: { image: { url: string; alt: string }; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [zoomPercent, setZoomPercent] = useState(100)
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    element.showModal()
    return () => { element.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus() }
  }, [])
  const adjust = (step: number) => setZoomPercent(current => Math.min(250, Math.max(100, current + step)))
  return createPortal(<dialog ref={dialog} aria-label="Enlarged question diagram" className="question-diagram-zoom"
    onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}
    style={{ padding: 12, border: 0, borderRadius: 10, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)', background: 'var(--bg-card)', color: 'var(--text)' }}>
    <div style={{ display: 'grid', gap: 10, width: 'min(86vw, 960px)', maxWidth: '100%' }}>
      <div role="toolbar" aria-label="Diagram zoom controls" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" aria-label="Zoom out" disabled={zoomPercent <= 100} onClick={() => adjust(-25)}>−</button>
        <output aria-label="Image zoom percentage" style={{ minWidth: 56, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{zoomPercent}%</output>
        <button type="button" className="btn btn-outline" aria-label="Zoom in" disabled={zoomPercent >= 250} onClick={() => adjust(25)}>+</button>
        <button type="button" className="btn btn-outline" aria-label="Reset zoom" disabled={zoomPercent === 100} onClick={() => setZoomPercent(100)}>Reset</button>
        <button type="button" className="btn btn-outline" onClick={close}>Close image ✕</button>
      </div>
      <div aria-label="Zoomable diagram viewport" style={{ width: '100%', height: 'min(62dvh, 620px)', overflow: 'auto', borderRadius: 8, background: 'var(--bg)', overscrollBehavior: 'contain' }}>
        <div style={{ width: zoomPercent + '%', height: zoomPercent + '%', minWidth: '100%', minHeight: '100%', display: 'grid', placeItems: 'center' }}>
          <img src={image.url} alt={image.alt} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      </div>
      <p style={{ margin: 0, textAlign: 'center' }}>{image.alt}</p>
    </div>
  </dialog>, document.body)
}
