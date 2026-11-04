import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { AudioEngine, probeDuration, type AudioSnapshot } from './audio';
import { createTrackName, formatTime, PlaylistView, type Track } from './playlist';
import { loadLastPlayback, loadVolume, saveLastPlayback, saveVolume } from './storage';
import { Visualizer } from './visualizer';
import { initCursor } from './cursor';
import { SettingsPanel } from './settings-panel';
import { SCENES } from './scenes';
import { SCENE_IDS, THEME_IDS, settings, type ModeSetting } from './settings';
import { THEMES, applyAppearance, currentPalette } from './themes';
import type { CharacterExperience } from './character/experience';
import './styles/index.css';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] as const;
const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

type RepeatMode = 'off' | 'all' | 'one';

const elements = {
  addMusic: requiredElement<HTMLButtonElement>('add-music-button'),
  mobileAddMusic: requiredElement<HTMLButtonElement>('mobile-add-button'),
  emptyAddMusic: requiredElement<HTMLButtonElement>('empty-add-button'),
  browserFileInput: requiredElement<HTMLInputElement>('browser-file-input'),
  title: requiredElement<HTMLElement>('current-track-title'),
  subtitle: requiredElement<HTMLElement>('current-track-subtitle'),
  status: requiredElement<HTMLElement>('playing-status'),
  currentTime: requiredElement<HTMLElement>('current-time'),
  totalTime: requiredElement<HTMLElement>('total-time'),
  seekSlider: requiredElement<HTMLInputElement>('seek-slider'),
  volumeSlider: requiredElement<HTMLInputElement>('volume-slider'),
  volumeValue: requiredElement<HTMLOutputElement>('volume-value'),
  playButton: requiredElement<HTMLButtonElement>('play-button'),
  previousButton: requiredElement<HTMLButtonElement>('previous-button'),
  nextButton: requiredElement<HTMLButtonElement>('next-button'),
  shuffleButton: requiredElement<HTMLButtonElement>('shuffle-button'),
  repeatButton: requiredElement<HTMLButtonElement>('repeat-button'),
  repeatOneIndicator: requiredElement<HTMLElement>('repeat-one-indicator'),
  clearPlaylist: requiredElement<HTMLButtonElement>('clear-playlist-button'),
  toastRegion: requiredElement<HTMLElement>('toast-region'),
  dropOverlay: requiredElement<HTMLElement>('drop-overlay'),
  canvas: requiredElement<HTMLCanvasElement>('visualizer-canvas'),
  artwork: requiredElement<HTMLElement>('artwork-card'),
  characterCanvas: requiredElement<HTMLCanvasElement>('character-canvas'),
  characterState: requiredElement<HTMLElement>('character-state'),
  scenePill: requiredElement<HTMLElement>('scene-pill'),
  playlistToggle: requiredElement<HTMLButtonElement>('playlist-toggle'),
  microphoneButton: requiredElement<HTMLButtonElement>('microphone-button'),
  microphoneRetry: requiredElement<HTMLButtonElement>('microphone-retry'),
  microphoneStatus: requiredElement<HTMLElement>('mic-status'),
  microphoneMessage: requiredElement<HTMLElement>('mic-status-message'),
};

// Theme and mode must be in place before anything is drawn with them.
applyAppearance();
initCursor();
const audio = new AudioEngine(loadVolume());
const visualizer = new Visualizer(elements.canvas, audio.analyser);
let character: CharacterExperience | null = null;
let applicationLeaving = false;
// Load Three.js and the 3D scene separately so a blocked CDN/WebGL device still gets the full player.
void import('./character/experience')
  .then(({ createCharacterExperience }) => {
    if (applicationLeaving) return null;
    return createCharacterExperience(elements.characterCanvas, elements.characterState);
  })
  .then((instance) => {
    if (!instance) return;
    if (applicationLeaving) instance.dispose();
    else character = instance;
  })
  .catch((error: unknown) => {
    console.warn('The 3D character could not be initialized; the music player will continue normally.', error);
    if (!applicationLeaving) elements.characterState.textContent = 'PORTRAIT UNAVAILABLE';
  });
