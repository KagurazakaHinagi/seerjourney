'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const { assets } = require('../../scripts/build.cjs');

test('deployment contains the selected map only and excludes credentials and server source', () => {
  const files = fs.readdirSync(path.join(root, 'dist'), { recursive: true });
  assert.ok(files.includes('campaign-map/map.json'));
  assert.equal(files.some(file => /(^|\/)(?:\.env[^/]*|\.data|api|server|chult)(?:\/|$)/.test(file)), false);
  assert.equal(files.some(file => file.endsWith('.seerjourney-mod.json')), false);
  assert.equal([...assets].some(file => /(?:\.env|campaign\.cjs|storage\.cjs|sync-env)/.test(file)), false);
});

test('all referenced app shell and selected raster files exist in the built output', () => {
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+\.(?:js|css|svg|png|webmanifest))"/g)) {
    assert.ok(fs.existsSync(path.join(root, 'dist', match[1])), match[1]);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/campaign-map/map.json'), 'utf8'));
  for (const file of Object.values(manifest.assets)) assert.ok(fs.existsSync(path.join(root, 'dist/campaign-map', file)), file);
  assert.ok(html.includes('campaign-client.js'));
  assert.equal(html.includes('map-library.js'), false);
});

test('source organization preserves published URLs and Home Screen app identity', () => {
  const expectedURLs = require('../fixtures/public-urls.json');
  assert.ok(expectedURLs.length > 0);
  for (const url of expectedURLs) {
    const relative = url.replace(/^\//, '');
    assert.ok(fs.statSync(path.join(root, 'dist', relative)).isFile(), `Previously published URL is missing: ${url}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(fs.existsSync(path.join(root, 'dist/sw.js')), 'Service worker stays at the application root');
  const pwa = fs.readFileSync(path.join(root, 'dist/pwa.js'), 'utf8');
  assert.match(pwa, /serviceWorker\.register\(['"](?:\.\/)?sw\.js['"]/);
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root, 'dist', icon.src)), icon.src);
});

test('CSP permits the installed Blob SDK upload endpoint without allowing unrelated Vercel APIs', async () => {
  const { presignUrl } = require('@vercel/blob');
  const pathname = 'campaigns/demo-map/00000000-0000-4000-8000-000000000000.png';
  // Build the real SDK URL locally. These synthetic signing values never leave
  // this process; no provider credentials or network requests are needed.
  const scope = { storeId: 'store_test', operations: ['put'], pathname, validUntil: Date.now() + 60000 };
  const { presignedUrl } = await presignUrl({
    delegationToken: Buffer.from(JSON.stringify(scope)).toString('base64url') + '.test-only-signature',
    clientSigningToken: Buffer.alloc(32, 1).toString('base64url')
  }, { access: 'public', operation: 'put', pathname });
  const upload = new URL(presignedUrl);
  const deployment = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const policy = deployment.headers.find(rule => rule.source === '/(.*)').headers
    .find(header => header.key.toLowerCase() === 'content-security-policy').value;
  const connect = policy.split(';').map(part => part.trim().split(/\s+/))
    .find(([directive]) => directive === 'connect-src').slice(1);
  const uploadSource = upload.origin + upload.pathname;
  assert.ok(connect.includes(uploadSource), 'The browser must allow the upload URL emitted by the installed SDK');
  assert.ok(uploadSource.endsWith('/'), 'CSP needs the trailing slash to match Blob API paths');
  assert.deepEqual(connect.filter(source => /^(?:\*|https?:)$/.test(source) || source.includes('vercel.com')), [uploadSource],
    'Allow only the Blob API path, not all HTTPS connections, Vercel domains, or unrelated Vercel APIs');
});

test('bookmark artwork and its license ship locally and remain available offline', () => {
  const sprite = fs.readFileSync(path.join(root, 'dist/assets/iconoir/markers.svg'), 'utf8');
  for (const kind of ['place', 'camp', 'danger', 'ruin', 'tomb', 'treasure']) assert.ok(sprite.includes(`id="${kind}"`));
  assert.match(fs.readFileSync(path.join(root, 'dist/assets/iconoir/LICENSE'), 'utf8'), /MIT License/);
  const worker = fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8');
  assert.ok(worker.includes('assets/iconoir/markers.svg'));
  const shell = JSON.parse(worker.match(/const SHELL = (\[[^;]+\]);/)[1]);
  for (const filename of new Set(Object.values(require('../../assets/iconoir/ui-icons.json')))) {
    const asset = `assets/iconoir/${filename}`;
    assert.ok(assets.has(asset), `Missing UI icon from deployment: ${asset}`);
    assert.ok(fs.existsSync(path.join(root, 'dist', asset)), asset);
    assert.ok(shell.includes(asset), `Missing offline UI icon: ${asset}`);
  }
});

test('deployment includes the complete tile pyramid and caches only its small manifest eagerly', () => {
  const base = 'campaign-map/tiles';
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', base, 'manifest.json'), 'utf8'));
  let count = 0;
  for (const template of Object.values(manifest.layers)) for (const level of manifest.levels) {
    for (let row = 0; row < level.rows; row++) for (let column = 0; column < level.columns; column++) {
      const file = `${base}/${template.replace('{id}', level.id).replace('{column}', column).replace('{row}', row)}`;
      assert.ok(assets.has(file), file);
      assert.ok(fs.existsSync(path.join(root, 'dist', file)), file);
      count++;
    }
  }
  assert.ok(count > 0);
  const worker = fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8');
  const shell = JSON.parse(worker.match(/const SHELL = (\[[^;]+\]);/)[1]);
  assert.ok(shell.includes(`${base}/manifest.json`));
  assert.equal(shell.some(file => file.startsWith(`${base}/`) && file.endsWith('.jpg')), false, 'Do not download every tile at startup');
});

test('service worker never intercepts live campaign, login, or image API requests', () => {
  const events = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8'), {
    self: { location: { origin: 'https://campaign.example' }, addEventListener: (type, fn) => { events[type] = fn; } }, URL
  });
  for (const pathname of ['/api/campaign', '/api/auth', '/api/images']) {
    for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
      let intercepted = false;
      events.fetch({ request: { method, url: 'https://campaign.example' + pathname }, respondWith() { intercepted = true; } });
      assert.equal(intercepted, false, method + ' ' + pathname);
    }
  }
});

test('revisiting content-versioned map tiles uses their cached response without network', async () => {
  const events = {}, cached = { tile: true };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/sw.js'), 'utf8'), {
    self: { location: { origin: 'https://campaign.example' }, addEventListener: (type, fn) => { events[type] = fn; } }, URL,
    caches: { open: async () => ({ match: async () => cached }) },
    fetch: () => { assert.fail('Cached tiles must not wait for a network request'); }
  });
  let response;
  events.fetch({ request: { method: 'GET', url: 'https://campaign.example/campaign-map/tiles/fog/2/0-0.jpg?v=example-90-1' }, respondWith(result) { response = result; } });
  assert.equal(await response, cached);
});
