function normalizePCM(pcm = []) {
  const clipped = pcm.slice(0, 48000 * 12).map((x) => Math.max(-1, Math.min(1, Number(x) || 0)));
  const peak = clipped.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  return clipped.map((x) => x / peak);
}

function extractPitch(signal, sampleRate) {
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.02));
  const hopSize = Math.max(64, Math.floor(sampleRate * 0.01));
  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.floor(sampleRate / 80);
  const contour = [];
  for (let i = 0; i + frameSize < signal.length; i += hopSize) {
    const frame = signal.slice(i, i + frameSize);
    let rms = 0;
    for (let j = 0; j < frame.length; j++) rms += frame[j] * frame[j];
    rms = Math.sqrt(rms / frame.length);
    if (rms < 0.008) { contour.push({ time: i / sampleRate, hz: 0, confidence: 0 }); continue; }
    let bestLag = -1, best = -Infinity, second = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0;
      for (let k = 0; k < frameSize - lag; k++) score += frame[k] * frame[k + lag];
      if (score > best) { second = best; best = score; bestLag = lag; } else if (score > second) second = score;
    }
    if (bestLag < 0) { contour.push({ time: i / sampleRate, hz: 0, confidence: 0 }); continue; }
    const hz = sampleRate / bestLag;
    const peakness = (best - Math.max(0, second)) / Math.max(1e-6, Math.abs(best));
    contour.push({ time: i / sampleRate, hz, confidence: Math.max(0, Math.min(1, peakness)) });
  }
  return { hopSize, contour };
}

