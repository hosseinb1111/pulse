import type { AudioFrame } from '../analysis';
import type { CharacterVibe } from '../settings';

export type CharacterState =
  | 'idle'
  | 'relaxed'
  | 'listening'
  | 'enjoying'
  | 'grooving'
  | 'excited'
  | 'thoughtful'
  | 'sleepy'
  | 'reacting'
  | 'recovering';

export type MusicStyle = 'ambient' | 'lofi' | 'groove' | 'upbeat' | 'intense' | 'cinematic' | 'electronic';

export type CharacterEmotion =
  | 'neutral'
  | 'relaxed'
  | 'happy'
  | 'subtle-smile'
  | 'excited'
  | 'curious'
  | 'thoughtful'
  | 'sleepy'
  | 'sad'
  | 'surprised'
  | 'confused'
  | 'annoyed'
  | 'focused';

export interface CharacterDrive {
  state: CharacterState;
  style: MusicStyle;
  emotion: CharacterEmotion;
  active: boolean;
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  snap: number;
  bpm: number | null;
  tempoConfidence: number;
  rhythmRegularity: number;
  transition: 'none' | 'build' | 'drop';
  transitionStrength: number;
}

const STYLE_FOR_OVERRIDE: Record<Exclude<CharacterVibe, 'auto'>, MusicStyle> = {
  ambient: 'ambient',
  lofi: 'lofi',
  funk: 'groove',
  pop: 'upbeat',
  rock: 'intense',
  classical: 'cinematic',
  electronic: 'electronic',
};

const STATE_LABELS: Record<CharacterState, string> = {
  idle: 'AT REST',
  relaxed: 'RELAXED',
  listening: 'LISTENING',
  enjoying: 'ENJOYING',
  grooving: 'GROOVING',
  excited: 'ENERGIZED',
  thoughtful: 'THOUGHTFUL',
  sleepy: 'DOZING',
  reacting: 'REACTING',
  recovering: 'SETTLING',
};

const STYLE_LABELS: Record<MusicStyle, string> = {
  ambient: 'AMBIENT',
  lofi: 'LO-FI',
  groove: 'GROOVE',
  upbeat: 'UPBEAT',
  intense: 'INTENSE',
  cinematic: 'CINEMATIC',
  electronic: 'ELECTRONIC',
};

export function stateLabel(state: CharacterState): string {
  return STATE_LABELS[state];
}

export function styleLabel(style: MusicStyle): string {
  return STYLE_LABELS[style];
}

/**
 * Converts Pulse's existing smoothed FFT/onset frame into a stable movement profile.
 * This is intentionally a vibe/energy estimator, not a genre classifier.
 */
export class MusicBehaviorController {
  private elapsed = 0;
  private previousRawEnergy = 0;
  private energy = 0;
  private bass = 0;
  private mid = 0;
  private treble = 0;
  private previousBeat = 0;
  private lastBeatAt = -10;
  private beatIntervals: number[] = [];
  private beatEnvelope = 0;
  private tempo = { bpm: null as number | null, confidence: 0, regularity: 0 };
  private transitionCooldown = 0;
  private transitionStrength = 0;
  private transition: CharacterDrive['transition'] = 'none';
  private state: CharacterState = 'idle';
  private stateAge = 0;
  private inactiveAge = 0;
  private playingBefore = false;
  private listeningAge = 0;

