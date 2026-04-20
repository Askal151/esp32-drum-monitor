/**
 * audio.js — Sustained drum sounds via Web Audio API
 * Bunyi bermain SELAMA sensor mengesan magnet (LED > 0)
 * Berhenti bila LED = 0
 *
 * Snare (S1): noise buzz + mid tone (snare rattle)
 * Kick  (S2): low sine drone + sub rumble
 */

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// Kill gain per sensor — putus dari destination untuk henti serta-merta
const _sensorKillGains = new Map();
// Registry source nodes per sensor — untuk cleanup dan backup stop
const _wavRegistry = new Map();

function _getKillGain(sensorKey) {
  if (!_sensorKillGains.has(sensorKey)) {
    const ac = getCtx();
    const g = ac.createGain();
    g.connect(ac.destination);
    _sensorKillGains.set(sensorKey, g);
  }
  return _sensorKillGains.get(sensorKey);
}

export function stopWavSources(sensorKey) {
  const ac = getCtx();

  // Layer 1: kill gain zeroed + disconnected
  const kg = _sensorKillGains.get(sensorKey);
  if (kg) {
    try { kg.gain.cancelScheduledValues(ac.currentTime); } catch {}
    try { kg.gain.setValueAtTime(0, ac.currentTime); } catch {}
    try { kg.disconnect(); } catch {}
    _sensorKillGains.delete(sensorKey);
  }
  // Layer 2: setiap source dan gain-nya diputus terus
  const sources = _wavRegistry.get(sensorKey);
  if (sources?.size) {
    for (const { src, gain } of [...sources]) {
      try { src.disconnect(); gain.disconnect(); } catch {}
      try { src.stop(); } catch {}
    }
    sources.clear();
  }
}

// ── Looping WAV untuk uploaded samples (sensor-triggered) ─────
const _loopingWavs = new Map(); // sensorKey → { src, gain }

export function startWavLoop(audioBuffer, sensorKey) {
  stopWavLoop(sensorKey);
  const ac = getCtx();
  const src  = ac.createBufferSource();
  src.buffer = audioBuffer;
  src.loop   = true;
  src.playbackRate.value = 1.0;
  const gain = ac.createGain();
  gain.gain.value = 1.0;
  src.connect(gain);
  gain.connect(ac.destination);
  src.start();
  _loopingWavs.set(sensorKey, { src, gain });
  return src;
}

export function stopWavLoop(sensorKey) {
  const entry = _loopingWavs.get(sensorKey);
  if (!entry) return;
  const ac = getCtx();
  try { entry.gain.gain.setValueAtTime(0, ac.currentTime); } catch {}
  try { entry.src.stop(); } catch {}
  try { entry.src.disconnect(); entry.gain.disconnect(); } catch {}
  _loopingWavs.delete(sensorKey);
}

// ── Preview player (Upload panel) ─────────────────────────────
// Managed entirely here as module-level state — no Svelte involvement
let _previewGain = null;
let _previewSrc  = null;

function _getPreviewGain() {
  const ac = getCtx();
  if (!_previewGain) {
    _previewGain = ac.createGain();
    _previewGain.gain.value = 0;
    _previewGain.connect(ac.destination);
  }
  return _previewGain;
}

export function stopPreviewBuffer() {
  if (_previewGain) _previewGain.gain.value = 0;
  if (_previewSrc) {
    try { _previewSrc.stop(); } catch {}
    _previewSrc = null;
  }
}

// Load WAV dari URL lalu main melalui preview gain (stoppable)
export async function previewWavUrl(url) {
  const buf = await _loadWav(url);
  startPreviewBuffer(buf);
}

// Returns the src node so caller can attach onended
export function startPreviewBuffer(audioBuffer) {
  stopPreviewBuffer();
  const ac = getCtx();
  const pg = _getPreviewGain();
  pg.gain.value = 1.0;
  const src = ac.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(pg);
  _previewSrc = src;
  src.onended = () => { if (_previewSrc === src) _previewSrc = null; };
  src.start();
  return src;
}

// Helper: apply pitch rate to frequency
const fr = (freq, rate) => freq * Math.max(0.25, Math.min(4.0, rate || 1.0));

// ── Cleanup helper — disconnect semua nodes selepas bunyi selesai ──
// Tanpa ini, nodes terkumpul dalam audio graph → crash selepas ~1 minit
function schedCleanup(nodes, maxDurSec) {
  setTimeout(() => {
    for (const n of nodes) { try { n.disconnect(); } catch {} }
  }, Math.ceil(maxDurSec * 1000) + 200);
}

