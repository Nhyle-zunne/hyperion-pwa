import { formatPosterDate, fullPosterName, POSTER_TRACKS } from './posterTracks.mjs'

export const POSTER_CAPTION_STYLES = Object.freeze([
  'Formal announcement',
  'Short and direct',
  'Heartfelt',
  'Hard-earned milestone',
  'Next chapter',
  'Family and mentors',
  'Maritime pride',
  'For fellow reviewers',
  'Professional',
  'Taglish celebration',
])

const openings = [
  (name, exam) => `We congratulate ${name} on passing the ${exam}.`,
  (name, exam) => `${name} passed the ${exam}!`,
  (name, exam) => `We’re proud of you, ${name}! Congratulations on passing the ${exam}.`,
  (name, exam) => `A hard-earned result for ${name}, who passed the ${exam}!`,
  (name, exam) => `A new chapter begins for ${name} after passing the ${exam}.`,
  (name, exam) => `Join us in celebrating ${name} for passing the ${exam}!`,
  (name, exam) => `A proud day at Hyperion Maritime. ${name} has passed the ${exam}!`,
  (name, exam) => `Cheers to ${name} for passing the ${exam}!`,
  (name, exam) => `Congratulations to ${name} on passing the ${exam}.`,
  (name, exam) => `Congrats, ${name}! Pasado na sa ${exam}!`,
]

