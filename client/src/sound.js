// Audio for the app: the Amharic bingo caller (recorded/generated clips) and small synthesized
// sound effects (no audio files to download). Uses Web Audio so clips play instantly once loaded.
//
// Phones only allow sound after the player has touched the screen, so the audio engine is
// unlocked on the first tap anywhere in the app.

import { lowData as lowDataOn } from './prefs.js';

let ctx = null;
const buffers = new Map(); // url -> Promise<AudioBuffer>
const settings = {
  voice: read('snd_voice', true),
  effects: read('snd_fx', true),
};
const listeners = new Set();

function read(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } }
function write(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Unlock on the first touch/click
const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock, true); };
window.addEventListener('pointerdown', unlock, true);

export const soundSettings = () => ({ ...settings });
export function setSound(key, on) {
  settings[key] = !!on;
  write(key === 'voice' ? 'snd_voice' : 'snd_fx', !!on);
  listeners.forEach((f) => f());
}
export function onSoundChange(f) { listeners.add(f); return () => listeners.delete(f); }

function load(url) {
  if (!buffers.has(url)) {
    const p = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((b) => new Promise((res, rej) => audio().decodeAudioData(b, res, rej)));
    p.catch(() => buffers.delete(url)); // retry next time if the network failed
    buffers.set(url, p);
  }
  return buffers.get(url);
}

let voiceGain = null;
let current = null;
/** Bingo caller: says the number in Amharic (e.g. 54 → "ጂ ሃምሳ አራት"). */
export async function callNumber(n) {
  if (!settings.voice || !audio()) return;
  try {
    const buf = await load(`/voice/am/${n}.mp3`);
    const c = audio();
    if (!voiceGain) { voiceGain = c.createGain(); voiceGain.gain.value = 1; voiceGain.connect(c.destination); }
    try { current?.stop(); } catch { /* already stopped */ }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(voiceGain);
    src.start();
    current = src;
  } catch { /* offline or blocked: the number is still shown on screen */ }
}

/** Warm the cache for a few numbers (e.g. while waiting for the game to start). */
export function preloadCalls(numbers) {
  if (!settings.voice || lowDataOn()) return;
  for (const n of numbers) load(`/voice/am/${n}.mp3`).catch(() => {});
}

// ---------------- synthesized effects ----------------
function tone({ freq = 440, type = 'sine', dur = 0.12, vol = 0.18, slide = 0, delay = 0 }) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function noise({ dur = 0.08, vol = 0.25, freq = 1800, delay = 0 }) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const s = c.createBufferSource();
  s.buffer = b;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination);
  s.start(t);
}

const FX = {
  tap: () => tone({ freq: 660, dur: 0.05, vol: 0.08 }),
  pick: () => { tone({ freq: 520, dur: 0.07, vol: 0.12 }); tone({ freq: 780, dur: 0.09, vol: 0.12, delay: 0.06 }); },
  ball: () => noise({ dur: 0.05, vol: 0.5, freq: 2500 }),           // ball–ball click
  thud: () => noise({ dur: 0.12, vol: 0.4, freq: 300 }),            // cushion / dice landing
  pin: () => { noise({ dur: 0.18, vol: 0.5, freq: 1200 }); tone({ freq: 300, dur: 0.15, vol: 0.08, slide: -150 }); },
  dice: () => { for (let i = 0; i < 4; i++) noise({ dur: 0.04, vol: 0.35, freq: 1500 + i * 300, delay: i * 0.06 }); },
  cash: () => { tone({ freq: 880, dur: 0.08 }); tone({ freq: 1320, dur: 0.14, delay: 0.07 }); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.18, vol: 0.16, delay: i * 0.11, type: 'triangle' })),
  lose: () => { tone({ freq: 392, dur: 0.2, type: 'triangle', vol: 0.12 }); tone({ freq: 311, dur: 0.3, type: 'triangle', vol: 0.12, delay: 0.18 }); },
  crash: () => { noise({ dur: 0.35, vol: 0.5, freq: 400 }); tone({ freq: 220, dur: 0.4, slide: -160, type: 'sawtooth', vol: 0.06 }); },
  turn: () => tone({ freq: 990, dur: 0.1, vol: 0.1 }),
  bingo: () => [784, 988, 1175, 1568].forEach((f, i) => tone({ freq: f, dur: 0.14, vol: 0.14, delay: i * 0.08, type: 'square' })),
};

/** Play a short effect by name (no-op when effects are off). */
export function sfx(name) {
  if (!settings.effects) return;
  try { FX[name]?.(); } catch { /* audio unavailable */ }
}
