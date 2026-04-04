<!--
  TagadingSequencer.svelte — Beat Sequencer Tagading Batak
  16-step, 4 track: Taganing · Odap · Hesek · Gordang
  5 preset irama: Sidabu Petek · Sihutur Sanggul · Sibungka Pikiran · Sibunga Jambu · Horbo Paon
-->
<script>
  import { onDestroy } from 'svelte';
  import {
    scheduleTaganing, scheduleOdap, scheduleHesek, scheduleGordang,
    getAudioCtx, ensureRunning
  } from './audio.js';
  import { sensors } from './serial.js';

  const STEPS = 16;
  const TRACKS = [
    { id: 'taganing', label: 'TAGANING', color: '#f59e0b', fn: scheduleTaganing },
    { id: 'odap',     label: 'ODAP',     color: '#22d3ee', fn: scheduleOdap    },
    { id: 'hesek',    label: 'HESEK',    color: '#a855f7', fn: scheduleHesek   },
    { id: 'gordang',  label: 'GORDANG',  color: '#ef4444', fn: scheduleGordang },
  ];

  // ── 5 Preset Irama Batak ───────────────────────────────────────
  const PRESETS = {
    'Sidabu Petek': {
      taganing: [1,0,1,0, 1,0,1,0, 1,0,1,1, 0,1,0,1],
      odap:     [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      hesek:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      gordang:  [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
    },
    'Sihutur Sanggul': {
      taganing: [1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,0,0],
      odap:     [1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0],
      hesek:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      gordang:  [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
    },
    'Sibungka Pikiran': {
      taganing: [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,0,0],
      odap:     [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      hesek:    [1,0,1,0, 0,1,0,0, 1,0,1,0, 0,1,0,0],
      gordang:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    },
    'Sibunga Jambu': {
      taganing: [1,0,1,0, 1,0,1,0, 0,1,0,1, 0,1,0,1],
      odap:     [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      hesek:    [1,1,0,1, 1,1,0,1, 1,1,0,1, 1,1,0,1],
      gordang:  [1,0,0,0, 0,1,0,0, 1,0,0,0, 0,1,0,0],
    },
    'Horbo Paon': {
      taganing: [1,0,0,0, 0,0,1,0, 1,0,0,0, 1,0,1,0],
      odap:     [1,0,1,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
      hesek:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,0,0],
      gordang:  [1,0,0,0, 1,0,0,0, 0,1,0,0, 1,0,0,0],
    },
  };

  let pattern    = TRACKS.map(() => new Array(STEPS).fill(0));
  let bpm        = 120;
  let playing    = false;
  let curStep    = -1;
  let selPreset  = 'Sidabu Petek';
  let vels       = TRACKS.map(() => 0.8);
  let sensorMode = false;

  // Sensor 3 (idx=2, Tom) → auto start/stop Tagading
  const unsubSensor = sensors.subscribe(arr => {
    if (!sensorMode) return;
    const active = arr[2]?.led > 0;
    if (active && !playing) start();
    else if (!active && playing) stop();
  });

  function loadPreset(name) {
    selPreset = name;
    const p   = PRESETS[name];
    pattern   = TRACKS.map(t => [...(p[t.id] ?? new Array(STEPS).fill(0))]);
  }
  loadPreset('Sidabu Petek');

  function toggleStep(ti, si) {
    pattern[ti][si] = pattern[ti][si] ? 0 : 1;
    pattern = [...pattern];
  }

  // ── Web Audio Scheduler ────────────────────────────────────────
  let _timerId  = null;
  let _nextNote = 0;
  let _curBeat  = 0;

  const LOOKAHEAD  = 0.025;
  const SCHEDULE_A = 0.1;

  function stepDuration() { return (60 / bpm) / 4; }

  function scheduleStep(beat, time) {
    for (let ti = 0; ti < TRACKS.length; ti++) {
      if (pattern[ti][beat]) TRACKS[ti].fn(time, vels[ti]);
    }
    const delay = Math.max(0, (time - getAudioCtx().currentTime) * 1000 - 10);
    setTimeout(() => { curStep = beat; }, delay);
  }

  function scheduler() {
    const ac = getAudioCtx();
    while (_nextNote < ac.currentTime + SCHEDULE_A) {
      scheduleStep(_curBeat, _nextNote);
      _nextNote += stepDuration();
      _curBeat   = (_curBeat + 1) % STEPS;
    }
    _timerId = setTimeout(scheduler, LOOKAHEAD * 1000);
  }

  async function start() {
    const ac  = await ensureRunning();
    _curBeat  = 0;
    _nextNote = ac.currentTime + 0.1;
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
  function clearAll()   { pattern = TRACKS.map(() => new Array(STEPS).fill(0)); }

  $: if (playing && bpm) { clearTimeout(_timerId); _timerId = setTimeout(scheduler, 0); }

  onDestroy(() => { clearTimeout(_timerId); unsubSensor(); });

  export function getSnapshot() {
    return { pattern: pattern.map(t => [...t]), vels: [...vels], bpm, selPreset };
  }
  export function loadSnapshot(snap) {
    if (!snap) return;
    stop();
    pattern  = snap.pattern.map(t => [...t]);
    vels     = [...snap.vels];
    bpm      = snap.bpm ?? bpm;
    selPreset = snap.selPreset ?? '';
    pattern  = [...pattern];
  }
</script>

<div class="flex flex-col gap-3 h-full bg-slate-950 rounded-lg p-3 overflow-y-auto">

  <!-- Toolbar -->
  <div class="flex items-center gap-2 flex-wrap shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-xs font-bold tracking-widest" style="color:#f59e0b">🥁</span>
      <span class="text-xs font-bold tracking-widest text-amber-500">TAGADING</span>
    </div>

    <button
      class="px-4 py-1.5 rounded-md text-xs font-bold ring-1 transition-all
        {playing
          ? 'bg-red-950 text-red-400 ring-red-900 hover:bg-red-900'
          : 'bg-amber-950 text-amber-400 ring-amber-900 hover:bg-amber-900'}"
      on:click={togglePlay}
    >{playing ? '⏹ Stop' : '▶ Play'}</button>

    <!-- BPM -->
    <div class="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-800">
      <span class="text-xs text-slate-600 w-8">BPM</span>
      <input type="range" min="60" max="220" step="1" bind:value={bpm}
        class="w-24 accent-amber-500 cursor-pointer" />
      <span class="text-xs font-mono font-bold text-amber-400 w-8 text-right">{bpm}</span>
    </div>

    <!-- Preset -->
    <div class="flex items-center gap-1 flex-wrap">
      {#each Object.keys(PRESETS) as name}
        <button
          class="text-xs px-2 py-1 rounded border transition-colors
            {selPreset === name
              ? 'bg-amber-900 border-amber-700 text-amber-200'
              : 'bg-transparent border-slate-800 text-slate-600 hover:text-amber-400 hover:border-amber-900'}"
          on:click={() => loadPreset(name)}
        >{name}</button>
      {/each}
    </div>

    <!-- Sensor Mode -->
    <button
      class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 transition-all
        {sensorMode
          ? 'bg-violet-950 text-violet-300 ring-violet-800'
          : 'bg-slate-900 text-slate-600 ring-slate-800 hover:text-slate-400'}"
      on:click={() => { sensorMode = !sensorMode; if (!sensorMode) stop(); }}
      title="Sensor 3 (Tom) trigger Tagading"
    >🎯 S3 {sensorMode ? 'ON' : 'OFF'}</button>

    <button
      class="ml-auto text-xs px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-600 hover:text-red-400"
      on:click={clearAll}>🗑</button>
  </div>

  <!-- Step indicator -->
  <div class="flex gap-0.5 pl-20 shrink-0">
    {#each Array(STEPS) as _, si}
      <div class="flex-1 h-1.5 rounded-full transition-colors
        {si === curStep ? 'bg-amber-400' : (si % 4 === 0 ? 'bg-slate-600' : 'bg-slate-800')}">
      </div>
    {/each}
  </div>

  <!-- Grid -->
  <div class="flex flex-col gap-1.5 shrink-0">
    {#each TRACKS as track, ti}
      <div class="flex items-center gap-2">
        <div class="w-18 shrink-0 flex flex-col items-end gap-0.5" style="width:4.5rem">
          <span class="text-xs font-bold" style="color:{track.color}">{track.label}</span>
          <input type="range" min="0.1" max="1" step="0.05" bind:value={vels[ti]}
            class="w-14 h-1 cursor-pointer" style="accent-color:{track.color}"
            title="Velocity {Math.round(vels[ti]*100)}%" />
        </div>
        <div class="flex gap-0.5 flex-1">
          {#each Array(STEPS) as _, si}
            <button
              class="flex-1 h-8 rounded transition-all border"
              style={pattern[ti][si]
                ? `background:${track.color}${si === curStep ? 'ff' : '55'}; border-color:${track.color}${si === curStep ? '' : '88'}; ${si === curStep ? 'transform:scaleY(1.15)' : ''}`
                : `background:${si % 4 === 0 ? '#0f172a' : '#020617'}; border-color:#1e293b`}
              on:click={() => toggleStep(ti, si)}
              title="{track.label} step {si+1}"
            ></button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Beat markers -->
  <div class="flex gap-0.5 pl-20 shrink-0" style="padding-left:4.5rem">
    {#each [1,2,3,4] as beat}
      <div class="flex-1 text-center text-xs text-slate-700">{beat}</div>
    {/each}
  </div>

</div>
