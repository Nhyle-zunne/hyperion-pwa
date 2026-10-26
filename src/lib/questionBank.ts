import { decryptToText } from './assetCrypto';
import { supabase } from './supabase';
import { parseCsvText } from './csvParser';
import type { Question, TrackId, Difficulty } from '../types/question';

interface BankSource {
  path: string;
  track: TrackId;
  functionId: string;
  competenceId: string;
  idPrefix: string;
  title: string;
  /** 'standard' = No,Q,A,B,C,D,Ans | 'gmdss' = Question,Type,Opt1-6,Expl,Answer,... */
  format: 'standard' | 'gmdss';
  topics?: string[];
}

function deck(
  file: string,
  competenceId: string,
  functionId: string,
  title: string,
  topics?: string[]
): BankSource {
  return {
    path: `deck/${file}`,
    track: 'DECK_OIC_NW',
    functionId,
    competenceId,
    idPrefix: `D-${functionId}-${competenceId}`,
    title,
    format: 'standard',
    topics
  };
}

function gmdss(file: string, competenceId: string, part: number, title: string): BankSource {
  return {
    path: `gmdss/${file}`,
    track: 'GMDSS_GOC',
    functionId: 'GMDSS',
    competenceId,
    idPrefix: `G-${competenceId}-P${part}`,
    title,
    format: 'gmdss'
  };
}

function ew(file: string, competenceId: string, title: string): BankSource {
  const functionId =
    ['C1', 'C2', 'C3', 'C4', 'C5'].includes(competenceId) ? 'F1' :
    ['C6', 'C7'].includes(competenceId) ? 'F2' :
    ['C8', 'C9'].includes(competenceId) ? 'F3' : 'F4';
  return {
    path: `engine_ew/${file}`,
    track: 'ENGINE_OIC_EW',
    functionId,
    competenceId,
    idPrefix: `EW-${competenceId}`,
    title,
    format: 'standard'
  };
}

function dm(file: string, competenceId: string, title: string): BankSource {
  const n = Number(competenceId.replace('C', ''));
  const functionId = n <= 11 ? 'F1' : n <= 14 ? 'F2' : 'F3';
  return {
    path: `deck_mgt/${file}`,
    track: 'DECK_MGT',
    functionId,
    competenceId,
    idPrefix: `DM-${competenceId}`,
    title,
    format: 'standard'
  };
}

function em(file: string, competenceId: string, title: string): BankSource {
  const n = Number(competenceId.replace('C', ''));
  const functionId = n <= 4 ? 'F1' : n <= 6 ? 'F2' : n <= 9 ? 'F3' : 'F4';
  return {
    path: `engine_mgt/${file}`,
    track: 'ENGINE_MGT',
    functionId,
    competenceId,
    idPrefix: `EM-${competenceId}`,
    title,
    format: 'standard'
  };
}

