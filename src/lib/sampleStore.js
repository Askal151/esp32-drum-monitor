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
  scheduleTom, scheduleCymbal, scheduleTambourine, scheduleCowbell,
  scheduleTaganing, scheduleOdap, scheduleHesek, scheduleGordang,
  scheduleKendang, scheduleRebana, scheduleBedug,
  scheduleConga, scheduleBongo,
  scheduleKick808, scheduleElecSnare,
  scheduleSynth, scheduleHasapi,
  scheduleWav, scheduleWavBuffer, decodeAudioFile, decodeAudioBuffer,
  startPreviewBuffer, stopPreviewBuffer, previewWavUrl,
} from './audio.js';

// Path base untuk WAV (sesuai dengan vite base path)
const WAV_BASE = '/esp32-drum-monitor/samples';

// ── 30 Pola Beat 16-Langkah — Semua Genre ───────────────────────
// Nilai velocity: 1=aksen penuh, 0.75=pukul biasa, 0.5=pukul sederhana,
//                 0.25=ghost note (sangat lembut), 0=senyap
// 16 step = 16th note (1 bar 4/4)
// Indeks: 0=Beat1, 2=Beat1+, 4=Beat2, 6=Beat2+, 8=Beat3, 10=Beat3+, 12=Beat4, 14=Beat4+
export const BEAT_DATA = {
  // ── TECHNO ───────────────────────────────────────────────────
  // 4-on-the-floor dengan dinamik hihat dan ghost snare
  techno_basic: { bpm: 135, tracks: {
    kick808: [1,   0,    0,    0,    1,   0,    0,    0,    1,   0,    0,    0,    1,   0,    0,    0   ],
    esnare:  [0,   0,    0,    0,    1,   0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0   ],
    hihat:   [0.75,0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0   ],
    rim:     [0,   0,    0,    0.25, 0,   0,    0,    0,    0,   0,    0,    0.25, 0,   0,    0,    0   ],
  }},
  // Kick syncopated, hihat berganda-ganda, snare elektronik kasar
  techno_industrial: { bpm: 140, tracks: {
    kick808: [1,   0,    0,    0.5,  0,   0,    0.75, 0,    1,   0,    0,    0,    0.75,0,    0,    0.5 ],
    esnare:  [0,   0,    0.5,  0,    1,   0,    0,    0.25, 0,   0,    0.5,  0,    0.75,0,    0.25, 0   ],
    hihat:   [1,   0.5,  0.75, 0.5,  0.75,0.5,  1,   0.5,  0.75,0.5,  0.75, 0.5,  1,   0.5,  0.75, 0.5 ],
    rim:     [0,   0.5,  0,    0,    0,   0,    0.5,  0,    0,   0,    0,    0.5,  0,   0.75, 0,    0   ],
  }},
  // Sangat minimal — hanya elemen utama dengan ruang nafas
  techno_minimal: { bpm: 130, tracks: {
    kick808: [1,   0,    0,    0,    0,   0,    0,    0.25, 0.75,0,    0,    0,    0,   0,    0,    0   ],
    rim:     [0,   0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0,    0.75,0,    0,    0.25],
    hihat:   [0,   0,    0.5,  0,    0,   0,    0.5,  0,    0,   0,    0.5,  0,    0,   0,    0.5,  0   ],
    cymbal:  [0,   0,    0,    0,    0,   0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0   ],
  }},

  // ── ELECTRONIC / HOUSE ───────────────────────────────────────
  // 4-on-the-floor house dengan offbeat tambourine dan clap dinamik
  house_classic: { bpm: 125, tracks: {
    kick:       [1,   0,    0,    0,    1,   0,    0,    0,    1,   0,    0,    0,    1,   0,    0,    0   ],
    clap:       [0,   0,    0,    0,    0.75,0,    0,    0.25, 0,   0,    0,    0,    1,   0,    0,    0.25],
    hihat:      [0.75,0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0   ],
    tambourine: [0,   0,    0,    0.5,  0,   0,    0,    0.5,  0,   0,    0,    0.5,  0,   0,    0,    0.5 ],
  }},
  // Irregular, glitchy — kick dan snare di tempat tidak dijangka
  glitch_beat: { bpm: 128, tracks: {
    kick808: [1,   0,    0,    0,    0,   0.5,  0,    0,    0.75,0,    0.5,  0.25, 0,   0,    0.75, 0   ],
    esnare:  [0,   0,    0.75, 0,    1,   0,    0,    0,    0,   0.5,  0,    0,    0.75,0,    0,    0.5 ],
    hihat:   [1,   0.75, 0,    0.5,  0.25,0,    0.75, 0,    0.5, 0,    0,    0.75, 1,   0,    0.75, 0.5 ],
    rim:     [0,   0,    0,    0.5,  0,   0.75, 0,    0,    0.5, 0,    0,    0,    0,   0.75, 0,    0   ],
  }},

  // ── DRUM & BASS / BREAKBEAT ───────────────────────────────────
  // Kick half-time, snare sincopated, hihat rolling dengan ghost note
  drum_bass: { bpm: 174, tracks: {
    kick:  [1,   0,    0,    0,    0,   0,    0,    0,    0.75,0,    0,    0.5,  0,   0,    0,    0   ],
    snare: [0,   0,    0,    0,    1,   0,    0,    0.25, 0,   0,    0,    0,    0.75,0,    0.5,  0   ],
    hihat: [1,   0,    1,    0.75, 0,   0.75, 0.5,  0,    1,   0,    1,    0.5,  0,   0.5,  0.75, 0   ],
  }},
  // Kick berganda, snare breakbeat, hihat dense
  jungle_break: { bpm: 170, tracks: {
    kick:  [1,   0,    0,    0.5,  0,   0,    0,    0,    1,   0,    0,    0,    0,   0.25, 0,    0   ],
    snare: [0,   0,    0,    0,    0.75,0,    0.5,  0,    0,   0.25, 0,    0,    1,   0,    0.25, 0   ],
    hihat: [1,   0.75, 0.5,  1,    0,   0.5,  1,    0.25, 1,   0.75, 0.5,  1,    0,   1,    0,    0.5 ],
  }},
  // Classic amen break dengan aksen yang tepat
  amen_break: { bpm: 160, tracks: {
    kick:  [1,   0,    0,    0,    0.75,0,    0,    0,    0,   0,    0.75, 0,    0,   0.5,  0,    0   ],
    snare: [0,   0,    0,    0,    1,   0,    0,    0,    0,   0.5,  0,    0,    1,   0,    0.75, 0   ],
    hihat: [1,   0,    0.75, 0.5,  1,   0,    0.75, 0,    1,   0,    0.5,  0.75, 1,   0,    0.75, 0.5 ],
  }},

  // ── HIP HOP / TRAP ───────────────────────────────────────────
  // Kick syncopated, snare 2&4, hihat 8th, ghost rim untuk groove
  hiphop_boom: { bpm: 90, tracks: {
    kick:  [1,   0,    0,    0,    0,   0,    0.75, 0,    0,   0.5,  0,    0,    0,   0,    0.75, 0   ],
    snare: [0,   0,    0,    0.25, 0.75,0,    0,    0,    0,   0,    0.25, 0,    1,   0,    0,    0.25],
    hihat: [1,   0,    0.75, 0,    1,   0,    0.75, 0,    1,   0,    0.75, 0,    1,   0,    0.75, 0   ],
    rim:   [0,   0.25, 0,    0,    0,   0,    0,    0.25, 0,   0,    0,    0.25, 0,   0.5,  0,    0   ],
  }},
  // 808 kick, hihat 32nd (sim. dengan 16th berganda), snare aksen
  trap_808: { bpm: 140, tracks: {
    kick808: [1,   0,    0,    0,    0,   0.75, 0,    0,    1,   0,    0,    0,    0,   0,    0.75, 0   ],
    snare:   [0,   0,    0,    0,    1,   0,    0,    0.25, 0,   0,    0,    0,    1,   0,    0,    0   ],
    hihat:   [0.75,0.5,  0.75, 1,    0.5, 0.75, 1,    0.5,  0.75,1,    0.5,  0.75, 1,   0.5,  0.75, 1   ],
  }},

  // ── NUSANTARA ────────────────────────────────────────────────
  // Taganing melody + gordang bass + hesek constant + odap counter
  nusantara_batak: { bpm: 120, tracks: {
    taganing: [1,   0,    0.75, 0,    0.5,  0,    1,    0,    0,   0.75, 0,    0,    1,   0,    0.5,  0.25],
    gordang:  [1,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0.5 ],
    hesek:    [0.75,0.5,  0.75, 0.5,  0.75, 0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5 ],
    odap:     [0,   0,    0.5,  0,    1,    0,    0,    0,    0,   0,    0.5,  0,    0.75,0,    0,    0   ],
  }},
  // Kendang lancaran + bedug bass accent + rebana offbeat
  nusantara_jawa: { bpm: 100, tracks: {
    kendang: [1,   0,    0,    0.5,  0,    0,    0.75, 0,    0,   0.5,  0,    0,    1,   0,    0,    0.25],
    bedug:   [1,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0.75, 0,    0,   0,    0,    0   ],
    rebana:  [0,   0.5,  0,    0.75, 0,    0.5,  0,    0.5,  0,   0.75, 0,    0.5,  0,   0.75, 0,    0.5 ],
  }},
  // Rebana melody + tambourine dense + kendang aksen
  nusantara_melayu: { bpm: 110, tracks: {
    rebana:     [1,   0,    0,    0.75, 0.5,  0,    0,    0,    1,   0,    0,    0.75, 0.5,  0,    0.5,  0   ],
    tambourine: [0.75,0.5,  0.75, 0.5,  0.75, 0,    1,    0.5,  0.75,0.5,  0.75, 0.5,  0.75, 0,    1,    0.5 ],
    kendang:    [1,   0,    0,    0,    0,    0,    0.75, 0,    0.5, 0,    0,    0,    1,   0,    0,    0.75],
  }},
  // Bedug berat + rebana jawab + hesek perlahan
  nusantara_bedug: { bpm: 70, tracks: {
    bedug:  [1,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0,    0,    0,   0,    0.75, 0   ],
    rebana: [0,   0,    0,    0,    0.75, 0,    0,    0.5,  0,   0.5,  0,    0,    0.75,0,    0,    0   ],
    hesek:  [0.75,0,    0.75, 0,    0.75, 0,    0.75, 0,    0.75,0,    0.75, 0,    0.75,0,    0.75, 0   ],
  }},
  // Kendang jaipongan — poliritmik kompleks
  nusantara_sunda: { bpm: 115, tracks: {
    kendang: [1,   0,    0,    0.5,  0.75, 0,    0,    0,    0,   1,    0,    0,    0.75,0,    0.5,  0   ],
    rebana:  [0,   0.5,  0,    0,    0,    0,    0.75, 0,    0.5, 0,    0,    0.5,  0,   0.75, 0,    0   ],
    hesek:   [0.5, 0.5,  0.75, 0.5,  0.5,  0.5,  0.75, 0.5,  0.5, 0.5,  0.75, 0.5,  0.5, 0.5,  0.75, 0.5 ],
    odap:    [0,   0,    0,    0,    0,    0,    0,    1,    0,   0,    0,    0,    0,   0,    0,    0.75],
  }},
  // Kendang betawi kompleks + gordang bass + tambourine offbeat
  nusantara_betawi: { bpm: 108, tracks: {
    kendang:    [1,   0,    0.5,  0,    0.75, 0,    0,    0.25, 1,   0,    0.5,  0,    0.75,0,    0.25, 0   ],
    gordang:    [1,   0,    0,    0,    0,    0,    0.75, 0,    0,   0,    0,    0,    1,   0,    0,    0   ],
    tambourine: [0,   0.5,  0,    0.5,  0,    0.5,  0,    0.5,  0,   0.5,  0,    0.5,  0,   0.5,  0,    0.5 ],
  }},
  // Batak-House: gordang sebagai kick, taganing melody, hihat tekno
  nusantara_tagading_fusion: { bpm: 128, tracks: {
    gordang:  [1,   0,    0,    0,    1,    0,    0,    0,    1,   0,    0,    0,    1,   0,    0,    0   ],
    taganing: [0,   0,    0.75, 0,    1,    0,    0,    0.5,  0,   0.75, 0,    0,    1,   0,    0,    0.25],
    hihat:    [0.75,0,    1,    0,    0.75, 0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0   ],
    esnare:   [0,   0,    0,    0,    1,    0,    0,    0,    0,   0,    0,    0,    0.75,0,    0.25, 0   ],
  }},

  // ── LATIN ────────────────────────────────────────────────────
  // Tumbao conga + bongo counter + hihat 8th
  latin_conga: { bpm: 120, tracks: {
    conga:  [0,   0,    0.75, 0,    1,    0,    0,    0.5,  0,   0,    0.75, 0,    1,   0,    0,    0.5 ],
    bongo:  [0.5, 0,    0,    0.75, 0,    0.5,  0,    0,    0.75,0,    0,    0.5,  0,   0.75, 0,    0   ],
    hihat:  [0.75,0,    0.75, 0,    0.75, 0,    0.75, 0,    0.75,0,    0.75, 0,    0.75,0,    0.75, 0   ],
  }},
  // Samba: caixa (snare ghost), surdo (kick), tamborim dense
  latin_samba: { bpm: 130, tracks: {
    kick:       [1,   0,    0,    0,    0,    0.5,  0,    0,    1,   0,    0,    0,    0,   0.5,  0,    0   ],
    snare:      [0,   0.25, 0,    0,    1,    0,    0.25, 0,    0,   0.25, 0,    0,    0.75,0,    0.25, 0   ],
    tambourine: [1,   0.5,  0.75, 0.5,  0.75, 0.5,  1,    0.5,  0.75,0.5,  0.75, 0.5,  1,   0.5,  0.75, 0.5 ],
    conga:      [0,   0,    0.5,  0,    0,    0,    0.5,  0,    0,   0,    0.5,  0,    0.75,0,    0.5,  0   ],
  }},
  // Bossa Nova: coxa (kick), rim samba, tambourine bossa rhythm
  latin_bossa: { bpm: 88, tracks: {
    kick:       [1,   0,    0,    0,    0,    0.75, 0,    0,    0,   0,    1,    0,    0,   0.75, 0,    0   ],
    rim:        [0,   0,    1,    0,    0,    0,    0,    0.75, 0,   0,    0.5,  0,    0.75,0,    0,    0   ],
    tambourine: [0.75,0,    0,    0.5,  0,    0,    0.75, 0,    0.5, 0,    0,    0,    0.75,0,    0,    0.5 ],
  }},

  // ── ROCK / POP / FUNK ────────────────────────────────────────
  // Rock klasik dengan tom fill bar ke-4 dan kick syncopated
  rock_basic: { bpm: 120, tracks: {
    kick:  [1,   0,    0,    0,    0,    0,    0.75, 0,    1,   0,    0,    0,    0,   0,    0.75, 0   ],
    snare: [0,   0,    0,    0,    1,    0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0   ],
    hihat: [0.75,0,    0.75, 0,    0.75, 0,    0.75, 0,    0.75,0,    0.75, 0,    0.75,0,    1,    0   ],
    tom:   [0,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0,    0,    0,   0,    0.75, 0.5 ],
  }},
  // Pop dance: 4-on-floor + clap aksen + hihat offbeat + tambourine
  pop_dance: { bpm: 118, tracks: {
    kick:       [1,   0,    0,    0,    1,    0,    0,    0,    1,   0,    0,    0.25, 1,   0,    0,    0   ],
    clap:       [0,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0.25],
    hihat:      [0.75,0,    1,    0,    0.75, 0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0.5 ],
    tambourine: [0,   0.5,  0,    0.5,  0,    0.5,  0,    0.5,  0,   0.5,  0,    0.5,  0,   0.5,  0,    0.5 ],
  }},
  // Funk groove: kick 16th syncopated, snare ghost, hihat dense, cowbell
  funk_groove: { bpm: 100, tracks: {
    kick:    [1,   0,    0,    0.5,  0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    1,    0   ],
    snare:   [0,   0,    0.25, 0,    1,    0,    0,    0.25, 0,   0.25, 0,    0,    0.75,0,    0.25, 0   ],
    hihat:   [1,   0.5,  0.75, 0.5,  1,    0.5,  0.75, 0.5,  1,   0.5,  0.75, 0.5,  1,   0.5,  0.75, 0.5 ],
    cowbell: [0.75,0,    0,    0.5,  0,    0,    0.75, 0,    0.5, 0,    0,    0,    0.75,0,    0,    0.5 ],
  }},

  // ── WORLD ────────────────────────────────────────────────────
  // Poliritme Afrika — conga + bongo + tambourine berbeza fasa
  tribal_beat: { bpm: 110, tracks: {
    conga:      [1,   0,    0.75, 0,    0.5,  0,    1,    0,    0,   0.75, 0,    0.5,  1,   0,    0.5,  0   ],
    bongo:      [0,   0.5,  0,    0,    0.75, 0,    0,    0.5,  0,   0,    0.75, 0,    0.5, 0,    0,    0.75],
    tambourine: [0.75,0,    0.5,  0,    0.75, 0,    0.5,  0,    0.75,0,    0.5,  0,    0.75,0,    1,    0   ],
  }},
  // Afrobeat Fela: kick cross-rhythm, snare accent, hihat poly, cowbell key
  afrobeat: { bpm: 100, tracks: {
    kick:    [1,   0,    0,    0,    0,    0,    0.75, 0,    0,   0.5,  0,    0,    0,   0,    0,    1   ],
    snare:   [0,   0,    0.5,  0,    0.75, 0,    0,    0,    0,   0,    0.75, 0,    0.5, 0,    0,    0   ],
    hihat:   [0.75,0,    1,    0.5,  0,    0.75, 0.5,  0,    0.75,0,    1,    0.5,  0,   0.75, 0.5,  0   ],
    cowbell: [1,   0,    0,    0.75, 0,    0,    0.5,  0,    1,   0,    0,    0,    0,   0.75, 0,    0   ],
  }},
  // Reggae one-drop: kick beat 3 sahaja, snare offbeat, hihat upstroke
  reggae_ska: { bpm: 95, tracks: {
    kick:  [0,   0,    0,    0,    0,    0,    0,    0,    1,   0,    0,    0,    0,   0,    0,    0   ],
    snare: [0,   0,    0,    0,    0,    0,    0.75, 0,    0,   0,    0,    0,    0,   0,    1,    0   ],
    hihat: [0,   0.75, 0,    0.75, 0,    0.75, 0,    0.75, 0,   0.75, 0,    0.75, 0,   0.75, 0,    0.75],
    rim:   [0,   0,    0.5,  0,    0,    0,    0,    0.5,  0,   0,    0.5,  0,    0,   0,    0,    0.5 ],
  }},

  // ── FUSION ───────────────────────────────────────────────────
  // Jazz-breakbeat: swing feel, hihat sinkopasi, tambourine halus
  fusion_jazzbreak: { bpm: 110, tracks: {
    kick:       [1,   0,    0,    0.25, 0,    0,    0.75, 0,    0.5,  0,    0,    0,    0,   0,    0.5,  0   ],
    rim:        [0,   0,    0.75, 0,    0.5,  0,    0,    0,    0,    0.75, 0,    0.25, 1,   0,    0,    0   ],
    hihat:      [0.75,0,    1,    0,    0.5,  0,    0.75, 0,    0.75, 0,    1,    0,    0.5,  0,    0.75, 0   ],
    tambourine: [0,   0,    0,    0.5,  0,    0,    0,    0,    0,    0,    0,    0.5,  0,    0,    0,    0   ],
  }},
  // Tropical fusion: kick steady, conga synco, rebana offbeat, hihat
  fusion_tropical: { bpm: 120, tracks: {
    kick:    [1,   0,    0,    0,    0.75, 0,    0,    0,    1,   0,    0,    0,    0.75,0,    0,    0   ],
    conga:   [0,   0,    0.75, 0,    0,    0.5,  0,    0,    0.75,0,    0.5,  0,    0,   0.75, 0,    0   ],
    rebana:  [0,   0.5,  0,    0.75, 0,    0.5,  0,    0.75, 0,   0.5,  0,    0.75, 0,   0.5,  0,    0.75],
    hihat:   [0.75,0,    1,    0,    0.5,  0,    0.75, 0,    0.75,0,    1,    0,    0.5,  0,    0.75, 0.25],
  }},

  // ── AMBIENT ──────────────────────────────────────────────────
  // Sangat spartan — kick bar awal, cymbal bar tengah, hihat sesekali
  ambient_sparse: { bpm: 70, tracks: {
    kick:   [1,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0,    0,    0,   0,    0.5,  0   ],
    cymbal: [0,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0   ],
    hihat:  [0,   0,    0.5,  0,    0,    0,    0,    0,    0,   0,    0.5,  0,    0,   0,    0,    0.25],
  }},

  // ── JAZZ ─────────────────────────────────────────────────────
  jazz_swing: { bpm: 140, tracks: {
    kick:  [1,   0,    0,    0,    0,    0,    0.5,  0,    0.75,0,    0,    0,    0,   0,    0.5,  0   ],
    snare: [0,   0,    0,    0,    1,    0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0   ],
    hihat: [0.75,0,    0.75, 0,    0.75, 0,    0.75, 0,    0.75,0,    0.75, 0,    0.75,0,    0.75, 0   ],
    rim:   [0,   0.25, 0,    0,    0,    0,    0,    0.25, 0,   0,    0,    0,    0,   0.25, 0,    0   ],
    cymbal:[1,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0,    0,    0.75,0,    0,    0   ],
  }},

  // ── BLUES ────────────────────────────────────────────────────
  blues_shuffle: { bpm: 88, tracks: {
    kick:  [1,   0,    0,    0.5,  0.5,  0,    0,    0,    0.75,0,    0,    0.5,  0.5, 0,    0,    0   ],
    snare: [0,   0,    0,    0,    1,    0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0   ],
    hihat: [0.75,0.5,  0.75, 0.5,  0.75, 0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5 ],
    rim:   [0,   0,    0.25, 0,    0,    0,    0,    0,    0,   0,    0.25, 0,    0,   0,    0,    0   ],
  }},

  // ── GOSPEL ───────────────────────────────────────────────────
  gospel_4beat: { bpm: 85, tracks: {
    kick:       [1,   0,    0,    0,    1,    0,    0,    0,    1,   0,    0,    0,    1,   0,    0,    0   ],
    snare:      [0,   0,    0,    0,    1,    0,    0.25, 0,    0,   0,    0,    0,    1,   0,    0.5,  0   ],
    hihat:      [0.75,0,    0.75, 0,    1,    0,    0.75, 0,    0.75,0,    0.75, 0,    1,   0,    0.75, 0.5 ],
    clap:       [0,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    0,    0,    1,   0,    0.25, 0   ],
    tambourine: [0.5, 0,    0.5,  0,    0.5,  0,    0.5,  0,    0.5, 0,    0.5,  0,    0.5, 0,    0.5,  0   ],
  }},

  // ── AFRO-CUBAN ───────────────────────────────────────────────
  afrocuban_guaguanco: { bpm: 105, tracks: {
    conga:  [1,   0,    0,    0.75, 0,    0,    0.5,  0,    1,   0,    0,    0,    0.75,0,    0.5,  0   ],
    bongo:  [0,   0.5,  0,    0,    0.75, 0,    0,    0.5,  0,   0,    0.75, 0,    0.5, 0,    0,    0.25],
    cowbell:[1,   0,    0.75, 0,    0.5,  0,    0,    1,    0,   0.75, 0,    0.5,  0,   1,    0,    0   ],
    rim:    [0,   0,    0,    0.5,  0,    0.75, 0,    0,    0.5, 0,    0,    0,    0,   0,    0.75, 0   ],
  }},

  // ── CALYPSO ──────────────────────────────────────────────────
  calypso: { bpm: 120, tracks: {
    kick:       [0.75,0,    0,    0,    0,    0,    0.75, 0,    0,   0,    0.75, 0,    0,   0,    0,    0.5 ],
    snare:      [0,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    0,    0,    0.75,0,    0,    0   ],
    hihat:      [0.75,0.5,  0.75, 0.5,  0.75, 0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5 ],
    rim:        [0,   0.5,  0,    0.5,  0,    0.5,  0,    0,    0.5, 0,    0.5,  0,    0,   0.5,  0,    0   ],
    tambourine: [1,   0,    0.75, 0,    0.5,  0,    1,    0,    0,   0.5,  0,    0.75, 0,   0,    1,    0   ],
  }},

  // ── CUMBIA ───────────────────────────────────────────────────
  cumbia: { bpm: 95, tracks: {
    kick:       [1,   0,    0,    0,    0,    0,    0,    0,    1,   0,    0,    0,    0,   0,    1,    0   ],
    snare:      [0,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    0.5,  0,    1,   0,    0,    0   ],
    hihat:      [0.75,0,    1,    0,    0.75, 0,    1,    0,    0.75,0,    1,    0,    0.75,0,    1,    0   ],
    conga:      [0,   0.5,  0,    0.75, 0,    0.5,  0,    0,    0.75,0,    0.5,  0,    0,   0.75, 0,    0.5 ],
    tambourine: [0.5, 0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5, 0.5,  0.5,  0.5,  0.5, 0.5,  0.5,  0.5 ],
  }},

  // ── DANCEHALL ────────────────────────────────────────────────
  dancehall: { bpm: 90, tracks: {
    kick808:[1,   0,    0,    0,    0,    0,    0.75, 0,    0,   0,    1,    0,    0,   0,    0.5,  0   ],
    snare:  [0,   0,    0,    0,    0.75, 0,    0,    0.25, 0,   0,    0,    0,    1,   0,    0,    0   ],
    hihat:  [0.5, 0.5,  0.75, 0.5,  0.5,  0.5,  0.75, 0.5,  0.5, 0.5,  0.75, 0.5,  0.5, 0.5,  1,    0.5 ],
    rim:    [0,   0,    0.5,  0,    0,    0.5,  0,    0,    0,   0,    0.5,  0,    0.5, 0,    0,    0.25],
  }},

  // ── INDIA KLASIK ─────────────────────────────────────────────
  // Teentaal (16 matra): conga=dha/dhin, bongo=na/tin, rim=ke
  tabla_teentaal: { bpm: 80, tracks: {
    conga: [1,   0,    0,    0.5,  0,    0,    0.75, 0,    0.75,0,    0,    0,    1,   0,    0,    0.5 ],
    bongo: [0,   0.75, 0,    0,    1,    0,    0,    0.5,  0,   0.5,  0,    0,    0.75,0,    0.5,  0   ],
    rim:   [0,   0,    0.5,  0,    0,    0.25, 0,    0,    0.5, 0,    0,    0.25, 0,   0,    0,    0   ],
  }},

  // ── MIDDLE EAST ──────────────────────────────────────────────
  // Maqsoum: 808=doum, conga=tak, rim=ka
  darbuka_maqsoum: { bpm: 110, tracks: {
    kick808:[1,   0,    0,    0,    0,    0.5,  0,    0,    1,   0,    0,    0,    0,   0.75, 0,    0   ],
    conga:  [0,   0,    0.75, 0,    1,    0,    0,    0.5,  0,   0,    0.75, 0,    1,   0,    0,    0.5 ],
    rim:    [0,   0,    0,    0.5,  0,    0,    0.5,  0,    0,   0,    0,    0.5,  0,   0,    0.5,  0   ],
  }},

  // ── JEPUN ────────────────────────────────────────────────────
  // Taiko: gordang=o-daiko, tom=shime-daiko, cymbal penanda bar
  taiko_japanese: { bpm: 100, tracks: {
    gordang:[1,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0.5 ],
    tom:    [0,   0,    0.75, 0,    1,    0,    0,    0,    0,   0,    0.75, 0,    0.75,0,    0,    0   ],
    rim:    [0,   0.5,  0,    0,    0,    0.5,  0,    0.25, 0,   0.5,  0,    0,    0,   0.5,  0.75, 0   ],
    cymbal: [0,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0   ],
  }},

  // ── BALI ─────────────────────────────────────────────────────
  // Gamelan Bali: hesek interlocking, taganing melody, odap bass
  gamelan_bali: { bpm: 96, tracks: {
    hesek:   [0.75,0.5,  0.75, 0.5,  0.75, 0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5,  0.75,0.5,  0.75, 0.5 ],
    taganing:[0,   0,    0.5,  0,    0.75, 0,    0.5,  0,    0,   0.75, 0,    0,    0.5, 0,    1,    0   ],
    cymbal:  [1,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0   ],
    odap:    [0,   0,    0,    0.5,  0,    0,    0.5,  0,    0,   0.5,  0,    0,    0.75,0,    0,    0.25],
  }},

  // ── FOOTWORK ─────────────────────────────────────────────────
  // Chicago Juke/Footwork: kick polyrhythm, hihat 16th penuh
  footwork_juke: { bpm: 160, tracks: {
    kick:  [1,   0,    1,    0,    0,    0,    1,    0,    1,   0,    0,    0,    1,   0,    1,    0   ],
    snare: [0,   0,    0,    0,    1,    0,    0,    0,    0,   1,    0,    0,    1,   0,    0,    1   ],
    hihat: [1,   1,    1,    1,    1,    1,    1,    1,    1,   1,    1,    1,    1,   1,    1,    1   ],
    clap:  [0,   0,    0,    0,    0,    0,    1,    0,    0,   0,    0,    0,    0,   0,    1,    0   ],
  }},

  // ── GRIME ────────────────────────────────────────────────────
  grime: { bpm: 140, tracks: {
    kick808:[1,   0,    0,    0,    0,    0.5,  0,    0,    0.75,0,    0,    0,    0,   0,    0.5,  0   ],
    esnare: [0,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    0.5,  0,    1,   0,    0,    0.25],
    hihat:  [0.75,0.5,  0,    0.5,  0.75, 0,    0.5,  0,    0.75,0.5,  0,    0.5,  1,   0,    0.5,  0   ],
    rim:    [0,   0,    0.5,  0,    0,    0.5,  0,    0,    0,   0,    0.5,  0,    0.5, 0,    0,    0   ],
  }},

  // ── LO-FI ────────────────────────────────────────────────────
  lofi_hiphop: { bpm: 75, tracks: {
    kick:  [1,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0.25, 0,   0,    0.5,  0   ],
    snare: [0,   0,    0,    0,    0.5,  0,    0.25, 0,    0,   0,    0,    0,    1,   0,    0,    0.25],
    hihat: [0.5, 0,    0.5,  0,    0.5,  0,    0.5,  0.25, 0.5, 0,    0.5,  0,    0.5, 0,    0.75, 0   ],
    rim:   [0,   0.25, 0,    0,    0,    0,    0,    0.25, 0,   0.25, 0,    0,    0,   0,    0,    0   ],
  }},

  // ── NUSANTARA ACEH ───────────────────────────────────────────
  // Rapai Geleng / Saman: rebana interlocking, bedug bass, hesek dense
  nusantara_aceh: { bpm: 112, tracks: {
    rebana:     [1,   0,    0,    0.75, 0.5,  0,    1,    0,    0.75,0,    0.5,  0,    1,   0,    0,    0.75],
    bedug:      [1,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0.5 ],
    hesek:      [0.75,0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75,0.75, 0.75, 0.75, 0.75,0.75, 0.75, 0.75],
    tambourine: [0,   0.5,  0,    0.5,  0,    0.5,  0,    0.5,  0,   0.5,  0,    0.5,  0,   0.5,  0,    0.5 ],
  }},

  // ── NUSANTARA TORAJA ─────────────────────────────────────────
  // Pa'randing: gordang prosesi, taganing melody, hesek konstan
  nusantara_toraja: { bpm: 95, tracks: {
    gordang: [1,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    1,    0,    0.75,0,    0.5,  0   ],
    taganing:[0,   0.5,  0,    0.75, 0,    0.5,  0,    0,    0.75,0,    0,    0.5,  0,   0.75, 0,    0   ],
    hesek:   [0.5, 0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5,  0.5, 0.5,  0.5,  0.5,  0.5, 0.5,  0.5,  0.5 ],
    odap:    [0,   0,    0.75, 0,    0,    0,    0,    0.5,  0,   0,    0.75, 0,    0.5, 0,    0,    0   ],
  }},

  // ── NUSANTARA PAPUA ──────────────────────────────────────────
  // Tifa: conga=tifa besar, bongo=tifa kecil, rim=sisi
  nusantara_papua: { bpm: 108, tracks: {
    conga:      [1,   0,    0,    0.5,  0,    0.75, 0,    0,    1,   0,    0,    0,    0.75,0,    0.5,  0   ],
    bongo:      [0,   0.5,  0,    0,    0.75, 0,    0.5,  0,    0,   0.5,  0.75, 0,    0,   0.5,  0,    0.75],
    rim:        [0,   0,    0.5,  0,    0,    0.5,  0,    0.25, 0,   0,    0,    0.5,  0,   0.25, 0,    0   ],
    tambourine: [0.5, 0,    0.5,  0,    0.5,  0,    0.5,  0,    0.5, 0,    0.5,  0,    0.5, 0,    0.5,  0   ],
  }},

  // ── MAMBO ────────────────────────────────────────────────────
  // Fast Afro-Cuban Mambo: conga tumbao, bongo martillo, cowbell clave
  latin_mambo: { bpm: 195, tracks: {
    conga:  [0,   0.75, 0,    0,    1,    0,    0,    0.5,  0,   0.75, 0,    0,    1,   0,    0,    0.5 ],
    bongo:  [1,   0,    0.5,  0,    0,    0.75, 0,    0,    1,   0,    0.5,  0,    0,   0.5,  0,    0.75],
    cowbell:[1,   0,    0.75, 0,    0.5,  0,    1,    0,    0,   0.75, 0,    0.5,  0,   1,    0,    0   ],
    kick:   [1,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0   ],
  }},

  // ── K-POP ────────────────────────────────────────────────────
  kpop_hype: { bpm: 130, tracks: {
    kick808:[1,   0,    0,    0,    1,    0,    0,    0,    1,   0,    0,    0.25, 1,   0,    0.5,  0   ],
    esnare: [0,   0,    0,    0,    0.75, 0,    0,    0.25, 0,   0,    0.25, 0,    1,   0,    0,    0.5 ],
    hihat:  [0.75,0.5,  1,    0.5,  0.75, 0.5,  1,    0.5,  0.75,0.5,  1,    0.5,  0.75,0.5,  1,    0.5 ],
    clap:   [0,   0,    0,    0,    0.75, 0,    0,    0,    0,   0,    0,    0,    1,   0,    0,    0.25],
  }},

  // ── RITUAL AMBIENT ───────────────────────────────────────────
  // Seremonial perlahan: gordang jarang, cymbal sustain, hesek nafas, odap jawab
  ambient_ritual: { bpm: 60, tracks: {
    gordang:[1,   0,    0,    0,    0,    0,    0,    0,    0,   0,    0,    0,    0,   0,    0.5,  0   ],
    cymbal: [0,   0,    0,    0,    0,    0,    0,    0,    0.75,0,    0,    0,    0,   0,    0,    0   ],
    hesek:  [0.5, 0,    0,    0,    0.5,  0,    0,    0,    0.5, 0,    0,    0,    0.5, 0,    0,    0.25],
    odap:   [0,   0,    0.5,  0,    0,    0,    0,    0,    0,   0.5,  0,    0,    0,   0,    0,    0   ],
  }},

};

