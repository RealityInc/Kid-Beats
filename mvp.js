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

// Genre-specific chord progressions — override MOOD_PROGRESSIONS when style is set
const STYLE_PROGRESSIONS = {
  rock: {
    happy: [
      [[0,4,7],[7,11,14],[5,9,12],[7,11,14]],       // I-V-IV-V   (classic rock)
      [[0,4,7],[5,9,12],[7,11,14],[5,9,12]],         // I-IV-V-IV  (blues rock)
      [[0,4,7],[10,14,17],[8,12,15],[7,11,14]],      // I-bVII-bVI-V (grunge/hard)
      [[0,4,7],[5,9,12],[8,12,15],[10,14,17]],       // I-IV-bVI-bVII (anthemic)
    ],
    sad: [
      [[0,3,7],[8,12,15],[10,14,17],[7,11,14]],      // i-bVI-bVII-v (rock ballad)
      [[0,3,7],[10,14,17],[8,12,15],[5,8,12]],       // i-bVII-bVI-iv
      [[0,3,7],[5,8,12],[8,12,15],[7,10,14]],        // i-iv-bVI-v
    ],
  },
  country: {
    happy: [
      [[0,4,7],[5,9,12],[7,11,14],[0,4,7]],          // I-IV-V-I   (Nashville staple)
      [[0,4,7],[7,11,14],[0,4,7],[7,11,14]],          // I-V-I-V   (two-chord shuffle)
      [[0,4,7],[9,12,16],[5,9,12],[7,11,14]],         // I-vi-IV-V  (classic country)
      [[0,4,7],[5,9,12],[0,4,7],[5,9,12]],             // I-IV-I-IV  (vamp)
    ],
    sad: [
      [[0,3,7],[5,8,12],[7,10,14],[0,3,7]],           // i-iv-v-i
      [[0,4,7],[9,12,16],[5,9,12],[7,11,14]],          // I-vi-IV-V (wistful)
      [[0,4,7],[5,9,12],[9,12,16],[7,11,14]],          // I-IV-vi-V
    ],
  },
  'hip-hop': {
    happy: [
      [[0,3,7],[10,14,17]],                            // i-bVII (2-bar vamp)
      [[0,3,7],[5,8,12]],                              // i-iv
      [[0,3,7],[8,12,15],[10,14,17],[8,12,15]],        // i-bVI-bVII-bVI
      [[0,3,7,10],[8,12,15],[10,14,17],[5,8,12]],      // im7-bVI-bVII-iv (soulful)
    ],
    sad: [
      [[0,3,7],[10,14,17]],                            // i-bVII
      [[0,3,7],[8,12,15]],                             // i-bVI
      [[0,3,7],[8,12,15],[5,8,12],[10,14,17]],         // i-bVI-iv-bVII
    ],
  },
  dance: {
    happy: [
      [[0,3,7],[10,14,17],[8,12,15],[10,14,17]],      // i-bVII-bVI-bVII (rave classic)
      [[0,4,7],[5,9,12],[3,7,10],[7,11,14]],          // I-IV-iii-V (uplifting EDM)
      [[0,3,7],[5,8,12],[8,12,15],[10,14,17]],        // i-iv-bVI-bVII
      [[0,4,7],[9,12,16],[5,9,12],[7,11,14]],         // I-vi-IV-V (anthemic)
    ],
    sad: [
      [[0,3,7],[10,14,17],[8,12,15],[10,14,17]],      // i-bVII-bVI-bVII (dark rave)
      [[0,3,7],[8,12,15],[5,8,12],[10,14,17]],        // i-bVI-iv-bVII
    ],
  },
  'weird electro': {
    happy: [
      [[0,3,7],[6,10,13],[10,14,17],[1,5,8]],         // i-#iv°-bVII-bII (bizarre)
      [[0,4,7],[6,9,13],[10,14,17],[5,9,12]],         // I-#IV-bVII-IV
      [[0,3,7],[2,5,9],[10,14,17],[7,11,14]],         // i-II-bVII-V
    ],
    sad: [
      [[0,3,7],[6,10,13],[3,7,10],[10,14,17]],        // i-#iv°-III-bVII
      [[0,3,7],[1,5,8],[7,10,14],[10,14,17]],         // i-bII-v-bVII
    ],
  },
  pop: {
    happy: [
      [[0,4,7],[7,11,14],[9,12,16],[5,9,12]],         // I-V-vi-IV (the pop 4 chord)
      [[0,4,7],[5,9,12],[9,12,16],[7,11,14]],         // I-IV-vi-V
      [[0,4,7],[9,12,16],[5,9,12],[7,11,14]],         // I-vi-IV-V (50s)
    ],
    sad: [
      [[0,3,7],[8,12,15],[5,8,12],[10,14,17]],        // i-bVI-iv-bVII
      [[0,3,7],[8,12,15],[3,7,10],[10,14,17]],        // i-bVI-III-bVII
    ],
  },
};

const MOOD_SCALES = {
  happy: [0,2,4,5,7,9,11], sad: [0,2,3,5,7,8,10], chill: [0,2,4,5,7,9,11],
  spooky: [0,2,3,5,7,8,11], silly: [0,2,4,7,9], epic: [0,2,3,5,7,9,10],
};