function pitchToNotes(contour, hopSize, sampleRate) {
  const N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const hzToMidi = (hz) => Math.round(69 + 12 * Math.log2(hz / 440));
  const midiToNote = (midi) => `${N[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  const frameSec = hopSize / sampleRate;
  const out = []; let curr = null;
  for (let i = 0; i < contour.length; i++) {
    const f = contour[i];
    if (!f.hz || f.confidence < 0.2) { if (curr && curr.duration >= 0.08) out.push(curr); curr = null; continue; }
    const midi = hzToMidi(f.hz);
    if (!curr) { curr = { note: midiToNote(midi), midi, startTime: i * frameSec, duration: frameSec, confidence: f.confidence }; continue; }
    if (Math.abs(midi - curr.midi) <= 1) { curr.duration = i * frameSec - curr.startTime + frameSec; }
    else { if (curr.duration >= 0.08) out.push(curr); curr = { note: midiToNote(midi), midi, startTime: i * frameSec, duration: frameSec, confidence: f.confidence }; }
  }
  if (curr && curr.duration >= 0.08) out.push(curr);
  return out;
}

function detectKey(notes) {
  if (!notes.length) return { key: 'C', scale: 'major' };
  const hist = new Array(12).fill(0);
  notes.forEach((n) => { hist[(n.midi % 12 + 12) % 12] += Math.max(0.1, n.duration); });
  const keys = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const major=[0,2,4,5,7,9,11], minor=[0,2,3,5,7,8,10];
  let best = { score: -1, key: 'C', scale: 'major' };
  for (let r = 0; r < 12; r++) {
    const scoreMaj = hist.reduce((a,v,pc)=>a+((major.map(x=>(x+r)%12).includes(pc))?v:0),0);
    const scoreMin = hist.reduce((a,v,pc)=>a+((minor.map(x=>(x+r)%12).includes(pc))?v:0),0);
    if (scoreMaj > best.score) best = { score: scoreMaj, key: keys[r], scale: 'major' };
    if (scoreMin > best.score) best = { score: scoreMin, key: keys[r], scale: 'minor' };
  }
  return { key: best.key, scale: best.scale };
}

function detectTempo(signal, sampleRate) {
  const hop = 512, frame=1024, flux=[0], env=[];
  for(let i=0;i+frame<signal.length;i+=hop){let e=0;for(let j=0;j<frame;j++){const s=signal[i+j];e+=s*s;}env.push(Math.sqrt(e/frame));}
  for(let i=1;i<env.length;i++) flux.push(Math.max(0, env[i]-env[i-1]));
  const srFlux=sampleRate/hop; let bestLag=Math.floor(srFlux*60/120), best=-1;
  const minLag=Math.floor(srFlux*60/200), maxLag=Math.floor(srFlux*60/70);
  for(let lag=minLag;lag<=maxLag;lag++){let c=0;for(let i=lag;i<flux.length;i++) c+=flux[i]*flux[i-lag]; if(c>best){best=c;bestLag=lag;}}
  const bpm=Math.max(70,Math.min(180,Math.round(60*srFlux/bestLag)));
  const beatTimes=[]; for(let i=0;i<flux.length;i+=bestLag) beatTimes.push(i/srFlux);
  return { bpm, beatTimes, rhythmPattern: beatTimes.slice(1).map((t,i)=>Number((t-beatTimes[i]).toFixed(2))).slice(0,16)};
}

async function analyzeVibe(apiKey, audioBase64, mimeType, mockMode) {
  if (mockMode || !apiKey || !audioBase64) return { transcript:null,mood:'happy',energy:'medium',theme:'playful adventure',suggestedStyles:['kids pop'],safetyFlags:[] };
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({model:'gpt-4o-audio-preview',modalities:['text'],messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:audioBase64,format:mimeType==='audio/mp4'?'mp4':'wav'}},{type:'text',text:'Return strict JSON with transcript,mood,energy,theme,suggestedStyles,safetyFlags'}]}]})});
    const data=await resp.json();const raw=data?.choices?.[0]?.message?.content||'';const txt=(raw.match&&raw.match(/\{[\s\S]*\}/)?.[0])||raw;const p=JSON.parse(txt);
    return { transcript:p.transcript||null,mood:p.mood||'happy',energy:p.energy||'medium',theme:p.theme||'playful adventure',suggestedStyles:Array.isArray(p.suggestedStyles)?p.suggestedStyles:['kids pop'],safetyFlags:Array.isArray(p.safetyFlags)?p.safetyFlags:[] };
  } catch { return { transcript:null,mood:'dreamy',energy:'medium',theme:'instrumental playtime',suggestedStyles:['gentle pop'],safetyFlags:['vibe_fallback'] }; }
}

function planAndArrange(notes, keyInfo, tempo, vibe, variation='base') {
  const title = `${vibe.theme || 'My'} ${keyInfo.key} Song`;
  const melodyRows=['C4','D4','E4','G4','A4','C5','D5','E5'];
  const melody=Array.from({length:8},()=>Array(16).fill(0));
  (notes.length?notes:[{note:'C4',startTime:0,duration:0.5}]).forEach((n)=>{const idx=melodyRows.findIndex((x)=>x.replace(/\d/g,'')===String(n.note).replace(/\d/g,''));if(idx>=0){const step=Math.max(0,Math.min(15,Math.round((n.startTime/Math.max(1,(notes.at(-1)?.startTime||2)))*15)));melody[idx][step]=1;if(variation==='more_melody'&&step<15)melody[idx][step+1]=1;}});
  const drums=Array.from({length:4},()=>Array(16).fill(0));for(let s=0;s<16;s++){if(s%4===0)drums[0][s]=1;if(s%8===4)drums[1][s]=1;drums[2][s]=variation==='calmer'?(s%2===0?1:0):1;}
  const bass=Array.from({length:5},()=>Array(16).fill(0));const chords=Array.from({length:4},()=>Array(16).fill(0));for(let b=0;b<4;b++){const st=b*4;chords[b][st]=1;bass[Math.min(4,b)][st]=1;bass[Math.min(4,b)][st+2]=1;}
  const bpm = Math.round((tempo.bpm||100) * (variation==='faster'?1.15:1));
  return { songPlan:{title,key:keyInfo.key,scale:keyInfo.scale,bpm,melody:notes,chords:keyInfo.scale==='minor'?[`${keyInfo.key}m`,'G','F',`${keyInfo.key}m`]:[keyInfo.key,'G','Am','F'],style:(vibe.suggestedStyles||['kids pop'])[0]}, arrangement:{name:title,bpm,style:(vibe.suggestedStyles||['kids pop'])[0],drums,melody,bass,chords,lyrics:[]} };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { audio, mimeType, pcm = [], sampleRate = 44100, mockMode = false, variation = 'base' } = req.body || {};
    const signal = normalizePCM(pcm);
    const pitch = signal.length ? extractPitch(signal, sampleRate) : { hopSize: 441, contour: [] };
    const notes = signal.length ? pitchToNotes(pitch.contour, pitch.hopSize, sampleRate) : [];
    const keyInfo = detectKey(notes);
    const tempo = signal.length ? detectTempo(signal, sampleRate) : { bpm: 100, beatTimes: [], rhythmPattern: [0.5,0.5,0.5,0.5] };
    const vibe = await analyzeVibe(process.env.OPENAI_API_KEY, audio, mimeType, mockMode);
    const safeVibe = (vibe.safetyFlags||[]).some((f)=>/unsafe|violence|sexual|hate/i.test(f)) ? { ...vibe, transcript:null, theme:'playful instrumental', suggestedStyles:['kids instrumental'] } : vibe;
    const { songPlan, arrangement } = planAndArrange(notes, keyInfo, tempo, safeVibe, variation);
    return res.status(200).json({ notes, key:keyInfo.key, scale:keyInfo.scale, bpm:tempo.bpm, beatTimes:tempo.beatTimes, rhythmPattern:tempo.rhythmPattern, vibe:safeVibe, songPlan, arrangement, uncertaintyMessage:notes.length<3?'I had trouble hearing the notes, so I made a song inspired by the rhythm and vibe.':null });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'analyze-audio failed' });
  }
}