// ── Metadata UI untuk 30 pola beat ──────────────────────────────
export const SAMPLES = [
  // Techno/Electronic
  { id: 'techno_basic',           label: 'Techno Basic',        group: 'Techno',      icon: '⚡', color: '#7c3aed' },
  { id: 'techno_industrial',      label: 'Techno Industrial',   group: 'Techno',      icon: '⚡', color: '#6d28d9' },
  { id: 'techno_minimal',         label: 'Techno Minimal',      group: 'Techno',      icon: '⚡', color: '#8b5cf6' },
  { id: 'house_classic',          label: 'House Classic',       group: 'Electronic',  icon: '🔊', color: '#0ea5e9' },
  { id: 'glitch_beat',            label: 'Glitch Beat',         group: 'Electronic',  icon: '🔊', color: '#06b6d4' },
  // D&B / Jungle / Breakbeat
  { id: 'drum_bass',              label: 'Drum & Bass',         group: 'Breakbeat',   icon: '🔥', color: '#f97316' },
  { id: 'jungle_break',           label: 'Jungle Break',        group: 'Breakbeat',   icon: '🔥', color: '#fb923c' },
  { id: 'amen_break',             label: 'Amen Break',          group: 'Breakbeat',   icon: '🔥', color: '#ea580c' },
  // Hip Hop / Trap
  { id: 'hiphop_boom',            label: 'Hip-Hop Boom Bap',    group: 'Hip Hop',     icon: '🎤', color: '#22d3ee' },
  { id: 'trap_808',               label: 'Trap 808',            group: 'Hip Hop',     icon: '🎤', color: '#67e8f9' },
  // Nusantara
  { id: 'nusantara_batak',        label: 'Batak Tagading',      group: 'Nusantara',   icon: '🪘', color: '#f59e0b' },
  { id: 'nusantara_jawa',         label: 'Gamelan Jawa',        group: 'Nusantara',   icon: '🪘', color: '#d97706' },
  { id: 'nusantara_melayu',       label: 'Melayu Rebana',       group: 'Nusantara',   icon: '🪘', color: '#b45309' },
  { id: 'nusantara_bedug',        label: 'Bedug Masjid',        group: 'Nusantara',   icon: '🪘', color: '#78716c' },
  { id: 'nusantara_sunda',        label: 'Sunda Perkusi',       group: 'Nusantara',   icon: '🪘', color: '#10b981' },
  { id: 'nusantara_betawi',       label: 'Betawi Ondel',        group: 'Nusantara',   icon: '🪘', color: '#059669' },
  { id: 'nusantara_tagading_fusion', label: 'Batak-House',     group: 'Nusantara',   icon: '🪘', color: '#34d399' },
  // Latin
  { id: 'latin_conga',            label: 'Latin Conga',         group: 'Latin',       icon: '🥁', color: '#e11d48' },
  { id: 'latin_samba',            label: 'Samba Brasil',        group: 'Latin',       icon: '🥁', color: '#f43f5e' },
  { id: 'latin_bossa',            label: 'Bossa Nova',          group: 'Latin',       icon: '🥁', color: '#fb7185' },
  // Rock / Pop / Funk
  { id: 'rock_basic',             label: 'Rock Basic',          group: 'Rock/Pop',    icon: '🎸', color: '#4ade80' },
  { id: 'pop_dance',              label: 'Pop Dance',           group: 'Rock/Pop',    icon: '🎸', color: '#22c55e' },
  { id: 'funk_groove',            label: 'Funk Groove',         group: 'Rock/Pop',    icon: '🎸', color: '#16a34a' },
  // World
  { id: 'tribal_beat',            label: 'Tribal Beat',         group: 'World',       icon: '🌍', color: '#a78bfa' },
  { id: 'afrobeat',               label: 'Afrobeat',            group: 'World',       icon: '🌍', color: '#c4b5fd' },
  { id: 'reggae_ska',             label: 'Reggae / Ska',        group: 'World',       icon: '🌍', color: '#8b5cf6' },
  // Fusion
  { id: 'fusion_jazzbreak',       label: 'Jazz Breakbeat',      group: 'Fusion',      icon: '🎷', color: '#f472b6' },
  { id: 'fusion_tropical',        label: 'Tropical Fusion',     group: 'Fusion',      icon: '🎷', color: '#ec4899' },
  // Ambient
  { id: 'ambient_sparse',         label: 'Ambient Sparse',      group: 'Ambient',     icon: '🌙', color: '#94a3b8' },
  // Jazz / Blues / Gospel
  { id: 'jazz_swing',             label: 'Jazz Swing',          group: 'Jazz',        icon: '🎷', color: '#fbbf24' },
  { id: 'blues_shuffle',          label: 'Blues Shuffle',       group: 'Jazz',        icon: '🎷', color: '#d97706' },
  { id: 'gospel_4beat',           label: 'Gospel 4-Beat',       group: 'Jazz',        icon: '🎷', color: '#92400e' },
  // Afro-Cuban / Caribbean
  { id: 'afrocuban_guaguanco',    label: 'Guaguancó',           group: 'Latin',       icon: '🥁', color: '#dc2626' },
  { id: 'calypso',                label: 'Calypso',             group: 'Latin',       icon: '🥁', color: '#b91c1c' },
  { id: 'cumbia',                 label: 'Cumbia',              group: 'Latin',       icon: '🥁', color: '#991b1b' },
  { id: 'latin_mambo',            label: 'Mambo',               group: 'Latin',       icon: '🥁', color: '#7f1d1d' },
  // Reggae / Dancehall
  { id: 'dancehall',              label: 'Dancehall',           group: 'World',       icon: '🌍', color: '#15803d' },
  // Electronic
  { id: 'footwork_juke',          label: 'Footwork / Juke',     group: 'Electronic',  icon: '🔊', color: '#0284c7' },
  { id: 'grime',                  label: 'Grime',               group: 'Electronic',  icon: '🔊', color: '#075985' },
  { id: 'lofi_hiphop',            label: 'Lo-Fi Hip Hop',       group: 'Hip Hop',     icon: '🎤', color: '#0e7490' },
  { id: 'kpop_hype',              label: 'K-Pop Hype',          group: 'Electronic',  icon: '🔊', color: '#7e22ce' },
  // Ethnic World
  { id: 'tabla_teentaal',         label: 'Tabla Teentaal',      group: 'Ethnic',      icon: '🪘', color: '#ea580c' },
  { id: 'darbuka_maqsoum',        label: 'Darbuka Maqsoum',     group: 'Ethnic',      icon: '🪘', color: '#c2410c' },
  { id: 'taiko_japanese',         label: 'Taiko',               group: 'Ethnic',      icon: '🪘', color: '#b45309' },
  { id: 'gamelan_bali',           label: 'Gamelan Bali',        group: 'Ethnic',      icon: '🪘', color: '#15803d' },
  // Nusantara tambahan
  { id: 'nusantara_aceh',         label: 'Rapai Aceh',          group: 'Nusantara',   icon: '🪘', color: '#0f766e' },
  { id: 'nusantara_toraja',       label: 'Pa\'randing Toraja',  group: 'Nusantara',   icon: '🪘', color: '#0369a1' },
  { id: 'nusantara_papua',        label: 'Tifa Papua',          group: 'Nusantara',   icon: '🪘', color: '#4338ca' },
  // Ambient
  { id: 'ambient_ritual',         label: 'Ambient Ritual',      group: 'Ambient',     icon: '🌙', color: '#475569' },
];