  update(frame: AudioFrame, dt: number, sourceActive: boolean, override: CharacterVibe): CharacterDrive {
    const step = Math.min(0.05, Math.max(0.001, dt));
    this.elapsed += step;
    this.stateAge += step;
    this.transitionCooldown = Math.max(0, this.transitionCooldown - step);
    this.transitionStrength *= Math.exp(-step * 2.8);
    if (this.transitionStrength < 0.025) this.transition = 'none';

    const active = sourceActive && frame.active && frame.level > 0.018;
    const rawEnergy = active ? clamp(frame.level * 0.72 + frame.bass * 0.28, 0, 1) : 0;
    const attack = rawEnergy > this.energy ? 5.5 : 1.75;
    this.energy += (rawEnergy - this.energy) * (1 - Math.exp(-step * attack));
    this.bass += ((active ? frame.bass : 0) - this.bass) * (1 - Math.exp(-step * (active ? 7 : 2)));
    this.mid += ((active ? frame.mid : 0) - this.mid) * (1 - Math.exp(-step * (active ? 5 : 1.8)));
    this.treble += ((active ? frame.treble : 0) - this.treble) * (1 - Math.exp(-step * (active ? 5 : 1.8)));

    if (active && !this.playingBefore) {
      this.listeningAge = 0;
      // A real pause is a clean boundary for tempo estimation; brief dropouts do not reset it.
      if (this.inactiveAge > 2) {
        this.beatIntervals.length = 0;
        this.tempo = { bpm: null, confidence: 0, regularity: 0 };
        this.lastBeatAt = -10;
        this.previousBeat = 0;
      }
    }
    if (active) {
      this.inactiveAge = 0;
      this.listeningAge += step;
    } else {
      this.inactiveAge += step;
      this.listeningAge = 0;
    }
    this.playingBefore = active;

    const beatEdge = active && frame.beat > 0.78 && this.previousBeat <= 0.78;
    this.previousBeat = frame.beat;
    if (beatEdge && this.elapsed - this.lastBeatAt > 0.20) {
      const interval = this.elapsed - this.lastBeatAt;
      if (this.lastBeatAt > 0 && interval >= 0.30 && interval <= 1.5) {
        this.beatIntervals.push(interval);
        if (this.beatIntervals.length > 8) this.beatIntervals.shift();
        this.tempo = this.estimateTempo();
      }
      this.lastBeatAt = this.elapsed;
      this.beatEnvelope = 1;
    } else {
      this.beatEnvelope *= Math.exp(-step * 7.5);
    }

    const tempo = this.tempo;
    // Detect structural changes against the unsmoothed envelope. The displayed movement
    // energy remains filtered, but filtering it first would erase the very drops we want to catch.
    const rawEnergyDelta = rawEnergy - this.previousRawEnergy;
    if (this.transitionCooldown <= 0 && active) {
      if (this.previousRawEnergy > 0.42 && rawEnergyDelta < -0.30) {
        this.transition = 'drop';
        this.transitionStrength = clamp(Math.abs(rawEnergyDelta) * 1.5, 0.35, 1);
        this.transitionCooldown = 1.8;
      } else if (rawEnergyDelta > 0.32 && rawEnergy > 0.48) {
        this.transition = 'build';
        this.transitionStrength = clamp(rawEnergyDelta * 1.6, 0.25, 0.85);
        this.transitionCooldown = 1.5;
      }
    }
    this.previousRawEnergy = rawEnergy;

    const style = override === 'auto' ? this.estimateStyle(this.energy, tempo.bpm, tempo.regularity) : STYLE_FOR_OVERRIDE[override];
    const desired = this.chooseState(active, style, this.energy);
    this.transitionState(desired);

    const emotion = this.chooseEmotion(style, this.state, active);
    return {
      state: this.state,
      style,
      emotion,
      active,
      energy: this.energy,
      bass: this.bass,
      mid: this.mid,
      treble: this.treble,
      beat: Math.max(this.beatEnvelope, active ? frame.beat * 0.68 : 0),
      snap: active ? frame.snap : 0,
      bpm: tempo.bpm,
      tempoConfidence: tempo.confidence,
      rhythmRegularity: tempo.regularity,
      transition: this.transition,
      transitionStrength: this.transitionStrength,
    };
  }

  reset(): void {
    this.elapsed = 0;
    this.previousRawEnergy = 0;
    this.energy = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.previousBeat = 0;
    this.lastBeatAt = -10;
    this.beatIntervals = [];
    this.beatEnvelope = 0;
    this.tempo = { bpm: null, confidence: 0, regularity: 0 };
    this.transitionCooldown = 0;
    this.transitionStrength = 0;
    this.transition = 'none';
    this.state = 'idle';
    this.stateAge = 0;
    this.inactiveAge = 0;
    this.playingBefore = false;
    this.listeningAge = 0;
  }