const SOURCES: BankSource[] = [
  deck('oic_nw_c1.csv.enc', 'C1', 'F1', 'Plan and conduct a passage and determine position', [
    'Terrestrial Navigation & Plotting',
    'Compass Errors & Corrections',
    'Passage Planning & Appraisal',
    'Tides & Tidal Streams',
    'Celestial Navigation',
    'Chart Projections',
    'GNSS & Electronic Fixing',
    'Great Circle Sailing',
    'Meteorology'
  ]),
  deck('oic_nw_c2.csv.enc', 'C2', 'F1', 'Maintain a safe navigational watch', [
    'COLREGs Steering & Sailing',
    'Lights & Shapes',
    'Sound Signals',
    'Restricted Visibility',
    'Watchkeeping'
  ]),
  deck('oic_nw_c3.csv.enc', 'C3', 'F1', 'Use of Radar and ARPA for the safety of navigation', [
    'Radar & ARPA',
    'Collision Avoidance',
    'Radar Plotting'
  ]),
  deck('oic_nw_c4.csv.enc', 'C4', 'F1', 'Use of ECDIS for the safety of navigation', [
    'ECDIS',
    'Route Monitoring',
    'Electronic Charts'
  ]),
  deck('oic_nw_c5.csv.enc', 'C5', 'F1', 'Respond to emergencies', [
    'Emergencies',
    'Distress',
    'Contingency Procedures'
  ]),
  deck('oic_nw_c7.csv.enc', 'C7', 'F1', 'Use the IMO SMCP and English', [
    'SMCP',
    'Maritime English',
    'Communications'
  ]),
  deck('oic_nw_c9.csv.enc', 'C9', 'F1', 'Manoeuvre the ship', [
    'Ship Handling',
    'Manoeuvring',
    'Berthing'
  ]),
  deck('oic_nw_c10.csv.enc', 'C10', 'F2', 'Cargo operations – loading, stowage, securing', [
    'Cargo Operations',
    'Stowage & Securing',
    'Care of Cargo'
  ]),
  deck('oic_nw_c11.csv.enc', 'C11', 'F2', 'Inspect and report defects – cargo spaces & ballast', [
    'Cargo Spaces',
    'Hatch Covers',
    'Ballast Tanks'
  ]),
  deck('oic_nw_c12.csv.enc', 'C12', 'F3', 'Ensure compliance with pollution-prevention requirements', [
    'MARPOL',
    'Pollution Prevention'
  ]),
  deck('oic_nw_c13.csv.enc', 'C13', 'F3', 'Maintain seaworthiness of the ship', [
    'Seaworthiness',
    'Stability',
    'Hull Integrity'
  ]),
  deck('oic_nw_c17.csv.enc', 'C17', 'F3', 'Monitor compliance with legislative requirements', [
    'Legislation',
    'STCW',
    'Flag State'
  ]),

  ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((p) =>
    gmdss(
      `c1_part${p}.csv.enc`,
      'C1',
      p,
      'Transmit and receive information using GMDSS subsystems'
    )
  ),
  ...([1, 2] as const).map((p) =>
    gmdss(`c2_part${p}.csv.enc`, 'C2', p, 'Provide radio services in emergencies')
  ),

  ew('ew_c1.csv.enc', 'C1', 'Maintain a safe engineering watch'),
  ew('ew_c2.csv.enc', 'C2', 'Use English in oral and written form'),
  ew('ew_c3.csv.enc', 'C3', 'Use internal communications systems'),
  ew('ew_c4.csv.enc', 'C4', 'Operate main and auxiliary machinery and control systems'),
  ew('ew_c5.csv.enc', 'C5', 'Operate fuel, lubrication, ballast and pumping systems'),
  ew('ew_c6.csv.enc', 'C6', 'Operate electrical, electronic and control systems'),
  ew('ew_c7.csv.enc', 'C7', 'Maintenance and repair of electrical and electronic equipment'),
  ew('ew_c8.csv.enc', 'C8', 'Hand tools, machine tools and measuring instruments'),
  ew('ew_c9.csv.enc', 'C9', 'Maintenance and repair of shipboard machinery and equipment'),
  ew('ew_c10.csv.enc', 'C10', 'Ensure compliance with pollution-prevention requirements'),
  ew('ew_c11.csv.enc', 'C11', 'Maintain seaworthiness of the ship'),
  ew('ew_c15.csv.enc', 'C15', 'Monitor compliance with legislative requirements'),
  ew('ew_c16.csv.enc', 'C16', 'Application of leadership and team working skills'),

  dm('dm_c1.csv.enc', 'C1', 'Plan a voyage and conduct navigation'),
  dm('dm_c2.csv.enc', 'C2', 'Determine position and accuracy of position fix'),
  dm('dm_c3.csv.enc', 'C3', 'Determine and allow for compass errors'),
  dm('dm_c4.csv.enc', 'C4', 'Coordinate search and rescue operations'),
  dm('dm_c5.csv.enc', 'C5', 'Establish watchkeeping arrangements and procedures'),
  dm('dm_c6.csv.enc', 'C6', 'Maintain safe navigation through NAV systems information'),
  dm('dm_c8.csv.enc', 'C8', 'Forecast weather and oceanographic conditions'),
  dm('dm_c9.csv.enc', 'C9', 'Respond to navigational emergencies'),
  dm('dm_c10.csv.enc', 'C10', 'Manoeuvre and handle a ship in all conditions'),
  dm('dm_c11.csv.enc', 'C11', 'Operate remote controls of propulsion plant'),
  dm('dm_c12.csv.enc', 'C12', 'Plan and ensure safe loading, stowage and care of cargoes'),
  dm('dm_c13.csv.enc', 'C13', 'Assess reported defects and damage to cargo spaces'),
  dm('dm_c14.csv.enc', 'C14', 'Carriage of dangerous goods'),
  dm('dm_c15.csv.enc', 'C15', 'Control trim, stability and stress'),
  dm('dm_c16.csv.enc', 'C16', 'Monitor and control compliance with legislative requirements'),
  dm('dm_c17.csv.enc', 'C17', 'Maintain safety and security of the ship’s crew and passengers'),
  dm('dm_c18.csv.enc', 'C18', 'Develop emergency and damage control plans'),
  dm('dm_c20.csv.enc', 'C20', 'Organize and manage medical care on board'),

  em('em_c1.csv.enc', 'C1', 'Manage the operation of propulsion plant machinery'),
  em('em_c2.csv.enc', 'C2', 'Plan and schedule operations'),
  em('em_c3.csv.enc', 'C3', 'Operation and performance assessment of propulsion plant'),
  em('em_c4.csv.enc', 'C4', 'Manage fuel, lubrication and ballast operations'),
  em('em_c5.csv.enc', 'C5', 'Manage operation of electrical and electronic control equipment'),
  em('em_c6.csv.enc', 'C6', 'Troubleshoot electrical and electronic control equipment'),
  em('em_c7.csv.enc', 'C7', 'Manage safe and effective maintenance and repair procedures'),
  em('em_c8.csv.enc', 'C8', 'Detect and identify machinery malfunctions and correct faults'),
  em('em_c9.csv.enc', 'C9', 'Ensure safe working practices'),
  em('em_c10.csv.enc', 'C10', 'Control trim, stability and stress'),
  em('em_c11.csv.enc', 'C11', 'Monitor compliance with legislative requirements and marine environment protection'),
  em('em_c12.csv.enc', 'C12', 'Maintain safety and security of the vessel, crew and passengers'),
  em('em_c13.csv.enc', 'C13', 'Develop emergency and damage control plans'),
  em('em_c14.csv.enc', 'C14', 'Use leadership and managerial skills')
];

