// Pure-data manifest of vendored instrument samples — no Tone.js import, so
// node tests can validate it directly. File names follow tonejs-instruments
// convention: sharp is "s" in the file name ("Gs2.mp3" = note "G#2").
export const SAMPLE_LIBRARY = {
  piano: {
    base: './vendor/samples/piano/', release: 1.0, volumeDb: -3,
    urls: { 'C2':'C2.mp3','E2':'E2.mp3','G#2':'Gs2.mp3','C3':'C3.mp3','E3':'E3.mp3','G#3':'Gs3.mp3',
            'C4':'C4.mp3','E4':'E4.mp3','G#4':'Gs4.mp3','C5':'C5.mp3','E5':'E5.mp3','G#5':'Gs5.mp3','C6':'C6.mp3' },
  },
  'bass-electric': {
    base: './vendor/samples/bass-electric/', release: 0.4, volumeDb: -1,
    urls: { 'E1':'E1.mp3','A#1':'As1.mp3','C#2':'Cs2.mp3','E2':'E2.mp3','G2':'G2.mp3',
            'A#2':'As2.mp3','C#3':'Cs3.mp3','E3':'E3.mp3','G3':'G3.mp3' },
  },
  'guitar-acoustic': {
    base: './vendor/samples/guitar-acoustic/', release: 0.5, volumeDb: -2,
    urls: { 'D2':'D2.mp3','F2':'F2.mp3','G#2':'Gs2.mp3','B2':'B2.mp3','D3':'D3.mp3','F3':'F3.mp3',
            'G#3':'Gs3.mp3','B3':'B3.mp3','D4':'D4.mp3','F4':'F4.mp3','G#4':'Gs4.mp3','B4':'B4.mp3' },
  },
  'guitar-electric': {
    base: './vendor/samples/guitar-electric/', release: 0.4, volumeDb: -6,
    urls: { 'C#2':'Cs2.mp3','E2':'E2.mp3','F#2':'Fs2.mp3','A2':'A2.mp3','C3':'C3.mp3','D#3':'Ds3.mp3',
            'F#3':'Fs3.mp3','A3':'A3.mp3','C4':'C4.mp3','D#4':'Ds4.mp3','F#4':'Fs4.mp3','A4':'A4.mp3',
            'C5':'C5.mp3','D#5':'Ds5.mp3','F#5':'Fs5.mp3','A5':'A5.mp3','C6':'C6.mp3' },
  },
  flute: {
    base: './vendor/samples/flute/', release: 0.3, volumeDb: -2,
    urls: { 'C4':'C4.mp3','E4':'E4.mp3','A4':'A4.mp3','C5':'C5.mp3','E5':'E5.mp3','A5':'A5.mp3','C6':'C6.mp3' },
  },
  xylophone: {
    base: './vendor/samples/xylophone/', release: 0.8, volumeDb: -4,
    urls: { 'G4':'G4.mp3','C5':'C5.mp3','G5':'G5.mp3','C6':'C6.mp3','G6':'G6.mp3','C7':'C7.mp3','G7':'G7.mp3','C8':'C8.mp3' },
  },
  organ: {
    base: './vendor/samples/organ/', release: 0.2, volumeDb: -8,
    urls: { 'C2':'C2.mp3','F#2':'Fs2.mp3','C3':'C3.mp3','F#3':'Fs3.mp3','C4':'C4.mp3','F#4':'Fs4.mp3','C5':'C5.mp3' },
  },
  drumkit: {
    base: './vendor/samples/drumkit/',
    oneShots: {
      kick:      { file:'kick.mp3',       volumeDb:  0 },
      snare:     { file:'snare.mp3',      volumeDb: -2 },
      snare2:    { file:'snare2.mp3',     volumeDb: -2 },
      hatClosed: { file:'hatClosed.mp3',  volumeDb: -8 },
      hatOpen:   { file:'hatOpen.mp3',    volumeDb: -9 },
      tomLow:    { file:'tomLow.mp3',     volumeDb: -3 },
      tomMid:    { file:'tomMid.mp3',     volumeDb: -3 },
      tomHigh:   { file:'tomHigh.mp3',    volumeDb: -3 },
      ride:      { file:'ride.mp3',       volumeDb: -8 },
      crash:     { file:'crash.mp3',      volumeDb: -6 },
    },
  },
};

export const ATTRIBUTION =
  'Instrument samples: tonejs-instruments (CC-BY 3.0) · drum kit via @teropa/drumkit — freesound.org: DWSD (CC-BY), stomachache & Karman Lyne (CC0)';
