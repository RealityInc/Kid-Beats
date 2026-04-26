const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function hzToMidi(hz) {
  return Math.round(69 + 12 * Math.log2(hz / 440));
}

function midiToName(midi) {
  const name = NAMES[(midi % 12 + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function pitchToNotes(contour, hopSize, sampleRate, opts = {}) {
  const minConfidence = opts.minConfidence || 0.2;
  const minDur = opts.minDuration || 0.08;
  const smoothWindow = opts.smoothWindow || 3;

  const cleaned = contour.map((f) => ({ ...f }));
  for (let i = 0; i < cleaned.length; i++) {
    let sum = 0, count = 0;
    for (let j = i - smoothWindow; j <= i + smoothWindow; j++) {
      if (cleaned[j] && cleaned[j].hz > 0) { sum += cleaned[j].hz; count++; }
    }
    if (count) cleaned[i].hz = sum / count;
  }

  const events = [];
  let current = null;
  const frameDur = hopSize / sampleRate;

  for (let i = 0; i < cleaned.length; i++) {
    const f = cleaned[i];
    if (!f.hz || f.confidence < minConfidence) {
      if (current) {
        current.duration = i * frameDur - current.startTime;
        if (current.duration >= minDur) events.push(current);
        current = null;
      }
      continue;
    }

    const midi = hzToMidi(f.hz);
    const note = midiToName(midi);
    if (!current) {
      current = { note, midi, startTime: i * frameDur, duration: frameDur, confidence: f.confidence };
      continue;
    }

    if (Math.abs(midi - current.midi) <= 1) {
      current.midi = Math.round((current.midi + midi) / 2);
      current.note = midiToName(current.midi);
      current.duration = i * frameDur - current.startTime + frameDur;
      current.confidence = (current.confidence + f.confidence) / 2;
    } else {
      if (current.duration >= minDur) events.push(current);
      current = { note, midi, startTime: i * frameDur, duration: frameDur, confidence: f.confidence };
    }
  }

  if (current && current.duration >= minDur) events.push(current);
  return events;
}
