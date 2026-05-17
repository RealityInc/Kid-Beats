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
  const fast = bpm > 120;
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

class BackingTrackGenerator {
  constructor() { this._nodes = []; }
  _dispose() { this._nodes.forEach(n => { try { n.dispose(); } catch(e) {} }); this._nodes = []; }
  async generate(analysis, options) {
    await Tone.start();
    this._dispose();
    Tone.Transport.stop(); Tone.Transport.cancel();
    Tone.Transport.bpm.value = analysis.bpm;
    const secPerBar = (60 / analysis.bpm) * 4;
    let target = options.length === 'match' ? analysis.durationSec : Number(options.length);
    target = Math.max(target, analysis.durationSec);
    const bars = Math.ceil(target / secPerBar);
    const totalSec = bars * secPerBar;
    const drum = new Tone.MembraneSynth();
    const snare = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.13, sustain: 0 } });
    const hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.05, sustain: 0 } });
    const bass = new Tone.Synth({ oscillator: { type: 'triangle' } });
    const poly = new Tone.PolySynth(Tone.Synth);
    const lead = new Tone.Synth({ oscillator: { type: options.style.includes('electro') ? 'sawtooth' : 'triangle' } });
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0.2 });
    const delay = new Tone.PingPongDelay('8n', 0.15);
    const limiter = new Tone.Limiter(-1).toDestination();
    const bus = new Tone.Gain(0.9).chain(reverb, delay, limiter);
    [hat, snare, bass, poly, lead].forEach((i) => i.connect(bus));
    drum.connect(limiter);
    this._nodes = [drum, snare, hat, bass, poly, lead, reverb, delay, limiter, bus];

    const rootMap = { C:'C2','C#':'C#2',D:'D2','D#':'D#2',E:'E2',F:'F2','F#':'F#2',G:'G2','G#':'G#2',A:'A2','A#':'A#2',B:'B2' };
    const root = rootMap[analysis.key] || 'C2';
    const prog = analysis.scale === 'minor' ? [[0,3,7],[5,8,12],[7,10,14],[3,7,10]] : [[0,4,7],[5,9,12],[7,11,14],[0,5,9]];
    const upOctave = n => n.replace(/(\d+)$/, m => String(parseInt(m) + 1));

    for (let bar = 0; bar < bars; bar++) {
      const t = bar * secPerBar;
      const density = options.mood === 'epic' ? 1 : 0.7;
      const chord = prog[bar % prog.length].map((n) => Tone.Frequency(root).transpose(n).toNote());
      Tone.Transport.schedule((time) => drum.triggerAttackRelease('C1', '8n', time, 0.8), t);
      Tone.Transport.schedule((time) => drum.triggerAttackRelease('C1', '8n', time + secPerBar * 0.5, 0.7), t);
      Tone.Transport.schedule((time) => snare.triggerAttackRelease('8n', time + secPerBar*0.25, 0.4*density), t);
      Tone.Transport.schedule((time) => snare.triggerAttackRelease('8n', time + secPerBar*0.75, 0.4*density), t);
      [0.25,0.5,0.75].forEach((f) => Tone.Transport.schedule((time)=>hat.triggerAttackRelease('16n', time, 0.2*density), t+secPerBar*f));
      Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, `${secPerBar}s`, time, 0.35), t);
      Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '8n', time + secPerBar*0.01, 0.6), t);
      Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[2], '8n', time + secPerBar*0.5, 0.45), t);
      Tone.Transport.schedule((time) => lead.triggerAttackRelease(upOctave(chord[0]), '8n', time + secPerBar*0.25, 0.28), t);
      Tone.Transport.schedule((time) => lead.triggerAttackRelease(upOctave(chord[1]), '8n', time + secPerBar*0.5, 0.25), t);
      if (bar % 2 === 1) Tone.Transport.schedule((time) => lead.triggerAttackRelease(upOctave(chord[2]), '8n', time + secPerBar*0.75, 0.22), t);
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
playVoiceBtn.onclick = async () => { stateMachine.set('playingVoice'); await player.playVoice(); debug.playback='voice'; setDebug(); };
uploadBtn.onclick = () => uploadInput.click();
uploadInput.onchange = async (e) => { const f = e.target.files[0]; if (!f) return; setVocal(await upload.getBlob(f)); stateMachine.set('uploaded'); setStatus('Vocal uploaded.'); };
clearBtn.onclick = () => { player.stop(); chunks=[]; vocalBlob=null; vocalUrl=null; analysis=null; timerEl.textContent='0.0s'; document.getElementById('playVoiceBtn').disabled=true; document.getElementById('analyzeBtn').disabled=true; stateMachine.set('idle'); setStatus('Cleared.'); };

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
  try {
    const res = await generator.generate(analysis, { mood, style, length: lengthSelect.value });
    debug.backing = `generated (${res.bars} bars, ${res.totalSec.toFixed(1)}s)`;
    debug.context = Tone.context.state;
    setDebug();
    stateMachine.set('generated');
    showScreen('screen-generated');
  } catch (err) {
    debug.backing = 'error: ' + err.message; setDebug();
    stateMachine.set('analyzed');
    setStatus('Generation failed: ' + err.message);
  }
}
generateBtn.onclick = regenerate;
regenerateBtn.onclick = regenerate;
backToAnalysisBtn.onclick = ()=>showScreen('screen-analysis');
playVoice2Btn.onclick = ()=>player.playVoice();
playBackingBtn.onclick = ()=>{ stateMachine.set('playingBacking'); player.playBacking(); };
playTogetherBtn.onclick = ()=>{ stateMachine.set('playingTogether'); player.playTogether(); };
stopPlaybackBtn.onclick = ()=>{ stateMachine.set('stopped'); player.stop(); debug.playback='stopped'; setDebug(); };
