export default async function handler(req, res) {
if (req.method !== ‘POST’) return res.status(405).json({ error: ‘Method not allowed’ });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) return res.status(500).json({ error: ‘OPENAI_API_KEY not configured’ });

const { audio, mimeType } = req.body;
if (!audio) return res.status(400).json({ error: ‘No audio provided’ });

try {
const response = await fetch(‘https://api.openai.com/v1/chat/completions’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘Authorization’: `Bearer ${apiKey}`,
},
body: JSON.stringify({
model: ‘gpt-4o-audio-preview’,
modalities: [‘text’],
messages: [
{
role: ‘user’,
content: [
{
type: ‘input_audio’,
input_audio: {
data: audio,
format: mimeType === ‘audio/mp4’ ? ‘mp4’ : ‘wav’,
},
},
{
type: ‘text’,
text: `You are a music theory expert analyzing a child’s voice recording for a music app.
Listen carefully and return ONLY valid JSON with no markdown, no explanation:

{
“key”: “A minor”,
“scale”: “natural minor”,
“rootNote”: “A”,
“isMinor”: true,
“detectedBPM”: 95,
“energy”: “moderate”,
“mood”: “playful”,
“topNotes”: [“A”, “C”, “E”],
“melodySequence”: [“A4”, “C5”, “E5”, “C5”, “A4”, “G4”, “A4”, “E4”],
“melodyRhythm”: [1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1],
“confidence”: 0.85,
“description”: “Child humming a descending minor melody”
}

Rules:

- key: detected musical key e.g. “C major”, “A minor”
- scale: “major”, “natural minor”, “pentatonic major”, “pentatonic minor”
- rootNote: just the note letter e.g. “A”, “C”, “G”
- isMinor: true if minor key
- detectedBPM: estimated tempo 60-180, or 100 if unclear
- energy: “calm”, “moderate”, or “energetic”
- mood: one word describing the feel
- topNotes: up to 5 most prominent note names sung (just letter names, no octave)
- melodySequence: up to 16 notes with octave e.g. “C4”, “D4” — use only C4 D4 E4 G4 A4 C5 D5 E5
- melodyRhythm: relative duration of each note (1=quarter, 0.5=eighth, 2=half)
- confidence: 0-1 how confident you are in the analysis
- description: brief description of what was sung

If the recording is unclear, too short, or just noise, still return valid JSON with your best guess and confidence below 0.4.
Only use these melody notes: C4 D4 E4 G4 A4 C5 D5 E5`
}
]
}
],
max_tokens: 500,
}),
});

```
if (!response.ok) {
  const err = await response.json();
  console.error('OpenAI error:', err);
  return res.status(response.status).json({ error: err.error?.message || 'OpenAI request failed' });
}

const data = await response.json();
const text = data.choices?.[0]?.message?.content || '';

/* Parse JSON from response */
let analysis;
try {
  analysis = JSON.parse(text);
} catch (e) {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    analysis = JSON.parse(match[0]);
  } else {
    throw new Error('Could not parse analysis JSON');
  }
}

res.status(200).json(analysis);
```

} catch (error) {
console.error(‘Analysis error:’, error);
res.status(500).json({ error: error.message });
}
}