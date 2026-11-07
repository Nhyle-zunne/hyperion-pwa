import { createHash } from 'node:crypto';

export const projectRef = 'evnjoezffghtrzqacwcj';
export function validateSource(value, localTest = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid backup database URL'); }
  const local = localTest && ['127.0.0.1', 'localhost'].includes(url.hostname);
  const direct = url.hostname === `db.${projectRef}.supabase.co` && decodeURIComponent(url.username) === 'postgres';
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && decodeURIComponent(url.username) === `postgres.${projectRef}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.password || url.pathname !== '/postgres'
    || (url.port && url.port !== (local ? '54322' : '5432'))
    || [...url.searchParams.keys()].some(key => key !== 'sslmode')
    || (!local && (url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'verify-full'))
    || (!local && !direct && !pooler)) throw new Error('Backup requires the expected project, session/direct port and verified TLS');
  return url;
}

// COPY encodes embedded newlines as escapes, so each physical line is one row.
export function copyManifest(sql) {
  const result = {};
  const lines = sql.split('\n');
  for (const line of lines) {
    const sequence = /^SELECT pg_catalog.setval\('([^']+)', ([0-9]+), (true|false)\);$/.exec(line);
    if (sequence) result[`sequence:${sequence[1].replaceAll('"', '')}`] = { value: sequence[2], called: sequence[3] };
  }
  for (let i = 0; i < lines.length; i++) {
    const match = /^COPY ((?:"?[a-zA-Z_][a-zA-Z_0-9]*"?\.)"?[a-zA-Z_][a-zA-Z_0-9]*"?) (\(.*\)) FROM stdin;$/.exec(lines[i]);
    if (!match) {
      if (lines[i].startsWith('COPY ')) throw new Error('Unsupported COPY identifier');
      continue;
    }
    const table = match[1].replaceAll('"', '');
    if (result[table]) throw new Error('Duplicate COPY table');
    const rows = [];
    while (++i < lines.length && lines[i] !== '\\.') rows.push(lines[i]);
    if (i >= lines.length) throw new Error('Truncated COPY data');
    const hash = createHash('sha256').update(match[2].replaceAll('"', '') + '\n');
    for (const row of rows.sort()) hash.update(row + '\n');
    result[table] = { rows: rows.length, sha256: hash.digest('hex') };
  }
  if (!Object.keys(result).length) throw new Error('Backup has no COPY data');
  return result;
}

export function compareCopies(expected, actual) {
  for (const [table, value] of Object.entries(expected)) {
    if (JSON.stringify(value) !== JSON.stringify(actual[table])) throw new Error('Restored COPY contents differ');
  }
}

// Use CLI filtering, but run its generated dump script in our own PG17 client.
// CLI 2.122.0 drops URL sslmode while constructing its Docker environment.
export function portableDumpScript(script) {
  if (!script.startsWith('#!/usr/bin/env bash\n')) throw new Error('Unexpected CLI dump script');
  let removed = 0;
  const safe = script.split('\n').filter(line => {
    if (/^export PG(HOST|PORT|USER|PASSWORD|DATABASE)=/.test(line)) { removed++; return false; }
    return true;
  }).join('\n');
  if (removed !== 5 || /^export PG/m.test(safe)) throw new Error('CLI connection script contract changed');
  return safe;
}