function pickProgression(analysis, mood, style, seed) {
  const styleMap = STYLE_PROGRESSIONS[style];
  const pool = styleMap
    ? (styleMap[mood] ?? styleMap.happy ?? Object.values(styleMap)[0])
    : (MOOD_PROGRESSIONS[mood] ?? MOOD_PROGRESSIONS.happy);
  const NI = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
  const ki = NI[analysis.key] ?? 0;
  const bpmInt = typeof analysis.bpm === 'number' ? Math.round(analysis.bpm) : 90;
  const ph = (analysis.phrases || []).length;
  const cl = (analysis.pitchContour || []).length;
  const h = Math.abs(ki * 31 + bpmInt * 17 + ph * 53 + cl * 11 + (seed ?? 0) * 7) % pool.length;
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
    const humanize = Math.max(0, Math.min(1, options.humanize || 0));
    const isRock = style === 'rock';
    const isCountry = style === 'country';
    const is4OnFloor = style === 'dance';
    const isHipHop = style === 'hip-hop';
    const isElectro = style === 'weird electro';
    // Style-specific BPM ranges override mood ranges for authentic genre tempo
    const moodBpmRange = { spooky:[50,95], sad:[50,90], chill:[55,100], silly:[75,130], happy:[85,135], epic:[110,165] };
    const styleBpmRange = { rock:[100,150], country:[80,110], 'hip-hop':[70,100], dance:[118,135], 'weird electro':[110,145], pop:[88,125] };
    const [bpmMin, bpmMax] = styleBpmRange[style] ?? moodBpmRange[mood] ?? [80, 120];
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
    const reverbDecay = mood === 'spooky' ? 5.0 : mood === 'chill' ? 3.5 : mood === 'sad' ? 3.0 : 2.2;
    const reverbWet = mood === 'spooky' ? 0.5 : mood === 'chill' ? 0.4 : mood === 'sad' ? 0.35 : 0.28;
    const reverb = new Tone.Reverb({ decay: reverbDecay, wet: reverbWet });
    const delay = new Tone.PingPongDelay('8n', (mood === 'spooky' || mood === 'sad') ? 0.22 : 0.12);
    const limiter = new Tone.Limiter(-1).toDestination();
    const bus = new Tone.Gain(0.85).chain(reverb, delay, limiter);

    // Per-instrument channel gains — toggled to mute individual tracks
    const melCh    = new Tone.Gain(1);
    const bassCh   = new Tone.Gain(1);
    const chordsCh = new Tone.Gain(1);
    const kickCh   = new Tone.Gain(1);
    const percCh   = new Tone.Gain(1);   // shared by snare + hat
    const padCh    = usePad ? new Tone.Gain(1) : null;
    const arpCh    = useArp ? new Tone.Gain(1) : null;

    // Melody vibrato — gentle pitch wobble for spooky/sad expressiveness
    const vibrato = (mood === 'spooky' || mood === 'sad') ? new Tone.Vibrato({ frequency: 4.5, depth: 0.15 }) : null;
    // Use explicit connect() throughout — chain() on shared nodes (percCh) would
    // register percCh→bus twice in Tone.js's internal graph, causing silent failure.
    melody.connect(melCh);
    if (vibrato) { melCh.connect(vibrato); vibrato.connect(bus); } else { melCh.connect(bus); }

    // Distortion — grit for rock (shared across poly + bass into bus)
    const dist = isRock ? new Tone.Distortion(0.35) : null;
    poly.connect(chordsCh); bass.connect(bassCh);
    if (dist) { chordsCh.connect(dist); bassCh.connect(dist); dist.connect(bus); }
    else      { chordsCh.connect(bus);  bassCh.connect(bus); }

    // Snare + hat share percCh — connect each source separately, bus once
    hat.connect(percCh); snare.connect(percCh); percCh.connect(bus);
    drum.connect(kickCh); kickCh.connect(limiter);

    // Pad routes through an extra lush reverb for depth
    const padReverb = usePad ? new Tone.Reverb({ decay: 6.0, wet: 0.55 }) : null;
    const padGain = usePad ? new Tone.Gain(0.28).chain(padReverb, limiter) : null;
    if (pad && padGain) { padCh ? pad.chain(padCh, padGain) : pad.connect(padGain); }
    if (arp) { arpCh ? arp.chain(arpCh, bus) : arp.connect(bus); }
    if (openHat) openHat.connect(bus);

    this._nodes = [drum, snare, hat, bass, poly, melody, reverb, delay, limiter, bus,
                   melCh, bassCh, chordsCh, kickCh, percCh];
    if (vibrato) this._nodes.push(vibrato);
    if (dist) this._nodes.push(dist);
    if (padCh) this._nodes.push(padCh);
    if (arpCh) this._nodes.push(arpCh);
    if (pad) this._nodes.push(pad);
    if (padReverb) this._nodes.push(padReverb);
    if (padGain) this._nodes.push(padGain);
    if (arp) this._nodes.push(arp);
    if (openHat) this._nodes.push(openHat);

    // Note event capture — powers the track view piano roll and note editing
    const tracks = { melody: [], bass: [], chords: [], kick: [], snare: [], hat: [], pad: [], arp: [] };
    const sched = (trackId, meta, cb, time) => {
      const evId = Tone.Transport.schedule(cb, time);
      if (trackId) tracks[trackId].push({ evId, time: typeof time === 'number' ? time : 0, ...meta });
      return evId;
    };

    const rootMap = { C:'C2','C#':'C#2',D:'D2','D#':'D#2',E:'E2',F:'F2','F#':'F#2',G:'G2','G#':'G#2',A:'A2','A#':'A#2',B:'B2' };
    const root = rootMap[analysis.key] || 'C2';

    // Pick a chord progression from the pool using a hash of the analysis
    // so each unique recording gets a distinct progression.
    const arrangeSeed = Math.floor(Math.random() * 10000);
    const prog = pickProgression(analysis, mood, style, arrangeSeed);
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
      // Style-specific patterns take priority — genre feel over mood feel
      const stylePats = {
        rock:          [0,4,2,4,0,2,4,2],  // pentatonic punch
        country:       [0,1,2,3,2,1,2,0],  // stepwise vocal walk
        'hip-hop':     [0,0,3,3,0,5,3,0],  // rhythmic bounce
        dance:         [0,4,4,0,2,4,2,0],  // arpeggiated drive
        'weird electro':[0,3,6,1,4,2,5,3], // chromatic weirdness
        pop:           [0,2,4,2,4,5,4,2],  // ascending brightness
      };
      const moodPats = {
        happy:  [0,2,4,2,4,5,4,2],  // ascending brightness
        sad:    [0,1,2,1,0,2,1,0],  // drooping minor steps
        chill:  [0,2,4,3,4,2,4,2],  // lazy jazz swing
        spooky: [0,2,1,0,3,2,1,3],  // unsettling chromatic creep
        silly:  [0,3,1,4,2,4,0,3],  // jumpy, unpredictable leaps
        epic:   [0,4,6,2,4,6,4,2],  // sweeping dorian ascent
      };
      melodyMotif = (stylePats[style] || moodPats[mood] || moodPats.happy).map((idx, i) => ({ time: i * eighthSec, note: pitches[idx % pitches.length] }));
    }

    // B-phrase: 4-note answer to the A-phrase, pitched up ~3 semitones within the scale,
    // placed in the second half of the bar (beat 3 onward) for call-and-response feel
    const bMotif = melodyMotif.slice(4).map((m, i) => {
      let midi = 60; try { midi = Tone.Frequency(m.note).toMidi(); } catch {}
      return { time: secPerBar * 0.5 + i * eighthSec, note: Tone.Frequency(snapMidi(midi + 3), 'midi').toNote() };
    });

    // Song structure helpers
    const intro = 2;                          // bars of sparse intro
    const outro = Math.max(0, bars - 2);      // bar index where outro starts
    const getSection = (bar) => {
      if (bar < intro) return 'intro';
      if (bar >= outro) return 'outro';
      const rel = bar - intro;
      const span = Math.max(1, outro - intro);
      if (rel / span < 0.45) return 'verse';
      return 'chorus';
    };

    // Humanization helpers — add subtle timing/velocity variation at non-zero humanize
    const hTime = humanize > 0
      ? (t) => t + (Math.random() - 0.5) * humanize * 0.025  // ±12.5ms at 100%
      : (t) => t;
    const hVel = humanize > 0
      ? (v) => Math.max(0.05, Math.min(1, v + (Math.random() - 0.5) * humanize * 0.25))
      : (v) => v;

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
      const section = getSection(bar);
      const isIntro = section === 'intro';
      const isOutro = section === 'outro';
      const isVerse = section === 'verse';
      const isChorus = section === 'chorus';
      const secVelMult = isIntro ? 0.55 : isOutro ? 0.65 : 1.0;
      const dynVel = Math.max(0.25, Math.min(1.0, barE / Math.max(avgEnergy * 1.2, 0.001))) * secVelMult;
      // Chords voiced one octave above the bass root to separate frequency ranges
      const chordRoot = Tone.Frequency(root).transpose(12).toNote();
      const chord = prog[bar % prog.length].map((n) => Tone.Frequency(chordRoot).transpose(n).toNote());

      // Drum fill: snare roll on last beat of every 4th bar (except intro)
      const isFillBar = !isIntro && bar > 0 && bar % 4 === 3;

      kickBeats.forEach(f => {
        const st = hTime(t + secPerBar * f), kdur = isHipHop ? '4n' : '8n', kv = hVel(0.65 + dynVel * 0.3);
        sched('kick', { note:'C1', duration:kdur, velocity:kv }, (time) => drum.triggerAttackRelease('C1', kdur, time, kv), st);
      });
      snareBeats.forEach(f => {
        if (isFillBar && f >= 0.75) return; // last beat replaced by fill below
        const st = hTime(t + secPerBar * f), sv = hVel(isCountry ? 0.12 + dynVel * 0.1 : 0.25 + dynVel * 0.2);
        sched('snare', { duration:'8n', velocity:sv }, (time) => snare.triggerAttackRelease('8n', time, sv), st);
      });
      if (isFillBar) {
        // 4-hit snare roll on the last beat of the bar
        [0, 0.0625, 0.125, 0.1875].forEach(off => {
          const ft = hTime(t + secPerBar * (0.75 + off)), fv = hVel(0.3 + dynVel * 0.25);
          sched('snare', { duration:'16n', velocity:fv }, (time) => snare.triggerAttackRelease('16n', time, fv), ft);
        });
      }
      hatBeats.forEach(f => {
        const st = hTime(t + secPerBar * f), hv = hVel(0.08 + dynVel * 0.15);
        sched('hat', { duration:'16n', velocity:hv }, (time) => hat.triggerAttackRelease('16n', time, hv), st);
      });

      // Chords — skip in intro; genre-specific patterns otherwise
      if (!isIntro) {
        if (isHipHop) {
          const cv1 = hVel(0.3), cv2 = hVel(0.22);
          sched('chords', { notes:chord, duration:'4n', velocity:cv1 }, (time) => poly.triggerAttackRelease(chord, '4n', time, cv1), hTime(t));
          sched('chords', { notes:chord, duration:'8n', velocity:cv2 }, (time) => poly.triggerAttackRelease(chord, '8n', time, cv2), hTime(t + secPerBar * 0.375));
        } else if (isCountry) {
          const strm = chord.slice(0, 2), cs = hVel(0.32);
          sched('chords', { notes:strm, duration:'8n', velocity:cs }, (time) => poly.triggerAttackRelease(strm, '8n', time, cs), hTime(t + secPerBar * 0.25));
          sched('chords', { notes:strm, duration:'8n', velocity:cs }, (time) => poly.triggerAttackRelease(strm, '8n', time, cs), hTime(t + secPerBar * 0.75));
        } else if (isRock) {
          [0, 0.25, 0.5, 0.75].forEach(f => {
            const rv = hVel(0.38);
            sched('chords', { notes:chord, duration:'16n', velocity:rv }, (time) => poly.triggerAttackRelease(chord, '16n', time, rv), hTime(t + secPerBar * f));
          });
        } else if (mood === 'epic') {
          const edur = `${(secPerBar * 0.45).toFixed(3)}s`, ev1 = hVel(0.4), ev2 = hVel(0.35);
          sched('chords', { notes:chord, duration:edur, velocity:ev1 }, (time) => poly.triggerAttackRelease(chord, edur, time, ev1), hTime(t));
          sched('chords', { notes:chord, duration:edur, velocity:ev2 }, (time) => poly.triggerAttackRelease(chord, edur, time, ev2), hTime(t + secPerBar * 0.5));
        } else {
          const cdur = `${(secPerBar * 0.95).toFixed(3)}s`, cdv = hVel(0.35);
          sched('chords', { notes:chord, duration:cdur, velocity:cdv }, (time) => poly.triggerAttackRelease(chord, cdur, time, cdv), hTime(t));
        }
      }

      // Bass plays every section (it's the foundation)
      // Use the chord's actual root (first note), one octave down for proper bass register
      const bassNote = Tone.Frequency(chord[0]).transpose(-12).toNote();
      const bassNote2 = chord[2] ? Tone.Frequency(chord[2]).transpose(-12).toNote() : bassNote;
      if (isRock) {
        [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].forEach(f => {
          const bv = hVel(0.5 + dynVel * 0.15);
          sched('bass', { note:bassNote, duration:'16n', velocity:bv }, (time) => bass.triggerAttackRelease(bassNote, '16n', time, bv), hTime(t + secPerBar * f));
        });
      } else if (isCountry) {
        const bv1 = hVel(0.65), bv2 = hVel(0.55);
        sched('bass', { note:bassNote, duration:'8n', velocity:bv1 }, (time) => bass.triggerAttackRelease(bassNote, '8n', time, bv1), hTime(t));
        sched('bass', { note:bassNote2, duration:'8n', velocity:bv2 }, (time) => bass.triggerAttackRelease(bassNote2, '8n', time, bv2), hTime(t + secPerBar * 0.5));
      } else if (isHipHop) {
        const bldur = `${(secPerBar * 0.35).toFixed(3)}s`, bv1 = hVel(0.6), bv2 = hVel(0.4);
        sched('bass', { note:bassNote, duration:bldur, velocity:bv1 }, (time) => bass.triggerAttackRelease(bassNote, bldur, time, bv1), hTime(t));
        sched('bass', { note:bassNote, duration:'16n', velocity:bv2 }, (time) => bass.triggerAttackRelease(bassNote, '16n', time, bv2), hTime(t + secPerBar * 0.375));
      } else {
        const bv1 = hVel(0.6), bv2 = hVel(0.45);
        sched('bass', { note:bassNote, duration:'8n', velocity:bv1 }, (time) => bass.triggerAttackRelease(bassNote, '8n', time, bv1), hTime(t + secPerBar * 0.01));
        sched('bass', { note:bassNote2, duration:'8n', velocity:bv2 }, (time) => bass.triggerAttackRelease(bassNote2, '8n', time, bv2), hTime(t + secPerBar * 0.5));
      }

      // Melody — A/B call-and-response; absent in intro and outro
      if (!isIntro && !isOutro) {
        const useAPhrase = bar % 4 < 2;     // bars 0,1 of each 4-bar group: full A motif
        const useBPhrase = bar % 4 >= 2;    // bars 2,3: B answer phrase
        if (useAPhrase) {
          melodyMotif.forEach(m => {
            const mv = hVel(0.55);
            sched('melody', { note:m.note, duration:'8n', velocity:mv }, (time) => melody.triggerAttackRelease(m.note, '8n', time, mv), hTime(t + m.time));
          });
        }
        if (useBPhrase && bMotif.length) {
          bMotif.forEach(m => {
            const mv = hVel(0.48);
            sched('melody', { note:m.note, duration:'8n', velocity:mv }, (time) => melody.triggerAttackRelease(m.note, '8n', time, mv), hTime(t + m.time));
          });
        }
      }

      if (usePad && pad && bar % 2 === 0 && !isIntro) {
        const padNotes = chord.slice(0, 2).map(n => Tone.Frequency(n).transpose(12).toNote());
        const pdur = `${(secPerBar * 1.9).toFixed(3)}s`, pv = hVel(0.25);
        sched('pad', { notes:padNotes, duration:pdur, velocity:pv }, (time) => pad.triggerAttackRelease(padNotes, pdur, time, pv), hTime(t));
      }

      if (useArp && arp && !isIntro) {
        const arpBase = chord.map(n => Tone.Frequency(n).transpose(12).toNote());
        const arpExt = [...arpBase, ...arpBase.map(n => Tone.Frequency(n).transpose(12).toNote())];
        for (let i = 0; i < 8; i++) {
          const av = hVel(0.28 + dynVel * 0.12), an = arpExt[i % arpExt.length];
          sched('arp', { note:an, duration:'16n', velocity:av }, (time) => arp.triggerAttackRelease(an, '16n', time, av), hTime(t + i * eighthSec));
        }
      }

      if (useOpenHat && openHat && bar % 2 === 1) {
        Tone.Transport.schedule((time) => openHat.triggerAttackRelease('16n', time, 0.14), t + secPerBar * 0.75);
      }
    }
    Tone.Transport.swing = isHipHop ? 0.2 : (is4OnFloor || isRock) ? 0.02 : isCountry ? 0.06 : 0.08;
    Tone.Transport.schedule(() => Tone.Transport.stop(), totalSec);
    const channels = { melody:melCh, bass:bassCh, chords:chordsCh, kick:kickCh, perc:percCh,
                       ...(padCh ? {pad:padCh} : {}), ...(arpCh ? {arp:arpCh} : {}) };
    const synths = { melody, bass, poly };
    return { bars, totalSec, effectiveBpm, drumMode: isHalfTime ? 'half-time' : isDoubletime ? 'double-time' : 'standard', melodySource, tracks, channels, synths, scalePcs };
  }
}

