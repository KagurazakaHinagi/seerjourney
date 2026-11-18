'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');
const root = path.resolve(__dirname, '..');
require('./build.cjs');
const handlers = { '/api/auth': require('../api/auth.js'), '/api/campaign': require('../api/campaign.js'), '/api/images': require('../api/images.js') };
const staticRoot = path.join(root, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const policy = require('../vercel.json').headers[0].headers;
const server = http.createServer(async (req, res) => {
  for (const { key, value } of policy) res.setHeader(key, value);
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (_) { res.writeHead(400); return res.end('Invalid URL'); }
  if (handlers[pathname]) {
    try { await handlers[pathname](req, res); }
    catch (_) { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: 'server_error' })); }
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const file = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(staticRoot + path.sep)) { res.writeHead(404); return res.end(); }
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    pipeline(fs.createReadStream(file), res, () => {});
  } catch (_) { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.PORT || 8780);
server.listen(port, '127.0.0.1', () => console.log(`SeerJourney: http://localhost:${port}/`));
