import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function walk(dir) { const entries = await readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name)))).flat(); }
for (const file of [...await walk('extension'), ...await walk('scripts'), ...await walk('tests')]) {
  if (/\.m?js$/.test(file)) { const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (r.status !== 0) throw Error(r.stderr); }
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) throw Error('Manifest version');
for (const file of [manifest.action.default_popup, manifest.options_page]) await readFile(path.join('extension', file));
console.log('JavaScript syntax and extension manifest checks passed.');
