import { formatPosterDate, fullPosterName, POSTER_TRACKS } from './posterTracks.mjs'

export const POSTER_CAPTION_STYLES = Object.freeze([
  'Simple congratulations',
  'Short shoutout',
  'Good news',
  'Taglish cheers',
  'Big congratulations',
  'Straight from Hyperion',
  'Another passer',
  'For fellow seafarers',
  'Proud moment',
  'Casual Taglish',
])

const openings = [
  (name, exam) => `Congratulations, ${name}! 🎉\n\nYou passed the ${exam}.`,
  (name, exam) => `PASADO! 🎉\n\n${name} passed the ${exam}.`,
  (name, exam) => `Good news! 🎉 ${name} passed the ${exam}.`,
  (name, exam) => `Congrats, ${name}! 🥳 Pasado sa ${exam}!`,
  (name, exam) => `Big congratulations to ${name} for passing the ${exam}! ⚓`,
  (name, exam) => `From Hyperion Maritime, congratulations to ${name} for passing the ${exam}! 🎉`,
  (name, exam) => `Another MARINA passer! 🎉 Congratulations to ${name} for passing the ${exam}.`,
  (name, exam) => `Let's congratulate ${name} for passing the ${exam}! 👏`,
  (name, exam) => `Congratulations, ${name}! 🎊 You passed the ${exam}.`,
  (name, exam) => `Ayos, Boss! 🎉 Congrats, ${name}, for passing the ${exam}!`,
]

