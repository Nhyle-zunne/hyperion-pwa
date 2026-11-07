// Synthetic-only integration test: no production credentials or external payments.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const work = mkdtempSync(join(tmpdir(), 'hyperion-backup-test-'));
process.umask(0o077);
function command(program, args, options = {}) {
  const r = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`${program} failed: ${r.stderr?.slice(-1500)}`);
  return r.stdout;
}
const output = join(work, 'synthetic.tar.age');
const cwd = process.cwd();
let started = false;
try {
  const identity = command('age-keygen', []);
  const key = identity.match(/^AGE-SECRET-KEY-.+$/m)[0];
  const recipient = identity.match(/^# public key: (.+)$/m)[1];
  const source = join(work, 'source'); mkdirSync(source);
  command('supabase', ['init','--workdir',source]);
  const config = join(source, 'supabase/config.toml');
  writeFileSync(config, readFileSync(config, 'utf8').replace(/^project_id = .*$/m, 'project_id = "hyperion-backup-test-source"'));
  started = true;
  command('supabase', ['start','--workdir',source,'--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
  command('docker', ['exec','-i','supabase_db_hyperion-backup-test-source','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], { input: `
    CREATE TABLE public.backup_fixture(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id), details jsonb NOT NULL);
    ALTER TABLE public.backup_fixture ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_rows ON public.backup_fixture TO authenticated USING (owner_id = auth.uid());
    GRANT SELECT ON public.backup_fixture TO authenticated;
    INSERT INTO auth.users(id,email,encrypted_password) VALUES ('00000000-0000-4000-8000-000000000001','synthetic@example.invalid','synthetic-password-hash');
    INSERT INTO public.backup_fixture(owner_id,details) VALUES ('00000000-0000-4000-8000-000000000001','{"progress":42,"text":"private synthetic data"}');
    CREATE FUNCTION public.backup_fixture_value() RETURNS integer LANGUAGE sql AS 'SELECT 42';
  ` });
  const env = { ...process.env, BACKUP_TEST_LOCAL: '1', BACKUP_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', BACKUP_AGE_RECIPIENT: recipient, BACKUP_AGE_IDENTITY: key };
  const script = resolve('scripts/independent-database-backup.mjs');
  command(process.execPath, [script,'backup',output], { env, cwd });
  const ciphertext = readFileSync(output);
  assert.ok(!ciphertext.includes(Buffer.from('private synthetic data')));
  assert.ok(!ciphertext.includes(Buffer.from('synthetic-password-hash')));
  const duplicate = spawnSync(process.execPath,[script,'backup',output],{env,encoding:'utf8'});
  assert.notEqual(duplicate.status,0);
  assert.deepEqual(readFileSync(output),ciphertext);
  const wrong = command('age-keygen',[]).match(/^AGE-SECRET-KEY-.+$/m)[0];
  const failed = spawnSync(process.execPath,[script,'restore-drill',output],{env:{...env,BACKUP_AGE_IDENTITY:wrong},encoding:'utf8'});
  assert.notEqual(failed.status,0);
  assert.ok(!failed.stderr.includes(key));
  command('supabase',['stop','--workdir',source,'--no-backup']); started = false;
  command(process.execPath,[script,'restore-drill',output],{env,cwd});
  console.log('Synthetic full export, encryption, wrong-key rejection, overwrite protection and isolated Supabase portable restore passed.');
} finally {
  if (started) command('supabase',['stop','--workdir',join(work,'source'),'--no-backup']);
  rmSync(work,{recursive:true,force:true});
}
