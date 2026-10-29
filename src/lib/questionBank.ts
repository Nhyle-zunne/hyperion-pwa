import { supabase } from './supabase';
import { withPageLoading } from './pageLoading';
import {
  getOfflineEntitlementExpiry,
  getOfflinePackManifest,
  getOfflineQuestionCounts,
  getOfflineQuestionPacks,
  getOfflineQuestionsByCompetence,
  getOfflineQuestionsByTrack,
  recordOfflinePackVersionCheck,
  saveOfflineEntitlements,
  saveOfflineQuestionPackSets
} from './offlineQuestionCache';
import { fingerprintQuestion } from './questionFingerprint.mjs';
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

async function offlineEntitlementExpiry(track: TrackId): Promise<number | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user?.id
    return userId ? getOfflineEntitlementExpiry(userId, track) : null
  } catch {
    return null
  }
}

/**
 * A saved session already contains its encrypted local question snapshot. To resume
 * that snapshot offline, require the server-signed, unexpired lease for the same
 * account and track, but do not require an identical full-bank cache or identical
 * fingerprints from the current question-bank version.
 *
 * Starting NEW offline sessions remains stricter: getCachedCompetenceRange and the
 * question-count path still require an integrity-checked downloaded pack.
 */
async function hasValidOfflineTrackLease(track: TrackId): Promise<boolean> {
  const expiry = await offlineEntitlementExpiry(track)
  return typeof expiry === 'number' && Number.isFinite(expiry) && expiry > Date.now()
}

async function mayUseOfflineTrack(track: TrackId, freeOnly: boolean): Promise<boolean> {
  return freeOnly || (await offlineEntitlementExpiry(track)) !== null
}

function canFallbackToOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const status = Number((error as { context?: { status?: number } } | null)?.context?.status || 0)
  return status === 0 || status >= 500
}

async function getCachedCompetenceRange(
  track: TrackId,
  competenceId: string,
  part: number | undefined,
  freeOnly: boolean,
  startItem: number,
  limit: number | undefined,
  randomSample: boolean
): Promise<Question[]> {
  if (!(await mayUseOfflineTrack(track, freeOnly))) {
    throw new Error('Offline access to this paid track is unavailable or the saved license has expired. Reconnect to verify your subscription.')
  }
  if (freeOnly) await ensureOfflineFreeSamplePack(track)
  const cached = await getOfflineQuestionsByCompetence(track, competenceId, part, freeOnly)
  if (!cached) throw new Error('This question bank is not downloaded for offline use yet. Connect to the internet and download the offline pack from the track page.')
  const offset = Math.max(0, Math.floor(startItem || 1) - 1)
  if (randomSample) return shuffleQuestions(cached).slice(0, limit ?? cached.length)
  return cached.slice(offset, limit == null ? undefined : offset + Math.max(0, Math.floor(limit)))
}

function shuffleQuestions<T>(items: T[]): T[] {
  const values = items.slice()
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[values[i - 1], values[j]] = [values[j], values[i - 1]]
  }
  return values
}

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
      throw response.error || new Error(response.data?.error || 'Protected question delivery failed.');
    }
    text = String(response.data.text);
    sampledByServer = freeOnly && response.data.access === 'free-sample';
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

async function loadQuestionsByCompetenceInternal(
  track: TrackId,
  competenceId: string,
  part?: number,
  freeOnly = false,
  startItem = 1,
  limit?: number,
  randomSample = false
): Promise<Question[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return getCachedCompetenceRange(track, competenceId, part, freeOnly, startItem, limit, randomSample)
  }
  if (!supabase) return getCachedCompetenceRange(track, competenceId, part, freeOnly, startItem, limit, randomSample)
  const firstOffset = Math.max(0, Math.floor(startItem || 1) - 1)
  let totalWanted = limit == null ? 0 : Math.max(0, Math.floor(limit))
  if (limit == null) {
    const counts = await getQuestionCountsByTrack(track, freeOnly)
    const totalAvailable = counts
      .filter(item => item.competenceId === competenceId && (part == null || item.part === part))
      .reduce((sum, item) => sum + item.count, 0)
    totalWanted = Math.max(0, totalAvailable - firstOffset)
  }
  if (totalWanted === 0) return []
  if (randomSample && totalWanted > 200) throw new Error('Random exam samples are limited to 200 questions.')

  const requestPage = async (offset: number, pageLimit: number, random: boolean) => {
    const { data, error } = await supabase!.functions.invoke('question-bank', {
      body: { action: 'questions', track, competenceId, part, freeOnly, offset, limit: pageLimit, randomSample: random }
    })
    if (!error && Array.isArray(data?.questions)) return data.questions as Question[]
    if (error && canFallbackToOffline(error)) {
      try {
        return await getCachedCompetenceRange(track, competenceId, part, freeOnly, random ? 1 : offset + 1, pageLimit, random)
      } catch {
        // Preserve the authoritative online service error if there is no valid offline pack.
      }
    }
    throw error || new Error(data?.error || 'Protected question delivery failed.')
  }

  if (randomSample) return requestPage(0, totalWanted, true)
  const result: Question[] = []
  for (let retrieved = 0; retrieved < totalWanted; retrieved += 200) {
    const pageLimit = Math.min(200, totalWanted - retrieved)
    const page = await requestPage(firstOffset + retrieved, pageLimit, false)
    result.push(...page)
    if (page.length < pageLimit) break
  }
  return result
}

