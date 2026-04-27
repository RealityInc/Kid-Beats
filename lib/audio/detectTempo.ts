export function detectTempo(signal: number[], sampleRate: number) {
  const frameSize = 1024;
  const hop = 512;
  const frames: number[] = [];

  for (let i = 0; i + frameSize < signal.length; i += hop) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) {
      const s = signal[i + j];
      e += s * s;
    }
    frames.push(Math.sqrt(e / frameSize));
  }

  const flux: number[] = [0];
  for (let i = 1; i < frames.length; i++) flux.push(Math.max(0, frames[i] - frames[i - 1]));

  const srFlux = sampleRate / hop;
  const minLag = Math.floor(srFlux * 60 / 200);
  const maxLag = Math.floor(srFlux * 60 / 70);
  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = lag; i < flux.length; i++) c += flux[i] * flux[i - lag];
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }

  const bpm = Math.max(70, Math.min(180, Math.round(60 * srFlux / bestLag)));
  const beatSpacing = bestLag / srFlux;

  // pulse-train alignment
  let bestOffset = 0;
  let bestPulse = -Infinity;
  for (let o = 0; o < bestLag; o++) {
    let p = 0;
    for (let i = o; i < flux.length; i += bestLag) p += flux[i] || 0;
    if (p > bestPulse) { bestPulse = p; bestOffset = o; }
  }

  const beatTimes: number[] = [];
  for (let i = bestOffset; i < flux.length; i += bestLag) beatTimes.push(i / srFlux);

  const rhythmPattern = beatTimes.slice(1).map((t, i) => Number((t - beatTimes[i]).toFixed(2))).slice(0, 16);
  const confidence = Math.max(0.2, Math.min(0.95, bestCorr / Math.max(1e-6, flux.reduce((a, b) => a + b * b, 0))));
  return { bpm, beatTimes, rhythmPattern, confidence };
}
