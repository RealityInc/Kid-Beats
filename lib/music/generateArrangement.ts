const ROW_NOTES = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'];

export function generateArrangement(songPlan: any, opts: { variation?: string } = {}) {
  const steps = 16;
  const drums = Array.from({ length: 4 }, () => Array(steps).fill(0));
  const melody = Array.from({ length: 8 }, () => Array(steps).fill(0));
  const bass = Array.from({ length: 5 }, () => Array(steps).fill(0));
  const chords = Array.from({ length: 4 }, () => Array(steps).fill(0));

  const fast = opts.variation === 'faster' ? 1.15 : 1;
  const calmer = opts.variation === 'calmer';

  const mel = songPlan.melody || [];
  const totalLen = Math.max(1, mel.length ? mel[mel.length - 1].startTime + mel[mel.length - 1].duration : 2);
  mel.forEach((n: any) => {
    const idx = ROW_NOTES.findIndex((x) => x.replace(/\d/g, '') === String(n.note || '').replace(/\d/g, ''));
    if (idx < 0) return;
    const step = Math.max(0, Math.min(15, Math.round((n.startTime / totalLen) * 15)));
    melody[idx][step] = 1;
    if (opts.variation === 'more_melody' && step + 1 < steps) melody[idx][step + 1] = 1;
  });

  for (let s = 0; s < steps; s++) {
    if (s % 4 === 0) drums[0][s] = 1;
    if (s % 8 === 4) drums[1][s] = 1;
    drums[2][s] = calmer ? (s % 2 === 0 ? 1 : 0) : 1;
  }

  for (let bar = 0; bar < 4; bar++) {
    const step = bar * 4;
    chords[bar % 4][step] = 1;
    bass[Math.min(4, bar)][step] = 1;
    bass[Math.min(4, bar)][step + 2] = 1;
  }

  return {
    name: songPlan.title,
    bpm: Math.round((songPlan.bpm || 100) * fast),
    style: songPlan.style,
    drums,
    melody,
    bass,
    chords,
    lyrics: [],
  };
}