export async function getQuestionsByCompetence(
  track: TrackId,
  competenceId: string,
  part?: number,
  freeOnly = false,
  startItem = 1,
  limit?: number,
  randomSample = false
): Promise<Question[]> {
  return withPageLoading('Loading questions', () =>
    loadQuestionsByCompetenceInternal(track, competenceId, part, freeOnly, startItem, limit, randomSample)
  )
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
    const out: Question[] = [];
    for (const [compId, quota] of CRP_DECK_DISTRIBUTION) {
      const comp = byComp.get(compId) ?? [];
      const picked = CRP_FIXED_ORDER.has(compId)
        ? comp
        : javaShuffle(comp, new JavaRandom(2065 + Number(compId.slice(1)) * 31));
      out.push(...picked.slice(0, quota));
    }
    return out;
  }

  if (track === 'GMDSS_GOC') {
    // Mirror the server's per-source GMDSS quotas exactly: 90 from each C1
    // part and 65 from each C2 part. Slicing the combined competence list could
    // accidentally bias the sample toward whichever part happens to load first.
    const byPart = (competenceId: string, part: number) =>
      (byComp.get(competenceId) ?? []).filter(question => question.id.includes(`-${competenceId}-P${part}-`));
    const sample: Question[] = [];
    for (let part = 1; part <= 10; part++) sample.push(...byPart('C1', part).slice(0, 90));
    for (let part = 1; part <= 2; part++) sample.push(...byPart('C2', part).slice(0, 65));
    return sample;
  }

  const out: Question[] = [];
  for (const items of byComp.values()) {
    out.push(...items.slice(0, Math.max(1, Math.round(items.length * 0.4))));
  }
  return out;
}

/**
 * Repair older Deck OIC-NW free-only packs that were sampled using an outdated
 * shuffle rule. The replacement is derived only from this device's already
 * downloaded full bank, using the same deterministic sample as the server.
 * If the full bank is unavailable, fail closed and ask the user to refresh online.
 */
export async function ensureOfflineFreeSamplePack(track: TrackId): Promise<void> {
  if (track !== 'DECK_OIC_NW' && track !== 'GMDSS_GOC') return;
  const current = await getOfflineQuestionsByTrack(track, true);
  if (current?.length) return;

  const fullBank = await getOfflineQuestionsByTrack(track, false);
  if (!fullBank?.length) return;

  const sample = freeSample(fullBank, track);
  if (!sample.length) return;
  const groups = new Map<string, { competenceId: string; part: number | null; questions: Question[] }>();
  for (const question of sample) {
    const key = question.competenceId;
    const group = groups.get(key) ?? { competenceId: question.competenceId, part: null, questions: [] };
    group.questions.push(question);
    groups.set(key, group);
  }
  await saveOfflineQuestionPackSets([{
    track,
    freeOnly: true,
    groups: Array.from(groups.values())
  }]);
}

