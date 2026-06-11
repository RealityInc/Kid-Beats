import { analyzeSignal } from '../analysis-core.js';

function sine(freq,dur,sr=44100){const n=Math.floor(dur*sr),a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=0.4*Math.sin(2*Math.PI*freq*i/sr);return {a,sr}}
function claps(bpm,dur=8,sr=44100,phase=0){const n=Math.floor(dur*sr),a=new Float32Array(n);const step=60/bpm;for(let t=phase;t<dur;t+=step){const i=Math.floor(t*sr);for(let k=0;k<800&&i+k<n;k++)a[i+k]+=Math.random()*0.9*Math.exp(-k/150);}return {a,sr}}
function scale(freqs,sr=44100){const seg=0.4;const n=Math.floor(freqs.length*seg*sr);const a=new Float32Array(n);freqs.forEach((f,idx)=>{for(let i=0;i<seg*sr;i++){const p=idx*seg*sr+i;a[p]=0.35*Math.sin(2*Math.PI*f*i/sr);}});return {a,sr}}
// Sung-phrase shape: tone bursts separated by silence (breaths)
function phrasedVoice(freq,sr=44100){const dur=8,n=dur*sr,a=new Float32Array(n);const segs=[[0.5,2.5],[3.5,5.0],[6.2,7.5]];for(const [s,e] of segs){for(let i=Math.floor(s*sr);i<Math.floor(e*sr);i++){a[i]=0.35*Math.sin(2*Math.PI*freq*i/sr);}}return {a,sr}}

let failures = 0;
function check(name, cond, detail){
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} — ${detail}`); }
}

console.log('A4 sustained');
let r = analyzeSignal(sine(440,3).a, 44100);
check('pitch within 3 cents of 440 Hz', r.pitchContour.length && Math.abs(1200*Math.log2(r.pitchContour[5].freq/440)) < 3, `got ${r.pitchContour[5]?.freq}`);
check('key root is A', r.keyCandidates[0].key === 'A', `got ${r.keyCandidates[0].key}`);

console.log('C5 sustained (kid range)');
r = analyzeSignal(sine(523.25,3).a, 44100);
check('pitch within 5 cents of C5', r.pitchContour.length && Math.abs(1200*Math.log2(r.pitchContour[5].freq/523.25)) < 5, `got ${r.pitchContour[5]?.freq}`);

console.log('120 BPM claps');
r = analyzeSignal(claps(120).a, 44100);
check('bpm = 120 ±2', typeof r.bpm === 'number' && Math.abs(r.bpm-120) <= 2, `got ${r.bpm}`);
check('meter defaults to 4/4', r.meter.beatsPerBar === 4, `got ${r.meter.label}`);

console.log('90 BPM claps with 0.3s pickup');
r = analyzeSignal(claps(90,8,44100,0.3).a, 44100);
check('bpm = 90 ±2', typeof r.bpm === 'number' && Math.abs(r.bpm-90) <= 2, `got ${r.bpm}`);
check('firstBeatSec near 0.3s', r.firstBeatSec !== null && Math.abs(r.firstBeatSec-0.3) < 0.12, `got ${r.firstBeatSec}`);

console.log('C major scale');
r = analyzeSignal(scale([261.63,293.66,329.63,349.23,392,440,493.88,523.25]).a, 44100);
check('key = C major', r.key === 'C' && r.scale === 'major', `got ${r.key} ${r.scale}`);

console.log('A minor scale');
r = analyzeSignal(scale([220,246.94,261.63,293.66,329.63,349.23,392,440]).a, 44100);
check('key = A minor', r.key === 'A' && r.scale === 'minor', `got ${r.key} ${r.scale}`);

console.log('Phrased voice (bursts + breaths)');
r = analyzeSignal(phrasedVoice(330).a, 44100);
check('3 phrases detected', r.phrases.length === 3, `got ${r.phrases.length}: ${JSON.stringify(r.phrases)}`);
check('first phrase starts ~0.5s', r.phrases.length && Math.abs(r.phrases[0].start-0.5) < 0.2, `got ${r.phrases[0]?.start}`);

console.log('Silence');
r = analyzeSignal(new Float32Array(44100), 44100);
check('no notes, fallback source', r.notes.length === 0 && r.analysisSource === 'fallback', `got ${r.notes.length} notes / ${r.analysisSource}`);
check('phrases fallback non-empty', r.phrases.length > 0, 'empty phrases');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll analysis tests passed.');
