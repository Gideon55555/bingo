// Serves the built app. Files in /assets have a content hash in their name, so they are cached
// "forever" by phones; index.html is always re-checked so updates show up immediately.
// The build writes .br and .gz copies next to each file; we send the smallest one the phone accepts,
// so nothing is compressed on the fly (no CPU cost, works the same on any hosting).
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt']);

export function serveStatic(app, dist) {
  if (!fs.existsSync(dist)) {
    console.warn('⚠️  dist/ not found — run "npm run build" to build the frontend.');
    return;
  }
  // Index every file once at startup (the build never changes while running)
  const files = new Map(); // url path -> { file, br, gz, type, etag, size }
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (/\.(br|gz)$/.test(ent.name)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const st = fs.statSync(full);
      const url = '/' + path.relative(dist, full).split(path.sep).join('/');
      files.set(url, {
        file: full, type: TYPES[ext] || 'application/octet-stream', size: st.size,
        etag: `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`,
        br: COMPRESSIBLE.has(ext) && fs.existsSync(`${full}.br`) ? `${full}.br` : null,
        gz: COMPRESSIBLE.has(ext) && fs.existsSync(`${full}.gz`) ? `${full}.gz` : null,
        compressible: COMPRESSIBLE.has(ext),
      });
    }
  };
  walk(dist);
  const index = files.get('/index.html');

  const send = (req, res, f, cache) => {
    res.setHeader('Content-Type', f.type);
    res.setHeader('Cache-Control', cache);
    res.setHeader('ETag', f.etag);
    if (f.compressible) res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === f.etag) return res.status(304).end();
    const ae = String(req.headers['accept-encoding'] || '');
    let file = f.file;
    if (f.br && /\bbr\b/.test(ae)) { file = f.br; res.setHeader('Content-Encoding', 'br'); }
    else if (f.gz && /\bgzip\b/.test(ae)) { file = f.gz; res.setHeader('Content-Encoding', 'gzip'); }
    res.setHeader('Content-Length', fs.statSync(file).size);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let p;
    try { p = decodeURIComponent(req.path); } catch { return res.status(400).end(); }
    if (p.startsWith('/api') || p.startsWith('/socket.io') || p.startsWith('/tg-webhook') || p === '/healthz') return next();
    const f = files.get(p);
    if (f && p !== '/index.html') {
      return send(req, res, f, p.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : p.startsWith('/voice/') ? 'public, max-age=2592000' : 'public, max-age=3600');
    }
    if (p.startsWith('/assets/')) return res.status(404).end(); // old build file: don't send HTML instead
    if (!index) return next();
    send(req, res, index, 'no-cache');
  });
}
