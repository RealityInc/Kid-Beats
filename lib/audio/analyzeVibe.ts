export type VibeResult = {
  transcript: string | null;
  mood: 'happy' | 'calm' | 'silly' | 'excited' | 'dreamy' | 'mysterious';
  energy: 'low' | 'medium' | 'high';
  theme: string;
  suggestedStyles: string[];
  safetyFlags: string[];
};

export async function analyzeVibe(input: { apiKey?: string; audioBase64?: string; mimeType?: string; mockMode?: boolean }): Promise<VibeResult> {
  const { apiKey, audioBase64, mimeType, mockMode } = input;
  if (mockMode || !apiKey || !audioBase64) {
    return { transcript: null, mood: 'happy', energy: 'medium', theme: 'playful adventure', suggestedStyles: ['kids pop'], safetyFlags: [] };
  }
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-audio-preview',
        modalities: ['text'],
        messages: [{ role: 'user', content: [
          { type: 'input_audio', input_audio: { data: audioBase64, format: mimeType === 'audio/mp4' ? 'mp4' : 'wav' } },
          { type: 'text', text: 'Return strict JSON: {"transcript":string|null,"mood":"happy|calm|silly|excited|dreamy|mysterious","energy":"low|medium|high","theme":string,"suggestedStyles":string[],"safetyFlags":string[]}. Keep child-safe.' }
        ] }],
      }),
    });
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const jsonText = typeof raw === 'string' ? (raw.match(/\{[\s\S]*\}/)?.[0] || raw) : JSON.stringify(raw || {});
    const parsed = JSON.parse(jsonText);
    return {
      transcript: parsed.transcript || null,
      mood: parsed.mood || 'happy',
      energy: parsed.energy || 'medium',
      theme: parsed.theme || 'instrumental fun',
      suggestedStyles: Array.isArray(parsed.suggestedStyles) ? parsed.suggestedStyles.slice(0, 4) : ['kids pop'],
      safetyFlags: Array.isArray(parsed.safetyFlags) ? parsed.safetyFlags : [],
    };
  } catch {
    return { transcript: null, mood: 'dreamy', energy: 'medium', theme: 'instrumental playtime', suggestedStyles: ['gentle pop'], safetyFlags: ['vibe_fallback'] };
  }
}
