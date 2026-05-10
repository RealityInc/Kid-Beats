import { analyzeSignal } from '../analysis-core.js';
function sine(freq,dur,sr=44100){const n=Math.floor(dur*sr),a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=0.4*Math.sin(2*Math.PI*freq*i/sr);return {a,sr}}
function claps(bpm,dur=8,sr=44100){const n=Math.floor(dur*sr),a=new Float32Array(n);const step=60/bpm;for(let t=0;t<dur;t+=step){const i=Math.floor(t*sr);for(let k=0;k<800&&i+k<n;k++)a[i+k]+=Math.random()*0.9*Math.exp(-k/150);}return {a,sr}}
function scale(freqs,sr=44100){const seg=0.4;const n=Math.floor(freqs.length*seg*sr);const a=new Float32Array(n);freqs.forEach((f,idx)=>{for(let i=0;i<seg*sr;i++){const p=idx*seg*sr+i;a[p]=0.35*Math.sin(2*Math.PI*f*i/sr);}});return {a,sr}}
const tests=[];
let x=sine(440,3);tests.push(['A4 sustained',analyzeSignal(x.a,x.sr)]);
x=claps(120);tests.push(['120 clap',analyzeSignal(x.a,x.sr)]);
x=claps(90);tests.push(['90 clap',analyzeSignal(x.a,x.sr)]);
x=scale([261.63,293.66,329.63,349.23,392,440,493.88,523.25]);tests.push(['C major scale',analyzeSignal(x.a,x.sr)]);
x=scale([220,246.94,261.63,293.66,329.63,349.23,392,440]);tests.push(['A minor scale',analyzeSignal(x.a,x.sr)]);
for(const [name,r] of tests){console.log(name, {bpm:r.bpm,key:r.key,scale:r.scale,topBpm:r.bpmCandidates[0],topKey:r.keyCandidates[0],firstPitch:r.pitchContour[0]?.freq,source:r.analysisSource,uncertain:r.uncertain});}
