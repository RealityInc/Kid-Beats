export function midiToNote(midi){const n=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];return n[midi%12]+(Math.floor(midi/12)-1)}
function freqToMidi(f){return Math.round(69+12*Math.log2(f/440));}
function autocorrPitch(frame,sr){let best=0,bLag=0;const minLag=Math.floor(sr/1000),maxLag=Math.floor(sr/80);for(let lag=minLag;lag<=maxLag;lag++){let c=0;for(let i=0;i<frame.length-lag;i++)c+=frame[i]*frame[i+lag];if(c>best){best=c;bLag=lag}}if(!bLag||best<1e-6)return null;return {freq:sr/bLag,confidence:Math.min(1,best/(frame.length*0.5))}}
export function analyzeSignal(data,sampleRate){
 const durationSec=data.length/sampleRate;const win=1024,hop=512;
 const onsets=[],ioi=[],pitchContour=[],notes=[];let lastE=0;
 for(let i=0;i+win<data.length;i+=hop){let e=0;for(let j=0;j<win;j++)e+=Math.abs(data[i+j]);e/=win;const t=i/sampleRate;if(e>0.05 && e-lastE>0.015)onsets.push(t);lastE=e;
 const p=autocorrPitch(data.slice(i,i+win),sampleRate);if(p){pitchContour.push({time:t,freq:p.freq,confidence:p.confidence});if(p.confidence>0.05 && p.freq<700){const midi=freqToMidi(p.freq);notes.push({time:t,duration:hop/sampleRate,midi,pitch:midiToNote(midi),confidence:Number(p.confidence.toFixed(2))});}}
 }
 for(let i=1;i<onsets.length;i++)ioi.push(onsets[i]-onsets[i-1]);
 const candidates=[60,70,80,90,100,110,120,130,140,150,160];
 const bpmCandidates=candidates.map(b=>{if(!ioi.length)return {bpm:b,confidence:0};const beat=60/b;const err=ioi.reduce((a,v)=>a+Math.min(Math.abs(v-beat),Math.abs(v-beat*2),Math.abs(v-beat/2)),0)/ioi.length;return {bpm:b,confidence:Number(Math.max(0,1-err*2).toFixed(2))}}).sort((a,b)=>b.confidence-a.confidence).slice(0,3);
 const bpm=bpmCandidates[0]?.confidence>0.2?bpmCandidates[0].bpm:null;
 const pcHist=Array(12).fill(0);notes.forEach(n=>pcHist[n.midi%12]++);
 const keyProfiles={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
 const keys=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
 const keyCandidates=[];
 for(let r=0;r<12;r++)for(const s of ['major','minor']){const pcs=keyProfiles[s].map(v=>(v+r)%12);const fit=notes.length?notes.filter(n=>pcs.includes(n.midi%12)).length/notes.length:0;keyCandidates.push({key:keys[r],scale:s,confidence:Number(fit.toFixed(2)),fitCount:Math.round(fit*notes.length)})}
 keyCandidates.sort((a,b)=>b.confidence-a.confidence);
 const selected=keyCandidates[0]||{key:null,scale:null,confidence:0,fitCount:0};
 const uncertainPitch=notes.length<3;
 const analysisSource=notes.length||onsets.length?'real-detected':'fallback';
 return {durationSec:Number(durationSec.toFixed(2)),bpm:bpm??'uncertain',bpmCandidates,onsets,interOnsetIntervals:ioi,key:selected.confidence<0.45?'uncertain':selected.key,scale:selected.confidence<0.45?'uncertain':selected.scale,keyCandidates:keyCandidates.slice(0,3),scaleFit:{fitCount:selected.fitCount,totalNotes:notes.length},pitchRange:notes.length?{lowest:midiToNote(Math.min(...notes.map(n=>n.midi))),highest:midiToNote(Math.max(...notes.map(n=>n.midi)))}:{lowest:'uncertain',highest:'uncertain'},pitchContour,notes,rhythm:{onsets,gridFit:bpmCandidates[0]?.confidence??0,inferredFrom:[notes.length?'pitch changes':null,onsets.length?'amplitude':null].filter(Boolean)},mood:{label:'estimated',method:'estimated from tempo, pitch range, loudness, and mode'},analysisSource,uncertain:uncertainPitch?'not enough signal for confident pitch/key':null};
}
