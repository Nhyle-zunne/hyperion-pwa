import { createClient } from "npm:@supabase/supabase-js@2";

const SOURCE_ASSETS: string[] = ["deck/oic_nw_c1.csv.enc","deck/oic_nw_c10.csv.enc","deck/oic_nw_c11.csv.enc","deck/oic_nw_c12.csv.enc","deck/oic_nw_c13.csv.enc","deck/oic_nw_c17.csv.enc","deck/oic_nw_c2.csv.enc","deck/oic_nw_c3.csv.enc","deck/oic_nw_c4.csv.enc","deck/oic_nw_c5.csv.enc","deck/oic_nw_c7.csv.enc","deck/oic_nw_c9.csv.enc","deck_mgt/dm_c1.csv.enc","deck_mgt/dm_c10.csv.enc","deck_mgt/dm_c11.csv.enc","deck_mgt/dm_c12.csv.enc","deck_mgt/dm_c13.csv.enc","deck_mgt/dm_c14.csv.enc","deck_mgt/dm_c15.csv.enc","deck_mgt/dm_c16.csv.enc","deck_mgt/dm_c17.csv.enc","deck_mgt/dm_c18.csv.enc","deck_mgt/dm_c2.csv.enc","deck_mgt/dm_c20.csv.enc","deck_mgt/dm_c3.csv.enc","deck_mgt/dm_c4.csv.enc","deck_mgt/dm_c5.csv.enc","deck_mgt/dm_c6.csv.enc","deck_mgt/dm_c8.csv.enc","deck_mgt/dm_c9.csv.enc","engine_ew/ew_c1.csv.enc","engine_ew/ew_c10.csv.enc","engine_ew/ew_c11.csv.enc","engine_ew/ew_c15.csv.enc","engine_ew/ew_c16.csv.enc","engine_ew/ew_c2.csv.enc","engine_ew/ew_c3.csv.enc","engine_ew/ew_c4.csv.enc","engine_ew/ew_c5.csv.enc","engine_ew/ew_c6.csv.enc","engine_ew/ew_c7.csv.enc","engine_ew/ew_c8.csv.enc","engine_ew/ew_c9.csv.enc","engine_mgt/em_c1.csv.enc","engine_mgt/em_c10.csv.enc","engine_mgt/em_c11.csv.enc","engine_mgt/em_c12.csv.enc","engine_mgt/em_c13.csv.enc","engine_mgt/em_c14.csv.enc","engine_mgt/em_c2.csv.enc","engine_mgt/em_c3.csv.enc","engine_mgt/em_c4.csv.enc","engine_mgt/em_c5.csv.enc","engine_mgt/em_c6.csv.enc","engine_mgt/em_c7.csv.enc","engine_mgt/em_c8.csv.enc","engine_mgt/em_c9.csv.enc","gmdss/c1_part1.csv.enc","gmdss/c1_part10.csv.enc","gmdss/c1_part2.csv.enc","gmdss/c1_part3.csv.enc","gmdss/c1_part4.csv.enc","gmdss/c1_part5.csv.enc","gmdss/c1_part6.csv.enc","gmdss/c1_part7.csv.enc","gmdss/c1_part8.csv.enc","gmdss/c1_part9.csv.enc","gmdss/c2_part1.csv.enc","gmdss/c2_part2.csv.enc"];
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  return new Response(JSON.stringify(body), { status, headers: { ...headers(req), "Content-Type": "application/json", "Cache-Control": "no-store, private" } });
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
async function decryptToText(encrypted: Uint8Array): Promise<string> {
  if (encrypted.length < 28) throw new Error("Encrypted asset is too short.");
  const key = await crypto.subtle.importKey("raw", deriveKeyBytes(), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: encrypted.slice(0, 12), tagLength: 128 }, key, encrypted.slice(12));
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
function answerIndex(ans: string) {
  const a = ans.trim().toUpperCase();
  if (["A", "1"].includes(a)) return 0;
  if (["B", "2"].includes(a)) return 1;
  if (["C", "3"].includes(a)) return 2;
  if (["D", "4"].includes(a)) return 3;
  if (["E", "5"].includes(a)) return 4;
  if (["F", "6"].includes(a)) return 5;
  return 0;
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
async function checkEntitlement(admin: any, userId: string, track: string) {
  const result = await admin.from("entitlements").select("id")
    .eq("user_id", userId).eq("track_id", track).eq("status", "active")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (result.error) throw new Error("Could not verify the license.");
  return !!result.data;
}
async function migrationState(admin: any) {
  const result = await admin.from("question_bank_migration_state").select("status,asset_count,error_summary,updated_at").eq("id", 1).single();
  if (result.error || !result.data) throw new Error("Could not read question-bank migration state.");
  return result.data;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(req, { error: "Question service is not configured." }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let body: { action?: string; path?: string; freeOnly?: boolean };
  try { body = await req.json(); } catch { return json(req, { error: "Invalid request body." }, 400); }
  let user: any = null, isAdmin = false;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const result = await authClient.auth.getUser();
    if (!result.error && result.data.user) { user = result.data.user; isAdmin = isAdminEmail(user.email); }
  }
  if (body.action === "status" || body.action === "migrate") {
    if (!user || !isAdmin) return json(req, { error: "Forbidden." }, 403);
    let state: any;
    try { state = await migrationState(admin); } catch { return json(req, { error: "Could not read migration state." }, 500); }
    if (body.action === "status") return json(req, { status: state.status, assetCount: state.asset_count, errorSummary: state.error_summary, updatedAt: state.updated_at, expectedAssets: SOURCE_ASSETS.length });
    if (state.status === "complete" && state.asset_count === SOURCE_ASSETS.length) return json(req, { status: "complete", assetCount: state.asset_count, expectedAssets: SOURCE_ASSETS.length });
    if (state.status === "running" && Date.now() - new Date(state.updated_at).getTime() < 5 * 60 * 1000) return json(req, { error: "A question-bank migration is already running." }, 409);
    await admin.from("question_bank_migration_state").update({ status: "running", error_summary: null, updated_at: new Date().toISOString() }).eq("id", 1);
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
          const result = await admin.storage.from("question-banks").upload(assetPath, buffer, { contentType: "application/octet-stream", cacheControl: "0", upsert: true });
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
    return json(req, { status: "complete", assetCount: copied, expectedAssets: SOURCE_ASSETS.length, message: "Encrypted question files are safely copied to private storage. Public source files remain in place until the protected loader is deployed." });
  }
  if (body.action !== "get" || typeof body.path !== "string" || !SOURCE_ASSETS.includes(body.path)) return json(req, { error: "Invalid question asset request." }, 400);
  let state: any;
  try { state = await migrationState(admin); } catch { return json(req, { error: "Question service is not ready." }, 503); }
  if (state.status !== "complete" || state.asset_count !== SOURCE_ASSETS.length) return json(req, { error: "Protected question bank is not ready yet." }, 503);
  const track = trackForPath(body.path);
  if (!track) return json(req, { error: "Invalid track." }, 400);
  const freeOnly = body.freeOnly === true;
  if (!freeOnly) {
    if (!user) return json(req, { error: "Sign in with an active license to access the full question bank." }, 401);
    if (!isAdmin) {
      try {
        if (!await checkEntitlement(admin, user.id, track)) return json(req, { error: "This track needs an active license. Start Free Reviewer or renew your subscription." }, 403);
      } catch { return json(req, { error: "Could not verify your license. Please refresh and try again." }, 503); }
    }
  }
  const result = await admin.storage.from("question-banks").download(body.path);
  if (result.error || !result.data) return json(req, { error: "Question asset is not available in private storage." }, 503);
  try {
    const text = await decryptToText(new Uint8Array(await result.data.arrayBuffer()));
    const output = freeOnly ? sampleFreeCsv(body.path, text) : text;
    return json(req, { text: output, access: freeOnly ? "free-sample" : isAdmin ? "admin" : "licensed" });
  } catch {
    return json(req, { error: "Question asset could not be processed." }, 500);
  }
});
