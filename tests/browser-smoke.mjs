// End-to-end smoke test: serves the app, uploads a synthetic vocal, and runs
// analyze → generate → play-together → switch-up regenerate in real Chromium.
// Run: node tests/make-test-wav.mjs && node tests/browser-smoke.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wav': 'audio/wav' };
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const path = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!existsSync(path)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise(r => server.listen(8765, r));

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} ${detail}`); }
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage();
// Headless has no real audio devices — stub the mic with a WebAudio "singer"
// cycling through C-E-G so the Live Jam has something to follow.
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain(); gain.gain.value = 0.4;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dest); osc.start();
    const notes = [261.63, 329.63, 392.0, 329.63]; let i = 0;
    setInterval(() => { osc.frequency.value = notes[i++ % notes.length]; }, 600);
    return dest.stream;
  };
});
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8765/');
check('page loads without errors', errors.length === 0, errors.join(' | '));

await page.setInputFiles('#uploadInput', join(root, 'tests', 'fixtures-test-vocal.wav'));
await page.waitForFunction(() => !document.getElementById('analyzeBtn').disabled);
await page.click('#analyzeBtn');
await page.waitForSelector('#screen-analysis.active', { timeout: 15000 });
const analysisJson = JSON.parse(await page.textContent('#analysisJson'));
check('analysis: key C major', analysisJson.key === 'C' && analysisJson.scale === 'major', `got ${analysisJson.key} ${analysisJson.scale}`);
check('analysis: bpm ~100', typeof analysisJson.bpm === 'number' && Math.abs(analysisJson.bpm - 100) <= 4, `got ${analysisJson.bpm}`);
check('analysis: firstBeatSec present', typeof analysisJson.firstBeatSec === 'number', `got ${analysisJson.firstBeatSec}`);
check('analysis: 3 phrases', analysisJson.phrases?.length === 3, `got ${analysisJson.phrases?.length}`);

await page.click('#generateBtn');
await page.waitForSelector('#screen-generated.active', { timeout: 15000 });
let dbg = JSON.parse(await page.textContent('#debug'));
check('generate succeeds', /^generated/.test(dbg.backing), dbg.backing);
check('track lanes rendered', await page.locator('.track-lane').count() >= 4);

await page.click('#playTogetherBtn');
await page.waitForTimeout(1500);
const transportState = await page.evaluate(() => Tone.Transport.state);
check('play-together: transport running', transportState === 'started', transportState);
await page.click('#stopPlaybackBtn');

// Switch-up + waltz regenerate
await page.selectOption('#timeSigSelect', '3/4');
await page.selectOption('#switchUpSelect', 'style');
await page.waitForTimeout(2500); // onchange triggers regenerate
dbg = JSON.parse(await page.textContent('#debug'));
check('waltz + style switch-up generates', /meter:3\/4/.test(dbg.backing), dbg.backing);
check('switch-up scheduled', /→/.test(dbg.backing) || /bar/.test(dbg.backing), dbg.backing);

await page.click('#playTogetherBtn');
await page.waitForTimeout(1200);
await page.click('#stopPlaybackBtn');

// Save to timeline and play the song
await page.click('#addToTimelineBtn');
check('timeline has a block', await page.locator('.timeline-block').count() === 1);
await page.click('#playTimelineBtn');
await page.waitForTimeout(1200);
const timelineState = await page.evaluate(() => Tone.Transport.state);
check('timeline plays', timelineState === 'started', timelineState);
await page.click('#playTimelineBtn');

// Live Jam with the fake mic: start, queue a live style + meter switch, stop & save
await page.click('#startOver3Btn');
await page.click('#startJamBtn');
await page.waitForTimeout(6000); // let key detection lock onto the fake singer
const jamState = await page.evaluate(() => Tone.Transport.state);
check('jam: transport running', jamState === 'started', jamState);
check('jam: key locked from voice', /Key: /.test(await page.textContent('#jamStatus')), await page.textContent('#jamStatus'));
await page.selectOption('#jamStyleSelect', 'Rock');
await page.selectOption('#jamTimeSigSelect', '3/4');
await page.waitForTimeout(3000); // let the queued switch land on a bar boundary
const jamStatus = await page.textContent('#jamStatus');
check('jam: live switch applied or queued', /Switched up|queued/i.test(jamStatus), jamStatus);
await page.click('#stopJamBtn');
await page.waitForSelector('#screen-generated.active', { timeout: 20000 });
dbg = JSON.parse(await page.textContent('#debug'));
check('jam: backing generated on save', /^jam/.test(dbg.backing), dbg.backing);

check('no page errors during run', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nBrowser smoke test passed.');
