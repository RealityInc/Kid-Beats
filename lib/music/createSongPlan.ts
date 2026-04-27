import type { NoteEvent } from '../audio/pitchToNotes';

export function createSongPlan(input: {
  noteEvents: NoteEvent[];
  keyInfo: { key: string; scale: string };
  tempoInfo: { bpm: number; beatTimes?: number[]; rhythmPattern?: number[] };
  vibe: { mood: string; energy: string; theme: string; suggestedStyles: string[] };
}) {
  const { noteEvents, keyInfo, tempoInfo, vibe } = input;
  const bpm = tempoInfo.bpm || 100;
  const style = vibe.suggestedStyles?.[0] || 'kids pop';
  const title = `${vibe.theme || 'My'} ${keyInfo.key} Song`;

  const melody = noteEvents.length ? noteEvents : [{ note: 'C4', midi: 60, startTime: 0, duration: 0.5, confidence: 0.2 }];
  const chords = keyInfo.scale === 'minor' ? [`${keyInfo.key}m`, 'G', 'F', `${keyInfo.key}m`] : [keyInfo.key, 'G', 'Am', 'F'];
  const bass = melody.map((n) => ({ ...n, midi: Math.max(36, n.midi - 24) }));

  return { title, key: keyInfo.key, scale: keyInfo.scale, bpm, chords, melody, bass, rhythm: tempoInfo.rhythmPattern || [], style };
}