  private estimateTempo(): { bpm: number | null; confidence: number; regularity: number } {
    if (this.beatIntervals.length < 3) return { bpm: null, confidence: 0, regularity: 0 };
    const sorted = [...this.beatIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median <= 0) return { bpm: null, confidence: 0, regularity: 0 };
    const mean = this.beatIntervals.reduce((sum, value) => sum + value, 0) / this.beatIntervals.length;
    const variance = this.beatIntervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / this.beatIntervals.length;
    const coefficient = Math.sqrt(variance) / Math.max(mean, 0.001);
    const regularity = clamp(1 - coefficient * 2.4, 0, 1);
    let bpm = 60 / median;
    // Correct the most common half/double-time ambiguities without claiming exact tempo detection.
    if (bpm < 68) bpm *= 2;
    if (bpm > 160) bpm *= 0.5;
    return {
      bpm: clamp(bpm, 50, 180),
      confidence: regularity * Math.min(1, this.beatIntervals.length / 6),
      regularity,
    };
  }

  private estimateStyle(energy: number, bpm: number | null, regularity: number): MusicStyle {
    if (energy < 0.15) return 'ambient';
    if (energy > 0.73) return bpm !== null && bpm > 126 ? 'intense' : 'upbeat';
    // A steady mid-tempo pulse is treated as a groove-like movement cue, not a genre label.
    if (bpm !== null && bpm >= 78 && bpm <= 126 && regularity > 0.54 && energy > 0.28) return 'groove';
    if (bpm !== null && bpm > 126 && energy > 0.42) return 'electronic';
    if (bpm !== null && bpm > 112 && energy > 0.42) return 'upbeat';
    if (energy < 0.36) return 'lofi';
    return 'cinematic';
  }

  private chooseState(active: boolean, style: MusicStyle, energy: number): CharacterState {
    if (!active) return this.inactiveAge > 75 ? 'sleepy' : 'idle';

    // Give a drop its own short reaction, then a bounded settling phase. These
    // age checks are deliberately finite so the controller always returns to
    // the track's ordinary movement state instead of getting stuck recovering.
    if (this.transition === 'drop' && this.transitionStrength > 0.38) return 'reacting';
    if (this.state === 'reacting' && this.stateAge < 0.48) return 'reacting';
    if (this.state === 'reacting' || (this.state === 'recovering' && this.stateAge < 1.15)) return 'recovering';
    if (this.listeningAge < 0.9) return 'listening';
    if (energy < 0.14 || style === 'ambient') return 'relaxed';
    if (style === 'cinematic') return 'thoughtful';
    if (style === 'groove' && energy > 0.24) return 'grooving';
    if ((style === 'upbeat' || style === 'intense' || style === 'electronic') && energy > 0.48) return 'excited';
    if (style === 'lofi') return 'enjoying';
    return 'enjoying';
  }

  private transitionState(desired: CharacterState): void {
    if (this.state === 'reacting' && this.stateAge < 0.48) return;
    if (desired === this.state) return;
    const urgent = desired === 'reacting' || this.state === 'idle' || this.state === 'sleepy';
    if (!urgent && this.stateAge < 1.15) return;
    this.state = desired;
    this.stateAge = 0;
  }

  private chooseEmotion(style: MusicStyle, state: CharacterState, active: boolean): CharacterEmotion {
    if (!active) return state === 'sleepy' ? 'sleepy' : 'neutral';
    if (state === 'reacting') return 'surprised';
    if (state === 'recovering') return 'thoughtful';
    if (state === 'listening') return 'curious';
    if (state === 'relaxed') return 'relaxed';
    if (state === 'thoughtful') return 'thoughtful';
    if (state === 'grooving') return 'happy';
    if (state === 'excited') return 'excited';
    if (style === 'intense') return 'focused';
    if (style === 'ambient') return 'relaxed';
    return 'subtle-smile';
  }
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
