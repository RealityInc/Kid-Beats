export type PitchFrame = { time: number; hz: number; confidence: number };

export function extractPitch(signal: number[], sampleRate: number, opts: { frameMs?: number; hopMs?: number; minHz?: number; maxHz?: number } = {}) {
  const frameSize = Math.max(256, Math.floor(sampleRate * ((opts.frameMs ?? 0.02))));
  const hopSize = Math.max(64, Math.floor(sampleRate * ((opts.hopMs ?? 0.01))));
  const minHz = opts.minHz ?? 80;
  const maxHz = opts.maxHz ?? 1000;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  const contour: PitchFrame[] = [];

  for (let i = 0; i + frameSize < signal.length; i += hopSize) {
    const frame = signal.slice(i, i + frameSize);
    let rms = 0;
    for (let j = 0; j < frame.length; j++) rms += frame[j] * frame[j];
    rms = Math.sqrt(rms / frame.length);
    if (rms < 0.008) {
      contour.push({ time: i / sampleRate, hz: 0, confidence: 0 });
      continue;
    }

    let bestLag = -1;
    let best = -Infinity;
    let second = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0;
      for (let k = 0; k < frameSize - lag; k++) score += frame[k] * frame[k + lag];
      if (score > best) {
        second = best;
        best = score;
        bestLag = lag;
      } else if (score > second) {
        second = score;
      }
    }

    if (bestLag < 0) {
      contour.push({ time: i / sampleRate, hz: 0, confidence: 0 });
      continue;
    }

    const hz = sampleRate / bestLag;
    const peakness = (best - Math.max(0, second)) / Math.max(1e-6, Math.abs(best));
    const confidence = Math.max(0, Math.min(1, 0.6 * peakness + 0.4 * Math.min(1, rms * 10)));
    contour.push({ time: i / sampleRate, hz, confidence });
  }

  return { frameSize, hopSize, contour };
}
