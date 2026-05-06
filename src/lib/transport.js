/**
 * transport.js — Shared beat grid untuk semua sequencer
 *
 * Sequencer pertama yang mula menetapkan grid origin.
 * Sequencer seterusnya snap ke bar seterusnya (16 step = 1 bar) dalam grid yang sama.
 *
 * masterBpm dikongsi — semua sequencer MESTI guna BPM yang sama supaya tidak drift.
 * Grid reset secara automatik bila semua sequencer berhenti.
 */
import { writable, get } from 'svelte/store';
import { ensureRunning, getAudioCtx } from './audio.js';

const STEPS       = 16;
const STORAGE_KEY = 'transport_bpm_v1';

function _loadBpm() {
  try { return Math.max(40, Math.min(220, parseInt(localStorage.getItem(STORAGE_KEY) || '120'))); }
  catch { return 120; }
}

// Private: grid state
let _originTime = 0;    // AudioContext time pada step 0, beat 0
let _hasOrigin  = false;
let _activeCnt  = 0;    // bilangan sequencer sedang main

function _stepDur(bpm) { return 60 / bpm / 4; }

export const masterBpm = writable(_loadBpm());
masterBpm.subscribe(v => {
  try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
  // Re-anchor _originTime bila BPM berubah semasa sequencer aktif
  if (_hasOrigin && _activeCnt > 0) {
    const ac = getAudioCtx();
    if (!ac) return;
    const now    = ac.currentTime;
    const barDur = _stepDur(v) * STEPS;
    const elapsed = now - _originTime;
    const pastBars = Math.max(0, Math.floor(elapsed / barDur));
    _originTime = _originTime + pastBars * barDur;
  }
});

/**
 * Sync sequencer ke grid global. Panggil dalam start() setiap sequencer.
 * Returns { nextNote: AudioContextTime, curBeat: 0..15 }
 *
 * Sequencer pertama  → bina grid baru, mula 100ms dari sekarang (beat 0).
 * Sequencer seterusnya → tunggu hingga permulaan bar seterusnya dalam grid.
 */
export async function syncToGrid() {
  const ac  = await ensureRunning();
  const bpm = get(masterBpm);
  const dur = _stepDur(bpm);

  _activeCnt++;

  if (!_hasOrigin) {
    _originTime = ac.currentTime + 0.1;
    _hasOrigin  = true;
    return { nextNote: _originTime, curBeat: 0 };
  }

  // Snap ke permulaan bar seterusnya (16 step = 1 bar)
  const barDur  = dur * STEPS;
  const elapsed = (ac.currentTime + 0.05) - _originTime;
  const nextBar = Math.max(0, Math.ceil(elapsed / barDur));
  return { nextNote: _originTime + nextBar * barDur, curBeat: 0 };
}

/**
 * Panggil dalam stop() setiap sequencer.
 * Grid reset secara automatik bila semua sequencer berhenti.
 */
export function leaveGrid() {
  _activeCnt = Math.max(0, _activeCnt - 1);
  if (_activeCnt === 0) {
    _hasOrigin  = false;
    _originTime = 0;
  }
}

/** Reset paksa grid (contoh: Stop All) */
export function resetGrid() {
  _hasOrigin  = false;
  _originTime = 0;
  _activeCnt  = 0;
}

/** Posisi step semasa dalam grid (0–15), atau -1 jika grid belum aktif */
export function getGridPhase() {
  if (!_hasOrigin) return -1;
  const ac = getAudioCtx();
  if (!ac) return -1;
  const elapsed = ac.currentTime - _originTime;
  if (elapsed < 0) return 0;
  return Math.floor(elapsed / _stepDur(get(masterBpm))) % 16;
}

// Master play/stop command — ts naik setiap arahan supaya subscriber sentiasa terpicu
let _cmdSeq = 0;
const _masterCmdStore = writable({ cmd: null, ts: 0 });
export const masterCommand = {
  subscribe: _masterCmdStore.subscribe,
  play: () => _masterCmdStore.set({ cmd: 'play', ts: ++_cmdSeq }),
  stop: () => _masterCmdStore.set({ cmd: 'stop', ts: ++_cmdSeq }),
};
