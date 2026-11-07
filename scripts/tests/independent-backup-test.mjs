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

// The portable data must come from the full archive, without a second source read.
const { portableDataToc } = await import('../lib/independentBackup.mjs');
const toc = '; archive\n10; 1 2 TABLE DATA auth users supabase_auth_admin\n11; 1 3 TABLE DATA auth schema_migrations supabase_auth_admin\n12; 1 4 TABLE DATA storage migrations supabase_storage_admin\n13; 1 5 TABLE DATA storage objects supabase_storage_admin\n14; 1 6 TABLE DATA storage vector_indexes supabase_storage_admin\n15; 1 7 SEQUENCE SET public fixture_id_seq postgres\n';
const portable = portableDataToc(toc);
assert.ok(portable.includes('TABLE DATA auth users'));
assert.ok(portable.includes('TABLE DATA storage objects'));
assert.ok(portable.includes('SEQUENCE SET public fixture_id_seq'));
assert.ok(!portable.includes('TABLE DATA auth schema_migrations'));
assert.ok(!portable.includes('TABLE DATA storage migrations'));
assert.ok(!portable.includes('TABLE DATA storage vector_indexes'));
