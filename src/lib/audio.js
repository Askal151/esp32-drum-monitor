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
// Taganing = set 5 drum berpitih kayu kulit kerbau
// Setiap drum ada pitch tersendiri (melody drum)
// Bunyi: "tok" kayu + sustain pitched + kulit tipis

/** Taganing — drum berpitih utama tagading set
 *  Pitch ~300Hz (drum ketiga/tengah dari set 5 drum)
 *  Bunyi organik: tok kayu keras + tubuh resonans + sedikit sustain pitched
 */
export function scheduleTaganing(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.connect(ac.destination);

  // ── Layer 1: "Tok" kayu — transient utama ──
  // Osilator bersegi pendek dengan sweep cepat (kesan mallet kayu)
  const tok = ac.createOscillator();
  tok.type = 'square';
  tok.frequency.setValueAtTime(680, time);
  tok.frequency.exponentialRampToValueAtTime(280, time + 0.018);
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
  body.frequency.setValueAtTime(310, time);          // pitch drum tengah set
  body.frequency.exponentialRampToValueAtTime(295, time + 0.06); // settle
  const bodyG = ac.createGain();
  bodyG.gain.setValueAtTime(vel * 0.55, time);
  bodyG.gain.exponentialRampToValueAtTime(0.001, time + 0.55);  // sustain pitched
  body.connect(bodyG); bodyG.connect(master);

  // Harmonik ke-2 (kayu resonat)
  const body2 = ac.createOscillator();
  body2.type = 'sine';
  body2.frequency.value = 620;
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
}

/** Odap — drum pengiring lebih kecil, bunyi lebih kering & pendek */
export function scheduleOdap(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.connect(ac.destination);

  // Tok kayu lebih kecil
  const tok = ac.createOscillator();
  tok.type = 'square';
  tok.frequency.setValueAtTime(520, time);
  tok.frequency.exponentialRampToValueAtTime(210, time + 0.014);
  const tokG = ac.createGain();
  tokG.gain.setValueAtTime(vel * 0.5, time);
  tokG.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
  const tokLp = ac.createBiquadFilter();
  tokLp.type = 'lowpass'; tokLp.frequency.value = 900;
  tok.connect(tokLp); tokLp.connect(tokG); tokG.connect(master);

  // Body pitched rendah (drum lebih kecil = pitch lebih tinggi ~400Hz)
  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(420, time);
  body.frequency.exponentialRampToValueAtTime(400, time + 0.04);
  const bodyG = ac.createGain();
  bodyG.gain.setValueAtTime(vel * 0.45, time);
  bodyG.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
  body.connect(bodyG); bodyG.connect(master);

  tok.start(time);  tok.stop(time + 0.022);
  body.start(time); body.stop(time + 0.3);
}

/** Hesek — instrumen perkusi logam (seperti gong kecil/simbal Batak) */
export function scheduleHesek(time, velocity = 0.6) {
  const ac  = getCtx();
  const vel = Math.max(0.05, Math.min(1.0, velocity));

  // Bunyi metalik: campuran frekuensi tidak harmonik (gong karakter)
  const freqs    = [3200, 4750, 6800, 9200];  // rasio tidak harmonik → metalik
  const decays   = [0.12, 0.08, 0.05, 0.03];
  const amps     = [0.35, 0.25, 0.18, 0.12];

  for (let i = 0; i < freqs.length; i++) {
    const osc = ac.createOscillator();
    osc.type  = 'sine';
    osc.frequency.value = freqs[i];
    const g   = ac.createGain();
    g.gain.setValueAtTime(vel * amps[i], time);
    g.gain.exponentialRampToValueAtTime(0.001, time + decays[i]);
    g.connect(ac.destination);
    osc.connect(g);
    osc.start(time); osc.stop(time + decays[i] + 0.01);
  }

  // Noise pukulan pendek
  const nSize = Math.floor(ac.sampleRate * 0.012);
  const nBuf  = ac.createBuffer(1, nSize, ac.sampleRate);
  const nD    = nBuf.getChannelData(0);
  for (let i = 0; i < nSize; i++) nD[i] = (Math.random() * 2 - 1) * (1 - i / nSize);
  const noise = ac.createBufferSource();
  noise.buffer = nBuf;
  const nhp = ac.createBiquadFilter();
  nhp.type  = 'highpass'; nhp.frequency.value = 5000;
  const ng  = ac.createGain();
  ng.gain.setValueAtTime(vel * 0.3, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
  ng.connect(ac.destination);
  noise.connect(nhp); nhp.connect(ng);
  noise.start(time); noise.stop(time + 0.015);
}

/** Gordang — gendang besar seremonial Batak, bunyi booming dalam */
export function scheduleGordang(time, velocity = 1.0) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.connect(ac.destination);

  // Sub boom utama — sangat dalam
  const sub = ac.createOscillator();
  sub.type  = 'sine';
  sub.frequency.setValueAtTime(95, time);
  sub.frequency.exponentialRampToValueAtTime(42, time + 0.5);
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
  punch.frequency.setValueAtTime(200, time);
  punch.frequency.exponentialRampToValueAtTime(60, time + 0.04);
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
}

// ── Hasapi Batak ───────────────────────────────────────────────
// Hasapi = kecapi 2-dawai kayu Batak Toba
// Bunyi: petikan twangy bright + resonans kotak kayu + sustain sederhana
// Karakter: attack tajam, bright, sedikit metalik, pelahan fade

