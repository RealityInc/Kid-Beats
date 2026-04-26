export function renderSong(song, hooks = {}) {
  if (hooks && typeof hooks.loadSong === 'function') {
    hooks.loadSong(song);
    return { engine: 'existing-web-audio' };
  }
  return { engine: 'none' };
}
