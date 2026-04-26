const ROW_NOTES = ['C4','D4','E4','G4','A4','C5','D5','E5'];
const BASS_NOTES = ['C2','D2','E2','G2','A2'];
const CHORDS = ['C','Am','F','G'];

export function generateArrangement(songPlan, opts = {}) {
  const steps = 16;
  const melody = Array.from({ length: 8 }, () => Array(steps).fill(0));
  const drums = Array.from({ length: 4 }, () => Array(steps).fill(0));
  const bass = Array.from({ length: 5 }, () => Array(steps).fill(0));
  const chords = Array.from({ length: 4 }, () => Array(steps).fill(0));

  const energy = opts.energy || 'medium';
  const density = opts.useMoreMelody ? 1 : 0.75;

  (songPlan.melody || []).forEach((n) => {
    const idx = ROW_NOTES.findIndex((x) => x.replace(/\d/, '') === n.note.replace(/\d/, ''));
    if (idx < 0) return;
    const step = Math.max(0, Math.min(15, Math.round((n.startTime / Math.max(0.01, (songPlan.melody.at(-1)?.startTime || 2))) * 15)));
    melody[idx][step] = 1;
    if (density > 0.8 && step + 1 < steps && n.duration > 0.35) melody[idx][step + 1] = 1;
  });

  for (let s = 0; s < steps; s++) {
    drums[2][s] = 1;
    if (s % 4 === 0) drums[0][s] = 1;
    if (s % 8 === 4) drums[1][s] = 1;
    if (energy === 'high' && s % 8 === 7) drums[3][s] = 1;
  }

  for (let b = 0; b < 4; b++) {
    const chStep = b * 4;
    chords[b % CHORDS.length][chStep] = 1;
    bass[b % BASS_NOTES.length][chStep] = 1;
    bass[b % BASS_NOTES.length][chStep + 2] = 1;
  }

  return { name: songPlan.title, bpm: songPlan.bpm, style: songPlan.style, drums, melody, bass, chords, lyrics: [] };
}
