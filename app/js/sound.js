/**
 * Sound effects synthesised with the Web Audio API.
 *
 * No audio files: the whole hub stays a handful of text files, works offline,
 * and never waits on a download to give feedback. Browsers require a user
 * gesture before audio starts, so the context is created lazily on first play.
 */

let ctx = null;
let enabled = true;
let master = null;

function ensure() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.gain.value = 0.22;
  master.connect(ctx.destination);
  return ctx;
}

/** A single shaped tone. */
function tone({ freq = 440, type = 'sine', dur = 0.12, gain = 1, delay = 0, slideTo = null }) {
  const audio = ensure();
  if (!audio || !enabled) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});

  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), start + dur);

  // A short attack and an exponential tail keeps clicks out of the speaker.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise({ dur = 0.15, gain = 0.5, delay = 0, filterHz = 1200 }) {
  const audio = ensure();
  if (!audio || !enabled) return;
  const frames = Math.floor(audio.sampleRate * dur);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterHz;
  const env = audio.createGain();
  env.gain.value = gain;

  src.connect(filter);
  filter.connect(env);
  env.connect(master);
  src.start(audio.currentTime + delay);
}

export const sound = {
  setEnabled(value) {
    enabled = Boolean(value);
  },
  get enabled() {
    return enabled;
  },

  /** Called from a click handler so the browser lets us make noise later. */
  unlock() {
    const audio = ensure();
    if (audio?.state === 'suspended') audio.resume().catch(() => {});
  },

  place: () => tone({ freq: 420, type: 'triangle', dur: 0.07, gain: 0.5 }),
  drop: () => tone({ freq: 300, type: 'triangle', dur: 0.13, gain: 0.55, slideTo: 150 }),
  flip: () => tone({ freq: 620, type: 'sine', dur: 0.1, gain: 0.4, slideTo: 880 }),
  click: () => tone({ freq: 900, type: 'square', dur: 0.035, gain: 0.18 }),
  select: () => tone({ freq: 660, type: 'sine', dur: 0.06, gain: 0.3 }),

  correct: () => {
    tone({ freq: 660, type: 'sine', dur: 0.1, gain: 0.5 });
    tone({ freq: 990, type: 'sine', dur: 0.16, gain: 0.45, delay: 0.08 });
  },
  wrong: () => tone({ freq: 200, type: 'sawtooth', dur: 0.22, gain: 0.35, slideTo: 110 }),

  hit: () => {
    noise({ dur: 0.22, gain: 0.55, filterHz: 900 });
    tone({ freq: 140, type: 'sine', dur: 0.2, gain: 0.5, slideTo: 60 });
  },
  miss: () => noise({ dur: 0.16, gain: 0.28, filterHz: 500 }),
  boom: () => {
    noise({ dur: 0.5, gain: 0.75, filterHz: 700 });
    tone({ freq: 90, type: 'sawtooth', dur: 0.4, gain: 0.5, slideTo: 40 });
  },

  eat: () => tone({ freq: 720, type: 'square', dur: 0.05, gain: 0.28, slideTo: 1080 }),
  merge: () => tone({ freq: 520, type: 'triangle', dur: 0.09, gain: 0.34, slideTo: 780 }),

  go: () => tone({ freq: 880, type: 'sine', dur: 0.14, gain: 0.6 }),
  tick: () => tone({ freq: 1200, type: 'sine', dur: 0.03, gain: 0.12 }),

  start: () => {
    [523, 659, 784].forEach((freq, i) => tone({ freq, type: 'sine', dur: 0.16, gain: 0.42, delay: i * 0.09 }));
  },
  win: () => {
    [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, type: 'sine', dur: 0.26, gain: 0.5, delay: i * 0.11 }));
  },
  lose: () => {
    [440, 370, 294].forEach((freq, i) => tone({ freq, type: 'triangle', dur: 0.3, gain: 0.4, delay: i * 0.14 }));
  },
  draw: () => {
    [494, 494].forEach((freq, i) => tone({ freq, type: 'sine', dur: 0.22, gain: 0.38, delay: i * 0.18 }));
  },
  notify: () => {
    tone({ freq: 880, type: 'sine', dur: 0.09, gain: 0.34 });
    tone({ freq: 1175, type: 'sine', dur: 0.13, gain: 0.3, delay: 0.09 });
  },
};
