// After "vite build": write .br and .gz copies of text files so the server can send them
// compressed without spending CPU on every request.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let saved = 0, n = 0;
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(f); continue; }
    if (!/\.(js|css|html|svg|json|txt)$/.test(f)) continue;
    const raw = fs.readFileSync(f);
    if (raw.length < 1024) continue;
    const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    const gz = zlib.gzipSync(raw, { level: 9 });
    fs.writeFileSync(`${f}.br`, br);
    fs.writeFileSync(`${f}.gz`, gz);
    saved += raw.length - br.length; n++;
  }
};
walk(dist);
console.log(`compressed ${n} files (brotli saves ${(saved / 1024).toFixed(0)} KB)`);
