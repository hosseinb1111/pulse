export interface AudioSnapshot {
  currentTime: number;
  duration: number;
  volume: number;
  paused: boolean;
  ended: boolean;
  ready: boolean;
}

export type AudioEventName = 'time' | 'state' | 'metadata' | 'error';
export type AudioEventListener = (snapshot: AudioSnapshot, errorMessage?: string) => void;

export class AudioEngine {
  readonly element: HTMLAudioElement;
  readonly analyser: AnalyserNode;
  /** Input-only analyser for microphone capture; it is never connected to the audio destination. */
  readonly microphoneAnalyser: AnalyserNode;
  readonly audioContext: AudioContext;

  private readonly source: MediaElementAudioSourceNode;
  private readonly listeners = new Map<AudioEventName, Set<AudioEventListener>>();
  private activeObjectUrl: string | null = null;
  private microphoneStream: MediaStream | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private ready = false;
  private disposed = false;

  constructor(initialVolume: number) {
    this.element = new Audio();
    this.element.preload = 'metadata';
    this.element.volume = clamp(initialVolume, 0, 1);
    this.element.crossOrigin = 'anonymous';

    const AudioContextClass = window.AudioContext;
    this.audioContext = new AudioContextClass();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -12;

    this.microphoneAnalyser = this.audioContext.createAnalyser();
    this.microphoneAnalyser.fftSize = 2048;
    this.microphoneAnalyser.smoothingTimeConstant = 0.5;
    this.microphoneAnalyser.minDecibels = -90;
    this.microphoneAnalyser.maxDecibels = -12;

    this.source = this.audioContext.createMediaElementSource(this.element);
    this.source.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    this.element.addEventListener('timeupdate', () => this.emit('time'));
    this.element.addEventListener('durationchange', () => this.emit('metadata'));
    this.element.addEventListener('loadedmetadata', () => {
      this.ready = true;
      this.emit('metadata');
      this.emit('state');
    });
    this.element.addEventListener('canplay', () => {
      this.ready = true;
      this.emit('state');
    });
    this.element.addEventListener('play', () => this.emit('state'));
    this.element.addEventListener('pause', () => this.emit('state'));
    this.element.addEventListener('ended', () => this.emit('state'));
    this.element.addEventListener('volumechange', () => this.emit('state'));
    this.element.addEventListener('error', () => {
      const code = this.element.error?.code;
      const message = code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'This audio format is not supported by this device.'
        : code === MediaError.MEDIA_ERR_DECODE
          ? 'This audio file could not be decoded. It may be damaged or use an unsupported codec.'
          : 'The audio file could not be opened.';
      this.ready = false;
      this.emit('error', message);
    });
  }

  on(eventName: AudioEventName, listener: AudioEventListener): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<AudioEventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return () => listeners.delete(listener);
  }

  getSnapshot(): AudioSnapshot {
    const duration = this.element.duration;
    return {
      currentTime: finiteNonNegative(this.element.currentTime),
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      volume: this.element.volume,
      paused: this.element.paused,
      ended: this.element.ended,
      ready: this.ready,
    };
  }

  async load(file: File): Promise<void> {
    this.pause();
    this.ready = false;
    this.revokeActiveUrl();

    this.activeObjectUrl = URL.createObjectURL(file);
    this.element.src = this.activeObjectUrl;
    this.element.load();
    this.emit('state');

    // AudioContext is commonly suspended until the user interacts with the app.
    await this.resumeContext();
  }

  async play(): Promise<void> {
    if (!this.element.src) throw new Error('Add a track to your library before pressing play.');
    await this.resumeContext();
    try {
      await this.element.play();
    } catch (error: unknown) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') {
        throw new Error('Playback was blocked by the device. Tap Play again to start the audio.');
      }
      if (name === 'NotSupportedError') {
        throw new Error('This device cannot play the selected audio format.');
      }
      throw new Error('Playback could not start. Try another track or check the audio file.');
    }
  }

  pause(): void {
    this.element.pause();
  }

  unload(): void {
    this.pause();
    this.ready = false;
    this.element.removeAttribute('src');
    this.element.load();
    this.revokeActiveUrl();
    this.emit('state');
    this.emit('time');
  }

  async togglePlayback(): Promise<void> {
    if (this.element.paused) {
      await this.play();
    } else {
      this.pause();
    }
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const duration = this.element.duration;
    const target = Number.isFinite(duration) && duration > 0
      ? clamp(seconds, 0, duration)
      : Math.max(0, seconds);
    try {
      this.element.currentTime = target;
      this.emit('time');
    } catch {
      // Some formats do not expose a seekable timeline until metadata is ready.
    }
  }

  setVolume(volume: number): void {
    this.element.volume = clamp(volume, 0, 1);
  }

  async resumeContext(): Promise<void> {
    if (this.disposed || this.audioContext.state === 'running') return;
    try {
      await this.audioContext.resume();
    } catch {
      // The next explicit user gesture will retry resuming the context.
    }
  }

  /** Connects a live microphone to the analyser only (never to the speakers). */
  async startMicrophone(): Promise<void> {
    if (this.disposed) throw new Error('The audio engine has already been closed.');
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access is unavailable. Open Pulse on localhost or a secure HTTPS connection in a supported browser.');
    }
    if (this.microphoneStream?.getAudioTracks().some((track) => track.readyState === 'live')) return;

    await this.resumeContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    try {
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.microphoneAnalyser);
      this.microphoneStream = stream;
      this.microphoneSource = source;
    } catch (error: unknown) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  /** Stops capture immediately and releases the browser's microphone indicator. */
  stopMicrophone(): void {
    this.microphoneSource?.disconnect();
    this.microphoneSource = null;
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
  }

  isMicrophoneActive(): boolean {
    return Boolean(this.microphoneStream?.getAudioTracks().some((track) => track.readyState === 'live'));
  }

  /** The analyser the visualizer should currently read. */
  activeAnalyser(): AnalyserNode {
    return this.isMicrophoneActive() ? this.microphoneAnalyser : this.analyser;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.pause();
    this.stopMicrophone();
    this.element.removeAttribute('src');
    this.element.load();
    this.revokeActiveUrl();
    this.source.disconnect();
    this.analyser.disconnect();
    this.microphoneAnalyser.disconnect();
    this.listeners.clear();
    void this.audioContext.close().catch(() => undefined);
  }

  private emit(eventName: AudioEventName, errorMessage?: string): void {
    const snapshot = this.getSnapshot();
    this.listeners.get(eventName)?.forEach((listener) => listener(snapshot, errorMessage));
  }

  private revokeActiveUrl(): void {
    if (!this.activeObjectUrl) return;
    URL.revokeObjectURL(this.activeObjectUrl);
    this.activeObjectUrl = null;
  }
}

export async function probeDuration(file: File, timeoutMs = 8000): Promise<number | null> {
  const url = URL.createObjectURL(file);
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = url;

  return new Promise<number | null>((resolve) => {
    let settled = false;
    const finish = (duration: number | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      probe.removeAttribute('src');
      probe.load();
      URL.revokeObjectURL(url);
      resolve(duration);
    };

    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    probe.addEventListener('loadedmetadata', () => {
      finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
    }, { once: true });
    probe.addEventListener('error', () => finish(null), { once: true });
    probe.load();
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
