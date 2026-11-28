import { formatPosterDate, fullPosterName, POSTER_TRACKS } from './posterTracks.mjs'

export const POSTER_CAPTION_STYLES = Object.freeze([
  'Professional',
  'Sincere',
  'Taglish, Proud',
  'Taglish, Heartfelt',
  'Bold',
  'Nautical',
  'Inspirational',
  'Taglish, Casual and Fun',
  'Faith and Gratitude',
  'Hyperion Brand',
])

// The exam wording comes from the same track configuration used on the poster.
const titles = {
  oic_nw: { role: 'Officer', plural: 'officers', icon: '⚓', headline: 'NEW OFFICER ON DECK!', tags: ['OICNW', 'MarineDeckOfficer'] },
  gmdss: { role: 'Radio Operator', plural: 'radio operators', icon: '📻', headline: 'GMDSS GOC PASSER ON BOARD!', tags: ['GMDSSGOC', 'RadioOperator'] },
  oic_ew: { role: 'Engineer', plural: 'engineers', icon: '⚙️', headline: 'NEW ENGINEER ON BOARD!', tags: ['OICEW', 'MarineEngineer'] },
  master_mariner: { role: 'Captain', plural: 'captains', icon: '⚓', headline: 'NEW CAPTAIN ON DECK!', tags: ['MasterMariner', 'DeckManagement'] },
  chief_mate: { role: 'Chief Mate', plural: 'chief mates', icon: '⚓', headline: 'NEW CHIEF MATE ON DECK!', tags: ['ChiefMate', 'DeckManagement'] },
  chief_engineer: { role: 'Chief Engineer', plural: 'chief engineers', icon: '⚙️', headline: 'NEW CHIEF ENGINEER ON BOARD!', tags: ['ChiefEngineer', 'EngineManagement'] },
  first_engineer: { role: 'First Engineer', plural: 'first engineers', icon: '⚙️', headline: 'NEW FIRST ENGINEER ON BOARD!', tags: ['FirstEngineer', 'EngineManagement'] },
  second_engineer: { role: 'Second Engineer', plural: 'second engineers', icon: '⚙️', headline: 'NEW SECOND ENGINEER ON BOARD!', tags: ['SecondEngineer', 'EngineManagement'] },
}

