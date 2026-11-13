import type { MouseEvent } from 'react'
import { LICENSE_TERMS, priceForTerm } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import './BondStoreCardContent.css'

// Single Bond Store visual/content source shared by the five store cards and
// all track-specific locked-feature purchase popups.
export const BOND_STORE_FEATURES = [
  'Unlimited practice sessions',
  'Unlimited timed mock exams',
  'Full question bank for your licensed track',
  'Custom drills and question ranges',
  'Quick Scan Mode',
  'Mistakes Notebook and bookmarks',
  'Full-text question search',
  'Offline review after downloading',
  'Study history and cross-device progress sync',
] as const

const STORE_TRACK_CAPTIONS: Record<PaidTrack, string> = {
  oic_nw: 'DECK · OPERATIONAL',
  engine_ew: 'ENGINE · OPERATIONAL',
  gmdss: 'GMDSS · RADIO',
  deck_mgt: 'DECK · MANAGEMENT',
  engine_mgt: 'ENGINE · MANAGEMENT',
}

const STORE_CATEGORY_ICON: Record<PaidTrack, number> = {
  oic_nw: 1, engine_ew: 2, gmdss: 3, deck_mgt: 1, engine_mgt: 2,
}

const STORE_LEVEL_ICON: Partial<Record<PaidTrack, number>> = {
  oic_nw: 4, engine_ew: 4, deck_mgt: 5, engine_mgt: 5,
}

// Crop the exact supplied Hyperion artwork, not generic emoji or synthesized logos.
// Sprite order: anchor, deck helm, engine, GMDSS, operational shield, management cap.
function StoreBannerSymbol({ index, small = false }: { index: number; small?: boolean }) {
  const size = small ? 24 : 42
  return <span aria-hidden="true"
    className={`store-banner-symbol${small ? ' store-banner-symbol--small' : ''}`}
    style={{ backgroundPosition: `-${size * index}px 0px` }} />
}

type Product = {
  code: PaidTrack
  label: string
  trackLabel: string
  weeklyPrice: number
  monthlyPrice: number
  annualPrice: number
}

interface Props {
  product: Product
  term: LicenseTerm
  onTermChange: (term: LicenseTerm) => void
  disabled?: boolean
  expanded: boolean
  onToggleBenefits: (event: MouseEvent<HTMLButtonElement>) => void
  benefitsId: string
  headingId?: string
  headingLevel?: 'h2' | 'h3'
}

export default function BondStoreCardContent({
  product, term, onTermChange, disabled = false, expanded, onToggleBenefits, benefitsId,
  headingId, headingLevel = 'h3',
}: Props) {
  const title = headingLevel === 'h2'
    ? <h2 className="store-plan-title" id={headingId}>{product.label}</h2>
    : <h3 className="store-plan-title" id={headingId}>{product.label}</h3>

  return <>
    <div className="product-art">
      <StoreBannerSymbol index={0} />
      <div className="store-banner-text"><strong>HYPERION</strong><small>{STORE_TRACK_CAPTIONS[product.code]}</small></div>
      <span className="store-banner-track">
        <StoreBannerSymbol index={STORE_CATEGORY_ICON[product.code]} />
        {STORE_LEVEL_ICON[product.code] != null && <StoreBannerSymbol index={STORE_LEVEL_ICON[product.code]!} small />}
      </span>
    </div>
    {title}
    <div className="product-price">₱{priceForTerm(product, term)}<span> / {term}</span></div>
    <div className="store-duration-label">CHOOSE DURATION</div>
    <div className="store-duration-options" role="group" aria-label={`Choose access duration for ${product.label}`}>
      {LICENSE_TERMS.map(option => {
        const selected = option.code === term
        const price = priceForTerm(product, option.code)
        return <button
          key={option.code}
          type="button"
          className="store-duration-option"
          aria-pressed={selected}
          aria-label={`${product.label} ${option.label} ₱${price}`}
          disabled={disabled}
          onClick={() => onTermChange(option.code)}
        ><span>{option.label}</span><span>₱{price}</span></button>
      })}
    </div>
    <div className="store-feature-highlight">✦ Full reviewer access</div>
    <ul className="store-benefits-list" id={benefitsId} aria-label={`Premium features for ${product.label}`}>
      {BOND_STORE_FEATURES.map(feature => <li key={feature}>{feature}</li>)}
    </ul>
    <button
      type="button" className="store-benefits-toggle" aria-controls={benefitsId}
      aria-expanded={expanded} onClick={onToggleBenefits}
    >{expanded ? 'Show fewer features ↑' : 'See all 9 premium features ↓'}</button>
  </>
}