// ── Cached noise buffers — elak allocate buffer baru setiap hit ──
const _noiseCacheMap = new Map();
function getCachedNoise(ac, size) {
  if (_noiseCacheMap.has(size)) return _noiseCacheMap.get(size);
  const buf = ac.createBuffer(1, size, ac.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  _noiseCacheMap.set(size, buf);
  return buf;
}

// Pastikan AudioContext dalam state 'running' — await ini sebelum schedule
export async function ensureRunning() {
  const ac = getCtx();
  if (ac.state !== 'running') await ac.resume();
  return ac;
}

export function isRunning() {
  return ctx?.state === 'running';
}

// ── Synth untuk Sensor 2 ───────────────────────────────────────
// Nota mengikut LED level 1-4 (pentatonic C major)
const SYNTH_NOTES = [0, 130.81, 164.81, 196.00, 246.94]; // C3 E3 G3 B3

let _synth = null;   // node aktif synth

export async function startSynth(ledLevel = 1, velocity = 0.8) {
  const ac  = await ensureRunning();
  const vel = Math.max(0.1, Math.min(1.0, velocity));
  const freq = SYNTH_NOTES[Math.max(1, Math.min(4, ledLevel))];

  // Hentikan synth lama jika ada
  if (_synth) { _stopSynthNodes(0); }

  // Reverb buffer (simple convolution reverb)
  const reverbBuf = _makeReverbBuf(ac, 1.5);
  const reverb    = ac.createConvolver();
  reverb.buffer   = reverbBuf;

  const reverbGain = ac.createGain();
  reverbGain.gain.value = 0.35;

  // Master output
  const master = ac.createGain();
  master.gain.setValueAtTime(0, ac.currentTime);
  master.gain.linearRampToValueAtTime(vel * 0.5, ac.currentTime + 0.08);
  master.connect(ac.destination);
  reverb.connect(reverbGain); reverbGain.connect(ac.destination);

  // LP filter dengan resonance
  const filter = ac.createBiquadFilter();
  filter.type            = 'lowpass';
  filter.Q.value         = 4.0;
  filter.frequency.setValueAtTime(200, ac.currentTime);
  filter.frequency.linearRampToValueAtTime(800 + ledLevel * 400, ac.currentTime + 0.15);

  // Osc 1 — saw utama
  const osc1 = ac.createOscillator();
  osc1.type            = 'sawtooth';
  osc1.frequency.value = freq;

  // Osc 2 — detune untuk chorus effect
  const osc2 = ac.createOscillator();
  osc2.type            = 'sawtooth';
  osc2.frequency.value = freq * 1.008;   // detune +8 cent

  // Osc 3 — sub oktaf bawah
  const osc3 = ac.createOscillator();
  osc3.type            = 'sine';
  osc3.frequency.value = freq * 0.5;

  const osc3g = ac.createGain();
  osc3g.gain.value = 0.4;

  osc1.connect(filter); osc2.connect(filter);
  osc3.connect(osc3g); osc3g.connect(filter);
  filter.connect(master); filter.connect(reverb);

  osc1.start(); osc2.start(); osc3.start();

  _synth = { osc1, osc2, osc3, filter, master, reverbGain };
}

export function updateSynth(ledLevel = 1, velocity = 0.8) {
  if (!_synth) return;
  const ac   = getCtx();
  const vel  = Math.max(0.1, Math.min(1.0, velocity));
  const freq = SYNTH_NOTES[Math.max(1, Math.min(4, ledLevel))];
  const now  = ac.currentTime;

  // Glide ke nota baru
  _synth.osc1.frequency.linearRampToValueAtTime(freq, now + 0.05);
  _synth.osc2.frequency.linearRampToValueAtTime(freq * 1.008, now + 0.05);
  _synth.osc3.frequency.linearRampToValueAtTime(freq * 0.5, now + 0.05);

  // Buka filter lebih lebar bila LED naik
  _synth.filter.frequency.linearRampToValueAtTime(800 + ledLevel * 400, now + 0.08);
  _synth.master.gain.linearRampToValueAtTime(vel * 0.5, now + 0.05);
}

export function stopSynth(fadeMs = 120) {
  if (!_synth) return;
  _stopSynthNodes(fadeMs);
}

function _stopSynthNodes(fadeMs = 120) {
  if (!_synth) return;
  const ac   = getCtx();
  const node = _synth;
  _synth     = null;
  const now  = ac.currentTime;
  const fadeS = fadeMs / 1000;
  node.master.gain.cancelScheduledValues(now);
  node.master.gain.setValueAtTime(node.master.gain.value, now);
  node.master.gain.linearRampToValueAtTime(0, now + fadeS);
  node.reverbGain.gain.linearRampToValueAtTime(0, now + fadeS);
  setTimeout(() => {
    try { node.osc1.stop(); } catch {}
    try { node.osc2.stop(); } catch {}
    try { node.osc3.stop(); } catch {}
  }, fadeMs + 50);
}

function _makeReverbBuf(ac, duration) {
  const sr   = ac.sampleRate;
  const len  = Math.floor(sr * duration);
  const buf  = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

// ── State node yang aktif (sustained sensor sounds — tidak digunakan lagi) ──
const active = [null, null];

// Setiap entry: { noiseSource, osc1, osc2, masterGain }

// ── Noise buffer (dikongsi) ────────────────────────────────────
let _noiseBuf = null;
function getNoiseBuf(ac) {
  if (_noiseBuf) return _noiseBuf;
  const sec  = 2;
  const size = ac.sampleRate * sec;
  _noiseBuf  = ac.createBuffer(1, size, ac.sampleRate);
  const d    = _noiseBuf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  return _noiseBuf;
}

// ── SNARE — sustained buzz ─────────────────────────────────────
function buildSnareGraph(ac, velocity) {
  const masterGain = ac.createGain();
  masterGain.gain.setValueAtTime(0, ac.currentTime);
  masterGain.gain.linearRampToValueAtTime(velocity * 0.55, ac.currentTime + 0.015);
  masterGain.connect(ac.destination);

  // Noise layer (snare rattle)
  const noiseSource = ac.createBufferSource();
  noiseSource.buffer = getNoiseBuf(ac);
  noiseSource.loop   = true;

  const bp = ac.createBiquadFilter();
  bp.type            = 'bandpass';
  bp.frequency.value = 2800;
  bp.Q.value         = 1.2;

  const hp = ac.createBiquadFilter();
  hp.type            = 'highpass';
  hp.frequency.value = 1500;

  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.7;

  noiseSource.connect(bp); bp.connect(hp); hp.connect(noiseGain); noiseGain.connect(masterGain);

  // Mid tone layer (body)
  const osc1 = ac.createOscillator();
  osc1.type            = 'sawtooth';
  osc1.frequency.value = 180;

  const osc1Gain = ac.createGain();
  osc1Gain.gain.value = 0.25;

  const osc1Lp = ac.createBiquadFilter();
  osc1Lp.type            = 'lowpass';
  osc1Lp.frequency.value = 500;

  osc1.connect(osc1Lp); osc1Lp.connect(osc1Gain); osc1Gain.connect(masterGain);

  noiseSource.start();
  osc1.start();

  return { noiseSource, osc1, masterGain };
}

// ── KICK — sustained low drone ─────────────────────────────────
function buildKickGraph(ac, velocity) {
  const masterGain = ac.createGain();
  masterGain.gain.setValueAtTime(0, ac.currentTime);
  masterGain.gain.linearRampToValueAtTime(velocity * 0.75, ac.currentTime + 0.02);
  masterGain.connect(ac.destination);

  // Sub bass oscillator
  const osc1 = ac.createOscillator();
  osc1.type            = 'sine';
  osc1.frequency.value = 55;

  // Second harmonic untuk warmth
  const osc2 = ac.createOscillator();
  osc2.type            = 'sine';
  osc2.frequency.value = 110;

  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.3;

  // Low pass untuk tahan hanya bass
  const lp = ac.createBiquadFilter();
  lp.type            = 'lowpass';
  lp.frequency.value = 180;
  lp.Q.value         = 0.8;

  // Slight distortion untuk punch
  const wave = ac.createWaveShaper();
  wave.curve = makeDistCurve(60);

  osc1.connect(lp); osc2.connect(osc2Gain); osc2Gain.connect(lp);
  lp.connect(wave); wave.connect(masterGain);

  osc1.start();
  osc2.start();

  return { osc1, osc2, masterGain };
}

// ── API awam ───────────────────────────────────────────────────

/**
 * Mula mainkan bunyi untuk sensor idx (0=snare, 1=kick)
 * Panggil bila LED berubah dari 0 → >0
 */
export function startSound(idx, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  // Hentikan dulu jika masih aktif
  stopSound(idx, 0);

  active[idx] = idx === 0
    ? buildSnareGraph(ac, vel)
    : buildKickGraph(ac, vel);
}

/**
 * Kemaskini kelantangan mengikut intensity semasa (LED level)
 * Panggil bila LED berubah nilai (1→2, 2→3, dll)
 */
export function updateIntensity(idx, velocity = 1.0) {
  if (!active[idx]) return;
  const vel = Math.max(0.1, Math.min(1.0, velocity));
  const ac  = getCtx();
  active[idx].masterGain.gain.linearRampToValueAtTime(
    vel * (idx === 0 ? 0.55 : 0.75),
    ac.currentTime + 0.02
  );
}

/**
 * Hentikan bunyi untuk sensor idx
 * Panggil bila LED = 0
 * fadeMs = masa pudar (ms)
 */
export function stopSound(idx, fadeMs = 40) {
  if (!active[idx]) return;
  const ac   = getCtx();
  const node = active[idx];
  active[idx] = null;

  const now = ac.currentTime;
  const fadeS = fadeMs / 1000;

  node.masterGain.gain.cancelScheduledValues(now);
  node.masterGain.gain.setValueAtTime(node.masterGain.gain.value, now);
  node.masterGain.gain.linearRampToValueAtTime(0, now + fadeS);

  setTimeout(() => {
    try { node.osc1?.stop(); }        catch {}
    try { node.osc2?.stop(); }        catch {}
    try { node.noiseSource?.stop(); } catch {}
  }, fadeMs + 30);
}

export async function unlockAudio() {
  await ensureRunning();
}

// ── One-shot scheduled hits (untuk beat sequencer) ─────────────
// time = AudioContext.currentTime pada masa beat berlaku

export function scheduleKick(time, velocity = 1.0, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.9, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
  master.connect(ac.destination);

  // Sub bass pitch sweep
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(fr(160, rate), time);
  osc.frequency.exponentialRampToValueAtTime(fr(45, rate), time + 0.35);

  // Click transient
  const click = ac.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(fr(1000, rate), time);
  click.frequency.exponentialRampToValueAtTime(fr(150, rate), time + 0.02);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(vel * 0.25, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.025);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 200;

  const dist = ac.createWaveShaper();
  dist.curve = makeDistCurve(80);

  osc.connect(dist); dist.connect(lp); lp.connect(master);
  click.connect(cg); cg.connect(master);

  osc.start(time);   osc.stop(time + 0.55);
  click.start(time); click.stop(time + 0.03);
  schedCleanup([osc, click, cg, lp, dist, master], 0.6);
}

export function scheduleSnare(time, velocity = 1.0, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.7, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  master.connect(ac.destination);

  // Noise burst
  const size = Math.floor(ac.sampleRate * 0.25);
  const buf  = ac.createBuffer(1, size, ac.sampleRate);
  const d    = buf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buf;

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.7;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 1200;

  // Body tone
  const body = ac.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(fr(200, rate), time);
  body.frequency.exponentialRampToValueAtTime(fr(90, rate), time + 0.07);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(vel * 0.4, time);
  bg.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

  noise.connect(bp); bp.connect(hp); hp.connect(master);
  body.connect(bg); bg.connect(master);

  noise.start(time); noise.stop(time + 0.25);
  body.start(time);  body.stop(time + 0.1);
  schedCleanup([noise, bp, hp, body, bg, master], 0.35);
}

export function scheduleHihat(time, velocity = 0.5, open = false, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.05, Math.min(1.0, velocity));
  const dur = open ? 0.3 : 0.06;

  const size = Math.floor(ac.sampleRate * 0.35);
  const buf  = ac.createBuffer(1, size, ac.sampleRate);
  const d    = buf.getChannelData(0);
  for (let i = 0; i < size; i++) d[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buf;

  const hp = ac.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.8;

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.4, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + dur);
  master.connect(ac.destination);

  noise.connect(hp); hp.connect(bp); bp.connect(master);
  noise.start(time); noise.stop(time + dur + 0.05);
  schedCleanup([noise, hp, bp, master], dur + 0.15);
}

export function scheduleClap(time, velocity = 0.8) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  // 3 noise burst cepat untuk kesan clap
  const clapNodes = [];
  const clapBuf = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.08));
  for (let i = 0; i < 3; i++) {
    const t = time + i * 0.012;
    const noise = ac.createBufferSource();
    noise.buffer = clapBuf;

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.5;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 800;

    const g = ac.createGain();
    g.gain.setValueAtTime(vel * (i === 2 ? 0.6 : 0.35), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    g.connect(ac.destination);

    noise.connect(bp); bp.connect(hp); hp.connect(g);
    noise.start(t); noise.stop(t + 0.08);
    clapNodes.push(noise, bp, hp, g);
  }
  schedCleanup(clapNodes, 0.15);
}

