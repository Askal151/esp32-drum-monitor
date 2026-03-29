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
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── State node yang aktif ──────────────────────────────────────
const active = [null, null];   // active[0]=snare, active[1]=kick

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

export function unlockAudio() { getCtx(); }

function makeDistCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