// Drive the artwork's rings and glow from the audio, so the cover reacts even without the canvas.
const brandMark = document.querySelector<HTMLElement>('.brand-mark');
const faviconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
let lastFaviconUpdate = -1000;
let lastFaviconLevel = -1;
visualizer.onFrame((frame, dt) => {
  const beat = frame.beat.toFixed(3);
  const bass = frame.bass.toFixed(3);
  elements.artwork.style.setProperty('--level', frame.level.toFixed(3));
  elements.artwork.style.setProperty('--beat', beat);
  elements.artwork.style.setProperty('--bass', bass);
  const snapshot = audio.getSnapshot();
  const sourceActive = microphoneActive || (!snapshot.paused && currentTrackId !== null);
  character?.update(frame, dt, sourceActive);
  // The top-bar mark uses the same bass envelope as the main artwork.
  brandMark?.style.setProperty('--beat', beat);
  brandMark?.style.setProperty('--bass', bass);

  // Browsers accept an SVG data URL as a live favicon. Throttle updates and
  // quantise level so we never rewrite the tab icon more than 10 times/second.
  const now = performance.now();
  const iconLevel = Math.round(frame.level * 12) / 12;
  if (faviconLink && now - lastFaviconUpdate > 100 && Math.abs(iconLevel - lastFaviconLevel) >= 1 / 24) {
    const accent = currentPalette().accent;
    const accent2 = currentPalette().accent2;
    const glow = (0.25 + iconLevel * 0.7).toFixed(2);
    const pulse = (1 + iconLevel * 2.2).toFixed(2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset="1" stop-color="${accent2}"/></linearGradient><filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="${pulse}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect x="2" y="2" width="60" height="60" rx="18" fill="#101323"/><path d="M9 33h10l6-15 9 29 7-19 4 5h10" fill="none" stroke="url(#g)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="${glow}" filter="url(#glow)"/><circle cx="55" cy="33" r="4" fill="${accent2}"/></svg>`;
    faviconLink.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    lastFaviconUpdate = now;
    lastFaviconLevel = iconLevel;
  }
});
let tracks: Track[] = [];
let currentTrackId: string | null = null;
let shuffleEnabled = false;
let repeatMode: RepeatMode = 'off';
let isScrubbing = false;
let lastPersistedAt = 0;
let pendingToastTimer = 0;
let generatedId = 0;
let handledEndedTrackId: string | null = null;
let microphoneActive = false;
let microphonePending = false;
let microphonePreviousDisplay: { title: string; subtitle: string } | null = null;
const previousSession = loadLastPlayback();
let restorationAttemptedFor: string | null = null;
const playlist = new PlaylistView((trackId) => {
  void playTrack(trackId, true);
}, (orderedIds) => reorderTracks(orderedIds));

const settingsPanel = new SettingsPanel((open) => {
  if (open) playlist.setOpen(false);
});
// Only one drawer is open at a time: opening the queue closes settings.
elements.playlistToggle.addEventListener('click', () => {
  if (playlist.isOpen()) settingsPanel.setOpen(false);
});
settings.subscribe(() => {
  applyAppearance();
  renderScenePill();
});
renderScenePill();

audio.setVolume(loadVolume());
renderVolume(audio.getSnapshot().volume);

const initialSnapshot = audio.getSnapshot();
renderAudioState(initialSnapshot);
renderPlaylist();

// The analyser continues drawing in an idle state even before a track is loaded.
audio.on('time', (snapshot) => {
  renderTimeline(snapshot);
  persistPlaybackPosition(snapshot, false);
});

audio.on('metadata', (snapshot) => {
  const current = getCurrentTrack();
  if (current && snapshot.duration > 0 && current.duration !== snapshot.duration) {
    current.duration = snapshot.duration;
    renderPlaylist();
  }
  renderTimeline(snapshot);
});

audio.on('state', (snapshot) => {
  renderAudioState(snapshot);
  if (snapshot.paused) persistPlaybackPosition(snapshot, true);
  if (snapshot.ended && currentTrackId && handledEndedTrackId !== currentTrackId) {
    handledEndedTrackId = currentTrackId;
    void handleTrackEnded();
  }
});

audio.on('error', (_snapshot, message) => {
  elements.status.textContent = 'AUDIO ERROR';
  showToast(message ?? 'The selected audio file could not be played.', 'error');
});

elements.microphoneButton.addEventListener('click', () => void toggleMicrophone());
elements.microphoneRetry.addEventListener('click', () => void toggleMicrophone(true));
elements.addMusic.addEventListener('click', () => void importAudioFiles());
elements.mobileAddMusic.addEventListener('click', () => void importAudioFiles());
elements.emptyAddMusic.addEventListener('click', () => void importAudioFiles());

elements.browserFileInput.addEventListener('change', () => {
  const files = elements.browserFileInput.files ? Array.from(elements.browserFileInput.files) : [];
  elements.browserFileInput.value = '';
  if (files.length > 0) addFiles(files);
});

elements.playButton.addEventListener('click', () => void togglePlayback());
elements.previousButton.addEventListener('click', () => void playPrevious());
elements.nextButton.addEventListener('click', () => void playNext(true));
elements.shuffleButton.addEventListener('click', toggleShuffle);
elements.repeatButton.addEventListener('click', cycleRepeatMode);
elements.clearPlaylist.addEventListener('click', clearPlaylist);
initFileDrop();

elements.volumeSlider.addEventListener('input', () => {
  setVolume(Number(elements.volumeSlider.value));
});

elements.seekSlider.addEventListener('pointerdown', () => {
  isScrubbing = true;
});
elements.seekSlider.addEventListener('input', () => {
  isScrubbing = true;
  const duration = audio.getSnapshot().duration;
  const target = duration * Number(elements.seekSlider.value) / Number(elements.seekSlider.max);
  elements.currentTime.textContent = formatTime(target);
});
const finishScrub = (): void => {
  if (!isScrubbing) return;
  isScrubbing = false;
  const duration = audio.getSnapshot().duration;
  const target = duration * Number(elements.seekSlider.value) / Number(elements.seekSlider.max);
  audio.seek(target);
  persistPlaybackPosition(audio.getSnapshot(), true);
};
elements.seekSlider.addEventListener('change', finishScrub);
elements.seekSlider.addEventListener('pointerup', finishScrub);
elements.seekSlider.addEventListener('pointercancel', finishScrub);

// Desktop shortcuts intentionally ignore typing fields and browser/editor-like controls.
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (playlist.isOpen() || settingsPanel.isOpen()) {
      event.preventDefault();
      playlist.setOpen(false);
      settingsPanel.setOpen(false);
    }
    return;
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'BUTTON'
  )) return;

  if (event.code === 'Space') {
    event.preventDefault();
    void togglePlayback();
  } else if (event.key.toLowerCase() === 'b') {
    cycleScene();
  } else if (event.key.toLowerCase() === 't') {
    cycleTheme();
  } else if (event.key.toLowerCase() === 'l') {
    toggleMode();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    audio.seek(audio.getSnapshot().currentTime - 5);
    persistPlaybackPosition(audio.getSnapshot(), true);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    audio.seek(audio.getSnapshot().currentTime + 5);
    persistPlaybackPosition(audio.getSnapshot(), true);
  }
});

