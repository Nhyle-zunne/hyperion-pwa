import { spawnSync } from 'node:child_process';
import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCopies, copyManifest, projectRef, validateSource, portableDumpScript, portableDataToc } from './lib/independentBackup.mjs';

process.umask(0o077);
const work = mkdtempSync(join(tmpdir(), 'hyperion-private-backup-'));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const archive = resolve(process.argv[3] || 'backup-output/database.tar.age');
const localTest = process.env.BACKUP_TEST_LOCAL === '1';
let stage = 'configuration';
let drillDir;
let drillOwned = false;
let certificateMount = [];
const drillId = `hyperion-backup-drill-${randomUUID().slice(0, 8)}`;

// Errors from pg_dump/psql can contain connection strings, rows or SQL literals.
// Keep subprocess output private and never upload or print it, including on failure.
function run(command, args, { output, input, env = process.env, cwd = root } = {}) {
  const out = openSync(output || join(work, 'command.stdout'), 'w', 0o600);
  const err = openSync(join(work, 'command.stderr'), 'w', 0o600);
  const source = input ? openSync(input, 'r') : null;
  let result;
  try {
    result = spawnSync(command, args, { cwd, env, stdio: [source ?? 'ignore', out, err], timeout: 25 * 60 * 1000 });
  } finally { closeSync(out); closeSync(err); if (source !== null) closeSync(source); }
  if (result.status !== 0 || result.error) {
    // SQLSTATE is a fixed public error code; SQL text and row details remain private.
    const state = readFileSync(join(work, 'command.stderr'), 'utf8').match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|$)/);
    if (state) console.error(`Restore SQLSTATE: ${state[1]}`);
    throw new Error('Private subprocess failed');
  }
}
function requireSecret(name) {
  if (!process.env[name]?.trim()) throw new Error('Missing private configuration');
  return process.env[name].trim();
}
function pgEnvironment(url) {
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: 'postgres', PGSSLMODE: localTest ? 'disable' : 'verify-full',
    PGSSLROOTCERT: localTest ? '' : '/tmp/hyperion-database-ca.crt', PGCONNECT_TIMEOUT: '30', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=1200000 -c lock_timeout=10000' };
}
function dump(args, file, env) {
  run('docker', ['run', '--rm', '--network', 'host', ...certificateMount, ...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS'].flatMap(key => ['--env', key]), 'postgres:17', 'pg_dump', ...args], { output: file, env });
}
function cliDump(url, file, flags) {
  const script = join(work, 'portable-dump.sh');
  run('supabase', ['db', 'dump', '--dry-run', '--db-url', 'postgresql://postgres:synthetic@127.0.0.1:5432/postgres', ...flags], { output: script });
  writeFileSync(script, portableDumpScript(readFileSync(script, 'utf8')));
  run('docker', ['run', '--rm', '-i', '--network', 'host', ...certificateMount,
    ...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT','PGOPTIONS'].flatMap(key => ['--env', key]),
    'postgres:17', 'bash', '-euo', 'pipefail'], { input: script, output: file, env: pgEnvironment(validateSource(url, localTest)) });
}
function digest(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

try {
  if (mode === 'backup') {
    const url = requireSecret('BACKUP_DATABASE_URL');
    const source = validateSource(url, localTest);
    if (!localTest) {
      const certificate = requireSecret('BACKUP_DATABASE_CA_CERT');
      new X509Certificate(certificate);
      const certificatePath = join(work, 'database-ca.crt');
      writeFileSync(certificatePath, certificate + '\n');
      certificateMount = ['--mount', `type=bind,source=${certificatePath},target=/tmp/hyperion-database-ca.crt,readonly`];
    }
    const recipient = requireSecret('BACKUP_AGE_RECIPIENT');
    if (!/^age1[a-z0-9]+$/.test(recipient)) throw new Error('Expected an age public recipient');
    if (existsSync(archive)) throw new Error('Refusing to overwrite a backup');
    const files = join(work, 'files'); mkdirSync(files);
    stage = 'full database export';
    dump(['--format=custom', '--compress=6', '--lock-wait-timeout=10000'], join(files, 'database.dump'), pgEnvironment(source));
    stage = 'portable exports';
    cliDump(url, join(files, 'roles.sql'), ['--role-only']);
    cliDump(url, join(files, 'schema.sql'), []);
    // Extract the portable rows from the full archive, avoiding a second remote data export.
    const mount = ['--mount', `type=bind,source=${files},target=/backup,readonly`];
    const toc = join(files, 'data.toc');
    run('docker', ['run', '--rm', ...mount, 'postgres:17', 'pg_restore', '--list', '/backup/database.dump'], { output: toc });
    writeFileSync(toc, portableDataToc(readFileSync(toc, 'utf8')));
    run('docker', ['run', '--rm', ...mount, 'postgres:17', 'pg_restore', '--data-only',
      '--schema=public', '--schema=auth', '--schema=storage', '--use-list=/backup/data.toc', '/backup/database.dump'], { output: join(files, 'data.sql') });
    const fileNames = ['database.dump', 'roles.sql', 'schema.sql', 'data.sql'];
    const manifest = { format: 1, project: projectRef, createdAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || 'local', files: Object.fromEntries(fileNames.map(name => [name, digest(join(files, name))])),
      copies: copyManifest(readFileSync(join(files, 'data.sql'), 'utf8')) };
    writeFileSync(join(files, 'manifest.json'), JSON.stringify(manifest));
    stage = 'encryption';
    const tar = join(work, 'database.tar');
    run('tar', ['-cf', tar, '-C', files, ...fileNames, 'manifest.json']);
    mkdirSync(dirname(archive), { recursive: true });
    const partial = `${archive}.${randomUUID()}.partial`;
    try {
      run('age', ['--encrypt', '--recipient', recipient, '--output', partial, tar]);
      // Exclusive creation prevents accidental replacement of an existing recovery point.
      const fd = openSync(archive, 'wx', 0o600);
      try { writeFileSync(fd, readFileSync(partial)); } finally { closeSync(fd); }
    } finally { rmSync(partial, { force: true }); }
    console.log('Encrypted database backup created. Production restore verification is a separate required step.');
  } else if (mode === 'restore-drill') {
    stage = 'decryption';
    const identity = join(work, 'identity'); writeFileSync(identity, requireSecret('BACKUP_AGE_IDENTITY') + '\n');
    const tar = join(work, 'database.tar');
    run('age', ['--decrypt', '--identity', identity, '--output', tar, archive]);
    stage = 'archive validation';
    const listing = join(work, 'members'); run('tar', ['-tf', tar], { output: listing });
    const names = ['database.dump','roles.sql','schema.sql','data.sql','manifest.json'];
    const actual = readFileSync(listing, 'utf8').trim().split('\n').sort();
    if (JSON.stringify(actual) !== JSON.stringify([...names].sort())) throw new Error('Unexpected archive entries');
    const files = join(work, 'restored'); mkdirSync(files);
    run('tar', ['-xf', tar, '-C', files, '--no-same-owner', '--no-same-permissions']);
    const manifest = JSON.parse(readFileSync(join(files, 'manifest.json'), 'utf8'));
    if (manifest.format !== 1 || manifest.project !== projectRef) throw new Error('Wrong backup format/project');
    for (const name of names.slice(0, -1)) if (digest(join(files, name)) !== manifest.files[name]) throw new Error('Backup integrity check failed');
    compareCopies(manifest.copies, copyManifest(readFileSync(join(files, 'data.sql'), 'utf8')));
    stage = 'isolated Supabase startup';
    drillDir = join(work, 'drill'); mkdirSync(drillDir);
    run('supabase', ['init', '--workdir', drillDir]);
    const config = join(drillDir, 'supabase', 'config.toml');
    let text = readFileSync(config, 'utf8').replace(/^project_id = .*$/m, `project_id = "${drillId}"`);
    writeFileSync(config, text);
    drillOwned = true;
    run('supabase', ['start', '--workdir', drillDir, '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
    const container = `supabase_db_${drillId}`;
    stage = 'restore network isolation';
    const containersListing = join(work, 'containers');
    run('docker', ['ps', '--format', '{{.Names}}'], { output: containersListing });
    const services = readFileSync(containersListing, 'utf8').trim().split('\n').filter(name => name.endsWith(`_${drillId}`) && name !== container);
    if (services.length) run('docker', ['stop', ...services]);
    const networks = join(work, 'networks');
    const networkArgs = ['inspect', '--format', '{{range $name, $network := .NetworkSettings.Networks}}{{$name}}{{"\\n"}}{{end}}', container];
    run('docker', networkArgs, { output: networks });
    for (const network of readFileSync(networks, 'utf8').trim().split('\n').filter(Boolean)) {
      run('docker', ['network', 'disconnect', network, container]);
    }
    run('docker', networkArgs, { output: networks });
    if (readFileSync(networks, 'utf8').trim()) throw new Error('Restore database is still networked');
    // The only restore destination is the disposable CLI database created above.
    // No restore URL, project ref or container is accepted from environment/input.
    // Use the local administrative role for managed-schema ownership and trigger suppression.
    const sql = readFileSync(join(files, 'roles.sql'), 'utf8') + '\n'
      + readFileSync(join(files, 'schema.sql'), 'utf8') + '\nSET session_replication_role = replica;\n'
      + readFileSync(join(files, 'data.sql'), 'utf8');
    const restore = join(work, 'restore.sql');
    writeFileSync(restore, 'BEGIN;\nSET session_replication_role = replica;\n' + sql + '\nCOMMIT;\n');
    stage = 'portable database restore';
    run('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], { input: restore });
    stage = 'restored row verification';
    const roundTrip = join(work, 'round-trip.sql');
    run('docker', ['exec', container, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--schema=public', '--schema=auth', '--schema=storage'], { output: roundTrip });
    compareCopies(manifest.copies, copyManifest(readFileSync(roundTrip, 'utf8')));
    console.log(`Encrypted backup decrypted and restored into isolated Supabase; exact row contents verified for ${Object.keys(manifest.copies).filter(name => !name.startsWith('sequence:')).length} tables. Full archive, external secrets and Storage bytes still require the recovery runbook.`);
  } else throw new Error('Use backup or restore-drill');
} catch {
  console.error(`Database backup operation failed at: ${stage}. Private diagnostics were not published. See docs/independent-database-backups.md.`);
  process.exitCode = 1;
} finally {
  if (drillOwned) {
    try { run('supabase', ['stop', '--workdir', drillDir, '--no-backup']); }
    catch { console.error('Disposable Supabase cleanup failed; destroy this runner before reuse.'); process.exitCode = 1; }
  }
  rmSync(work, { recursive: true, force: true });
}
