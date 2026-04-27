import type { NoteEvent } from './pitchToNotes';

type ScaleName = 'major' | 'minor' | 'pentatonic' | 'unknown';
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTA = [0, 2, 4, 7, 9];

function score(hist: number[], root: number, tpl: number[]) {
  const set = tpl.map((x) => (x + root) % 12);
  return hist.reduce((acc, val, pc) => acc + (set.includes(pc) ? val : 0), 0);
}

export function detectKey(notes: NoteEvent[]) {
  if (!notes.length) return { key: 'C', scale: 'unknown' as ScaleName, confidence: 0.1 };
  const hist = new Array(12).fill(0);
  notes.forEach((n) => { hist[(n.midi % 12 + 12) % 12] += Math.max(0.1, n.duration) * Math.max(0.1, n.confidence); });

  let best = { key: 'C', scale: 'unknown' as ScaleName, score: -1 };
  for (let r = 0; r < 12; r++) {
    const cands: [ScaleName, number][] = [
      ['major', score(hist, r, MAJOR)],
      ['minor', score(hist, r, MINOR)],
      ['pentatonic', score(hist, r, PENTA)],
    ];
    cands.forEach(([scale, s]) => { if (s > best.score) best = { key: KEYS[r], scale, score: s }; });
  }
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  return { key: best.key, scale: best.scale, confidence: Math.max(0.2, Math.min(0.95, best.score / total)) };
}