window.addEventListener('beforeunload', () => {
  applicationLeaving = true;
  character?.dispose();
  character = null;
  persistPlaybackPosition(audio.getSnapshot(), true);
  audio.dispose();
  visualizer.dispose();
});

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required interface element #${id} was not found.`);
  return element as T;
}

async function importAudioFiles(): Promise<void> {
  if (!isTauri()) {
    elements.browserFileInput.click();
    return;
  }

  try {
    const selection = await open({
      multiple: true,
      directory: false,
      title: 'Add music to Pulse',
      filters: [{ name: 'Audio files', extensions: [...AUDIO_EXTENSIONS] }],
    });
    if (!selection) return;

    const paths = (Array.isArray(selection) ? selection : [selection]).filter((path): path is string => typeof path === 'string');
    await addFilesFromPaths(paths);
  } catch (error: unknown) {
    showToast(error instanceof Error ? error.message : 'The file picker could not be opened.', 'error');
  }
}

async function addFilesFromPaths(paths: readonly string[], ignoredCount = 0): Promise<void> {
  if (paths.length === 0) {
    if (ignoredCount > 0) showToast('No supported audio files were dropped.', 'error');
    return;
  }

  showToast(`Loading ${paths.length} ${paths.length === 1 ? 'file' : 'files'}…`, 'info');
  const loaded: File[] = [];
  const errors: string[] = [];

  // Keep the imported list useful even if one selected file is corrupt or inaccessible.
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (!path) continue;
    try {
      const bytes = await readFile(path);
      if (bytes.byteLength === 0) throw new Error('The file is empty.');
      const extension = extensionFromPath(path) ?? detectAudioExtension(bytes);
      if (!extension) throw new Error('The file does not appear to be a supported audio format.');
      const suggestedName = filenameFromPath(path);
      const hasUsefulFilename = suggestedName && hasAudioExtension(suggestedName);
      const name = hasUsefulFilename ? suggestedName : `Track ${tracks.length + loaded.length + 1}.${extension}`;
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      loaded.push(new File([arrayBuffer], name, { type: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream' }));
    } catch (error: unknown) {
      const shortName = filenameFromPath(path) || `Selected file ${index + 1}`;
      errors.push(`${shortName}: ${error instanceof Error ? error.message : 'could not be read'}`);
    }
  }

  if (loaded.length > 0) addFiles(loaded);
  if (errors.length > 0) {
    showToast(`${errors.length} ${errors.length === 1 ? 'file could' : 'files could'} not be added. ${errors.slice(0, 2).join(' ')}`, 'error', 7000);
  } else if (loaded.length === 0) {
    showToast('No supported audio files were selected.', 'error');
  }
}

/** Drag-and-drop import: native file drops in the desktop app, standard HTML5 drops in the browser. */
function initFileDrop(): void {
  const setOverlay = (visible: boolean): void => {
    elements.dropOverlay.hidden = !visible;
    document.body.classList.toggle('is-file-dragging', visible);
  };

  if (isTauri()) {
    // The webview intercepts OS file drops, so paths arrive through Tauri's own drag-drop event.
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter') {
        setOverlay(true);
      } else if (payload.type === 'leave') {
        setOverlay(false);
      } else if (payload.type === 'drop') {
        setOverlay(false);
        const supported = payload.paths.filter((path) => extensionFromPath(path) !== null);
        void addFilesFromPaths(supported, payload.paths.length - supported.length);
      }
    }).catch(() => {
      // Drag-and-drop is an enhancement; the file picker still works if the event cannot be registered.
    });
    return;
  }

  let depth = 0;
  const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    setOverlay(true);
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setOverlay(false);
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    setOverlay(false);
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
    if (files.length > 0) addFiles(files);
  });
}

