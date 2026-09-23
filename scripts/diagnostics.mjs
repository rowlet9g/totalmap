import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const directory = new URL('../data/diagnostics/', import.meta.url);
await mkdir(directory, { recursive: true });
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '';
  // A diagnostics sink only: no read API, shell commands or account changes.
  if (!/^(?:chrome|whale)-extension:\/\/[a-p]{32}$/.test(origin)) { res.writeHead(403); res.end(); return; }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/diagnostics') { res.writeHead(404); res.end(); return; }
  try {
    const parts = []; let size = 0;
    for await (const part of req) {
      size += part.length;
      if (size > 2000000) { res.writeHead(413); res.end(); req.destroy(); return; }
      parts.push(part);
    }
    const capture = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (capture.kind !== 'page-probe' || !['naver', 'kakao', 'google'].includes(capture.provider) ||
      capture.complete !== false || !Array.isArray(capture.frames) || !Array.isArray(capture.candidates)) throw Error('Invalid capture');
    const filename = `${Date.now()}-${capture.provider}-${randomUUID()}.json`;
    await writeFile(new URL(filename, directory), JSON.stringify(capture, null, 2), { flag: 'wx' });
    console.log(`${capture.provider}: ${capture.candidates.length} candidates, ${capture.frames.length} frames -> ${filename}`);
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"saved":true}');
  } catch { res.writeHead(400); res.end('{"saved":false}'); }
});
server.listen(47832, '127.0.0.1', () => console.log('Local diagnostics receiver: 127.0.0.1:47832 (POST only)'));
