import type { PitchFrame } from './extractPitch';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export type NoteEvent = { note: string; midi: number; startTime: number; duration: number; confidence: number };

const hzToMidi = (hz: number) => Math.round(69 + 12 * Math.log2(hz / 440));
const midiToNote = (midi: number) => `${NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export function pitchToNotes(contour: PitchFrame[], hopSize: number, sampleRate: number): NoteEvent[] {
  const frameSec = hopSize / sampleRate;
  const events: NoteEvent[] = [];
  let curr: NoteEvent | null = null;

  const smooth = contour.map((f, i) => {
    let sum = 0, count = 0;
    for (let k = i - 2; k <= i + 2; k++) {
      if (contour[k] && contour[k].hz > 0) { sum += contour[k].hz; count++; }
    }
    return { ...f, hz: count ? sum / count : 0 };
  });

  for (let i = 0; i < smooth.length; i++) {
    const f = smooth[i];
    if (!f.hz || f.confidence < 0.2) {
      if (curr && curr.duration >= 0.08) events.push(curr);
      curr = null;
      continue;
    }

    const midi = hzToMidi(f.hz);
    if (!curr) {
      curr = { note: midiToNote(midi), midi, startTime: i * frameSec, duration: frameSec, confidence: f.confidence };
      continue;
    }

    if (Math.abs(midi - curr.midi) <= 1) {
      curr.midi = Math.round((curr.midi + midi) / 2);
      curr.note = midiToNote(curr.midi);
      curr.duration = i * frameSec - curr.startTime + frameSec;
      curr.confidence = (curr.confidence + f.confidence) / 2;
    } else {
      if (curr.duration >= 0.08) events.push(curr);
      curr = { note: midiToNote(midi), midi, startTime: i * frameSec, duration: frameSec, confidence: f.confidence };
    }
  }

  if (curr && curr.duration >= 0.08) events.push(curr);
  return events;
}
