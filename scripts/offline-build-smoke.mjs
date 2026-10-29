import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(absolute));
    else if (entry.isFile()) paths.push(absolute);
  }
  return paths;
}

const files = (await walk(distDirectory)).map(file =>
  relative(distDirectory, file).split(sep).join('/')
);
const serviceWorkerPath = join(distDirectory, 'sw.js');

assert.ok(files.includes('index.html'), 'Production bundle includes the app shell HTML');
assert.ok(files.includes('sw.js'), 'Production bundle includes the generated service worker');
assert.ok(files.includes('manifest.webmanifest'), 'Production bundle includes the PWA manifest');
assert.ok(files.includes('logo.png'), 'Production bundle includes the local loading-indicator logo');
const loaderSource = await readFile(fileURLToPath(new URL('../src/components/TopLoadingIndicator.tsx', import.meta.url)), 'utf8');
assert.ok(loaderSource.includes('src="/logo.png"') && !loaderSource.includes('/logo.png?'), 'Loading indicator references the exact precached local logo URL without a query string');

const indexHtml = await readFile(join(distDirectory, 'index.html'), 'utf8');
for (const socialTag of [
  '<meta property="og:type" content="website" />',
  '<meta property="og:title" content="Hyperion Maritime | Maritime Licensure Reviewer" />',
  '<meta property="og:description"',
  '<meta property="og:image" content="https://hyperionmaritime.org/pwa-512x512.png" />',
  '<meta name="twitter:card" content="summary_large_image" />',
  '<link rel="canonical" href="https://hyperionmaritime.org/" />'
]) {
  assert.ok(indexHtml.includes(socialTag), `Production HTML includes social sharing metadata: ${socialTag}`);
}
assert.ok(files.includes('pwa-512x512.png'), 'Production bundle includes the social-preview logo image');

const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
assert.ok(serviceWorker.includes('pwa-512x512.png'), 'Generated service worker precaches the social-preview image');
const requiredOfflineAssets = [
  'index.html',
  'manifest.webmanifest',
  'install/ios/step-1.jpeg',
  'install/ios/step-6.jpeg'
];
for (const asset of requiredOfflineAssets) {
  assert.ok(files.includes(asset), `Production bundle includes ${asset}`);
  assert.ok(serviceWorker.includes(asset), `Generated service worker precaches ${asset}`);
}

const appChunks = files.filter(file => file.startsWith('assets/') && /\.(?:js|css)$/i.test(file));
assert.ok(appChunks.length > 0, 'Production bundle contains JS/CSS application chunks');
for (const chunk of appChunks) {
  assert.ok(serviceWorker.includes(chunk), `Generated service worker precaches app chunk ${chunk}`);
}

const imageAssets = files.filter(file => /\.(?:png|svg|jpe?g|webp|avif)$/i.test(file));
for (const image of imageAssets) {
  assert.ok(serviceWorker.includes(image), `Generated service worker precaches image ${image}`);
}

const privateQuestionFiles = files.filter(file => /\.(?:csv|enc)$/i.test(file));
assert.deepEqual(privateQuestionFiles, [], 'Private CSV/encrypted question-bank files are not bundled into the public PWA');

console.log(`Offline build checks passed: ${appChunks.length} JS/CSS chunks, ${imageAssets.length} images precached; no private question files in dist.`);