export function scheduleRim(time, velocity = 0.7, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const osc = ac.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(fr(1600, rate), time);
  osc.frequency.exponentialRampToValueAtTime(fr(400, rate), time + 0.05);

  const g = ac.createGain();
  g.gain.setValueAtTime(vel * 0.5, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  g.connect(ac.destination);

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1000; bp.Q.value = 1.5;

  osc.connect(bp); bp.connect(g);
  osc.start(time); osc.stop(time + 0.07);
  schedCleanup([osc, bp, g], 0.15);
}

export function getAudioCtx() { return getCtx(); }

// ── Shared synth output chain (dibuat sekali, dikongsi semua nota) ──
// Mengelak penciptaan ConvolverNode baru setiap nota (punca instabiliti)
let _synthComp   = null;   // DynamicsCompressor → destination
let _synthReverb = null;   // ConvolverNode → _synthComp

function getSynthChain(ac) {
  if (_synthComp) return { comp: _synthComp, reverb: _synthReverb };

  // Compressor — cegah clipping bila banyak nota bertindih
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value      = 8;
  comp.ratio.value     = 5;
  comp.attack.value    = 0.003;
  comp.release.value   = 0.12;
  comp.connect(ac.destination);

  // Shared convolution reverb
  const reverbBuf = _makeReverbBuf(ac, 1.2);
  const reverb    = ac.createConvolver();
  reverb.buffer   = reverbBuf;
  const rvGain    = ac.createGain();
  rvGain.gain.value = 0.28;
  reverb.connect(rvGain);
  rvGain.connect(comp);

  _synthComp   = comp;
  _synthReverb = reverb;
  return { comp, reverb };
}

// ── One-shot scheduled synth nota (untuk SynthSequencer) ──────────
// freq     = frekuensi dalam Hz
// time     = AudioContext.currentTime untuk scheduling
// velocity = 0.1–1.0
// duration = tempoh bunyi dalam saat

export function scheduleSynth(freq, time, velocity = 0.8, duration = 0.25) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));
  const dur = Math.max(0.05, duration);
  const { comp, reverb } = getSynthChain(ac);

  // Per-nota master gain (envelope)
  const master = ac.createGain();
  master.gain.setValueAtTime(0, time);
  master.gain.linearRampToValueAtTime(vel * 0.42, time + 0.012);
  master.gain.setValueAtTime(vel * 0.42, time + dur - 0.03);
  master.gain.linearRampToValueAtTime(0, time + dur + 0.03);
  master.connect(comp);

  // LP filter — sweep attack untuk karakter synth
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 3.5;
  filter.frequency.setValueAtTime(180, time);
  filter.frequency.linearRampToValueAtTime(1800, time + 0.035);
  filter.frequency.setValueAtTime(1800, time + dur - 0.03);
  filter.frequency.linearRampToValueAtTime(280, time + dur + 0.03);

  // Sawtooth utama + detune (+7 cents chorus)
  const osc1 = ac.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = freq;

  const osc2 = ac.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.value = freq * 1.007;

  // Sub oktaf
  const sub     = ac.createOscillator();
  sub.type      = 'sine';
  sub.frequency.value = freq * 0.5;
  const subGain = ac.createGain();
  subGain.gain.value = 0.28;

  osc1.connect(filter);
  osc2.connect(filter);
  sub.connect(subGain);
  subGain.connect(filter);
  filter.connect(master);
  filter.connect(reverb);   // send ke shared reverb

  const stopAt = time + dur + 0.06;
  osc1.start(time); osc1.stop(stopAt);
  osc2.start(time); osc2.stop(stopAt);
  sub.start(time);  sub.stop(stopAt);
  schedCleanup([osc1, osc2, sub, subGain, filter, master], dur + 0.15);
}

