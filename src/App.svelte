<script>
  import DrumPad        from './lib/DrumPad.svelte';
  import Waveform       from './lib/Waveform.svelte';
  import SerialMonitor  from './lib/SerialMonitor.svelte';
  import BeatSequencer  from './lib/BeatSequencer.svelte';
  import { unlockAudio } from './lib/audio.js';
  import {
    portState, connected, sensors, packetCount,
    connect, disconnect, sendCmd
  } from './lib/serial.js';

  const CLR   = ['#22d3ee', '#4ade80'];
  const NAMES = ['SNARE', 'KICK'];

  let tab = 'drum';
  let lastError = '';
  let audioEnabled = true;
  let hits = [0, 0];
  let bpm  = [0, 0];
  const hitTimes = [[], []];

  import { hitEvent } from './lib/serial.js';

  hitEvent.subscribe(e => {
    if (e.idx < 0 || !e.ts) return;
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

  function toggleAudio() {
    unlockAudio();
    audioEnabled = !audioEnabled;
  }

  let panelH = 340;
  let resizing = false, ry0 = 0, rh0 = 0;
  function rstart(e) { resizing=true; ry0=e.clientY; rh0=panelH; e.preventDefault(); }
  function rmove(e)  { if(resizing) panelH=Math.max(200,Math.min(600,rh0+ry0-e.clientY)); }
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
      <!-- Toggle audio -->
      <button
        class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 transition-opacity
          {audioEnabled ? 'bg-violet-950 text-violet-400 ring-violet-900' : 'bg-slate-800 text-slate-500 ring-slate-700'}"
        on:click={toggleAudio}
        title="Toggle suara drum"
      >{audioEnabled ? '🔊 Audio' : '🔇 Mute'}</button>

      {#if $connected}
        <button class="btn-gray" on:click={() => sendCmd('s')}>📋 Status</button>
        <button class="btn-gray" on:click={() => sendCmd('r')}>↺ Reset</button>
      {/if}
      <button class="{$connected ? 'btn-disconnect' : 'btn-connect'}" on:click={toggleConn}>
        {$connected ? '⏏ Putus' : '⚡ Sambung'}
      </button>
    </div>
  </header>

  {#if lastError}
    <div class="bg-red-950 border border-red-800 rounded-xl px-4 py-2 text-xs text-red-300 flex items-center justify-between">
      <span>⚠ {lastError}</span>
      <button class="text-red-500 ml-4" on:click={() => lastError=''}>✕</button>
    </div>
  {/if}

  <!-- DRUM PADS -->
  <section class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
    {#each $sensors as s, i}
      <div class="card p-4">
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
  <section class="card flex flex-col overflow-hidden" style="height:{panelH}px; min-height:200px; max-height:600px">
    <div class="h-3 shrink-0 flex items-center justify-center cursor-ns-resize bg-slate-950 border-b border-slate-800 hover:bg-slate-900 transition-colors"
      on:mousedown={rstart} role="separator" aria-orientation="horizontal">
      <div class="w-10 h-0.5 bg-slate-800 rounded"></div>
    </div>
    <div class="flex items-center gap-1 px-3 bg-slate-950 border-b border-slate-800 shrink-0">
      <button class="tab-item {tab==='drum'      ? 'active' : ''}" on:click={() => tab='drum'}>📈 Waveform</button>
      <button class="tab-item {tab==='sequencer' ? 'active' : ''}" on:click={() => tab='sequencer'}>🥁 Sequencer</button>
      <button class="tab-item {tab==='monitor'   ? 'active' : ''}" on:click={() => tab='monitor'}>⬛ Serial Monitor</button>
    </div>
    <div class="flex-1 overflow-hidden relative">
      {#if tab === 'drum'}
        <div class="absolute inset-0 p-2">
          <Waveform />
        </div>
      {/if}
      {#if tab === 'sequencer'}
        <div class="absolute inset-0">
          <BeatSequencer />
        </div>
      {/if}
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
    <span class="text-slate-900">ESP32 · ADS1015 · Hall Sensor</span>
  </footer>

</div>