type LoadedSource = { questions: Question[]; sampledByServer: boolean };
const cache = new Map<string, LoadedSource>();

export function clearPaidQuestionCache() {
  for (const key of cache.keys()) if (key.endsWith(':full')) cache.delete(key);
}

function mapAnswer(ans: string): number {
  const a = ans.trim().toUpperCase();
  if (a === 'A' || a === '1') return 0;
  if (a === 'B' || a === '2') return 1;
  if (a === 'C' || a === '3') return 2;
  if (a === 'D' || a === '4') return 3;
  if (a === 'E' || a === '5') return 4;
  if (a === 'F' || a === '6') return 5;
  const n = parseInt(a, 10);
  if (!Number.isNaN(n) && n >= 1 && n <= 6) return n - 1;
  return 0;
}

function difficultyForIndex(i: number): Difficulty {
  const m = (i + 1) % 3;
  if (m === 1) return 'EASY';
  if (m === 2) return 'MODERATE';
  return 'DIFFICULT';
}

function findHeaderRow(rows: string[][], format: 'standard' | 'gmdss'): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const joined = rows[i].map((c) => c.trim().toLowerCase()).join('|');
    if (format === 'gmdss') {
      if (joined.includes('question') && joined.includes('option1')) return i;
    } else {
      if (
        (joined.includes('question') && (joined.includes('correct') || joined.includes('|a|'))) ||
        (rows[i][0]?.trim().toLowerCase() === 'no.' &&
          rows[i][1]?.trim().toLowerCase() === 'question')
      ) {
        return i;
      }
    }
  }
  return format === 'gmdss' ? 3 : 0;
}