// ── Tagading Batak ─────────────────────────────────────────────
// Taganing = set 5 drum berpitih kayu kulit kerbau
// Setiap drum ada pitch tersendiri (melody drum)
// Bunyi: "tok" kayu + sustain pitched + kulit tipis

/** Taganing — drum berpitih utama tagading set
 *  Pitch ~300Hz (drum ketiga/tengah dari set 5 drum)
 *  Bunyi organik: tok kayu keras + tubuh resonans + sedikit sustain pitched
 */
export function scheduleTaganing(time, velocity = 1.0, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.connect(ac.destination);

  // ── Layer 1: "Tok" kayu — transient utama ──
  // Osilator bersegi pendek dengan sweep cepat (kesan mallet kayu)
  const tok = ac.createOscillator();
  tok.type = 'square';
  tok.frequency.setValueAtTime(fr(680, rate), time);
  tok.frequency.exponentialRampToValueAtTime(fr(280, rate), time + 0.018);
  const tokLp = ac.createBiquadFilter();
  tokLp.type = 'lowpass'; tokLp.frequency.value = 1200; tokLp.Q.value = 1.5;
  const tokG = ac.createGain();
  tokG.gain.setValueAtTime(vel * 0.65, time);
  tokG.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
  tok.connect(tokLp); tokLp.connect(tokG); tokG.connect(master);

  // ── Layer 2: Tubuh resonans pitched ──
  // Drum taganing ada pitch jelas — sine dengan decay panjang sedikit
  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(fr(310, rate), time);          // pitch drum tengah set
  body.frequency.exponentialRampToValueAtTime(fr(295, rate), time + 0.06); // settle
  const bodyG = ac.createGain();
  bodyG.gain.setValueAtTime(vel * 0.55, time);
  bodyG.gain.exponentialRampToValueAtTime(0.001, time + 0.55);  // sustain pitched
  body.connect(bodyG); bodyG.connect(master);

  // Harmonik ke-2 (kayu resonat)
  const body2 = ac.createOscillator();
  body2.type = 'sine';
  body2.frequency.value = fr(620, rate);
  const body2G = ac.createGain();
  body2G.gain.setValueAtTime(vel * 0.18, time);
  body2G.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  body2.connect(body2G); body2G.connect(master);

  // ── Layer 3: Kulit tipis — sedikit noise kulit ──
  const skinSize = Math.floor(ac.sampleRate * 0.06);
  const skinBuf  = ac.createBuffer(1, skinSize, ac.sampleRate);
  const skinD    = skinBuf.getChannelData(0);
  for (let i = 0; i < skinSize; i++) skinD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (skinSize * 0.25));
  const skin = ac.createBufferSource();
  skin.buffer = skinBuf;
  const skinBp = ac.createBiquadFilter();
  skinBp.type = 'bandpass'; skinBp.frequency.value = 900; skinBp.Q.value = 1.2;
  const skinG = ac.createGain();
  skinG.gain.setValueAtTime(vel * 0.22, time);
  skinG.gain.exponentialRampToValueAtTime(0.001, time + 0.065);
  skin.connect(skinBp); skinBp.connect(skinG); skinG.connect(master);

  // ── Sedikit ruang akustik ──
  const { reverb } = getSynthChain(ac);
  const rvSend = ac.createGain(); rvSend.gain.value = 0.12;
  bodyG.connect(rvSend); rvSend.connect(reverb);

  tok.start(time);   tok.stop(time + 0.03);
  body.start(time);  body.stop(time + 0.58);
  body2.start(time); body2.stop(time + 0.2);
  skin.start(time);  skin.stop(time + 0.07);
  schedCleanup([tok, tokLp, tokG, body, bodyG, body2, body2G, skin, skinBp, skinG, rvSend, master], 0.7);
}

/** Odap — drum pengiring lebih kecil, bunyi lebih kering & pendek */
export function scheduleOdap(time, velocity = 1.0, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.connect(ac.destination);

  // Tok kayu lebih kecil
  const tok = ac.createOscillator();
  tok.type = 'square';
  tok.frequency.setValueAtTime(fr(520, rate), time);
  tok.frequency.exponentialRampToValueAtTime(fr(210, rate), time + 0.014);
  const tokG = ac.createGain();
  tokG.gain.setValueAtTime(vel * 0.5, time);
  tokG.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
  const tokLp = ac.createBiquadFilter();
  tokLp.type = 'lowpass'; tokLp.frequency.value = 900;
  tok.connect(tokLp); tokLp.connect(tokG); tokG.connect(master);

  // Body pitched rendah (drum lebih kecil = pitch lebih tinggi ~400Hz)
  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(fr(420, rate), time);
  body.frequency.exponentialRampToValueAtTime(fr(400, rate), time + 0.04);
  const bodyG = ac.createGain();
  bodyG.gain.setValueAtTime(vel * 0.45, time);
  bodyG.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
  body.connect(bodyG); bodyG.connect(master);

  tok.start(time);  tok.stop(time + 0.022);
  body.start(time); body.stop(time + 0.3);
  schedCleanup([tok, tokLp, tokG, body, bodyG, master], 0.4);
}