// ── Fungsi instrument (digunakan oleh beat sequencer) ────────────
export const SAMPLE_FNS = {
  // Western
  kick:        (t, v, r = 1.0) => scheduleKick(t, v, r),
  snare:       (t, v, r = 1.0) => scheduleSnare(t, v, r),
  hihat:       (t, v, r = 1.0) => scheduleHihat(t, v, false, r),
  clap:        (t, v, r = 1.0) => scheduleClap(t, v, r),
  rim:         (t, v, r = 1.0) => scheduleRim(t, v, r),
  tom:         (t, v, r = 1.0) => scheduleTom(t, v, r),
  cymbal:      (t, v, r = 1.0) => scheduleCymbal(t, v, r),
  tambourine:  (t, v, r = 1.0) => scheduleTambourine(t, v, r),
  cowbell:     (t, v, r = 1.0) => scheduleCowbell(t, v, r),
  // Nusantara
  taganing:    (t, v, r = 1.0) => scheduleTaganing(t, v, r),
  odap:        (t, v, r = 1.0) => scheduleOdap(t, v, r),
  hesek:       (t, v, r = 1.0) => scheduleHesek(t, v, r),
  gordang:     (t, v, r = 1.0) => scheduleGordang(t, v, r),
  kendang:     (t, v, r = 1.0) => scheduleKendang(t, v, r),
  rebana:      (t, v, r = 1.0) => scheduleRebana(t, v, r),
  bedug:       (t, v, r = 1.0) => scheduleBedug(t, v, r),
  // Latin
  conga:       (t, v, r = 1.0) => scheduleConga(t, v, r),
  bongo:       (t, v, r = 1.0) => scheduleBongo(t, v, r),
  // Electronic
  kick808:     (t, v, r = 1.0) => scheduleKick808(t, v, r),
  esnare:      (t, v, r = 1.0) => scheduleElecSnare(t, v, r),
  // Synth — multiply freq by rate untuk pitch shift
  syn_c3:      (t, v, r = 1.0) => scheduleSynth(130.81 * (r || 1), t, v),
  syn_e3:      (t, v, r = 1.0) => scheduleSynth(164.81 * (r || 1), t, v),
  syn_g3:      (t, v, r = 1.0) => scheduleSynth(196.00 * (r || 1), t, v),
  syn_a3:      (t, v, r = 1.0) => scheduleSynth(220.00 * (r || 1), t, v),
  syn_c4:      (t, v, r = 1.0) => scheduleSynth(261.63 * (r || 1), t, v),
  // Hasapi — multiply freq by rate untuk pitch shift
  has_d4:      (t, v, r = 1.0) => scheduleHasapi(293.66 * (r || 1), t, v),
  has_e4:      (t, v, r = 1.0) => scheduleHasapi(329.63 * (r || 1), t, v),
  has_g4:      (t, v, r = 1.0) => scheduleHasapi(392.00 * (r || 1), t, v),
  has_a4:      (t, v, r = 1.0) => scheduleHasapi(440.00 * (r || 1), t, v),
  // WAV
};