function parseStandardRows(
  rows: string[][],
  headerIdx: number,
  src: BankSource
): Question[] {
  const list: Question[] = [];
  let validIndex = 1;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 7) continue;

    const qNo = row[0].trim();
    const qText = row[1].trim();
    const optA = row[2].trim();
    const optB = row[3].trim();
    const optC = row[4].trim();
    const optD = row[5].trim();
    const ansStr = row[6].trim();

    const qNoInt = parseInt(qNo, 10);
    const isHeader = qText.toLowerCase() === 'question' || !qText;
    const isDummy = optA === 'A' && optB === 'B' && optC === 'C' && optD === 'D';
    if (!qNoInt || qNoInt <= 0 || isHeader || isDummy) continue;

    const options = [optA, optB, optC, optD].filter((o) => o.length > 0);
    if (!qText || options.length < 2) continue;

    const ansIdx = Math.min(mapAnswer(ansStr), options.length - 1);
    const topic =
      src.topics && src.topics.length > 0
        ? src.topics[(validIndex - 1) % src.topics.length]
        : src.title;
    const explanation = row.length > 7 ? row[7].trim() : '';

    list.push({
      id: `${src.idPrefix}-${String(validIndex).padStart(3, '0')}`,
      track: src.track,
      functionId: src.functionId,
      competenceId: src.competenceId,
      topic,
      questionText: qText,
      options,
      correctAnswerIndex: ansIdx,
      explanation,
      difficulty: difficultyForIndex(validIndex)
    });
    validIndex++;
  }
  return list;
}

function pushGmdssQuestion(
  list: Question[],
  src: BankSource,
  qText: string,
  options: string[],
  explanation: string,
  ansStr: string
) {
  if (!qText || qText.toLowerCase() === 'question' || options.length < 2) return;
  let ansIdx = mapAnswer(ansStr);
  if (ansIdx >= options.length) ansIdx = 0;
  const validIndex = list.length + 1;
  list.push({
    id: `${src.idPrefix}-${String(validIndex).padStart(3, '0')}`,
    track: src.track,
    functionId: src.functionId,
    competenceId: src.competenceId,
    topic: src.title,
    questionText: qText,
    options,
    correctAnswerIndex: ansIdx,
    explanation,
    difficulty: difficultyForIndex(validIndex)
  });
}

function parseGmdssRows(
  rows: string[][],
  headerIdx: number,
  src: BankSource
): Question[] {
  // Columns: Question, Type, Option1..Option6, Explanation, Answer, Point, Section
  const list: Question[] = [];

  // Multi-line files: one question per row after header
  if (rows.length > 3) {
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 10) continue;
      const options = [row[2], row[3], row[4], row[5], row[6], row[7]]
        .map((o) => (o || '').trim())
        .filter((o) => o.length > 0);
      pushGmdssQuestion(
        list,
        src,
        (row[0] || '').trim(),
        options,
        (row[8] || '').trim(),
        (row[9] || '').trim()
      );
    }
  }

  // Single-row / flattened files (common for some GMDSS parts):
  // walk the big row and extract each "…,Choice,opt1..opt6,expl,answer,…" block
  if (list.length === 0 && rows.length > 0) {
    const row = rows.length === 1 ? rows[0] : rows.flat();
    for (let i = 0; i < row.length; i++) {
      if ((row[i] || '').trim().toLowerCase() !== 'choice') continue;
      const start = i - 1; // question text sits just before Type=Choice
      if (start < 0 || start + 9 >= row.length) continue;
      const qText = row[start].trim();
      const options = row
        .slice(start + 2, start + 8)
        .map((o) => (o || '').trim())
        .filter((o) => o.length > 0);
      const explanation = (row[start + 8] || '').trim();
      const ansStr = (row[start + 9] || '').trim();
      pushGmdssQuestion(list, src, qText, options, explanation, ansStr);
    }
  }

  return list;
}

