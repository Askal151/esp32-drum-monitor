/**
 * audio.js — Synthesized drum sounds via Web Audio API
 * Snare: white noise + bandpass filter + amplitude envelope
 * Kick:  sine oscillator dengan pitch sweep (200Hz → 50Hz)
 */

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── Snare ─────────────────────────────────────────────────────
// White noise burst + tone layer
export function playSnare(velocity = 1.0) {
  const ac  = getCtx();
  const now = ac.currentTime;
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  // Noise buffer
  const bufSize = ac.sampleRate * 0.2;
  const buf  = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  const noise  = ac.createBufferSource();
  noise.buffer = buf;

  // Bandpass filter — snare 'crack' character
  const bp = ac.createBiquadFilter();
  bp.type            = 'bandpass';
  bp.frequency.value = 3000;
  bp.Q.value         = 0.5;

  // Highpass — buang low rumble
  const hp = ac.createBiquadFilter();
  hp.type            = 'highpass';
  hp.frequency.value = 1000;

  // Noise envelope
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(vel * 0.8, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  // Tone layer (body snare)
  const osc = ac.createOscillator();
  osc.type            = 'triangle';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.06);

  const toneGain = ac.createGain();
  toneGain.gain.setValueAtTime(vel * 0.5, now);
  toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  // Master gain
  const master = ac.createGain();
  master.gain.value = 0.7;

  // Route: noise → bp → hp → noiseGain → master → destination
  noise.connect(bp); bp.connect(hp); hp.connect(noiseGain); noiseGain.connect(master);
  // Route: osc → toneGain → master → destination
  osc.connect(toneGain); toneGain.connect(master);
  master.connect(ac.destination);

  noise.start(now); noise.stop(now + 0.2);
  osc.start(now);   osc.stop(now + 0.1);
}

// ── Kick ──────────────────────────────────────────────────────
// Sine oscillator pitch sweep + low thump
export function playKick(velocity = 1.0) {
  const ac  = getCtx();
  const now = ac.currentTime;
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  // Main kick oscillator
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);

  // Click transient
  const click = ac.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(1200, now);
  click.frequency.exponentialRampToValueAtTime(200, now + 0.02);

  const clickGain = ac.createGain();
  clickGain.gain.setValueAtTime(vel * 0.3, now);
  clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

  // Kick envelope
  const kickGain = ac.createGain();
  kickGain.gain.setValueAtTime(vel * 1.2, now);
  kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  // Low pass filter untuk warm thump
  const lp = ac.createBiquadFilter();
  lp.type            = 'lowpass';
  lp.frequency.value = 200;

  // Distortion / waveshaper untuk punch
  const wave = ac.createWaveShaper();
  wave.curve = makeDistCurve(120);

  // Master
  const master = ac.createGain();
  master.gain.value = 0.85;

  osc.connect(kickGain); kickGain.connect(wave); wave.connect(lp); lp.connect(master);
  click.connect(clickGain); clickGain.connect(master);
  master.connect(ac.destination);

  osc.start(now);   osc.stop(now + 0.45);
  click.start(now); click.stop(now + 0.03);
}

function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Unlock AudioContext dengan user gesture pertama
export function unlockAudio() {
  getCtx();
}
