const MAJOR = [0,2,4,5,7,9,11];
const MINOR = [0,2,3,5,7,8,10];
const PENTA = [0,2,4,7,9];
const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function scoreFor(pcSet, mode, root) {
  const tpl = mode.map((x) => (x + root) % 12);
  return pcSet.reduce((acc, v, pc) => acc + (tpl.includes(pc) ? v : 0), 0);
}

export function detectKey(noteEvents = []) {
  if (!noteEvents.length) return { key: 'C', scale: 'unknown', confidence: 0.1 };
  const pcs = new Array(12).fill(0);
  noteEvents.forEach((n) => { pcs[(n.midi % 12 + 12) % 12] += Math.max(0.1, n.duration) * Math.max(0.1, n.confidence || 0.5); });
  let best = { score: -1, key: 'C', scale: 'unknown' };
  for (let r = 0; r < 12; r++) {
    const maj = scoreFor(pcs, MAJOR, r);
    const min = scoreFor(pcs, MINOR, r);
    const pen = scoreFor(pcs, PENTA, r);
    if (maj > best.score) best = { score: maj, key: KEYS[r], scale: 'major' };
    if (min > best.score) best = { score: min, key: KEYS[r], scale: 'minor' };
    if (pen > best.score) best = { score: pen, key: KEYS[r], scale: 'pentatonic' };
  }
  const total = pcs.reduce((a,b)=>a+b,0) || 1;
  return { key: best.key, scale: best.scale, confidence: Math.max(0.2, Math.min(0.95, best.score / total)) };
}