async function loadQuestionsByTrackInternal(track: TrackId, freeOnly = false): Promise<Question[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!(await mayUseOfflineTrack(track, freeOnly))) {
      throw new Error('Offline access to this paid track is unavailable or the saved license has expired.')
    }
    if (freeOnly) await ensureOfflineFreeSamplePack(track)
    const cached = await getOfflineQuestionsByTrack(track, freeOnly)
    if (cached) return cached
    throw new Error('Download this question bank for offline use while connected to the internet.')
  }
  if (!freeOnly) {
    if (!(await mayUseOfflineTrack(track, false))) throw new Error('Full-track question preloading is disabled. Select a competence to access paid questions.')
    const cached = await getOfflineQuestionsByTrack(track, false)
    if (cached) return cached
    throw new Error('Full-track question preloading is disabled. Select a competence or download an offline pack.')
  }
  const sources = SOURCES.filter((s) => s.track === track);
  const results = await Promise.all(sources.map(src => loadSource(src, true)));
  const allQuestions = results.flatMap(item => item.questions);
  if (!results.every(item => item.sampledByServer)) return freeSample(allQuestions, track);
  return allQuestions;
}

export async function getQuestionsByTrack(track: TrackId, freeOnly = false): Promise<Question[]> {
  return withPageLoading('Loading question bank', () => loadQuestionsByTrackInternal(track, freeOnly))
}

export interface QuestionBankCount {
  competenceId: string;
  part: number | null;
  count: number;
}

export type QuestionSetAccess = 'admin' | 'licensed' | 'free-sample';

/**
 * Re-authorize locally saved question sets against the current server license.
 * The persisted isFreeSession flag is never trusted on its own; the access tier
 * is returned by the server or verified against the free sample.
 */
export async function authorizeQuestionSetAccess(track: TrackId, questions: Question[]): Promise<QuestionSetAccess | null> {
  if (!questions.length || questions.length > 3000 || questions.some(q => q.track !== track)) return null;
  const fingerprintResults = await Promise.all(questions.map(fingerprintQuestion));
  if (fingerprintResults.some((fingerprint) => fingerprint === null)) return null;
  const fingerprints = fingerprintResults as string[];
  const matchesCachedPack = async (freeOnly: boolean) => {
    const cached = await getOfflineQuestionsByTrack(track, freeOnly)
    if (!cached) return false
    const cachedFingerprints = await Promise.all(cached.map(fingerprintQuestion))
    if (cachedFingerprints.some((fingerprint) => fingerprint === null)) return false
    const allowedFingerprints = new Set(cachedFingerprints as string[])
    return fingerprints.every(fingerprint => allowedFingerprints.has(fingerprint))
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    // Paid access is based on the signed offline lease and the integrity-checked
    // full pack. Saved question fingerprints may be from an older bank version.
    if (await hasValidOfflineTrackLease(track)) return 'licensed'

    // Non-paying users are restricted to the exact downloaded official free sample.
    await ensureOfflineFreeSamplePack(track)
    if (await matchesCachedPack(true)) return 'free-sample'
    return null
  }

  if (supabase) {
    const { data, error } = await supabase.functions.invoke('question-bank', {
      body: { action: 'authorize-session', track, questionIds: questions.map(q => q.id), fingerprints }
    });
    if (!error && data?.allowed === true) {
      if (data.access === 'admin' || data.access === 'licensed' || data.access === 'free-sample') return data.access;
      return null;
    }
    if (!(error && canFallbackToOffline(error))) return null;
  }
  try {
    // Safari/iOS and installed PWAs can report online while the API is unreachable.
    // Prefer already verified local packs after a genuine network/server failure.
    if (await hasValidOfflineTrackLease(track)) return 'licensed'
    await ensureOfflineFreeSamplePack(track)
    if (await matchesCachedPack(true)) return 'free-sample'

    const freeQuestions = await getQuestionsByTrack(track, true);
    const freeFingerprintResults = await Promise.all(freeQuestions.map(fingerprintQuestion));
    if (freeFingerprintResults.some((fingerprint) => fingerprint === null)) return null;
    const freeFingerprints = new Set(freeFingerprintResults as string[]);
    if (fingerprints.every(fingerprint => freeFingerprints.has(fingerprint))) return 'free-sample'
    return null
  } catch {
    return null;
  }
}
export async function authorizeQuestionSet(track: TrackId, questions: Question[]): Promise<boolean> {
  return (await authorizeQuestionSetAccess(track, questions)) !== null;
}

