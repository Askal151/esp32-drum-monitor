/**
 * sampleStore.js — Per-sensor sample assignment
 *
 * State machine button:
 *   idle   →[NAV]→ sensor  (pilih sensor mana)
 *   sensor →[NAV]→ sensor  (S1→S2→S3→S4→S1...)
 *   sensor →[SEL]→ action  (pilih tindakan: Pasang / Buang)
 *   action →[NAV]→ action  (toggle Pasang ↔ Buang)
 *   action →[SEL]→ sample  (jika Pasang) ATAU idle+delete (jika Buang)
 *   sample →[NAV]→ sample  (scroll sample list + preview bunyi)
 *   sample →[SEL]→ idle    (simpan sample ke sensor)
 *
 *   Bila-bila masa →[NAV 2s tiada aksi]→ idle (auto-cancel)
 */
import { writable, get } from 'svelte/store';

// ── Sample kosong ───────────────────────────────────────────────
export const EMPTY_SAMPLE = { id: null, label: '— Kosong —', group: '', icon: '🔇', color: '#475569' };

import {
  scheduleKick, scheduleSnare, scheduleHihat, scheduleClap, scheduleRim,
  scheduleTaganing, scheduleOdap, scheduleHesek, scheduleGordang,
  scheduleSynth, scheduleHasapi,
} from './audio.js';

