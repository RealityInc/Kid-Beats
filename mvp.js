import { analyzeSignal } from './analysis-core.js';

const MAX_RECORD_SEC = 60;

class AudioStateMachine {
  constructor(onChange) { this.state = 'idle'; this.onChange = onChange; }
  set(next) { this.state = next; this.onChange?.(next); }
}

class AudioInputManager {
  static preferredMimeType() {
    if (!window.MediaRecorder) return null;
    const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }
}

class RecordingManager {
  constructor(debug) { this.debug = debug; }
  async start(onChunk, onStop) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    const mimeType = AudioInputManager.preferredMimeType();
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.debug.selectedMimeType = this.recorder.mimeType || mimeType || 'default';
    this.recorder.ondataavailable = (e) => e.data.size && onChunk(e.data);
    this.recorder.onstop = () => onStop();
    this.recorder.start(250);
    return this.recorder;
  }
  stop() {
    this.recorder?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

class UploadManager { async getBlob(file) { return file; } }

function adaptAnalysis(raw) {
  const bpm = typeof raw.bpm === 'number' ? raw.bpm : (raw.bpmCandidates?.[0]?.bpm ?? 100);
  const scale = raw.scale === 'uncertain' ? 'major' : raw.scale;
  const key = raw.key === 'uncertain' ? 'C' : raw.key;
  const loudness = raw.mood?.factors?.loudness ?? 0;
  const minor = scale === 'minor';
  const fast = bpm > 105;
  const loud = loudness > 0.05;
  let mood;
  if (minor && fast && loud) mood = 'spooky';
  else if (minor && fast) mood = 'sad';
  else if (minor) mood = 'chill';
  else if (fast && loud) mood = 'epic';
  else if (fast) mood = 'happy';
  else mood = 'silly';
  const durationSec = raw.durationSec ?? 0;
  const phrases = raw.phrases ?? (() => {
    const result = [];
    for (let s = 0; s < durationSec; s += 4) result.push({ start: s, end: Math.min(durationSec, s + 4), energy: 0.6 });
    return result;
  })();
  return { ...raw, bpm, key, scale, mood, styleSuggestion: 'pop', phrases };
}

class VocalAnalysisEngine {
  async analyze(blob) {
    const arr = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(arr.slice(0));
    const raw = analyzeSignal(buffer.getChannelData(0), buffer.sampleRate);
    await ctx.close();
    return adaptAnalysis(raw);
  }
}

class MoodPresetEngine { resolve(input, detected) { return input === 'Auto' ? detected : input.toLowerCase(); } }
class StylePresetEngine { resolve(input, detected) { return input === 'Auto' ? detected : input.toLowerCase(); } }

// Chord progressions: semitone offsets from root, 4 chords per bar cycle.
// Multiple options per mood — the recording's analysis picks one deterministically.
const MOOD_PROGRESSIONS = {
  happy: [
    [[0,4,7],[7,11,14],[9,12,16],[5,9,12]],      // I-V-vi-IV  (pop anthem)
    [[0,4,7],[5,9,12],[7,11,14],[0,4,7]],          // I-IV-V-I   (classic)
    [[0,4,7],[9,12,16],[5,9,12],[7,11,14]],        // I-vi-IV-V  (50s doo-wop)
    [[0,4,7],[5,9,12],[9,12,16],[7,11,14]],        // I-IV-vi-V  (anthem variant)
    [[0,4,7],[2,5,9,12],[5,9,12],[7,11,14]],       // I-ii7-IV-V (jazz-pop)
  ],
  sad: [
    [[0,3,7],[8,12,15],[3,7,10],[10,14,17]],       // i-VI-III-VII  (pop minor)
    [[0,3,7],[5,8,12],[7,10,14],[0,3,7]],           // i-iv-v-i      (pure minor)
    [[0,3,7],[10,14,17],[8,12,15],[10,14,17]],      // i-VII-VI-VII  (oscillating)
    [[0,3,7],[3,7,10],[8,12,15],[5,8,12]],          // i-III-VI-iv   (descending)
    [[0,3,7],[8,12,15],[7,10,14],[3,7,10]],         // i-VI-v-III    (minor waltz)
  ],
  chill: [
    [[0,4,7,11],[9,12,16,19],[5,9,12,16],[7,11,14,17]], // Imaj7-vi7-IVmaj7-V7
    [[0,4,7,11],[5,9,12,16],[2,5,9,12],[7,11,14,17]],   // Imaj7-IVmaj7-ii7-V7
    [[0,4,7,11],[9,12,16,19],[7,11,14,17],[0,4,7,11]],  // Imaj7-vi7-V7-Imaj7
    [[2,5,9,12],[7,11,14,17],[0,4,7,11],[9,12,16,19]],  // ii7-V7-Imaj7-vi7
    [[0,4,7,11],[4,7,11,14],[9,12,16,19],[2,5,9,12]],   // Imaj7-IIImaj7-vi7-ii7
  ],
  spooky: [
    [[0,3,7],[1,5,8],[7,11,14],[0,3,7]],            // i-bII-V-i        (phrygian)
    [[0,3,7],[8,12,15],[1,5,8],[7,11,14]],          // i-bVI-bII-V
    [[0,3,7],[7,10,13],[1,5,8],[0,3,7]],            // i-v°-bII-i       (diminished)
    [[0,3,7],[3,7,10],[1,5,8],[7,11,14]],           // i-III-bII-V
    [[0,3,7],[10,14,17],[1,5,8],[0,3,7]],           // i-bVII-bII-i
  ],
  silly: [
    [[0,5,7],[0,4,7],[5,9,14],[7,12,14]],            // sus4→I, IVadd9, Vsus
    [[0,2,7],[5,9,12],[0,5,7],[7,11,14]],            // Isus2-IV-Isus4-V
    [[0,5,7],[10,14,17],[5,9,12],[0,4,7]],           // Isus4-bVII-IV-I
    [[0,4,7],[0,5,7],[5,9,14],[7,12,14]],            // I-Isus4-IVadd9-Vsus
    [[0,5,7],[5,9,12],[0,2,7],[7,12,14]],            // Isus4-IV-Isus2-Vsus
  ],
  epic: [
    [[0,3,7],[8,12,15],[10,14,17],[0,3,7]],          // i-bVI-bVII-i   (cinematic)
    [[0,3,7],[10,14,17],[5,8,12],[0,3,7]],           // i-bVII-iv-i
    [[0,3,7],[9,13,16],[10,14,17],[0,3,7]],          // i-VI-bVII-i    (dorian VI)
    [[0,3,7,10],[8,12,15],[10,14,17],[8,12,15]],     // im7-bVI-bVII-bVI
    [[0,3,7],[5,8,12],[10,14,17],[8,12,15]],         // i-iv-bVII-bVI
  ],
};

const MOOD_SCALES = {
  happy: [0,2,4,5,7,9,11], sad: [0,2,3,5,7,8,10], chill: [0,2,4,5,7,9,11],
  spooky: [0,2,3,5,7,8,11], silly: [0,2,4,7,9], epic: [0,2,3,5,7,9,10],
};

function pickProgression(analysis, mood) {
  const pool = MOOD_PROGRESSIONS[mood] ?? MOOD_PROGRESSIONS.happy;
  const NI = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
  const ki = NI[analysis.key] ?? 0;
  const bpmInt = typeof analysis.bpm === 'number' ? Math.round(analysis.bpm) : 90;
  const ph = (analysis.phrases || []).length;
  const cl = (analysis.pitchContour || []).length;
  const h = Math.abs(ki * 31 + bpmInt * 17 + ph * 53 + cl * 11) % pool.length;
  return pool[h];
}

function styleInstrumentDefaults(style, mood) {
  if (style === 'country')       return { melody: 'pluck', bass: 'pluck', drums: 'clean' };
  if (style === 'rock')          return { melody: 'lead',  bass: 'growl', drums: 'heavy' };
  if (style === 'hip-hop')       return { melody: 'square',bass: 'sub',   drums: '808'   };
  if (style === 'dance')         return { melody: 'lead',  bass: 'square',drums: 'clean' };
  if (style === 'weird electro') return { melody: 'square',bass: 'growl', drums: 'heavy' };
  if (mood === 'spooky')         return { melody: 'bell',  bass: 'sub',   drums: 'heavy' };
  if (mood === 'chill')          return { melody: 'bell',  bass: 'sub',   drums: 'lofi'  };
  if (mood === 'epic')           return { melody: 'lead',  bass: 'growl', drums: 'heavy' };
  return { melody: 'pluck', bass: 'sub', drums: 'clean' };
}

class BackingTrackGenerator {
  constructor() { this._nodes = []; }
  _dispose() { this._nodes.forEach(n => { try { n.dispose(); } catch(e) {} }); this._nodes = []; }
  async generate(analysis, options) {
    await Tone.start();
    this._dispose();
    Tone.Transport.stop(); Tone.Transport.cancel();
    const mood = options.mood;
    const style = options.style;
    const instruments = options.instruments || {};
    const bpmOverride = options.bpmOverride || null;
    const styleDefs = styleInstrumentDefaults(style, mood);
    const melKey   = instruments.melody === 'auto' ? styleDefs.melody : instruments.melody;
    const bassKey  = instruments.bass   === 'auto' ? styleDefs.bass   : instruments.bass;
    const drumsKey = instruments.drums  === 'auto' ? styleDefs.drums  : instruments.drums;
    const isRock = style === 'rock';
    const isCountry = style === 'country';
    const is4OnFloor = style === 'dance';
    const isHipHop = style === 'hip-hop';
    const isElectro = style === 'weird electro';
    const moodBpmRange = { spooky:[50,95], sad:[50,90], chill:[55,100], silly:[75,130], happy:[85,135], epic:[110,165] };
    const [bpmMin, bpmMax] = moodBpmRange[mood] ?? [80, 120];
    const rawBpm = typeof analysis.bpm === 'number' ? analysis.bpm : (bpmMin + bpmMax) / 2;
    const effectiveBpm = bpmOverride ? Math.max(40, Math.min(220, bpmOverride)) : Math.max(bpmMin, Math.min(bpmMax, rawBpm));
    Tone.Transport.bpm.value = effectiveBpm;
    const secPerBar = (60 / effectiveBpm) * 4;
    let target = options.length === 'match' ? analysis.durationSec : Number(options.length);
    target = Math.max(target, analysis.durationSec);
    const bars = Math.ceil(target / secPerBar);
    const totalSec = bars * secPerBar;

    // Drum kit — override with selected kit or fall back to style/mood defaults
    const kitPresets = {
      clean: { kickOpts:{pitchDecay:0.05,octaves:4,envelope:{attack:0.001,decay:0.28,sustain:0}}, snareDecay:0.10, noiseType:'pink' },
      lofi:  { kickOpts:{pitchDecay:0.09,octaves:3,envelope:{attack:0.001,decay:0.38,sustain:0}}, snareDecay:0.22, noiseType:'pink' },
      heavy: { kickOpts:{pitchDecay:0.06,octaves:6,envelope:{attack:0.001,decay:0.16,sustain:0}}, snareDecay:0.07, noiseType:'white' },
      '808': { kickOpts:{pitchDecay:0.32,octaves:9,envelope:{attack:0.001,decay:0.65,sustain:0}}, snareDecay:0.14, noiseType:'pink' },
    };
    const kit = kitPresets[drumsKey];
    const kickOpts = kit ? kit.kickOpts
      : isHipHop ? { pitchDecay:0.18,octaves:9,envelope:{attack:0.001,decay:0.6,sustain:0} }
      : isRock    ? { pitchDecay:0.06,octaves:5,envelope:{attack:0.001,decay:0.2,sustain:0} }
      :              { pitchDecay:0.05,octaves:4 };
    const snareDecay = kit ? kit.snareDecay : isRock ? 0.09 : 0.13;
    const snareNoise = kit ? kit.noiseType  : isRock ? 'white' : 'pink';
    const drum  = new Tone.MembraneSynth(kickOpts);
    const snare = new Tone.NoiseSynth({ noise:{type:snareNoise}, envelope:{attack:0.001,decay:snareDecay,sustain:0} });
    const hat   = new Tone.NoiseSynth({ noise:{type:'white'},    envelope:{attack:0.001,decay:0.05,sustain:0} });

    // Bass instrument — override with user selection or derive from style
    const bassPresets = {
      sub:   ['sine',     {attack:0.01,decay:0.5, sustain:0.7,release:0.5}],
      growl: ['sawtooth', {attack:0.01,decay:0.2, sustain:0.8,release:0.3}],
      square:['square',   {attack:0.01,decay:0.2, sustain:0.6,release:0.3}],
      pluck: ['triangle', {attack:0.001,decay:0.4,sustain:0,  release:0.2}],
    };
    const bassP = bassPresets[bassKey];
    const bassOscFinal = bassP ? bassP[0] : isHipHop ? 'sine' : (isRock||isElectro) ? 'sawtooth' : is4OnFloor ? 'square' : 'triangle';
    const bassEnv  = bassP ? bassP[1] : {attack:0.01,decay:0.3,sustain:0.6,release:0.4};
    const bass = new Tone.Synth({ oscillator:{type:bassOscFinal}, envelope:bassEnv });

    // Chords — slow attack for atmospheric moods, sawtooth edge for rock, plucky strum for country
    const chordAtk = isCountry ? 0.001 : mood === 'spooky' ? 2.0 : (mood === 'chill' || mood === 'sad') ? 1.0 : 0.04;
    const chordOsc = isCountry ? 'triangle' : (mood === 'spooky' || mood === 'chill' || mood === 'sad') ? 'sine' : isRock ? 'sawtooth' : 'triangle';
    const chordEnv = isCountry
      ? { attack: 0.001, decay: 0.55, sustain: 0, release: 0.3 }  // guitar strum — zero sustain, natural decay
      : { attack: chordAtk, decay: 0.4, sustain: 0.7, release: 1.2 };
    const poly = new Tone.PolySynth(Tone.Synth, { oscillator:{type:chordOsc}, envelope:chordEnv });

    // Melody instrument — override with user selection or derive from style/mood
    const melPresets = {
      lead:  ['sawtooth', {attack:0.01, decay:0.1, sustain:0.7,release:0.2}],
      pluck: ['triangle', {attack:0.001,decay:0.35,sustain:0,  release:0.1}],
      bell:  ['sine',     {attack:0.001,decay:1.2, sustain:0,  release:0.5}],
      flute: ['sine',     {attack:0.06, decay:0.1, sustain:0.7,release:0.3}],
      square:['square',   {attack:0.01, decay:0.1, sustain:0.5,release:0.15}],
    };
    // Country uses Karplus-Strong (PluckSynth) for a realistic guitar pick sound
    const isGuitarMelody = isCountry;
    let melody;
    if (isGuitarMelody) {
      melody = new Tone.PluckSynth({ attackNoise: 1.0, dampening: 3000, resonance: 0.98 });
    } else {
      const melP = melPresets[melKey];
      const melOsc = melP ? melP[0] : (isRock||isElectro) ? 'sawtooth' : (mood==='spooky'||mood==='sad') ? 'sine' : 'triangle';
      const melEnv = melP ? melP[1] : {attack:0.02,decay:0.2,sustain:0.5,release:0.3};
      melody = new Tone.Synth({ oscillator:{type:melOsc}, envelope:melEnv });
    }

    // Atmospheric pad — lush long notes for spooky/chill/sad/epic
    const usePad = ['spooky', 'chill', 'sad', 'epic'].includes(mood);
    const pad = usePad ? new Tone.PolySynth(Tone.AMSynth, { harmonicity: mood === 'spooky' ? 2.0 : 1.5, envelope: { attack: mood === 'spooky' ? 2.5 : 1.5, decay: 1.0, sustain: 0.8, release: 2.5 } }) : null;

    // Arp synth — 8th-note chord arpeggios for dance/electro/happy/silly
    const useArp = (is4OnFloor || isElectro || mood === 'happy' || mood === 'silly') && !isCountry && !isRock;
    const arp = useArp ? new Tone.Synth({ oscillator: { type: isElectro ? 'sawtooth' : 'square' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.15, release: 0.08 } }) : null;

    // Open-hat shimmer — metallic sustain for spooky/chill/sad breathing space
    const useOpenHat = ['spooky', 'chill', 'sad'].includes(mood);
    const openHat = useOpenHat ? new Tone.MetalSynth({ frequency: 400, envelope: { attack: 0.001, decay: 0.9, release: 0.5 }, resonance: 4000, harmonicity: 5.1, modulationIndex: 32, octaves: 1.5 }) : null;

    // Effects — reverb and delay scale with mood atmosphere
    const reverbDecay = mood === 'spooky' ? 5.0 : mood === 'chill' ? 3.0 : mood === 'sad' ? 2.5 : 1.5;
    const reverbWet = mood === 'spooky' ? 0.45 : mood === 'chill' ? 0.3 : mood === 'sad' ? 0.22 : 0.15;
    const reverb = new Tone.Reverb({ decay: reverbDecay, wet: reverbWet });
    const delay = new Tone.PingPongDelay('8n', (mood === 'spooky' || mood === 'sad') ? 0.22 : 0.12);
    const limiter = new Tone.Limiter(-1).toDestination();
    const bus = new Tone.Gain(0.85).chain(reverb, delay, limiter);

    // Melody vibrato — gentle pitch wobble for spooky/sad expressiveness
    const vibrato = (mood === 'spooky' || mood === 'sad') ? new Tone.Vibrato({ frequency: 4.5, depth: 0.15 }) : null;
    if (vibrato) { melody.chain(vibrato, bus); } else { melody.connect(bus); }

    // Distortion — grit for rock (shared across poly + bass into bus)
    const dist = isRock ? new Tone.Distortion(0.35) : null;
    if (dist) { poly.connect(dist); bass.connect(dist); dist.connect(bus); } else { poly.connect(bus); bass.connect(bus); }

    hat.connect(bus); snare.connect(bus); drum.connect(limiter);

    // Pad routes through an extra lush reverb for depth
    const padReverb = usePad ? new Tone.Reverb({ decay: 6.0, wet: 0.55 }) : null;
    const padGain = usePad ? new Tone.Gain(0.28).chain(padReverb, limiter) : null;
    if (pad && padGain) pad.connect(padGain);
    if (arp) arp.connect(bus);
    if (openHat) openHat.connect(bus);

    this._nodes = [drum, snare, hat, bass, poly, melody, reverb, delay, limiter, bus];
    if (vibrato) this._nodes.push(vibrato);
    if (dist) this._nodes.push(dist);
    if (pad) this._nodes.push(pad);
    if (padReverb) this._nodes.push(padReverb);
    if (padGain) this._nodes.push(padGain);
    if (arp) this._nodes.push(arp);
    if (openHat) this._nodes.push(openHat);

    const rootMap = { C:'C2','C#':'C#2',D:'D2','D#':'D#2',E:'E2',F:'F2','F#':'F#2',G:'G2','G#':'G#2',A:'A2','A#':'A#2',B:'B2' };
    const root = rootMap[analysis.key] || 'C2';

    // Pick a chord progression from the pool using a hash of the analysis
    // so each unique recording gets a distinct progression.
    const prog = pickProgression(analysis, mood);
    const SI = MOOD_SCALES[mood] ?? MOOD_SCALES.happy;

    const NI = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
    const rootPc = NI[analysis.key] ?? 0;
    const scalePcs = SI.map(v => (v + rootPc) % 12);
    function snapMidi(midi) {
      const pc = ((midi % 12) + 12) % 12;
      let bestPc = scalePcs[0], bestDist = 12;
      for (const sp of scalePcs) { const d = Math.min(Math.abs(sp-pc), 12-Math.abs(sp-pc)); if (d < bestDist) { bestDist = d; bestPc = sp; } }
      return midi + ((bestPc - pc + 6) % 12) - 6;
    }
    const eighthSec = (60 / effectiveBpm) / 2;
    const highConf = (analysis.pitchContour || []).filter(p => p.confidence >= 0.28);
    let melodyMotif, melodySource = 'arpeggio';
    if (highConf.length >= 4) {
      const seen = new Set();
      const candidates = highConf.filter(p => p.time < secPerBar).map(p => {
        const slot = Math.round(p.time / eighthSec);
        let m = p.midi; while (m < 60) m += 12; while (m > 83) m -= 12;
        return { slot, note: Tone.Frequency(snapMidi(m), 'midi').toNote() };
      }).filter(m => { if (seen.has(m.slot)) return false; seen.add(m.slot); return true; });
      if (candidates.length >= 3) { melodyMotif = candidates.map(m => ({ time: m.slot * eighthSec, note: m.note })); melodySource = 'pitchContour'; }
    }
    if (!melodyMotif) {
      const pitches = SI.map(v => Tone.Frequency(rootPc + v + 60, 'midi').toNote());
      // Melodic contours tuned to each mood's scale and character
      const pats = {
        happy:  [0,2,4,2,4,5,4,2],  // ascending brightness
        sad:    [0,1,2,1,0,2,1,0],  // drooping minor steps
        chill:  [0,2,4,3,4,2,4,2],  // lazy jazz swing
        spooky: [0,2,1,0,3,2,1,3],  // unsettling chromatic creep
        silly:  [0,3,1,4,2,4,0,3],  // jumpy, unpredictable leaps
        epic:   [0,4,6,2,4,6,4,2],  // sweeping dorian ascent
      };
      melodyMotif = (pats[mood] || pats.happy).map((idx, i) => ({ time: i * eighthSec, note: pitches[idx % pitches.length] }));
    }

    // Drum patterns
    const phraseEnergies = analysis.phrases.map(p => p.energy);
    const avgEnergy = phraseEnergies.reduce((a, v) => a + v, 0) / Math.max(1, phraseEnergies.length);
    const isHalfTime = effectiveBpm < 85 || mood === 'spooky' || mood === 'sad';
    const isDoubletime = effectiveBpm > 115 || mood === 'epic';
    const kickBeats = is4OnFloor   ? [0, 0.25, 0.5, 0.75]
                    : isHalfTime   ? [0]
                    : isDoubletime ? [0, 0.375, 0.5, 0.875]
                    :                [0, 0.5];
    const snareBeats = isHalfTime   ? [0.5]
                     : isDoubletime ? [0.25, 0.5, 0.75]
                     :                [0.25, 0.75];
    // Country: no hi-hat (acoustic/brushed feel); hip-hop: sparse; everything else: normal grid
    const hatDiv = isCountry ? 0 : isHipHop ? 2 : isDoubletime ? 8 : effectiveBpm > 95 ? 4 : 2;
    const kickSet = new Set(kickBeats.map(f => Math.round(f * 1000)));
    const hatBeats = Array.from({ length: hatDiv }, (_, i) => i / hatDiv).filter(f => !kickSet.has(Math.round(f * 1000)));

    for (let bar = 0; bar < bars; bar++) {
      const t = bar * secPerBar;
      const barE = phraseEnergies[Math.floor(t / 4)] ?? avgEnergy;
      const dynVel = Math.max(0.25, Math.min(1.0, barE / Math.max(avgEnergy * 1.2, 0.001)));
      const chord = prog[bar % prog.length].map((n) => Tone.Frequency(root).transpose(n).toNote());

      kickBeats.forEach(f => Tone.Transport.schedule((time) => drum.triggerAttackRelease('C1', isHipHop ? '4n' : '8n', time, 0.65 + dynVel * 0.3), t + secPerBar * f));
      snareBeats.forEach(f => Tone.Transport.schedule((time) => snare.triggerAttackRelease('8n', time, isCountry ? 0.12 + dynVel * 0.1 : 0.25 + dynVel * 0.2), t + secPerBar * f));
      hatBeats.forEach(f => Tone.Transport.schedule((time) => hat.triggerAttackRelease('16n', time, 0.08 + dynVel * 0.15), t + secPerBar * f));

      // Chords — genre-specific patterns
      if (isHipHop) {
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, '4n', time, 0.3), t);
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, '8n', time, 0.22), t + secPerBar * 0.375);
      } else if (isCountry) {
        // Boom-chick: chord strums on beats 2 and 4
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord.slice(0, 2), '8n', time, 0.32), t + secPerBar * 0.25);
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord.slice(0, 2), '8n', time, 0.32), t + secPerBar * 0.75);
      } else if (isRock) {
        // Punchy stabs on every beat
        [0, 0.25, 0.5, 0.75].forEach(f => Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, '16n', time, 0.38), t + secPerBar * f));
      } else if (mood === 'epic') {
        // Epic: sustained hits every half bar
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, `${secPerBar * 0.45}s`, time, 0.4), t);
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, `${secPerBar * 0.45}s`, time, 0.35), t + secPerBar * 0.5);
      } else {
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, `${secPerBar * 0.95}s`, time, 0.35), t);
      }

      // Bass — genre-specific patterns
      if (isRock) {
        // Driving 8th notes
        [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].forEach(f =>
          Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '16n', time, 0.5 + dynVel * 0.15), t + secPerBar * f));
      } else if (isCountry) {
        // Boom-chick bass: root on 1 and 3, 5th on 2 and 4
        Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '8n', time, 0.65), t);
        Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[2] || chord[0], '8n', time, 0.55), t + secPerBar * 0.5);
      } else if (isHipHop) {
        // Long root + syncopated hit
        Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], `${secPerBar * 0.35}s`, time, 0.6), t);
        Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '16n', time, 0.4), t + secPerBar * 0.375);
      } else {
        Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '8n', time + secPerBar * 0.01, 0.6), t);
        Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[2], '8n', time + secPerBar * 0.5, 0.45), t);
      }

      melodyMotif.forEach(m => Tone.Transport.schedule((time) => melody.triggerAttackRelease(m.note, '8n', time, 0.55), t + m.time));

      // Atmospheric pad — sustained chord tones every 2 bars
      if (usePad && pad && bar % 2 === 0) {
        const padNotes = chord.slice(0, 2).map(n => Tone.Frequency(n).transpose(12).toNote());
        Tone.Transport.schedule((time) => pad.triggerAttackRelease(padNotes, `${secPerBar * 1.9}s`, time, 0.25), t);
      }

      // Arp — ascending chord tones for energetic moods
      if (useArp && arp) {
        const arpBase = chord.map(n => Tone.Frequency(n).transpose(12).toNote());
        const arpExt = [...arpBase, ...arpBase.map(n => Tone.Frequency(n).transpose(12).toNote())];
        for (let i = 0; i < 8; i++) {
          Tone.Transport.schedule((time) => arp.triggerAttackRelease(arpExt[i % arpExt.length], '16n', time, 0.28 + dynVel * 0.12), t + i * eighthSec);
        }
      }

      // Open-hat shimmer — metallic breath on odd bars, beat 3.5
      if (useOpenHat && openHat && bar % 2 === 1) {
        Tone.Transport.schedule((time) => openHat.triggerAttackRelease('16n', time, 0.14), t + secPerBar * 0.75);
      }
    }
    Tone.Transport.swing = isHipHop ? 0.2 : (is4OnFloor || isRock) ? 0.02 : isCountry ? 0.06 : 0.08;
    Tone.Transport.schedule(() => Tone.Transport.stop(), totalSec);
    return { bars, totalSec, effectiveBpm, drumMode: isHalfTime ? 'half-time' : isDoubletime ? 'double-time' : 'standard', melodySource };
  }
}

