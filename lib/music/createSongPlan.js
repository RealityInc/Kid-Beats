export function createSongPlan({ noteEvents = [], keyInfo, tempoInfo, vibe }) {
  const bpm = tempoInfo?.bpm || 100;
  const key = keyInfo?.key || 'C';
  const scale = keyInfo?.scale || 'major';
  const style = (vibe?.suggestedStyles && vibe.suggestedStyles[0]) || 'kids pop';
  const mood = vibe?.mood || 'happy';
  const title = `${mood[0].toUpperCase() + mood.slice(1)} ${key} Jam`;

  const chords = scale === 'minor' ? [`${key}m`, 'Fm', 'Gm', `${key}m`] : [key, 'F', 'G', key];
  const melody = noteEvents.length ? noteEvents : [
    { note: 'C4', midi: 60, startTime: 0, duration: 0.5, confidence: 0.2 },
    { note: 'E4', midi: 64, startTime: 0.5, duration: 0.5, confidence: 0.2 },
    { note: 'G4', midi: 67, startTime: 1, duration: 0.5, confidence: 0.2 }
  ];
  const bass = melody.map((n) => ({ ...n, midi: Math.max(36, n.midi - 24) }));
  const drums = tempoInfo?.rhythmPattern?.map((r, i) => ({ step: i, kick: i % 4 === 0, snare: i % 4 === 2, hat: true, dur: r })) || [];
  const sections = [{ name: 'A', bars: 2 }, { name: 'B', bars: 2 }];

  return { title, key, scale, bpm, chords, melody, bass, drums, sections, style };
}