const schoolHashtag = school => (school.normalize('NFKD').replace(/[\u0300-\u036f'’]/g, '').match(/[a-zA-Z0-9]+/g) || [])
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join('')

const examName = track => 'MARINA Licensure Examination for ' + track.examTitle.split('\n')[1]
  .replace(/^FOR /, '')
  .toLowerCase()
  .replace(/\b[a-z]/g, character => character.toUpperCase())
  .replace(/\bGmdss\b/, 'GMDSS')

// Three substantial paragraphs per preset, modeled on the provided Hyperion samples.
// Keep Facebook clipboard content as plain text (no literal Markdown bold markers).
const captions = [
  ({ name, examination, role, icon }) => [
    `${icon} Congratulations, ${role}! ${icon}`,
    `Hyperion extends its warmest congratulations to ${name} on successfully passing the ${examination}.`,
    `This accomplishment reflects your dedication, discipline, and commitment to the maritime profession. Preparing for this examination takes patience, sacrifice, and the determination to keep learning even when the process becomes demanding.`,
    'As you move forward in your career, may you carry the same diligence into every duty and every responsibility entrusted to you. We wish you continued growth, success, and safe voyages.',
  ],
  ({ name, examination }) => [
    '💙 You Did It! 💙',
    `Dear ${name}, congratulations on passing the ${examination}!`,
    'Behind this success are long hours of studying, personal sacrifices, and moments when you had to push yourself to continue. Those efforts may not always have been seen, but today they have led to something worth celebrating.',
    'Take this moment to be proud of how far you have come. You earned it. May this be the first of many dreams you will fulfill, and may you always remember the perseverance that brought you here. We are truly happy and proud of you.',
  ],
  ({ name, examination, role }) => [
    `🎉 PASADO, ${role.toUpperCase()}! 🎉`,
    `Congratulations, ${name}, sa pagpasa sa ${examination}!`,
    'Nagbunga na ang lahat ng puyat, pagod, at sipag mo. Hindi madali ang mag-review at harapin ang pressure ng exam, pero nagpatuloy ka at pinatunayan mong kaya mo.',
    "Deserve mong ipagdiwang ang tagumpay na ito. Sana ay marami pang pintuan ang magbukas para sa'yo, at maging matagumpay ang bawat hakbang ng iyong career sa maritime industry. Sobrang proud kami sa'yo!",
  ],
  ({ name, examination }) => [
    '🥹 Pangarap, Natupad! ⚓',
    `Congratulations, ${name}! Pasado ka sa ${examination}!`,
    'Sa likod ng tagumpay na ito ay ang mga gabing pinili mong mag-aral kahit pagod, at ang mga pagkakataong nagpatuloy ka kahit may kaba at pagdududa. Ngayon, may magandang bunga na ang lahat ng iyon.',
    "Nawa'y maging simula ito ng mas maraming biyaya para sa'yo at sa mga mahal mo sa buhay. Manatili kang masipag at mapagkumbaba habang inaabot ang mas matataas mo pang pangarap.",
  ],
  ({ name, examination, role, icon, headline }) => [
    `${icon} ${headline} ${icon}`,
    `Let's celebrate ${name} for passing the ${examination}!`,
    'You showed up, put in the work, and faced the challenge. This victory is a proud reward for your focus, determination, and refusal to give up on your goal.',
    `A new chapter now lies ahead, with new responsibilities and opportunities. Face them with confidence, keep learning, and lead with integrity. Congratulations, ${role}. This is your moment! 🫡`,
  ],
  ({ name, examination }) => [
    '🧭 Course Well Steered! 🌊',
    `Congratulations, ${name}, on passing the ${examination}!`,
    'The journey to this milestone called for patience through long reviews and steadiness through uncertainty. You held your course, kept your goal in sight, and reached an important port in your maritime journey.',
    'Now, new horizons await. May sound judgment guide every decision you make, and may your experiences at sea strengthen you in your profession. We wish you fair winds, following seas, and safe returns home. 🚢',
  ],
  ({ name, examination, plural }) => [
    '✨ Dream Achieved! ✨',
    `Congratulations to ${name} for passing the ${examination}!`,
    'Success is built one effort at a time: one more page to read, one more question to answer, and one more decision to keep going. Your achievement is a powerful reminder that perseverance matters.',
    `May your story encourage aspiring ${plural} who are still preparing for their turn. As you begin this new chapter, continue to aim high, welcome every lesson, and become someone others can look up to. ⚓`,
  ],
  ({ name, examination, role, icon }) => [
    `😎 Congrats, ${role}! ${icon}`,
    `May bagong dapat i-congratulate! Si ${name}, pasado sa ${examination}! 🎉`,
    'Goodbye muna sa exam kaba! Lahat ng pagre-review, pag-intindi sa mahihirap na topics, at pagtitiyaga mo ay may napakagandang resulta. Sulit na sulit!',
    "Enjoyin mo ang moment na ito kasama ang mga taong sumuporta sa'yo. Good luck sa next chapter, at sana tuloy-tuloy ang blessings. Mga ka-Hyperion, batiin natin ang ating bagong passer sa comments! 👏👇",
  ],
  ({ name, examination }) => [
    '🙏 To God Be the Glory! 🙏',
    `Congratulations, ${name}, on passing the ${examination}!`,
    'We celebrate with you and give thanks for this blessing. May this success remind you that your hard work and patience through every challenge were worthwhile.',
    'As you continue your journey, may God grant you wisdom in your decisions, strength during difficult days, and protection in every voyage. May you remain grateful and humble as you take on greater responsibilities and pursue the dreams ahead of you. ⚓',
  ],
  ({ name, examination }) => [
    '💛 Proud of You! 💙',
    `Hyperion proudly congratulates ${name} for passing the ${examination}!`,
    'Every success story is worth celebrating, especially one built on hard work and determination. Your achievement marks an exciting step forward in your maritime career and gives aspiring maritime professionals another reason to keep striving.',
    'At Hyperion, we believe that every future seafarer deserves the opportunity to learn and grow. We wish you the very best as you move forward with confidence and purpose.',
    "Learning shouldn't be a luxury. ⚓",
  ],
]

export function createPosterCaption(trackId, style, { name, date = '', school = '', company = '' }) {
  const track = POSTER_TRACKS.find(option => option.id === trackId)
  const title = titles[trackId]
  if (!track || !title) return ''
  const candidate = fullPosterName(trackId, name)
  if (!candidate) return ''

  const formattedDate = formatPosterDate(date)
  const examination = [formattedDate, examName(track)].filter(Boolean).join(' ')
  const index = Number.isInteger(style) && style >= 0 && style < captions.length ? style : 0
  const sections = captions[index]({ name: candidate, examination, ...title })
  const details = [
    ...([0, 9].includes(index) ? [`🎓 ${track.defaultDegree.replace('Bachelor of Science in', 'BS')}`] : []),
    ...(school.trim() ? [`🏫 ${school.trim()}`] : []),
    ...(company.trim() ? [`🚢 ${company.trim()}`] : []),
  ]
  if (details.length) sections.push(details.join('\n'))
  const hashtags = ['HyperionMaritime', title.tags[0], 'MARINA', title.tags[1], schoolHashtag(school), 'ProudSeafarer']
    .filter(Boolean).map(tag => '#' + tag).join(' ')
  sections.push(`🌐 HyperionMaritime.org\n📘 @HyperionMaritime\n${hashtags}`)
  return sections.join('\n\n')
}