// ── Track view helpers ──────────────────────────────────────────────────────

const TRACK_DEFS = [
  { id:'melody', label:'🎵 Melody',  color:'#4a9eff', pitched:true  },
  { id:'bass',   label:'🎸 Bass',    color:'#ff7c4a', pitched:true  },
  { id:'chords', label:'🎹 Chords',  color:'#a64aff', pitched:true  },
  { id:'kick',   label:'🥁 Kick',    color:'#ff4a7a', pitched:false },
  { id:'snare',  label:'🥁 Snare',   color:'#ffaa40', pitched:false },
  { id:'hat',    label:'🎩 Hi-Hat',  color:'#ffe040', pitched:false },
  { id:'pad',    label:'🌊 Pad',     color:'#40ffd0', pitched:true  },
  { id:'arp',    label:'✨ Arp',     color:'#ff40cc', pitched:true  },
];

function parseDurSec(dur, bpm) {
  if (!dur) return 0.1;
  if (typeof dur === 'string' && dur.endsWith('s')) return parseFloat(dur);
  const b = 60 / bpm;
  if (dur === '1n') return b * 4; if (dur === '2n') return b * 2;
  if (dur === '4n') return b;     if (dur === '8n') return b / 2;
  if (dur === '16n') return b / 4; return 0.1;
}

