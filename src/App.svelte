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
    SAMPLE_FNS, BEAT_DATA, getSample,
    sensorSamples, selectedSensor,
    saveSample, deleteSample,
    btnNav, btnSel, openPicker,
  } from './lib/sampleStore.js';

  const CLR   = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#f87171'];
  const NAMES = ['Congkak 1', 'Congkak 2', 'Congkak 3', 'Congkak 4', 'Congkak 5', 'Congkak 6', 'Congkak 7', 'Congkak 8'];

  let tab = 'drum';
  let lastError   = '';
  let audioReady  = false;
  let audioEnabled = true;
  let hits = [0, 0, 0, 0, 0, 0, 0, 0];
  let bpm  = [0, 0, 0, 0, 0, 0, 0, 0];
  const hitTimes = [[], [], [], [], [], [], [], []];

  // ── Per-sensor beat sequencer (BEAT_DATA-driven) ──────────────
  // Setiap sensor memainkan pola beat lengkap (16-step) dari BEAT_DATA
  // Sequencer bermula apabila LED > 0, berhenti apabila LED = 0
  let seqActive = [false, false, false, false, false, false, false, false];
  const _seqTimers   = new Array(8).fill(null);
  const _seqStep     = new Array(8).fill(0);
  const _seqNextTime = new Array(8).fill(0);

  const SEQ_TICK_MS   = 25;
  const SEQ_LOOKAHEAD = 0.1;  // saat lookahead Web Audio

  function _startSensorSeq(idx) {
    if (_seqTimers[idx]) return;
    _seqStep[idx] = 0;
    const ac = getAudioCtx();
    _seqNextTime[idx] = ac.currentTime + 0.05;

    _seqTimers[idx] = setInterval(() => {
      const ac2 = isRunning() ? getAudioCtx() : null;
      // Henti senyap — JANGAN sentuh seqActive dari sini (elak re-render)
      if (!ac2) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; return; }

      const beatId = get(sensorSamples)[idx];
      if (!beatId) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; return; }

      const s = get(sensors)[idx];
      if (s.led === 0) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; return; }

      const beat = BEAT_DATA[beatId];
      if (!beat) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; return; }

      const stepDur = 60 / beat.bpm / 4;  // 16th note

      while (_seqNextTime[idx] < ac2.currentTime + SEQ_LOOKAHEAD) {
        const step = _seqStep[idx];
        const t    = _seqNextTime[idx];
        const vel  = (s.thresh?.[3] > s.thresh?.[0])
          ? Math.max(0.3, Math.min(1.0, (Math.abs(s.dev) - s.thresh[0]) / (s.thresh[3] - s.thresh[0])))
          : 0.7;

        if (beat.isWav) {
          if (step % 4 === 0) SAMPLE_FNS[beatId]?.(t, vel);
        } else {
          for (const [instrId, pattern] of Object.entries(beat.tracks)) {
            const v = pattern[step];
            if (v > 0) SAMPLE_FNS[instrId]?.(t, v * vel);
          }
        }

        _seqStep[idx]     = (step + 1) % 16;
        _seqNextTime[idx] += stepDur;
      }
    }, SEQ_TICK_MS);
    // seqActive dikemas kini oleh sensors.subscribe sahaja
  }

  function _stopSensorSeq(idx) {
    clearInterval(_seqTimers[idx]);
    _seqTimers[idx] = null;
    _seqStep[idx]   = 0;
    // seqActive dikemas kini oleh sensors.subscribe sahaja
  }

  function stopAllBeats() {
    for (let i = 0; i < 8; i++) _stopSensorSeq(i);
    seqActive = [false, false, false, false, false, false, false, false];
  }

  // ── Hit → kira hit & BPM sahaja (audio ditangani oleh sequencer) ──
  hitEvent.subscribe(e => {
    if (e.idx < 0 || !e.ts) return;
    const sampleId = get(sensorSamples)[e.idx];
    if (!sampleId) return;

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

  // ── Sensor LED → mulakan/hentikan beat sequencer ──────────────
  // seqActive hanya dikemas kini di sini, dan hanya bila nilai berubah
  // supaya Svelte tidak re-render setiap 20ms
  sensors.subscribe(arr => {
    if (!audioEnabled || !isRunning()) return;
    const ac = getAudioCtx();
    if (ac.state !== 'running') return;
    let changed = false;
    for (let i = 0; i < 8; i++) {
      const led = arr[i].led;
      if (led > 0 && !_seqTimers[i]) {
        _startSensorSeq(i);
        if (!seqActive[i]) { seqActive[i] = true; changed = true; }
      } else if (led === 0 && _seqTimers[i]) {
        _stopSensorSeq(i);
        if (seqActive[i]) { seqActive[i] = false; changed = true; }
      }
    }
    if (changed) seqActive = [...seqActive];  // hanya bila ada perubahan
  });

  // ── Button fizikal NAV / SEL ───────────────────────────────────
  btnEvent.subscribe(e => {
    if (!e.ts) return;
    if (e.btn === 'NAV') {
      btnNav(isRunning() ? getAudioCtx() : null);
      tab = 'assign';
    }
    if (e.btn === 'SEL') {
      btnSel();
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

  // Keyboard shortcut untuk test: N = NAV, S = SEL
  function onKeydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') { btnNav(isRunning() ? getAudioCtx() : null); tab = 'assign'; }
    if (e.key === 's' || e.key === 'S') { btnSel(); }
  }
</script>

<svelte:window on:mousemove={rmove} on:mouseup={rend} on:keydown={onKeydown} />

<div class="min-h-screen bg-[#080b12] text-slate-300 p-3 flex flex-col gap-3">

  <!-- HEADER -->
  <header class="card px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
    <div class="flex items-baseline gap-3">
      <span class="text-base font-bold text-cyan-400 tracking-tight">🥁 ESP32 Drum Monitor</span>
      <span class="text-xs text-slate-700">ADS1015+ADS1115 · 8 Sensor · Web Serial</span>
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
        on:click={openPicker}
        title="Buka picker (sama dengan tekan NAV button)"
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

  <!-- SENSOR SELECTOR — 4 butang pilih sensor + sample + beat indicator -->
  <section class="card p-3 flex flex-col gap-2">
    <!-- Stop All -->
    {#if seqActive.some(Boolean)}
    <div class="flex items-center gap-3">
      <span class="text-xs text-slate-500 flex-1">Beat sequencer aktif — magnet rapat untuk mainkan</span>
      <button
        class="text-xs px-3 py-1 rounded-lg bg-red-950 text-red-400 border border-red-900 hover:bg-red-900 transition-colors shrink-0"
        on:click={stopAllBeats}>■ Stop Semua</button>
    </div>
    {/if}
    <!-- 8 sensor butang — 2 baris, 4 per baris -->
    <div class="grid grid-cols-4 gap-2">
      {#each $sensors as s, i}
        {@const sample = getSample($sensorSamples[i])}
        {@const looping = seqActive[i]}
        {@const chip = i < 4 ? 'ADS1015' : 'ADS1115'}
        <button
          class="rounded-xl border-2 p-2 text-left transition-all duration-200 flex flex-col gap-1"
          style="border-color:{looping ? CLR[i] : sample.id ? CLR[i]+'66' : '#1e293b'};
                 background:{looping ? CLR[i]+'22' : sample.id ? CLR[i]+'0a' : '#0f172a'}"
          on:click={() => { selectedSensor.set(i); openPicker(); }}
        >
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
              {NAMES[i]}
            </div>
            <div class="text-[9px] text-slate-700">{chip}</div>
          </div>
          {#if sample.id}
            <div class="text-xs font-medium truncate" style="color:{sample.color}">{sample.icon} {sample.label}</div>
            {#if looping}
              <div class="text-xs font-bold mt-0.5 animate-pulse" style="color:{CLR[i]}">▶ loop</div>
            {:else}
              <div class="text-xs mt-0.5 text-slate-600">sensor → bunyi</div>
            {/if}
          {:else}
            <div class="text-xs text-slate-600">— kosong —</div>
            <div class="text-xs text-slate-700 mt-0.5">klik assign</div>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <!-- DRUM PADS — 4 kolum, 2 baris -->
  <section class="grid grid-cols-4 gap-3 max-sm:grid-cols-2">
    {#each $sensors as s, i}
      {@const sample = getSample($sensorSamples[i])}
      <div
        class="card p-3 transition-all duration-200"
        class:ring-1={!!sample.id && s.led > 0}
        style={sample.id && s.led > 0 ? `--tw-ring-color:${CLR[i]}` : ''}
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
            {NAMES[i]}
          </span>
          <button
            class="flex items-center gap-1 text-xs px-2 py-0.5 rounded border transition-colors"
            style="border-color:{sample.id ? sample.color+'44' : '#33415544'}; color:{sample.id ? sample.color : '#64748b'}; background:{sample.id ? sample.color+'11' : 'transparent'}"
            on:click={() => { selectedSensor.set(i); openPicker(); }}
          >
            <span>{sample.icon}</span>
            <span>{sample.label}</span>
          </button>
        </div>
        <DrumPad
          idx       = {i}
          name      = {NAMES[i]}
          color     = {CLR[i]}
          adc       = {s.adc}
          dev       = {s.dev}
          led       = {s.led}
          hits      = {hits[i]}
          bpm       = {bpm[i]}
          hasSample = {!!sample.id}
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
    <span class="text-slate-900">ESP32 · ADS1015+ADS1115 · 8× Hall Sensor · HW-040</span>
  </footer>

</div>

<!-- Floating Sample Picker — muncul bila button NAV/SEL ditekan -->
<SamplePicker />
