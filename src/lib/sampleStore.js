/**
 * sampleStore.js — Per-sensor sample assignment
 * Encoder navigasi: mode 'sensor' (pilih sensor) atau 'sample' (pilih sample)
 * Encoder SW   → toggle mode
 * Button SAVE  → simpan sample cursor ke sensor aktif
 * Button DEL   → reset sensor ke default
 */
import { writable, get } from 'svelte/store';
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

const DEFAULTS = ['snare', 'kick', 'taganing', 'hihat'];
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

// Sensor yang sedang dikontrol encoder (0–3)
export const selectedSensor = writable(0);

// Mode encoder: 'sensor' = navigasi antar sensor, 'sample' = pilih sample
export const encoderMode = writable('sensor');

// Posisi kursor di SAMPLES[] per sensor (untuk preview sebelum save)
// Default sesuai posisi DEFAULTS dalam SAMPLES
const _defaultCursor = DEFAULTS.map(id => SAMPLES.findIndex(s => s.id === id));
export const cursorIdx = writable([..._defaultCursor]);

// ── Encoder actions ─────────────────────────────────────────────
export function encRotate(dir) {
  const mode = get(encoderMode);
  if (mode === 'sensor') {
    selectedSensor.update(i => (i + (dir > 0 ? 1 : -1) + 4) % 4);
  } else {
    const sensor = get(selectedSensor);
    cursorIdx.update(arr => {
      const next = [...arr];
      next[sensor] = (next[sensor] + (dir > 0 ? 1 : -1) + SAMPLES.length) % SAMPLES.length;
      return next;
    });
  }
}

export function encButton() {
  encoderMode.update(m => m === 'sensor' ? 'sample' : 'sensor');
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
  sensorSamples.update(arr => {
    const next = [...arr];
    next[sensorIdx] = DEFAULTS[sensorIdx];
    _persist(next);
    return next;
  });
  // Reset kursor ke posisi default juga
  cursorIdx.update(arr => {
    const next = [...arr];
    next[sensorIdx] = _defaultCursor[sensorIdx];
    return next;
  });
}

// Helper: ambil info sample berdasarkan id
export function getSample(id) {
  return SAMPLES.find(s => s.id === id) ?? SAMPLES[0];
}
