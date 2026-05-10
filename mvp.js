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

class VocalAnalysisEngine {
  async analyze(blob) {
    const arr = await blob.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(arr.slice(0));
    const data = buffer.getChannelData(0);
    const analyzed = analyzeSignal(data, buffer.sampleRate);
    await ctx.close();
    return { ...analyzed, styleSuggestion: analyzed.scale === 'minor' ? 'hip-hop' : 'pop' };
  }
}

class MoodPresetEngine { resolve(input, detected) { return input === 'Auto' ? (detected?.label || 'chill') : input.toLowerCase(); } }
class StylePresetEngine { resolve(input, detected) { return input === 'Auto' ? detected : input.toLowerCase(); } }

class BackingTrackGenerator {
  async generate(analysis, options) {
    await Tone.start();
    Tone.Transport.stop(); Tone.Transport.cancel();
    Tone.Transport.bpm.value = analysis.bpm;
    const secPerBar = (60 / analysis.bpm) * 4;
    let target = options.length === 'match' ? analysis.durationSec : Number(options.length);
    target = Math.max(target, analysis.durationSec);
    const bars = Math.ceil(target / secPerBar);
    const totalSec = bars * secPerBar;
    const drum = new Tone.MembraneSynth().connect(new Tone.Compressor(-20, 4));
    const hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.05, sustain: 0 } });
    const bass = new Tone.Synth({ oscillator: { type: 'triangle' } });
    const poly = new Tone.PolySynth(Tone.Synth);
    const lead = new Tone.Synth({ oscillator: { type: options.style.includes('electro') ? 'sawtooth' : 'square' } });
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.2 });
    const delay = new Tone.PingPongDelay('8n', 0.15);
    const limiter = new Tone.Limiter(-1).toDestination();
    const bus = new Tone.Gain(0.9).chain(reverb, delay, limiter);
    [hat, bass, poly, lead].forEach((i) => i.connect(bus));
    drum.connect(limiter);

    const rootMap = { C: 'C2', D: 'D2', E: 'E2', F: 'F2', G: 'G2', A: 'A2', B: 'B2' };
    const root = rootMap[analysis.key] || 'C2';
    const prog = analysis.scale === 'minor' ? [[0,3,7],[5,8,12],[7,10,14],[3,7,10]] : [[0,4,7],[5,9,12],[7,11,14],[0,5,9]];

    for (let bar = 0; bar < bars; bar++) {
      const t = bar * secPerBar;
      const density = options.mood === 'epic' ? 1 : 0.7;
      Tone.Transport.schedule((time) => drum.triggerAttackRelease('C1', '8n', time, 0.8), t);
      Tone.Transport.schedule((time) => drum.triggerAttackRelease('C1', '8n', time + secPerBar * 0.5, 0.7), t);
      [0.25,0.5,0.75].forEach((f) => Tone.Transport.schedule((time)=>hat.triggerAttackRelease('16n', time, 0.2*density), t+secPerBar*f));
      const chord = prog[bar % prog.length].map((n) => Tone.Frequency(root).transpose(n).toNote());
      Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, `${secPerBar}s`, time, 0.35), t);
      Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '8n', time + secPerBar*0.01, 0.6), t);
      if (bar % 2 === 1) Tone.Transport.schedule((time)=>lead.triggerAttackRelease(chord[1], '8n', time + secPerBar*0.75, 0.3), t);
    }
    Tone.Transport.swing = options.style.includes('hip-hop') ? 0.2 : options.style.includes('dance') ? 0.05 : 0.1;
    return { bars, totalSec };
  }
}