function reorderTracks(orderedIds: readonly string[]): void {
  const byId = new Map(tracks.map((track) => [track.id, track] as const));
  const reordered = orderedIds.map((id) => byId.get(id)).filter((track): track is Track => track !== undefined);
  // Ignore stale or partial orders so a track can never be lost by a reorder.
  if (reordered.length === tracks.length) tracks = reordered;
  renderPlaylist();
}

function addFiles(files: readonly File[]): void {
  const supported = files.filter((file) => {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    return AUDIO_EXTENSIONS.includes(extension as typeof AUDIO_EXTENSIONS[number]) && file.size > 0;
  });

  if (supported.length === 0) {
    showToast('Choose a non-empty MP3, WAV, FLAC, OGG, M4A, or AAC file.', 'error');
    return;
  }

  const added: Track[] = [];
  let skipped = 0;
  for (const file of supported) {
    const name = createTrackName(file.name);
    const duplicate = tracks.some((track) => track.name === name && track.file.size === file.size) ||
      added.some((track) => track.name === name && track.file.size === file.size);
    if (duplicate) {
      skipped += 1;
      continue;
    }
    added.push({ id: createId(), name, file, duration: null });
  }

  if (added.length === 0) {
    showToast(skipped > 0 ? 'Those tracks are already in your library.' : 'No audio files were added.', 'info');
    return;
  }

  const wasEmpty = tracks.length === 0;
  tracks = [...tracks, ...added];
  renderPlaylist();
  playlist.setOpen(true);
  showToast(`Added ${added.length} ${added.length === 1 ? 'track' : 'tracks'} to your library.`, 'success');
  void probeTrackDurations(added).catch(() => {
    showToast('Some track durations could not be read.', 'info');
  });

  if (wasEmpty) {
    const restored = previousSession
      ? added.find((track) => track.name.localeCompare(previousSession.trackName, undefined, { sensitivity: 'accent' }) === 0)
      : undefined;
    void playTrack((restored ?? added[0])?.id ?? '', false);
  }
}