// ── Kit Presets — 8 beat patterns untuk satu kit penuh ──────────
export const KIT_PRESETS = [
  {
    id: 'western',
    label: 'Western',
    color: '#22d3ee',
    samples: [
      'rock_basic',
      'pop_dance',
      'funk_groove',
      'jazz_swing',
      'blues_shuffle',
      'hiphop_boom',
      'house_classic',
      'latin_conga',
    ],
  },
  {
    id: 'electronic',
    label: 'Electronic',
    color: '#7c3aed',
    samples: [
      'techno_basic',
      'techno_industrial',
      'techno_minimal',
      'house_classic',
      'glitch_beat',
      'drum_bass',
      'trap_808',
      'footwork_juke',
    ],
  },
  {
    id: 'nusantara',
    label: 'Nusantara',
    color: '#f59e0b',
    samples: [
      'nusantara_batak',
      'nusantara_jawa',
      'nusantara_melayu',
      'nusantara_bedug',
      'nusantara_sunda',
      'nusantara_betawi',
      'nusantara_aceh',
      'nusantara_tagading_fusion',
    ],
  },
];

export function loadKitPreset(presetId) {
  const preset = KIT_PRESETS.find(p => p.id === presetId);
  if (!preset) return;
  const arr = [...preset.samples];
  _persist(arr);
  sensorSamples.set(arr);
}

