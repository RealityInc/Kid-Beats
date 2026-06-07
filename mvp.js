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
    const mood = options.mood;
    const style = options.style;
    const isRock = style === 'rock';
    const isCountry = style === 'country';
    const moodBpmRange = { spooky:[55,85], sad:[60,80], chill:[65,85], silly:[85,110], happy:[95,120], epic:[125,150] };
    const [bpmMin, bpmMax] = moodBpmRange[mood] ?? [80, 120];
    const effectiveBpm = Math.max(bpmMin, Math.min(bpmMax, analysis.bpm));
    Tone.Transport.bpm.value = effectiveBpm;
    const secPerBar = (60 / effectiveBpm) * 4;
    let target = options.length === 'match' ? analysis.durationSec : Number(options.length);
    target = Math.max(target, analysis.durationSec);
    const bars = Math.ceil(target / secPerBar);
    const totalSec = bars * secPerBar;
    const drum = new Tone.MembraneSynth();
    const snare = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.13, sustain: 0 } });
    const hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.05, sustain: 0 } });
    const bass = new Tone.Synth({ oscillator: { type: 'triangle' } });
    const poly = new Tone.PolySynth(Tone.Synth);
    const lead = new Tone.Synth({ oscillator: { type: (isRock || style.includes('electro')) ? 'sawtooth' : 'triangle' } });
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

    const density = mood === 'epic' ? 1.0 : mood === 'chill' ? 0.5 : 0.7;
    const isHalfTime = mood === 'spooky' || mood === 'sad' || mood === 'chill';
    const is4OnFloor = style === 'dance';
    const isHipHop = style === 'hip-hop';
    const chordDur = isHipHop ? '4n' : isCountry ? '8n' : `${secPerBar}s`;
    const kickBeats = is4OnFloor ? [0, 0.25, 0.5, 0.75] : isHalfTime ? [0] : [0, 0.5];
    const snareBeats = isHalfTime ? [0.5] : isCountry ? [] : [0.25, 0.75];
    const hatBeats = (mood === 'epic' || isRock) ? [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
                   : isHalfTime ? [0.5]
                   : is4OnFloor ? [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]
                   : [0.25, 0.5, 0.75];

    for (let bar = 0; bar < bars; bar++) {
      const t = bar * secPerBar;
      const chord = prog[bar % prog.length].map((n) => Tone.Frequency(root).transpose(n).toNote());
      kickBeats.forEach(f => Tone.Transport.schedule((time) => drum.triggerAttackRelease('C1', '8n', time, 0.8), t + secPerBar*f));
      snareBeats.forEach(f => Tone.Transport.schedule((time) => snare.triggerAttackRelease('8n', time, 0.4*density), t + secPerBar*f));
      hatBeats.forEach(f => Tone.Transport.schedule((time) => hat.triggerAttackRelease('16n', time, 0.18*density), t + secPerBar*f));
      Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, chordDur, time, 0.35), t);
      if (isHipHop) Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord, '8n', time, 0.25), t + secPerBar*0.375);
      if (isCountry) {
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord.slice(0, 2), '16n', time, 0.3), t + secPerBar * 0.25);
        Tone.Transport.schedule((time) => poly.triggerAttackRelease(chord.slice(0, 2), '16n', time, 0.3), t + secPerBar * 0.75);
      }
      Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '8n', time + secPerBar*0.01, 0.6), t);
      Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[2], '8n', time + secPerBar*0.5, 0.45), t);
      if (isHipHop) Tone.Transport.schedule((time) => bass.triggerAttackRelease(chord[0], '16n', time, 0.4), t + secPerBar*0.375);
      Tone.Transport.schedule((time) => lead.triggerAttackRelease(upOctave(chord[0]), '8n', time + secPerBar*0.25, 0.28), t);
      Tone.Transport.schedule((time) => lead.triggerAttackRelease(upOctave(chord[1]), '8n', time + secPerBar*0.5, 0.25), t);
      if (bar % 2 === 1) Tone.Transport.schedule((time) => lead.triggerAttackRelease(upOctave(chord[2]), '8n', time + secPerBar*0.75, 0.22), t);
    }
    Tone.Transport.swing = isHipHop ? 0.2 : (is4OnFloor || isRock) ? 0.02 : isCountry ? 0.06 : 0.08;
    Tone.Transport.schedule(() => Tone.Transport.stop(), totalSec);
    return { bars, totalSec, effectiveBpm };
  }
}