/** Hasapi — petikan kecapi 2-dawai Batak, synthesis additive organic */
export function scheduleHasapi(freq, time, velocity = 0.8) {
  const ac  = getCtx();
  const vel = Math.max(0.1, Math.min(1.0, velocity));

  const master = ac.createGain();
  master.gain.setValueAtTime(1, time);
  master.connect(ac.destination);

  // ── Simulasi 2 dawai (sedikit detune antara satu sama lain) ──
  // Dawai 1 (pitch asas)
  const d1f0 = ac.createOscillator(); d1f0.type = 'triangle';
  const d1f1 = ac.createOscillator(); d1f1.type = 'sine';
  const d1f2 = ac.createOscillator(); d1f2.type = 'sine';
  const d1f3 = ac.createOscillator(); d1f3.type = 'sine';

  // Dawai 2 (detune +5 cent → chorus dawai)
  const detune = freq * 1.0029;  // ~5 cent
  const d2f0 = ac.createOscillator(); d2f0.type = 'triangle';
  const d2f1 = ac.createOscillator(); d2f1.type = 'sine';

  // Semua harmonik dengan frekuensi
  d1f0.frequency.value = freq;
  d1f1.frequency.value = freq * 2;
  d1f2.frequency.value = freq * 3;
  d1f3.frequency.value = freq * 4.02;  // sedikit inharmonik → twang
  d2f0.frequency.value = detune;
  d2f1.frequency.value = detune * 2;

  // ── Pitch "twang" — naik 1.5% lalu turun ke pitch asas ──
  const t_settle = 0.035;
  [d1f0, d2f0].forEach(o => {
    const f = o === d1f0 ? freq : detune;
    o.frequency.setValueAtTime(f * 1.015, time);
    o.frequency.exponentialRampToValueAtTime(f, time + t_settle);
  });

  // ── Envelope setiap harmonik ──
  // Fundamental: paling lama
  const g0 = ac.createGain();
  g0.gain.setValueAtTime(vel * 0.38, time);
  g0.gain.exponentialRampToValueAtTime(0.001, time + 1.4);

  // Oktaf: pertengahan
  const g1 = ac.createGain();
  g1.gain.setValueAtTime(vel * 0.22, time);
  g1.gain.exponentialRampToValueAtTime(0.001, time + 0.65);

  // 3rd harmonik: pendek
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(vel * 0.12, time);
  g2.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

  // 4th harmonik: sangat pendek (twang click)
  const g3 = ac.createGain();
  g3.gain.setValueAtTime(vel * 0.08, time);
  g3.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

  // Dawai 2 harmonik
  const gd2f0 = ac.createGain();
  gd2f0.gain.setValueAtTime(vel * 0.28, time);
  gd2f0.gain.exponentialRampToValueAtTime(0.001, time + 1.3);
  const gd2f1 = ac.createGain();
  gd2f1.gain.setValueAtTime(vel * 0.16, time);
  gd2f1.gain.exponentialRampToValueAtTime(0.001, time + 0.55);

  d1f0.connect(g0); g0.connect(master);
  d1f1.connect(g1); g1.connect(master);
  d1f2.connect(g2); g2.connect(master);
  d1f3.connect(g3); g3.connect(master);
  d2f0.connect(gd2f0); gd2f0.connect(master);
  d2f1.connect(gd2f1); gd2f1.connect(master);

  // ── Petikan (pluck) transient — noise burst 8ms ──
  const nSz  = Math.floor(ac.sampleRate * 0.008);
  const nBuf = ac.createBuffer(1, nSz, ac.sampleRate);
  const nD   = nBuf.getChannelData(0);
  for (let i = 0; i < nSz; i++) nD[i] = (Math.random() * 2 - 1) * (1 - i / nSz);
  const pluck = ac.createBufferSource();
  pluck.buffer = nBuf;
  const pluckBp = ac.createBiquadFilter();
  pluckBp.type  = 'bandpass'; pluckBp.frequency.value = freq * 3.5; pluckBp.Q.value = 1.8;
  const pluckG  = ac.createGain();
  pluckG.gain.setValueAtTime(vel * 0.55, time);
  pluckG.gain.exponentialRampToValueAtTime(0.001, time + 0.012);
  pluck.connect(pluckBp); pluckBp.connect(pluckG); pluckG.connect(master);

  // ── Resonans kotak kayu (body filter) ──
  const bodyFilter = ac.createBiquadFilter();
  bodyFilter.type      = 'peaking';
  bodyFilter.frequency.value = freq * 2.8;
  bodyFilter.Q.value   = 3.5;
  bodyFilter.gain.value = 5;
  master.connect(bodyFilter); bodyFilter.connect(ac.destination);

  // ── Reverb ruang kecil (kotak kayu) ──
  const { reverb } = getSynthChain(ac);
  const rvG = ac.createGain(); rvG.gain.value = 0.22;
  master.connect(rvG); rvG.connect(reverb);

  const stop1 = time + 1.45;
  const stop2 = time + 0.58;
  pluck.start(time); pluck.stop(time + 0.01);
  d1f0.start(time);  d1f0.stop(stop1);
  d2f0.start(time);  d2f0.stop(stop1);
  d1f1.start(time);  d1f1.stop(stop2);
  d2f1.start(time);  d2f1.stop(stop2);
  d1f2.start(time);  d1f2.stop(time + 0.3);
  d1f3.start(time);  d1f3.stop(time + 0.14);
}

function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
