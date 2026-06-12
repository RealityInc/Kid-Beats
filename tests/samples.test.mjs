import { SAMPLE_LIBRARY, ATTRIBUTION } from '../vendor/samples/manifest.js';
import { statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
};

const NOTE_RE = /^[A-G]#?\d$/;
let totalBytes = 0;

for (const [name, def] of Object.entries(SAMPLE_LIBRARY)) {
  console.log(name);
  const entries = def.urls ?? Object.fromEntries(Object.entries(def.oneShots).map(([k, v]) => [k, v.file]));
  check('has entries', Object.keys(entries).length > 0);
  for (const [key, file] of Object.entries(entries)) {
    const path = join(root, def.base, file);
    const ok = existsSync(path);
    check(`${key} → ${file} exists`, ok, path);
    if (ok) totalBytes += statSync(path).size;
  }
  if (def.urls) {
    check('all keys are valid note names', Object.keys(def.urls).every(k => NOTE_RE.test(k)), Object.keys(def.urls).join(','));
    check('≥4 mapped notes', Object.keys(def.urls).length >= 4, String(Object.keys(def.urls).length));
    check('has release + volumeDb', typeof def.release === 'number' && typeof def.volumeDb === 'number');
  }
}

console.log('totals');
check('total sample size < 20 MB', totalBytes < 20 * 1024 * 1024, `${(totalBytes / 1048576).toFixed(1)} MB`);
check('attribution string present', typeof ATTRIBUTION === 'string' && /CC-BY/.test(ATTRIBUTION));

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log(`\nAll sample manifest tests passed (${(totalBytes / 1048576).toFixed(1)} MB vendored).`);
