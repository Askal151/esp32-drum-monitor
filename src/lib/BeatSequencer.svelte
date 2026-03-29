<!--
  BeatSequencer.svelte — 16-step drum machine
  Web Audio lookahead scheduler untuk timing tepat
  5 track: Kick, Snare, Hihat, Clap, Rim
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    scheduleKick, scheduleSnare, scheduleHihat,
    scheduleClap, scheduleRim, getAudioCtx, unlockAudio
  } from './audio.js';

  const STEPS   = 16;
  const TRACKS  = [
    { id: 'kick',  label: 'KICK',  color: '#22d3ee', fn: scheduleKick  },
    { id: 'snare', label: 'SNARE', color: '#4ade80', fn: scheduleSnare },
    { id: 'hihat', label: 'HIHAT', color: '#fbbf24', fn: (t,v) => scheduleHihat(t,v,false) },
    { id: 'clap',  label: 'CLAP',  color: '#f97316', fn: scheduleClap  },
    { id: 'rim',   label: 'RIM',   color: '#a855f7', fn: scheduleRim   },
  ];

  // Preset patterns
  const PRESETS = {
    'Basic': {
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      clap:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    'Funk': {
      kick:  [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,1,0,0],
      snare: [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0],
      hihat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      clap:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      rim:   [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,1],
    },
    'Trap': {
      kick:  [1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,0],
      clap:  [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      rim:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    'Bossa': {
      kick:  [1,0,0,1, 0,0,0,0, 1,0,0,0, 0,1,0,0],
      snare: [0,0,0,0, 0,1,0,0, 0,0,0,1, 0,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      clap:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0],
      rim:   [0,1,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1],
    },
    'Rock': {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      clap:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
  };

  // Grid state: pattern[trackIdx][stepIdx] = 0/1
  let pattern = TRACKS.map(t => new Array(STEPS).fill(0));
  let bpm     = 120;
  let playing = false;
  let curStep = -1;   // step yang sedang bermain (untuk highlight)
  let selPreset = 'Basic';

  // Velocity per track (0.0–1.0)
  let vels = TRACKS.map(() => 0.8);

  // Load preset
  function loadPreset(name) {
    selPreset = name;
    const p = PRESETS[name];
    pattern = TRACKS.map(t => [...(p[t.id] ?? new Array(STEPS).fill(0))]);
  }
  loadPreset('Basic');

  function toggleStep(ti, si) {
    pattern[ti][si] = pattern[ti][si] ? 0 : 1;
    pattern = [...pattern];
  }

  // ── Web Audio Scheduler ───────────────────────────────────────
  let _timerId   = null;
  let _nextNote  = 0;
  let _curBeat   = 0;   // 0..STEPS-1

  const LOOKAHEAD  = 0.025;   // s — seberapa jauh ke hadapan untuk schedule
  const SCHEDULE_A = 0.1;     // s — window schedule

  function stepDuration() { return (60 / bpm) / 4; }   // 1/16 note

  function scheduleStep(beat, time) {
    for (let ti = 0; ti < TRACKS.length; ti++) {
      if (pattern[ti][beat]) {
        TRACKS[ti].fn(time, vels[ti]);
      }
    }
    // Update UI pada waktu yang betul menggunakan MessageChannel
    const delay = Math.max(0, (time - getAudioCtx().currentTime) * 1000 - 10);
    setTimeout(() => { curStep = beat; }, delay);
  }

  function scheduler() {
    const ac = getAudioCtx();
    while (_nextNote < ac.currentTime + SCHEDULE_A) {
      scheduleStep(_curBeat, _nextNote);
      _nextNote += stepDuration();
      _curBeat  = (_curBeat + 1) % STEPS;
    }
    _timerId = setTimeout(scheduler, LOOKAHEAD * 1000);
  }

  function start() {
    unlockAudio();
    _curBeat  = 0;
    _nextNote = getAudioCtx().currentTime + 0.05;
    playing   = true;
    scheduler();
  }

  function stop() {
    clearTimeout(_timerId);
    _timerId = null;
    playing  = false;
    curStep  = -1;
  }

  function togglePlay() { playing ? stop() : start(); }

  function clearAll() {
    pattern = TRACKS.map(() => new Array(STEPS).fill(0));
  }

  // Restart scheduler bila BPM tukar semasa bermain
  $: if (playing && bpm) {
    clearTimeout(_timerId);
    _timerId = setTimeout(scheduler, 0);
  }

  onDestroy(() => { clearTimeout(_timerId); });
</script>

<div class="flex flex-col gap-3 h-full bg-slate-950 rounded-lg p-3 overflow-y-auto">

  <!-- Toolbar -->
  <div class="flex items-center gap-2 flex-wrap shrink-0">
    <span class="text-xs font-bold tracking-widest text-slate-600">SEQUENCER</span>

    <!-- Play/Stop -->
    <button
      class="px-4 py-1.5 rounded-md text-xs font-bold ring-1 transition-all
        {playing
          ? 'bg-red-950 text-red-400 ring-red-900 hover:bg-red-900'
          : 'bg-green-950 text-green-400 ring-green-900 hover:bg-green-900'}"
      on:click={togglePlay}
    >{playing ? '⏹ Stop' : '▶ Play'}</button>

    <!-- BPM -->
    <div class="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-800">
      <span class="text-xs text-slate-600 w-8">BPM</span>
      <input
        type="range" min="60" max="200" step="1"
        bind:value={bpm}
        class="w-28 accent-cyan-500 cursor-pointer"
      />
      <span class="text-xs font-mono font-bold text-cyan-400 w-8 text-right">{bpm}</span>
    </div>

    <!-- Preset -->
    <div class="flex items-center gap-1 flex-wrap">
      {#each Object.keys(PRESETS) as name}
        <button
          class="text-xs px-2.5 py-1 rounded border transition-colors
            {selPreset === name
              ? 'bg-slate-700 border-slate-600 text-slate-200'
              : 'bg-transparent border-slate-800 text-slate-600 hover:text-slate-400'}"
          on:click={() => loadPreset(name)}
        >{name}</button>
      {/each}
    </div>

    <button class="ml-auto text-xs px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-600 hover:text-red-400"
      on:click={clearAll}>🗑 Clear</button>
  </div>

  <!-- Step indicators (bar atas) -->
  <div class="flex gap-0.5 pl-16 shrink-0">
    {#each Array(STEPS) as _, si}
      <div class="flex-1 h-1.5 rounded-full transition-colors
        {si === curStep ? 'bg-white' : (si % 4 === 0 ? 'bg-slate-600' : 'bg-slate-800')}">
      </div>
    {/each}
  </div>

  <!-- Grid tracks -->
  <div class="flex flex-col gap-1.5 shrink-0">
    {#each TRACKS as track, ti}
      <div class="flex items-center gap-2">
        <!-- Label + velocity -->
        <div class="w-14 shrink-0 flex flex-col items-end gap-0.5">
          <span class="text-xs font-bold" style="color:{track.color}">{track.label}</span>
          <input
            type="range" min="0.1" max="1" step="0.05"
            bind:value={vels[ti]}
            class="w-12 h-1 accent-slate-500 cursor-pointer"
            title="Velocity {Math.round(vels[ti]*100)}%"
          />
        </div>

        <!-- Step buttons -->
        <div class="flex gap-0.5 flex-1">
          {#each Array(STEPS) as _, si}
            <button
              class="flex-1 h-9 rounded transition-all border
                {pattern[ti][si]
                  ? si === curStep
                    ? 'border-white shadow-lg scale-105'
                    : 'border-transparent'
                  : 'bg-slate-900 border-slate-800 hover:bg-slate-800'}
                {si % 4 === 0 && !pattern[ti][si] ? 'bg-slate-850' : ''}"
              style={pattern[ti][si]
                ? `background:${track.color}${si === curStep ? 'ff' : '55'}; border-color:${track.color}${si === curStep ? '' : '88'};`
                : ''}
              on:click={() => toggleStep(ti, si)}
              title="{track.label} step {si+1}"
            ></button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Beat group markers -->
  <div class="flex gap-0.5 pl-16 shrink-0">
    {#each [1,2,3,4] as beat}
      <div class="flex-1 text-center text-xs text-slate-700">{beat}</div>
    {/each}
  </div>

</div>
