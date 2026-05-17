const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export function midiToNote(midi) { return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`; }
export function freqToMidi(freq) { return Math.round(69 + (12 * Math.log2(freq / 440))); }
export function midiToFreq(midi) { return 440 * (2 ** ((midi - 69) / 12)); }

function frameRms(frame){ let s=0; for(let i=0;i<frame.length;i++) s += frame[i]*frame[i]; return Math.sqrt(s/frame.length); }
function autocorrPitch(frame,sr){ let best=0,bLag=0; const minLag=Math.floor(sr/1000),maxLag=Math.floor(sr/80);
  for(let lag=minLag;lag<=maxLag;lag++){ let c=0; for(let i=0;i<frame.length-lag;i++) c += frame[i]*frame[i+lag]; if(c>best){best=c; bLag=lag;} }
  if(!bLag||best<1e-6) return null; return {freq:sr/bLag,confidence:Math.min(1,best/(frame.length*0.6))}; }

export function analyzeSignal(data, sampleRate){
  const durationSec = data.length / sampleRate; const win=2048, hop=512;
  const onsets=[], ioi=[], pitchContour=[], notes=[], energies=[];
  let lastE=0, lastOnset=-1;
  for(let i=0;i+win<data.length;i+=hop){
    const frame = data.subarray(i, i+win); const e = frameRms(frame); energies.push(e); const t=i/sampleRate;
    const flux = Math.max(0, e-lastE); if(e>0.01 && flux>0.025 && t-lastOnset>=0.1){ onsets.push(t); lastOnset=t; } lastE=e;
    const p=autocorrPitch(frame,sampleRate);
    if(p && p.freq>=80 && p.freq<=400 && p.confidence>=0.25){
      const midi=freqToMidi(p.freq); const pitch=midiToNote(midi); const expectedMidi=freqToMidi(midiToFreq(midi));
      if(expectedMidi!==midi) console.error('MIDI-note-frequency mismatch', {midi,pitch,freq:p.freq});
      notes.push({time:t,duration:hop/sampleRate,freq:Number(p.freq.toFixed(2)),midi,pitch,confidence:Number(p.confidence.toFixed(2))});
      pitchContour.push({time:t,freq:Number(p.freq.toFixed(2)),midi,pitch,confidence:Number(p.confidence.toFixed(2))});
    }
  }
  for(let i=1;i<onsets.length;i++) ioi.push(onsets[i]-onsets[i-1]);
  const bpmSpace = Array.from({length:111}, (_,i)=>60+i);
  const bpmCandidates = bpmSpace.map((bpm)=>{ if(!ioi.length) return {bpm,confidence:0}; const beat=60/bpm;
    const err = ioi.reduce((a,v)=>a+Math.min(Math.abs(v-beat),Math.abs(v-beat*2),Math.abs(v-beat/2)),0)/ioi.length;
    return {bpm,confidence:Number(Math.max(0,1-err*2.5).toFixed(3))}; }).sort((a,b)=>b.confidence-a.confidence).slice(0,3);
  const bpm = bpmCandidates[0]?.confidence>0.25 ? bpmCandidates[0].bpm : 'uncertain';
  const keyProfiles={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
  const keyCandidates=[]; const scaleCandidates=[];
  for(let root=0;root<12;root++) for(const scale of ['major','minor']){
    const pcs=keyProfiles[scale].map(v=>(v+root)%12); const inScale=notes.filter(n=>pcs.includes((n.midi%12+12)%12)).length;
    const confidence=notes.length?inScale/notes.length:0; const candidate={key:NOTE_NAMES[root],scale,confidence:Number(confidence.toFixed(3)),fitCount:inScale};
    keyCandidates.push(candidate); scaleCandidates.push({scale:`${NOTE_NAMES[root]} ${scale}`,confidence:candidate.confidence});
  }
  keyCandidates.sort((a,b)=>b.confidence-a.confidence); scaleCandidates.sort((a,b)=>b.confidence-a.confidence);
  const top=keyCandidates[0]||{key:'uncertain',scale:'uncertain',confidence:0,fitCount:0};
  const pitchRange = notes.length ? {lowest:midiToNote(Math.min(...notes.map(n=>n.midi))),highest:midiToNote(Math.max(...notes.map(n=>n.midi)))} : {lowest:'uncertain',highest:'uncertain'};
  const expectedBeats = (typeof bpm === 'number') ? (durationSec * bpm / 60) : durationSec * 2;
  const onsetAccuracy = Math.max(0, 1 - Math.abs(onsets.length - expectedBeats) / Math.max(1, expectedBeats));
  const rhythmConfidence = Number((onsetAccuracy * (bpmCandidates[0]?.confidence || 0)).toFixed(3));
  const phraseLen=4; const phrases=[];
  for(let s=0;s<durationSec;s+=phraseLen){ const st=Math.floor(s*sampleRate),en=Math.min(data.length,Math.floor((s+phraseLen)*sampleRate)); const seg=data.subarray(st,en); phrases.push({start:Number(s.toFixed(2)),end:Number(Math.min(durationSec,s+phraseLen).toFixed(2)),energy:Number(frameRms(seg).toFixed(3))}); }
  const avgEnergy = energies.length?energies.reduce((a,v)=>a+v,0)/energies.length:0;
  const analysisSource = notes.length || onsets.length ? 'real-detected' : 'fallback';
  return {durationSec:Number(durationSec.toFixed(2)),analysisSource,bpm,bpmCandidates,onsets:onsets.map(v=>Number(v.toFixed(3))),interOnsetIntervals:ioi.map(v=>Number(v.toFixed(3))),key:top.confidence<0.45?'uncertain':top.key,scale:top.confidence<0.45?'uncertain':top.scale,keyCandidates:keyCandidates.slice(0,3),scaleCandidates:scaleCandidates.slice(0,3),scaleFit:{fitCount:top.fitCount,totalNotes:notes.length},pitchRange,pitchContour,notes,phrases,rhythm:{onsets:onsets.map(v=>Number(v.toFixed(3))),gridFit:bpmCandidates[0]?.confidence||0,confidence:rhythmConfidence,inferredFrom:[onsets.length?'amplitude':null,notes.length?'pitch changes':null].filter(Boolean)},mood:{label:'estimated',method:'estimated from tempo, pitch range, loudness, and mode',factors:{tempo:bpm,pitchRange,loudness:Number(avgEnergy.toFixed(3)),mode:top.scale}},uncertain:top.confidence<0.45||notes.length<3?'not enough signal':null};
}
