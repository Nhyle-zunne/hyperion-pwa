import assert from 'node:assert/strict';
import { validateSource, copyManifest, compareCopies, portableDumpScript } from '../lib/independentBackup.mjs';
const ref = 'evnjoezffghtrzqacwcj';
const url = `postgresql://postgres.${ref}:synthetic@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
assert.throws(() => validateSource(url, true));
assert.equal(validateSource(url).hostname, 'aws-1-ap-northeast-1.pooler.supabase.com');
for (const bad of ['', url.replace(ref, 'other'), url.replace(':5432', ':6543'), url.replace('verify-full','disable'), `${url}&host=attacker.invalid`, url.replace('/postgres?', '/other?')]) assert.throws(() => validateSource(bad));
assert.throws(() => validateSource('postgresql://postgres:synthetic@localhost:5432/postgres'));
validateSource('postgresql://postgres:synthetic@127.0.0.1:54322/postgres', true);
const data = 'COPY public.example (id, value) FROM stdin;\n1\thello\\nworld\n2\tprivate\n\\.\n';
const manifest = copyManifest(data);
assert.equal(manifest['public.example'].rows, 2);
assert.deepEqual(copyManifest(data.replace('1\thello\\nworld\n2\tprivate','2\tprivate\n1\thello\\nworld')), manifest);
compareCopies(manifest, manifest);
assert.throws(() => compareCopies(manifest, copyManifest(data.replace('private','changed'))));
assert.throws(() => compareCopies(manifest, {}));
assert.throws(() => copyManifest(data.replace('\\.\n','')));
assert.throws(() => copyManifest(''));
console.log('Independent backup source guards and exact restored COPY integrity checks passed.');

const dryRun = '#!/usr/bin/env bash\nexport PGHOST="127.0.0.1"\nexport PGPORT="5432"\nexport PGUSER="postgres"\nexport PGPASSWORD="synthetic"\nexport PGDATABASE="postgres"\npg_dump --schema-only\n';
assert.equal(portableDumpScript(dryRun), '#!/usr/bin/env bash\npg_dump --schema-only\n');
assert.throws(() => portableDumpScript(dryRun + 'export PGSSLMODE=disable\n'));
assert.throws(() => portableDumpScript(dryRun.replace('export PGHOST="127.0.0.1"\n','')));

const sequences = copyManifest(data + "SELECT pg_catalog.setval('public.example_id_seq', 5, true);\n");
assert.equal(sequences['sequence:public.example_id_seq'].value, '5');
assert.throws(() => compareCopies(sequences, copyManifest(data)));
