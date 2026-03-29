<!--
  SynthSequencer.svelte — 16-step melodic sequencer untuk Sensor 2 (synth)
  Skala pentatonik C major, setiap step ada pemilihan nota
  Klik step = kitar nota (off → C3 → E3 → G3 → A3 → C4 → off)
  Klik kanan = padam step
  Sensor 2 (idx=1) → auto start/stop bila sensorMode aktif
-->
<script>
  import { onDestroy } from 'svelte';
  import { scheduleSynth, getAudioCtx, ensureRunning } from './audio.js';
  import { sensors } from './serial.js';

  const STEPS = 16;

  // Skala pentatonik C major (2 oktaf)
  const SCALE = [
    { name: 'C3', freq: 130.81 },
    { name: 'E3', freq: 164.81 },
    { name: 'G3', freq: 196.00 },
    { name: 'A3', freq: 220.00 },
    { name: 'C4', freq: 261.63 },
    { name: 'E4', freq: 329.63 },
    { name: 'G4', freq: 392.00 },
    { name: 'A4', freq: 440.00 },
  ];

  // step state: -1 = off, 0..7 = indeks SCALE
  let steps = new Array(STEPS).fill(-1);
  let bpm   = 120;
  let playing   = false;
  let curStep   = -1;
  let sensorMode = true;
  let vel        = 0.7;
  let selPreset  = 'Acid House';

  // Skala: 0=C3  1=E3  2=G3  3=A3  4=C4  5=E4  6=G4  7=A4
  // Preset by genre — setiap preset ada bpm cadangan & corak
  const PRESETS = {
    'Acid House': {
      bpm: 130,
      // 303-style bassline — bergerak pantas, banyak nota berturutan
      steps: [0,3,0,2, 3,4,3,0, 2,-1,3,0, 4,3,2,-1],
    },
    'Trap': {
      bpm: 82,
      // Jarang, tinggi, emosional
      steps: [-1,-1,4,-1, 5,-1,-1,4, -1,3,-1,-1, 5,-1,4,-1],
    },
    'Funk': {
      bpm: 108,
      // Syncopated groove
      steps: [0,-1,2,0, -1,3,-1,2, 0,-1,2,-1, 3,2,0,-1],
    },
    'Lo-Fi': {
      bpm: 76,
      // Slow, spacey, chill
      steps: [4,-1,-1,-1, 3,-1,-1,5, -1,-1,2,-1, 4,-1,-1,-1],
    },
    'Techno': {
      bpm: 128,
      // Hypnotic, berulang
      steps: [0,-1,2,-1, 0,-1,4,-1, 0,-1,2,-1, 3,-1,4,-1],
    },
    'Bossa': {
      bpm: 100,
      // Flowing, Latin feel
      steps: [0,-1,2,4, -1,3,-1,2, 4,3,-1,2, 1,-1,0,-1],
    },
    'Arp Up': {
      bpm: 120,
      // Ascending arpeggio
      steps: [0,1,2,3, 4,5,6,7, 6,5,4,3, 2,1,0,-1],
    },
    'Empty': {
      bpm: 120,
      steps: new Array(STEPS).fill(-1),
    },
  };

  function loadPreset(name) {
    selPreset = name;
    const p = PRESETS[name];
    steps = [...p.steps];
    bpm   = p.bpm;
  }
  loadPreset('Acid House');

  // Klik = kitar off → note0 → note1 → ... → note7 → off
  function clickStep(si) {
    const cur = steps[si];
    steps[si] = cur < SCALE.length - 1 ? cur + 1 : -1;
    steps = [...steps];
  }

  // Klik kanan = padam
  function rightClickStep(si, e) {
    e.preventDefault();
    steps[si] = -1;
    steps = [...steps];
  }

  // Sensor 2 (idx=1) → auto start/stop
  const unsubSensor = sensors.subscribe(arr => {
    if (!sensorMode) return;
    const s2Active = arr[1]?.led > 0;
    if (s2Active && !playing) start();
    else if (!s2Active && playing) stop();
  });

  // ── Web Audio Lookahead Scheduler ───────────────────────────────
  let _timerId  = null;
  let _nextNote = 0;
  let _curBeat  = 0;

  const LOOKAHEAD  = 0.025;   // s
  const SCHEDULE_A = 0.1;     // s

  function stepDur() { return (60 / bpm) / 4; }   // 1/16 note

  function scheduleStep(beat, time) {
    const noteIdx = steps[beat];
    if (noteIdx >= 0) {
      const freq = SCALE[noteIdx].freq;
      const dur  = Math.min(stepDur() * 0.88, 0.35);
      scheduleSynth(freq, time, vel, dur);
    }
    // Kemaskini UI indicator
    const delay = Math.max(0, (time - getAudioCtx().currentTime) * 1000 - 10);
    setTimeout(() => { curStep = beat; }, delay);
  }

  function scheduler() {
    const ac = getAudioCtx();
    while (_nextNote < ac.currentTime + SCHEDULE_A) {
      scheduleStep(_curBeat, _nextNote);
      _nextNote += stepDur();
      _curBeat  = (_curBeat + 1) % STEPS;
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

  function clearAll() { steps = new Array(STEPS).fill(-1); }

  // Restart scheduler bila BPM tukar semasa bermain
  $: if (playing && bpm) {
    clearTimeout(_timerId);
    _timerId = setTimeout(scheduler, 0);
  }

  onDestroy(() => { clearTimeout(_timerId); unsubSensor(); });
</script>

<div class="flex flex-col gap-2.5 h-full bg-slate-950 rounded-lg p-3 overflow-y-auto">

  <!-- Toolbar -->
  <div class="flex items-center gap-2 flex-wrap shrink-0">
    <span class="text-xs font-bold tracking-widest text-violet-500">🎹 SYNTH SEQ</span>

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
        class="w-28 accent-violet-500 cursor-pointer"
      />
      <span class="text-xs font-mono font-bold text-violet-400 w-8 text-right">{bpm}</span>
    </div>

    <!-- Velocity -->
    <div class="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-800">
      <span class="text-xs text-slate-600">VEL</span>
      <input
        type="range" min="0.1" max="1" step="0.05"
        bind:value={vel}
        class="w-20 accent-violet-500 cursor-pointer"
      />
      <span class="text-xs font-mono text-violet-400 w-8 text-right">{Math.round(vel*100)}%</span>
    </div>

    <!-- Presets -->
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

    <!-- Sensor Mode -->
    <button
      class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 transition-all
        {sensorMode
          ? 'bg-violet-950 text-violet-300 ring-violet-800'
          : 'bg-slate-900 text-slate-600 ring-slate-800 hover:text-slate-400'}"
      on:click={() => { sensorMode = !sensorMode; if (!sensorMode) stop(); }}
      title="Sensor 2 trigger synth sequencer"
    >🎯 Sensor {sensorMode ? 'ON' : 'OFF'}</button>

    <button
      class="ml-auto text-xs px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-600 hover:text-red-400"
      on:click={clearAll}
    >🗑 Clear</button>
  </div>

  <!-- Step progress indicator -->
  <div class="flex gap-0.5 shrink-0">
    {#each Array(STEPS) as _, si}
      <div class="flex-1 h-1.5 rounded-full transition-colors
        {si === curStep ? 'bg-violet-300' : (si % 4 === 0 ? 'bg-slate-600' : 'bg-slate-800')}">
      </div>
    {/each}
  </div>

  <!-- Step grid -->
  <div class="flex gap-0.5 shrink-0">
    {#each Array(STEPS) as _, si}
      <button
        class="flex-1 rounded transition-all border flex flex-col items-center justify-center gap-0.5
          {steps[si] >= 0
            ? si === curStep
              ? 'border-violet-300 shadow-[0_0_8px_#7c3aed] scale-105'
              : 'border-transparent'
            : 'bg-slate-900 border-slate-800 hover:bg-slate-800'}
          {si % 4 === 0 && steps[si] < 0 ? '!bg-slate-900' : ''}"
        style="height:3.5rem; {steps[si] >= 0
          ? `background:${si === curStep ? '#7c3aedcc' : '#7c3aed44'}; border-color:${si === curStep ? '#a78bfa' : '#7c3aed88'};`
          : ''}"
        on:click={() => clickStep(si)}
        on:contextmenu={(e) => rightClickStep(si, e)}
        title="Step {si+1} — klik untuk tukar nota, klik kanan untuk padam"
      >
        {#if steps[si] >= 0}
          <span class="text-[11px] font-bold text-white leading-none select-none">
            {SCALE[steps[si]].name}
          </span>
          <span class="text-[8px] text-violet-200 leading-none select-none">▶</span>
        {:else}
          <span class="text-[9px] text-slate-700 select-none">{si + 1}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Beat group markers + skala rujukan -->
  <div class="flex items-center gap-3 shrink-0">
    <div class="flex gap-0.5 flex-1">
      {#each [1,2,3,4] as beat}
        <div class="flex-1 text-center text-xs text-slate-700">{beat}</div>
      {/each}
    </div>
    <div class="flex gap-1 items-center shrink-0">
      <span class="text-[10px] text-slate-700">Skala:</span>
      {#each SCALE as note}
        <span class="text-[10px] px-1 py-0.5 rounded bg-violet-950 border border-violet-900 text-violet-400 font-mono leading-none">
          {note.name}
        </span>
      {/each}
    </div>
    <span class="text-[10px] text-slate-700 shrink-0">klik=tukar nota · kanan=padam</span>
  </div>

</div>
