import { supabase, supabaseAnonKey } from './supabase';
import { invokeBankTransport } from './questionBankTransport';
import { withPageLoading } from './pageLoading';
import {
  getCachedOfflineEntitlementSnapshot,
  getOfflinePackManifest,
  getOfflineQuestionCounts,
  getOfflineQuestionPacks,
  getOfflinePackStatus,
  getOfflineQuestionsByCompetence,
  getOfflineQuestionsByTrack,
  recordOfflinePackVersionCheck,
  saveOfflineEntitlements,
  saveOfflineQuestionPackSets
} from './offlineQuestionCache';
import { fingerprintQuestion } from './questionFingerprint.mjs';
import { planSmartBankReuse } from './smartBankDownloadPlan.mjs';
import { parseCsvText } from './csvParser';
import { hasQuestionPrompt, parseQuestionImageRefsFromCsv } from './questionMedia';
import { preloadQuestionImages } from './questionMediaCache';
import type { Question, TrackId, Difficulty } from '../types/question';
import { activeToPublishedC10Position, requiresC10ActivePositionMapping, selectActiveQuestions, visibleCompetenceCount } from './retiredQuestions';


/** Bulk question bytes come from the GitHub-backed Worker; account data stays in Supabase. */
async function invokeQuestionBank(options: { body: Record<string, unknown> }) {
  return invokeBankTransport(options, supabase, supabaseAnonKey,
    import.meta.env.PROD && import.meta.env.VITE_QUESTION_BANK_DELIVERY === 'github')
}


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
const ONLINE_QUESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const onlineQuestionPageCache = new Map<string, { questions: Question[]; cachedAt: number; bankRevision?: string }>();
const onlineQuestionCountsCache = new Map<string, { counts: QuestionBankCount[]; cachedAt: number }>();

function clearOnlineQuestionCacheForTrack(track: TrackId, includeFree = true) {
  // Also discard the parsed per-source cache. Otherwise an admin publication could
  // be detected correctly while an already-loaded free/full source remained stale
  // in this browser until its page was reloaded.
  for (const key of cache.keys()) {
    const isFreeSource = key.endsWith(':free')
    const path = isFreeSource ? key.slice(0, -':free'.length) : key
    const source = SOURCES.find(item => item.path === path)
    if (source?.track === track && (includeFree || !isFreeSource)) cache.delete(key)
  }
  for (const key of onlineQuestionPageCache.keys()) {
    if (key.startsWith(`${track}:`) && (includeFree || key.startsWith(`${track}:full:`))) {
      onlineQuestionPageCache.delete(key);
    }
  }
  for (const key of onlineQuestionCountsCache.keys()) {
    if (key.startsWith(`${track}:`) && (includeFree || key.endsWith(':full'))) {
      onlineQuestionCountsCache.delete(key);
    }
  }
}

/**
 * Verify the account-bound signed offline grant. Paid tracks require their real
 * unexpired track entitlement; a server-signed administrator role grants all
 * tracks without inventing a subscription expiry.
 */
async function hasValidOfflineTrackLease(track: TrackId, expectedUserId?: string): Promise<boolean> {
  try {
    const snapshot = await getCachedOfflineEntitlementSnapshot()
    if (!snapshot || (expectedUserId && snapshot.userId !== expectedUserId)) return false
    if (snapshot.isAdmin) return true
    const expiry = snapshot.trackExpiries[track]
    return typeof expiry === 'number' && Number.isFinite(expiry) && expiry > 0
  } catch {
    return false
  }
}

/**
 * Starting new offline sessions still requires an integrity-checked downloaded pack.
 */