// ── Daftar sample ───────────────────────────────────────────────
export const SAMPLES = [
  { id: 'kick',     label: 'Kick',     group: 'Western', icon: '🥁', color: '#22d3ee' },
  { id: 'snare',    label: 'Snare',    group: 'Western', icon: '🥁', color: '#4ade80' },
  { id: 'hihat',    label: 'Hi-Hat',   group: 'Western', icon: '🥁', color: '#fbbf24' },
  { id: 'clap',     label: 'Clap',     group: 'Western', icon: '🥁', color: '#f97316' },
  { id: 'rim',      label: 'Rim',      group: 'Western', icon: '🥁', color: '#a855f7' },
  { id: 'taganing', label: 'Taganing', group: 'Batak',   icon: '🪘', color: '#f59e0b' },
  { id: 'odap',     label: 'Odap',     group: 'Batak',   icon: '🪘', color: '#22d3ee' },
  { id: 'hesek',    label: 'Hesek',    group: 'Batak',   icon: '🪘', color: '#a855f7' },
  { id: 'gordang',  label: 'Gordang',  group: 'Batak',   icon: '🪘', color: '#ef4444' },
  { id: 'syn_c3',   label: 'C3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_e3',   label: 'E3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_g3',   label: 'G3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_a3',   label: 'A3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_c4',   label: 'C4',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'has_d4',   label: 'DO (D4)',  group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
  { id: 'has_e4',   label: 'MI (E4)',  group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
  { id: 'has_g4',   label: 'SOL (G4)', group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
  { id: 'has_a4',   label: 'LA (A4)',  group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
];

export const SAMPLE_FNS = {
  kick:     (t, v) => scheduleKick(t, v),
  snare:    (t, v) => scheduleSnare(t, v),
  hihat:    (t, v) => scheduleHihat(t, v, false),
  clap:     (t, v) => scheduleClap(t, v),
  rim:      (t, v) => scheduleRim(t, v),
  taganing: (t, v) => scheduleTaganing(t, v),
  odap:     (t, v) => scheduleOdap(t, v),
  hesek:    (t, v) => scheduleHesek(t, v),
  gordang:  (t, v) => scheduleGordang(t, v),
  syn_c3:   (t, v) => scheduleSynth(130.81, t, v),
  syn_e3:   (t, v) => scheduleSynth(164.81, t, v),
  syn_g3:   (t, v) => scheduleSynth(196.00, t, v),
  syn_a3:   (t, v) => scheduleSynth(220.00, t, v),
  syn_c4:   (t, v) => scheduleSynth(261.63, t, v),
  has_d4:   (t, v) => scheduleHasapi(293.66, t, v),
  has_e4:   (t, v) => scheduleHasapi(329.63, t, v),
  has_g4:   (t, v) => scheduleHasapi(392.00, t, v),
  has_a4:   (t, v) => scheduleHasapi(440.00, t, v),
};

// ── Persistence ─────────────────────────────────────────────────
const DEFAULTS     = [null, null, null, null];
const STORAGE_KEY  = 'drum_sensor_samples_v1';
function _load()         { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } }
function _persist(arr)   { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch {} }

// ── Stores ──────────────────────────────────────────────────────
export const sensorSamples  = writable(_load() ?? [...DEFAULTS]);
export const selectedSensor = writable(0);

// Kursor sample per sensor (mulai index 0)
export const cursorIdx = writable([0, 0, 0, 0]);

// ── State machine ────────────────────────────────────────────────
// States: 'idle' | 'sensor' | 'action' | 'sample'
export const pickerState = writable('idle');

// Tindakan: 0 = Pasang Sample, 1 = Buang Sample
export const actionCursor = writable(0);
export const ACTIONS = [
  { id: 'assign', label: 'Pasang Sample', icon: '🎵' },
  { id: 'remove', label: 'Buang Sample',  icon: '🗑' },
];

// Auto-cancel selepas 8 saat tiada aksi
const IDLE_TIMEOUT = 8000;
let _idleTimer = null;
function _resetTimer() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => pickerState.set('idle'), IDLE_TIMEOUT);
}

// ── Button NAV ───────────────────────────────────────────────────
export function btnNav(audioCtx = null) {
  const state = get(pickerState);
  console.log('[STORE] btnNav called, state =', state);

  if (state === 'idle') {
    // Masuk mod pilih sensor, mulai dari 0
    selectedSensor.set(0);
    pickerState.set('sensor');
    console.log('[STORE] pickerState → sensor');

  } else if (state === 'sensor') {
    // Cycle sensor: 0 → 1 → 2 → 3 → 0
    selectedSensor.update(i => (i + 1) % 4);

  } else if (state === 'action') {
    // Toggle antara Pasang / Buang
    actionCursor.update(i => (i + 1) % ACTIONS.length);

  } else if (state === 'sample') {
    // Next sample + preview bunyi
    const sensor   = get(selectedSensor);
    const nextIdx  = (get(cursorIdx)[sensor] + 1) % SAMPLES.length;
    cursorIdx.update(arr => { const n = [...arr]; n[sensor] = nextIdx; return n; });
    if (audioCtx) {
      try { SAMPLE_FNS[SAMPLES[nextIdx].id]?.(audioCtx.currentTime, 0.6); } catch {}
    }
  }

  _resetTimer();
}

// ── Button SEL ───────────────────────────────────────────────────
export function btnSel() {
  const state = get(pickerState);

  if (state === 'idle') {
    return;

  } else if (state === 'sensor') {
    // Sensor dipilih → pergi ke pilih tindakan
    actionCursor.set(0);
    pickerState.set('action');

  } else if (state === 'action') {
    const action = ACTIONS[get(actionCursor)];
    if (action.id === 'assign') {
      // Pergi ke pilih sample
      pickerState.set('sample');
    } else {
      // Buang sample dari sensor ini
      deleteSample(get(selectedSensor));
      pickerState.set('idle');
      clearTimeout(_idleTimer);
      return;
    }

  } else if (state === 'sample') {
    // Simpan sample kursor ke sensor
    saveSample(get(selectedSensor));
    pickerState.set('idle');
    clearTimeout(_idleTimer);
    return;
  }

  _resetTimer();
}

// ── Shortcut: buka picker terus ke pilih sensor ─────────────────
export function openPicker() {
  selectedSensor.set(0);
  actionCursor.set(0);
  pickerState.set('sensor');
  _resetTimer();
}

// ── Tutup picker ─────────────────────────────────────────────────
export function closePicker() {
  clearTimeout(_idleTimer);
  pickerState.set('idle');
}

// ── Save / Delete ────────────────────────────────────────────────
export function saveSample(sensorIdx) {
  const cursor   = get(cursorIdx)[sensorIdx];
  const sampleId = SAMPLES[cursor]?.id;
  if (!sampleId) return;
  sensorSamples.update(arr => { const n = [...arr]; n[sensorIdx] = sampleId; _persist(n); return n; });
}

export function deleteSample(sensorIdx) {
  sensorSamples.update(arr => { const n = [...arr]; n[sensorIdx] = null; _persist(n); return n; });
}

export function getSample(id) {
  if (!id) return EMPTY_SAMPLE;
  return SAMPLES.find(s => s.id === id) ?? EMPTY_SAMPLE;
}
