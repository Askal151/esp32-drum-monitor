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

export function scheduleKick(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.9, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
  master.connect(ac.destination);

  // Sub bass pitch sweep
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.35);

  // Click transient
  const click = ac.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(1000, time);
  click.frequency.exponentialRampToValueAtTime(150, time + 0.02);
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
}

export function scheduleSnare(time, velocity = 1.0) {
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
  body.frequency.setValueAtTime(200, time);
  body.frequency.exponentialRampToValueAtTime(90, time + 0.07);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(vel * 0.4, time);
  bg.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

  noise.connect(bp); bp.connect(hp); hp.connect(master);
  body.connect(bg); bg.connect(master);

  noise.start(time); noise.stop(time + 0.25);
  body.start(time);  body.stop(time + 0.1);
}

export function scheduleHihat(time, velocity = 0.5, open = false) {
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
}

export function scheduleClap(time, velocity = 0.8) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  // 3 noise burst cepat untuk kesan clap
  for (let i = 0; i < 3; i++) {
    const t = time + i * 0.012;
    const size = Math.floor(ac.sampleRate * 0.08);
    const buf  = ac.createBuffer(1, size, ac.sampleRate);
    const d    = buf.getChannelData(0);
    for (let j = 0; j < size; j++) d[j] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf;

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
  }
}

export function scheduleRim(time, velocity = 0.7) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const osc = ac.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1600, time);
  osc.frequency.exponentialRampToValueAtTime(400, time + 0.05);

  const g = ac.createGain();
  g.gain.setValueAtTime(vel * 0.5, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  g.connect(ac.destination);

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1000; bp.Q.value = 1.5;

  osc.connect(bp); bp.connect(g);
  osc.start(time); osc.stop(time + 0.07);
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
}

// ── Tagading Batak ─────────────────────────────────────────────