const messages = {
  oic_nw: [
    'Hyperion Maritime celebrates this milestone in your deck officer career.',
    'A big day for a future bridge watch. Well done!',
    'Here’s to the moment all those late nights finally turned into news worth calling home about.',
    'From plotting exercises to collision regulations, steady preparation carried you to this day.',
    'There are more passages ahead. Take a moment to enjoy reaching this waypoint.',
    'This moment belongs to you and to everyone who made room for one more hour of study.',
    'A proud day for the deck community and for everyone working toward a safe watch at sea.',
    'To everyone reviewing COLREGs tonight, keep going. One rule, one scenario, one session at a time.',
    'Wishing you sound judgment, clear communication, and dependable teamwork on every bridge watch ahead.',
    'Sulit ang bawat practice sa chart at bawat balik sa COLREGs. Proud kami sa iyo!',
  ],
  gmdss: [
    'Hyperion Maritime recognizes your achievement in the General Operator’s Certificate (GOC) examination.',
    'GMDSS GOC milestone reached. A proud moment worth sharing!',
    'You did it. We’re proud to celebrate the result with you after all those rounds of radio practice.',
    'Distress procedures, radio equipment, and practice calls all took patience. That work deserves recognition.',
    'This is a meaningful step forward in the work of keeping ships connected when it matters most.',
    'For the classmates who practiced radio calls with you and the mentors who corrected them, this is a day to celebrate together.',
    'Clear communication is part of safety at sea. Today we celebrate the work you’ve put into learning it.',
    'If radio procedures still feel overwhelming, practice one call from start to finish. Then do it again tomorrow.',
    'Wishing you clarity, composure, and accuracy in every communications watch ahead.',
    'Mula sa practice calls hanggang sa GOC exam, sulit ang tiyaga. Ipagdiwang natin ito!',
  ],
  oic_ew: [
    'Hyperion Maritime congratulates you on reaching this milestone in your marine engineering career.',
    'One major step forward for an engine watchkeeper. Well done!',
    'Months of studying machinery can feel like quiet work. Today is the day to celebrate it out loud.',
    'Every system diagram you traced and every fault you reviewed helped you earn this result.',
    'Here’s to the next chapter in the engine room and to all the systems you’ll keep learning.',
    'To the instructors who made the difficult systems click and the people who cheered from home, thank you for sharing this journey.',
    'The work below deck keeps a ship moving. Today we shine a light on someone preparing to do it well.',
    'To engine reviewers working through a tough fault scenario, follow the flow through the system and keep at it.',
    'Wishing you careful rounds, accurate watch handovers, and safe decisions as your responsibilities grow.',
    'Mula sa system diagrams hanggang sa exam day, kinaya mo. Proud ang engine community sa iyo!',
  ],
  master_mariner: [
    'Hyperion Maritime celebrates this Master Mariner milestone at deck management level.',
    'A Master Mariner milestone worth pausing for. Congratulations!',
    'Some results carry the memory of years at sea. Take time to share this one with the people who waited for your call.',
    'The passage from watchkeeping to management-level assessment takes years of practice, reflection, and study. Today honors that work.',
    'As you keep moving toward command, may your next chapter be marked by calm judgment and a crew that trusts you.',
    'Here’s to the captains who taught by example and the family and friends who supported the long road to this result.',
    'Our maritime community takes pride in seafarers who put the work into preparing for the responsibilities of command.',
    'To those preparing for deck management, study the reason behind each decision. It will serve you when the scenario changes.',
    'Wishing you continued growth in bridge resource management, passage planning, and the leadership that keeps crews safe.',
    'Mahaba ang pinagdaanan sa barko at sa review. Ngayon, oras na para ipagdiwang ang Master Mariner milestone mo!',
  ],
  chief_mate: [
    'Hyperion Maritime recognizes your Chief Mate milestone in the deck management examination.',
    'A Chief Mate milestone earned. Enjoy your day!',
    'Between sea time and study time, getting here asked a lot of you. We’re glad we get to celebrate this moment with you.',
    'The hours spent on stability, cargo planning, and deck safety paid off. You earned this result.',
    'Here’s to your next chapter overseeing deck operations, developing your team, and keeping the work safe.',
    'For everyone who talked through a stability problem with you or kept you company during review, this celebration is yours to share.',
    'Deck teams depend on coordination and care. We’re proud to see you reach this management-level milestone.',
    'Reviewing for Chief Mate? Work a full cargo scenario and explain each decision out loud. Understanding grows with practice.',
    'Wishing you organized cargo operations, clear deck briefings, and the confidence to speak up when safety calls for it.',
    'Sulit ang pag-aaral ng stability at cargo operations. Ipagdiwang natin ang Chief Mate milestone mo!',
  ],
  chief_engineer: [
    'Hyperion Maritime celebrates your Chief Engineer milestone at engine management level.',
    'A Chief Engineer milestone worth celebrating. Well done!',
    'The people who saw you come home from a long contract and open your notes again know exactly what this day means.',
    'This result reflects time spent on machinery reliability, contingency planning, and the judgment to connect them.',
    'May your next chapter bring you opportunities to lead engineering teams with care, clarity, and a steady hand.',
    'Here’s to the senior engineers who shared what they knew and the people at home who helped you make time for the work.',
    'Reliable engineering is quiet when it goes well. Today we get to applaud the preparation that goes into leading it.',
    'To reviewers aiming for Chief Engineer, connect the technical answer to the management decision it supports. Keep asking why.',
    'Wishing you safe operations, thoughtful maintenance planning, and a team that feels comfortable raising concerns early.',
    'Pagod sa duty, tapos review pa. Deserve mong ipagdiwang ang Chief Engineer milestone na ito!',
  ],
  first_engineer: [
    'Hyperion Maritime congratulates you on your 1/E milestone in the engine management examination.',
    'A proud step at engine management level for 1/E. Congratulations!',
    'There’s a special satisfaction in seeing long days of technical study turn into a result you can share.',
    'Studying how to plan maintenance while keeping machinery available is demanding work. Today, that effort shows.',
    'Here’s to the responsibilities ahead, from coordinating engineering work to giving others room to learn.',
    'Thank you to the engineers who answered the extra questions and the people who understood when another review session ran late.',
    'Planning work well protects both the machinery and the people who look after it. A proud day for the engine department.',
    'Preparing for 1/E? Practice explaining which job comes first, who needs to know, and what makes the work safe.',
    'Wishing you practical maintenance plans, clear task handovers, and good coordination across the engineering team.',
    'Mula sa maintenance planning hanggang sa exam, tinapos mo ang laban. Proud kami sa 1/E milestone mo!',
  ],
  second_engineer: [
    'Hyperion Maritime recognizes your 2/E milestone at engine management level.',
    'A big engine management result for 2/E. Well done!',
    'Today is for you and for everyone who knew how much this exam meant before the results came out.',
    'Working through machinery failures, safety procedures, and maintenance decisions takes persistence. You put in that work.',
    'Here’s to the next phase of running jobs safely, supporting the watchkeepers, and keeping the engineering team informed.',
    'A cheer for the mentors who turned problems into lessons and the family and friends who kept you going between study sessions.',
    'A well-run engine room depends on teamwork and follow-through. Today the engineering community celebrates your progress.',
    'If you’re reviewing for 2/E, take a machinery fault and write down your first safe action. Build from there one decision at a time.',
    'Wishing you dependable equipment, safe work planning, and clear handovers whenever priorities change.',
    'Sulit ang tiyaga sa troubleshooting at review. Ipagdiwang natin ang 2/E milestone mo!',
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
  ].filter(([, value]) => value).map(([label, value]) => `${label} — ${value}`)

  const index = openings[style] ? style : 0
  return [
    openings[index](candidate, exam),
    messages[track.id][index],
    details.join('\n'),
  ].filter(Boolean).join('\n\n')
}