async function probeTrackDurations(newTracks: readonly Track[]): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < newTracks.length) {
      const index = cursor;
      cursor += 1;
      const track = newTracks[index];
      if (!track) continue;
      const duration = await probeDuration(track.file, 3000);
      const current = tracks.find((candidate) => candidate.id === track.id);
      if (current && duration !== null) current.duration = duration;
      renderPlaylist();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, newTracks.length) }, () => worker()));
}

async function playTrack(trackId: string, openPanel = false): Promise<void> {
  if (microphoneActive) stopMicrophone();
  elements.microphoneStatus.hidden = true;
  updateMicrophoneButton();
  const track = tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    if (tracks.length === 0) showToast('Your library is empty. Add a few tracks first.', 'info');
    return;
  }

  const previousTrack = getCurrentTrack();
  if (previousTrack && previousTrack.id !== track.id) {
    persistPlaybackPosition(audio.getSnapshot(), true);
  }
  currentTrackId = track.id;
  handledEndedTrackId = null;
  elements.title.textContent = track.name;
  elements.subtitle.textContent = track.file.name || 'Local audio file';
  elements.status.textContent = 'TUNING IN';
  renderPlaylist();
  if (openPanel) playlist.setOpen(false);

  try {
    await audio.load(track.file);

    if (
      previousSession &&
      restorationAttemptedFor !== track.id &&
      track.name.localeCompare(previousSession.trackName, undefined, { sensitivity: 'accent' }) === 0
    ) {
      restorationAttemptedFor = track.id;
      await waitForMetadata(1800);
      if (previousSession.position > 0) {
        const duration = track.duration ?? audio.getSnapshot().duration;
        audio.seek(duration > 0 ? Math.min(previousSession.position, duration) : previousSession.position);
      }
    }

    await audio.play();
    elements.status.textContent = 'NOW IN YOUR FREQUENCY';
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Playback could not start.';
    elements.status.textContent = 'READY TO PLAY';
    showToast(message, 'error', 6000);
  }
  renderAudioState(audio.getSnapshot());
}

async function togglePlayback(): Promise<void> {
  if (microphoneActive) stopMicrophone();
  if (!currentTrackId) {
    const firstTrack = tracks[0];
    if (!firstTrack) {
      showToast('Your library is empty. Add a few tracks first.', 'info');
      return;
    }
    await playTrack(firstTrack.id);
    return;
  }

  try {
    await audio.togglePlayback();
    const snapshot = audio.getSnapshot();
    elements.status.textContent = snapshot.paused ? 'PAUSED IN PLACE' : 'NOW IN YOUR FREQUENCY';
    renderAudioState(snapshot);
  } catch (error: unknown) {
    showToast(error instanceof Error ? error.message : 'Playback could not start.', 'error', 6000);
  }
}

async function playNext(manual: boolean): Promise<void> {
  if (tracks.length === 0) return;
  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  if (shuffleEnabled && tracks.length > 1) {
    const options = tracks.filter((track) => track.id !== currentTrackId);
    const next = options[Math.floor(Math.random() * options.length)];
    if (next) await playTrack(next.id);
    return;
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex >= 0 && nextIndex < tracks.length) {
    const next = tracks[nextIndex];
    if (next) await playTrack(next.id);
    return;
  }

  if (repeatMode === 'all') {
    const first = tracks[0];
    if (first) await playTrack(first.id);
  } else if (manual) {
    audio.seek(0);
    showToast('You have reached the end of your queue.', 'info');
  } else {
    elements.status.textContent = 'QUEUE COMPLETE';
  }
}