/** Taganing — drum utama tagading, bunyi mid-pitched (~240→120 Hz) */
export function scheduleTaganing(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.75, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  master.connect(ac.destination);

  // Body tone — pitch sweep
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(240, time);
  osc.frequency.exponentialRampToValueAtTime(120, time + 0.15);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 700;
  osc.connect(lp); lp.connect(master);

  // Transient knok
  const click = ac.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(900, time);
  click.frequency.exponentialRampToValueAtTime(200, time + 0.022);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(vel * 0.3, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  click.connect(cg); cg.connect(master);

  // Noise kulit
  const size  = Math.floor(ac.sampleRate * 0.1);
  const nbuf  = ac.createBuffer(1, size, ac.sampleRate);
  const nd    = nbuf.getChannelData(0);
  for (let i = 0; i < size; i++) nd[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = nbuf;
  const bp  = ac.createBiquadFilter();
  bp.type   = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.9;
  const ng  = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.28, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
  noise.connect(bp); bp.connect(ng); ng.connect(master);

  osc.start(time);   osc.stop(time + 0.32);
  click.start(time); click.stop(time + 0.035);
  noise.start(time); noise.stop(time + 0.1);
}

/** Odap — drum pengiring, mid-low (~110→60 Hz) */
export function scheduleOdap(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.82, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 0.26);
  master.connect(ac.destination);

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(115, time);
  osc.frequency.exponentialRampToValueAtTime(58, time + 0.15);

  const lp   = ac.createBiquadFilter();
  lp.type    = 'lowpass'; lp.frequency.value = 280;
  const dist = ac.createWaveShaper();
  dist.curve = makeDistCurve(50);

  osc.connect(dist); dist.connect(lp); lp.connect(master);
  osc.start(time); osc.stop(time + 0.28);
}

/** Hesek — perkusi logam kecil, bunyi metalik singkat */
export function scheduleHesek(time, velocity = 0.6) {
  const ac  = getCtx();
  const vel = Math.max(0.05, Math.min(1.0, velocity));
  const dur = 0.045;

  for (let i = 0; i < 2; i++) {
    const t    = time + i * 0.011;
    const size = Math.floor(ac.sampleRate * 0.05);
    const buf  = ac.createBuffer(1, size, ac.sampleRate);
    const d    = buf.getChannelData(0);
    for (let j = 0; j < size; j++) d[j] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    const hp = ac.createBiquadFilter();
    hp.type  = 'highpass'; hp.frequency.value = 8000 + i * 2200;
    const g  = ac.createGain();
    g.gain.setValueAtTime(vel * (i === 0 ? 0.5 : 0.28), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(ac.destination);
    noise.connect(hp); hp.connect(g);
    noise.start(t); noise.stop(t + dur + 0.01);
  }

  const ring = ac.createOscillator();
  ring.type  = 'square'; ring.frequency.value = 6200;
  const rg   = ac.createGain();
  rg.gain.setValueAtTime(vel * 0.14, time);
  rg.gain.exponentialRampToValueAtTime(0.001, time + 0.032);
  rg.connect(ac.destination);
  ring.connect(rg);
  ring.start(time); ring.stop(time + 0.036);
}

/** Gordang — gendang besar seremonial, sangat dalam (~80→38 Hz) */
export function scheduleGordang(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(vel * 0.95, time);
  master.gain.exponentialRampToValueAtTime(0.001, time + 0.8);
  master.connect(ac.destination);

  // Bunyi utama
  const osc = ac.createOscillator();
  osc.type  = 'sine';
  osc.frequency.setValueAtTime(82, time);
  osc.frequency.exponentialRampToValueAtTime(36, time + 0.42);

  // Sub harmonik
  const sub  = ac.createOscillator();
  sub.type   = 'sine';
  sub.frequency.setValueAtTime(41, time);
  sub.frequency.exponentialRampToValueAtTime(20, time + 0.5);
  const subG = ac.createGain(); subG.gain.value = 0.48;

  // Pukulan keras
  const click = ac.createOscillator();
  click.type  = 'square';
  click.frequency.setValueAtTime(620, time);
  click.frequency.exponentialRampToValueAtTime(80, time + 0.04);
  const cg = ac.createGain();
  cg.gain.setValueAtTime(vel * 0.42, time);
  cg.gain.exponentialRampToValueAtTime(0.001, time + 0.052);

  const lp   = ac.createBiquadFilter();
  lp.type    = 'lowpass'; lp.frequency.value = 140;
  const dist = ac.createWaveShaper();
  dist.curve = makeDistCurve(100);

  osc.connect(dist); dist.connect(lp); lp.connect(master);
  sub.connect(subG); subG.connect(master);
  click.connect(cg); cg.connect(master);

  osc.start(time);   osc.stop(time + 0.85);
  sub.start(time);   sub.stop(time + 0.56);
  click.start(time); click.stop(time + 0.055);
}

// ── Hasapi Batak ───────────────────────────────────────────────

/** Hasapi — kecapi 2-dawai Batak, bunyi petikan dawai */
export function scheduleHasapi(freq, time, velocity = 0.8) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));
  const dur = 0.55;

  const master = ac.createGain();
  master.gain.setValueAtTime(0, time);
  master.gain.linearRampToValueAtTime(vel * 0.55, time + 0.005);
  master.gain.setValueAtTime(vel * 0.55, time + 0.006);
  master.gain.exponentialRampToValueAtTime(0.001, time + dur);
  master.connect(ac.destination);

  // Bunyi petik (noise burst singkat → karakter pluck)
  const size  = Math.floor(ac.sampleRate * 0.018);
  const nbuf  = ac.createBuffer(1, size, ac.sampleRate);
  const nd    = nbuf.getChannelData(0);
  for (let i = 0; i < size; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / size);
  const noise = ac.createBufferSource();
  noise.buffer = nbuf;
  const lp   = ac.createBiquadFilter();
  lp.type    = 'lowpass';
  lp.frequency.setValueAtTime(freq * 9, time);
  lp.frequency.exponentialRampToValueAtTime(freq * 2.5, time + 0.04);
  lp.Q.value = 2.2;
  noise.connect(lp); lp.connect(master);

  // Nada fundamental
  const osc  = ac.createOscillator();
  osc.type   = 'triangle';
  osc.frequency.value = freq;
  const og   = ac.createGain();
  og.gain.setValueAtTime(vel * 0.45, time);
  og.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.55);
  osc.connect(og); og.connect(master);

  // Harmonik ke-2 (bunyi dawai)
  const osc2 = ac.createOscillator();
  osc2.type  = 'sine';
  osc2.frequency.value = freq * 2;
  const og2  = ac.createGain();
  og2.gain.setValueAtTime(vel * 0.18, time);
  og2.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.3);
  osc2.connect(og2); og2.connect(master);

  // Sedikit reverb
  const { reverb } = getSynthChain(ac);
  const revSend = ac.createGain(); revSend.gain.value = 0.18;
  osc.connect(revSend); revSend.connect(reverb);

  const stopAt = time + dur + 0.04;
  noise.start(time); noise.stop(time + 0.022);
  osc.start(time);   osc.stop(stopAt);
  osc2.start(time);  osc2.stop(time + dur * 0.35);
}

function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