/** Returns question counts only; paid question text stays on the protected question endpoint. */
async function loadQuestionCountsByTrackInternal(track: TrackId, freeOnly = false): Promise<QuestionBankCount[]> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!(await mayUseOfflineTrack(track, freeOnly))) throw new Error('Offline access to this paid track is unavailable or the saved license has expired.')
    if (freeOnly) await ensureOfflineFreeSamplePack(track)
    const cached = await getOfflineQuestionCounts(track, freeOnly)
    if (cached) return cached
    throw new Error('Download this question bank for offline use while connected to the internet.')
  }
  if (!supabase) throw new Error('Protected question service is not configured.');
  const { data, error } = await supabase.functions.invoke('question-bank', {
    body: { action: 'counts', track, freeOnly }
  });
  if (!error && Array.isArray(data?.counts)) {
    return data.counts.map((item: { competenceId: string; part: number | null; count: number }) => ({
      competenceId: String(item.competenceId),
      part: item.part == null ? null : Number(item.part),
      count: Math.max(0, Number(item.count) || 0)
    }));
  }
  if (error && canFallbackToOffline(error) && await mayUseOfflineTrack(track, freeOnly)) {
    const cached = await getOfflineQuestionCounts(track, freeOnly)
    if (cached) return cached
  }
  throw error || new Error(data?.error || 'Could not verify access to paid question metadata.');
}
export async function getQuestionCountsByTrack(track: TrackId, freeOnly = false): Promise<QuestionBankCount[]> {
  return withPageLoading('Loading question counts', () => loadQuestionCountsByTrackInternal(track, freeOnly))
}

interface RemoteQuestionSourceVersion {
  path: string
  competenceId: string
  part: number | null
  fullHash?: string
  freeHash: string
}

interface RemoteQuestionBankVersions {
  track: TrackId
  versions: RemoteQuestionSourceVersion[]
  checkedAt: number
}

export interface OfflinePackUpdateCheck {
  status: 'not-downloaded' | 'current' | 'available' | 'offline' | 'unavailable'
  changedCompetences: string[]
  checkedAt: number | null
  lastKnownState?: 'current' | 'available'
  savedAt?: number
}

async function fetchRemoteQuestionBankVersions(track: TrackId): Promise<RemoteQuestionBankVersions> {
  if (!supabase) throw new Error('Protected question service is not configured.')
  const { data, error } = await supabase.functions.invoke('question-bank', {
    body: { action: 'content-versions', track }
  })
  if (error || data?.track !== track || !Array.isArray(data?.versions)) {
    throw error || new Error(data?.error || 'Question-bank versions are unavailable.')
  }
  const versions = data.versions as RemoteQuestionSourceVersion[]
  if (versions.some(item =>
    typeof item.path !== 'string' ||
    typeof item.competenceId !== 'string' ||
    !(item.part == null || Number.isInteger(item.part)) ||
    typeof item.freeHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.freeHash) ||
    (item.fullHash != null && (typeof item.fullHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.fullHash)))
  )) throw new Error('The server returned invalid question-bank version metadata.')
  return { track, versions, checkedAt: Number(data.checkedAt) || Date.now() }
}

function sourceVersionMap(remote: RemoteQuestionBankVersions, freeOnly: boolean): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const item of remote.versions) {
    const value = freeOnly ? item.freeHash : item.fullHash
    if (typeof value !== 'string') {
      throw new Error('A valid license is required to verify the full question-bank version.')
    }
    versions[item.path] = value
  }
  return versions
}

function changedVersionPaths(previous: Record<string, string>, current: Record<string, string>): string[] {
  const paths = new Set([...Object.keys(previous), ...Object.keys(current)])
  return Array.from(paths).filter(path => previous[path] !== current[path]).sort()
}

function describeChangedCompetences(paths: string[]): string[] {
  const labels = new Set<string>()
  for (const path of paths) {
    const source = SOURCES.find(item => item.path === path)
    if (!source) {
      labels.add(path)
      continue
    }
    labels.add(source.track === 'GMDSS_GOC' && /_part\d+/.test(path)
      ? `${source.competenceId} · Part ${path.match(/_part(\d+)/)?.[1] ?? ''}`.trim()
      : source.competenceId)
  }
  return Array.from(labels).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  )
}

async function hashQuestionListForVersion(questions: Question[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(questions))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
}