async function playPrevious(): Promise<void> {
  if (tracks.length === 0) return;
  const snapshot = audio.getSnapshot();
  if (snapshot.currentTime > 3) {
    audio.seek(0);
    return;
  }

  const currentIndex = tracks.findIndex((track) => track.id === currentTrackId);
  const previousIndex = currentIndex - 1;
  if (previousIndex >= 0) {
    const track = tracks[previousIndex];
    if (track) await playTrack(track.id);
  } else if (repeatMode === 'all') {
    const last = tracks[tracks.length - 1];
    if (last) await playTrack(last.id);
  } else {
    audio.seek(0);
  }
}

async function handleTrackEnded(): Promise<void> {
  if (repeatMode === 'one' && currentTrackId) {
    handledEndedTrackId = null;
    audio.seek(0);
    try {
      await audio.play();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'The track could not be repeated.', 'error');
    }
    return;
  }
  await playNext(false);
}

function toggleShuffle(): void {
  shuffleEnabled = !shuffleEnabled;
  elements.shuffleButton.classList.toggle('is-active', shuffleEnabled);
  elements.shuffleButton.setAttribute('aria-pressed', String(shuffleEnabled));
  elements.shuffleButton.setAttribute('aria-label', `Shuffle ${shuffleEnabled ? 'on' : 'off'}`);
  showToast(`Shuffle ${shuffleEnabled ? 'on' : 'off'}.`, 'info', 1800);
}

function cycleRepeatMode(): void {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  const label = repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off';
  elements.repeatButton.classList.toggle('is-active', repeatMode !== 'off');
  elements.repeatButton.classList.toggle('repeat-one', repeatMode === 'one');
  elements.repeatButton.setAttribute('aria-pressed', String(repeatMode !== 'off'));
  elements.repeatButton.setAttribute('aria-label', label);
  elements.repeatButton.title = label;
  elements.repeatOneIndicator.hidden = repeatMode !== 'one';
  showToast(`${label}.`, 'info', 1800);
}

async function toggleMicrophone(forceStart = false): Promise<void> {
  if (microphonePending) return;
  if (microphoneActive && !forceStart) {
    stopMicrophone(true);
    return;
  }

  microphonePending = true;
  elements.microphoneButton.disabled = true;
  elements.microphoneRetry.disabled = true;
  elements.microphoneStatus.hidden = true;
  elements.status.textContent = 'REQUESTING MICROPHONE';
  audio.pause();

  try {
    await audio.startMicrophone();
    visualizer.setAnalyser(audio.activeAnalyser());
    microphoneActive = true;
    microphonePreviousDisplay = {
      title: elements.title.textContent ?? 'Find your frequency',
      subtitle: elements.subtitle.textContent ?? 'Add a few tracks and let the sound take shape.',
    };
    elements.title.textContent = 'Listening live';
    elements.subtitle.textContent = 'Your room, in real time';
    elements.status.textContent = 'MICROPHONE LIVE';
    elements.microphoneStatus.hidden = true;
    updateMicrophoneButton();
    document.body.classList.add('is-listening');
    showToast('Microphone is live. Your audio stays on this device.', 'success', 2400);
  } catch (error: unknown) {
    const message = microphoneErrorMessage(error);
    elements.microphoneMessage.textContent = message;
    elements.microphoneStatus.hidden = false;
    elements.status.textContent = 'MICROPHONE UNAVAILABLE';
    elements.microphoneButton.setAttribute('aria-label', 'Retry microphone');
    elements.microphoneButton.title = 'Retry microphone access';
    showToast(message, 'error', 6500);
  } finally {
    microphonePending = false;
    elements.microphoneButton.disabled = false;
    elements.microphoneRetry.disabled = false;
  }
}

function stopMicrophone(showNotice = false): void {
  audio.stopMicrophone();
  visualizer.setAnalyser(audio.activeAnalyser());
  microphoneActive = false;
  document.body.classList.remove('is-listening');
  elements.microphoneStatus.hidden = true;
  if (microphonePreviousDisplay) {
    elements.title.textContent = microphonePreviousDisplay.title;
    elements.subtitle.textContent = microphonePreviousDisplay.subtitle;
    elements.status.textContent = currentTrackId ? 'PAUSED IN PLACE' : 'READY WHEN YOU ARE';
  } else {
    elements.status.textContent = currentTrackId ? 'PAUSED IN PLACE' : 'READY WHEN YOU ARE';
  }
  microphonePreviousDisplay = null;
  updateMicrophoneButton();
  renderAudioState(audio.getSnapshot());
  if (showNotice) showToast('Microphone disconnected.', 'info', 1800);
}