// ── Uploaded samples ─────────────────────────────────────────────
export const uploadedSamples = writable([]);
const _uploadedMap = {};

export function getAllSamples() {
  return [...SAMPLES, ...get(uploadedSamples)];
}

// ── IndexedDB persistence ─────────────────────────────────────────
const IDB_NAME    = 'drum_monitor_db';
const IDB_VERSION = 1;
const IDB_STORE   = 'audio_files';

function _openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function _idbSave(id, name, arrayBuffer) {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id, name, arrayBuffer });
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function _idbDelete(id) {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function _idbLoadAll() {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result ?? []);
    req.onerror   = e => reject(e.target.error);
  });
}

function _registerUpload(id, name, buffer) {
  const entry = { id, label: name, group: 'Upload', icon: '📁', color: '#60a5fa', buffer };
  BEAT_DATA[id]    = { bpm: 120, isWav: true, isUpload: true, buffer, tracks: {} };
  SAMPLE_FNS[id]   = (t, v, r = 1.0, sensorKey = null) => scheduleWavBuffer(buffer, t, v, 1.0, sensorKey, true, 1.0);
  _uploadedMap[id] = entry;
  uploadedSamples.update(arr => [...arr, entry]);
}

export async function addUploadedSample(name, file) {
  const id          = `upload_${Date.now()}`;
  const arrayBuffer = await file.arrayBuffer();
  await _idbSave(id, name, arrayBuffer);
  const buffer = await decodeAudioBuffer(arrayBuffer.slice(0));
  _registerUpload(id, name, buffer);
  return id;
}

