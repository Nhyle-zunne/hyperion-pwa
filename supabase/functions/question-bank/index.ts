import { createClient } from "npm:@supabase/supabase-js@2";
import { canAccessPaidTrack } from "./access.mjs";

const SOURCE_ASSETS: string[] = ["deck/oic_nw_c1.csv.enc","deck/oic_nw_c10.csv.enc","deck/oic_nw_c11.csv.enc","deck/oic_nw_c12.csv.enc","deck/oic_nw_c13.csv.enc","deck/oic_nw_c17.csv.enc","deck/oic_nw_c2.csv.enc","deck/oic_nw_c3.csv.enc","deck/oic_nw_c4.csv.enc","deck/oic_nw_c5.csv.enc","deck/oic_nw_c7.csv.enc","deck/oic_nw_c9.csv.enc","deck_mgt/dm_c1.csv.enc","deck_mgt/dm_c10.csv.enc","deck_mgt/dm_c11.csv.enc","deck_mgt/dm_c12.csv.enc","deck_mgt/dm_c13.csv.enc","deck_mgt/dm_c14.csv.enc","deck_mgt/dm_c15.csv.enc","deck_mgt/dm_c16.csv.enc","deck_mgt/dm_c17.csv.enc","deck_mgt/dm_c18.csv.enc","deck_mgt/dm_c2.csv.enc","deck_mgt/dm_c20.csv.enc","deck_mgt/dm_c3.csv.enc","deck_mgt/dm_c4.csv.enc","deck_mgt/dm_c5.csv.enc","deck_mgt/dm_c6.csv.enc","deck_mgt/dm_c8.csv.enc","deck_mgt/dm_c9.csv.enc","engine_ew/ew_c1.csv.enc","engine_ew/ew_c10.csv.enc","engine_ew/ew_c11.csv.enc","engine_ew/ew_c15.csv.enc","engine_ew/ew_c16.csv.enc","engine_ew/ew_c2.csv.enc","engine_ew/ew_c3.csv.enc","engine_ew/ew_c4.csv.enc","engine_ew/ew_c5.csv.enc","engine_ew/ew_c6.csv.enc","engine_ew/ew_c7.csv.enc","engine_ew/ew_c8.csv.enc","engine_ew/ew_c9.csv.enc","engine_mgt/em_c1.csv.enc","engine_mgt/em_c10.csv.enc","engine_mgt/em_c11.csv.enc","engine_mgt/em_c12.csv.enc","engine_mgt/em_c13.csv.enc","engine_mgt/em_c14.csv.enc","engine_mgt/em_c2.csv.enc","engine_mgt/em_c3.csv.enc","engine_mgt/em_c4.csv.enc","engine_mgt/em_c5.csv.enc","engine_mgt/em_c6.csv.enc","engine_mgt/em_c7.csv.enc","engine_mgt/em_c8.csv.enc","engine_mgt/em_c9.csv.enc","gmdss/c1_part1.csv.enc","gmdss/c1_part10.csv.enc","gmdss/c1_part2.csv.enc","gmdss/c1_part3.csv.enc","gmdss/c1_part4.csv.enc","gmdss/c1_part5.csv.enc","gmdss/c1_part6.csv.enc","gmdss/c1_part7.csv.enc","gmdss/c1_part8.csv.enc","gmdss/c1_part9.csv.enc","gmdss/c2_part1.csv.enc","gmdss/c2_part2.csv.enc"];
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
const a = [186,37,40,56,208,70,77,77,49,140,108,238,27,237,38,131];
const b = [54,195,118,105,37,110,229,154,71,100,190,64,176,245,192,212];

