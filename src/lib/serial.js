/**
 * serial.js — Web Serial manager ESP32 + ADS1015/ADS1115
 * Format: HALL8|adc1|dev1|led1|...|adc8|dev8|led8  @115200  (24 nilai)
 * S1–S4 = ADS1015 @ 0x48 (A0–A3)
 * S5–S8 = ADS1115 @ 0x49 (A0–A3)
 */
import { writable } from 'svelte/store';

export const MAX_POINTS  = 400;
export const MAX_HISTORY = 2000;

export const portState   = writable('idle');
export const connected   = writable(false);
export const packetCount = writable(0);

export const sensors = writable([
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [10,  25,  60,  120],  name: 'S1' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [10,  25,  60,  120],  name: 'S2' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [10,  25,  60,  120],  name: 'S3' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [10,  25,  60,  120],  name: 'S4' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [80,  200, 600, 1200], name: 'S5' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [80,  200, 600, 1200], name: 'S6' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [80,  200, 600, 1200], name: 'S7' },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [80,  200, 600, 1200], name: 'S8' },
]);

export const chartTick  = writable(0);
export const hitEvent   = writable({ idx: -1, velocity: 0, ts: 0 });  // trigger hit anim

// ── Button events ──────────────────────────────────────────────
export const btnEvent = writable({ btn: '', ts: 0 });   // btn: 'NAV' atau 'SEL'

// ── BPM control dari potensio + button BPMNAV ──────────────────
// sel = sensor yang dipilih (0–7), bpm = nilai potensio (40–200)
export const bpmCtrl = writable({ sel: 0, bpm: 120 });

// ── Pitch control dari potensio + button PITCHNAV ──────────────
// sel = sensor yang dipilih (0–7), pitch = semitone (-12..+12)
export const pitchCtrl = writable({ sel: 0, pitch: 0 });

export const plotBuf = Array.from({ length: 8 }, () => ({
  adc: new Array(MAX_POINTS).fill(0),
  dev: new Array(MAX_POINTS).fill(0),
}));

