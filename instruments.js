import { SAMPLE_LIBRARY, ATTRIBUTION } from './vendor/samples/manifest.js';

// Sampled-instrument layer. Decoded audio buffers are cached once in the
// factory; per-generate instances (Tone.Sampler / DrumHit players) are built
// synchronously from the cache, so the generator's dispose-everything-on-
// regenerate pattern keeps working unchanged. Every creator returns null when
// its samples aren't available — callers fall back to the synth versions.

export { ATTRIBUTION };

// One-shot drum voice matching Tone.NoiseSynth's
// triggerAttackRelease(duration, time, velocity) signature.
class DrumHit {
  constructor(buffer, baseDb) {
    this._player = new Tone.Player(buffer);
    this._baseDb = baseDb ?? 0;
  }
  triggerAttackRelease(dur, time, vel = 1) {
    try {
      this._player.volume.setValueAtTime(this._baseDb + Tone.gainToDb(Math.max(0.05, Math.min(1, vel))), time ?? Tone.now());
      this._player.start(time);
    } catch {}
  }
  connect(node) { this._player.connect(node); return this; }
  dispose() { try { this._player.dispose(); } catch {} }
}

// Matches Tone.MembraneSynth's triggerAttackRelease(note, duration, time,
// velocity) signature used for the kick; the note argument is ignored.
class PitchedDrumHit extends DrumHit {
  triggerAttackRelease(note, dur, time, vel) { super.triggerAttackRelease(dur, time, vel); }
}

class InstrumentFactory {
  constructor() { this._cache = new Map(); } // name -> {loaded, failed, promise, buffers}

  isLoaded(name) { return !!this._cache.get(name)?.loaded; }

  status() {
    const out = { loaded: [], failed: [], pending: [] };
    for (const [name, e] of this._cache) {
      if (e.loaded) out.loaded.push(name);
      else if (e.failed) out.failed.push(name);
      else out.pending.push(name);
    }
    return out;
  }

  async preload(names, { onProgress, timeoutMs = 8000 } = {}) {
    const valid = [...new Set(names)].filter(n => SAMPLE_LIBRARY[n]);
    let done = 0;
    const total = valid.length;
    await Promise.all(valid.map(async (name) => {
      let entry = this._cache.get(name);
      if (!entry) {
        entry = { loaded: false, failed: false };
        this._cache.set(name, entry);
        const def = SAMPLE_LIBRARY[name];
        const files = def.urls ?? Object.fromEntries(Object.entries(def.oneShots).map(([k, v]) => [k, v.file]));
        entry.promise = (async () => {
          const buffers = {};
          await Promise.all(Object.entries(files).map(async ([key, file]) => {
            buffers[key] = await Tone.ToneAudioBuffer.fromUrl(def.base + file);
          }));
          entry.buffers = buffers;
          entry.loaded = true;
          entry.failed = false; // a late finish after timeout still counts
        })().catch(() => { entry.failed = true; });
      }
      try {
        await Promise.race([
          entry.promise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
        ]);
      } catch { if (!entry.loaded) entry.failed = true; }
      done++; onProgress?.(done, total);
    }));
  }

  // Pitched instrument → Tone.Sampler (supports both single-note and chord
  // triggerAttackRelease forms, auto pitch-shifts between mapped samples)
  createSampler(name) {
    const entry = this._cache.get(name);
    if (!entry?.loaded) return null;
    const def = SAMPLE_LIBRARY[name];
    return new Tone.Sampler({ urls: entry.buffers, release: def.release, volume: def.volumeDb });
  }

  createDrumHit(slot) {
    const entry = this._cache.get('drumkit');
    const spec = SAMPLE_LIBRARY.drumkit.oneShots[slot];
    if (!entry?.loaded || !entry.buffers[slot] || !spec) return null;
    return new DrumHit(entry.buffers[slot], spec.volumeDb);
  }

  createKick() {
    const entry = this._cache.get('drumkit');
    if (!entry?.loaded || !entry.buffers.kick) return null;
    return new PitchedDrumHit(entry.buffers.kick, SAMPLE_LIBRARY.drumkit.oneShots.kick.volumeDb);
  }
}

export const instrumentFactory = new InstrumentFactory();

// Which sampled instrument backs each UI selection key (absent = stays synth)
export const MELODY_SAMPLES = { piano: 'piano', pluck: 'guitar-acoustic', bell: 'xylophone', flute: 'flute' };
export const BASS_SAMPLES = { electric: 'bass-electric' };

// Chord instrument by genre; null = the synth pad fits the genre better
export function chordSampleFor(style, mood) {
  if (style === 'country') return 'guitar-acoustic';
  if (style === 'rock') return 'guitar-electric';
  if (style === 'dance' || style === 'weird electro') return null;
  if (mood === 'spooky' || mood === 'chill') return 'organ';
  return 'piano';
}

// Sample sets to preload for a resolved instrument selection
export function samplesForSelection({ melody, bass, drums }, style, mood) {
  const names = new Set();
  if (MELODY_SAMPLES[melody]) names.add(MELODY_SAMPLES[melody]);
  if (BASS_SAMPLES[bass]) names.add(BASS_SAMPLES[bass]);
  if (drums === 'acoustic') names.add('drumkit');
  const chordName = chordSampleFor(style, mood);
  if (chordName) names.add(chordName);
  return [...names];
}