function headers(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ["https://hyperionmaritime.org", "https://www.hyperionmaritime.org", "http://localhost:5173", "http://127.0.0.1:5173"];
  return { ...corsHeaders, "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "https://hyperionmaritime.org" };
}
function json(req: Request, body: unknown, status = 200) {
  const serialized = JSON.stringify(body);
  const responseHeaders = new Headers({
    ...headers(req),
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private"
  });
  const acceptsGzip = /(?:^|,)\\s*gzip\\s*(?:,|$)/i.test(req.headers.get("accept-encoding") || "");
  if (acceptsGzip && new TextEncoder().encode(serialized).byteLength >= 4096) {
    responseHeaders.set("Content-Encoding", "gzip");
    responseHeaders.set("Vary", "Origin, Accept-Encoding");
    const compressed = new Blob([serialized]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(compressed, { status, headers: responseHeaders });
  }
  return new Response(serialized, { status, headers: responseHeaders });
}
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
function validStandard(row: string[]) {
  if (row.length < 7) return false;
  const number = Number.parseInt(row[0].trim(), 10);
  const question = row[1].trim();
  const options = row.slice(2, 6).map(v => v.trim()).filter(Boolean);
  return Number.isFinite(number) && number > 0 && !!question && question.toLowerCase() !== "question" &&
    !(options.length === 4 && options.every((v, i) => v === ["A","B","C","D"][i])) && options.length >= 2;
}
function validGmdss(row: string[]) {
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
  const valid = rows.slice(hi + 1).filter(validStandard);
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
function isAdminEmail(email: string | undefined) {
  const configured = (Deno.env.get("ADMIN_EMAILS") || "").split(/[;,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && configured.includes(email.toLowerCase());
}
function isMissingGooglePlayEntitlementsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "PGRST205" || typeof candidate.message !== "string") return false;
  const message = candidate.message.toLowerCase();
  return message.includes("google_play_entitlements") && message.includes("schema cache");
}
async function loadEntitlement(admin: any, userId: string, track: string) {
  const now = new Date().toISOString();
  // Keep the latest currently valid license from either checkout/admin grants or Google Play.
  // Filter and limit database-side so old historical rows cannot make maybeSingle() fail.
  const [website, play] = await Promise.all([
    admin.from("entitlements").select("user_id,track_id,status,expires_at")
      .eq("user_id", userId).eq("track_id", track).eq("status", "active").gt("expires_at", now)
      .order("expires_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("google_play_entitlements").select("user_id,track_id,status,expires_at")
      .eq("user_id", userId).eq("track_id", track).eq("status", "active").gt("expires_at", now)
      .order("expires_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const playTableMissing = isMissingGooglePlayEntitlementsTable(play.error);
  if (website.error || (play.error && !playTableMissing)) throw new Error("Could not verify the license.");
  const candidates = [website.data, playTableMissing ? null : play.data].filter((row: any) =>
    row && row.user_id === userId && row.track_id === track && row.status === "active" &&
    typeof row.expires_at === "string" && Number.isFinite(Date.parse(row.expires_at)) &&
    Date.parse(row.expires_at) > Date.now()
  );
  if (!candidates.length) return null;
  return candidates.reduce((latest: any, row: any) =>
    Date.parse(row.expires_at) > Date.parse(latest.expires_at) ? row : latest
  );
}
async function migrationState(admin: any) {
  const result = await admin.from("question_bank_migration_state").select("status,asset_count,error_summary,updated_at").eq("id", 1).single();
  if (result.error || !result.data) throw new Error("Could not read question-bank migration state.");
  return result.data;
}

const MIGRATION_STATE_CACHE_TTL_MS = 60_000;
let migrationStateCache: { data: any; cachedAt: number } | null = null;
async function cachedMigrationState(admin: any) {
  if (migrationStateCache && Date.now() - migrationStateCache.cachedAt < MIGRATION_STATE_CACHE_TTL_MS) {
    return migrationStateCache.data;
  }
  const data = await migrationState(admin);
  migrationStateCache = { data, cachedAt: Date.now() };
  return data;
}

type SourceInfo = { track: string; competenceId: string; part: number | null; format: "standard" | "gmdss"; functionId: string; idPrefix: string };
const PRIVATE_TEXT_CACHE_TTL_MS = 60_000;
const privateTextCache = new Map<string, { text: string; cachedAt: number }>();
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
async function privateText(admin: any, path: string): Promise<string> {
  const cached = privateTextCache.get(path);
  if (cached && Date.now() - cached.cachedAt < PRIVATE_TEXT_CACHE_TTL_MS) return cached.text;
  const result = await admin.storage.from("question-banks").download(path);
  if (result.error || !result.data) throw new Error("Question asset is not available in private storage.");
  const text = await decryptToText(new Uint8Array(await result.data.arrayBuffer()));
  privateTextCache.set(path, { text, cachedAt: Date.now() });
  return text;
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
  const hi = headerIndex(rows, "standard");
  count = rows.slice(hi + 1).filter(validStandard).length;
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
    const rows = parseCsv(text), hi = headerIndex(rows, "standard");
    for (const row of rows.slice(hi + 1)) {
      if (!validStandard(row)) continue;
      records.push({ q: row[1].trim(), options: row.slice(2,6).map(x => x.trim()).filter(Boolean), explanation: (row[7] || "").trim(), answer: row[6].trim() });
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
async function authorizeTrack(admin: any, user: any, isAdmin: boolean, track: string): Promise<boolean> {
  if (!user) return canAccessPaidTrack({ userId: null, isAdmin, entitlement: null, track });
  if (isAdmin) return canAccessPaidTrack({ userId: user.id, isAdmin: true, entitlement: null, track });
  const entitlement = await loadEntitlement(admin, user.id, track);
  return canAccessPaidTrack({ userId: user.id, isAdmin: false, entitlement, track });
}
const FREE_FINGERPRINT_CACHE_TTL_MS = 30_000;
const freeQuestionFingerprintCache = new Map<string, { fingerprints: Set<string>; cachedAt: number }>();
const fullQuestionFingerprintCache = new Map<string, { fingerprints: Set<string>; cachedAt: number }>();
function questionIdBelongsToTrack(id: string, track: string) {
  if (track === "DECK_OIC_NW") return id.startsWith("D-");
  if (track === "GMDSS_GOC") return id.startsWith("G-");
  if (track === "ENGINE_OIC_EW") return id.startsWith("EW-");
  if (track === "DECK_MGT") return id.startsWith("DM-");
  if (track === "ENGINE_MGT") return id.startsWith("EM-");
  return false;
}
async function questionFingerprint(question: { questionText: string; options: string[]; correctAnswerIndex: number }): Promise<string> {
  if (!Number.isInteger(question.correctAnswerIndex) ||
      question.correctAnswerIndex < 0 ||
      question.correctAnswerIndex >= question.options.length) {
    throw new Error("Invalid correct answer index.");
  }
  const canonicalOptions = question.options
    .map((text, index) => ({ text, correct: index === question.correctAnswerIndex }))
    .sort((left, right) => {
      if (left.text < right.text) return -1;
      if (left.text > right.text) return 1;
      return Number(left.correct) - Number(right.correct);
    });
  const payload = new TextEncoder().encode(JSON.stringify([question.questionText, canonicalOptions]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}
async function freeQuestionFingerprints(admin: any, track: string): Promise<Set<string>> {
  const cached = freeQuestionFingerprintCache.get(track);
  if (cached && Date.now() - cached.cachedAt < FREE_FINGERPRINT_CACHE_TTL_MS) return cached.fingerprints;
  const fingerprints = new Set<string>();
  for (const path of SOURCE_ASSETS.filter(item => trackForPath(item) === track)) {
    const sample = sampleFreeCsv(path, await privateText(admin, path));
    const questions = toSearchQuestions(path, sample);
    const hashes = await Promise.all(questions.map(question => questionFingerprint({
      questionText: String(question.questionText),
      options: question.options as string[],
      correctAnswerIndex: Number(question.correctAnswerIndex)
    })));
    hashes.forEach(hash => fingerprints.add(hash));
  }
  freeQuestionFingerprintCache.set(track, { fingerprints, cachedAt: Date.now() });
  return fingerprints;
}
async function fullQuestionFingerprints(admin: any, track: string): Promise<Set<string>> {
  const cached = fullQuestionFingerprintCache.get(track);
  if (cached && Date.now() - cached.cachedAt < FREE_FINGERPRINT_CACHE_TTL_MS) return cached.fingerprints;
  const fingerprints = new Set<string>();
  for (const path of SOURCE_ASSETS.filter(item => trackForPath(item) === track)) {
    const questions = toSearchQuestions(path, await privateText(admin, path));
    const hashes = await Promise.all(questions.map(question => questionFingerprint({
      questionText: String(question.questionText),
      options: question.options as string[],
      correctAnswerIndex: Number(question.correctAnswerIndex)
    })));
    hashes.forEach(hash => fingerprints.add(hash));
  }
  fullQuestionFingerprintCache.set(track, { fingerprints, cachedAt: Date.now() });
  return fingerprints;
}

type OfflineSigningKeys = { private_jwk: JsonWebKey; public_jwk: JsonWebKey };
const OFFLINE_TRACK_IDS = ["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"];

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loadOrCreateOfflineSigningKeys(admin: any): Promise<OfflineSigningKeys> {
  const table = "offline_entitlement_signing_keys";
  const readExisting = () => admin.from(table)
    .select("private_jwk,public_jwk").eq("id", 1).maybeSingle();
  const current = await readExisting();
  if (current.error) throw new Error("Could not read offline signing keys.");
  if (current.data?.private_jwk && current.data?.public_jwk) return current.data as OfflineSigningKeys;

  // Create a single ECDSA P-256 keypair. Concurrent first calls race through
  // INSERT ... ON CONFLICT DO NOTHING, then all callers read the winning row.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const inserted = await admin.from(table).upsert(
    { id: 1, private_jwk: privateJwk, public_jwk: publicJwk },
    { onConflict: "id", ignoreDuplicates: true }
  );
  if (inserted.error) throw new Error("Could not initialize offline signing keys.");

  const saved = await readExisting();
  if (saved.error || !saved.data?.private_jwk || !saved.data?.public_jwk) {
    throw new Error("Offline signing keys are unavailable.");
  }
  return saved.data as OfflineSigningKeys;
}

async function issueOfflineEntitlement(admin: any, user: any, isAdmin: boolean) {
  const now = Date.now();
  const tracks: Record<string, number> = {};
  if (isAdmin) {
    const offlineAdminExpiry = now + 7 * 24 * 60 * 60 * 1000;
    for (const track of OFFLINE_TRACK_IDS) tracks[track] = offlineAdminExpiry;
  } else {
    const [website, play] = await Promise.all([
      admin.from("entitlements").select("track_id,expires_at")
        .eq("user_id", user.id).eq("status", "active").gt("expires_at", new Date(now).toISOString()),
      admin.from("google_play_entitlements").select("track_id,expires_at")
        .eq("user_id", user.id).eq("status", "active").gt("expires_at", new Date(now).toISOString())
    ]);
    const playTableMissing = isMissingGooglePlayEntitlementsTable(play.error);
    if (website.error || (play.error && !playTableMissing)) throw new Error("Could not verify current offline licenses.");
    for (const row of [...(website.data ?? []), ...(playTableMissing ? [] : (play.data ?? []))]) {
      if (!OFFLINE_TRACK_IDS.includes(row.track_id)) continue;
      const expiry = Date.parse(row.expires_at);
      if (Number.isFinite(expiry) && expiry > now) {
        tracks[row.track_id] = Math.max(tracks[row.track_id] ?? 0, expiry);
      }
    }
  }

  const claims = { v: 1, userId: user.id, issuedAt: now, tracks };
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const keys = await loadOrCreateOfflineSigningKeys(admin);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    keys.private_jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signed = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(payload)
  );
  return {
    token: payload + "." + encodeBase64Url(new Uint8Array(signed)),
    issuedAt: now,
    trackIds: Object.keys(tracks)
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: "Question service is not configured." }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let body: { action?: string; path?: string; csvText?: string; uploadFormat?: string; encryptedBase64?: string; track?: string; competenceId?: string; part?: number; query?: string; offset?: number; limit?: number; randomSample?: boolean; freeOnly?: boolean; questionIds?: unknown; fingerprints?: unknown; items?: unknown; paths?: unknown };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid request body." }, 400); }
  let user: any = null, isAdmin = false;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const result = await authClient.auth.getUser();
    if (!result.error && result.data.user) { user = result.data.user; isAdmin = isAdminEmail(user.email); }
  }

  if (body.action === "optimize-storage-cache") {
    if (!user || !isAdmin) return json(req, { error: "Forbidden." }, 403);

    let state: any;
    try { state = await cachedMigrationState(admin); } catch {
      return json(req, { error: "Could not verify the private question bank before cache optimization." }, 503);
    }
    if (state.status !== "complete" || state.asset_count !== SOURCE_ASSETS.length) {
      return json(req, { error: "The private question bank is not fully verified. No cache settings were changed." }, 409);
    }

    const { data: controls, error: controlsError } = await admin.rpc("get_question_bank_object_cache_controls", {
      p_names: SOURCE_ASSETS
    });
    if (controlsError || !Array.isArray(controls)) {
      return json(req, { error: "Could not read question-bank cache settings." }, 503);
    }
    const controlByName = new Map<string, string>(
      controls.map((item: any) => [String(item.name), String(item.cache_control ?? "")])
    );
    const toUpdate = SOURCE_ASSETS.filter(path => controlByName.get(path) !== "max-age=3600");
    const skipped = SOURCE_ASSETS.length - toUpdate.length;
    const beforeResult = await admin.rpc("get_question_bank_object_versions", { p_names: toUpdate });
    if (beforeResult.error || !Array.isArray(beforeResult.data)) {
      return json(req, { error: "Could not verify source files before cache optimization." }, 503);
    }
    const beforeByName = new Map<string, { etag: string; size: number }>(
      beforeResult.data.map((item: any) => [String(item.name), {
        etag: String(item.etag ?? ""),
        size: Number(item.size)
      }])
    );
    const failures: string[] = [];
    let updated = 0;
    const bucket = admin.storage.from("question-banks");

    for (let offset = 0; offset < toUpdate.length; offset += 4) {
      const group = toUpdate.slice(offset, offset + 4);
      const results = await Promise.all(group.map(async path => {
        try {
          const existing = await bucket.download(path);
          if (existing.error || !existing.data) throw new Error("private download failed");
          const bytes = new Uint8Array(await existing.data.arrayBuffer());
          const prior = beforeByName.get(path);
          if (!prior || !prior.etag || !Number.isFinite(prior.size) || bytes.byteLength !== prior.size) {
            throw new Error("source size or version verification failed");
          }
          const uploaded = await bucket.upload(path, bytes, {
            contentType: "application/octet-stream",
            cacheControl: "3600",
            upsert: true
          });
          if (uploaded.error) throw new Error("cache header update failed");
          privateTextCache.delete(path);
          const track = trackForPath(path);
          if (track) {
            freeQuestionFingerprintCache.delete(track);
            fullQuestionFingerprintCache.delete(track);
          }
          return { path, ok: true };
        } catch {
          return { path, ok: false };
        }
      }));
      updated += results.filter(item => item.ok).length;
      failures.push(...results.filter(item => !item.ok).map(item => item.path));
    }

    const [afterControls, afterVersions] = await Promise.all([
      admin.rpc("get_question_bank_object_cache_controls", { p_names: SOURCE_ASSETS }),
      admin.rpc("get_question_bank_object_versions", { p_names: toUpdate })
    ]);
    if (afterControls.error || !Array.isArray(afterControls.data) ||
        afterVersions.error || !Array.isArray(afterVersions.data)) {
      return json(req, { error: "Cache policy updates ran, but final verification could not be completed.", updated, skipped, failed: failures.length }, 503);
    }

    const finalControls = new Map<string, string>(
      afterControls.data.map((item: any) => [String(item.name), String(item.cache_control ?? "")])
    );
    const afterByName = new Map<string, { etag: string; size: number }>(
      afterVersions.data.map((item: any) => [String(item.name), {
        etag: String(item.etag ?? ""),
        size: Number(item.size)
      }])
    );
    const contentChanged = toUpdate.filter(path => {
      const before = beforeByName.get(path);
      const after = afterByName.get(path);
      return !before || !after || before.etag !== after.etag || before.size !== after.size;
    });
    const notOptimized = SOURCE_ASSETS.filter(path => finalControls.get(path) !== "max-age=3600");
    if (contentChanged.length || notOptimized.length || failures.length) {
      return json(req, {
        error: "Cache optimization did not pass final verification. The existing encrypted files remain private.",
        updated,
        skipped,
        failed: failures.length,
        failedAssets: failures.slice(0, 12),
        contentChangedAssets: contentChanged.slice(0, 12),
        remainingAssets: notOptimized.slice(0, 12)
      }, 503);
    }

    return json(req, {
      ok: true,
      cacheControl: "max-age=3600",
      assetCount: SOURCE_ASSETS.length,
      updated,
      skipped,
      failed: 0,
      contentChanged: 0,
      bucketPrivate: true
    });
  }

  if (body.action === "list-update-assets") {
    if (!user || !isAdmin) return json(req, { error: "Forbidden." }, 403);
    const labels: Record<string, string> = {
      DECK_OIC_NW: "Deck OIC-NW", GMDSS_GOC: "GMDSS GOC",
      ENGINE_OIC_EW: "Engine OIC-EW", DECK_MGT: "Deck Management", ENGINE_MGT: "Engine Management"
    };
    const assets = SOURCE_ASSETS.map(path => {
      const info = sourceInfo(path);
      return info ? { path, track: info.track, competenceId: info.competenceId, part: info.part, format: info.format,
        label: labels[info.track] + " · " + info.competenceId + (info.part == null ? "" : " · Part " + info.part) } : null;
    }).filter(Boolean);
    return json(req, { assets });
  }

  if (body.action === "update-csv") {
    if (!user || !isAdmin) return json(req, { error: "Forbidden." }, 403);
    const path = body.path;
    if (typeof path !== "string" || !SOURCE_ASSETS.includes(path)) return json(req, { error: "Choose a supported question-bank file." }, 400);
    if (body.uploadFormat !== "csv" && body.uploadFormat !== "encrypted") return json(req, { error: "Choose a raw CSV or compatible encrypted CSV file." }, 400);

    let csvText = "";
    let plainBytes: Uint8Array;
    let replacementBytes: Uint8Array;
    if (body.uploadFormat === "encrypted") {
      if (typeof body.encryptedBase64 !== "string" || body.encryptedBase64.length > 1400000 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.encryptedBase64)) {
        return json(req, { error: "Encrypted CSV data is missing or invalid." }, 400);
      }
      try {
        const binary = atob(body.encryptedBase64);
        replacementBytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        if (replacementBytes.length < 28 || replacementBytes.length > 1048576) return json(req, { error: "Encrypted CSV must be between 28 bytes and 1 MiB." }, 413);
        csvText = await decryptToText(replacementBytes);
        plainBytes = new TextEncoder().encode(csvText);
      } catch {
        return json(req, { error: "This .csv.enc file could not be decrypted with Hyperion's current key. No file was changed." }, 400);
      }
    } else {
      if (typeof body.csvText !== "string") return json(req, { error: "Raw CSV text is missing." }, 400);
      csvText = body.csvText.charCodeAt(0) === 0xFEFF ? body.csvText.slice(1) : body.csvText;
      plainBytes = new TextEncoder().encode(csvText);
      if (plainBytes.length < 20 || plainBytes.length > 700000) return json(req, { error: "Raw CSV must be between 20 bytes and 700 KB." }, 413);
      replacementBytes = new Uint8Array(0);
    }

    if (plainBytes.length < 20 || plainBytes.length > 700000) return json(req, { error: "Decrypted CSV must be between 20 bytes and 700 KB." }, 413);
    if (!csvText.trim() || !csvText.includes(",")) return json(req, { error: "The file does not look like a CSV." }, 400);
    let questionCount = 0;
    try {
      if (path.startsWith("gmdss/")) questionCount = validGmdssRows(csvText).length;
      else {
        const rows = parseCsv(csvText);
        questionCount = rows.slice(headerIndex(rows, "standard") + 1).filter(validStandard).length;
      }
    } catch {
      return json(req, { error: "Could not parse CSV. Check quotes, commas, and columns." }, 400);
    }
    if (!questionCount) return json(req, { error: "No valid question rows were found." }, 400);

    let state: any;
    try { state = await migrationState(admin); } catch { return json(req, { error: "Could not verify the private question bank." }, 503); }
    if (state.status !== "complete" || state.asset_count !== SOURCE_ASSETS.length) return json(req, { error: "Private question bank is not marked complete; no file was changed." }, 503);
    const bucket = admin.storage.from("question-banks");
    const previous = await bucket.download(path);
    if (previous.error || !previous.data) return json(req, { error: "Could not read the existing private file. No replacement was made." }, 500);
    const stamp = new Date().toISOString().replace(/[^0-9TZ-]/g, "-");
    const backupPath = "_backups/" + path.replaceAll("/", "__") + "." + stamp + ".bak.enc";
    const backupBytes = new Uint8Array(await previous.data.arrayBuffer());
    const backup = await bucket.upload(backupPath, backupBytes, { contentType: "application/octet-stream", cacheControl: "0", upsert: false });
    if (backup.error) return json(req, { error: "Could not save a private backup. No file was changed." }, 500);
    try {
      if (body.uploadFormat === "csv") {
        const ivBytes = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey("raw", toArrayBuffer(deriveKeyBytes()), { name: "AES-GCM" }, false, ["encrypt"]);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
          name: "AES-GCM",
          iv: toArrayBuffer(ivBytes),
          tagLength: 128
        }, key, toArrayBuffer(plainBytes)));
        replacementBytes = new Uint8Array(ivBytes.length + ciphertext.length);
        replacementBytes.set(ivBytes, 0);
        replacementBytes.set(ciphertext, ivBytes.length);
      }
      const upload = await bucket.upload(path, replacementBytes, { contentType: "application/octet-stream", cacheControl: "3600", upsert: true });
      if (upload.error) return json(req, { error: "Replacement failed. Previous file backed up at " + backupPath + "." }, 500);
      privateTextCache.delete(path);
      const updatedTrack = trackForPath(path);
      if (updatedTrack) freeQuestionFingerprintCache.delete(updatedTrack);
      return json(req, { ok: true, path, uploadFormat: body.uploadFormat, questionCount, backupPath, updatedAt: new Date().toISOString() });
    } catch {
      return json(req, { error: "Could not encrypt or publish this CSV. Previous file backed up at " + backupPath + "." }, 500);
    }
  }

  if (body.action === "status" || body.action === "migrate") {
    if (!user || !isAdmin) return json(req, { error: "Forbidden." }, 403);
    let state: any;
    try { state = await migrationState(admin); } catch { return json(req, { error: "Could not read migration state." }, 500); }
    if (body.action === "status") return json(req, { status: state.status, assetCount: state.asset_count, errorSummary: state.error_summary, updatedAt: state.updated_at, expectedAssets: SOURCE_ASSETS.length });
    if (state.status === "complete" && state.asset_count === SOURCE_ASSETS.length) return json(req, { status: "complete", assetCount: state.asset_count, expectedAssets: SOURCE_ASSETS.length });
    if (state.status === "running" && Date.now() - new Date(state.updated_at).getTime() < 5 * 60 * 1000) return json(req, { error: "A question-bank migration is already running." }, 409);
    await admin.from("question_bank_migration_state").update({ status: "running", error_summary: null, updated_at: new Date().toISOString() }).eq("id", 1);
    migrationStateCache = null;
    const failures: string[] = [];
    let copied = 0;
    for (let i = 0; i < SOURCE_ASSETS.length; i += 4) {
      const group = SOURCE_ASSETS.slice(i, i + 4);
      const outcomes = await Promise.all(group.map(async (assetPath) => {
        try {
          const response = await fetch("https://hyperionmaritime.org/questions/" + assetPath, { cache: "no-store" });
          if (!response.ok) throw new Error("source HTTP " + response.status);
          const type = response.headers.get("content-type") || "";
          if (type.includes("text/html")) throw new Error("source returned HTML, not an asset");
          const buffer = new Uint8Array(await response.arrayBuffer());
          if (buffer.length < 28 || buffer.length > 1024 * 1024) throw new Error("asset size was invalid");
          const result = await admin.storage.from("question-banks").upload(assetPath, buffer, { contentType: "application/octet-stream", cacheControl: "3600", upsert: true });
          if (result.error) throw new Error("private storage upload failed");
          return { assetPath, ok: true };
        } catch (error) {
          return { assetPath, ok: false, error: error instanceof Error ? error.message : "copy failed" };
        }
      }));
      copied += outcomes.filter(x => x.ok).length;
      failures.push(...outcomes.filter(x => !x.ok).map(x => x.assetPath + ": " + x.error));
      await admin.from("question_bank_migration_state").update({ asset_count: copied, updated_at: new Date().toISOString() }).eq("id", 1);
    }
    if (failures.length) {
      await admin.from("question_bank_migration_state").update({ status: "failed", asset_count: copied, error_summary: failures.slice(0, 12).join("; ").slice(0, 1800), updated_at: new Date().toISOString() }).eq("id", 1);
      return json(req, { error: "Some question files could not be copied. Public files were not deleted.", status: "failed", assetCount: copied, expectedAssets: SOURCE_ASSETS.length, failedAssets: failures.slice(0, 12) }, 502);
    }
    await admin.from("question_bank_migration_state").update({ status: "complete", asset_count: copied, error_summary: null, updated_at: new Date().toISOString() }).eq("id", 1);
    migrationStateCache = null;
    return json(req, { status: "complete", assetCount: copied, expectedAssets: SOURCE_ASSETS.length, message: "Encrypted question files are safely copied to private storage. Public copies still need removal in a follow-up deployment after migration is verified." });
  }
  let state: any;
  try { state = await cachedMigrationState(admin); } catch { return json(req, { error: "Question service is not ready." }, 503); }
  if (state.status !== "complete" || state.asset_count !== SOURCE_ASSETS.length) return json(req, { error: "Protected question bank is not ready yet." }, 503);

  if (body.action === "content-versions") {
    const track = typeof body.track === "string" ? body.track : "";
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) {
      return json(req, { error: "Choose a valid track." }, 400);
    }

    try {
      const canReadFullBank = await authorizeTrack(admin, user, isAdmin, track);
      const sources = SOURCE_ASSETS
        .filter(path => trackForPath(path) === track)
        .map(path => ({ path, info: sourceInfo(path) }))
        .filter(item => item.info !== null)
        .sort((left, right) =>
          left.info!.competenceId.localeCompare(right.info!.competenceId, undefined, { numeric: true }) ||
          ((left.info!.part ?? 0) - (right.info!.part ?? 0))
        );

      // A question-bank update changes the Storage object's ETag/updated_at.
      // Use that metadata as a stable version marker instead of downloading and
      // hashing every encrypted file on every client's periodic update check.
      const { data: objects, error: objectError } = await admin.rpc("get_question_bank_object_versions", {
        p_names: sources.map(source => source.path)
      });
      if (objectError || !Array.isArray(objects)) throw new Error("Question-bank object metadata is unavailable.");

      const byName = new Map<string, any>(objects.map((item: any) => [String(item.name), item]));
      const versions = [];
      for (const source of sources) {
        const object = byName.get(source.path);
        const etag = typeof object?.etag === "string" ? object.etag : "";
        const updatedAt = typeof object?.updated_at === "string" ? object.updated_at : "";
        const size = Number(object?.size);
        if (!etag || !updatedAt || !Number.isFinite(size) || size <= 0) {
          throw new Error("A question-bank source is missing version metadata.");
        }
        // ETag + size identify the object content. Exclude updated_at because a
        // cache-header-only metadata refresh must not mark every offline pack stale.
        const versionBytes = new TextEncoder().encode(JSON.stringify([source.path, etag, size]));
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", versionBytes));
        const sourceVersion = Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
        versions.push({
          path: source.path,
          competenceId: source.info!.competenceId,
          part: source.info!.part,
          freeHash: sourceVersion,
          ...(canReadFullBank ? { fullHash: sourceVersion } : {})
        });
      }
      if (versions.length !== sources.length) throw new Error("One or more question-bank version records are missing.");
      return json(req, {
        track,
        versions,
        versionFormat: "storage-metadata-v1",
        checkedAt: Date.now(),
        fullBankIncluded: canReadFullBank
      });
    } catch {
      return json(req, { error: "Could not verify the latest question-bank version. Please try again while connected." }, 503);
    }
  }

  // Used only once to migrate older offline manifests from content hashes to
  // Storage metadata versions. Normal update checks never download whole files.
  if (body.action === "content-versions-legacy") {
    const track = typeof body.track === "string" ? body.track : "";
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) {
      return json(req, { error: "Choose a valid track." }, 400);
    }

    try {
      const canReadFullBank = await authorizeTrack(admin, user, isAdmin, track);
      const sources = SOURCE_ASSETS
        .filter(path => trackForPath(path) === track)
        .map(path => ({ path, info: sourceInfo(path) }))
        .filter(item => item.info !== null)
        .sort((left, right) =>
          left.info!.competenceId.localeCompare(right.info!.competenceId, undefined, { numeric: true }) ||
          ((left.info!.part ?? 0) - (right.info!.part ?? 0))
        );
      const versions = [];
      const hashQuestions = async (questions: Record<string, unknown>[]) => {
        const bytes = new TextEncoder().encode(JSON.stringify(questions));
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
      };
      for (const source of sources) {
        const text = await privateText(admin, source.path);
        const version: Record<string, unknown> = {
          path: source.path,
          competenceId: source.info!.competenceId,
          part: source.info!.part,
          freeHash: await hashQuestions(toSearchQuestions(source.path, sampleFreeCsv(source.path, text)))
        };
        if (canReadFullBank) {
          version.fullHash = await hashQuestions(toSearchQuestions(source.path, text));
        }
        versions.push(version);
      }
      return json(req, { track, versions, versionFormat: "content-sha256-v1", checkedAt: Date.now(), fullBankIncluded: canReadFullBank });
    } catch {
      return json(req, { error: "Could not verify legacy question-bank versions. Please try again while connected." }, 503);
    }
  }

  if (body.action === "offline-license-public-key") {
    try {
      const keys = await loadOrCreateOfflineSigningKeys(admin);
      // Only the verification key is public. Never return private_jwk from this endpoint.
      return json(req, { publicKey: {
        kty: keys.public_jwk.kty,
        crv: keys.public_jwk.crv,
        x: keys.public_jwk.x,
        y: keys.public_jwk.y,
        ext: true,
        key_ops: ["verify"]
      }});
    } catch {
      return json(req, { error: "Offline license verification is not configured." }, 503);
    }
  }

  if (body.action === "offline-license") {
    if (!user) return json(req, { error: "Sign in to refresh offline access." }, 401);
    try {
      const license = await issueOfflineEntitlement(admin, user, isAdmin);
      return json(req, { token: license.token, issuedAt: license.issuedAt, trackIds: license.trackIds });
    } catch {
      return json(req, { error: "Could not issue a verified offline license. Reconnect and try again." }, 503);
    }
  }

  if (body.action === "authorize-progress-snapshot") {
    const normalizeCollection = (value: unknown): { index: number; track: string; id: string; fingerprint: string }[] | null => {
      if (!Array.isArray(value) || value.length > 1000) return null;
      const seenIndexes = new Set<number>();
      const items: { index: number; track: string; id: string; fingerprint: string }[] = [];
      for (const item of value) {
        if (!item || !Number.isInteger(item.index) || item.index < 0 ||
            typeof item.track !== "string" || !OFFLINE_TRACK_IDS.includes(item.track) ||
            typeof item.id !== "string" || item.id.length < 1 || item.id.length > 120 ||
            typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint) ||
            seenIndexes.has(item.index)) return null;
        seenIndexes.add(item.index);
        items.push({ index: item.index, track: item.track, id: item.id, fingerprint: item.fingerprint });
      }
      return items;
    };
    const bookmarkItems = normalizeCollection((body as any).bookmarkItems);
    const vaultItems = normalizeCollection((body as any).vaultItems);
    const normalizeSession = (value: any): { track: string; questions: { id: string; fingerprint: string }[] } | null | false => {
      if (value == null) return null;
      if (!value || typeof value.track !== "string" || !OFFLINE_TRACK_IDS.includes(value.track) ||
          !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3000 ||
          value.questions.some((q: any) => !q || typeof q.id !== "string" || q.id.length < 1 || q.id.length > 120 ||
            typeof q.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(q.fingerprint))) return false;
      return { track: value.track, questions: value.questions.map((q: any) => ({ id: q.id, fingerprint: q.fingerprint })) };
    };
    const legacySavedPractice = normalizeSession((body as any).legacySavedPractice);
    const activeSession = normalizeSession((body as any).activeSession);
    if (!bookmarkItems || !vaultItems || legacySavedPractice === false || activeSession === false) {
      return json(req, { error: "Invalid progress authorization request." }, 400);
    }

    const fingerprintSets = new Map<string, Promise<Set<string>>>();
    const fingerprintsFor = (track: string, full: boolean) => {
      const key = track + (full ? ":full" : ":free");
      let pending = fingerprintSets.get(key);
      if (!pending) {
        pending = full ? fullQuestionFingerprints(admin, track) : freeQuestionFingerprints(admin, track);
        fingerprintSets.set(key, pending);
      }
      return pending;
    };
    const accessByTrack = new Map<string, Promise<boolean>>();
    const trackIsLicensed = (track: string) => {
      let pending = accessByTrack.get(track);
      if (!pending) {
        pending = authorizeTrack(admin, user, isAdmin, track);
        accessByTrack.set(track, pending);
      }
      return pending;
    };
    const itemAllowed = async (item: { track: string; id: string; fingerprint: string }) => {
      if (await trackIsLicensed(item.track)) {
        if (questionIdBelongsToTrack(item.id, item.track)) return true;
        return (await fingerprintsFor(item.track, true)).has(item.fingerprint);
      }
      return (await fingerprintsFor(item.track, false)).has(item.fingerprint);
    };
    const authorizeCollection = async (items: { index: number; track: string; id: string; fingerprint: string }[]) => {
      const allowed: number[] = [];
      for (const item of items) {
        if (await itemAllowed(item)) allowed.push(item.index);
      }
      return allowed;
    };
    const authorizeSession = async (session: { track: string; questions: { id: string; fingerprint: string }[] } | null) => {
      if (!session) return true;
      if (await trackIsLicensed(session.track)) {
        if (session.questions.every(q => questionIdBelongsToTrack(q.id, session.track))) return true;
        const fingerprints = await fingerprintsFor(session.track, true);
        return session.questions.every(q => fingerprints.has(q.fingerprint));
      }
      const fingerprints = await fingerprintsFor(session.track, false);
      return session.questions.every(q => fingerprints.has(q.fingerprint));
    };

    try {
      const [allowedBookmarks, allowedVault, legacyAllowed, activeAllowed] = await Promise.all([
        authorizeCollection(bookmarkItems),
        authorizeCollection(vaultItems),
        authorizeSession(legacySavedPractice),
        authorizeSession(activeSession)
      ]);
      return json(req, {
        bookmarkAllowedIndexes: allowedBookmarks,
        vaultAllowedIndexes: allowedVault,
        legacySavedPracticeAllowed: legacyAllowed,
        activeSessionAllowed: activeAllowed
      });
    } catch {
      return json(req, { error: "Could not verify saved question access." }, 503);
    }
  }

  if (body.action === "authorize-saved-questions") {
    const track = body.track || "";
    const items = body.items;
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) {
      return json(req, { allowedIndexes: [], error: "Invalid track." }, 400);
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 1000 ||
        items.some(item => !item || typeof item.id !== "string" || item.id.length < 1 || item.id.length > 120 ||
          typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint))) {
      return json(req, { allowedIndexes: [], error: "Invalid saved question set." }, 400);
    }
    try {
      if (await authorizeTrack(admin, user, isAdmin, track)) {
        if (items.every(item => questionIdBelongsToTrack(item.id, track))) {
          return json(req, { allowedIndexes: items.map((_, index) => index), access: isAdmin ? "admin" : "licensed" });
        }
        // Older app versions used different question ID prefixes. Recover only those
        // entries whose content fingerprint matches the private source bank for this
        // exact track; never use a legacy ID alone to grant cross-track access.
        const allowedFingerprints = await fullQuestionFingerprints(admin, track);
        const allowedIndexes = items.flatMap((item, index) => allowedFingerprints.has(item.fingerprint) ? [index] : []);
        return json(req, { allowedIndexes, access: isAdmin ? "admin" : "licensed" });
      }
      const allowedFingerprints = await freeQuestionFingerprints(admin, track);
      const allowedIndexes = items.flatMap((item, index) => allowedFingerprints.has(item.fingerprint) ? [index] : []);
      return json(req, { allowedIndexes, access: "free-sample" });
    } catch {
      return json(req, { error: "Could not verify saved question access." }, 503);
    }
  }

  if (body.action === "authorize-session") {
    const track = body.track || "";
    const questionIds = body.questionIds;
    const fingerprints = body.fingerprints;
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) return json(req, { allowed: false, error: "Invalid track." }, 400);
    if (!Array.isArray(questionIds) || questionIds.length < 1 || questionIds.length > 3000 ||
        questionIds.some(id => typeof id !== "string" || id.length < 1 || id.length > 120) ||
        !Array.isArray(fingerprints) || fingerprints.length !== questionIds.length ||
        fingerprints.some(hash => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) {
      return json(req, { allowed: false, error: "Invalid question set." }, 400);
    }
    try {
      if (await authorizeTrack(admin, user, isAdmin, track)) {
        if (questionIds.every(id => questionIdBelongsToTrack(id, track))) {
          return json(req, { allowed: true, access: isAdmin ? "admin" : "licensed" });
        }
        // Backwards-compatible recovery for archived sessions written by older app
        // versions with different IDs. The question content must match this track's
        // server-side private bank before allowing a legacy session to resume.
        const trackFingerprints = await fullQuestionFingerprints(admin, track);
        const allowed = fingerprints.every(hash => trackFingerprints.has(hash as string));
        return json(req, { allowed, access: allowed ? (isAdmin ? "admin" : "licensed") : "denied" }, allowed ? 200 : 403);
      }
      const allowedFingerprints = await freeQuestionFingerprints(admin, track);
      const allowed = fingerprints.every(hash => allowedFingerprints.has(hash as string));
      return json(req, { allowed, access: allowed ? "free-sample" : "denied" }, allowed ? 200 : 403);
    } catch {
      return json(req, { allowed: false, error: "Could not verify question access." }, 503);
    }
  }

  if (body.action === "free-track-files") {
    const track = typeof body.track === "string" ? body.track : "";
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) {
      return json(req, { error: "Choose a valid track." }, 400);
    }

    // This route exposes only the existing official free sample. One compressed
    // response replaces one Edge Function invocation per source CSV file.
    const trackPaths = SOURCE_ASSETS.filter(path => trackForPath(path) === track);
    let paths = trackPaths;
    if (body.paths !== undefined) {
      if (!Array.isArray(body.paths) || body.paths.length < 1 ||
          body.paths.length > trackPaths.length ||
          body.paths.some((path: unknown) => typeof path !== "string" || !trackPaths.includes(path)) ||
          new Set(body.paths).size !== body.paths.length) {
        return json(req, { error: "Choose valid question files for this track." }, 400);
      }
      paths = body.paths as string[];
    }
    const files: { path: string; text: string }[] = [];
    try {
      for (let offset = 0; offset < paths.length; offset += 4) {
        const group = paths.slice(offset, offset + 4);
        const batch = await Promise.all(group.map(async path => ({
          path,
          text: sampleFreeCsv(path, await privateText(admin, path))
        })));
        files.push(...batch);
      }
      return json(req, { track, access: "free-sample", files });
    } catch {
      return json(req, { error: "Could not load the official free question sample for this track." }, 503);
    }
  }

  if (body.action === "questions") {
    const track = body.track || "";
    const competenceId = body.competenceId || "";
    const part = body.part == null ? null : Number(body.part);
    const offset = Number.isSafeInteger(body.offset) ? Math.max(0, Number(body.offset)) : 0;
    const limit = Number.isSafeInteger(body.limit) ? Number(body.limit) : 100;
    const randomSample = body.randomSample === true;
    const freeOnly = body.freeOnly === true;
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track) ||
        !/^C\d{1,2}$/.test(competenceId)) return json(req, { error: "Choose a valid track and competence." }, 400);
    if (limit < 1 || limit > 200 || offset > 100000 || (randomSample && offset !== 0)) {
      return json(req, { error: "Question requests must use a valid range of at most 200 items." }, 400);
    }
    if (part !== null && (track !== "GMDSS_GOC" || !Number.isInteger(part) || part < 1 || part > (competenceId === "C1" ? 10 : 2))) {
      return json(req, { error: "Invalid GMDSS question part." }, 400);
    }
    if (!freeOnly) {
      try {
        if (!await authorizeTrack(admin, user, isAdmin, track)) return json(req, { error: "An active license is required to retrieve these questions." }, user ? 403 : 401);
      } catch { return json(req, { error: "Could not verify your license. Please refresh and try again." }, 503); }
    }
    try {
      const paths = SOURCE_ASSETS.filter(path => {
        const info = sourceInfo(path);
        return info?.track === track && info.competenceId === competenceId && (part === null || info.part === part);
      }).sort((left, right) => (sourceInfo(left)?.part ?? 0) - (sourceInfo(right)?.part ?? 0));
      const allQuestions: Record<string, unknown>[] = [];
      for (const assetPath of paths) {
        let text = await privateText(admin, assetPath);
        if (freeOnly) text = sampleFreeCsv(assetPath, text);
        allQuestions.push(...toSearchQuestions(assetPath, text));
      }
      if (randomSample) {
        for (let i = allQuestions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
        }
      }
      const questions = randomSample ? allQuestions.slice(0, limit) : allQuestions.slice(offset, offset + limit);
      return json(req, { questions, totalCount: allQuestions.length, offset, limit, access: freeOnly ? "free-sample" : isAdmin ? "admin" : "licensed" });
    } catch {
      return json(req, { error: "The requested questions could not be loaded from private storage." }, 503);
    }
  }

  if (body.action === "counts") {
    const track = body.track || "";
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) return json(req, { error: "Invalid track." }, 400);
    const freeOnly = body.freeOnly === true;
    if (!freeOnly) {
      try {
        if (!await authorizeTrack(admin, user, isAdmin, track)) return json(req, { error: "An active license is required to access paid question counts." }, user ? 403 : 401);
      } catch { return json(req, { error: "Could not verify your license. Please refresh and try again." }, 503); }
    }
    try {
      const paths = SOURCE_ASSETS.filter(path => trackForPath(path) === track);
      const counts = [];
      for (const assetPath of paths) {
        const info = sourceInfo(assetPath);
        if (!info) continue;
        const text = await privateText(admin, assetPath);
        counts.push({ competenceId: info.competenceId, part: info.part, count: validQuestionCount(assetPath, text, freeOnly) });
      }
      return json(req, { counts, access: freeOnly ? "free-sample-counts" : isAdmin ? "admin" : "licensed" });
    } catch {
      return json(req, { error: "Could not read question metadata from private storage." }, 503);
    }
  }

  if (body.action === "flashcards") {
    const track = body.track || "";
    const competenceId = typeof body.competenceId === "string" ? body.competenceId : "";
    const limit = Math.max(1, Math.min(30, Math.floor(body.limit || 20)));
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) return json(req, { error: "Invalid track." }, 400);
    if (competenceId && !/^C\d{1,2}$/.test(competenceId)) return json(req, { error: "Invalid competence." }, 400);
    try {
      if (!await authorizeTrack(admin, user, isAdmin, track)) return json(req, { error: "An active license is required to open flashcards." }, user ? 403 : 401);
    } catch { return json(req, { error: "Could not verify your license. Please refresh and try again." }, 503); }
    try {
      const matchingPaths = SOURCE_ASSETS.filter(path => trackForPath(path) === track && (!competenceId || sourceInfo(path)?.competenceId === competenceId));
      const questions: Record<string, unknown>[] = [];
      for (const assetPath of matchingPaths) questions.push(...toSearchQuestions(assetPath, await privateText(admin, assetPath)));
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
      return json(req, { questions: questions.slice(0, limit), access: isAdmin ? "admin" : "licensed" });
    } catch {
      return json(req, { error: "Flashcards could not read the protected question bank." }, 503);
    }
  }

  if (body.action === "search") {
    const track = body.track || "";
    const query = (body.query || "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(40, Math.floor(body.limit || 40)));
    if (!["DECK_OIC_NW","GMDSS_GOC","ENGINE_OIC_EW","DECK_MGT","ENGINE_MGT"].includes(track)) return json(req, { error: "Invalid track." }, 400);
    if (query.length < 2 || query.length > 120) return json(req, { error: "Enter a search term between 2 and 120 characters." }, 400);
    try {
      if (!await authorizeTrack(admin, user, isAdmin, track)) return json(req, { error: "An active license is required to search this track." }, user ? 403 : 401);
    } catch { return json(req, { error: "Could not verify your license. Please refresh and try again." }, 503); }
    try {
      const hits: Record<string, unknown>[] = [];
      for (const assetPath of SOURCE_ASSETS.filter(path => trackForPath(path) === track)) {
        const all = toSearchQuestions(assetPath, await privateText(admin, assetPath));
        for (const item of all) {
          const question = String(item.questionText || "");
          const topic = String(item.topic || "");
          const competence = String(item.competenceId || "");
          const options = Array.isArray(item.options) ? item.options.join(" ") : "";
          if ((question + " " + topic + " " + competence + " " + options).toLowerCase().includes(query)) {
            hits.push(item);
            if (hits.length >= limit) return json(req, { questions: hits, access: isAdmin ? "admin" : "licensed" });
          }
        }
      }
      return json(req, { questions: hits, access: isAdmin ? "admin" : "licensed" });
    } catch {
      return json(req, { error: "Search service could not read the protected question bank." }, 503);
    }
  }

  if (body.action !== "get" || typeof body.path !== "string" || !SOURCE_ASSETS.includes(body.path) || body.freeOnly !== true) {
    return json(req, { error: "Raw paid-bank delivery is disabled. Use paginated question delivery." }, 400);
  }
  // Temporary free-only compatibility path for the mock-exam directory and the
  // one-time migration bridge. Paid question files are never returned as CSV.
  const track = trackForPath(body.path);
  if (!track) return json(req, { error: "Invalid track." }, 400);
  try {
    const text = await privateText(admin, body.path);
    return json(req, { text: sampleFreeCsv(body.path, text), access: "free-sample" });
  } catch {
    return json(req, { error: "Free sample could not be processed." }, 503);
  }
});