async function loadSource(src: BankSource, freeOnly = false): Promise<LoadedSource> {
  const cacheKey = src.path + (freeOnly ? ':free' : ':full');
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    if (!supabase) throw new Error('Protected question service is not configured.');
    let text = '';
    let sampledByServer = false;
    const response = await supabase.functions.invoke('question-bank', {
      body: { action: 'get', path: src.path, freeOnly }
    });
    if (response.error || !response.data?.text) {
      const status = Number((response.error as { context?: { status?: number } } | null)?.context?.status || 0);
      // Temporary rollout bridge: while the admin copies the 69 assets into private
      // storage, free reviewer can fall back to the old source and sample it locally.
      // Paid/full requests never fall back to a public file.
      if (freeOnly && status === 503) {
        const legacy = await fetch('/questions/' + src.path, { cache: 'no-store' });
        if (!legacy.ok) throw new Error('Question bank migration is not ready yet.');
        text = await decryptToText(await legacy.arrayBuffer());
      } else {
        throw response.error || new Error(response.data?.error || 'Protected question delivery failed.');
      }
    } else {
      text = String(response.data.text);
      sampledByServer = freeOnly && response.data.access === 'free-sample';
    }
    const rows = parseCsvText(text);
    if (rows.length <= 1 && src.format !== 'gmdss') {
      const empty = { questions: [], sampledByServer };
      cache.set(cacheKey, empty);
      return empty;
    }

    const headerIdx = findHeaderRow(rows, src.format);
    const questions = src.format === 'gmdss'
      ? parseGmdssRows(rows, headerIdx, src)
      : parseStandardRows(rows, headerIdx, src);
    const loaded = { questions, sampledByServer };
    cache.set(cacheKey, loaded);
    return loaded;
  } catch (e) {
    console.error('Failed to load protected question bank', src.path, e);
    return { questions: [], sampledByServer: freeOnly };
  }
}

export async function getQuestionsByCompetence(
  track: TrackId,
  competenceId: string,
  part?: number,
  freeOnly = false
): Promise<Question[]> {
  if (freeOnly) {
    const allSources = SOURCES.filter(s => s.track === track);
    const loaded = await Promise.all(allSources.map(src => loadSource(src, true)));
    const allQuestions = loaded.flatMap(item => item.questions);
    const sampled = loaded.every(item => item.sampledByServer) ? allQuestions : freeSample(allQuestions, track);
    return sampled.filter(q => q.competenceId === competenceId &&
      (part == null || (track === 'GMDSS_GOC' && q.id.includes('-P' + part + '-'))));
  }
  const sources = SOURCES.filter(
    (s) => s.track === track && s.competenceId === competenceId &&
      (part == null || (track === 'GMDSS_GOC' && s.path.includes(`part${part}.csv.enc`)))
  );
  const results = await Promise.all(sources.map(src => loadSource(src, false)));
  return results.flatMap(item => item.questions);
}