function drawTrackCanvas(cv, events, def, totalSec, bpm) {
  const W = cv.width, H = cv.height;
  if (!W || !H) return;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, W, H);
  const pps = W / totalSec, beatSec = 60 / bpm, barSec = beatSec * 4;
  // Bar + beat grid
  for (let t = 0; t <= totalSec + 0.01; t += beatSec) {
    ctx.strokeStyle = (t % barSec < 0.01) ? '#252d40' : '#181f30';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(t * pps, 0); ctx.lineTo(t * pps, H); ctx.stroke();
  }
  if (!def.pitched) {
    ctx.fillStyle = def.color;
    for (const ev of events) { const x = ev.time * pps; ctx.fillRect(x - 1.5, 2, 3, H - 4); }
    return;
  }
  const allMidis = events.flatMap(ev => (ev.notes ?? (ev.note ? [ev.note] : []))
    .map(n => { try { return Tone.Frequency(n).toMidi(); } catch { return NaN; } })).filter(m => !isNaN(m));
  if (!allMidis.length) return;
  const minM = Math.min(...allMidis) - 2, maxM = Math.max(...allMidis) + 2;
  const mRange = Math.max(1, maxM - minM), noteH = Math.max(3, (H - 6) / mRange);
  ctx.fillStyle = def.color;
  for (const ev of events) {
    const x = ev.time * pps, w = Math.max(3, parseDurSec(ev.duration, bpm) * pps - 1);
    const evNotes = (ev.notes ?? (ev.note ? [ev.note] : []))
      .map(n => { try { return Tone.Frequency(n).toMidi(); } catch { return NaN; } }).filter(m => !isNaN(m));
    for (const m of evNotes) {
      const y = H - 4 - ((m - minM) / mRange) * (H - 8);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y - noteH / 2, w, noteH, 1); else ctx.rect(x, y - noteH / 2, w, noteH);
      ctx.fill();
    }
  }
}

