import { NextResponse } from 'next/server';
import { extractPitch } from '../../../lib/audio/extractPitch';
import { pitchToNotes } from '../../../lib/audio/pitchToNotes';
import { detectKey } from '../../../lib/audio/detectKey';
import { detectTempo } from '../../../lib/audio/detectTempo';
import { analyzeVibe } from '../../../lib/audio/analyzeVibe';
import { createSongPlan } from '../../../lib/music/createSongPlan';
import { generateArrangement } from '../../../lib/music/generateArrangement';

function normalizePCM(pcm: number[]) {
  const clipped = pcm.slice(0, 48000 * 12).map((x) => Math.max(-1, Math.min(1, Number(x) || 0)));
  const peak = clipped.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  return clipped.map((x) => x / peak);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { audio, mimeType, pcm = [], sampleRate = 44100, mockMode = false, variation = 'base' } = body || {};
    const signal = normalizePCM(pcm);
    if (!signal.length) return NextResponse.json({ error: 'No PCM provided' }, { status: 400 });

    const pitch = extractPitch(signal, sampleRate);
    const notes = pitchToNotes(pitch.contour, pitch.hopSize, sampleRate);
    const tempo = detectTempo(signal, sampleRate);
    const key = detectKey(notes);
    const vibe = await analyzeVibe({ apiKey: process.env.OPENAI_API_KEY, audioBase64: audio, mimeType, mockMode });

    const unsafe = vibe.safetyFlags.some((f) => /unsafe|violence|sexual|hate/i.test(f));
    const safeVibe = unsafe ? { ...vibe, transcript: null, theme: 'playful instrumental', suggestedStyles: ['kids instrumental'] } : vibe;

    const songPlan = createSongPlan({ noteEvents: notes, keyInfo: key, tempoInfo: tempo, vibe: safeVibe });
    const arrangement = generateArrangement(songPlan, { variation });

    return NextResponse.json({
      notes,
      key: key.key,
      scale: key.scale,
      bpm: tempo.bpm,
      beatTimes: tempo.beatTimes,
      rhythmPattern: tempo.rhythmPattern,
      vibe: safeVibe,
      songPlan,
      arrangement,
      uncertaintyMessage: notes.length < 3 ? 'I had trouble hearing the notes, so I made a song inspired by the rhythm and vibe.' : null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'analyze-audio failed' }, { status: 500 });
  }
}
