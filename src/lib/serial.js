/**
 * serial.js — Web Serial manager ESP32 + ADS1015
 * Format: HALL4|adc1|dev1|led1|adc2|dev2|led2|adc3|dev3|led3|adc4|dev4|led4  @115200
 * Sensor 1 = Snare (A0), Sensor 2 = Kick (A1), Sensor 3 = Tom (A2), Sensor 4 = HiHat (A3)
 */
import { writable } from 'svelte/store';

export const MAX_POINTS  = 400;
export const MAX_HISTORY = 2000;

export const portState   = writable('idle');
export const connected   = writable(false);
export const packetCount = writable(0);

export const sensors = writable([
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [82, 329, 720, 1049], name: 'SNARE'  },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [82, 329, 720, 1049], name: 'KICK'   },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [82, 329, 720, 1049], name: 'TOM'    },
  { adc: 0, volt: 0, dev: 0, led: 0, baseline: 0, thresh: [82, 329, 720, 1049], name: 'HI-HAT' },
]);

export const chartTick  = writable(0);
export const hitEvent   = writable({ idx: -1, velocity: 0, ts: 0 });  // trigger hit anim

// ── Button events ──────────────────────────────────────────────
export const btnEvent = writable({ btn: '', ts: 0 });   // btn: 'NAV' atau 'SEL'

export const plotBuf = [
  { adc: new Array(MAX_POINTS).fill(0), dev: new Array(MAX_POINTS).fill(0) },
  { adc: new Array(MAX_POINTS).fill(0), dev: new Array(MAX_POINTS).fill(0) },
  { adc: new Array(MAX_POINTS).fill(0), dev: new Array(MAX_POINTS).fill(0) },
  { adc: new Array(MAX_POINTS).fill(0), dev: new Array(MAX_POINTS).fill(0) },
];

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
const RX_DATA = /HALL4\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)\|(-?\d+)/;
const RX_THR1 = /\[THRESH1\]\s*(\d+)\|(\d+)\|(\d+)\|(\d+)/;
const RX_THR2 = /\[THRESH2\]\s*(\d+)\|(\d+)\|(\d+)\|(\d+)/;
const RX_THR3 = /\[THRESH3\]\s*(\d+)\|(\d+)\|(\d+)\|(\d+)/;
const RX_THR4 = /\[THRESH4\]\s*(\d+)\|(\d+)\|(\d+)\|(\d+)/;
const RX_BASE = /\[(?:AUTO|CAL|INIT)\s*S(\d)\].*?(\d+)\s*$/;
const RX_BTN  = /\[BTN\](NAV|SEL)/;

// ── State ───────────────────────────────────────────────────────
let _port = null, _reader = null, _running = false, _lineBuf = '';
let _wantMonitor = false, _reconnecting = false;
let _prevLed  = [0, 0, 0, 0];   // untuk detect hit event
const HIT_COOLDOWN_MS = 150;
let _lastHitTs = [0, 0, 0, 0];  // debounce hit per sensor