class PlaybackEngine {
  constructor() {
    this.voice = new Audio();   // plain element for playVoice() only
    this._voiceUrl = null;
    this._tonePlayer = null;    // Tone.Player used for playTogether()
    this._pitchShift = null;
    this._rafId = null;
    this._rateCompensation = 0;
    this._tempoRatio = 1;
    this._pitchSchedule = null;
    this._playerStartAT = 0;   // AudioContext time when playTogether started
    this.chainMode = 'uninitialized';
  }
  _disposeChain() {
    if (this._tonePlayer) { try { this._tonePlayer.dispose(); } catch(e) {} this._tonePlayer = null; }
    if (this._pitchShift) { try { this._pitchShift.dispose(); } catch(e) {} this._pitchShift = null; }
    this.chainMode = 'uninitialized';
  }
  _ensureAudioChain() {
    if (this._tonePlayer) return;
    // Tone.Player → Tone.PitchShift → destination: all within Tone.js graph, no native bridge needed.
    this._pitchShift = new Tone.PitchShift(0).toDestination();
    this._tonePlayer = new Tone.Player({ url: this._voiceUrl, loop: false }).connect(this._pitchShift);
    this._tonePlayer.playbackRate = this._tempoRatio;
    this.chainMode = 'tonePlayer+pitchShift';
  }
  setVoiceUrl(url) {
    this.voice.src = url;
    this._voiceUrl = url;
    this._disposeChain();
  }
  setTuning(pitchSchedule, tempoRatio) {
    this._pitchSchedule = pitchSchedule;
    this._tempoRatio = tempoRatio;
    this._rateCompensation = -12 * Math.log2(tempoRatio);
    if (this._tonePlayer) this._tonePlayer.playbackRate = tempoRatio;
  }
  clearTuning() {
    this._pitchSchedule = null; this._tempoRatio = 1; this._rateCompensation = 0;
    if (this._tonePlayer) this._tonePlayer.playbackRate = 1;
    if (this._pitchShift) this._pitchShift.pitch = 0;
  }
  _startPitchTracking() {
    this._stopPitchTracking();
    if (!this._pitchShift) return;
    let i = 0, lastSched = null;
    const startAT = this._playerStartAT;
    const loop = () => {
      const sched = this._pitchSchedule;
      if (sched !== lastSched) { i = 0; lastSched = sched; }
      if (sched && sched.length) {
        // Convert wall-clock elapsed time to original-recording position via tempoRatio
        const t = (Tone.now() - startAT) * this._tempoRatio;
        while (i < sched.length - 1 && sched[i + 1].time <= t) i++;
        this._pitchShift.pitch = sched[i].shift + this._rateCompensation;
      } else {
        this._pitchShift.pitch = this._rateCompensation;
      }
      if (Tone.Transport.state === 'started') this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }
  _stopPitchTracking() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }
  async playVoice() {
    this.stop(); this.voice.currentTime = 0; await this.voice.play();
  }
  async playBacking() { await Tone.start(); this.stop(); Tone.Transport.position = 0; Tone.Transport.start(); }
  async playTogether() {
    this.stop();
    this._ensureAudioChain();
    await Tone.start();
    if (!this._tonePlayer.loaded) await this._tonePlayer.load(this._voiceUrl);
    Tone.Transport.position = 0;
    const startAt = Tone.now();
    this._playerStartAT = startAt;
    this._tonePlayer.start(startAt);
    Tone.Transport.start();
    this._startPitchTracking();
  }
  stop() {
    this._stopPitchTracking();
    this.voice.pause(); this.voice.currentTime = 0;
    if (this._tonePlayer) try { this._tonePlayer.stop(); } catch(e) {}
    if (this._pitchShift) this._pitchShift.pitch = 0;
    Tone.Transport.stop();
  }
}

