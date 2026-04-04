/**
 * sampleStore.js — Per-sensor sample assignment
 * Button NAV (GPIO 26)  → navigasi ke sample berikutnya + preview + tunjuk picker
 * Button SEL (GPIO 25)  → confirm/simpan sample kursor ke sensor aktif
 */
import { writable, get } from 'svelte/store';

// ── Sample "kosong" untuk sensor yang belum di-assign ───────────
export const EMPTY_SAMPLE = { id: null, label: '— Kosong —', group: '', icon: '🔇', color: '#475569' };
import {
  scheduleKick, scheduleSnare, scheduleHihat, scheduleClap, scheduleRim,
  scheduleTaganing, scheduleOdap, scheduleHesek, scheduleGordang,
  scheduleSynth, scheduleHasapi,
} from './audio.js';

// ── Daftar sample ───────────────────────────────────────────────
export const SAMPLES = [
  // Western
  { id: 'kick',     label: 'Kick',     group: 'Western', icon: '🥁', color: '#22d3ee' },
  { id: 'snare',    label: 'Snare',    group: 'Western', icon: '🥁', color: '#4ade80' },
  { id: 'hihat',    label: 'Hi-Hat',   group: 'Western', icon: '🥁', color: '#fbbf24' },
  { id: 'clap',     label: 'Clap',     group: 'Western', icon: '🥁', color: '#f97316' },
  { id: 'rim',      label: 'Rim',      group: 'Western', icon: '🥁', color: '#a855f7' },
  // Batak
  { id: 'taganing', label: 'Taganing', group: 'Batak',   icon: '🪘', color: '#f59e0b' },
  { id: 'odap',     label: 'Odap',     group: 'Batak',   icon: '🪘', color: '#22d3ee' },
  { id: 'hesek',    label: 'Hesek',    group: 'Batak',   icon: '🪘', color: '#a855f7' },
  { id: 'gordang',  label: 'Gordang',  group: 'Batak',   icon: '🪘', color: '#ef4444' },
  // Synth (pentatonik C major)
  { id: 'syn_c3',   label: 'C3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_e3',   label: 'E3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_g3',   label: 'G3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_a3',   label: 'A3',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  { id: 'syn_c4',   label: 'C4',       group: 'Synth',   icon: '🎹', color: '#8b5cf6' },
  // Hasapi (pentatonik Batak Toba)
  { id: 'has_d4',   label: 'DO (D4)',  group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
  { id: 'has_e4',   label: 'MI (E4)',  group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
  { id: 'has_g4',   label: 'SOL (G4)', group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
  { id: 'has_a4',   label: 'LA (A4)',  group: 'Hasapi',  icon: '🎸', color: '#f472b6' },
];

// Fungsi audio per sample id — fn(time, velocity)
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

// Semua sensor mulai kosong — user harus pilih & save sample sendiri
const DEFAULTS = [null, null, null, null];
const STORAGE_KEY = 'drum_sensor_samples_v1';

function _load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function _persist(arr) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch {}
}

// ── Stores ──────────────────────────────────────────────────────
// Sample yang tersimpan untuk setiap sensor (4 sensor)
export const sensorSamples = writable(_load() ?? [...DEFAULTS]);

// Sensor yang sedang aktif (0–3) — pilih dari UI web
export const selectedSensor = writable(0);

// Posisi kursor di SAMPLES[] per sensor (untuk preview sebelum save)
// Jika sensor belum ada sample, mulai di index 0 (sample pertama)
const _defaultCursor = DEFAULTS.map(id => {
  const idx = SAMPLES.findIndex(s => s.id === id);
  return idx >= 0 ? idx : 0;
});
export const cursorIdx = writable([..._defaultCursor]);

// ── Picker visibility (dipapar apabila button NAV/SEL ditekan) ──
// auto-hide selepas PICKER_TIMEOUT ms tanpa aktiviti
const PICKER_TIMEOUT = 5000;
export const pickerVisible = writable(false);
let _pickerTimer = null;

export function showPicker() {
  pickerVisible.set(true);
  clearTimeout(_pickerTimer);
  _pickerTimer = setTimeout(() => pickerVisible.set(false), PICKER_TIMEOUT);
}

export function hidePicker() {
  clearTimeout(_pickerTimer);
  pickerVisible.set(false);
}

// ── Button NAV / SEL actions ─────────────────────────────────────
// btnNav — tekan button NAV: navigasi ke sample seterusnya + preview + tunjuk picker
export function btnNav(audioCtx = null) {
  const sensor = get(selectedSensor);
  const current = get(cursorIdx);
  const nextIdx = (current[sensor] + 1) % SAMPLES.length;

  cursorIdx.update(arr => {
    const next = [...arr];
    next[sensor] = nextIdx;
    return next;
  });

  // Preview bunyi sample (di luar update callback)
  if (audioCtx) {
    try { SAMPLE_FNS[SAMPLES[nextIdx].id]?.(audioCtx.currentTime, 0.6); } catch {}
  }

  showPicker();
}

// btnSel — tekan button SEL: simpan sample kursor ke sensor aktif + tutup picker
export function btnSel() {
  const sensor = get(selectedSensor);
  const cursor = get(cursorIdx)[sensor];
  // Guard: pastikan cursor valid
  if (cursor < 0 || cursor >= SAMPLES.length) return;
  saveSample(sensor);
  hidePicker();
}

// ── Save / Delete ───────────────────────────────────────────────
export function saveSample(sensorIdx) {
  const cursor = get(cursorIdx)[sensorIdx];
  const sampleId = SAMPLES[cursor].id;
  sensorSamples.update(arr => {
    const next = [...arr];
    next[sensorIdx] = sampleId;
    _persist(next);
    return next;
  });
}

export function deleteSample(sensorIdx) {
  // Reset ke kosong (null), bukan ke default
  sensorSamples.update(arr => {
    const next = [...arr];
    next[sensorIdx] = null;
    _persist(next);
    return next;
  });
}

// Helper: ambil info sample berdasarkan id (null = kosong)
export function getSample(id) {
  if (!id) return EMPTY_SAMPLE;
  return SAMPLES.find(s => s.id === id) ?? EMPTY_SAMPLE;
}