export function removeUploadedSample(id) {
  _idbDelete(id).catch(() => {});
  delete BEAT_DATA[id];
  delete SAMPLE_FNS[id];
  delete _uploadedMap[id];
  sensorSamples.update(arr => {
    const n = arr.map(s => (s === id ? null : s));
    _persist(n);
    return n;
  });
  uploadedSamples.update(arr => arr.filter(s => s.id !== id));
}

// Load semua uploaded samples dari IDB pada startup
// Dipanggil automatik — reconcile sensorSamples selepas IDB load
async function _initFromIDB() {
  try {
    const entries  = await _idbLoadAll();
    const validIds = new Set();
    for (const { id, name, arrayBuffer } of entries) {
      try {
        const buffer = await decodeAudioBuffer(arrayBuffer.slice(0));
        _registerUpload(id, name, buffer);
        validIds.add(id);
      } catch {
        _idbDelete(id).catch(() => {});
      }
    }
    // Buang sensor assignments yang merujuk upload ID tidak wujud dalam IDB
    sensorSamples.update(arr => {
      const n = arr.map(id => (id?.startsWith('upload_') && !validIds.has(id)) ? null : id);
      _persist(n);
      return n;
    });
  } catch {
    // IDB tidak tersedia — buang semua upload assignments
    sensorSamples.update(arr => {
      const n = arr.map(id => id?.startsWith('upload_') ? null : id);
      _persist(n);
      return n;
    });
  }
}