const debugEl = document.getElementById('debug');

const recordBtn = document.getElementById('recordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const playVoiceBtn = document.getElementById('playVoiceBtn');
const clearBtn = document.getElementById('clearBtn');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const backToInputBtn = document.getElementById('backToInputBtn');
const generateBtn = document.getElementById('generateBtn');
const backToAnalysisBtn = document.getElementById('backToAnalysisBtn');
const playVoice2Btn = document.getElementById('playVoice2Btn');
const playBackingBtn = document.getElementById('playBackingBtn');
const playTogetherBtn = document.getElementById('playTogetherBtn');
const stopPlaybackBtn = document.getElementById('stopPlaybackBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const moodSelect = document.getElementById('moodSelect');
const styleSelect = document.getElementById('styleSelect');
const lengthSelect = document.getElementById('lengthSelect');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const stateEl = document.getElementById('state');
const debug = { micPermission: 'unknown', selectedMimeType: '-', blobSize: 0, audioUrl: '-', decode: '-', analysis: '-', backing: '-', playback: '-', context: '-', pitchChain: '-', scheduleLen: 0 };
const setDebug = () => debugEl.textContent = JSON.stringify(debug, null, 2);
setDebug();

const stateMachine = new AudioStateMachine((s) => { stateEl.textContent = s; });
const rec = new RecordingManager(debug);
const upload = new UploadManager();
const analyzer = new VocalAnalysisEngine();
const moodEngine = new MoodPresetEngine();
const styleEngine = new StylePresetEngine();
const generator = new BackingTrackGenerator();
const player = new PlaybackEngine();
let recordTimer = null, recordStart = 0, chunks = [], vocalBlob = null, vocalUrl = null, analysis = null, generatedResult = null;

function computePitchSchedule(pitchContour, key, scale) {
  const scaleIntervals = { major: [0,2,4,5,7,9,11], minor: [0,2,3,5,7,8,10] };
  const noteIndex = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
  const root = noteIndex[key] ?? 0;
  const scalePcs = (scaleIntervals[scale] ?? scaleIntervals.major).map(v => (v + root) % 12);
  const raw = (pitchContour || []).filter(p => p.confidence >= 0.2).map(p => {
    const pc = ((p.midi % 12) + 12) % 12;
    let bestPc = scalePcs[0], bestDist = 12;
    for (const sp of scalePcs) {
      const d = Math.min(Math.abs(sp - pc), 12 - Math.abs(sp - pc));
      if (d < bestDist) { bestDist = d; bestPc = sp; }
    }
    const delta = ((bestPc - pc + 6) % 12) - 6;
    return { time: p.time, shift: delta };
  });
  return raw.filter((e, i) => i === 0 || e.shift !== raw[i - 1].shift);
}

function scaleForMood(mood) {
  return ['sad', 'spooky', 'epic'].includes(mood) ? 'minor' : 'major';
}

function applyTuning() {
  if (!generatedResult || !analysis) return player.clearTuning();
  const autoTune = document.getElementById('autoTuneToggle').checked;
  const quantize  = document.getElementById('quantizeToggle').checked;
  if (!autoTune && !quantize) return player.clearTuning();

  const mood = moodEngine.resolve(moodSelect.value, analysis.mood);
  const targetScale = scaleForMood(mood);
  const schedule = autoTune ? computePitchSchedule(analysis.pitchContour, analysis.key, targetScale) : null;
  const vocalBpm = typeof analysis.bpm === 'number' ? analysis.bpm : generatedResult.effectiveBpm;
  const tempoRatio = quantize ? generatedResult.effectiveBpm / vocalBpm : 1;
  player.setTuning(schedule, tempoRatio);
  debug.scheduleLen = schedule ? schedule.length : 0; setDebug();
}

function showScreen(id) { document.querySelectorAll('.screen').forEach((s)=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function setStatus(t) { statusEl.textContent = t; }
function setVocal(blob) { vocalBlob = blob; if (vocalUrl) URL.revokeObjectURL(vocalUrl); vocalUrl = URL.createObjectURL(blob); player.setVoiceUrl(vocalUrl); debug.blobSize = blob.size; debug.audioUrl = vocalUrl; setDebug(); document.getElementById('playVoiceBtn').disabled = false; document.getElementById('analyzeBtn').disabled = false; }

recordBtn.onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setStatus('Microphone recording unavailable on this browser. Please upload audio.'); return; }
  try {
    const p = await navigator.permissions?.query?.({ name: 'microphone' });
    debug.micPermission = p?.state || 'prompt';
  } catch {}
  chunks = [];
  stateMachine.set('recording');
  await rec.start((c)=>chunks.push(c), ()=>{ const blob = new Blob(chunks, { type: rec.recorder.mimeType || 'audio/mp4' }); setVocal(blob); stateMachine.set('recorded'); setStatus('Recording stopped.'); });
  setStatus('Recording...');
  recordStart = Date.now();
  stopRecordBtn.disabled = false;
  recordBtn.disabled = true;
  recordTimer = setInterval(() => {
    const sec = Math.min(MAX_RECORD_SEC, (Date.now() - recordStart) / 1000);
    timerEl.textContent = sec.toFixed(1) + 's';
    if (sec >= MAX_RECORD_SEC) stopRecordBtn.click();
  }, 100);
  setDebug();
};
stopRecordBtn.onclick = () => { clearInterval(recordTimer); rec.stop(); stopRecordBtn.disabled = true; recordBtn.disabled = false; };
playVoiceBtn.onclick = async () => { stateMachine.set('playingVoice'); try { await player.playVoice(); debug.playback='voice'; } catch(e) { debug.playback='error: '+(e?.message||e); setStatus('Playback error: '+(e?.message||'unknown')); } setDebug(); };
uploadBtn.onclick = () => uploadInput.click();
uploadInput.onchange = async (e) => { const f = e.target.files[0]; if (!f) return; setVocal(await upload.getBlob(f)); stateMachine.set('uploaded'); setStatus('Vocal uploaded.'); };
function resetAll() {
  player.stop(); player.clearTuning();
  chunks = []; vocalBlob = null; vocalUrl = null; analysis = null; generatedResult = null;
  timerEl.textContent = '0.0s';
  document.getElementById('playVoiceBtn').disabled = true;
  document.getElementById('analyzeBtn').disabled = true;
  stateMachine.set('idle');
  setStatus('Cleared.');
  showScreen('screen-input');
}
clearBtn.onclick = resetAll;
document.getElementById('startOver2Btn').onclick = resetAll;
document.getElementById('startOver3Btn').onclick = resetAll;
document.getElementById('autoTuneToggle').onchange = applyTuning;
document.getElementById('quantizeToggle').onchange  = applyTuning;
const isPlaying = () => ['playingBacking', 'playingTogether'].includes(stateMachine.state);
const regenIfIdle = () => { if (generatedResult && !isPlaying()) regenerate(); };
moodSelect.onchange = () => { applyTuning(); regenIfIdle(); };
styleSelect.onchange = regenIfIdle;
document.getElementById('melodyInstrument').onchange = regenIfIdle;
document.getElementById('bassInstrument').onchange   = regenIfIdle;
document.getElementById('drumKit').onchange          = regenIfIdle;
document.getElementById('bpmInput').onchange         = regenIfIdle;

analyzeBtn.onclick = async () => {
  if (!vocalBlob) return;
  stateMachine.set('analyzing');
  setStatus('Analyzing...');
  debug.analysis = 'started'; setDebug();
  try {
    analysis = await analyzer.analyze(vocalBlob);
  } catch (err) {
    debug.analysis = 'error: ' + err.message; setDebug();
    stateMachine.set('recorded');
    setStatus('Analysis failed: ' + err.message);
    return;
  }
  debug.analysis = 'completed'; debug.decode = 'success'; setDebug();
  stateMachine.set('analyzed');
  try {
    const displayAnalysis = { ...analysis };
    delete displayAnalysis.pitchContour;
    delete displayAnalysis.notes;
    document.getElementById('analysisJson').textContent = JSON.stringify(displayAnalysis, null, 2);
    document.getElementById('analysisSummary').innerHTML = `
    <div class="pill">BPM: ${analysis.bpm}</div><div class="pill">Key: ${analysis.key}</div>
    <div class="pill">Scale: ${analysis.scale}</div><div class="pill">Pitch: ${analysis.pitchRange.lowest} - ${analysis.pitchRange.highest}</div>
    <div class="pill">Rhythm confidence: ${analysis.rhythm.confidence}</div><div class="pill">Phrases: ${analysis.phrases.length}</div>
    <div class="pill">Mood: ${analysis.mood}</div><div class="pill">Suggested style: ${analysis.styleSuggestion}</div>`;
    showScreen('screen-analysis');
  } catch (err) {
    debug.analysis = 'display error: ' + err.message; setDebug();
    setStatus('Display error: ' + err.message);
  }
};

backToInputBtn.onclick = () => showScreen('screen-input');
async function regenerate() {
  stateMachine.set('generating');
  const mood = moodEngine.resolve(moodSelect.value, analysis.mood);
  const style = styleEngine.resolve(styleSelect.value, analysis.styleSuggestion);
  const bpmVal = parseInt(document.getElementById('bpmInput').value);
  const bpmOverride = !isNaN(bpmVal) && bpmVal >= 40 && bpmVal <= 220 ? bpmVal : null;
  const instruments = {
    melody: document.getElementById('melodyInstrument').value,
    bass:   document.getElementById('bassInstrument').value,
    drums:  document.getElementById('drumKit').value,
  };
  try {
    const res = await generator.generate(analysis, { mood, style, length: lengthSelect.value, instruments, bpmOverride });
    generatedResult = res;
    document.getElementById('bpmInput').value = res.effectiveBpm;
    debug.backing = `generated (${res.bars} bars, ${res.totalSec.toFixed(1)}s, bpm:${res.effectiveBpm}, drums:${res.drumMode}, melody:${res.melodySource})`;
    debug.context = Tone.context.state;
    setDebug();
    stateMachine.set('generated');
    showScreen('screen-generated');
    applyTuning();
  } catch (err) {
    debug.backing = 'error: ' + err.message; setDebug();
    stateMachine.set('analyzed');
    setStatus('Generation failed: ' + err.message);
  }
}
generateBtn.onclick = regenerate;
regenerateBtn.onclick = regenerate;
backToAnalysisBtn.onclick = ()=>showScreen('screen-analysis');
playVoice2Btn.onclick = async () => { try { await player.playVoice(); debug.playback='voice'; } catch(e) { debug.playback='error: '+(e?.message||e); } setDebug(); };
playBackingBtn.onclick = ()=>{ stateMachine.set('playingBacking'); player.playBacking(); };
playTogetherBtn.onclick = ()=>{ stateMachine.set('playingTogether'); player.playTogether(); debug.pitchChain=player.chainMode; setDebug(); };
stopPlaybackBtn.onclick = ()=>{ stateMachine.set('stopped'); player.stop(); debug.playback='stopped'; setDebug(); };