/** Hesek — instrumen perkusi logam (seperti gong kecil/simbal Batak) */
export function scheduleHesek(time, velocity = 0.6, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.05, Math.min(1.0, velocity));

  // Bunyi metalik: campuran frekuensi tidak harmonik (gong karakter)
  const freqs    = [3200, 4750, 6800, 9200];
  const decays   = [0.12, 0.08, 0.05, 0.03];
  const amps     = [0.35, 0.25, 0.18, 0.12];
  const hesekNodes = [];

  for (let i = 0; i < freqs.length; i++) {
    const osc = ac.createOscillator();
    osc.type  = 'sine';
    osc.frequency.value = fr(freqs[i], rate);
    const g   = ac.createGain();
    g.gain.setValueAtTime(vel * amps[i], time);
    g.gain.exponentialRampToValueAtTime(0.001, time + decays[i]);
    g.connect(ac.destination);
    osc.connect(g);
    osc.start(time); osc.stop(time + decays[i] + 0.01);
    hesekNodes.push(osc, g);
  }

  // Noise pukulan pendek (cached)
  const noise = ac.createBufferSource();
  noise.buffer = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.012));
  const nhp = ac.createBiquadFilter();
  nhp.type  = 'highpass'; nhp.frequency.value = 5000;
  const ng  = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.3, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
  ng.connect(ac.destination);
  noise.connect(nhp); nhp.connect(ng);
  noise.start(time); noise.stop(time + 0.015);
  hesekNodes.push(noise, nhp, ng);
  schedCleanup(hesekNodes, 0.2);
}

/** Gordang — gendang besar seremonial Batak, bunyi booming dalam */
export function scheduleGordang(time, velocity = 1.0, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.connect(ac.destination);

  // Sub boom utama — sangat dalam
  const sub = ac.createOscillator();
  sub.type  = 'sine';
  sub.frequency.setValueAtTime(fr(95, rate), time);
  sub.frequency.exponentialRampToValueAtTime(fr(42, rate), time + 0.5);
  const subG = ac.createGain();
  subG.gain.setValueAtTime(vel * 0.9, time);
  subG.gain.exponentialRampToValueAtTime(0.001, time + 0.75);
  const subLp = ac.createBiquadFilter();
  subLp.type  = 'lowpass'; subLp.frequency.value = 160;
  const subDist = ac.createWaveShaper();
  subDist.curve = makeDistCurve(80);
  sub.connect(subDist); subDist.connect(subLp); subLp.connect(subG); subG.connect(master);

  // Pukulan — transient keras kayu mallet pada kulit
  const punch = ac.createOscillator();
  punch.type  = 'triangle';
  punch.frequency.setValueAtTime(fr(200, rate), time);
  punch.frequency.exponentialRampToValueAtTime(fr(60, rate), time + 0.04);
  const punchG = ac.createGain();
  punchG.gain.setValueAtTime(vel * 0.7, time);
  punchG.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
  punch.connect(punchG); punchG.connect(master);

  // Kulit — noise rendah singkat
  const skinSz = Math.floor(ac.sampleRate * 0.08);
  const skinBuf = ac.createBuffer(1, skinSz, ac.sampleRate);
  const skinD   = skinBuf.getChannelData(0);
  for (let i = 0; i < skinSz; i++) skinD[i] = (Math.random() * 2 - 1) * Math.exp(-i / (skinSz * 0.3));
  const skin = ac.createBufferSource();
  skin.buffer = skinBuf;
  const skinLp = ac.createBiquadFilter();
  skinLp.type  = 'lowpass'; skinLp.frequency.value = 400;
  const skinG  = ac.createGain();
  skinG.gain.setValueAtTime(vel * 0.35, time);
  skinG.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
  skin.connect(skinLp); skinLp.connect(skinG); skinG.connect(master);

  sub.start(time);   sub.stop(time + 0.8);
  punch.start(time); punch.stop(time + 0.06);
  skin.start(time);  skin.stop(time + 0.09);
  schedCleanup([sub, subG, subLp, subDist, punch, punchG, skin, skinLp, skinG, master], 1.0);
}

// ── Hasapi Batak ───────────────────────────────────────────────
// Rujukan akustik: kajian BioResources (Sinin et al., 2024)
// - Pitch tinggi: sedikit harmonik (hampir sine murni)
// - Pitch rendah: harmonik lebih kaya
// - Partials tidak proporsional — jatuh cepat selepas fundamental
// - Bunyi: bright masa petik, gelap perlahan, resonans kotak kayu jackfruit
// Teknik synthesis: Sawtooth → LP filter sweep (Karplus-Strong approximation)

/** Hasapi — kecapi 2-dawai Batak Toba, synthesis organik
 *  Bunyi authentic: petikan bright, sweep bright→dark, resonans kayu warm
 */