function updateMicrophoneButton(): void {
  elements.microphoneButton.classList.toggle('is-active', microphoneActive);
  elements.microphoneButton.setAttribute('aria-pressed', String(microphoneActive));
  elements.microphoneButton.setAttribute('aria-label', microphoneActive ? 'Stop microphone' : 'Start microphone');
  elements.microphoneButton.title = microphoneActive ? 'Stop microphone' : 'Listen through microphone';
}

function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone permission was blocked. Allow microphone access in your browser’s site settings, then select Try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Connect or enable a microphone, then try again.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is unavailable or already in use by another app. Close the other app and retry.';
  }
  if (name === 'OverconstrainedError') {
    return 'The selected microphone cannot provide the requested audio input. Check your device settings and retry.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Microphone access could not start. Check your browser permissions and try again.';
}

function renderScenePill(): void {
  elements.scenePill.textContent = SCENES[settings.get().scene].label;
}

function cycleScene(): void {
  const index = SCENE_IDS.indexOf(settings.get().scene);
  const next = SCENE_IDS[(index + 1) % SCENE_IDS.length] ?? SCENE_IDS[0];
  settings.update({ scene: next });
  showToast(`Background: ${SCENES[next].label}.`, 'info', 1800);
}

function cycleTheme(): void {
  const index = THEME_IDS.indexOf(settings.get().theme);
  const next = THEME_IDS[(index + 1) % THEME_IDS.length] ?? THEME_IDS[0];
  settings.update({ theme: next });
  showToast(`Theme: ${THEMES[next].name}.`, 'info', 1800);
}

function toggleMode(): void {
  const next: ModeSetting = currentPalette().mode === 'dark' ? 'light' : 'dark';
  settings.update({ mode: next });
  showToast(`${next === 'dark' ? 'Dark' : 'Light'} mode.`, 'info', 1800);
}

function clearPlaylist(): void {
  if (microphoneActive) stopMicrophone();
  elements.microphoneStatus.hidden = true;
  if (tracks.length === 0) return;
  tracks = [];
  currentTrackId = null;
  handledEndedTrackId = null;
  audio.unload();
  elements.title.textContent = 'Find your frequency';
  elements.subtitle.textContent = 'Add a few tracks and let the sound take shape.';
  elements.status.textContent = 'READY WHEN YOU ARE';
  elements.currentTime.textContent = '0:00';
  elements.totalTime.textContent = '0:00';
  elements.seekSlider.value = '0';
  renderPlaylist();
  renderAudioState(audio.getSnapshot());
  showToast('Your queue is clear. Add something good.', 'info');
}

function renderPlaylist(): void {
  playlist.render(tracks, currentTrackId);
  const activeIndex = tracks.findIndex((track) => track.id === currentTrackId);
  elements.previousButton.disabled = tracks.length === 0;
  elements.nextButton.disabled = tracks.length === 0;
  elements.playButton.disabled = tracks.length === 0;
  elements.seekSlider.disabled = tracks.length === 0;
  elements.shuffleButton.disabled = tracks.length < 2;
  elements.repeatButton.disabled = tracks.length === 0;
  elements.previousButton.title = activeIndex < 0 ? 'Previous track' : 'Previous track';
}

function renderAudioState(snapshot: AudioSnapshot): void {
  document.body.classList.toggle('is-playing', !snapshot.paused && currentTrackId !== null);
  document.body.classList.toggle('is-listening', microphoneActive);
  elements.playButton.classList.toggle('is-playing', !snapshot.paused && currentTrackId !== null);
  elements.playButton.setAttribute('aria-label', snapshot.paused ? 'Play' : 'Pause');
  elements.playButton.title = snapshot.paused ? 'Play' : 'Pause';
  renderVolume(snapshot.volume);
  elements.seekSlider.style.setProperty('--range-progress', `${snapshot.duration > 0 ? snapshot.currentTime / snapshot.duration * 100 : 0}%`);
  renderTimeline(snapshot);
}