/** Minimal java.util.Random so the free OIC-NW sample matches the Android app exactly. */
class JavaRandom {
  private seed: bigint;
  private static readonly MASK = (1n << 48n) - 1n;
  constructor(seed: number) {
    this.seed = (BigInt(seed) ^ 0x5deece66dn) & JavaRandom.MASK;
  }
  next(bits: number): number {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & JavaRandom.MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  nextInt(bound: number): number {
    let r = this.next(31);
    const m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    for (let u = r; ((u - (r = u % bound) + m) | 0) < 0; u = this.next(31)) {
      /* retry */
    }
    return r;
  }
}

/** Same as Kotlin shuffled(java.util.Random) = Collections.shuffle(list, rnd). */
function javaShuffle<T>(items: T[], rnd: JavaRandom): T[] {
  const list = items.slice();
  for (let i = list.length; i > 1; i--) {
    const j = rnd.nextInt(i);
    const tmp = list[i - 1];
    list[i - 1] = list[j];
    list[j] = tmp;
  }
  return list;
}

/** OIC-NW free CRP quota per competence (2,065 total), from MaritimeCompetenceRegistry.CRP_DECK_DISTRIBUTION. */
const CRP_DECK_DISTRIBUTION: [string, number][] = [
  ['C1', 420], ['C2', 221], ['C3', 258], ['C4', 160], ['C5', 100], ['C7', 196],
  ['C9', 176], ['C10', 109], ['C11', 96], ['C12', 110], ['C13', 122], ['C17', 97]
];
/** These competences keep their original order (first N); the rest are shuffled with seed 2065. */
const CRP_FIXED_ORDER = new Set(['C17', 'C13', 'C9', 'C10', 'C7']);

/**
 * FREE ACCESS sample, same rules as the Android app. Pass the WHOLE track's questions.
 * - OIC-NW: 2,065 items across 12 competences (fixed seed shuffle, like getMarinaCrpQuestions)
 * - GMDSS: first 900 of C1 and first 130 of C2
 * - Engine EW / Deck Mgt / Engine Mgt: first 40% of each competence, min 1
 */
export function freeSample(list: Question[], track: TrackId): Question[] {
  const byComp = new Map<string, Question[]>();
  for (const q of list) {
    if (!byComp.has(q.competenceId)) byComp.set(q.competenceId, []);
    byComp.get(q.competenceId)!.push(q);
  }

  if (track === 'DECK_OIC_NW') {
    const rnd = new JavaRandom(2065);
    const out: Question[] = [];
    for (const [compId, quota] of CRP_DECK_DISTRIBUTION) {
      const comp = byComp.get(compId) ?? [];
      const picked = CRP_FIXED_ORDER.has(compId) ? comp : javaShuffle(comp, rnd);
      out.push(...picked.slice(0, quota));
    }
    return out;
  }

  if (track === 'GMDSS_GOC') {
    return [...(byComp.get('C1') ?? []).slice(0, 900), ...(byComp.get('C2') ?? []).slice(0, 130)];
  }

  const out: Question[] = [];
  for (const items of byComp.values()) {
    out.push(...items.slice(0, Math.max(1, Math.round(items.length * 0.4))));
  }
  return out;
}

export async function getQuestionsByTrack(track: TrackId, freeOnly = false): Promise<Question[]> {
  const sources = SOURCES.filter((s) => s.track === track);
  const results = await Promise.all(sources.map(src => loadSource(src, freeOnly)));
  const allQuestions = results.flatMap(item => item.questions);
  if (freeOnly && !results.every(item => item.sampledByServer)) return freeSample(allQuestions, track);
  return allQuestions;
}

export function listAvailableCompetences(
  track: TrackId
): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const s of SOURCES) {
    if (s.track !== track) continue;
    if (!seen.has(s.competenceId)) seen.set(s.competenceId, s.title);
  }
  // Natural sort C1, C2, … C10
  return Array.from(seen.entries())
    .sort((a, b) => {
      const na = parseInt(a[0].replace(/\D/g, ''), 10) || 0;
      const nb = parseInt(b[0].replace(/\D/g, ''), 10) || 0;
      return na - nb;
    })
    .map(([id, title]) => ({ id, label: `${id} · ${title}` }));
}

export function listRegisteredSourceCount(): number {
  return SOURCES.length;
}

/** Search questions within a track (loads that track’s banks, then filters). */
export async function searchQuestions(
  track: TrackId,
  query: string,
  limit = 40
): Promise<Question[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = await getQuestionsByTrack(track);
  const hits: Question[] = [];
  for (const item of all) {
    const hay = `${item.questionText} ${item.topic} ${item.competenceId} ${item.options.join(' ')}`.toLowerCase();
    if (hay.includes(q)) {
      hits.push(item);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