async function compareLegacyPackToCurrent(
  track: TrackId,
  freeOnly: boolean,
  packs: Awaited<ReturnType<typeof getOfflineQuestionPacks>>,
  remote: RemoteQuestionBankVersions
): Promise<string[]> {
  if (!packs) return remote.versions.map(item => item.path)
  const mismatches: string[] = []
  for (const remoteSource of remote.versions) {
    const source = SOURCES.find(item => item.path === remoteSource.path && item.track === track)
    if (!source) {
      mismatches.push(remoteSource.path)
      continue
    }
    const localPack = packs.find(pack =>
      pack.competenceId === source.competenceId &&
      (pack.part ?? null) === (source.track === 'GMDSS_GOC' ? remoteSource.part : null)
    )
    const localQuestions = localPack?.questions ?? []
    const localHash = await hashQuestionListForVersion(localQuestions)
    const expectedHash = freeOnly ? remoteSource.freeHash : remoteSource.fullHash
    if (typeof expectedHash !== 'string' || localHash !== expectedHash) mismatches.push(remoteSource.path)
  }
  return mismatches
}

/**
 * Compare the downloaded version for each source file with the latest protected
 * bank. Existing packs without version metadata are checked against the actual
 * local question lists first, so unchanged legacy downloads can be marked current
 * without forcing a needless full re-download.
 */
export async function checkOfflineQuestionPackUpdates(
  track: TrackId,
  freeOnly: boolean
): Promise<OfflinePackUpdateCheck> {
  const manifest = await getOfflinePackManifest(track, freeOnly)
  if (!manifest?.complete) {
    return { status: 'not-downloaded', changedCompetences: [], checkedAt: null }
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const knownPaths = manifest.availableSources ?? []
    return {
      status: 'offline',
      changedCompetences: describeChangedCompetences(knownPaths),
      checkedAt: manifest.lastCheckedAt ?? null,
      lastKnownState: manifest.lastKnownUpdateState,
      savedAt: manifest.savedAt
    }
  }

  try {
    const remote = await fetchRemoteQuestionBankVersions(track)
    const currentVersions = sourceVersionMap(remote, freeOnly)
    let changedPaths: string[] = []

    if (manifest.sourceVersions && Object.keys(manifest.sourceVersions).length) {
      changedPaths = changedVersionPaths(manifest.sourceVersions, currentVersions)
    } else {
      const localPacks = await getOfflineQuestionPacks(track, freeOnly)
      changedPaths = await compareLegacyPackToCurrent(track, freeOnly, localPacks, remote)
    }

    const checkedAt = Date.now()
    const state = changedPaths.length ? 'available' : 'current'
    await recordOfflinePackVersionCheck(track, freeOnly, {
      checkedAt,
      state,
      ...(state === 'current' ? { sourceVersions: currentVersions } : {}),
      availableSources: changedPaths
    })
    return {
      status: state,
      changedCompetences: describeChangedCompetences(changedPaths),
      checkedAt,
      lastKnownState: state,
      savedAt: manifest.savedAt
    }
  } catch {
    return {
      status: 'unavailable',
      changedCompetences: describeChangedCompetences(manifest.availableSources ?? []),
      checkedAt: manifest.lastCheckedAt ?? null,
      lastKnownState: manifest.lastKnownUpdateState,
      savedAt: manifest.savedAt
    }
  }
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

async function loadFlashcardQuestionsInternal(track: TrackId, competenceId?: string, limit = 20): Promise<Question[]> {
  if (!supabase) throw new Error('Protected question service is not configured.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!(await offlineEntitlementExpiry(track))) throw new Error('An active offline license is required for flashcards.')
    const local = (await getOfflineQuestionsByTrack(track, false)) ?? []
    if (!local.length) throw new Error('Download the full question bank for this track before using flashcards offline.')
    const scoped = competenceId ? local.filter(question => question.competenceId === competenceId) : local
    return shuffleQuestions(scoped).slice(0, Math.max(1, Math.min(30, limit)))
  }
  const { data, error } = await supabase.functions.invoke('question-bank', {
    body: { action: 'flashcards', track, competenceId, limit: Math.max(1, Math.min(30, limit)) }
  });
  if (error || !Array.isArray(data?.questions)) {
    if (error && canFallbackToOffline(error) && await offlineEntitlementExpiry(track)) {
      const local = (await getOfflineQuestionsByTrack(track, false)) ?? []
      const scoped = competenceId ? local.filter(question => question.competenceId === competenceId) : local
      if (local.length) return shuffleQuestions(scoped).slice(0, Math.max(1, Math.min(30, limit)))
      throw new Error('Download the full question bank for this track before using flashcards offline.')
    }
    throw error || new Error(data?.error || 'Flashcards are unavailable.');
  }
  return data.questions as Question[];
}


export async function getFlashcardQuestions(track: TrackId, competenceId?: string, limit = 20): Promise<Question[]> {
  return withPageLoading('Loading flashcards', () => loadFlashcardQuestionsInternal(track, competenceId, limit))
}


async function requestPersistentStorageIfSupported(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
      // Browsers may deny this request or not implement it; never block a download.
      await navigator.storage.persist()
    }
  } catch {
    // Persistence is best effort; pack integrity checks still detect eviction.
  }
}