async function mayUseOfflineTrack(track: TrackId, freeOnly: boolean): Promise<boolean> {
  // Free packs contain only the public server-selected sample; paid packs still
  // require an unexpired signed offline lease for the exact track.
  return freeOnly || hasValidOfflineTrackLease(track)
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
  for (const key of onlineQuestionPageCache.keys()) if (key.includes(':full:')) onlineQuestionPageCache.delete(key);
  for (const key of onlineQuestionCountsCache.keys()) if (key.endsWith(':full')) onlineQuestionCountsCache.delete(key);
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
  const statusIndex = (rows[headerIdx] || []).findIndex(cell => cell.trim().toUpperCase() === 'HYPERION_STATUS');
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

    const imageAttachments = parseQuestionImageRefsFromCsv(rows[headerIdx] || [], row);
    const qNoInt = parseInt(qNo, 10);
    const isHeader = qText.toLowerCase() === 'question';
    const isDummy = optA === 'A' && optB === 'B' && optC === 'C' && optD === 'D';
    if (!qNoInt || qNoInt <= 0 || isHeader || (isDummy && !!qText)) continue;

    const options = [optA, optB, optC, optD].filter((o) => o.length > 0);
    if (!hasQuestionPrompt(qText, imageAttachments) || options.length < 2) continue;

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
      ...(imageAttachments.length ? { imageAttachments } : {}),
      ...(statusIndex >= 0 && (row[statusIndex] || '').trim().toUpperCase() === 'RETIRED' ? { isRetired: true } : {}),
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
  ansStr: string,
  isRetired = false,
  imageAttachments = [] as Question['imageAttachments']
) {
  if (!hasQuestionPrompt(qText, imageAttachments) || qText.toLowerCase() === 'question' || options.length < 2) return;
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
    ...(imageAttachments?.length ? { imageAttachments } : {}),
    ...(isRetired ? { isRetired: true } : {}),
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
  const statusIndex = (rows[headerIdx] || []).findIndex(cell => cell.trim().toUpperCase() === 'HYPERION_STATUS');

  // Multi-line files: one question per row after header
  if (rows.length > 3 || (rows[headerIdx] || []).some(cell => cell.trim().toLowerCase() === 'option1')) {
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
        (row[9] || '').trim(),
        statusIndex >= 0 && (row[statusIndex] || '').trim().toUpperCase() === 'RETIRED',
        parseQuestionImageRefsFromCsv(rows[headerIdx] || [], row)
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

async function loadFreeTrackSourcesByBatch(
  track: TrackId,
  sources: BankSource[]
): Promise<LoadedSource[]> {
  const missing = sources.filter(source => !cache.has(source.path + ':free'))
  if (missing.length) {
    if (!supabase) throw new Error('Protected question service is not configured.')
    const { data, error } = await invokeQuestionBank({
      body: { action: 'free-track-files', track, paths: missing.map(source => source.path) }
    })
    if (error || data?.track !== track || data?.access !== 'free-sample' || !Array.isArray(data?.files)) {
      throw error || new Error(data?.error || 'The protected free question sample could not be loaded.')
    }

    const files = new Map<string, string>()
    for (const item of data.files as unknown[]) {
      if (
        !item || typeof item !== 'object' ||
        typeof (item as { path?: unknown }).path !== 'string' ||
        typeof (item as { text?: unknown }).text !== 'string'
      ) throw new Error('The server returned an invalid free question file.')
      const path = (item as { path: string }).path
      if (!missing.some(source => source.path === path) || files.has(path)) {
        throw new Error('The server returned an unexpected or duplicate free question file.')
      }
      files.set(path, (item as { text: string }).text)
    }
    if (files.size !== missing.length) throw new Error('The server returned an incomplete free question sample.')

    for (const source of missing) {
      const text = files.get(source.path)
      if (typeof text !== 'string') throw new Error('A free question file was missing from the server response.')
      const rows = parseCsvText(text)
      let loaded: LoadedSource
      if (rows.length <= 1 && source.format !== 'gmdss') {
        loaded = { questions: [], sampledByServer: true }
      } else {
        const headerIdx = findHeaderRow(rows, source.format)
        const questions = source.format === 'gmdss'
          ? parseGmdssRows(rows, headerIdx, source)
          : parseStandardRows(rows, headerIdx, source)
        loaded = { questions, sampledByServer: true }
      }
      cache.set(source.path + ':free', loaded)
    }
  }

  return sources.map(source => cache.get(source.path + ':free') ?? {
    questions: [],
    sampledByServer: false
  })
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
  // If this device already has a verified, up-to-date offline pack, use it while
  // online too. The previous path fetched the same questions from Edge Functions
  // every time a competence was opened, despite a complete local copy being present.
  const cachedCurrent = await getCurrentCachedCompetenceRange(
    track, competenceId, part, freeOnly, startItem, limit, randomSample
  )
  if (cachedCurrent) return cachedCurrent
  if (!supabase && !(freeOnly && import.meta.env.PROD && import.meta.env.VITE_QUESTION_BANK_DELIVERY === 'github')) return getCachedCompetenceRange(track, competenceId, part, freeOnly, startItem, limit, randomSample)
  const firstOffset = Math.max(0, Math.floor(startItem || 1) - 1)
  let rangeRevision: string | undefined
  let totalWanted = limit == null ? 0 : Math.max(0, Math.floor(limit))
  if (limit == null) {
    const snapshotCounts = await fetchRevisionQuestionCounts(track, freeOnly)
    const counts = snapshotCounts.counts
    rangeRevision = snapshotCounts.bankRevision
    const totalAvailable = counts
      .filter(item => item.competenceId === competenceId && (part == null || item.part === part))
      .reduce((sum, item) => sum + item.count, 0)
    totalWanted = Math.max(0, totalAvailable - firstOffset)
  }
  if (totalWanted === 0) return []
  if (randomSample && totalWanted > 200) throw new Error('Random exam samples are limited to 200 questions.')

  const requestPage = async (offset: number, pageLimit: number, random: boolean) => {
    const pageCacheKey = `${track}:${freeOnly ? 'free' : 'full'}:${rangeRevision ?? 'latest'}:${competenceId}:${part ?? ''}:${offset}:${pageLimit}`
    if (!random) {
      const cached = onlineQuestionPageCache.get(pageCacheKey)
      if (cached && Date.now() - cached.cachedAt < ONLINE_QUESTION_CACHE_TTL_MS) {
        onlineQuestionPageCache.delete(pageCacheKey)
        onlineQuestionPageCache.set(pageCacheKey, cached)
        rangeRevision = cached.bankRevision || rangeRevision
        return cached.questions.slice()
      }
    }
    const { data, error } = await invokeQuestionBank({
      body: { action: 'questions', track, competenceId, part, freeOnly, offset, limit: pageLimit, randomSample: random, bankRevision: rangeRevision }
    })
    if (!error && Array.isArray(data?.questions)) {
      if (rangeRevision && data.bankRevision && data.bankRevision !== rangeRevision) throw new Error('The question bank changed while loading. Reload this question set.')
      rangeRevision = typeof data.bankRevision === 'string' ? data.bankRevision : rangeRevision
      const questions = data.questions as Question[]
      if (!random) {
        if (onlineQuestionPageCache.size >= 40) {
          const oldestKey = onlineQuestionPageCache.keys().next().value
          if (oldestKey) onlineQuestionPageCache.delete(oldestKey)
        }
        onlineQuestionPageCache.set(pageCacheKey, { questions, cachedAt: Date.now(), bankRevision: rangeRevision })
      }
      return questions.slice()
    }
    if (error && canFallbackToOffline(error)) {
      if (rangeRevision || totalWanted > pageLimit) throw new Error('Connection changed while loading the question set. Your offline pack is preserved; restart this session to use it consistently.')
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
  return withPageLoading('Loading questions', async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Offline packs keep every historic row. Slice only after applying the
      // retirement view, never mutate persisted bookmark or session records.
      const full = await loadQuestionsByCompetenceInternal(track, competenceId, part, freeOnly, 1, undefined, false)
      const active = selectActiveQuestions(full)
      const start = Math.max(0, Math.floor(startItem || 1) - 1)
      return randomSample ? shuffleQuestions(active).slice(0, Math.max(1, Math.floor(limit ?? 200)))
        : active.slice(start, limit == null ? undefined : start + Math.max(0, Math.floor(limit)))
    }
    // Read only public catalog metadata for the immutable GitHub revision. The
    // retired numbers are original physical offsets, not new question IDs.
    const snapshot = await fetchRevisionQuestionCounts(track, freeOnly)
    const groups = snapshot.counts.filter(item => item.competenceId === competenceId && (part == null || item.part === part))
      .sort((a, b) => (a.part ?? 0) - (b.part ?? 0))
    const physicalCount = groups.reduce((sum, group) => sum + (group.rawCount ?? group.count), 0)
    let physicalOffset = 0
    const retiredPositions = groups.flatMap(group => {
      const positions = (group.retiredPositions || []).map(number => number + physicalOffset)
      physicalOffset += group.rawCount ?? group.count
      return positions
    }).sort((a, b) => a - b)
    if (retiredPositions.length) {
      const physicalPosition = (activePosition: number) => {
        let physical = activePosition
        for (const retired of retiredPositions) if (retired <= physical) physical++
        return physical
      }
      if (randomSample) {
        const full = await loadQuestionsByCompetenceInternal(
          track, competenceId, part, freeOnly, 1, physicalCount, false
        )
        return shuffleQuestions(selectActiveQuestions(full)).slice(0, Math.max(1, Math.floor(limit ?? 200)))
      }
      const activeStart = Math.max(1, Math.floor(startItem || 1))
      const originalStart = physicalPosition(activeStart)
      const requested = limit == null
        ? Math.max(0, physicalCount - retiredPositions.length - activeStart + 1)
        : Math.max(0, Math.floor(limit))
      if (requested === 0 || originalStart > physicalCount) return []
      const originalEnd = Math.min(physicalCount, physicalPosition(activeStart + requested - 1))
      const published = await loadQuestionsByCompetenceInternal(
        track, competenceId, part, freeOnly, originalStart, originalEnd - originalStart + 1, false
      )
      return selectActiveQuestions(published).slice(0, requested)
    }
    if (requiresC10ActivePositionMapping(track, competenceId, freeOnly)) {
      // The encrypted bank retains all 416 historical IDs, including retired
      // ones. Translate active positions to published offsets *before* paging.
      // Filtering only after each page would silently shorten Quick Scan pages
      // and leave gaps in user-selected practice ranges.
      if (randomSample) {
        const full = await loadQuestionsByCompetenceInternal(
          track, competenceId, part, false, 1, undefined, false
        )
        return shuffleQuestions(selectActiveQuestions(full))
          .slice(0, Math.max(1, Math.floor(limit ?? 200)))
      }
      const activeStart = Math.max(1, Math.floor(startItem || 1))
      const publishedStart = activeToPublishedC10Position(activeStart)
      const requested = limit == null ? undefined : Math.max(0, Math.floor(limit))
      if (requested === 0) return []
      const publishedEnd = requested == null
        ? undefined
        : activeToPublishedC10Position(activeStart + requested - 1)
      const physicalLimit = publishedEnd == null
        ? undefined
        : publishedEnd - publishedStart + 1
      const published = await loadQuestionsByCompetenceInternal(
        track, competenceId, part, false, publishedStart, physicalLimit, false
      )
      return selectActiveQuestions(published).slice(0, requested)
    }
    const published = await loadQuestionsByCompetenceInternal(
      track, competenceId, part, freeOnly, startItem, limit, randomSample
    )
    return selectActiveQuestions(published)
  })
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
      // The server assigns IDs after sampling, so re-number the locally generated
      // sample in the same order. Otherwise a freshly downloaded full bank would
      // create a free pack whose questions match but whose hashes always differ.
      out.push(...picked.slice(0, quota).map((question, index) => ({
        ...question,
        id: question.id.replace(/-\d+$/, '-' + String(index + 1).padStart(3, '0'))
      })));
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
  // A current manifest proves all expected encrypted groups exist and are intact
  // at the metadata level. Avoid decrypting the whole free bank on every question.
  const status = await getOfflinePackStatus(track, true);
  if (status?.complete && status.sampleVersion === 2) return;

  const fullBank = await getOfflineQuestionsByTrack(track, false);
  if (!fullBank?.length) return;

  const sample = freeSample(fullBank, track);
  if (!sample.length) return;
  const groups = new Map<string, { competenceId: string; part: number | null; questions: Question[] }>();
  for (const question of sample) {
    const part = track === 'GMDSS_GOC' ? Number(question.id.match(/-P(\d+)-/)?.[1] ?? 0) : null;
    const key = `${question.competenceId}:${part ?? ''}`;
    const group = groups.get(key) ?? { competenceId: question.competenceId, part, questions: [] };
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
  // Never download every free source file for an unlicensed caller.
  // Free Reviewer uses the per-competence online, paginated question endpoint.
  if (!(await hasValidOfflineTrackLease(track))) {
    throw new Error('Free reviewing is online-only. Open a Free Reviewer competence to load the selected questions; offline and bulk downloads require a licensed track.')
  }
  // A licensed track may reuse its previously downloaded official free sample.
  if (await hasFreshCurrentOfflinePack(track, true)) {
    const cached = await getOfflineQuestionsByTrack(track, true)
    if (cached) return cached
  }

  const sources = SOURCES.filter((source) => source.track === track)
  const results = await loadFreeTrackSourcesByBatch(track, sources)
  const allQuestions = results.flatMap(item => item.questions)
  if (!results.every(item => item.sampledByServer)) return freeSample(allQuestions, track)
  return allQuestions
}

export async function getQuestionsByTrack(track: TrackId, freeOnly = false): Promise<Question[]> {
  return withPageLoading('Loading question bank', async () =>
    selectActiveQuestions(await loadQuestionsByTrackInternal(track, freeOnly)))
}

export interface QuestionBankCount {
  competenceId: string;
  part: number | null;
  count: number;
  rawCount?: number;
  retiredPositions?: number[];
}

export type QuestionSetAccess = 'admin' | 'licensed' | 'free-sample';

/**
 * Re-authorize locally saved question sets against the current server license.
 * The persisted isFreeSession flag is never trusted on its own; the access tier
 * is returned by the server or verified against the free sample.
 */
async function matchesSavedFreeQuestionSet(track: TrackId, questions: Question[], fingerprints: string[]): Promise<boolean> {
  const free = await getOfflineQuestionsByTrack(track, true)
  if (!free?.length) return false
  const allowed = new Map(free.map(question => [question.id, question]))
  for (let i = 0; i < questions.length; i++) {
    const published = allowed.get(questions[i].id)
    if (!published || await fingerprintQuestion(published) !== fingerprints[i]) return false
  }
  return true
}

export async function authorizeQuestionSetAccess(track: TrackId, questions: Question[]): Promise<QuestionSetAccess | null> {
  if (!questions.length || questions.length > 3000 || questions.some(q => q.track !== track)) return null;

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  // The signed local lease is the quickest and authoritative offline gate for a
  // paid saved session. Check it before hashing hundreds of saved questions.
  if (offline && await hasValidOfflineTrackLease(track)) return 'licensed';

  const fingerprintResults = await Promise.all(questions.map(fingerprintQuestion));
  if (fingerprintResults.some((fingerprint) => fingerprint === null)) return null;
  const fingerprints = fingerprintResults as string[];


  if (offline) return await matchesSavedFreeQuestionSet(track, questions, fingerprints) ? 'free-sample' : null
  // The local public pack also authorizes free sessions without a Supabase call.
  if (await matchesSavedFreeQuestionSet(track, questions, fingerprints)) return 'free-sample'

  if (supabase) {
    const { data, error } = await invokeQuestionBank({
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
    // Prefer the local signed lease after a genuine network/server failure.
    if (await hasValidOfflineTrackLease(track)) return 'licensed'
    // Never bulk-fetch every free CSV as an authentication fallback. Free
    // sessions are authorized by the live service and consume no background
    // question-bank download traffic if that service is unavailable.
    return null
  } catch {
    return null;
  }
}
export async function authorizeQuestionSet(track: TrackId, questions: Question[]): Promise<boolean> {
  return (await authorizeQuestionSetAccess(track, questions)) !== null;
}

/** Fresh counts for a single immutable release; never substitute an older offline/cache count. */
async function fetchRevisionQuestionCounts(track: TrackId, freeOnly: boolean, bankRevision?: string): Promise<{ counts: QuestionBankCount[]; bankRevision?: string }> {
  const { data, error } = await invokeQuestionBank({ body: { action: 'counts', track, freeOnly, bankRevision } })
  if (error || !Array.isArray(data?.counts)) throw error || new Error('Fresh question counts are unavailable.')
  if (bankRevision && data.bankRevision !== bankRevision) throw new Error('The question-bank release changed while checking counts. Retry shortly.')
  const counts: QuestionBankCount[] = data.counts.map((item: { competenceId: string; part: number | null; count: number; rawCount?: number; retiredPositions?: number[] }) => {
    if (!Number.isSafeInteger(item.count) || item.count < 0) throw new Error('The server returned invalid question counts.')
    const rawCount = Number.isSafeInteger(item.rawCount) && Number(item.rawCount) >= item.count ? Number(item.rawCount) : item.count
    const retiredPositions = Array.isArray(item.retiredPositions)
      ? item.retiredPositions.filter((value): value is number => Number.isSafeInteger(value) && value > 0 && value <= rawCount)
      : []
    return { competenceId: String(item.competenceId), part: item.part == null ? null : Number(item.part), count: item.count, rawCount, retiredPositions }
  })
  return { counts, bankRevision: typeof data.bankRevision === 'string' ? data.bankRevision : undefined }
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
  // Counts are already included in a complete offline pack. Reuse them while
  // the manifest is known current instead of requesting the same metadata again.
  if (await mayUseOfflineTrack(track, freeOnly) && await hasFreshCurrentOfflinePack(track, freeOnly)) {
    const cachedCounts = await getOfflineQuestionCounts(track, freeOnly)
    if (cachedCounts) return cachedCounts
  }
  const countsCacheKey = `${track}:${freeOnly ? 'free' : 'full'}`
  const cachedOnlineCounts = onlineQuestionCountsCache.get(countsCacheKey)
  if (cachedOnlineCounts && Date.now() - cachedOnlineCounts.cachedAt < ONLINE_QUESTION_CACHE_TTL_MS) {
    return cachedOnlineCounts.counts
  }
  if (!supabase && !(import.meta.env.PROD && import.meta.env.VITE_QUESTION_BANK_DELIVERY === 'github')) throw new Error('Protected question service is not configured.');
  const { data, error } = await invokeQuestionBank({
    body: { action: 'counts', track, freeOnly }
  });
  if (!error && Array.isArray(data?.counts)) {
    const counts = data.counts.map((item: { competenceId: string; part: number | null; count: number }) => ({
      competenceId: String(item.competenceId),
      part: item.part == null ? null : Number(item.part),
      count: Math.max(0, Number(item.count) || 0)
    }))
    onlineQuestionCountsCache.set(countsCacheKey, { counts, cachedAt: Date.now() })
    return counts
  }
  if (error && canFallbackToOffline(error) && await mayUseOfflineTrack(track, freeOnly)) {
    const cached = await getOfflineQuestionCounts(track, freeOnly)
    if (cached) return cached
  }
  throw error || new Error(data?.error || 'Could not verify access to paid question metadata.');
}
/** Returns the published full-bank total for catalog display. This endpoint exposes counts only, never question content. */
export async function getPublicQuestionCountByTrack(track: TrackId): Promise<number> {
  if (!supabase && !(import.meta.env.PROD && import.meta.env.VITE_QUESTION_BANK_DELIVERY === 'github')) throw new Error('Protected question service is not configured.');
  const { data, error } = await invokeQuestionBank({
    body: { action: 'catalog-counts', track }
  });
  if (error || !Array.isArray(data?.counts)) {
    throw error || new Error(data?.error || 'Could not load the published question count.');
  }
  return data.counts.reduce((total: number, item: { count?: unknown; competenceId?: unknown }) =>
    total + visibleCompetenceCount(track, String(item.competenceId || ''),
      Math.max(0, Number(item.count) || 0), false), 0);
}

export async function getQuestionCountsByTrack(track: TrackId, freeOnly = false): Promise<QuestionBankCount[]> {
  return withPageLoading('Loading question counts', async () =>
    (await loadQuestionCountsByTrackInternal(track, freeOnly)).map(item => ({
      ...item,
      count: visibleCompetenceCount(track, item.competenceId, item.count, freeOnly)
    })))
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
  versionFormat: 'content-sha256-v1' | 'storage-metadata-v1' | 'github-content-sha256-v1'
  checkedAt: number
  bankRevision?: string
}

export interface OfflinePackUpdateCheck {
  status: 'not-downloaded' | 'current' | 'available' | 'offline' | 'unavailable'
  changedCompetences: string[]
  checkedAt: number | null
  lastKnownState?: 'current' | 'available'
  savedAt?: number
}

async function fetchRemoteQuestionBankVersions(track: TrackId, legacyContentHashes = false): Promise<RemoteQuestionBankVersions> {
  if (!supabase) throw new Error('Protected question service is not configured.')
  const { data, error } = await invokeQuestionBank({
    body: { action: legacyContentHashes ? 'content-versions-legacy' : 'content-versions', track }
  })
  if (error || data?.track !== track || !Array.isArray(data?.versions)) {
    throw error || new Error(data?.error || 'Question-bank versions are unavailable.')
  }
  const expectedFormat = legacyContentHashes ? 'content-sha256-v1' : data.versionFormat
  if (!['content-sha256-v1', 'storage-metadata-v1', 'github-content-sha256-v1'].includes(expectedFormat) || (legacyContentHashes && data.versionFormat !== expectedFormat)) throw new Error('The server returned an unsupported question-bank version format.')
  const versions = data.versions as RemoteQuestionSourceVersion[]
  if (versions.some(item =>
    typeof item.path !== 'string' ||
    typeof item.competenceId !== 'string' ||
    !(item.part == null || Number.isInteger(item.part)) ||
    typeof item.freeHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.freeHash) ||
    (item.fullHash != null && (typeof item.fullHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.fullHash)))
  )) throw new Error('The server returned invalid question-bank version metadata.')
  return { track, versions, versionFormat: expectedFormat, checkedAt: Number(data.checkedAt) || Date.now(), bankRevision: typeof data.bankRevision === 'string' ? data.bankRevision : undefined }
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
const offlineQuestionVersionChecksInFlight = new Map<string, Promise<OfflinePackUpdateCheck>>()
const QUESTION_BANK_VERSION_CHECK_COOLDOWN_MS = 5 * 60 * 1000

export async function checkOfflineQuestionPackUpdates(
  track: TrackId,
  freeOnly: boolean,
  force = false
): Promise<OfflinePackUpdateCheck> {
  const key = `${track}:${freeOnly ? 'free' : 'full'}`
  const existing = offlineQuestionVersionChecksInFlight.get(key)
  if (existing) return existing
  const pending = performOfflineQuestionPackUpdateCheck(track, freeOnly, force)
  offlineQuestionVersionChecksInFlight.set(key, pending)
  try {
    return await pending
  } finally {
    if (offlineQuestionVersionChecksInFlight.get(key) === pending) {
      offlineQuestionVersionChecksInFlight.delete(key)
    }
  }
}

async function performOfflineQuestionPackUpdateCheck(
  track: TrackId,
  freeOnly: boolean,
  force: boolean
): Promise<OfflinePackUpdateCheck> {
  const manifest = await getOfflinePackManifest(track, freeOnly)
  if (!manifest?.complete) {
    return { status: 'not-downloaded', changedCompetences: [], checkedAt: null }
  }

  if (freeOnly && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    try {
      const publicRevision = (await fetchRevisionQuestionCounts(track, true)).bankRevision
      const current = Boolean(publicRevision && publicRevision === manifest.publicBankRevision)
      const checkedAt = Date.now()
      await recordOfflinePackVersionCheck(track, true, {
        checkedAt, state: current ? 'current' : 'available', availableSources: []
      })
      return { status: current ? 'current' : 'available', changedCompetences: current ? [] : ['Free Reviewer'],
        checkedAt, lastKnownState: current ? 'current' : 'available', savedAt: manifest.savedAt }
    } catch {
      return { status: 'unavailable', changedCompetences: [], checkedAt: manifest.lastCheckedAt ?? null,
        lastKnownState: manifest.lastKnownUpdateState, savedAt: manifest.savedAt }
    }
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

  // Once a legacy pack is known to be outdated, don't repeatedly download
  // and hash all its old source files while the user is still studying online.
  // A successful pack update resets this flag and captures metadata versions.
  if (manifest.legacyVersionMigrationChecked && manifest.lastKnownUpdateState === 'available') {
    const changedPaths = manifest.availableSources ?? []
    return {
      status: 'available',
      changedCompetences: describeChangedCompetences(changedPaths),
      checkedAt: manifest.lastCheckedAt ?? null,
      lastKnownState: 'available',
      savedAt: manifest.savedAt
    }
  }

  // Focus and visibilitychange frequently fire together. Reuse the persisted
  // result for five minutes instead of making another Storage metadata request
  // every time the user returns to an already-open reviewer tab.
  if (
    !force &&
    (import.meta.env.VITE_QUESTION_BANK_DELIVERY !== 'github' || manifest.sourceVersionFormat === 'github-content-sha256-v1') &&
    manifest.lastCheckedAt &&
    manifest.lastKnownUpdateState &&
    Date.now() - manifest.lastCheckedAt < QUESTION_BANK_VERSION_CHECK_COOLDOWN_MS
  ) {
    const changedPaths = manifest.availableSources ?? []
    return {
      status: manifest.lastKnownUpdateState,
      changedCompetences: describeChangedCompetences(changedPaths),
      checkedAt: manifest.lastCheckedAt,
      lastKnownState: manifest.lastKnownUpdateState,
      savedAt: manifest.savedAt
    }
  }

  try {
    const remote = await fetchRemoteQuestionBankVersions(track)
    const currentVersions = sourceVersionMap(remote, freeOnly)
    let changedPaths: string[] = []
    let legacyVersionMigrationChecked = false
    let storedVersionFormat = manifest.sourceVersionFormat

    if (manifest.sourceVersionFormat === remote.versionFormat) {
      changedPaths = manifest.sourceVersions && Object.keys(manifest.sourceVersions).length
        ? changedVersionPaths(manifest.sourceVersions, currentVersions)
        : remote.versions.map(item => item.path)
    } else {
      // Existing devices recorded content hashes. Compare those once against the
      // old content-hash route, then rebase current packs to cheap object metadata.
      const legacyRemote = await fetchRemoteQuestionBankVersions(track, true)
      if (manifest.sourceVersionFormat === 'content-sha256-v1' && manifest.sourceVersions && Object.keys(manifest.sourceVersions).length) {
        changedPaths = changedVersionPaths(
          manifest.sourceVersions,
          sourceVersionMap(legacyRemote, freeOnly)
        )
      } else {
        const localPacks = await getOfflineQuestionPacks(track, freeOnly)
        changedPaths = await compareLegacyPackToCurrent(track, freeOnly, localPacks, legacyRemote)
      }
      legacyVersionMigrationChecked = true
      storedVersionFormat = changedPaths.length ? manifest.sourceVersionFormat : remote.versionFormat
    }

    const checkedAt = Date.now()
    const state = changedPaths.length ? 'available' : 'current'
    if (changedPaths.length) clearOnlineQuestionCacheForTrack(track)
    await recordOfflinePackVersionCheck(track, freeOnly, {
      checkedAt,
      state,
      ...(state === 'current' ? {
        sourceVersions: currentVersions,
        sourceVersionFormat: remote.versionFormat
      } : {
        ...(storedVersionFormat ? { sourceVersionFormat: storedVersionFormat } : {}),
        ...(legacyVersionMigrationChecked ? { legacyVersionMigrationChecked: true } : {})
      }),
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

const OFFLINE_PACK_VERSION_CHECK_TTL_MS = 5 * 60 * 1000

async function hasFreshCurrentOfflinePack(track: TrackId, freeOnly: boolean): Promise<boolean> {
  const manifest = await getOfflinePackManifest(track, freeOnly)
  if (!manifest?.complete) return false

  const checkedAt = Number(manifest.lastCheckedAt ?? 0)
  if (freeOnly && !manifest.publicBankRevision) return false
  if (checkedAt > 0 && Date.now() - checkedAt < OFFLINE_PACK_VERSION_CHECK_TTL_MS) {
    return manifest.lastKnownUpdateState === 'current'
  }

  const check = await checkOfflineQuestionPackUpdates(track, freeOnly)
  return check.status === 'current'
}

async function getCurrentCachedCompetenceRange(
  track: TrackId,
  competenceId: string,
  part: number | undefined,
  freeOnly: boolean,
  startItem: number,
  limit: number | undefined,
  randomSample: boolean
): Promise<Question[] | null> {
  if (!freeOnly && !(await hasValidOfflineTrackLease(track))) return null
  if (!(await hasFreshCurrentOfflinePack(track, freeOnly))) return null
  try {
    return await getCachedCompetenceRange(track, competenceId, part, freeOnly, startItem, limit, randomSample)
  } catch {
    // A missing/expired local lease or damaged cache must never block the normal
    // online license check and protected question-delivery path.
    return null
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
    if (!(await hasValidOfflineTrackLease(track))) throw new Error('An active offline license is required for flashcards.')
    const local = (await getOfflineQuestionsByTrack(track, false)) ?? []
    if (!local.length) throw new Error('Open this track online and wait for automatic offline preparation before using flashcards offline.')
    const scoped = competenceId ? local.filter(question => question.competenceId === competenceId) : local
    return shuffleQuestions(scoped).slice(0, Math.max(1, Math.min(30, limit)))
  }
  if (await hasFreshCurrentOfflinePack(track, false) && await hasValidOfflineTrackLease(track)) {
    const local = (await getOfflineQuestionsByTrack(track, false)) ?? []
    const scoped = competenceId ? local.filter(question => question.competenceId === competenceId) : local
    if (local.length) return shuffleQuestions(scoped).slice(0, Math.max(1, Math.min(30, limit)))
  }
  const { data, error } = await invokeQuestionBank({
    body: { action: 'flashcards', track, competenceId, limit: Math.max(1, Math.min(30, limit)) }
  });
  if (error || !Array.isArray(data?.questions)) {
    if (error && canFallbackToOffline(error) && await hasValidOfflineTrackLease(track)) {
      const local = (await getOfflineQuestionsByTrack(track, false)) ?? []
      const scoped = competenceId ? local.filter(question => question.competenceId === competenceId) : local
      if (local.length) return shuffleQuestions(scoped).slice(0, Math.max(1, Math.min(30, limit)))
      throw new Error('Open this track online and wait for automatic offline preparation before using flashcards offline.')
    }
    throw error || new Error(data?.error || 'Flashcards are unavailable.');
  }
  return data.questions as Question[];
}


export async function getFlashcardQuestions(track: TrackId, competenceId?: string, limit = 20): Promise<Question[]> {
  return withPageLoading('Loading flashcards', async () =>
    selectActiveQuestions(await loadFlashcardQuestionsInternal(track, competenceId, limit)))
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


/** Download the public free pool, with no authentication or paid bank access. */
async function downloadFreeOfflinePack(
  track: TrackId,
  onProgress?: (downloaded: number, total: number) => void,
  canContinue: () => boolean = () => true
): Promise<{ questionCount: number; groupCount: number }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connect to save the Free Reviewer for offline use.')
  if (!canContinue()) throw new Error('Free Reviewer preparation was cancelled.')
  await requestPersistentStorageIfSupported()
  const snapshot = await fetchRevisionQuestionCounts(track, true)
  const revision = snapshot.bankRevision
  if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('The published Free Reviewer version is unavailable.')
  const saved = await getOfflinePackManifest(track, true)
  const existing = saved?.complete && saved.publicBankRevision === revision
    ? await getOfflineQuestionPacks(track, true) : null
  if (existing?.length && existing.length === saved?.groupCount &&
      existing.reduce((sum, pack) => sum + pack.questions.length, 0) === saved?.questionCount) {
    await preloadQuestionImages(track, existing.flatMap(pack => pack.questions), true, canContinue)
    if (!canContinue()) throw new Error('Free Reviewer preparation was cancelled.')
    onProgress?.(saved!.questionCount, saved!.questionCount)
    return { questionCount: saved!.questionCount, groupCount: existing.length }
  }
  const total = snapshot.counts.reduce((sum, group) => sum + group.count, 0)
  if (!total || !snapshot.counts.length) throw new Error('The free question pool is currently unavailable.')
  let received = 0
  const groups: { competenceId: string; part: number | null; questions: Question[] }[] = []
  const all: Question[] = []
  for (const group of snapshot.counts) {
    if (group.count <= 0) continue
    const questions: Question[] = []
    for (let offset = 0; offset < group.count; offset += 200) {
      if (!canContinue() || (typeof navigator !== 'undefined' && navigator.onLine === false)) throw new Error('Free Reviewer download was interrupted.')
      const limit = Math.min(200, group.count - offset)
      const { data, error } = await invokeQuestionBank({ body: {
        action: 'questions', track, competenceId: group.competenceId, part: group.part,
        freeOnly: true, offset, limit, bankRevision: revision, randomSample: false
      } })
      if (error || !Array.isArray(data?.questions) || data.access !== 'free-sample' ||
          data.bankRevision !== revision || data.questions.length !== limit ||
          data.questions.some((question: Question) => question.track !== track || question.competenceId !== group.competenceId)) {
        throw new Error('The published Free Reviewer download was incomplete. Reconnect and retry.')
      }
      questions.push(...data.questions as Question[])
      received += limit
      onProgress?.(received, total)
    }
    groups.push({ competenceId: group.competenceId, part: group.part, questions })
    all.push(...questions)
  }
  if (received !== total || !canContinue()) throw new Error('The free reviewer pool was not fully received.')
  await fetchRevisionQuestionCounts(track, true, revision)
  await preloadQuestionImages(track, all, true, canContinue)
  if (!canContinue()) throw new Error('Free Reviewer preparation was cancelled.')
  await saveOfflineQuestionPackSets([{ track, freeOnly: true, groups, publicBankRevision: revision }])
  return { questionCount: received, groupCount: groups.length }
}

async function downloadOfflinePackInternal(
  track: TrackId,
  freeOnly: boolean,
  onProgress?: (downloaded: number, total: number) => void,
  canContinue: () => boolean = () => true
): Promise<{ questionCount: number; groupCount: number }> {
  if (freeOnly) return downloadFreeOfflinePack(track, onProgress, canContinue)
  if (!canContinue()) throw new Error('The track license is no longer active. Offline preparation was stopped.')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connect to the internet before downloading an offline pack.')
  if (!supabase) throw new Error('Protected question service is not configured.')

  // Confirm the signed-in account and obtain a server-signed entitlement for this
  // exact track before requesting bank metadata or question pages. This makes an
  // unlicensed download fail fast instead of spending requests on version/count APIs.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const userId = sessionData.session?.user?.id
  if (sessionError || !userId) {
    throw new Error('Sign in again before preparing a licensed offline pack.')
  }
  let accountActive = true
  const { data: accountSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== userId) accountActive = false
  })
  const assertDownloadAccount = () => {
    if (!accountActive || !canContinue()) {
      throw new Error('The account or track license changed during offline preparation. Your existing saved pack is preserved.')
    }
  }
  const assertDownloadAccountSafe = () => {
    assertDownloadAccount()
    return true
  }
  try {
  const { data: offlineLicense, error: offlineLicenseError } = await invokeQuestionBank({
    body: { action: 'offline-license' }
  })
  if (
    offlineLicenseError ||
    typeof offlineLicense?.token !== 'string' ||
    !Array.isArray(offlineLicense?.trackIds) ||
    !offlineLicense.trackIds.includes(track)
  ) {
    throw new Error('An active license for this track is required to download its offline question bank.')
  }
  assertDownloadAccount()
  const savedLease = await saveOfflineEntitlements(userId, offlineLicense.token, () => accountActive)
  const verifiedAccess = savedLease && await hasValidOfflineTrackLease(track, userId)
  if (!verifiedAccess) {
    throw new Error('Your questions were not prepared for offline access because this device could not verify the track license. Reconnect and retry.')
  }

  await requestPersistentStorageIfSupported()

  // Capture the bank fingerprint only after the server has confirmed this
  // account's entitlement for the selected track. We verify it again after all
  // pages finish so a publication during a download cannot be labelled current.
  const versionsBefore = await fetchRemoteQuestionBankVersions(track)
  const fullVersionsBefore = sourceVersionMap(versionsBefore, false)
  const freeVersionsBefore = sourceVersionMap(versionsBefore, true)

  if (!versionsBefore.bankRevision) throw new Error('Question delivery is being upgraded. Your existing offline pack is preserved; retry shortly.')
  // A valid, already-current encrypted pack should never trigger question-page
  // downloads. The local ciphertext is read through AES-GCM before trusting it:
  // incomplete, evicted or damaged groups will be downloaded again.
  const previousManifest = await getOfflinePackManifest(track, false)
  const previousPacks = previousManifest?.complete &&
    previousManifest.sourceVersionFormat === versionsBefore.versionFormat &&
    previousManifest.sourceVersions
    ? await getOfflineQuestionPacks(track, false)
    : null
  const sameSourceRelease = previousManifest?.sourceVersions &&
    Object.keys(previousManifest.sourceVersions).length === Object.keys(fullVersionsBefore).length &&
    changedVersionPaths(previousManifest.sourceVersions, fullVersionsBefore).length === 0
  if (previousPacks && previousManifest?.complete && sameSourceRelease &&
      previousPacks.length === previousManifest.groupCount &&
      previousPacks.reduce((sum, pack) => sum + pack.questions.length, 0) === previousManifest.questionCount) {
    assertDownloadAccount()
    await preloadQuestionImages(track, previousPacks.flatMap(pack => pack.questions), false, assertDownloadAccountSafe)
    await preloadQuestionImages(track, freeSample(previousPacks.flatMap(pack => pack.questions), track), true, assertDownloadAccountSafe)
    await recordOfflinePackVersionCheck(track, false, {
      checkedAt: Date.now(), state: 'current',
      sourceVersions: fullVersionsBefore,
      sourceVersionFormat: versionsBefore.versionFormat,
      availableSources: []
    })
    onProgress?.(previousManifest.questionCount, previousManifest.questionCount)
    return { questionCount: previousManifest.questionCount, groupCount: previousManifest.groupCount }
  }

  const counts = (await fetchRevisionQuestionCounts(track, false, versionsBefore.bankRevision)).counts
  // Match a published source path to its competence/part. An unknown mapping
  // fails closed to a fresh download rather than falsely reusing stale content.
  const publishedGroups = counts.filter(group => group.count > 0).map(group => ({
    competenceId: group.competenceId,
    part: group.part ?? null,
    count: group.count,
    path: SOURCES.find(source => source.track === track &&
      source.competenceId === group.competenceId &&
      (track !== 'GMDSS_GOC' || Number(source.path.match(/_part(\d+)\./)?.[1]) === group.part)
    )?.path ?? ''
  }))
  const reusePlan = planSmartBankReuse<Question>(
    previousManifest,
    { versionFormat: versionsBefore.versionFormat, sourceVersions: fullVersionsBefore },
    publishedGroups,
    previousPacks
  )
  const reusableGroups = new Map(reusePlan.reused.map(group => [
    `${group.competenceId}:${group.part ?? 'all'}`, group.questions
  ] as const))
  const totalExpected = counts.reduce((sum, item) => sum + item.count, 0)
  if (!counts.length || totalExpected <= 0) throw new Error('No questions are available to download for this track.')

  // Keep any existing complete pack usable until the entire replacement has
  // downloaded, passed count checks, been encrypted, and can be committed atomically.
  let downloaded = 0
  const allQuestions: Question[] = []
  const writtenGroups: { competenceId: string; part: number | null; questions: Question[] }[] = []

  for (const group of counts) {
    // Some banks can include a registered competence with no published questions.
    // Do not create empty pack records for those entries.
    if (group.count <= 0) continue
    const reuse = reusableGroups.get(`${group.competenceId}:${group.part ?? 'all'}`)
    if (reuse) {
      assertDownloadAccount()
      writtenGroups.push({ competenceId: group.competenceId, part: group.part, questions: reuse })
      allQuestions.push(...reuse)
      downloaded += reuse.length
      onProgress?.(Math.min(downloaded, totalExpected), totalExpected)
      continue
    }
    const questions: Question[] = []
    for (let offset = 0; offset < group.count; offset += 200) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Connection lost. Reconnect and retry the offline download.')
      assertDownloadAccount()
      const pageLimit = Math.min(200, group.count - offset)
      const { data, error } = await invokeQuestionBank({
        body: {
          action: 'questions', track, competenceId: group.competenceId, part: group.part,
          freeOnly, offset, limit: pageLimit, randomSample: false, bankRevision: versionsBefore.bankRevision
        }
      })
      if (error || !Array.isArray(data?.questions)) throw error || new Error(data?.error || 'The offline question download failed.')
      if (versionsBefore.bankRevision && data.bankRevision !== versionsBefore.bankRevision) throw new Error('The question-bank release changed. Your previous offline pack is preserved; retry shortly.')
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
  if (versionsAfter.bankRevision !== versionsBefore.bankRevision) throw new Error('The question-bank release changed while preparing offline study. Your previous pack is preserved; retry shortly.')
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
    sourceVersionFormat: RemoteQuestionBankVersions['versionFormat']
  }[] = [{
    track,
    freeOnly,
    groups: writtenGroups,
    sourceVersions: freeOnly ? freeVersionsBefore : fullVersionsBefore!,
    sourceVersionFormat: versionsAfter.versionFormat
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
    // Keep public free diagrams available even after a paid license expires offline.
    await preloadQuestionImages(track, samples, true, assertDownloadAccountSafe)
    updates.push({
      track,
      freeOnly: true,
      groups: Array.from(sampleGroups.values()),
      sourceVersions: freeVersionsBefore,
      sourceVersionFormat: versionsAfter.versionFormat
    })
  }

  // Do not mark questions saved until every attached image is cached and verified.
  assertDownloadAccount()
  await preloadQuestionImages(track, allQuestions, false, assertDownloadAccountSafe)
  // A revoked/expired license cannot finish committing a pack if access changed
  // while its final pages were in flight. Existing saved packs are untouched.
  assertDownloadAccount()
  await saveOfflineQuestionPackSets(updates)
  return { questionCount: allQuestions.length, groupCount: writtenGroups.length }
  } finally { accountSubscription.subscription.unsubscribe() }
}

export async function downloadOfflinePack(
  track: TrackId,
  freeOnly: boolean,
  onProgress?: (downloaded: number, total: number) => void,
  options?: { background?: boolean; canContinue?: () => boolean }
): Promise<{ questionCount: number; groupCount: number }> {
  if (options?.background) return downloadOfflinePackInternal(track, freeOnly, onProgress, options.canContinue)
  return withPageLoading('Downloading question pack', () => downloadOfflinePackInternal(track, freeOnly, onProgress, options?.canContinue))
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
    if (!(await hasValidOfflineTrackLease(track))) throw new Error('An active offline license is required for question search.')
    const cached = (await getOfflineQuestionsByTrack(track, false)) ?? []
    if (!cached.length) throw new Error('Open this track online and wait for automatic offline preparation before using Search offline.')
    return cached.filter(question =>
      (question.questionText + ' ' + question.topic + ' ' + question.competenceId + ' ' + question.options.join(' '))
        .toLowerCase().includes(q.toLowerCase())
    ).slice(0, Math.max(1, Math.min(40, limit)))
  }
  if (await hasFreshCurrentOfflinePack(track, false) && await hasValidOfflineTrackLease(track)) {
    const local = (await getOfflineQuestionsByTrack(track, false)) ?? []
    if (local.length) {
      const hits = local.filter(question =>
        (question.questionText + ' ' + question.topic + ' ' + question.competenceId + ' ' + question.options.join(' '))
          .toLowerCase().includes(q.toLowerCase())
      )
      return hits.slice(0, Math.max(1, Math.min(40, limit)))
    }
  }
  const { data, error } = await invokeQuestionBank({
    body: { action: 'search', track, query: q, limit: Math.max(1, Math.min(40, limit)) }
  });
  if (error || !Array.isArray(data?.questions)) {
    if (error && canFallbackToOffline(error) && await hasValidOfflineTrackLease(track)) {
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
  return withPageLoading('Searching questions', async () =>
    selectActiveQuestions(await searchQuestionsInternal(track, query, limit)))
}
