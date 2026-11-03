// Generated from the existing server parser. Regenerate with scripts/generate-worker-bank-codec.mjs.
const SOURCE_ASSETS: string[] = ["deck/oic_nw_c1.csv.enc","deck/oic_nw_c10.csv.enc","deck/oic_nw_c11.csv.enc","deck/oic_nw_c12.csv.enc","deck/oic_nw_c13.csv.enc","deck/oic_nw_c17.csv.enc","deck/oic_nw_c2.csv.enc","deck/oic_nw_c3.csv.enc","deck/oic_nw_c4.csv.enc","deck/oic_nw_c5.csv.enc","deck/oic_nw_c7.csv.enc","deck/oic_nw_c9.csv.enc","deck_mgt/dm_c1.csv.enc","deck_mgt/dm_c10.csv.enc","deck_mgt/dm_c11.csv.enc","deck_mgt/dm_c12.csv.enc","deck_mgt/dm_c13.csv.enc","deck_mgt/dm_c14.csv.enc","deck_mgt/dm_c15.csv.enc","deck_mgt/dm_c16.csv.enc","deck_mgt/dm_c17.csv.enc","deck_mgt/dm_c18.csv.enc","deck_mgt/dm_c2.csv.enc","deck_mgt/dm_c20.csv.enc","deck_mgt/dm_c3.csv.enc","deck_mgt/dm_c4.csv.enc","deck_mgt/dm_c5.csv.enc","deck_mgt/dm_c6.csv.enc","deck_mgt/dm_c8.csv.enc","deck_mgt/dm_c9.csv.enc","engine_ew/ew_c1.csv.enc","engine_ew/ew_c10.csv.enc","engine_ew/ew_c11.csv.enc","engine_ew/ew_c15.csv.enc","engine_ew/ew_c16.csv.enc","engine_ew/ew_c2.csv.enc","engine_ew/ew_c3.csv.enc","engine_ew/ew_c4.csv.enc","engine_ew/ew_c5.csv.enc","engine_ew/ew_c6.csv.enc","engine_ew/ew_c7.csv.enc","engine_ew/ew_c8.csv.enc","engine_ew/ew_c9.csv.enc","engine_mgt/em_c1.csv.enc","engine_mgt/em_c10.csv.enc","engine_mgt/em_c11.csv.enc","engine_mgt/em_c12.csv.enc","engine_mgt/em_c13.csv.enc","engine_mgt/em_c14.csv.enc","engine_mgt/em_c2.csv.enc","engine_mgt/em_c3.csv.enc","engine_mgt/em_c4.csv.enc","engine_mgt/em_c5.csv.enc","engine_mgt/em_c6.csv.enc","engine_mgt/em_c7.csv.enc","engine_mgt/em_c8.csv.enc","engine_mgt/em_c9.csv.enc","gmdss/c1_part1.csv.enc","gmdss/c1_part10.csv.enc","gmdss/c1_part2.csv.enc","gmdss/c1_part3.csv.enc","gmdss/c1_part4.csv.enc","gmdss/c1_part5.csv.enc","gmdss/c1_part6.csv.enc","gmdss/c1_part7.csv.enc","gmdss/c1_part8.csv.enc","gmdss/c1_part9.csv.enc","gmdss/c2_part1.csv.enc","gmdss/c2_part2.csv.enc"];
const a = [186,37,40,56,208,70,77,77,49,140,108,238,27,237,38,131];
const b = [54,195,118,105,37,110,229,154,71,100,190,64,176,245,192,212];
function deriveKeyBytes(): Uint8Array {
  const all = [...a, ...b];
  const result = new Uint8Array(all.length);
  for (let i = 0; i < all.length; i++) {
    const m = ((i * 37 + 11) ^ (i << 3)) & 0xff;
    result[i] = (all[i] ^ m ^ 0x5a) & 0xff;
  }
  return result;
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
async function decryptToText(encrypted: Uint8Array): Promise<string> {
  if (encrypted.length < 28) throw new Error("Encrypted asset is too short.");
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(deriveKeyBytes()), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: toArrayBuffer(encrypted.slice(0, 12)),
    tagLength: 128
  }, key, toArrayBuffer(encrypted.slice(12)));
  const bytes = new Uint8Array(plain);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("windows-1252").decode(bytes); }
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}
function serializeCsv(rows: string[][]) { return rows.map(row => row.map(csvCell).join(",")).join("\r\n"); }
function headerIndex(rows: string[][], format: "standard" | "gmdss") {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const joined = rows[i].map(c => c.trim().toLowerCase()).join("|");
    if (format === "gmdss") { if (joined.includes("question") && joined.includes("option1")) return i; }
    else if ((joined.includes("question") && (joined.includes("correct") || joined.includes("|a|"))) ||
      (rows[i][0]?.trim().toLowerCase() === "no." && rows[i][1]?.trim().toLowerCase() === "question")) return i;
  }
  return format === "gmdss" ? 3 : 0;
}
function isStrictStandardTrack(path: string): boolean {
  return path.startsWith("engine_ew/") || path.startsWith("deck_mgt/") || path.startsWith("engine_mgt/");
}
function validStandard(row: string[], path: string): boolean {
  if (row.length < 7) return false;
  const numberText = (row[0] || "").trim();
  if (!/^\d+$/.test(numberText) || Number(numberText) <= 0) return false;
  const question = (row[1] || "").trim();
  const rawOptions = row.slice(2, 6).map(value => (value || "").trim());
  const options = rawOptions.filter(Boolean);
  if (!question || question.toLowerCase() === "question" ||
      (options.length === 4 && options.every((value, index) => value === ["A","B","C","D"][index])) ||
      options.length < 2) return false;

  // Match Android's newer-track parser: an answer must be present, valid,
  // and point to a populated choice. Legacy deck banks keep their existing
  // behavior, which falls back to the first remaining answer option.
  if (isStrictStandardTrack(path)) {
    const answer = (row[6] || "").trim().toUpperCase();
    const answerIndex: Record<string, number> = { A:0, B:1, C:2, D:3, "1":0, "2":1, "3":2, "4":3 };
    const index = answerIndex[answer];
    if (index === undefined || !rawOptions[index]) return false;
  }
  return true;
}
function validStandardRows(rows: string[][], path: string): string[][] {
  const header = headerIndex(rows, "standard");
  const seenNumbers = new Set<number>();
  const valid: string[][] = [];
  // Android's Deck F2/F3 loader stores each valid question by its numbered
  // slot and only has slots up to the competence's published bank size.
  // Mirror that rule here so counts, delivered questions, and Android agree.
  const numberedDeckLimits: Record<string, number> = {
    "7": 533, "9": 508,
    "10": 610, "11": 421, "12": 351, "13": 888, "17": 628
  };
  const deckMatch = path.match(/^deck\/oic_nw_c(7|9|10|11|12|13|17)\.csv\.enc$/);
  const deckLimit = deckMatch ? numberedDeckLimits[deckMatch[1]] : undefined;
  for (const row of rows.slice(header + 1)) {
    if (!validStandard(row, path)) continue;
    const number = Number((row[0] || "").trim());
    if (deckLimit !== undefined && number > deckLimit) continue;
    // Android stores C7/C9 and F2/F3 questions in numbered slots, so duplicate
    // numbers replace the same slot instead of increasing the real question count.
    if (isStrictStandardTrack(path) || deckLimit !== undefined) {
      if (seenNumbers.has(number)) continue;
      seenNumbers.add(number);
    }
    valid.push(row);
  }
  return valid;
}
function validGmdss(row: string[]) {
  // Android's GMDSS row parser requires question + six option slots,
  // explanation and answer columns before it can create a Question object.
  if (row.length < 10) return false;
  const q = (row[0] || "").trim();
  const opts = row.slice(2, 8).map(v => (v || "").trim()).filter(Boolean);
  return !!q && q.toLowerCase() !== "question" && opts.length >= 2;
}
class JavaRandom {
  private seed: bigint;
  private static readonly MASK = (1n << 48n) - 1n;
  constructor(seed: number) { this.seed = (BigInt(seed) ^ 0x5deece66dn) & JavaRandom.MASK; }
  next(bits: number) {
    this.seed = (this.seed * 0x5deece66dn + 0xbn) & JavaRandom.MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }
  nextInt(bound: number) {
    let r = this.next(31), m = bound - 1;
    if ((bound & m) === 0) return Number((BigInt(bound) * BigInt(r)) >> 31n);
    for (let u = r; ((u - (r = u % bound) + m) | 0) < 0; u = this.next(31)) {}
    return r;
  }
}
function javaShuffle<T>(values: T[], seed: number): T[] {
  const list = values.slice(), rng = new JavaRandom(seed);
  for (let i = list.length; i > 1; i--) { const j = rng.nextInt(i); [list[i - 1], list[j]] = [list[j], list[i - 1]]; }
  return list;
}
function sampleFreeCsv(path: string, text: string) {
  const format = path.startsWith("gmdss/") ? "gmdss" : "standard";
  const rows = parseCsv(text);
  if (format === "gmdss") {
    const hi = headerIndex(rows, "gmdss");
    let valid = rows.slice(hi + 1).filter(validGmdss);
    let outputHeader = rows.slice(0, hi + 1);
    if (!valid.length && rows.length) {
      const flat = rows.length === 1 ? rows[0] : rows.flat();
      const chunks: string[][] = [];
      for (let i = 0; i < flat.length; i++) {
        if ((flat[i] || "").trim().toLowerCase() !== "choice") continue;
        const start = i - 1;
        if (start < 0 || start + 9 >= flat.length) continue;
        const chunk = flat.slice(start, start + 10);
        if (validGmdss(chunk)) chunks.push(chunk);
      }
      const match = path.match(/gmdss\/c(1|2)_part(\d+)\.csv\.enc$/);
      const max = match ? (match[1] === "1" ? 90 : 65) : 90;
      return serializeCsv(chunks.slice(0, max));
    }
    const match = path.match(/gmdss\/c(1|2)_part(\d+)\.csv\.enc$/);
    const max = match ? (match[1] === "1" ? 90 : 65) : 90;
    return serializeCsv([...outputHeader, ...valid.slice(0, max)]);
  }
  const hi = headerIndex(rows, "standard");
  const header = rows.slice(0, hi + 1);
  const valid = validStandardRows(rows, path);
  if (path.startsWith("deck/")) {
    const match = path.match(/oic_nw_c(\d+)\.csv\.enc$/);
    const quotas: Record<string, number> = { "1":420,"2":221,"3":258,"4":160,"5":100,"7":196,"9":176,"10":109,"11":96,"12":110,"13":122,"17":97 };
    if (match) {
      const comp = match[1], quota = quotas[comp] ?? 1;
      const keepOrder = ["17","13","9","10","7"].includes(comp);
      const sampled = keepOrder ? valid.slice(0, quota) : javaShuffle(valid, 2065 + Number(comp) * 31).slice(0, quota);
      return serializeCsv([...header, ...sampled]);
    }
  }
  const sampleCount = Math.max(1, Math.round(valid.length * 0.4));
  return serializeCsv([...header, ...valid.slice(0, sampleCount)]);
}
function trackForPath(path: string) {
  if (path.startsWith("deck/")) return "DECK_OIC_NW";
  if (path.startsWith("gmdss/")) return "GMDSS_GOC";
  if (path.startsWith("engine_ew/")) return "ENGINE_OIC_EW";
  if (path.startsWith("deck_mgt/")) return "DECK_MGT";
  if (path.startsWith("engine_mgt/")) return "ENGINE_MGT";
  return null;
}
type SourceInfo = { track: string; competenceId: string; part: number | null; format: "standard" | "gmdss"; functionId: string; idPrefix: string };
function sourceInfo(path: string): SourceInfo | null {
  const track = trackForPath(path);
  if (!track) return null;
  let competenceId = "";
  let part: number | null = null;
  if (track === "DECK_OIC_NW") competenceId = path.match(/oic_nw_c(\d+)\.csv\.enc$/)?.[1] ? "C" + path.match(/oic_nw_c(\d+)\.csv\.enc$/)![1] : "";
  else if (track === "GMDSS_GOC") {
    const match = path.match(/gmdss\/c(1|2)_part(\d+)\.csv\.enc$/);
    if (!match) return null;
    competenceId = "C" + match[1]; part = Number(match[2]);
  } else {
    const match = path.match(/(?:ew|dm|em)_c(\d+)\.csv\.enc$/);
    if (!match) return null;
    competenceId = "C" + match[1];
  }
  if (!competenceId) return null;
  const n = Number(competenceId.slice(1));
  let functionId = "GMDSS";
  let idPrefix = `G-${competenceId}-P${part}`;
  if (track === "DECK_OIC_NW") {
    functionId = ["C1","C2","C3","C4","C5","C7","C9"].includes(competenceId) ? "F1" : ["C10","C11"].includes(competenceId) ? "F2" : "F3";
    idPrefix = `D-${functionId}-${competenceId}`;
  } else if (track === "ENGINE_OIC_EW") {
    functionId = n <= 5 ? "F1" : n <= 7 ? "F2" : n <= 9 ? "F3" : "F4";
    idPrefix = `EW-${competenceId}`;
  } else if (track === "DECK_MGT") {
    functionId = n <= 11 ? "F1" : n <= 14 ? "F2" : "F3";
    idPrefix = `DM-${competenceId}`;
  } else if (track === "ENGINE_MGT") {
    functionId = n <= 4 ? "F1" : n <= 6 ? "F2" : n <= 9 ? "F3" : "F4";
    idPrefix = `EM-${competenceId}`;
  }
  return { track, competenceId, part, format: track === "GMDSS_GOC" ? "gmdss" : "standard", functionId, idPrefix };
}
function validGmdssRows(text: string): string[][] {
  const rows = parseCsv(text);
  const hi = headerIndex(rows, "gmdss");
  const normal = rows.length > 3 ? rows.slice(hi + 1).filter(validGmdss) : [];
  if (normal.length) return normal;
  const flat = rows.length === 1 ? rows[0] : rows.flat();
  const chunks: string[][] = [];
  for (let i = 0; i < flat.length; i++) {
    if ((flat[i] || "").trim().toLowerCase() !== "choice") continue;
    const start = i - 1;
    if (start < 0 || start + 9 >= flat.length) continue;
    const chunk = flat.slice(start, start + 10);
    if (validGmdss(chunk)) chunks.push(chunk);
  }
  return chunks;
}
const QUESTION_COUNT_ALGORITHM_VERSION = "valid-questions-v5";
function validQuestionCount(path: string, text: string, freeOnly: boolean): number {
  let count = 0;
  const info = sourceInfo(path);
  if (!info) return 0;
  if (info.format === "gmdss") {
    count = validGmdssRows(text).length;
    if (freeOnly) count = Math.min(count, info.competenceId === "C1" ? 90 : 65);
    return count;
  }
  const rows = parseCsv(text);
  count = validStandardRows(rows, path).length;
  if (!freeOnly) return count;
  if (info.track === "DECK_OIC_NW") {
    const quotas: Record<string, number> = { C1:420,C2:221,C3:258,C4:160,C5:100,C7:196,C9:176,C10:109,C11:96,C12:110,C13:122,C17:97 };
    return Math.min(count, quotas[info.competenceId] ?? 1);
  }
  return Math.min(count, Math.max(1, Math.round(count * 0.4)));
}
const COMPETENCE_TITLES: Record<string, string> = {
  "DECK_OIC_NW:C1": "Plan and conduct a passage and determine position",
  "DECK_OIC_NW:C2": "Maintain a safe navigational watch",
  "DECK_OIC_NW:C3": "Use of Radar and ARPA for the safety of navigation",
  "DECK_OIC_NW:C4": "Use of ECDIS for the safety of navigation",
  "DECK_OIC_NW:C5": "Respond to emergencies",
  "DECK_OIC_NW:C7": "Use the IMO SMCP and English",
  "DECK_OIC_NW:C9": "Manoeuvre the ship",
  "DECK_OIC_NW:C10": "Cargo operations – loading, stowage, securing",
  "DECK_OIC_NW:C11": "Inspect and report defects – cargo spaces & ballast",
  "DECK_OIC_NW:C12": "Ensure compliance with pollution-prevention requirements",
  "DECK_OIC_NW:C13": "Maintain seaworthiness of the ship",
  "DECK_OIC_NW:C17": "Monitor compliance with legislative requirements",
  "GMDSS_GOC:C1": "Transmit and receive information using GMDSS subsystems",
  "GMDSS_GOC:C2": "Provide radio services in emergencies",
  "ENGINE_OIC_EW:C1": "Maintain a safe engineering watch",
  "ENGINE_OIC_EW:C2": "Use English in oral and written form",
  "ENGINE_OIC_EW:C3": "Use internal communications systems",
  "ENGINE_OIC_EW:C4": "Operate main and auxiliary machinery and control systems",
  "ENGINE_OIC_EW:C5": "Operate fuel, lubrication, ballast and pumping systems",
  "ENGINE_OIC_EW:C6": "Operate electrical, electronic and control systems",
  "ENGINE_OIC_EW:C7": "Maintenance and repair of electrical and electronic equipment",
  "ENGINE_OIC_EW:C8": "Hand tools, machine tools and measuring instruments",
  "ENGINE_OIC_EW:C9": "Maintenance and repair of shipboard machinery and equipment",
  "ENGINE_OIC_EW:C10": "Ensure compliance with pollution-prevention requirements",
  "ENGINE_OIC_EW:C11": "Maintain seaworthiness of the ship",
  "ENGINE_OIC_EW:C15": "Monitor compliance with legislative requirements",
  "ENGINE_OIC_EW:C16": "Application of leadership and team working skills",
  "DECK_MGT:C1": "Plan a voyage and conduct navigation",
  "DECK_MGT:C2": "Determine position and accuracy of position fix",
  "DECK_MGT:C3": "Determine and allow for compass errors",
  "DECK_MGT:C4": "Coordinate search and rescue operations",
  "DECK_MGT:C5": "Establish watchkeeping arrangements and procedures",
  "DECK_MGT:C6": "Maintain safe navigation through NAV systems information",
  "DECK_MGT:C8": "Forecast weather and oceanographic conditions",
  "DECK_MGT:C9": "Respond to navigational emergencies",
  "DECK_MGT:C10": "Manoeuvre and handle a ship in all conditions",
  "DECK_MGT:C11": "Operate remote controls of propulsion plant",
  "DECK_MGT:C12": "Plan and ensure safe loading, stowage and care of cargoes",
  "DECK_MGT:C13": "Assess reported defects and damage to cargo spaces",
  "DECK_MGT:C14": "Carriage of dangerous goods",
  "DECK_MGT:C15": "Control trim, stability and stress",
  "DECK_MGT:C16": "Monitor and control compliance with legislative requirements",
  "DECK_MGT:C17": "Maintain safety and security of the ship’s crew and passengers",
  "DECK_MGT:C18": "Develop emergency and damage control plans",
  "DECK_MGT:C20": "Organize and manage medical care on board",
  "ENGINE_MGT:C1": "Manage the operation of propulsion plant machinery",
  "ENGINE_MGT:C2": "Plan and schedule operations",
  "ENGINE_MGT:C3": "Operation and performance assessment of propulsion plant",
  "ENGINE_MGT:C4": "Manage fuel, lubrication and ballast operations",
  "ENGINE_MGT:C5": "Manage operation of electrical and electronic control equipment",
  "ENGINE_MGT:C6": "Troubleshoot electrical and electronic control equipment",
  "ENGINE_MGT:C7": "Manage safe and effective maintenance and repair procedures",
  "ENGINE_MGT:C8": "Detect and identify machinery malfunctions and correct faults",
  "ENGINE_MGT:C9": "Ensure safe working practices",
  "ENGINE_MGT:C10": "Control trim, stability and stress",
  "ENGINE_MGT:C11": "Monitor compliance with legislative requirements and marine environment protection",
  "ENGINE_MGT:C12": "Maintain safety and security of the vessel, crew and passengers",
  "ENGINE_MGT:C13": "Develop emergency and damage control plans",
  "ENGINE_MGT:C14": "Use leadership and managerial skills"
};
const DECK_TOPICS: Record<string, string[]> = {
  C1: ["Terrestrial Navigation & Plotting","Compass Errors & Corrections","Passage Planning & Appraisal","Tides & Tidal Streams","Celestial Navigation","Chart Projections","GNSS & Electronic Fixing","Great Circle Sailing","Meteorology"],
  C2: ["COLREGs Steering & Sailing","Lights & Shapes","Sound Signals","Restricted Visibility","Watchkeeping"],
  C3: ["Radar & ARPA","Collision Avoidance","Radar Plotting"],
  C4: ["ECDIS","Route Monitoring","Electronic Charts"],
  C5: ["Emergencies","Distress","Contingency Procedures"],
  C7: ["SMCP","Maritime English","Communications"],
  C9: ["Ship Handling","Manoeuvring","Berthing"],
  C10: ["Cargo Operations","Stowage & Securing","Care of Cargo"],
  C11: ["Cargo Spaces","Hatch Covers","Ballast Tanks"],
  C12: ["MARPOL","Pollution Prevention"],
  C13: ["Seaworthiness","Stability","Hull Integrity"],
  C17: ["Legislation","STCW","Flag State"]
};
function topicFor(info: SourceInfo, oneBasedIndex: number): string {
  const deckTopics = info.track === "DECK_OIC_NW" ? DECK_TOPICS[info.competenceId] : undefined;
  if (deckTopics?.length) return deckTopics[(oneBasedIndex - 1) % deckTopics.length];
  return COMPETENCE_TITLES[`${info.track}:${info.competenceId}`] || info.competenceId;
}
function answerIndex(value: string, optionsLength: number): number {
  const raw = value.trim().toUpperCase();
  const mapped: Record<string, number> = { A:0, B:1, C:2, D:3, E:4, F:5, "1":0, "2":1, "3":2, "4":3, "5":4, "6":5 };
  return Math.min(mapped[raw] ?? 0, Math.max(0, optionsLength - 1));
}
function difficulty(index: number) {
  const m = (index + 1) % 3;
  return m === 1 ? "EASY" : m === 2 ? "MODERATE" : "DIFFICULT";
}
function toSearchQuestions(path: string, text: string): Record<string, unknown>[] {
  const info = sourceInfo(path);
  if (!info) return [];
  const records: { q: string; options: string[]; explanation: string; answer: string }[] = [];
  if (info.format === "gmdss") {
    for (const row of validGmdssRows(text)) {
      records.push({ q: (row[0] || "").trim(), options: row.slice(2,8).map(x => (x || "").trim()).filter(Boolean), explanation: (row[8] || "").trim(), answer: (row[9] || "").trim() });
    }
  } else {
    const rows = parseCsv(text);
    for (const row of validStandardRows(rows, path)) {
      const rawOptions = row.slice(2, 6).map(value => (value || "").trim());
      const options = isStrictStandardTrack(path) ? rawOptions : rawOptions.filter(Boolean);
      records.push({ q: row[1].trim(), options, explanation: (row[7] || "").trim(), answer: row[6].trim() });
    }
  }
  return records.map((record, i) => ({
    id: `${info.idPrefix}-${String(i + 1).padStart(3, "0")}`,
    track: info.track,
    functionId: info.functionId,
    competenceId: info.competenceId,
    topic: topicFor(info, i + 1),
    questionText: record.q,
    options: record.options,
    correctAnswerIndex: answerIndex(record.answer, record.options.length),
    explanation: record.explanation,
    difficulty: difficulty(i + 1)
  }));
}
export { SOURCE_ASSETS, decryptToText, sampleFreeCsv, toSearchQuestions, trackForPath, sourceInfo, deriveKeyBytes, validQuestionCount, QUESTION_COUNT_ALGORITHM_VERSION };