// ── Persistence ─────────────────────────────────────────────────
const DEFAULTS     = [null, null, null, null, null, null, null, null];
const STORAGE_KEY  = 'drum_sensor_beats_v4';
function _load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}
function _persist(arr)   { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch {} }

// ── Stores ──────────────────────────────────────────────────────
export const sensorSamples  = writable(_load() ?? [...DEFAULTS]);
export const selectedSensor = writable(0);

// Kursor sample per sensor (mulai index 0)
export const cursorIdx = writable([0, 0, 0, 0, 0, 0, 0, 0]);

// ── State machine ────────────────────────────────────────────────
// States: 'idle' | 'sensor' | 'sample'
export const pickerState = writable('idle');

// Auto-cancel selepas 10 saat tiada aksi
const IDLE_TIMEOUT = 10000;
let _idleTimer = null;
function _resetTimer() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { stopPreviewBuffer(); pickerState.set('idle'); }, IDLE_TIMEOUT);
}

// ── Button NAV ───────────────────────────────────────────────────
export function btnNav() {
  const state = get(pickerState);

  if (state === 'idle') {
    // Masuk pilih sensor, mulai dari sensor 0
    selectedSensor.set(0);
    pickerState.set('sensor');

  } else if (state === 'sensor') {
    // Cycle sensor: 0 → 1 → … → 7 → 0
    selectedSensor.update(i => (i + 1) % 8);

  } else if (state === 'sample') {
    const sensor  = get(selectedSensor);
    const allS    = getAllSamples();
    const nextIdx = (get(cursorIdx)[sensor] + 1) % allS.length;
    cursorIdx.update(arr => { const n = [...arr]; n[sensor] = nextIdx; return n; });
  }

  _resetTimer();
}