const messages = {
  oic_nw: [
    'Proud kami sa achievement mo, Boss. Enjoy this day! ⚓',
    'OIC-NW passer na! Congrats, Boss! 👏',
    'Congrats sa ating OIC-NW passer. Deserve mong i-celebrate ito!',
    'Sulit ang pag-review sa navigation at COLREGs. Good job, Boss!',
    'Saludo sa effort mo. Enjoy this win!',
    'Well done, Officer! Proud kaming i-share ang good news mo.',
    'Good job sa OIC-NW exam mo. Ingat lagi sa dagat! ⚓',
    'Sa mga OIC-NW reviewees, laban lang. Sana kayo naman next!',
    'Your hard work paid off. Enjoy this day, Officer!',
    'Finally, good news! Enjoy mo ang araw na ito. 🙌',
  ],
  gmdss: [
    'Saludo sa GMDSS GOC result mo, Boss! 📻',
    'GOC passer na! Good job! 👏',
    'Another GMDSS GOC passer. Masaya kaming i-share ang good news!',
    'Mula radio procedures hanggang exam day, kinaya mo. Good job!',
    'Saludo sa tiyaga mo sa GMDSS review. Enjoy this win!',
    'Proud kami sa GMDSS GOC achievement mo. Well done!',
    'GOC exam result worth celebrating. Keep it up! 📻',
    'Sa mga GMDSS reviewees, tuloy lang. Next time kayo naman!',
    'A great result for our GMDSS GOC passer. Well done!',
    'Pasado na sa GOC! Enjoy mo ito, Boss! 🙌',
  ],
  oic_ew: [
    'Isang saludo sa ating OIC-EW passer! 🔧',
    'OIC-EW passer na! Well done, Boss! 👏',
    'Masayang update para sa engine community. Good job, Engineer!',
    'Sulit ang aral sa machinery at engine systems. Good job, Boss!',
    'Saludo sa effort mo. Enjoy this moment!',
    'Proud kaming i-feature ang OIC-EW achievement mo.',
    'Saludo sa engine community! ⚙️',
    'Sa mga future OIC-EW passers, keep reviewing. Kaya niyo rin yan!',
    'Good job, Engineer. Deserve mong i-celebrate ito!',
    'Engineer, pasado na! Enjoy this win! 🙌',
  ],
  master_mariner: [
    'Saludo sa Deck Management result mo, Captain! ⚓',
    'Master Mariner exam passer! Saludo, Captain! 👏',
    'Masayang araw para sa Deck Management community. Well done, Captain!',
    'Hindi biro ang management-level exam. Deserve mo itong i-celebrate!',
    'Saludo sa tiyaga at effort mo, Captain. Enjoy this win!',
    'Proud kaming i-share ang achievement mo, Captain.',
    'Saludo sa mga deck officers working toward management level! 🚢',
    'Sa mga nagre-review for Deck Management, tuloy lang. Kaya niyo rin ito!',
    'What a great result. Well done, Captain!',
    'Captain, pasado na! Enjoy mo ito! 🙌',
  ],
  chief_mate: [
    'Saludo sa Chief Mate exam result mo! ⚓',
    'C/M passer na! Well done! 👏',
    'Another Deck Management passer. Good job sa Chief Mate result!',
    'Stability at cargo planning, sulit ang pag-aaral. Good job!',
    'Saludo sa effort mo. Enjoy this big day!',
    'Proud kaming i-share ang Chief Mate achievement mo.',
    'Masaya ang deck community sa result na ito. 🚢',
    'Sa mga future C/M passers, tuloy lang sa review. Kaya yan!',
    'Good job on your Deck Management exam. Enjoy this day!',
    'Chief Mate passer na, Boss! Enjoy mo ito! 🙌',
  ],
  chief_engineer: [
    'Saludo sa Chief Engineer exam result mo! ⚙️',
    'C/E passer na! Well done, Chief! 👏',
    'Masayang update para sa Engine Management community. Well done, Chief!',
    'Hindi biro ang Engine Management exam. Deserve mo itong i-celebrate!',
    'Saludo sa effort mo, Chief. Enjoy this win!',
    'Proud kaming i-feature ang Chief Engineer achievement mo.',
    'Saludo sa effort sa Engine Management. 🔧',
    'Sa mga future C/E passers, tuloy lang sa review. Kaya yan!',
    'Good job on your Engine Management exam. Well done!',
    'Chief, pasado na! Celebrate natin ito! 🙌',
  ],
  first_engineer: [
    'Saludo sa 1/E Engine Management result mo! ⚙️',
    '1/E passer na! Good job, Engineer! 👏',
    'Another Engine Management passer. Well done sa 1/E result!',
    'Sulit ang review sa maintenance at engine operations. Good job!',
    'Saludo sa tiyaga mo, Engineer. Enjoy this day!',
    'Proud kaming i-share ang 1/E achievement mo.',
    'Result na worth celebrating para sa 1/E! 🔧',
    'Sa mga future 1/E passers, laban lang. Next time kayo naman, Boss!',
    'Well done on your Engine Management exam, Engineer!',
    '1/E passer na, Boss! Enjoy this win! 🙌',
  ],
  second_engineer: [
    'Saludo sa 2/E Engine Management result mo! ⚙️',
    '2/E passer na! Well done, Engineer! 👏',
    'Masayang update para sa Engine Management community. Well done!',
    'Troubleshooting at maintenance review, sulit ang pag-aaral. Good job!',
    'Saludo sa effort mo, Engineer. Enjoy this win!',
    'Proud kaming i-share ang 2/E achievement mo.',
    'Saludo sa effort mo sa Engine Management! 🔧',
    'Sa mga future 2/E passers, tuloy lang. Kaya niyo rin ito!',
    'Good job on your Engine Management exam. Well done!',
    'Engineer, pasado na sa 2/E! Enjoy this day! 🙌',
  ],
}

export function createPosterCaption(trackId, style, { name, date = '', school = '', company = '' }) {
  const track = POSTER_TRACKS.find(option => option.id === trackId)
  if (!track) return ''
  const candidate = fullPosterName(trackId, name)
  if (!candidate) return ''

  const exam = track.examTitle.toLowerCase().replace('\n', ' ').replace('marina licensure examination', 'MARINA Licensure Examination').replace('gmdss', 'GMDSS')
  const details = [
    ['Examination date', formatPosterDate(date)],
    ['School', school.trim()],
    ['Company or sponsor', company.trim()],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`)

  const index = openings[style] ? style : 0
  return [
    openings[index](candidate, exam),
    messages[track.id][index],
    details.join('\n'),
  ].filter(Boolean).join('\n\n')
}
