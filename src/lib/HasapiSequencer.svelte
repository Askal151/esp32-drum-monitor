<!--
  HasapiSequencer.svelte — Melodic Sequencer Hasapi Batak
  16-step, 4 nada pentatonik Batak: Do · Mi · Sol · La
  5 preset melodi: Sidabu Petek · Sihutur Sanggul · Sibungka Pikiran · Sibunga Jambu · Horbo Paon
-->
<script>
  import { onDestroy } from 'svelte';
  import { scheduleHasapi, getAudioCtx, ensureRunning } from './audio.js';
  import { sensors } from './serial.js';

  const STEPS = 16;

  // Pentatonik Batak Toba — tangga nada Si (D mayor pentatonik)
  // D4 · E4 · G4 · A4  (Do · Mi · Sol · La)
  const NOTES = [
    { id: 'nada1', label: 'DO  (D4)', color: '#22d3ee', freq: 293.66 },
    { id: 'nada2', label: 'MI  (E4)', color: '#4ade80', freq: 329.63 },
    { id: 'nada3', label: 'SOL (G4)', color: '#f59e0b', freq: 392.00 },
    { id: 'nada4', label: 'LA  (A4)', color: '#f472b6', freq: 440.00 },
  ];

  // ── 5 Preset Melodi Hasapi ─────────────────────────────────────
  const PRESETS = {
    'Sidabu Petek': {
      // Lagu lincah — banyak nada, irama rapat
      nada1: [1,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,0],
      nada2: [0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
      nada3: [0,0,0,0, 0,1,0,0, 0,0,0,0, 1,0,0,0],
      nada4: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
    },
    'Sihutur Sanggul': {
      // Irama khidmat, perlahan dan berehat
      nada1: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      nada2: [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0],
      nada3: [0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
      nada4: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
    'Sibungka Pikiran': {
      // Merenung — satu nada setiap bar, naik secara perlahan
      nada1: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      nada2: [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0],
      nada3: [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      nada4: [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
    },
    'Sibunga Jambu': {
      // Ceria dan mengalun — corak bunga
      nada1: [1,0,1,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
      nada2: [0,0,0,0, 1,0,0,0, 1,0,1,0, 0,0,0,0],
      nada3: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      nada4: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
    },
    'Horbo Paon': {
      // Berat dan kuat — seperti langkah kerbau
      nada1: [1,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0],
      nada2: [0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
      nada3: [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
      nada4: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    },
  };

  let pattern    = NOTES.map(() => new Array(STEPS).fill(0));
  let bpm        = 100;
  let playing    = false;
  let curStep    = -1;
  let selPreset  = 'Sidabu Petek';
  let noteDur    = 0.3;   // tempoh bunyi setiap nota (saat)
  let vels       = NOTES.map(() => 0.75);
  let sensorMode = true;

  // Sensor 4 (idx=3, Hi-Hat) → auto start/stop Hasapi
  const unsubSensor = sensors.subscribe(arr => {
    if (!sensorMode) return;
    const active = arr[3]?.led > 0;
    if (active && !playing) start();
    else if (!active && playing) stop();
  });

  function loadPreset(name) {
    selPreset = name;
    const p   = PRESETS[name];
    pattern   = NOTES.map(n => [...(p[n.id] ?? new Array(STEPS).fill(0))]);
  }
  loadPreset('Sidabu Petek');

  function toggleStep(ni, si) {
    pattern[ni][si] = pattern[ni][si] ? 0 : 1;
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
    for (let ni = 0; ni < NOTES.length; ni++) {
      if (pattern[ni][beat]) {
        scheduleHasapi(NOTES[ni].freq, time, vels[ni], noteDur);
      }
    }
    const d = Math.max(0, (time - getAudioCtx().currentTime) * 1000 - 10);
    setTimeout(() => { curStep = beat; }, d);
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
  function clearAll()   { pattern = NOTES.map(() => new Array(STEPS).fill(0)); }

  $: if (playing && bpm) { clearTimeout(_timerId); _timerId = setTimeout(scheduler, 0); }

  onDestroy(() => { clearTimeout(_timerId); unsubSensor(); });
</script>

<div class="flex flex-col gap-3 h-full bg-slate-950 rounded-lg p-3 overflow-y-auto">

  <!-- Toolbar -->
  <div class="flex items-center gap-2 flex-wrap shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-xs font-bold tracking-widest text-pink-400">🎵</span>
      <span class="text-xs font-bold tracking-widest text-pink-400">HASAPI</span>
    </div>

    <button
      class="px-4 py-1.5 rounded-md text-xs font-bold ring-1 transition-all
        {playing
          ? 'bg-red-950 text-red-400 ring-red-900 hover:bg-red-900'
          : 'bg-pink-950 text-pink-400 ring-pink-900 hover:bg-pink-900'}"
      on:click={togglePlay}
    >{playing ? '⏹ Stop' : '▶ Play'}</button>

    <!-- BPM -->
    <div class="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-800">
      <span class="text-xs text-slate-600 w-8">BPM</span>
      <input type="range" min="40" max="180" step="1" bind:value={bpm}
        class="w-24 accent-pink-500 cursor-pointer" />
      <span class="text-xs font-mono font-bold text-pink-400 w-8 text-right">{bpm}</span>
    </div>

    <!-- Tempoh nota -->
    <div class="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-800">
      <span class="text-xs text-slate-600 w-8">Dur</span>
      <input type="range" min="0.05" max="0.8" step="0.05" bind:value={noteDur}
        class="w-20 accent-pink-400 cursor-pointer" />
      <span class="text-xs font-mono text-pink-300 w-10 text-right">{noteDur.toFixed(2)}s</span>
    </div>

    <!-- Preset -->
    <div class="flex items-center gap-1 flex-wrap">
      {#each Object.keys(PRESETS) as name}
        <button
          class="text-xs px-2 py-1 rounded border transition-colors
            {selPreset === name
              ? 'bg-pink-950 border-pink-700 text-pink-200'
              : 'bg-transparent border-slate-800 text-slate-600 hover:text-pink-400 hover:border-pink-900'}"
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
      title="Sensor 4 (Hi-Hat) trigger Hasapi"
    >🎯 S4 {sensorMode ? 'ON' : 'OFF'}</button>

    <button
      class="ml-auto text-xs px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-600 hover:text-red-400"
      on:click={clearAll}>🗑</button>
  </div>

  <!-- Step indicator -->
  <div class="flex gap-0.5 pl-20 shrink-0" style="padding-left:7rem">
    {#each Array(STEPS) as _, si}
      <div class="flex-1 h-1.5 rounded-full transition-colors
        {si === curStep ? 'bg-pink-400' : (si % 4 === 0 ? 'bg-slate-600' : 'bg-slate-800')}">
      </div>
    {/each}
  </div>

  <!-- Grid -->
  <div class="flex flex-col gap-1.5 shrink-0">
    {#each NOTES as note, ni}
      <div class="flex items-center gap-2">
        <div class="shrink-0 flex flex-col items-end gap-0.5" style="width:7rem">
          <span class="text-xs font-bold font-mono" style="color:{note.color}">{note.label}</span>
          <input type="range" min="0.1" max="1" step="0.05" bind:value={vels[ni]}
            class="w-20 h-1 cursor-pointer" style="accent-color:{note.color}"
            title="Velocity {Math.round(vels[ni]*100)}%" />
        </div>
        <div class="flex gap-0.5 flex-1">
          {#each Array(STEPS) as _, si}
            <button
              class="flex-1 h-8 rounded transition-all border"
              style={pattern[ni][si]
                ? `background:${note.color}${si === curStep ? 'ff' : '55'}; border-color:${note.color}${si === curStep ? '' : '88'}; ${si === curStep ? 'transform:scaleY(1.15)' : ''}`
                : `background:${si % 4 === 0 ? '#0f172a' : '#020617'}; border-color:#1e293b`}
              on:click={() => toggleStep(ni, si)}
              title="{note.label} step {si+1}"
            ></button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Beat markers -->
  <div class="flex gap-0.5 shrink-0" style="padding-left:7rem">
    {#each [1,2,3,4] as beat}
      <div class="flex-1 text-center text-xs text-slate-700">{beat}</div>
    {/each}
  </div>

  <!-- Nota info -->
  <div class="shrink-0 flex gap-3 flex-wrap pt-1 border-t border-slate-800">
    {#each NOTES as note}
      <span class="text-xs font-mono" style="color:{note.color}60">
        {note.label} — {note.freq} Hz
      </span>
    {/each}
    <span class="text-xs text-slate-700 ml-auto">Pentatonik Batak Toba (D·E·G·A)</span>
  </div>

</div>