// ── Raw serial history ──────────────────────────────────────────
export const rawHistory = [];
const _listeners = new Set();
export function onRawLine(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function emitRaw(text, dir = 'rx') {
  const ts = new Date().toISOString().slice(11, 23);
  rawHistory.push({ text, dir, ts });
  if (rawHistory.length > MAX_HISTORY) rawHistory.shift();
  _listeners.forEach(fn => fn(text, dir, ts));
}

// ── Regex ───────────────────────────────────────────────────────
const D = '\\|(-?\\d+)';
const RX_DATA    = new RegExp('HALL8' + D.repeat(24));
const RX_THR     = /\[THRESH(\d+)\]\s*(\d+)\|(\d+)\|(\d+)\|(\d+)/;
const RX_BASE    = /\[(?:AUTO|CAL|INIT)\s*S(\d+)\].*?(\d+)\s*$/;
const RX_BTN     = /\[BTN\](NAV|SEL)/;
const RX_BPMCTRL   = /\[BPMCTRL\](\d+)\|(\d+)/;
const RX_PITCHCTRL = /\[PITCHCTRL\](\d+)\|(-?\d+)/;

// ── State ───────────────────────────────────────────────────────
let _port = null, _reader = null, _running = false, _lineBuf = '';
let _wantMonitor = false, _reconnecting = false;
let _prevLed  = new Array(8).fill(0);   // untuk detect hit event
const HIT_COOLDOWN_MS = 150;
let _lastHitTs = new Array(8).fill(0);  // debounce hit per sensor

function parseLine(raw) {
  const line = raw.trim();
  if (!line) return;
  emitRaw(line, 'rx');

  let m = RX_DATA.exec(line);
  if (m) {
    const v = Array.from({ length: 24 }, (_, i) => +m[i + 1]);
    sensors.update(arr => {
      for (let i = 0; i < 8; i++) {
        const adc = v[i*3], dev = v[i*3+1], led = v[i*3+2];
        // ADS1015 (S1–S4): 2mV/count; ADS1115 (S5–S8): 0.125mV/count
        const volt = i < 4 ? +(adc * 0.002).toFixed(3) : +(adc * 0.000125).toFixed(4);
        arr[i] = { ...arr[i], adc, volt, dev, led };
        plotBuf[i].adc.push(adc); plotBuf[i].adc.shift();
        plotBuf[i].dev.push(dev); plotBuf[i].dev.shift();

        // Detect hit: LED naik dari 0, dengan cooldown 150ms
        const now = Date.now();
        if (led > 0 && _prevLed[i] === 0 && now - _lastHitTs[i] > HIT_COOLDOWN_MS) {
          _lastHitTs[i] = now;
          const tMin = arr[i].thresh[0];
          const tMax = arr[i].thresh[3];
          const velocity = Math.max(1, Math.min(127, Math.round((Math.abs(dev) - tMin) / (tMax - tMin) * 126) + 1));
          hitEvent.set({ idx: i, velocity, ts: now });
        }
        _prevLed[i] = led;
      }
      return arr;
    });
    packetCount.update(n => n + 1);
    chartTick.update(n => n + 1);
    return;
  }
  m = RX_THR.exec(line);
  if (m) {
    const idx = +m[1] - 1;
    if (idx >= 0 && idx < 8) {
      const t = [2,3,4,5].map(i => +m[i]);
      sensors.update(a => { a[idx] = { ...a[idx], thresh: t }; return a; });
    }
    return;
  }
  m = RX_BASE.exec(line);
  if (m) { const idx=+m[1]-1,base=+m[2]; if(idx>=0&&idx<8) sensors.update(a=>{a[idx]={...a[idx],baseline:base};return a;}); return; }
  m = RX_BTN.exec(line);
  if (m) { btnEvent.set({ btn: m[1], ts: Date.now() }); return; }
  m = RX_BPMCTRL.exec(line);
  if (m) { bpmCtrl.set({ sel: +m[1], bpm: +m[2] }); return; }
  m = RX_PITCHCTRL.exec(line);
  if (m) { pitchCtrl.set({ sel: +m[1], pitch: +m[2] }); }
}

async function readLoop() {
  const dec = new TextDecoder();
  _lineBuf = '';
  while (_running) {
    try {
      const { value, done } = await _reader.read();
      if (done) break;
      _lineBuf += dec.decode(value, { stream: true });
      const lines = _lineBuf.split('\n');
      _lineBuf = lines.pop() ?? '';
      for (const l of lines) parseLine(l);
    } catch (err) {
      if (_running) console.warn('[serial] read error:', err.message);
      break;
    }
  }
  // Cleanup — jangan panggil _autoReconnect dari sini (elak infinite recursion)
  _running = false;
  try { _reader?.releaseLock(); } catch {}
  _reader = null;
  try { await _port?.close(); } catch {}
  _port = null;
}

async function _autoReconnect() {
  if (_reconnecting) return;
  _reconnecting = true;
  connected.set(false);
  emitRaw('[SISTEM] Sambungan hilang — cuba reconnect...', 'rx');

  for (let attempt = 1; attempt <= 5; attempt++) {
    await delay(1500);
    try {
      const ports = await navigator.serial.getPorts();
      if (!ports.length) { emitRaw(`[USB] Tiada port (${attempt}/5)`, 'rx'); continue; }
      _port = ports[0];
      await _port.open({ baudRate: 115200, bufferSize: 16384 });
      _reader = _port.readable.getReader();
      _running = true; _reconnecting = false;
      connected.set(true); portState.set('monitor');
      emitRaw('[USB] Sambungan dipulihkan ✓', 'rx');
      readLoop(); // fire-and-forget, jangan await (elak recursive call)
      return;
    } catch (e) { /* cuba lagi */ }
  }
  _reconnecting = false; portState.set('idle'); _wantMonitor = false;
  emitRaw('[SISTEM] Reconnect gagal — klik Sambung semula', 'rx');
}

if (typeof navigator !== 'undefined' && navigator.serial) {
  navigator.serial.addEventListener('disconnect', e => {
    if (_running) {
      _running = false;
      emitRaw('[USB] Peranti terputus...', 'rx');
    }
  });
  navigator.serial.addEventListener('connect', async () => {
    if (_wantMonitor && !_running && !_reconnecting) {
      emitRaw('[USB] Peranti disambung semula...', 'rx');
      await delay(800); _autoReconnect();
    }
  });
}

export async function connect() {
  if (!navigator.serial) { alert('Web Serial API tidak disokong. Sila guna Chrome / Edge.'); return false; }
  try {
    _port = await navigator.serial.requestPort();
    // Selalu close dulu — Chrome mungkin masih pegang port dari sesi sebelumnya
    try { await _port.close(); } catch {}
    await delay(400);
    await _port.open({ baudRate: 115200, bufferSize: 16384 });
    _running = true; _wantMonitor = true;
    connected.set(true); portState.set('monitor');
    // Bagi ESP32 masa untuk selesai auto-reset + kalibrasi baseline (~3.2s)
    // DTR toggle semasa port dibuka mencetuskan reset litar — tanpa delay ini
    // reader bermula terlalu awal dan Chrome lempar "device has been lost"
    await delay(3500);
    _reader = _port.readable.getReader();
    readLoop(); return true;
  } catch (e) {
    if (e.name !== 'NotFoundError') console.error('[serial] gagal:', e);
    _port = null; throw e;
  }
}

export async function disconnect() {
  _wantMonitor = false; _running = false;
  try { await _reader?.cancel(); } catch {}
  try { _reader?.releaseLock(); } catch {}
  _reader = null; await delay(150);
  try { await _port?.close(); } catch {}
  _port = null; connected.set(false); portState.set('idle'); _lineBuf = '';
}

export async function sendCmd(cmd) {
  if (!_port?.writable) return;
  const w = _port.writable.getWriter();
  try { await w.write(new TextEncoder().encode(cmd)); emitRaw(`>> ${cmd}`, 'tx'); }
  finally { w.releaseLock(); }
}

const delay = ms => new Promise(r => setTimeout(r, ms));