async function downloadOfflinePackInternal(
  track: TrackId,
  freeOnly: boolean,
  onProgress?: (downloaded: number, total: number) => void
): Promise<{ questionCount: number; groupCount: number }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connect to the internet before downloading an offline pack.')
  if (!supabase) throw new Error('Protected question service is not configured.')
  await requestPersistentStorageIfSupported()

  // Capture the bank fingerprint before downloading. We verify it again after all
  // pages finish so a publication during a download cannot be labelled current.
  const versionsBefore = await fetchRemoteQuestionBankVersions(track)
  const fullVersionsBefore = freeOnly ? null : sourceVersionMap(versionsBefore, false)
  const freeVersionsBefore = sourceVersionMap(versionsBefore, true)

  // Asking the protected counts endpoint is also the authorization gate for paid packs.
  const counts = await getQuestionCountsByTrack(track, freeOnly)
  const totalExpected = counts.reduce((sum, item) => sum + item.count, 0)
  if (!counts.length || totalExpected <= 0) throw new Error('No questions are available to download for this track.')

  // A paid offline pack is only useful if this same device has a current,
  // server-signed offline entitlement lease. Acquire and verify it before marking
  // the existing pack incomplete, so a lease failure does not damage a previous pack.
  if (!freeOnly) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    const userId = sessionData.session?.user?.id
    if (sessionError || !userId) {
      throw new Error('Sign in again before preparing a licensed offline pack.')
    }
    const { data: offlineLicense, error: offlineLicenseError } = await supabase.functions.invoke('question-bank', {
      body: { action: 'offline-license' }
    })
    if (offlineLicenseError || typeof offlineLicense?.token !== 'string') {
      throw new Error('Your questions were not prepared for offline access because the secure license could not be verified. Reconnect and retry.')
    }
    const savedLease = await saveOfflineEntitlements(userId, offlineLicense.token)
    const expiry = savedLease ? await getOfflineEntitlementExpiry(userId, track) : null
    if (!expiry) {
      throw new Error('Your questions were not prepared for offline access because this device could not verify the track license. Reconnect and retry.')
    }
  }

  // Keep any existing complete pack usable until the entire replacement has
  // downloaded, passed count checks, been encrypted, and can be committed atomically.
  let downloaded = 0
  const allQuestions: Question[] = []
  const writtenGroups: { competenceId: string; part: number | null; questions: Question[] }[] = []

  for (const group of counts) {
    // Some banks can include a registered competence with no published questions.
    // Do not create empty pack records for those entries.
    if (group.count <= 0) continue
    const questions: Question[] = []
    for (let offset = 0; offset < group.count; offset += 200) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connection lost. Reconnect and retry the offline download.')
      const pageLimit = Math.min(200, group.count - offset)
      const { data, error } = await supabase.functions.invoke('question-bank', {
        body: {
          action: 'questions', track, competenceId: group.competenceId, part: group.part,
          freeOnly, offset, limit: pageLimit, randomSample: false
        }
      })
      if (error || !Array.isArray(data?.questions)) throw error || new Error(data?.error || 'The offline question download failed.')
      const page = data.questions as Question[]
      if (!page.length) throw new Error('The server returned an incomplete question pack. Retry while online.')
      questions.push(...page)
      downloaded += page.length
      onProgress?.(Math.min(downloaded, totalExpected), totalExpected)
      if (page.length < pageLimit && offset + page.length < group.count) {
        throw new Error('The server returned fewer questions than expected. No complete offline pack was marked ready.')
      }
    }
    writtenGroups.push({ competenceId: group.competenceId, part: group.part, questions })
    allQuestions.push(...questions)
  }

  if (downloaded !== totalExpected) throw new Error(`Downloaded ${downloaded} of ${totalExpected} expected questions. Retry while online.`)
  // Ensure the bank did not change while pages were being downloaded.
  const versionsAfter = await fetchRemoteQuestionBankVersions(track)
  const freeVersionsAfter = sourceVersionMap(versionsAfter, true)
  if (changedVersionPaths(freeVersionsBefore, freeVersionsAfter).length > 0) {
    throw new Error('The question bank changed while downloading. Your previous offline pack is safe; please retry the update.')
  }
  let fullVersionsAfter: Record<string, string> | null = null
  if (!freeOnly) {
    if (!fullVersionsBefore) throw new Error('Could not verify the full question-bank version.')
    fullVersionsAfter = sourceVersionMap(versionsAfter, false)
    if (changedVersionPaths(fullVersionsBefore, fullVersionsAfter).length > 0) {
      throw new Error('The question bank changed while downloading. Your previous offline pack is safe; please retry the update.')
    }
  }

  const updates: {
    track: TrackId
    freeOnly: boolean
    groups: { competenceId: string; part: number | null; questions: Question[] }[]
    sourceVersions: Record<string, string>
  }[] = [{
    track,
    freeOnly,
    groups: writtenGroups,
    sourceVersions: freeOnly ? freeVersionsBefore : fullVersionsBefore!
  }]

  if (!freeOnly) {
    // Keep the free reviewer available if this subscription expires while the device is offline.
    const samples = freeSample(allQuestions, track)
    const sampleGroups = new Map<string, { competenceId: string; part: number | null; questions: Question[] }>()
    for (const question of samples) {
      const part = question.id.match(/-P(\d+)-/)?.[1]
      const key = `${question.competenceId}:${part ?? ''}`
      const existing = sampleGroups.get(key) ?? { competenceId: question.competenceId, part: part ? Number(part) : null, questions: [] }
      existing.questions.push(question)
      sampleGroups.set(key, existing)
    }
    if (!samples.length || !sampleGroups.size) throw new Error('The free reviewer sample could not be prepared. Your previous offline packs are unchanged.')
    updates.push({
      track,
      freeOnly: true,
      groups: Array.from(sampleGroups.values()),
      sourceVersions: freeVersionsBefore
    })
  }

  await saveOfflineQuestionPackSets(updates)
  return { questionCount: allQuestions.length, groupCount: writtenGroups.length }
}

