const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function midiToNote(midi) { return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`; }
export function freqToMidiFloat(freq) { return 69 + (12 * Math.log2(freq / 440)); }
export function freqToMidi(freq) { return Math.round(freqToMidiFloat(freq)); }
export function midiToFreq(midi) { return 440 * (2 ** ((midi - 69) / 12)); }

function frameRms(frame){ let s=0; for(let i=0;i<frame.length;i++) s += frame[i]*frame[i]; return Math.sqrt(s/frame.length); }

function downsample(frame, factor){
  const n = Math.floor(frame.length / factor);
  const out = new Float32Array(n);
  for(let j=0;j<n;j++){ let s=0; const base=j*factor; for(let k=0;k<factor;k++) s+=frame[base+k]; out[j]=s/factor; }
  return out;
}

// McLeod Pitch Method: NSDF with first-major-peak picking and parabolic
// interpolation. Far more accurate than raw autocorrelation (which biases
// toward low octaves) and amplitude-independent. Runs on 4x-decimated audio:
// voice fundamentals live below 1.2 kHz, so 11 kHz effective rate is plenty
// and the O(N·lag) scan gets ~16x cheaper.
function mpmPitch(frame, sr){
  const DS = 4, dsr = sr / DS;
  const buf = downsample(frame, DS);
  const N = buf.length;
  let energy = 0; for(let i=0;i<N;i++) energy += buf[i]*buf[i];
  if (energy / N < 0.00004) return null; // silence gate (RMS ~0.006)
  const minLag = Math.max(2, Math.floor(dsr / 1200));
  const maxLag = Math.min(N - 3, Math.ceil(dsr / 70));
  if (maxLag <= minLag) return null;
  const nsdf = new Float32Array(maxLag + 1);
  // m(tau) computed incrementally: m(tau) = m(tau-1) - x²(tau-1) - x²(N-tau)
  let m = 2 * energy;
  for(let tau=1;tau<=maxLag;tau++){
    m -= buf[tau-1]*buf[tau-1] + buf[N-tau]*buf[N-tau];
    let ac = 0;
    for(let i=0;i<N-tau;i++) ac += buf[i]*buf[i+tau];
    nsdf[tau] = m > 0 ? (2 * ac) / m : 0;
  }
  // Collect the highest point of every positive lobe after the lag-0 lobe.
  const peaks = [];
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++; // skip lag-0 lobe
  while (tau <= maxLag){
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let peakTau = -1, peakVal = -Infinity;
    while (tau <= maxLag && nsdf[tau] > 0){
      if (nsdf[tau] > peakVal){ peakVal = nsdf[tau]; peakTau = tau; }
      tau++;
    }
    if (peakTau >= minLag) peaks.push([peakTau, peakVal]);
  }
  if (!peaks.length) return null;
  let maxVal = -Infinity;
  for (const p of peaks) if (p[1] > maxVal) maxVal = p[1];
  if (maxVal < 0.5) return null; // not periodic enough to be voice
  const chosen = peaks.find(p => p[1] >= maxVal * 0.875); // first big peak beats octave errors
  let lag = chosen[0];
  const val = chosen[1];
  if (lag > 1 && lag < maxLag){
    const a = nsdf[lag-1], b = nsdf[lag], c = nsdf[lag+1];
    const denom = a - 2*b + c;
    if (Math.abs(denom) > 1e-9) lag += 0.5 * (a - c) / denom;
  }
  return { freq: dsr / lag, confidence: Math.min(1, val) };
}

// Median-smooth the pitch track and drop isolated blips — kills the
// octave-jump glitches that made auto-melody and key detection noisy.
function smoothPitchTrack(framePitches){
  const out = new Array(framePitches.length).fill(null);
  for(let i=0;i<framePitches.length;i++){
    const p = framePitches[i];
    if (!p) continue;
    const window = [];
    for(let j=Math.max(0,i-2); j<=Math.min(framePitches.length-1,i+2); j++){
      if (framePitches[j]) window.push(framePitches[j].midiFloat);
    }
    if (window.length < 2) continue; // isolated single-frame blip — drop it
    window.sort((a,b)=>a-b);
    const med = window[Math.floor(window.length/2)];
    // Octave-error fold: if this frame is ~an octave from its neighborhood, fold it back
    let mf = p.midiFloat;
    while (mf - med > 7) mf -= 12;
    while (med - mf > 7) mf += 12;
    out[i] = { ...p, midiFloat: mf, freq: midiToFreq(mf) };
  }
  return out;
}

// Krumhansl-Schmuckler key estimation: Pearson correlation between the
// confidence-weighted pitch-class histogram and the K-S tonal profiles.
const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function pearson(x, y){
  const n = x.length;
  let mx=0,my=0; for(let i=0;i<n;i++){ mx+=x[i]; my+=y[i]; } mx/=n; my/=n;
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){ const a=x[i]-mx,b=y[i]-my; num+=a*b; dx+=a*a; dy+=b*b; }
  return (dx>0&&dy>0) ? num/Math.sqrt(dx*dy) : 0;
}
export function estimateKeyFromNotes(notes){
  const counts = new Array(12).fill(0);
  for (const n of notes) counts[((n.midi % 12) + 12) % 12] += (n.confidence ?? 1);
  const candidates = [];
  for(let root=0;root<12;root++){
    const rotated = Array.from({length:12}, (_,pc)=>counts[(pc+root)%12]);
    candidates.push({ key: NOTE_NAMES[root], scale:'major', confidence: Number(((pearson(rotated,KS_MAJOR)+1)/2).toFixed(3)) });
    candidates.push({ key: NOTE_NAMES[root], scale:'minor', confidence: Number(((pearson(rotated,KS_MINOR)+1)/2).toFixed(3)) });
  }
  candidates.sort((a,b)=>b.confidence-a.confidence);
  return candidates;
}

// Tempo: score BPM candidates against inter-onset intervals allowing
// half/dotted/double subdivisions, with a gentle prior toward singable tempos.
function estimateTempo(onsets, strengths){
  const ioi = [], w = [];
  for(let i=1;i<onsets.length;i++){
    const v = onsets[i]-onsets[i-1];
    if (v >= 0.2 && v <= 2.5){ ioi.push(v); w.push(Math.min(1, (strengths[i] ?? 0.5) + (strengths[i-1] ?? 0.5))); }
  }
  const MULTS = [0.5, 1, 1.5, 2, 3, 4];
  const candidates = [];
  for(let bpm=50;bpm<=190;bpm++){
    if (!ioi.length){ candidates.push({bpm,confidence:0}); continue; }
    const beat = 60/bpm;
    let credit = 0, total = 0;
    for(let i=0;i<ioi.length;i++){
      let best = Infinity;
      for(const k of MULTS){ const e = Math.abs(ioi[i]-k*beat); if (e<best) best=e; }
      credit += w[i] * Math.exp(-((best/(0.07*beat))**2));
      total += w[i];
    }
    const prior = 1 - Math.abs(bpm - 105) / 400; // mild bias toward kid-singable tempo
    candidates.push({ bpm, confidence: Number((total ? (credit/total)*prior : 0).toFixed(3)) });
  }
  candidates.sort((a,b)=>b.confidence-a.confidence||a.bpm-b.bpm);
  return candidates;
}

// Beat phase via circular mean of onset times mod beat — anchors the grid so
// playback can align the vocal's first beat to the backing's downbeat.
function estimateBeatPhase(onsets, strengths, bpm){
  if (typeof bpm !== 'number' || !onsets.length) return null;
  const beat = 60/bpm;
  let sx=0, sy=0;
  for(let i=0;i<onsets.length;i++){
    const a = 2*Math.PI*(onsets[i]/beat);
    const s = strengths[i] ?? 0.5;
    sx += s*Math.cos(a); sy += s*Math.sin(a);
  }
  if (sx===0 && sy===0) return null;
  let phase = Math.atan2(sy, sx)/(2*Math.PI)*beat;
  phase = ((phase % beat) + beat) % beat;
  // First grid beat at/after the first onset minus half a beat of slack
  let first = phase;
  while (first < onsets[0] - beat*0.5) first += beat;
  return { phase: Number(phase.toFixed(4)), firstBeatSec: Number(Math.max(0, first).toFixed(4)), beatSec: beat };
}

// Meter guess: bucket onset strength by beat index and compare accent
// periodicity at 3 vs 4 beats per bar.
function estimateMeter(onsets, strengths, bpm, phase){
  if (typeof bpm !== 'number' || onsets.length < 6 || phase == null) return { beatsPerBar: 4, label: '4/4', confidence: 0 };
  const beat = 60/bpm;
  const beatStrength = [];
  for(let i=0;i<onsets.length;i++){
    const idx = Math.round((onsets[i]-phase)/beat);
    if (idx < 0) continue;
    beatStrength[idx] = (beatStrength[idx] ?? 0) + (strengths[i] ?? 0.5);
  }
  for(let i=0;i<beatStrength.length;i++) if (beatStrength[i]===undefined) beatStrength[i]=0;
  const overall = beatStrength.reduce((a,v)=>a+v,0)/Math.max(1,beatStrength.length);
  if (overall <= 0) return { beatsPerBar: 4, label: '4/4', confidence: 0 };
  const contrast = (P)=>{
    let best = 0;
    for(let o=0;o<P;o++){
      let s=0,c=0;
      for(let i=o;i<beatStrength.length;i+=P){ s+=beatStrength[i]; c++; }
      if (c) best = Math.max(best, (s/c)/overall);
    }
    return best;
  };
  const c3 = contrast(3), c4 = contrast(4);
  // Require a clear margin to call waltz time; 4/4 is the safe default
  if (c3 > c4 * 1.15) return { beatsPerBar: 3, label: '3/4', confidence: Number(Math.min(1,(c3-c4)).toFixed(3)) };
  return { beatsPerBar: 4, label: '4/4', confidence: Number(Math.min(1, Math.max(0, c4-c3)).toFixed(3)) };
}

// Voice-activity phrase segmentation: real sung phrases between breaths,
// instead of arbitrary fixed 4-second windows.
function detectPhrases(energies, hopSec, durationSec){
  if (!energies.length) return [];
  const sorted = [...energies].sort((a,b)=>b-a);
  const loudRef = sorted[Math.floor(sorted.length*0.15)] || 0;
  const thr = Math.max(0.008, loudRef * 0.25);
  const hang = Math.max(1, Math.round(0.25/hopSec));
  const active = new Array(energies.length).fill(false);
  let sinceLoud = Infinity;
  for(let i=0;i<energies.length;i++){
    if (energies[i] > thr) sinceLoud = 0; else sinceLoud++;
    active[i] = sinceLoud <= hang;
  }
  const raw = [];
  let start = -1;
  for(let i=0;i<active.length;i++){
    if (active[i] && start<0) start = i;
    if ((!active[i] || i===active.length-1) && start>=0){
      raw.push([start, i]); start = -1;
    }
  }
  // Merge gaps < 0.35s, drop phrases < 0.4s
  const merged = [];
  for(const seg of raw){
    const last = merged[merged.length-1];
    if (last && (seg[0]-last[1])*hopSec < 0.35) last[1] = seg[1];
    else merged.push(seg);
  }
  return merged
    .filter(([s,e]) => (e-s)*hopSec >= 0.4)
    .map(([s,e])=>{
      let sum=0; for(let i=s;i<=e;i++) sum+=energies[i];
      return {
        start: Number((s*hopSec).toFixed(2)),
        end: Number(Math.min(durationSec,(e+1)*hopSec).toFixed(2)),
        energy: Number((sum/(e-s+1)).toFixed(3)),
      };
    });
}

export function analyzeSignal(data, sampleRate){
  const durationSec = data.length / sampleRate; const win=2048, hop=512;
  const hopSec = hop / sampleRate;
  const onsets=[], onsetStrengths=[], ioi=[], energies=[];
  const framePitches = [];
  let fluxAvg = 0, lastE=0, lastOnset=-1;
  for(let i=0;i+win<data.length;i+=hop){
    const frame = data.subarray(i, i+win); const e = frameRms(frame); energies.push(e); const t=i/sampleRate;
    const flux = Math.max(0, e-lastE);
    fluxAvg = fluxAvg*0.95 + flux*0.05;
    // Adaptive onset threshold: spike must clear both an absolute floor and the local flux average
    if(e>0.01 && flux>Math.max(0.018, fluxAvg*2.5) && t-lastOnset>=0.12){ onsets.push(t); onsetStrengths.push(Math.min(1, flux*10)); lastOnset=t; }
    lastE=e;
    const p = mpmPitch(frame, sampleRate);
    if(p && p.freq>=80 && p.freq<=1200 && p.confidence>=0.5){
      framePitches.push({ time:t, freq:p.freq, midiFloat: freqToMidiFloat(p.freq), confidence:p.confidence });
    } else {
      framePitches.push(null);
    }
  }
  const smoothed = smoothPitchTrack(framePitches);
  const pitchContour=[], notes=[];
  for(const p of smoothed){
    if (!p) continue;
    const midi = Math.round(p.midiFloat);
    const pitch = midiToNote(midi);
    const entry = {time:Number(p.time.toFixed(3)),duration:hopSec,freq:Number(p.freq.toFixed(2)),midi,pitch,confidence:Number(p.confidence.toFixed(2))};
    notes.push(entry);
    pitchContour.push({time:entry.time,freq:entry.freq,midi,pitch,confidence:entry.confidence,centsOff:Number(((p.midiFloat-midi)*100).toFixed(1))});
  }
  for(let i=1;i<onsets.length;i++) ioi.push(onsets[i]-onsets[i-1]);
  const bpmCandidates = estimateTempo(onsets, onsetStrengths).slice(0,3);
  const bpm = bpmCandidates[0]?.confidence>0.25 ? bpmCandidates[0].bpm : 'uncertain';
  const beatGrid = estimateBeatPhase(onsets, onsetStrengths, bpm);
  const meter = estimateMeter(onsets, onsetStrengths, bpm, beatGrid?.phase ?? null);
  const keyCandidates = estimateKeyFromNotes(notes);
  const scaleCandidates = keyCandidates.map(c=>({scale:`${c.key} ${c.scale}`,confidence:c.confidence}));
  const top = keyCandidates[0]||{key:'uncertain',scale:'uncertain',confidence:0};
  const keyProfiles={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
  const topPcs = top.key!=='uncertain' ? (keyProfiles[top.scale]||keyProfiles.major).map(v=>(v+NOTE_NAMES.indexOf(top.key))%12) : [];
  const fitCount = notes.filter(n=>topPcs.includes(((n.midi%12)+12)%12)).length;
  const keyConfident = top.confidence>=0.55 && notes.length>=3;
  const pitchRange = notes.length ? {lowest:midiToNote(Math.min(...notes.map(n=>n.midi))),highest:midiToNote(Math.max(...notes.map(n=>n.midi)))} : {lowest:'uncertain',highest:'uncertain'};
  const effectiveOnsets = onsets.filter((t, i) => i === 0 || t - onsets[i - 1] >= 0.25);
  const expectedBeats = (typeof bpm === 'number') ? (durationSec * bpm / 60) : durationSec * 2;
  const onsetAccuracy = Math.max(0, 1 - Math.abs(effectiveOnsets.length - expectedBeats) / Math.max(1, expectedBeats));
  const rhythmConfidence = Number((onsetAccuracy * (bpmCandidates[0]?.confidence || 0)).toFixed(3));
  let phrases = detectPhrases(energies, hopSec, durationSec);
  if (!phrases.length){
    for(let s=0;s<durationSec;s+=4){ const st=Math.floor(s*sampleRate),en=Math.min(data.length,Math.floor((s+4)*sampleRate)); phrases.push({start:Number(s.toFixed(2)),end:Number(Math.min(durationSec,s+4).toFixed(2)),energy:Number(frameRms(data.subarray(st,en)).toFixed(3))}); }
  }
  const avgEnergy = energies.length?energies.reduce((a,v)=>a+v,0)/energies.length:0;
  const analysisSource = notes.length || onsets.length ? 'real-detected' : 'fallback';
  return {
    durationSec:Number(durationSec.toFixed(2)),
    analysisSource,
    bpm,
    bpmCandidates,
    firstBeatSec: beatGrid?.firstBeatSec ?? null,
    beatPhase: beatGrid?.phase ?? null,
    meter,
    onsets:onsets.map(v=>Number(v.toFixed(3))),
    interOnsetIntervals:ioi.map(v=>Number(v.toFixed(3))),
    key:keyConfident?top.key:'uncertain',
    scale:keyConfident?top.scale:'uncertain',
    keyCandidates:keyCandidates.slice(0,3),
    scaleCandidates:scaleCandidates.slice(0,3),
    scaleFit:{fitCount,totalNotes:notes.length},
    pitchRange,
    pitchContour,
    notes,
    phrases,
    rhythm:{onsets:onsets.map(v=>Number(v.toFixed(3))),gridFit:bpmCandidates[0]?.confidence||0,confidence:rhythmConfidence,inferredFrom:[onsets.length?'amplitude':null,notes.length?'pitch changes':null].filter(Boolean)},
    mood:{label:'estimated',method:'estimated from tempo, pitch range, loudness, and mode',factors:{tempo:bpm,pitchRange,loudness:Number(avgEnergy.toFixed(3)),mode:keyConfident?top.scale:'uncertain'}},
    uncertain:!keyConfident||notes.length<3?'not enough signal':null,
  };
}
