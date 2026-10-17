'use strict';

// Local development server. In production, Vercel serves public/ statically and runs api/index.js;
// this file mirrors that setup so `npm run dev` behaves the same way.
require('./scripts/load-env');

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { handle } = require('./lib/app');
const { SECURITY_HEADERS } = require('./lib/headers');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handle(req, res);
  serveStatic(req, res, url);
});

server.listen(PORT, () => console.log(`InvoiceFlow dev server running at http://localhost:${PORT}`));

function serveStatic(req, res, url) {
  // HSTS and HTTPS upgrades don't apply to plain-HTTP localhost; Vercel sends them in production.
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (key === 'Strict-Transport-Security') continue;
    res.setHeader(key, key === 'Content-Security-Policy' ? value.replace(/; upgrade-insecure-requests/, '') : value);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { pathname = '/'; }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  const hidden = pathname.split('/').some(part => part.startsWith('.'));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) || hidden) return notFound(res);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    const ext = path.extname(filePath).toLowerCase();
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      Vary: 'Accept-Encoding'
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}
