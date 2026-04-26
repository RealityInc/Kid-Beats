export function extractPitch(signal, sampleRate, opts = {}) {
  const frameSize = opts.frameSize || 2048;
  const hopSize = opts.hopSize || 512;
  const minHz = opts.minHz || 80;
  const maxHz = opts.maxHz || 1000;
  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.floor(sampleRate / minHz);
  const frames = [];

  for (let i = 0; i + frameSize < signal.length; i += hopSize) {
    const frame = signal.slice(i, i + frameSize);
    let rms = 0;
    for (let j = 0; j < frame.length; j++) rms += frame[j] * frame[j];
    rms = Math.sqrt(rms / frame.length);
    if (rms < 0.01) {
      frames.push({ time: i / sampleRate, hz: 0, confidence: 0 });
      continue;
    }

    let bestLag = -1;
    let best = -Infinity;
    let second = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let k = 0; k < frameSize - lag; k++) sum += frame[k] * frame[k + lag];
      if (sum > best) {
        second = best;
        best = sum;
        bestLag = lag;
      } else if (sum > second) {
        second = sum;
      }
    }

    if (bestLag <= 0) {
      frames.push({ time: i / sampleRate, hz: 0, confidence: 0 });
      continue;
    }
    const hz = sampleRate / bestLag;
    const confidence = Math.max(0, Math.min(1, (best - Math.max(0, second)) / Math.max(1e-6, Math.abs(best))));
    frames.push({ time: i / sampleRate, hz, confidence: Math.max(confidence, Math.min(1, rms * 8)) });
  }

  return { frameSize, hopSize, contour: frames };
}