class PlaybackEngine {
  constructor() {
    // this.voice: plain HTML audio element — used for direct playback (playVoice)
    // this._voiceWA: separate element routed through Web Audio — used for playTogether
    this.voice = new Audio();
    this._voiceWA = new Audio();
    this._source = null; this._pitchShift = null; this._rafId = null;
    this._rateCompensation = 0; this._pitchSchedule = null;
  }
  _ensureAudioChain() {
    if (this._source) return;
    this._source = Tone.context.createMediaElementSource(this._voiceWA);
    this._pitchShift = new Tone.PitchShift(0).toDestination();
    this._source.connect(this._pitchShift.input);
  }
  setVoiceUrl(url) { this.voice.src = url; this._voiceWA.src = url; }
  setTuning(pitchSchedule, tempoRatio) {
    this._pitchSchedule = pitchSchedule;
    this._voiceWA.playbackRate = tempoRatio;
    this._rateCompensation = -12 * Math.log2(tempoRatio);
  }
  clearTuning() {
    this._pitchSchedule = null; this._voiceWA.playbackRate = 1; this._rateCompensation = 0;
    if (this._pitchShift) this._pitchShift.pitch = 0;
  }
  _startPitchTracking() {
    this._stopPitchTracking();
    if (!this._pitchSchedule || !this._pitchShift) return;
    let i = 0;
    const schedule = this._pitchSchedule;
    const loop = () => {
      const t = this._voiceWA.currentTime;
      while (i < schedule.length - 1 && schedule[i + 1].time <= t) i++;
      if (schedule.length) this._pitchShift.pitch = schedule[i].shift + this._rateCompensation;
      if (!this._voiceWA.paused) this._rafId = requestAnimationFrame(loop);
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
    await Tone.start(); this.stop(); this._ensureAudioChain();
    this._voiceWA.currentTime = 0; Tone.Transport.position = 0; Tone.Transport.start();
    await this._voiceWA.play(); this._startPitchTracking();
  }
  stop() {
    this._stopPitchTracking();
    this.voice.pause(); this.voice.currentTime = 0;
    this._voiceWA.pause(); this._voiceWA.currentTime = 0;
    if (this._pitchShift) this._pitchShift.pitch = 0; Tone.Transport.stop();
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
let recordTimer = null, recordStart = 0, chunks = [], vocalBlob = null, vocalUrl = null, analysis = null, generatedResult = null;

function computePitchSchedule(pitchContour, key, scale) {
  const scaleIntervals = { major: [0,2,4,5,7,9,11], minor: [0,2,3,5,7,8,10] };
  const noteIndex = { C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11 };
  const root = noteIndex[key] ?? 0;
  const scalePcs = (scaleIntervals[scale] ?? scaleIntervals.major).map(v => (v + root) % 12);
  const raw = (pitchContour || []).filter(p => p.confidence >= 0.25).map(p => {
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

function applyTuning() {
  if (!document.getElementById('tuneSyncToggle').checked || !generatedResult || !analysis) {
    return player.clearTuning();
  }
  const schedule = computePitchSchedule(analysis.pitchContour, analysis.key, analysis.scale);
  const vocalBpm = typeof analysis.bpm === 'number' ? analysis.bpm : generatedResult.effectiveBpm;
  player.setTuning(schedule, generatedResult.effectiveBpm / vocalBpm);
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
  stateMachine.set('idle');
  setStatus('Cleared.');
  showScreen('screen-input');
}
clearBtn.onclick = resetAll;
document.getElementById('startOver2Btn').onclick = resetAll;
document.getElementById('startOver3Btn').onclick = resetAll;
document.getElementById('tuneSyncToggle').onchange = applyTuning;

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
    generatedResult = res;
    debug.backing = `generated (${res.bars} bars, ${res.totalSec.toFixed(1)}s)`;
    debug.context = Tone.context.state;
    setDebug();
    stateMachine.set('generated');
    showScreen('screen-generated');
    applyTuning();
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
playTogetherBtn.onclick = ()=>{ stateMachine.set('playingTogether'); player.playTogether(); };
stopPlaybackBtn.onclick = ()=>{ stateMachine.set('stopped'); player.stop(); debug.playback='stopped'; setDebug(); };