export function scheduleHasapi(freq, time, velocity = 0.8) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  // Volume lebih kuat (hasapi biasanya subtle — kita amplify)
  const AMP = 1.8;

  // ── Master output chain ──
  const master = ac.createGain();
  master.gain.setValueAtTime(vel * AMP, time);

  // Body EQ: resonans kotak kayu jackfruit (~240-280Hz warm peak)
  const bodyEQ = ac.createBiquadFilter();
  bodyEQ.type          = 'peaking';
  bodyEQ.frequency.value = 255;
  bodyEQ.Q.value       = 2.8;
  bodyEQ.gain.value    = 7;   // tambah warmth kayu

  master.connect(bodyEQ);
  bodyEQ.connect(ac.destination);

  // Reverb kecil — bilik akustik kecil (kotak kayu resonat)
  const { reverb } = getSynthChain(ac);
  const rvG = ac.createGain(); rvG.gain.value = 0.20;
  master.connect(rvG); rvG.connect(reverb);

  // ── KUNCI bunyi plucked string: Sawtooth → Sweeping LP Filter ──
  // Sawtooth = kaya harmonik → LP filter yang turun perlahan =
  // simulasi cara harmonik tinggi mati dahulu selepas petikan (Karplus-Strong)
  //
  // Pitch tinggi → LP cutoff lebih rendah (kurang harmonik — sesuai kajian hasapi)
  // Pitch rendah → LP cutoff lebih tinggi (lebih kaya harmonik)
  const richFactor = Math.max(3.0, Math.min(14, 4200 / freq));

  const lpf = ac.createBiquadFilter();
  lpf.type   = 'lowpass';
  lpf.Q.value = 2.5;   // sedikit resonans untuk "twang" pada cutoff
  // Waktu petik: sangat bright (LP terbuka luas)
  lpf.frequency.setValueAtTime(freq * richFactor * 2.8, time);
  // 40ms: harmonik tinggi mati cepat
  lpf.frequency.exponentialRampToValueAtTime(freq * richFactor * 0.9, time + 0.04);
  // 300ms: terus gelap
  lpf.frequency.exponentialRampToValueAtTime(freq * 2.0, time + 0.3);
  // 1.5s: hampir sine sahaja
  lpf.frequency.exponentialRampToValueAtTime(freq * 1.3, time + 1.5);

  // ── Dawai 1: pitch asas (sawtooth → LP) ──
  const osc1 = ac.createOscillator();
  osc1.type  = 'sawtooth';
  // Pitch glide +1.8% masa petik lalu balik (simulasi tekanan kuku pada dawai)
  osc1.frequency.setValueAtTime(freq * 1.018, time);
  osc1.frequency.exponentialRampToValueAtTime(freq, time + 0.025);

  const env1 = ac.createGain();
  env1.gain.setValueAtTime(0, time);
  env1.gain.linearRampToValueAtTime(0.72, time + 0.002);  // attack instant
  env1.gain.exponentialRampToValueAtTime(0.001, time + 2.0);  // decay panjang

  osc1.connect(lpf); lpf.connect(env1); env1.connect(master);

  // ── Dawai 2: resonans sympathetik (dawai lain hasapi) ──
  // Hasapi ada 2 dawai — bila satu dipetik, dawai lain vibrate sympathetically
  // Tuning: kira-kira 5th di bawah atau 4th atas (bergantung pada lagu)
  const freq2 = freq * 0.667;  // perfect 4th di bawah (tuning Do-Sol)
  const osc2  = ac.createOscillator();
  osc2.type   = 'sine';  // dawai sympathetik = lebih senyap, lebih sine
  osc2.frequency.value = freq2;

  const lpf2 = ac.createBiquadFilter();
  lpf2.type  = 'lowpass';
  lpf2.frequency.setValueAtTime(freq2 * 4, time + 0.01);
  lpf2.frequency.exponentialRampToValueAtTime(freq2 * 1.8, time + 0.5);

  const env2 = ac.createGain();
  env2.gain.setValueAtTime(0, time + 0.008);   // delayed sedikit — sympathetic
  env2.gain.linearRampToValueAtTime(0.18, time + 0.02);
  env2.gain.exponentialRampToValueAtTime(0.001, time + 1.2);

  osc2.connect(lpf2); lpf2.connect(env2); env2.connect(master);

  // ── Pluck transient: kuku/pick mengenai dawai (5ms) ──
  const nSz  = Math.floor(ac.sampleRate * 0.005);
  const nBuf = ac.createBuffer(1, nSz, ac.sampleRate);
  const nD   = nBuf.getChannelData(0);
  for (let i = 0; i < nSz; i++) nD[i] = (Math.random() * 2 - 1) * (1 - i / nSz);
  const pluck  = ac.createBufferSource();
  pluck.buffer = nBuf;
  const plBp   = ac.createBiquadFilter();
  plBp.type    = 'bandpass';
  plBp.frequency.value = Math.min(freq * 5, 8000);  // cap di 8kHz
  plBp.Q.value = 1.6;
  const plG    = ac.createGain();
  plG.gain.setValueAtTime(0.5, time);
  plG.gain.exponentialRampToValueAtTime(0.001, time + 0.007);
  pluck.connect(plBp); plBp.connect(plG); plG.connect(master);

  // ── Harmonic partials tambahan (tidak proporsional seperti kajian) ──
  // Harmonik ke-2 & ke-3 dengan decay lebih cepat dari fundamental
  const h2 = ac.createOscillator(); h2.type = 'sine'; h2.frequency.value = freq * 2;
  const h2g = ac.createGain();
  h2g.gain.setValueAtTime(0.22, time);
  h2g.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
  h2.connect(h2g); h2g.connect(master);

  const h3 = ac.createOscillator(); h3.type = 'sine'; h3.frequency.value = freq * 3.02;
  const h3g = ac.createGain();
  h3g.gain.setValueAtTime(0.09, time);
  h3g.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  h3.connect(h3g); h3g.connect(master);

  // ── Start & stop ──
  pluck.start(time);  pluck.stop(time + 0.007);
  osc1.start(time);   osc1.stop(time + 2.05);
  osc2.start(time);   osc2.stop(time + 1.25);
  h2.start(time);     h2.stop(time + 0.58);
  h3.start(time);     h3.stop(time + 0.25);
  schedCleanup([pluck, plBp, plG, osc1, lpf, env1, osc2, lpf2, env2, h2, h2g, h3, h3g, master, bodyEQ, rvG], 2.2);
}

function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// ════════════════════════════════════════════════════════════════
// BEAT SAMPLES — 20 genre (Western, Nusantara, Latin, Electronic)
// ════════════════════════════════════════════════════════════════

// ── Tom (Floor Tom) ───────────────────────────────────────────
export function scheduleTom(time, velocity = 1.0, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  const osc = ac.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(fr(180, rate), time);
  osc.frequency.exponentialRampToValueAtTime(fr(75, rate), time + 0.25);
  const env = ac.createGain();
  env.gain.setValueAtTime(vel * 0.85, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
  osc.connect(lp); lp.connect(env); env.connect(master);
  // Click transient
  const click = ac.createOscillator(); click.type = 'triangle';
  click.frequency.setValueAtTime(fr(600, rate), time);
  click.frequency.exponentialRampToValueAtTime(fr(200, rate), time + 0.015);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(vel * 0.4, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
  click.connect(cg); cg.connect(master);
  osc.start(time); osc.stop(time + 0.5);
  click.start(time); click.stop(time + 0.02);
  schedCleanup([osc, lp, env, click, cg, master], 0.55);
}

// ── Cymbal / Crash ─────────────────────────────────────────────
export function scheduleCymbal(time, velocity = 0.7, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.05, Math.min(1.0, velocity));
  const freqs = [285, 318, 399, 514, 646, 1000, 1400, 1800];
  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.5, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 1.6);
  master.connect(ac.destination);
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
  const nodes = [master, hp];
  for (const f of freqs) {
    const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = fr(f, rate);
    o.connect(hp); hp.connect(master);
    o.start(time); o.stop(time + 1.65);
    nodes.push(o);
  }
  const noise = ac.createBufferSource();
  noise.buffer = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.5));
  const nhp = ac.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 8000;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.3, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.8);
  noise.connect(nhp); nhp.connect(ng); ng.connect(master);
  noise.start(time); noise.stop(time + 0.85);
  nodes.push(noise, nhp, ng);
  schedCleanup(nodes, 1.7);
}

// ── Tambourine ─────────────────────────────────────────────────
export function scheduleTambourine(time, velocity = 0.6, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.05, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  const nodes = [master];
  // Jingle metalik: beberapa osc tinggi + noise pendek
  for (let i = 0; i < 4; i++) {
    const t = time + i * 0.008;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.value = fr(4800 + i * 700, rate);
    const g = ac.createGain();
    g.gain.setValueAtTime(vel * 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    g.connect(master); o.connect(g);
    o.start(t); o.stop(t + 0.13);
    nodes.push(o, g);
  }
  const noise = ac.createBufferSource();
  noise.buffer = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.05));
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.35, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  noise.connect(hp); hp.connect(ng); ng.connect(master);
  noise.start(time); noise.stop(time + 0.065);
  nodes.push(noise, hp, ng);
  schedCleanup(nodes, 0.2);
}

