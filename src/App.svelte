<script>
  import DrumPad        from './lib/DrumPad.svelte';
  import Waveform       from './lib/Waveform.svelte';
  import SerialMonitor  from './lib/SerialMonitor.svelte';
  import BeatSequencer     from './lib/BeatSequencer.svelte';
  import SynthSequencer    from './lib/SynthSequencer.svelte';
  import TagadingSequencer from './lib/TagadingSequencer.svelte';
  import HasapiSequencer   from './lib/HasapiSequencer.svelte';
  import { unlockAudio, isRunning } from './lib/audio.js';
  import {
    portState, connected, sensors, packetCount,
    connect, disconnect, sendCmd,
    hitEvent, encoderEvent, btnEvent,
  } from './lib/serial.js';
  import {
    KITS, activeKitIdx, savedSequences, selectedSeqId,
    saveSequence, deleteSequence, getSequence,
  } from './lib/kitStore.js';

  const CLR   = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6'];
  const NAMES = ['SNARE', 'KICK', 'TOM', 'HI-HAT'];

  let tab = 'drum';
  let lastError   = '';
  let audioReady  = false;
  let audioEnabled = true;
  let hits = [0, 0, 0, 0];
  let bpm  = [0, 0, 0, 0];
  const hitTimes = [[], [], [], []];

  // ── bind:this untuk sequencer (untuk getSnapshot/loadSnapshot) ─
  let beatRef, synthRef, tagadingRef;

  // Hit counter & BPM
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

  // ── Encoder: rotate kit aktif ──────────────────────────────────
  encoderEvent.subscribe(e => {
    if (!e.ts) return;
    activeKitIdx.update(i => (i + (e.dir > 0 ? 1 : -1) + KITS.length) % KITS.length);
    tab = 'sequencer';
  });

  // ── Button fisik: SAVE dan DELETE ─────────────────────────────
  btnEvent.subscribe(e => {
    if (!e.ts) return;
    if (e.btn === 'SAVE')  handleSave();
    if (e.btn === 'DEL')   handleDelete();
  });

  function handleSave() {
    const k    = $activeKitIdx;
    const refs = [beatRef, tagadingRef, synthRef];
    const snap = refs[k]?.getSnapshot();
    if (snap) saveSequence(k, snap);
  }

  function handleDelete() {
    if ($selectedSeqId != null) deleteSequence($selectedSeqId);
  }

  function handleLoad(id) {
    const seq = getSequence(id);
    if (!seq) return;
    const refs = [beatRef, tagadingRef, synthRef];
    refs[seq.kitIdx]?.loadSnapshot(seq.snapshot);
    activeKitIdx.set(seq.kitIdx);
    tab = 'sequencer';
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleString('id-ID', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  }

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

  let panelH = 340;
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
      <!-- Kit indicator — berubah saat encoder diputar -->
      <div
        class="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border transition-all"
        style="border-color:{KITS[$activeKitIdx].color}; color:{KITS[$activeKitIdx].color}; background:{KITS[$activeKitIdx].color}18"
      >
        <span>{KITS[$activeKitIdx].icon}</span>
        <span>{KITS[$activeKitIdx].label}</span>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <!-- Toggle audio -->
      <button
        class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 transition-all
          {!audioReady ? 'bg-yellow-950 text-yellow-400 ring-yellow-800 animate-pulse'
            : audioEnabled ? 'bg-violet-950 text-violet-400 ring-violet-900'
            : 'bg-slate-800 text-slate-500 ring-slate-700'}"
        on:click={toggleAudio}
        title="Toggle suara drum"
      >{!audioReady ? '⚠ Aktifkan Audio' : audioEnabled ? '🔊 Audio' : '🔇 Mute'}</button>

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
      <div class="card p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
            {i === 0 ? '🥁 SEQUENCER' : i === 1 ? '🎹 SYNTH' : i === 2 ? '🪘 TOM' : '🎵 HI-HAT'}
          </span>
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

  <!-- SAVED SEQUENCES PANEL ─────────────────────────────────── -->
  <section class="card px-4 py-3 flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold tracking-widest text-slate-600">SEQUENCE LIBRARY</span>
        <span class="text-xs text-slate-700">({$savedSequences.length})</span>
      </div>
      <div class="flex items-center gap-2">
        <!-- Kit selector manual (klik atau putar encoder) -->
        {#each KITS as kit, ki}
          <button
            class="text-xs px-2.5 py-1 rounded border transition-all font-medium
              {$activeKitIdx === ki
                ? 'border-transparent text-[#080b12] font-bold'
                : 'bg-transparent border-slate-800 text-slate-600 hover:text-slate-400'}"
            style={$activeKitIdx === ki ? `background:${kit.color}; border-color:${kit.color}` : ''}
            on:click={() => activeKitIdx.set(ki)}
          >{kit.icon} {kit.label}</button>
        {/each}
        <!-- Save manual (fallback jika tanpa hardware button) -->
        <button
          class="text-xs px-3 py-1 rounded-md font-bold bg-emerald-950 text-emerald-400 border border-emerald-900 hover:bg-emerald-900 transition-colors"
          on:click={handleSave}
          title="Simpan sequence aktif (atau tekan button SAVE di ESP32)"
        >💾 Save</button>
      </div>
    </div>

    {#if $savedSequences.length === 0}
      <p class="text-xs text-slate-700 py-1">
        Belum ada sequence tersimpan — set pattern lalu tekan button SAVE di ESP32
      </p>
    {:else}
      <div class="flex flex-wrap gap-1.5">
        {#each $savedSequences as seq}
          {@const kit = KITS[seq.kitIdx] ?? KITS[0]}
          <div
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all text-xs
              {$selectedSeqId === seq.id
                ? 'border-transparent text-slate-900 font-bold'
                : 'border-slate-800 text-slate-500 hover:border-slate-600 hover:text-slate-400'}"
            style={$selectedSeqId === seq.id ? `background:${kit.color}; border-color:${kit.color}` : ''}
            on:click={() => selectedSeqId.set($selectedSeqId === seq.id ? null : seq.id)}
            on:dblclick={() => handleLoad(seq.id)}
            title="Klik untuk pilih · Double-click untuk load"
            role="button"
            tabindex="0"
            on:keydown={e => e.key === 'Enter' && handleLoad(seq.id)}
          >
            <span>{kit.icon}</span>
            <span>{seq.name}</span>
            <span class="opacity-60 text-xs">{fmtTime(seq.ts)}</span>
            <button
              class="ml-1 opacity-50 hover:opacity-100 hover:text-red-400 transition-colors font-bold"
              on:click|stopPropagation={() => deleteSequence(seq.id)}
              title="Hapus sequence ini"
            >✕</button>
          </div>
        {/each}
        {#if $selectedSeqId}
          <button
            class="text-xs px-2.5 py-1.5 rounded-lg border border-red-900 text-red-500 hover:bg-red-950 transition-colors"
            on:click={handleDelete}
            title="Hapus sequence dipilih (atau tekan button DELETE di ESP32)"
          >🗑 Hapus Dipilih</button>
        {/if}
      </div>
    {/if}
  </section>

  <!-- PANEL BAWAH — semua komponen always mounted, guna display:none -->
  <section class="card flex flex-col overflow-hidden" style="height:{panelH}px; min-height:200px; max-height:700px">
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

      <!-- Waveform — always mounted -->
      <div class="absolute inset-0 p-2" style="display:{tab==='drum' ? 'block' : 'none'}">
        <Waveform />
      </div>

      <!-- Sequencer — 4 sequencer stacked, always mounted -->
      <div class="absolute inset-0 overflow-y-auto flex flex-col gap-px"
           style="display:{tab==='sequencer' ? 'flex' : 'none'}">
        <div
          class="transition-all duration-300"
          style="height:310px; flex:none; outline:{$activeKitIdx===0 ? `2px solid ${KITS[0].color}44` : 'none'}; outline-offset:-2px; border-radius:8px"
        >
          <BeatSequencer bind:this={beatRef} />
        </div>
        <div
          class="border-t border-slate-800 transition-all duration-300"
          style="height:250px; flex:none; outline:{$activeKitIdx===2 ? `2px solid ${KITS[2].color}44` : 'none'}; outline-offset:-2px; border-radius:8px"
        >
          <SynthSequencer bind:this={synthRef} />
        </div>
        <div
          class="border-t-2 border-amber-900 transition-all duration-300"
          style="height:290px; flex:none; outline:{$activeKitIdx===1 ? `2px solid ${KITS[1].color}44` : 'none'}; outline-offset:-2px; border-radius:8px"
        >
          <TagadingSequencer bind:this={tagadingRef} />
        </div>
        <div class="border-t-2 border-pink-900" style="height:280px; flex:none">
          <HasapiSequencer />
        </div>
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
