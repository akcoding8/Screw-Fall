import { CONFIG } from './config.js';

// Original, short oscillator phrases. Frequencies, shapes and envelopes can be
// replaced here later without coupling audio assets to gameplay or rendering.
const CUES = {
  purchase: [
    { frequency: 660, end: 784, duration: .14, volume: .12, type: 'sine' },
    { frequency: 988, duration: .2, delay: .045, volume: .09, type: 'sine' },
  ],
  purchasePremium: [
    { frequency: 523, duration: .2, volume: .1, type: 'sine' },
    { frequency: 784, duration: .23, delay: .04, volume: .11, type: 'sine' },
    { frequency: 1047, duration: .27, delay: .08, volume: .08, type: 'sine' },
  ],
  purchaseGold: [
    { frequency: 523, duration: .22, volume: .09, type: 'sine' },
    { frequency: 659, duration: .24, delay: .035, volume: .09, type: 'sine' },
    { frequency: 784, duration: .27, delay: .07, volume: .1, type: 'sine' },
    { frequency: 1047, duration: .31, delay: .105, volume: .07, type: 'sine' },
  ],
  bounce: [{ frequency: 330, end: 175, duration: 0.11, volume: 0.2, type: 'sine' }],
  pass: [{ frequency: 490, end: 690, duration: 0.095, volume: 0.14, type: 'sine' }],
  activate: [
    { frequency: 392, end: 440, duration: 0.15, volume: 0.19, type: 'triangle' },
    { frequency: 587, end: 660, duration: 0.18, delay: 0.065, volume: 0.17, type: 'sine' },
    { frequency: 880, duration: 0.22, delay: 0.12, volume: 0.13, type: 'sine' },
  ],
  smash: [
    { frequency: 145, end: 48, duration: 0.24, volume: 0.29, type: 'triangle' },
    { frequency: 320, end: 105, duration: 0.12, volume: 0.15, type: 'sine' },
  ],
  death: [
    { frequency: 260, end: 74, duration: 0.32, volume: 0.23, type: 'triangle' },
    { frequency: 172, end: 61, duration: 0.29, delay: 0.035, volume: 0.1, type: 'sine' },
  ],
  complete: [
    { frequency: 392, duration: 0.29, volume: 0.19, type: 'sine' },
    { frequency: 494, duration: 0.32, delay: 0.105, volume: 0.17, type: 'sine' },
    { frequency: 659, duration: 0.38, delay: 0.21, volume: 0.17, type: 'triangle' },
    { frequency: 784, duration: 0.42, delay: 0.315, volume: 0.13, type: 'sine' },
  ],
};

const CUE_VOLUMES = {
  purchase: ['purchaseVolume', .18],
  purchasePremium: ['purchaseVolume', .18],
  purchaseGold: ['purchaseVolume', .18],
  bounce: ['bounceVolume', 0.18],
  pass: ['passVolume', 0.17],
  activate: ['activationVolume', 0.26],
  smash: ['smashVolume', 0.36],
  death: ['deathVolume', 0.3],
  complete: ['completionVolume', 0.27],
};

export class SoundManager {
  constructor(muted = false) {
    this.muted = Boolean(muted);
    this.context = null;
    this.master = null;
    this.voices = new Set();
    this.disposed = false;
    this.masterVolume = CONFIG.audio?.masterVolume ?? 0.32;
  }

  /** Must be called synchronously from a user interaction on mobile Safari. */
  unlock() {
    if (this.disposed) return Promise.resolve(false);
    try {
      if (!this.context) {
        const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContext) return Promise.resolve(false);
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : this.masterVolume;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'running') return Promise.resolve(true);
      return Promise.resolve(this.context.resume())
        .then(() => !this.disposed && this.context?.state === 'running')
        .catch(() => false);
    } catch {
      // Audio permission or device availability never blocks the game.
      return Promise.resolve(false);
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.master || !this.context || this.disposed) return;
    try {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, now, 0.012);
    } catch { /* The audio device may have disconnected. */ }
  }

  play(name) {
    if (this.disposed || this.muted || this.context?.state !== 'running' || !CUES[name]) return;
    const [volumeKey, defaultVolume] = CUE_VOLUMES[name];
    const cueVolume = CONFIG.audio?.[volumeKey] ?? defaultVolume;
    for (const note of CUES[name]) this.playNote(note, cueVolume);
  }

  playNote(note, cueVolume) {
    if (this.voices.size >= (CONFIG.audio?.maxVoices ?? 24)) return;
    let oscillator;
    let gain;
    try {
      const context = this.context;
      const start = context.currentTime + (note.delay ?? 0);
      const end = start + note.duration;
      oscillator = context.createOscillator();
      gain = context.createGain();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.frequency, start);
      if (note.end) oscillator.frequency.exponentialRampToValueAtTime(note.end, end);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(Math.max(0.0001, note.volume * 4 * cueVolume), start + 0.007);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(this.master);
      const voice = { oscillator, gain };
      this.voices.add(voice);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        this.voices.delete(voice);
      };
      oscillator.start(start);
      oscillator.stop(end + 0.025);
    } catch {
      // A suspended/closed context can race with backgrounding the page.
      oscillator?.disconnect();
      gain?.disconnect();
      for (const voice of this.voices) {
        if (voice.oscillator === oscillator) this.voices.delete(voice);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { oscillator, gain } of this.voices) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch { /* Voice may have stopped already. */ }
      oscillator.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
    this.master?.disconnect();
    if (this.context) {
      try { Promise.resolve(this.context.close()).catch(() => {}); } catch { /* Already closed. */ }
    }
    this.context = null;
    this.master = null;
  }
}