// ── Cowbell ────────────────────────────────────────────────────
export function scheduleCowbell(time, velocity = 0.7, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.2;
  const env = ac.createGain();
  env.gain.setValueAtTime(vel * 0.7, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.85);
  bp.connect(env); env.connect(master);
  const o1 = ac.createOscillator(); o1.type = 'square'; o1.frequency.value = fr(562, rate);
  const o2 = ac.createOscillator(); o2.type = 'square'; o2.frequency.value = fr(845, rate);
  o1.connect(bp); o2.connect(bp);
  o1.start(time); o1.stop(time + 0.9);
  o2.start(time); o2.stop(time + 0.9);
  schedCleanup([o1, o2, bp, env, master], 0.95);
}

// ── Kendang (Jawa/Sunda) ───────────────────────────────────────
// Dua karakter: "tak" (kering, tinggi) + "dung" (dalam, panjang)
export function scheduleKendang(time, velocity = 1.0, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  // Dung — badan rendah
  const dung = ac.createOscillator(); dung.type = 'sine';
  dung.frequency.setValueAtTime(fr(140, rate), time);
  dung.frequency.exponentialRampToValueAtTime(fr(65, rate), time + 0.35);
  const dg = ac.createGain();
  dg.gain.setValueAtTime(vel * 0.75, time);
  dg.gain.exponentialRampToValueAtTime(0.001, time + 0.55);
  dung.connect(dg); dg.connect(master);
  // Tak — pukulan tangan depan, kering
  const tak = ac.createOscillator(); tak.type = 'triangle';
  tak.frequency.setValueAtTime(fr(520, rate), time);
  tak.frequency.exponentialRampToValueAtTime(fr(280, rate), time + 0.02);
  const tg = ac.createGain();
  tg.gain.setValueAtTime(vel * 0.5, time);
  tg.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  const tlp = ac.createBiquadFilter(); tlp.type = 'lowpass'; tlp.frequency.value = 800;
  tak.connect(tlp); tlp.connect(tg); tg.connect(master);
  // Kulit noise
  const noise = ac.createBufferSource();
  noise.buffer = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.04));
  const nbp = ac.createBiquadFilter(); nbp.type = 'bandpass'; nbp.frequency.value = 1200; nbp.Q.value = 1.5;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.25, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  noise.connect(nbp); nbp.connect(ng); ng.connect(master);
  noise.start(time); noise.stop(time + 0.05);
  dung.start(time); dung.stop(time + 0.6);
  tak.start(time);  tak.stop(time + 0.035);
  schedCleanup([dung, dg, tak, tlp, tg, noise, nbp, ng, master], 0.65);
}

// ── Rebana (Melayu/Nusantara) ──────────────────────────────────
// Frame drum dengan kepingan logam, bunyi "tak" kering + jingle
export function scheduleRebana(time, velocity = 0.9, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  // Badan drum
  const body = ac.createOscillator(); body.type = 'sine';
  body.frequency.setValueAtTime(fr(220, rate), time);
  body.frequency.exponentialRampToValueAtTime(fr(110, rate), time + 0.12);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(vel * 0.6, time);
  bg.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
  body.connect(bg); bg.connect(master);
  // Jingle logam
  for (let i = 0; i < 3; i++) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.value = fr(3500 + i * 800, rate);
    const g = ac.createGain();
    g.gain.setValueAtTime(vel * 0.12, time + i * 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.08 + i * 0.02);
    g.connect(master); o.connect(g);
    o.start(time); o.stop(time + 0.1);
  }
  // Pukulan noise
  const noise = ac.createBufferSource();
  noise.buffer = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.03));
  const nhp = ac.createBiquadFilter(); nhp.type = 'highpass'; nhp.frequency.value = 2000;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.3, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.035);
  noise.connect(nhp); nhp.connect(ng); ng.connect(master);
  noise.start(time); noise.stop(time + 0.04);
  body.start(time); body.stop(time + 0.25);
  schedCleanup([body, bg, noise, nhp, ng, master], 0.3);
}

// ── Bedug (Gendang Besar Masjid/Pesantren) ─────────────────────
// Bunyi booming dalam, lebih bulat dan panjang dari gordang
export function scheduleBedug(time, velocity = 1.0, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const { comp } = getSynthChain(ac);
  const master = ac.createGain(); master.connect(comp);
  // Sub boom panjang
  const sub = ac.createOscillator(); sub.type = 'sine';
  sub.frequency.setValueAtTime(fr(65, rate), time);
  sub.frequency.exponentialRampToValueAtTime(fr(38, rate), time + 0.8);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(vel * 1.0, time);
  sg.gain.exponentialRampToValueAtTime(0.001, time + 1.4);
  const slp = ac.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 120;
  sub.connect(slp); slp.connect(sg); sg.connect(master);
  // Second harmonic warm
  const body = ac.createOscillator(); body.type = 'sine';
  body.frequency.setValueAtTime(fr(130, rate), time);
  body.frequency.exponentialRampToValueAtTime(fr(80, rate), time + 0.4);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(vel * 0.4, time);
  bg.gain.exponentialRampToValueAtTime(0.001, time + 0.7);
  body.connect(bg); bg.connect(master);
  // Pukulan kayu
  const punch = ac.createOscillator(); punch.type = 'triangle';
  punch.frequency.setValueAtTime(fr(180, rate), time);
  punch.frequency.exponentialRampToValueAtTime(fr(50, rate), time + 0.05);
  const pg = ac.createGain();
  pg.gain.setValueAtTime(vel * 0.6, time);
  pg.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
  punch.connect(pg); pg.connect(master);
  sub.start(time);   sub.stop(time + 1.45);
  body.start(time);  body.stop(time + 0.75);
  punch.start(time); punch.stop(time + 0.08);
  schedCleanup([sub, slp, sg, body, bg, punch, pg, master], 1.5);
}