// ── TrackView ────────────────────────────────────────────────────────────────

class TrackView {
  constructor(el) {
    this._el = el; this._result = null; this._muted = {}; this._drag = null;
    // Global handlers for drag-to-pitch (attached once, check _drag guard)
    document.addEventListener('mousemove', (e) => this._onDragMove(e));
    document.addEventListener('mouseup',   (e) => this._onDragEnd(e));
    document.addEventListener('touchmove', (e) => { if (this._drag) { e.preventDefault(); this._onDragMove(e); } }, { passive: false });
    document.addEventListener('touchend',  (e) => this._onDragEnd(e));
  }

  setData(result) {
    this._result = result;
    this._drag = null;
    this._muted = {};
    if (result?.channels) Object.values(result.channels).forEach(ch => { if (ch) ch.gain.value = 1; });
    this._render();
  }

  _render() {
    this._el.innerHTML = '';
    if (!this._result?.tracks) return;
    const { tracks, totalSec, scalePcs, effectiveBpm } = this._result;
    for (const def of TRACK_DEFS) {
      if (!tracks[def.id]?.length) continue;
      this._el.appendChild(this._makeLane(def, tracks[def.id], totalSec, scalePcs, effectiveBpm));
    }
  }

  _makeLane(def, events, totalSec, scalePcs, bpm) {
    const lane = document.createElement('div');
    lane.className = 'track-lane';
    const hdr = document.createElement('div');
    hdr.className = 'track-hdr';
    const muteBtn = document.createElement('button');
    muteBtn.className = 'mute-btn';
    muteBtn.textContent = 'M';
    muteBtn.title = 'Mute';
    muteBtn.onclick = () => {
      const muted = !this._muted[def.id]; this._muted[def.id] = muted;
      muteBtn.classList.toggle('muted', muted);
      const chKey = (def.id === 'snare' || def.id === 'hat') ? 'perc' : def.id;
      const ch = this._result?.channels?.[chKey];
      if (ch) ch.gain.setValueAtTime(muted ? 0 : 1, Tone.now());
    };
    const lbl = document.createElement('span');
    lbl.className = 'track-label'; lbl.textContent = def.label;
    hdr.append(muteBtn, lbl);
    const cv = document.createElement('canvas');
    cv.className = 'track-canvas'; cv.height = def.pitched ? 52 : 24;
    cv.style.cursor = def.pitched ? 'ns-resize' : 'pointer';
    lane.append(hdr, cv);
    requestAnimationFrame(() => {
      cv.width = cv.offsetWidth || 560;
      drawTrackCanvas(cv, events, def, totalSec, bpm);
      cv.addEventListener('mousedown', (e) => {
        if (def.pitched) this._onPitchDragStart(e, cv, events, def, totalSec, scalePcs, bpm);
        else             this._onDrumClick(e, cv, events, def, totalSec, bpm);
      });
      cv.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (def.pitched) this._onPitchDragStart(e, cv, events, def, totalSec, scalePcs, bpm);
        else             this._onDrumClick(e, cv, events, def, totalSec, bpm);
      }, { passive: false });
    });
    return lane;
  }

  // ── Coordinate normalizer (mouse + touch) ────────────────────────────────

  _getCoords(e) {
    const t = e.touches?.[0] ?? e.changedTouches?.[0];
    return t ? { clientX: t.clientX, clientY: t.clientY } : { clientX: e.clientX, clientY: e.clientY };
  }

  // ── Pitched note drag ─────────────────────────────────────────────────────

  _onPitchDragStart(e, cv, events, def, totalSec, scalePcs, bpm) {
    e.preventDefault();
    const { clientX, clientY } = this._getCoords(e);
    const rect = cv.getBoundingClientRect();
    const clickT = ((clientX - rect.left) / rect.width) * totalSec;
    let best = null, bestD = Infinity;
    for (const ev of events) { const d = Math.abs(ev.time - clickT); if (d < bestD) { bestD = d; best = ev; } }
    if (!best || bestD > (60 / bpm) * 0.5) return;

    // Compute MIDI range from all events (same calc as drawTrackCanvas)
    const allMidis = events.flatMap(ev => (ev.notes ?? (ev.note ? [ev.note] : []))
      .map(n => { try { return Tone.Frequency(n).toMidi(); } catch { return NaN; } })).filter(m => !isNaN(m));
    const minM = Math.min(...allMidis) - 2, maxM = Math.max(...allMidis) + 2;
    const mRange = Math.max(1, maxM - minM);
    const origMidi = Tone.Frequency(best.note ?? (best.notes?.[0])).toMidi();

    this._drag = { ev: best, events, def, cv, totalSec, scalePcs, bpm,
                   origMidi, origY: clientY, mRange, canvasH: cv.height };
  }

  _onDragMove(e) {
    if (!this._drag) return;
    const { clientY } = this._getCoords(e);
    const { ev, events, def, cv, totalSec, scalePcs, bpm, origMidi, origY, mRange, canvasH } = this._drag;
    const pxPerSemitone = Math.max(1, (canvasH - 8) / mRange);
    const deltaY   = origY - clientY;            // up = positive = higher pitch
    const rawMidi  = origMidi + Math.round(deltaY / pxPerSemitone);
    const newNote  = this._snapToScale(rawMidi, scalePcs);
    if (newNote === (ev.note ?? ev.notes?.[0])) return;
    ev.note = newNote;
    if (ev.notes?.length) ev.notes[0] = newNote;
    cv.width = cv.offsetWidth || 560;
    drawTrackCanvas(cv, events, def, totalSec, bpm);
  }

  _onDragEnd(e) {
    if (!this._drag) return;
    const { ev, def, bpm } = this._drag;
    // Reschedule with the final note
    const synth = this._result?.synths?.[def.id];
    if (synth && ev.evId !== undefined) {
      Tone.Transport.clear(ev.evId);
      const newId = Tone.Transport.schedule(
        (time) => synth.triggerAttackRelease(ev.note, ev.duration || '8n', time, ev.velocity || 0.5),
        ev.time
      );
      ev.evId = newId;
    }
    this._drag = null;
  }

  _snapToScale(targetMidi, scalePcs) {
    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    let bestMidi = 60, bestDist = Infinity;
    for (let oct = 1; oct < 8; oct++) {
      for (const pc of (scalePcs || [])) {
        const m = pc + oct * 12;
        if (Math.abs(m - targetMidi) < bestDist) { bestDist = Math.abs(m - targetMidi); bestMidi = m; }
      }
    }
    return NOTE_NAMES[bestMidi % 12] + (Math.floor(bestMidi / 12) - 1);
  }

  // ── Drum toggle ───────────────────────────────────────────────────────────

  _onDrumClick(e, cv, events, def, totalSec, bpm) {
    const { clientX } = this._getCoords(e);
    const rect = cv.getBoundingClientRect();
    const clickT = ((clientX - rect.left) / rect.width) * totalSec;
    const thr = (60 / bpm) * 0.15;
    const idx = events.findIndex(ev => Math.abs(ev.time - clickT) < thr);
    if (idx >= 0) {
      if (events[idx].evId !== undefined) Tone.Transport.clear(events[idx].evId);
      events.splice(idx, 1);
      cv.width = cv.offsetWidth || 560;
      drawTrackCanvas(cv, events, def, totalSec, bpm);
    }
  }

  snapshot() {
    if (!this._result) return null;
    const { tracks, totalSec, effectiveBpm, scalePcs } = this._result;
    return {
      tracks: JSON.parse(JSON.stringify(tracks)),
      totalSec, effectiveBpm, scalePcs,
    };
  }
}