function parseLine(raw) {
  const line = raw.trim();
  if (!line) return;
  emitRaw(line, 'rx');

  let m = RX_DATA.exec(line);
  if (m) {
    const v = [1,2,3,4,5,6,7,8,9,10,11,12].map(i => +m[i]);
    sensors.update(arr => {
      for (let i = 0; i < 4; i++) {
        const adc = v[i*3], dev = v[i*3+1], led = v[i*3+2];
        arr[i] = { ...arr[i], adc, volt: +(adc * 0.002).toFixed(3), dev, led };
        plotBuf[i].adc.push(adc); plotBuf[i].adc.shift();
        plotBuf[i].dev.push(dev); plotBuf[i].dev.shift();

        // Detect hit: LED naik dari 0, dengan cooldown 150ms
        const now = Date.now();
        if (led > 0 && _prevLed[i] === 0 && now - _lastHitTs[i] > HIT_COOLDOWN_MS) {
          _lastHitTs[i] = now;
          hitEvent.set({ idx: i, velocity: Math.min(100, Math.round(dev / 12)), ts: now });
        }
        _prevLed[i] = led;
      }
      return arr;
    });
    packetCount.update(n => n + 1);
    chartTick.update(n => n + 1);
    return;
  }
  m = RX_THR1.exec(line);
  if (m) { const t = [1,2,3,4].map(i=>+m[i]); sensors.update(a=>{a[0]={...a[0],thresh:t};return a;}); return; }
  m = RX_THR2.exec(line);
  if (m) { const t = [1,2,3,4].map(i=>+m[i]); sensors.update(a=>{a[1]={...a[1],thresh:t};return a;}); return; }
  m = RX_THR3.exec(line);
  if (m) { const t = [1,2,3,4].map(i=>+m[i]); sensors.update(a=>{a[2]={...a[2],thresh:t};return a;}); return; }
  m = RX_THR4.exec(line);
  if (m) { const t = [1,2,3,4].map(i=>+m[i]); sensors.update(a=>{a[3]={...a[3],thresh:t};return a;}); return; }
  m = RX_BASE.exec(line);
  if (m) { const idx=+m[1]-1,base=+m[2]; sensors.update(a=>{a[idx]={...a[idx],baseline:base};return a;}); return; }
  m = RX_BTN.exec(line);
  if (m) { btnEvent.set({ btn: m[1], ts: Date.now() }); }
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
  if (_running && _wantMonitor && !_reconnecting) {
    _running = false; connected.set(false);
    emitRaw('[SISTEM] Sambungan hilang — tunggu USB...', 'rx');
    try { _reader?.releaseLock(); } catch {}
    _reader = null;
    if (_port) { try { await _port.close(); } catch {}; await delay(800); await _autoReconnect(); }
  }
}

async function _autoReconnect() {
  if (_reconnecting) return;
  _reconnecting = true;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const ports = await navigator.serial.getPorts();
      if (!ports.length) { emitRaw(`[USB] Tiada port (${attempt}/10)`, 'rx'); await delay(1000); continue; }
      _port = ports[0];
      try { await _port.close(); } catch {}
      await delay(200);
      await _port.open({ baudRate: 115200, bufferSize: 16384 });
      _reader = _port.readable.getReader();
      _running = true; _reconnecting = false;
      connected.set(true); portState.set('monitor');
      emitRaw('[USB] Sambungan dipulihkan ✓', 'rx');
      await readLoop(); return;
    } catch (e) { await delay(1000); }
  }
  _reconnecting = false; portState.set('idle'); _port = null; _wantMonitor = false;
  emitRaw('[SISTEM] Reconnect gagal — klik Sambung semula', 'rx');
}

if (typeof navigator !== 'undefined' && navigator.serial) {
  navigator.serial.addEventListener('disconnect', e => {
    if (e.target === _port) {
      _running = false; connected.set(false);
      emitRaw('[USB] Peranti terputus...', 'rx');
      try { _reader?.releaseLock(); } catch {}
      _reader = null; _port = null;
    }
  });
  navigator.serial.addEventListener('connect', async () => {
    if (_wantMonitor && !_running && !_reconnecting) {
      emitRaw('[USB] Peranti disambung semula...', 'rx');
      await delay(600); await _autoReconnect();
    }
  });
}

export async function connect() {
  if (!navigator.serial) { alert('Web Serial API tidak disokong. Sila guna Chrome / Edge.'); return false; }
  try {
    _port = await navigator.serial.requestPort();
    if (_port.readable) { try { await _port.close(); } catch {}; await delay(300); }
    await _port.open({ baudRate: 115200, bufferSize: 16384 });
    _reader = _port.readable.getReader();
    _running = true; _wantMonitor = true;
    connected.set(true); portState.set('monitor');
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