function setVolume(value: number): void {
  const volume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  audio.setVolume(volume);
  saveVolume(volume);
  renderVolume(volume);
}

function renderVolume(value: number): void {
  const volume = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const percentage = Math.round(volume * 100);
  elements.volumeSlider.value = String(volume);
  elements.volumeSlider.style.setProperty('--range-progress', `${percentage}%`);
  elements.volumeValue.value = `${percentage}%`;
  elements.volumeValue.textContent = `${percentage}%`;
  elements.volumeValue.setAttribute('aria-label', `Volume ${percentage} percent`);
}

function renderTimeline(snapshot: AudioSnapshot): void {
  elements.currentTime.textContent = formatTime(snapshot.currentTime);
  elements.totalTime.textContent = formatTime(snapshot.duration);
  if (!isScrubbing) {
    const value = snapshot.duration > 0 ? snapshot.currentTime / snapshot.duration * Number(elements.seekSlider.max) : 0;
    elements.seekSlider.value = String(Math.round(value));
  }
  elements.seekSlider.style.setProperty('--range-progress', `${snapshot.duration > 0 ? snapshot.currentTime / snapshot.duration * 100 : 0}%`);
}

function persistPlaybackPosition(snapshot: AudioSnapshot, force: boolean): void {
  const track = getCurrentTrack();
  if (!track) return;
  const now = Date.now();
  if (!force && now - lastPersistedAt < 2000) return;
  lastPersistedAt = now;
  saveLastPlayback(track.name, snapshot.currentTime);
}

function getCurrentTrack(): Track | undefined {
  return tracks.find((track) => track.id === currentTrackId);
}

function waitForMetadata(timeoutMs: number): Promise<void> {
  if (audio.getSnapshot().duration > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    };
    const unsubscribe = audio.on('metadata', (snapshot) => {
      if (snapshot.duration > 0) finish();
    });
    const timeout = window.setTimeout(finish, timeoutMs);
  });
}

function showToast(message: string, type: 'success' | 'error' | 'info', durationMs = 3200): void {
  window.clearTimeout(pendingToastTimer);
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const marker = document.createElement('span');
  marker.className = 'toast-marker';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(marker, text);
  elements.toastRegion.replaceChildren(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  pendingToastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (toast.parentElement === elements.toastRegion) elements.toastRegion.replaceChildren();
    }, 220);
  }, durationMs);
}

function extensionFromPath(path: string): string | null {
  const filename = filenameFromPath(path);
  const extension = filename.split('.').pop()?.toLowerCase();
  return extension && AUDIO_EXTENSIONS.includes(extension as typeof AUDIO_EXTENSIONS[number]) ? extension : null;
}

function filenameFromPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // The URI may contain literal percent characters; keep the original value.
  }

  if (decoded.startsWith('content://')) {
    // SAF URIs usually include a document ID; only use it as a filename when it really has an audio extension.
    const possibleNames = decoded.split(/[/?#]/).reverse();
    return possibleNames.find((part) => hasAudioExtension(part)) ?? '';
  }

  const withoutQuery = decoded.split(/[?#]/)[0] ?? decoded;
  return withoutQuery.replace(/\\/g, '/').split('/').pop() ?? '';
}

function hasAudioExtension(filename: string): boolean {
  return /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(filename);
}

function detectAudioExtension(bytes: Uint8Array): string | null {
  if (bytes.length >= 12) {
    const ascii = (start: number, end: number): string => String.fromCharCode(...bytes.slice(start, end));
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav';
    if (ascii(0, 4) === 'fLaC') return 'flac';
    if (ascii(0, 4) === 'OggS') return 'ogg';
    if (ascii(4, 8) === 'ftyp') return 'm4a';
    if (ascii(0, 3) === 'ID3') return 'mp3';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    const second = bytes[1] ?? 0;
    return (second & 0xf6) === 0xf0 ? 'aac' : 'mp3';
  }
  return null;
}

function createId(): string {
  generatedId += 1;
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${random}-${generatedId}`;
}
