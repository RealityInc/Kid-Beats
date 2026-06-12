// AI-render seam. The app composes with full knowledge of the song (key, BPM,
// meter, per-bar chords/styles, every note event) — this module serializes
// that into a self-contained renderSpec that a future server-side renderer
// (e.g. /api/render backed by MusicGen-melody or a commercial music API) can
// consume without any client refactor. Today the default backend is the live
// Tone.js engine itself.

export function buildRenderSpec(analysis, options, generated) {
  const events = {};
  for (const [trackId, list] of Object.entries(generated.tracks || {})) {
    events[trackId] = (list || []).map(({ evId, ...ev }) => ev); // strip Tone schedule ids
  }
  return {
    version: 1,
    analysis: {
      key: analysis.key, scale: analysis.scale, bpm: analysis.bpm,
      firstBeatSec: analysis.firstBeatSec ?? null,
      durationSec: analysis.durationSec,
      phraseCount: analysis.phrases?.length ?? 0,
    },
    bpm: generated.effectiveBpm,
    beatSec: generated.beatSec,
    meter: generated.meter,
    totalSec: generated.totalSec,
    style: options.style,
    mood: options.mood,
    timeSignature: options.timeSignature ?? 'auto',
    switchUp: options.switchUp ?? 'none',
    instruments: options.instruments ?? {},
    sampled: generated.sampled ?? {},
    plan: (generated.plan || []).map(p => ({
      bar: p.bar, t: p.t, style: p.style, meter: p.meter,
      beatsPerBar: p.beatsPerBar, secPerBar: p.secPerBar, switched: !!p.switched,
    })),
    events,
    fx: generated.fx ?? {},
  };
}

export class RenderBackend {
  // Returns { kind:'live' } (already audible via Tone) or { kind:'url', url }
  // (a rendered audio file to play/mix instead).
  async render(spec, { signal } = {}) { throw new Error('not implemented'); }
}

// Default: the in-browser Tone.js engine has already scheduled everything.
export class LocalToneBackend extends RenderBackend {
  async render() { return { kind: 'live' }; }
}

// Future server renderer — vercel.json already rewrites /api/*.
export class HttpRenderBackend extends RenderBackend {
  constructor(endpoint = '/api/render') { super(); this.endpoint = endpoint; }
  async render(spec, { signal } = {}) {
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
      signal,
    });
    if (!resp.ok) throw new Error(`render failed: ${resp.status}`);
    const { url } = await resp.json();
    return { kind: 'url', url };
  }
}

export function getRenderBackend() { return new LocalToneBackend(); }