export async function downloadOfflinePack(
  track: TrackId,
  freeOnly: boolean,
  onProgress?: (downloaded: number, total: number) => void
): Promise<{ questionCount: number; groupCount: number }> {
  return withPageLoading('Downloading question pack', () => downloadOfflinePackInternal(track, freeOnly, onProgress))
}

/** Search within a track on the server and return only the limited matching results. */
async function searchQuestionsInternal(
  track: TrackId,
  query: string,
  limit = 40
): Promise<Question[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (!supabase) throw new Error('Protected question service is not configured.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!(await offlineEntitlementExpiry(track))) throw new Error('An active offline license is required for question search.')
    const cached = (await getOfflineQuestionsByTrack(track, false)) ?? []
    if (!cached.length) throw new Error('Download the full question bank for this track before using Search offline.')
    return cached.filter(question =>
      (question.questionText + ' ' + question.topic + ' ' + question.competenceId + ' ' + question.options.join(' '))
        .toLowerCase().includes(q.toLowerCase())
    ).slice(0, Math.max(1, Math.min(40, limit)))
  }
  const { data, error } = await supabase.functions.invoke('question-bank', {
    body: { action: 'search', track, query: q, limit: Math.max(1, Math.min(40, limit)) }
  });
  if (error || !Array.isArray(data?.questions)) {
    if (error && canFallbackToOffline(error) && await offlineEntitlementExpiry(track)) {
      const cached = (await getOfflineQuestionsByTrack(track, false)) ?? []
      const hits = cached.filter(question =>
        (question.questionText + ' ' + question.topic + ' ' + question.competenceId + ' ' + question.options.join(' '))
          .toLowerCase().includes(q.toLowerCase())
      )
      if (cached.length) return hits.slice(0, Math.max(1, Math.min(40, limit)))
    }
    throw error || new Error(data?.error || 'Question search is unavailable.');
  }
  return data.questions as Question[];
}


export async function searchQuestions(track: TrackId, query: string, limit = 40): Promise<Question[]> {
  if (query.trim().length < 2) return []
  return withPageLoading('Searching questions', () => searchQuestionsInternal(track, query, limit))
}