// ── Conga (Latin) ──────────────────────────────────────────────
export function scheduleConga(time, velocity = 0.9, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  const osc = ac.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(fr(320, rate), time);
  osc.frequency.exponentialRampToValueAtTime(fr(180, rate), time + 0.18);
  const env = ac.createGain();
  env.gain.setValueAtTime(vel * 0.8, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
  osc.connect(lp); lp.connect(env); env.connect(master);
  // Slap transient
  const slap = ac.createOscillator(); slap.type = 'square';
  slap.frequency.setValueAtTime(fr(800, rate), time);
  slap.frequency.exponentialRampToValueAtTime(fr(350, rate), time + 0.018);
  const sg = ac.createGain();
  sg.gain.setValueAtTime(vel * 0.35, time);
  sg.gain.exponentialRampToValueAtTime(0.001, time + 0.022);
  const sbp = ac.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 600; sbp.Q.value = 1.0;
  slap.connect(sbp); sbp.connect(sg); sg.connect(master);
  osc.start(time);  osc.stop(time + 0.4);
  slap.start(time); slap.stop(time + 0.025);
  schedCleanup([osc, lp, env, slap, sbp, sg, master], 0.45);
}

// ── Bongo (Latin) ──────────────────────────────────────────────
export function scheduleBongo(time, velocity = 0.8, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  // High bongo
  const hi = ac.createOscillator(); hi.type = 'sine';
  hi.frequency.setValueAtTime(fr(480, rate), time);
  hi.frequency.exponentialRampToValueAtTime(fr(320, rate), time + 0.08);
  const hg = ac.createGain();
  hg.gain.setValueAtTime(vel * 0.7, time);
  hg.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  hi.connect(hg); hg.connect(master);
  // Low bongo (slight offset)
  const lo = ac.createOscillator(); lo.type = 'sine';
  lo.frequency.setValueAtTime(fr(310, rate), time + 0.005);
  lo.frequency.exponentialRampToValueAtTime(fr(210, rate), time + 0.12);
  const lg = ac.createGain();
  lg.gain.setValueAtTime(vel * 0.55, time + 0.005);
  lg.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
  lo.connect(lg); lg.connect(master);
  hi.start(time);        hi.stop(time + 0.2);
  lo.start(time + 0.005); lo.stop(time + 0.28);
  schedCleanup([hi, hg, lo, lg, master], 0.35);
}

// ── 808 Kick (Electronic) ──────────────────────────────────────
export function scheduleKick808(time, velocity = 1.0, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const { comp } = getSynthChain(ac);
  const master = ac.createGain(); master.connect(comp);
  const dist = ac.createWaveShaper(); dist.curve = makeDistCurve(120);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
  master.connect(dist); dist.connect(lp); lp.connect(comp);
  // 808 sub — pitch sweep sangat panjang
  const osc = ac.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(fr(200, rate), time);
  osc.frequency.exponentialRampToValueAtTime(fr(32, rate), time + 0.7);
  const env = ac.createGain();
  env.gain.setValueAtTime(vel * 1.0, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.9);
  osc.connect(env); env.connect(master);
  // Click transient keras
  const click = ac.createOscillator(); click.type = 'square';
  click.frequency.setValueAtTime(fr(1200, rate), time);
  click.frequency.exponentialRampToValueAtTime(fr(80, rate), time + 0.025);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(vel * 0.4, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  click.connect(cg); cg.connect(master);
  osc.start(time);   osc.stop(time + 0.95);
  click.start(time); click.stop(time + 0.032);
  schedCleanup([osc, env, click, cg, dist, lp, master], 1.0);
}

// ── Electronic Snare (808 Snare) ───────────────────────────────
export function scheduleElecSnare(time, velocity = 1.0, rate = 1.0) {
  const ac = getCtx(), vel = Math.max(0.1, Math.min(1.0, velocity));
  const master = ac.createGain(); master.connect(ac.destination);
  // Noise burst elektronik
  const noise = ac.createBufferSource();
  noise.buffer = getCachedNoise(ac, Math.floor(ac.sampleRate * 0.3));
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 0.6;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.8, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  noise.connect(hp); hp.connect(bp); bp.connect(ng); ng.connect(master);
  // Tone elektronik (pitch flat, bukan sweep seperti acoustic snare)
  const body = ac.createOscillator(); body.type = 'triangle';
  body.frequency.value = fr(220, rate);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(vel * 0.35, time);
  bg.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  body.connect(bg); bg.connect(master);
  noise.start(time); noise.stop(time + 0.2);
  body.start(time);  body.stop(time + 0.07);
  schedCleanup([noise, hp, bp, ng, body, bg, master], 0.25);
}

// ── WAV file player ────────────────────────────────────────────
// Lazy-load + cache supaya tidak fetch berulang kali
const _wavCache = new Map();

async function _loadWav(url) {
  if (_wavCache.has(url)) return _wavCache.get(url);
  const ac = getCtx();
  const resp = await fetch(url);
  const arr  = await resp.arrayBuffer();
  const buf  = await ac.decodeAudioData(arr);
  _wavCache.set(url, buf);
  return buf;
}

export function scheduleWav(url, time, velocity = 1.0, rate = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));
  _loadWav(url).then(buf => {
    const src  = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.25, Math.min(4.0, rate || 1.0));
    const gain = ac.createGain();
    gain.gain.value = vel * 0.85;
    src.connect(gain); gain.connect(ac.destination);
    src.start(time);
    const dur = buf.duration;
    src.stop(time + dur);
    schedCleanup([src, gain], dur + 0.1);
  }).catch(e => console.warn('[audio] WAV load error:', e));
}

// stopPrev=true: henti instance sebelum bermain (elak overlap) — untuk uploaded WAV
// gainMult: pekali gain (1.0 = original, 0.85 = default lama)
export function scheduleWavBuffer(audioBuffer, time, velocity = 1.0, rate = 1.0, sensorKey = null, stopPrev = false, gainMult = 0.85) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  if (stopPrev && sensorKey !== null) {
    const prevSet = _wavRegistry.get(sensorKey);
    if (prevSet?.size) {
      for (const { src: ps, gain: pg } of [...prevSet]) {
        try { pg.gain.setValueAtTime(0, time); ps.stop(time + 0.01); } catch {}
      }
      prevSet.clear();
    }
  }

  const src  = ac.createBufferSource();
  src.buffer = audioBuffer;
  src.playbackRate.value = Math.max(0.25, Math.min(4.0, rate || 1.0));
  const gain = ac.createGain();
  gain.gain.value = vel * gainMult;
  src.connect(gain);

  if (sensorKey !== null) {
    // Sambung melalui kill gain — putus kill gain = bisu serta-merta
    gain.connect(_getKillGain(sensorKey));
    if (!_wavRegistry.has(sensorKey)) _wavRegistry.set(sensorKey, new Set());
    const set = _wavRegistry.get(sensorKey);
    const entry = { src, gain };
    set.add(entry);
    src.onended = () => set.delete(entry);
  } else {
    gain.connect(ac.destination);
  }

  src.start(time);
  const dur = audioBuffer.duration;
  schedCleanup([src, gain], (time - ac.currentTime) + dur + 0.2);
}

export async function decodeAudioFile(file) {
  const ac  = getCtx();
  const arr = await file.arrayBuffer();
  return ac.decodeAudioData(arr);
}
