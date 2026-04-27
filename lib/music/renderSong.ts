export function renderSong(song: any, hooks: { loadSong?: (s: any) => void } = {}) {
  if (hooks.loadSong) hooks.loadSong(song);
  return { engine: hooks.loadSong ? 'existing-web-audio' : 'none' };
}