// ── Button SEL ───────────────────────────────────────────────────
export function btnSel() {
  const state = get(pickerState);

  if (state === 'idle') {
    return;

  } else if (state === 'sensor') {
    // Terus masuk pilih sample untuk sensor ini
    pickerState.set('sample');

  } else if (state === 'sample') {
    // Simpan sample ke sensor, tutup picker
    saveSample(get(selectedSensor));
    stopPreviewBuffer();
    pickerState.set('idle');
    clearTimeout(_idleTimer);
    return;
  }

  _resetTimer();
}

// ── Shortcut: buka picker terus ke pilih sensor ─────────────────
export function openPicker() {
  selectedSensor.set(0);
  pickerState.set('sensor');
  _resetTimer();
}

// ── Tutup picker ─────────────────────────────────────────────────
export function closePicker() {
  clearTimeout(_idleTimer);
  stopPreviewBuffer();
  pickerState.set('idle');
}

// ── Save / Delete ────────────────────────────────────────────────
export function saveSample(sensorIdx) {
  const cursor   = get(cursorIdx)[sensorIdx];
  const sampleId = getAllSamples()[cursor]?.id;
  if (!sampleId) return;
  sensorSamples.update(arr => { const n = [...arr]; n[sensorIdx] = sampleId; _persist(n); return n; });
}

export function deleteSample(sensorIdx) {
  sensorSamples.update(arr => { const n = [...arr]; n[sensorIdx] = null; _persist(n); return n; });
}

export function getSample(id) {
  if (!id) return EMPTY_SAMPLE;
  return SAMPLES.find(s => s.id === id) ?? _uploadedMap[id] ?? EMPTY_SAMPLE;
}

// Auto-load uploaded samples dari IndexedDB pada startup
_initFromIDB();
