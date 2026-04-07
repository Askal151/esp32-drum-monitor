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
  scheduleWav,
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

  // ── WAV ──────────────────────────────────────────────────────
  percusion1: { bpm: 120, isWav: true, wavUrl: '/esp32-drum-monitor/samples/percusion123.wav', tracks: {} },
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
  // WAV
  { id: 'percusion1',             label: 'Percusion 123 (WAV)', group: 'WAV',         icon: '🎵', color: '#34d399' },
];

// ── Fungsi instrument (digunakan oleh beat sequencer) ────────────
export const SAMPLE_FNS = {
  // Western
  kick:        (t, v) => scheduleKick(t, v),
  snare:       (t, v) => scheduleSnare(t, v),
  hihat:       (t, v) => scheduleHihat(t, v, false),
  clap:        (t, v) => scheduleClap(t, v),
  rim:         (t, v) => scheduleRim(t, v),
  tom:         (t, v) => scheduleTom(t, v),
  cymbal:      (t, v) => scheduleCymbal(t, v),
  tambourine:  (t, v) => scheduleTambourine(t, v),
  cowbell:     (t, v) => scheduleCowbell(t, v),
  // Nusantara
  taganing:    (t, v) => scheduleTaganing(t, v),
  odap:        (t, v) => scheduleOdap(t, v),
  hesek:       (t, v) => scheduleHesek(t, v),
  gordang:     (t, v) => scheduleGordang(t, v),
  kendang:     (t, v) => scheduleKendang(t, v),
  rebana:      (t, v) => scheduleRebana(t, v),
  bedug:       (t, v) => scheduleBedug(t, v),
  // Latin
  conga:       (t, v) => scheduleConga(t, v),
  bongo:       (t, v) => scheduleBongo(t, v),
  // Electronic
  kick808:     (t, v) => scheduleKick808(t, v),
  esnare:      (t, v) => scheduleElecSnare(t, v),
  // Synth
  syn_c3:      (t, v) => scheduleSynth(130.81, t, v),
  syn_e3:      (t, v) => scheduleSynth(164.81, t, v),
  syn_g3:      (t, v) => scheduleSynth(196.00, t, v),
  syn_a3:      (t, v) => scheduleSynth(220.00, t, v),
  syn_c4:      (t, v) => scheduleSynth(261.63, t, v),
  // Hasapi
  has_d4:      (t, v) => scheduleHasapi(293.66, t, v),
  has_e4:      (t, v) => scheduleHasapi(329.63, t, v),
  has_g4:      (t, v) => scheduleHasapi(392.00, t, v),
  has_a4:      (t, v) => scheduleHasapi(440.00, t, v),
  // WAV
  percusion1:  (t, v) => scheduleWav(`/esp32-drum-monitor/samples/percusion123.wav`, t, v),
};

// ── Persistence ─────────────────────────────────────────────────
const DEFAULTS     = [null, null, null, null, null, null, null, null];
const STORAGE_KEY  = 'drum_sensor_beats_v4';
function _load()         { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } }
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
  _idleTimer = setTimeout(() => pickerState.set('idle'), IDLE_TIMEOUT);
}

// ── Button NAV ───────────────────────────────────────────────────
export function btnNav(audioCtx = null) {
  const state = get(pickerState);

  if (state === 'idle') {
    // Masuk pilih sensor, mulai dari sensor 0
    selectedSensor.set(0);
    pickerState.set('sensor');

  } else if (state === 'sensor') {
    // Cycle sensor: 0 → 1 → … → 7 → 0
    selectedSensor.update(i => (i + 1) % 8);

  } else if (state === 'sample') {
    // Next sample + preview bunyi
    const sensor  = get(selectedSensor);
    const nextIdx = (get(cursorIdx)[sensor] + 1) % SAMPLES.length;
    cursorIdx.update(arr => { const n = [...arr]; n[sensor] = nextIdx; return n; });
    if (audioCtx) {
      try {
        const beatId = SAMPLES[nextIdx].id;
        const beat = BEAT_DATA[beatId];
        if (beat?.isWav) {
          scheduleWav(beat.wavUrl, audioCtx.currentTime, 0.6);
        } else if (beat?.tracks) {
          const firstInstr = Object.keys(beat.tracks)[0];
          if (firstInstr) SAMPLE_FNS[firstInstr]?.(audioCtx.currentTime, 0.6);
        }
      } catch {}
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
    // Terus masuk pilih sample untuk sensor ini
    pickerState.set('sample');

  } else if (state === 'sample') {
    // Simpan sample ke sensor, tutup picker
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