// ── MasterTimeline ────────────────────────────────────────────────────────────

class MasterTimeline {
  constructor(el) { this._el = el; this._loops = []; this._nextId = 1; this._dragId = null; }

  add(label, snap) {
    this._loops.push({ id: `loop-${this._nextId++}`, label, snap });
    this._render();
  }

  _render() {
    this._el.innerHTML = '';
    if (!this._loops.length) {
      this._el.innerHTML = '<div class="muted" style="padding:18px;text-align:center;">No loops saved yet — generate a backing track and click "+ Save to Timeline".</div>';
      return;
    }
    for (const loop of this._loops) this._el.appendChild(this._makeBlock(loop));
  }

  _makeBlock(loop) {
    const block = document.createElement('div');
    block.className = 'timeline-block'; block.draggable = true; block.dataset.id = loop.id;
    block.addEventListener('dragstart', (e) => { this._dragId = loop.id; block.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    block.addEventListener('dragend', () => { block.classList.remove('dragging'); this._dragId = null; });
    block.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    block.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!this._dragId || this._dragId === loop.id) return;
      const fi = this._loops.findIndex(l => l.id === this._dragId);
      const ti = this._loops.findIndex(l => l.id === loop.id);
      if (fi < 0 || ti < 0) return;
      const [m] = this._loops.splice(fi, 1); this._loops.splice(ti, 0, m);
      this._render();
    });

