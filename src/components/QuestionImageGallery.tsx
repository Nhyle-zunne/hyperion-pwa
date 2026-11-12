import { useEffect, useState } from 'react'
import type { Question, TrackId } from '../types/question'
import type { QuestionImageRef } from '../lib/questionMedia'
import { loadLicensedQuestionImage } from '../lib/questionMediaCache'
import { useLicenseStore } from '../stores/licenseStore'

type Loaded = { url: string; error?: string }
export default function QuestionImageGallery({
  question, placement
}: { question: Question; placement: 'question' | 'explanation' }) {
  const images = question.imageAttachments?.filter(ref => ref.placement===placement) || []
  const owner = useLicenseStore(s => s.entitlementUserId)
  const unlocked = useLicenseStore(s => s.isTrackUnlocked(question.track))
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})
  const [zoom, setZoom] = useState<string | null>(null)
  const refs = images.map(ref => `${ref.sha256}:${ref.placement}`).join(',')
  useEffect(() => {
    let active = true
    const urls: string[] = []
    setLoaded({})
    setZoom(null)
    if (!unlocked || !owner || !images.length) return
    const start = async (ref: QuestionImageRef) => {
      try {
        const blob = await loadLicensedQuestionImage(question.track as TrackId, ref)
        if (!active) return
        const url = URL.createObjectURL(blob)
        urls.push(url)
        setLoaded(prev => ({...prev,[ref.sha256]:{url}}))
      } catch (error) {
        if (!active) return
        setLoaded(prev => ({...prev,[ref.sha256]:{
          url:'',error:error instanceof Error ? error.message : 'Image unavailable'
        }}))
      }
    }
    for (const ref of images) void start(ref)
    return () => {active=false;for(const url of urls)URL.revokeObjectURL(url)}
    // refs provides stable identity for the small immutable hash-addressed list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.track,question.id,placement,refs,owner,unlocked])
  if (!images.length) return null
  if (!unlocked) return <p style={{fontSize:'.85rem',color:'var(--text-muted)'}}>
    This question's diagram requires a licensed track.
  </p>
  return <div style={{display:'grid',gap:12,margin:'1rem 0'}} aria-label="Question diagrams">
    {images.map(ref => {
      const image=loaded[ref.sha256]
      return <figure key={ref.sha256} style={{margin:0}}>
        {image?.url ? <button type="button" title="Tap to enlarge diagram"
            style={{display:'block',padding:4,background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,cursor:'zoom-in',maxWidth:'100%'}}
            onClick={() => setZoom(image.url)}>
          <img src={image.url} alt={ref.alt}
            style={{maxWidth:'100%',maxHeight:420,objectFit:'contain',display:'block'}}/>
        </button> :
          <div role={image?.error?'alert':'status'} style={{padding:14,border:'1px solid var(--border)',borderRadius:8}}>
            {image?.error || 'Loading diagram from protected storage…'}
          </div>}
        <figcaption style={{fontSize:'.82rem',color:'var(--text-muted)',marginTop:5}}>{ref.alt}</figcaption>
      </figure>
    })}
    {zoom && <div role="presentation" onClick={() => setZoom(null)}
      style={{position:'fixed',inset:0,zIndex:9000,background:'rgba(0,0,0,.92)',display:'grid',placeItems:'center',padding:12}}>
      <div role="dialog" aria-modal="true" aria-label="Enlarged question diagram"
        style={{maxWidth:'100%',maxHeight:'100%',display:'grid',gap:10}}>
        <button type="button" className="btn btn-outline"
          onClick={() => setZoom(null)} style={{justifySelf:'end'}}>Close image ✕</button>
        <img src={zoom} alt="Enlarged maritime question diagram"
          style={{maxWidth:'95vw',maxHeight:'85vh',objectFit:'contain'}}/>
      </div>
    </div>}
  </div>
}
