/**
 * kitStore.js — Kit selection & saved sequences
 * Kit 0: Western (BeatSequencer)
 * Kit 1: Batak   (TagadingSequencer)
 * Kit 2: Synth   (SynthSequencer)
 */
import { writable } from 'svelte/store';

export const KITS = [
  { id: 'western', label: 'Western', icon: '🥁', color: '#22d3ee' },
  { id: 'batak',   label: 'Batak',   icon: '🪘', color: '#f59e0b' },
  { id: 'synth',   label: 'Synth',   icon: '🎹', color: '#a855f7' },
];

// Kit aktif saat ini (0/1/2)
export const activeKitIdx = writable(0);

// ID sequence yang dipilih di panel (untuk delete)
export const selectedSeqId = writable(null);

// ── Saved Sequences (localStorage) ────────────────────────────
const STORAGE_KEY = 'drum_sequences_v1';

function _load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function _persist(arr) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('localStorage write failed:', e);
  }
}

const _saved = writable(_load());

export const savedSequences = { subscribe: _saved.subscribe };

/**
 * Simpan snapshot sequencer ke localStorage.
 * @param {number} kitIdx  0=Western 1=Batak 2=Synth
 * @param {object} snapshot  Dari getSnapshot() sequencer
 * @param {string} [name]    Nama opsional
 */
export function saveSequence(kitIdx, snapshot, name = null) {
  const kit  = KITS[kitIdx];
  const ts   = Date.now();
  const time = new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = {
    id:     ts,
    kitIdx,
    kitId:  kit.id,
    name:   name ?? `${kit.label} ${time}`,
    snapshot,
    ts,
  };
  _saved.update(arr => {
    const next = [...arr, entry];
    _persist(next);
    return next;
  });
  // Auto-select yang baru disimpan
  selectedSeqId.set(ts);
}

/**
 * Hapus sequence berdasarkan id.
 * @param {number} id
 */
export function deleteSequence(id) {
  _saved.update(arr => {
    const next = arr.filter(s => s.id !== id);
    _persist(next);
    return next;
  });
  selectedSeqId.set(null);
}

/**
 * Ambil satu sequence berdasarkan id (synchronous, baca dari localStorage).
 * @param {number} id
 * @returns {object|null}
 */
export function getSequence(id) {
  return _load().find(s => s.id === id) ?? null;
}