    const hdr = document.createElement('div'); hdr.className = 'block-hdr';
    const grip = document.createElement('span'); grip.textContent = '⠿'; grip.className = 'block-grip'; grip.title = 'Drag to reorder';
    const lbl = document.createElement('span'); lbl.textContent = loop.label; lbl.className = 'block-label';
    const meta = document.createElement('span'); meta.className = 'block-meta muted';
    meta.textContent = `${loop.snap.totalSec.toFixed(1)}s · ${Math.round(loop.snap.effectiveBpm)} BPM`;
    const expandBtn = document.createElement('button'); expandBtn.textContent = '▼ Tracks'; expandBtn.className = 'block-expand-btn';
    const delBtn = document.createElement('button'); delBtn.textContent = '✕'; delBtn.className = 'block-del-btn'; delBtn.title = 'Remove';
    delBtn.onclick = (e) => { e.stopPropagation(); this._loops = this._loops.filter(l => l.id !== loop.id); this._render(); };
    hdr.append(grip, lbl, meta, expandBtn, delBtn);
    block.appendChild(hdr);

    const tracksPanel = document.createElement('div'); tracksPanel.className = 'block-tracks'; tracksPanel.style.display = 'none';
    block.appendChild(tracksPanel);

    expandBtn.onclick = () => {
      const open = tracksPanel.style.display !== 'none';
      tracksPanel.style.display = open ? 'none' : 'block';
      expandBtn.textContent = open ? '▼ Tracks' : '▲ Tracks';
      if (!open && !tracksPanel.dataset.rendered) {
        this._renderSnapTracks(tracksPanel, loop.snap);
        tracksPanel.dataset.rendered = '1';
      }
    };
    return block;
  }

  _renderSnapTracks(container, snap) {
    for (const def of TRACK_DEFS) {
      const events = snap.tracks[def.id];
      if (!events?.length) continue;
      const lane = document.createElement('div'); lane.className = 'track-lane track-lane--mini';
      const hdr = document.createElement('div'); hdr.className = 'track-hdr';
      hdr.innerHTML = `<span class="track-label">${def.label}</span>`;
      const cv = document.createElement('canvas'); cv.className = 'track-canvas'; cv.height = def.pitched ? 36 : 18;
      lane.append(hdr, cv); container.appendChild(lane);
      requestAnimationFrame(() => {
        cv.width = cv.offsetWidth || 440;
        drawTrackCanvas(cv, events, def, snap.totalSec, snap.effectiveBpm);
      });
    }
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
const trackView = new TrackView(document.getElementById('track-lanes'));
const masterTimeline = new MasterTimeline(document.getElementById('timeline-list'));
let recordTimer = null, recordStart = 0, chunks = [], vocalBlob = null, vocalUrl = null, analysis = null, generatedResult = null;
let loopCounter = 1;

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
  const autoTuneAmount = parseInt(document.getElementById('autoTuneToggle').value) / 100;
  const quantizeAmount = parseInt(document.getElementById('quantizeToggle').value) / 100;
  if (autoTuneAmount === 0 && quantizeAmount === 0) return player.clearTuning();

  const mood = moodEngine.resolve(moodSelect.value, analysis.mood);
  const targetScale = scaleForMood(mood);
  // Scale pitch corrections by autoTuneAmount (0 = no correction, 1 = full)
  const rawSchedule = computePitchSchedule(analysis.pitchContour, analysis.key, targetScale);
  const schedule = autoTuneAmount > 0 ? rawSchedule.map(e => ({ ...e, shift: e.shift * autoTuneAmount })) : null;
  const vocalBpm = typeof analysis.bpm === 'number' ? analysis.bpm : generatedResult.effectiveBpm;
  // Lerp tempo ratio: 0% = ratio 1 (no change), 100% = full correction
  const fullRatio = generatedResult.effectiveBpm / vocalBpm;
  const tempoRatio = 1 + (fullRatio - 1) * quantizeAmount;
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
  document.getElementById('track-view-wrap').style.display = 'none';
  trackView.setData(null);
  stateMachine.set('idle');
  setStatus('Cleared.');
  showScreen('screen-input');
}
clearBtn.onclick = resetAll;
document.getElementById('startOver2Btn').onclick = resetAll;
document.getElementById('startOver3Btn').onclick = resetAll;
const _wireSlider = (id, valId, cb) => {
  const el = document.getElementById(id);
  el.addEventListener('input', () => { document.getElementById(valId).textContent = el.value + '%'; if (cb) cb(); });
};
_wireSlider('autoTuneToggle',  'autoTuneVal',  applyTuning);
_wireSlider('quantizeToggle',  'quantizeVal',  applyTuning);
_wireSlider('humanizeToggle',  'humanizeVal',  null);
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
    const humanize = parseInt(document.getElementById('humanizeToggle').value) / 100;
    const res = await generator.generate(analysis, { mood, style, length: lengthSelect.value, instruments, bpmOverride, humanize });
    generatedResult = res;
    document.getElementById('bpmInput').value = res.effectiveBpm;
    debug.backing = `generated (${res.bars} bars, ${res.totalSec.toFixed(1)}s, bpm:${res.effectiveBpm}, drums:${res.drumMode}, melody:${res.melodySource})`;
    debug.context = Tone.context.state;
    setDebug();
    stateMachine.set('generated');
    showScreen('screen-generated');
    applyTuning();
    trackView.setData(res);
    document.getElementById('track-view-wrap').style.display = 'block';
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
document.getElementById('addToTimelineBtn').onclick = () => {
  const snap = trackView.snapshot();
  if (!snap) return;
  const mood = moodSelect.value !== 'Auto' ? moodSelect.value : (analysis?.mood ?? 'loop');
  const style = styleSelect.value !== 'Auto' ? styleSelect.value : '';
  const label = `Loop ${loopCounter++} · ${mood}${style ? ' · ' + style : ''}`;
  masterTimeline.add(label, snap);
  document.getElementById('timeline-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