class PlaybackEngine {
  constructor() { this.voice = new Audio(); }
  setVoiceUrl(url) { this.voice.src = url; }
  async playVoice() { this.stop(); await this.voice.play(); }
  async playBacking() { this.stop(); Tone.Transport.position = 0; Tone.Transport.start(); }
  async playTogether() { this.stop(); this.voice.currentTime = 0; Tone.Transport.position = 0; Tone.Transport.start(); await this.voice.play(); }
  stop() { this.voice.pause(); this.voice.currentTime = 0; Tone.Transport.stop(); }
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
const evidenceToggle = document.getElementById('evidenceToggle');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const stateEl = document.getElementById('state');
const debug = { micPermission: 'unknown', selectedMimeType: '-', blobSize: 0, audioUrl: '-', decode: '-', analysis: '-', backing: '-', playback: '-', context: '-' };
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
let recordTimer = null, recordStart = 0, chunks = [], vocalBlob = null, vocalUrl = null, analysis = null;

function showScreen(id) { document.querySelectorAll('.screen').forEach((s)=>s.classList.remove('active')); document.getElementById(id).classList.add('active'); }
function setStatus(t) { statusEl.textContent = t; }
function setVocal(blob) { vocalBlob = blob; if (!vocalUrl) vocalUrl = URL.createObjectURL(blob); player.setVoiceUrl(vocalUrl); debug.blobSize = blob.size; debug.audioUrl = vocalUrl; setDebug(); document.getElementById('playVoiceBtn').disabled = false; document.getElementById('analyzeBtn').disabled = false; }

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
playVoiceBtn.onclick = async () => { stateMachine.set('playingVoice'); await player.playVoice(); debug.playback='voice'; setDebug(); };
uploadBtn.onclick = () => uploadInput.click();
uploadInput.onchange = async (e) => { const f = e.target.files[0]; if (!f) return; setVocal(await upload.getBlob(f)); stateMachine.set('uploaded'); setStatus('Vocal uploaded.'); };
clearBtn.onclick = () => { player.stop(); chunks=[]; vocalBlob=null; vocalUrl=null; analysis=null; timerEl.textContent='0.0s'; document.getElementById('playVoiceBtn').disabled=true; document.getElementById('analyzeBtn').disabled=true; stateMachine.set('idle'); setStatus('Cleared.'); };

analyzeBtn.onclick = async () => {
  if (!vocalBlob) return;
  stateMachine.set('analyzing');
  debug.analysis = 'started'; setDebug();
  analysis = await analyzer.analyze(vocalBlob);
  debug.analysis = 'completed'; debug.decode = 'success'; setDebug();
  stateMachine.set('analyzed');
  document.getElementById('analysisJson').textContent = JSON.stringify(analysis, null, 2);
  document.getElementById('analysisSummary').innerHTML = `
    <div class="pill">Analysis Source: ${analysis.analysisSource}${analysis.analysisSource==='mock'?' (MOCK ANALYSIS)':''}</div>
    <div class="pill">BPM: ${analysis.bpm}</div><div class="pill">Key: ${analysis.key}</div>
    <div class="pill">Scale: ${analysis.scale}</div><div class="pill">Pitch: ${analysis.pitchRange.lowest} - ${analysis.pitchRange.highest}</div>
    <div class="pill">Grid fit: ${analysis.rhythm.gridFit?.toFixed?.(2) ?? analysis.rhythm.gridFit}</div><div class="pill">Phrases: ${analysis.phrases.length}</div>
    <div class="pill">Mood: ${analysis.mood.label} (${analysis.mood.method})</div><div class="pill">Suggested style: ${analysis.styleSuggestion}</div>
    ${analysis.uncertain?`<div class="pill">Uncertain: ${analysis.uncertain}</div>`:''}`;
  const ev = document.getElementById('analysisEvidence');
  ev.innerHTML = `<h3>Evidence</h3>
  <p><b>BPM candidates:</b> ${analysis.bpmCandidates.map(c=>`${c.bpm} (${c.confidence})`).join(', ')}</p>
  <p><b>Selected BPM reason:</b> highest confidence candidate from inter-onset interval fit.</p>
  <p><b>Onsets:</b> ${analysis.onsets.slice(0,40).map(v=>v.toFixed(2)).join(', ')}</p>
  <p><b>Inter-onset intervals:</b> ${analysis.interOnsetIntervals.slice(0,40).map(v=>v.toFixed(2)).join(', ')}</p>
  <p><b>Key candidates:</b> ${analysis.keyCandidates.map(k=>`${k.key} ${k.scale} (${k.confidence})`).join(', ')}</p>
  <p><b>Scale fit:</b> ${analysis.scaleFit.fitCount}/${analysis.scaleFit.totalNotes} notes in selected scale.</p>
  <p><b>Rhythm inferred from:</b> ${analysis.rhythm.inferredFrom.join(' + ') || 'not enough signal'}</p>
  <p><b>Pitch contour points:</b> ${analysis.pitchContour.length}</p>
  <p><b>Detected notes:</b> ${analysis.notes.slice(0,24).map(n=>`${n.pitch}/m${n.midi}/${n.freq}Hz/c${n.confidence}`).join(', ')}</p>
  <p><b>Scale candidates:</b> ${analysis.scaleCandidates.map(s=>`${s.scale} (${s.confidence})`).join(', ')}</p>`;
  ev.style.display = evidenceToggle.checked ? 'block' : 'none';
  showScreen('screen-analysis');
};

backToInputBtn.onclick = () => showScreen('screen-input');
async function regenerate() {
  stateMachine.set('generating');
  const mood = moodEngine.resolve(moodSelect.value, analysis.mood);
  const style = styleEngine.resolve(styleSelect.value, analysis.styleSuggestion);
  const res = await generator.generate(analysis, { mood, style, length: lengthSelect.value });
  debug.backing = `generated (${res.bars} bars, ${res.totalSec.toFixed(1)}s)`;
  debug.context = Tone.context.state;
  setDebug();
  stateMachine.set('generated');
  showScreen('screen-generated');
}
generateBtn.onclick = regenerate;
regenerateBtn.onclick = regenerate;
backToAnalysisBtn.onclick = ()=>showScreen('screen-analysis');
playVoice2Btn.onclick = ()=>player.playVoice();
playBackingBtn.onclick = ()=>{ stateMachine.set('playingBacking'); player.playBacking(); };
playTogetherBtn.onclick = ()=>{ stateMachine.set('playingTogether'); player.playTogether(); };
stopPlaybackBtn.onclick = ()=>{ stateMachine.set('stopped'); player.stop(); debug.playback='stopped'; setDebug(); };

evidenceToggle.onchange = ()=>{ const ev=document.getElementById('analysisEvidence'); ev.style.display=evidenceToggle.checked?'block':'none'; };
