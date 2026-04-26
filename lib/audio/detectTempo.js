export function detectTempo(noteEvents = []) {
  if (!noteEvents.length) return { bpm: 100, confidence: 0.1, rhythmPattern: [1, 1, 1, 1] };
  const onsets = noteEvents.map((n) => n.startTime).sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < onsets.length; i++) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 0.08 && d < 1.8) intervals.push(d);
  }
  if (!intervals.length) return { bpm: 100, confidence: 0.2, rhythmPattern: noteEvents.map((n) => Number(n.duration.toFixed(2))) };
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let bpm = Math.round(60 / avg);
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm = Math.round(bpm / 2);
  const variance = intervals.reduce((a, b) => a + (b - avg) ** 2, 0) / intervals.length;
  const confidence = Math.max(0.2, Math.min(0.95, 1 - Math.min(1, variance / 0.08)));
  const rhythmPattern = noteEvents.map((n) => Number((n.duration / avg).toFixed(2)));
  return { bpm, confidence, rhythmPattern };
}
