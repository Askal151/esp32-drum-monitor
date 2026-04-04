<script>
  import DrumPad        from './lib/DrumPad.svelte';
  import Waveform       from './lib/Waveform.svelte';
  import SerialMonitor  from './lib/SerialMonitor.svelte';
  import BeatSequencer     from './lib/BeatSequencer.svelte';
  import SynthSequencer    from './lib/SynthSequencer.svelte';
  import TagadingSequencer from './lib/TagadingSequencer.svelte';
  import HasapiSequencer   from './lib/HasapiSequencer.svelte';
  import SampleAssign      from './lib/SampleAssign.svelte';
  import SamplePicker      from './lib/SamplePicker.svelte';
  import { unlockAudio, isRunning, getAudioCtx, ensureRunning } from './lib/audio.js';
  import {
    portState, connected, sensors, packetCount,
    connect, disconnect, sendCmd,
    hitEvent, btnEvent,
  } from './lib/serial.js';
  import { get } from 'svelte/store';
  import {
    SAMPLE_FNS, getSample,
    sensorSamples, selectedSensor,
    saveSample, deleteSample,
    btnNav, btnSel, showPicker,
  } from './lib/sampleStore.js';

  const CLR   = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6'];
  const NAMES = ['SNARE', 'KICK', 'TOM', 'HI-HAT'];

  let tab = 'drum';
  let lastError   = '';
  let audioReady  = false;
  let audioEnabled = true;
  let hits = [0, 0, 0, 0];
  let bpm  = [0, 0, 0, 0];
  const hitTimes = [[], [], [], []];

  // ── Hit counter, BPM, dan play sample ─────────────────────────
  hitEvent.subscribe(async e => {
    if (e.idx < 0 || !e.ts) return;

    // Counter & BPM
    hits[e.idx]++;
    hits = [...hits];
    hitTimes[e.idx].push(e.ts);
    if (hitTimes[e.idx].length > 20) hitTimes[e.idx].shift();
    const now = Date.now();
    const recent = hitTimes[e.idx].filter(t => now - t < 10000);
    if (recent.length >= 2) {
      const intervals = recent.slice(1).map((t,i) => t - recent[i]);
      bpm[e.idx] = Math.round(60000 / (intervals.reduce((a,b)=>a+b,0)/intervals.length));
      bpm = [...bpm];
    }

    // Play sample yang di-assign ke sensor ini (skip jika belum ada sample)
    if (!audioEnabled) return;
    try {
      const sampleId = get(sensorSamples)[e.idx];
      if (!sampleId) return;               // sensor kosong → senyap
      await ensureRunning();
      SAMPLE_FNS[sampleId]?.(getAudioCtx().currentTime, e.velocity / 100);
    } catch {}
  });

  // ── Button fizikal NAV / SEL ───────────────────────────────────
  btnEvent.subscribe(e => {
    if (!e.ts) return;
    if (e.btn === 'NAV') { btnNav(audioReady ? getAudioCtx() : null); tab = 'assign'; }
    if (e.btn === 'SEL') { btnSel(); }
  });

  async function toggleConn() {
    lastError = '';
    unlockAudio();
    if ($connected) {
      await disconnect();
    } else {
      try { await connect(); } catch(e) { lastError = e.message; }
    }
  }

  async function activateAudio() {
    await unlockAudio();
    audioReady = isRunning();
    audioEnabled = true;
  }

  function toggleAudio() {
    if (!audioReady) { activateAudio(); return; }
    audioEnabled = !audioEnabled;
  }

  let panelH = 380;
  let resizing = false, ry0 = 0, rh0 = 0;
  function rstart(e) { resizing=true; ry0=e.clientY; rh0=panelH; e.preventDefault(); }
  function rmove(e)  { if(resizing) panelH=Math.max(200,Math.min(700,rh0+ry0-e.clientY)); }
  function rend()    { resizing=false; }
</script>

<svelte:window on:mousemove={rmove} on:mouseup={rend} />

