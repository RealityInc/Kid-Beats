import { extractPitch } from '../lib/audio/extractPitch.js';
import { pitchToNotes } from '../lib/audio/pitchToNotes.js';
import { detectTempo } from '../lib/audio/detectTempo.js';
import { detectKey } from '../lib/audio/detectKey.js';
import { analyzeVibe } from '../lib/audio/analyzeVibe.js';
import { createSongPlan } from '../lib/music/createSongPlan.js';
import { generateArrangement } from '../lib/music/generateArrangement.js';

function clampPCM(pcm = []) {
  return pcm.slice(0, 48000 * 12).map((x) => Math.max(-1, Math.min(1, Number(x) || 0)));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { audio, mimeType, pcm = [], sampleRate = 44100, mockMode = false, variation = 'base' } = req.body || {};
    const safePCM = clampPCM(pcm);
    if (!safePCM.length) return res.status(400).json({ error: 'No PCM provided' });

    const pitch = extractPitch(safePCM, sampleRate);
    const noteEvents = pitchToNotes(pitch.contour, pitch.hopSize, sampleRate);
    const tempoInfo = detectTempo(noteEvents);
    const keyInfo = detectKey(noteEvents);

    const vibe = await analyzeVibe({
      apiKey: process.env.OPENAI_API_KEY,
      audioBase64: audio,
      mimeType,
      mockMode: mockMode || !audio,
    });

    const safetyFlags = Array.isArray(vibe.safetyFlags) ? vibe.safetyFlags : [];
    const neutralMode = safetyFlags.some((f) => /unsafe|violence|sexual|hate/i.test(f));
    const cleanedVibe = neutralMode ? { ...vibe, transcript: null, theme: 'instrumental fun', suggestedStyles: ['kids instrumental'] } : vibe;

    const songPlan = createSongPlan({ noteEvents, keyInfo, tempoInfo, vibe: cleanedVibe });
    const arrangement = generateArrangement(songPlan, {
      energy: cleanedVibe.energy,
      useMoreMelody: variation === 'more_melody',
    });

    return res.status(200).json({
      analysis: {
        notes: noteEvents,
        key: keyInfo,
        tempo: tempoInfo,
        phraseLength: noteEvents.length ? Number((noteEvents.at(-1).startTime + noteEvents.at(-1).duration).toFixed(2)) : 0,
        energyLevel: cleanedVibe.energy,
        mood: cleanedVibe.mood,
        transcript: cleanedVibe.transcript,
        rhythmPattern: tempoInfo.rhythmPattern,
        confidence: {
          pitch: Number((noteEvents.reduce((a, n) => a + (n.confidence || 0), 0) / Math.max(1, noteEvents.length)).toFixed(2)),
          tempo: tempoInfo.confidence,
          key: keyInfo.confidence,
        },
      },
      songPlan,
      arrangement,
      uncertaintyMessage: noteEvents.length < 3 ? 'I had trouble hearing the notes, so I made a song inspired by the rhythm and vibe.' : null,
      usedMock: !!mockMode,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Analysis failed' });
  }
}
