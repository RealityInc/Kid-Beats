// Generates a synthetic "kid singing" WAV: short melodic phrases with breaths,
// used by the browser smoke test.
import { writeFileSync } from 'node:fs';

const sr = 44100, dur = 10;
const a = new Float32Array(sr * dur);
// Melody in C major at ~100 BPM (0.6s per note), phrases with gaps
const phrases = [
  { start: 0.3, notes: [261.63, 293.66, 329.63, 392.00] },
  { start: 3.5, notes: [392.00, 329.63, 293.66, 261.63] },
  { start: 6.7, notes: [329.63, 392.00, 440.00, 523.25] },
];
const noteLen = 0.6;
for (const ph of phrases) {
  ph.notes.forEach((f, idx) => {
    const s = Math.floor((ph.start + idx * noteLen) * sr);
    const n = Math.floor(noteLen * 0.9 * sr);
    for (let i = 0; i < n && s + i < a.length; i++) {
      const env = Math.min(1, i / (0.02 * sr)) * Math.min(1, (n - i) / (0.05 * sr));
      const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5 * i / sr); // light vibrato
      a[s + i] += 0.35 * env * Math.sin(2 * Math.PI * f * vib * i / sr);
    }
  });
}
// 16-bit PCM WAV
const bytes = new Uint8Array(44 + a.length * 2);
const dv = new DataView(bytes.buffer);
const wstr = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
wstr(0, 'RIFF'); dv.setUint32(4, 36 + a.length * 2, true); wstr(8, 'WAVE');
wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
wstr(36, 'data'); dv.setUint32(40, a.length * 2, true);
for (let i = 0; i < a.length; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, a[i] * 32767)), true);
writeFileSync(new URL('./fixtures-test-vocal.wav', import.meta.url), bytes);
console.log('wrote fixtures-test-vocal.wav');