<div class="min-h-screen bg-[#080b12] text-slate-300 p-3 flex flex-col gap-3">

  <!-- HEADER -->
  <header class="card px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
    <div class="flex items-baseline gap-3">
      <span class="text-base font-bold text-cyan-400 tracking-tight">🥁 ESP32 Drum Monitor</span>
      <span class="text-xs text-slate-700">ADS1015 · Hall Sensor · Web Serial</span>
    </div>
    <div class="flex items-center gap-3">
      {#if $portState === 'monitor'}
        <span class="text-xs font-bold text-green-400">● Live</span>
        <span class="text-xs text-slate-700">{$packetCount} paket</span>
      {:else}
        <span class="text-xs text-slate-700">○ Idle</span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <button
        class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 transition-all
          {!audioReady ? 'bg-yellow-950 text-yellow-400 ring-yellow-800 animate-pulse'
            : audioEnabled ? 'bg-violet-950 text-violet-400 ring-violet-900'
            : 'bg-slate-800 text-slate-500 ring-slate-700'}"
        on:click={toggleAudio}
        title="Toggle suara drum"
      >{!audioReady ? '⚠ Aktifkan Audio' : audioEnabled ? '🔊 Audio' : '🔇 Mute'}</button>

      <button
        class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 transition-all bg-amber-950 text-amber-400 ring-amber-900 hover:bg-amber-900"
        on:click={showPicker}
        title="Pilih sample untuk sensor aktif (shortcut button NAV/SEL)"
      >🎵 Pilih Sample</button>
      {#if $connected}
        <button class="btn-gray" on:click={() => sendCmd('s')}>📋 Status</button>
        <button class="btn-gray" on:click={() => sendCmd('r')}>↺ Reset</button>
      {/if}
      <button class="{$connected ? 'btn-disconnect' : 'btn-connect'}" on:click={toggleConn}>
        {$connected ? '⏏ Putus' : '⚡ Sambung'}
      </button>
    </div>
  </header>

  <!-- Banner audio belum aktif -->
  {#if !audioReady}
    <button
      class="bg-yellow-950 border border-yellow-800 rounded-xl px-4 py-2.5 text-xs text-yellow-300 text-center w-full hover:bg-yellow-900 transition-colors"
      on:click={activateAudio}
    >
      ⚠ Klik di sini untuk aktifkan audio — browser memerlukan interaksi pengguna
    </button>
  {/if}

  {#if lastError}
    <div class="bg-red-950 border border-red-800 rounded-xl px-4 py-2 text-xs text-red-300 flex items-center justify-between">
      <span>⚠ {lastError}</span>
      <button class="text-red-500 ml-4" on:click={() => lastError=''}>✕</button>
    </div>
  {/if}

  <!-- DRUM PADS -->
  <section class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
    {#each $sensors as s, i}
      {@const sample = getSample($sensorSamples[i])}
      <div
        class="card p-4 transition-all duration-200"
        class:ring-1={$selectedSensor === i}
        style={$selectedSensor === i ? `--tw-ring-color:${CLR[i]}` : ''}
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
            {i === 0 ? '🥁' : i === 1 ? '🎹' : i === 2 ? '🪘' : '🎵'} {NAMES[i]}
          </span>
          <!-- Badge sample yang tersimpan -->
          <button
            class="flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors"
            style="border-color:{sample.id ? sample.color+'44' : '#33415544'}; color:{sample.id ? sample.color : '#64748b'}; background:{sample.id ? sample.color+'11' : 'transparent'}"
            on:click={() => { selectedSensor.set(i); showPicker(); tab = 'assign'; }}
            title="Klik untuk assign sample ke sensor ini"
          >
            <span>{sample.icon}</span>
            <span>{sample.label}</span>
          </button>
        </div>
        <DrumPad
          idx   = {i}
          name  = {NAMES[i]}
          color = {CLR[i]}
          adc   = {s.adc}
          dev   = {s.dev}
          led   = {s.led}
          hits  = {hits[i]}
          bpm   = {bpm[i]}
        />
      </div>
    {/each}
  </section>

  <!-- PANEL BAWAH -->
  <section class="card flex flex-col overflow-hidden" style="height:{panelH}px; min-height:200px; max-height:700px">
    <div class="h-3 shrink-0 flex items-center justify-center cursor-ns-resize bg-slate-950 border-b border-slate-800 hover:bg-slate-900 transition-colors"
      on:mousedown={rstart} role="separator" aria-orientation="horizontal">
      <div class="w-10 h-0.5 bg-slate-800 rounded"></div>
    </div>
    <div class="flex items-center gap-1 px-3 bg-slate-950 border-b border-slate-800 shrink-0">
      <button class="tab-item {tab==='assign'    ? 'active' : ''}" on:click={() => tab='assign'}>🎛 Assign</button>
      <button class="tab-item {tab==='drum'      ? 'active' : ''}" on:click={() => tab='drum'}>📈 Waveform</button>
      <button class="tab-item {tab==='sequencer' ? 'active' : ''}" on:click={() => tab='sequencer'}>🥁 Sequencer</button>
      <button class="tab-item {tab==='monitor'   ? 'active' : ''}" on:click={() => tab='monitor'}>⬛ Serial Monitor</button>
    </div>
    <div class="flex-1 overflow-hidden relative">

      <!-- Sample Assign — always mounted -->
      <div class="absolute inset-0 p-2" style="display:{tab==='assign' ? 'flex' : 'none'}; flex-direction:column">
        <SampleAssign />
      </div>

      <!-- Waveform — always mounted -->
      <div class="absolute inset-0 p-2" style="display:{tab==='drum' ? 'block' : 'none'}">
        <Waveform />
      </div>

      <!-- Sequencer — 4 sequencer stacked, always mounted -->
      <div class="absolute inset-0 overflow-y-auto flex flex-col gap-px"
           style="display:{tab==='sequencer' ? 'flex' : 'none'}">
        <div style="height:310px; flex:none"><BeatSequencer /></div>
        <div class="border-t border-slate-800" style="height:250px; flex:none"><SynthSequencer /></div>
        <div class="border-t-2 border-amber-900" style="height:290px; flex:none"><TagadingSequencer /></div>
        <div class="border-t-2 border-pink-900" style="height:280px; flex:none"><HasapiSequencer /></div>
      </div>

      <!-- Serial Monitor — always mounted -->
      <div class="absolute inset-0 p-2" style="display:{tab==='monitor' ? 'flex' : 'none'}; flex-direction:column">
        <SerialMonitor onSendCmd={sendCmd} />
      </div>

    </div>
  </section>

  <!-- FOOTER -->
  <footer class="flex justify-between items-center px-3 py-1.5 text-xs text-slate-700 bg-slate-950 border border-slate-900 rounded-xl">
    <span>
      {#if $portState === 'idle'}
        Klik ⚡ Sambung → pilih port ESP32 (115200) — Chrome / Edge sahaja
      {:else}
        ● Menerima data sensor drum
      {/if}
    </span>
    <span class="text-slate-900">ESP32 · ADS1015 · Hall Sensor · HW-040</span>
  </footer>

</div>

<!-- Floating Sample Picker — muncul bila button NAV/SEL ditekan -->
<SamplePicker />
