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
    btnNav, btnSel, openPicker,
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

  // ── Beat engine ────────────────────────────────────────────────
  // Setiap sensor boleh loop sample-nya sebagai beat secara bebas
  let beatBpm    = 120;
  let beatActive = [false, false, false, false];
  let beatStep   = 0;   // step semasa (0–15), untuk paparan

  // Pola beat default mengikut jenis sample (16 langkah, 16th notes)
  const BEAT_PATTERNS = {
    kick:     [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    clap:     [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    rim:      [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    taganing: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0],
    odap:     [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    hesek:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    gordang:  [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    syn_c3:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    syn_e3:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    syn_g3:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    syn_a3:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    syn_c4:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    has_d4:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    has_e4:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    has_g4:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    has_a4:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
  };

  // Internal scheduler state
  let _beatTimer    = null;
  let _beatRunning  = false;
  let _beatNextTime = 0;
  let _beatCurStep  = 0;
  const STEPS         = 16;
  const SCHEDULE_AHEAD = 0.1;   // saat lookahead
  const TICK_MS        = 25;    // interval poll scheduler

  function _stepDur() { return 60 / beatBpm / 4; }  // durasi 16th note

  function _scheduleTick() {
    if (!_beatRunning) return;
    const ac = isRunning() ? getAudioCtx() : null;
    if (!ac) return;
    while (_beatNextTime < ac.currentTime + SCHEDULE_AHEAD) {
      const ss = get(sensorSamples);
      for (let i = 0; i < 4; i++) {
        if (!beatActive[i]) continue;
        const sid = ss[i];
        if (!sid) continue;
        const pat = BEAT_PATTERNS[sid] ?? [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
        if (pat[_beatCurStep]) {
          SAMPLE_FNS[sid]?.(_beatNextTime, 0.8);
        }
      }
      beatStep = _beatCurStep;
      _beatCurStep = (_beatCurStep + 1) % STEPS;
      _beatNextTime += _stepDur();
    }
  }

  function _startBeatClock() {
    if (_beatRunning) return;
    _beatRunning  = true;
    _beatCurStep  = 0;
    const ac = isRunning() ? getAudioCtx() : null;
    _beatNextTime = ac ? ac.currentTime + 0.05 : 0;
    _beatTimer = setInterval(_scheduleTick, TICK_MS);
  }

  function _stopBeatClock() {
    _beatRunning = false;
    clearInterval(_beatTimer);
    _beatTimer = null;
    beatStep = 0;
  }

  function stopAllBeats() {
    beatActive = [false, false, false, false];
    _stopBeatClock();
  }

  // ── Hit → toggle beat per sensor ──────────────────────────────
  hitEvent.subscribe(async e => {
    if (e.idx < 0 || !e.ts) return;

    // Sensor kosong → abaikan sepenuhnya
    const sampleId = get(sensorSamples)[e.idx];
    if (!sampleId) return;

    // Counter & BPM detect
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

    if (!audioEnabled) return;
    try {
      await ensureRunning();
      // One-shot: mainkan sample sekali per hit
      const vel = Math.max(0.1, Math.min(1.0, (e.velocity ?? 64) / 127));
      SAMPLE_FNS[sampleId]?.(getAudioCtx().currentTime, vel);
    } catch {}
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
    <!-- BPM + Stop All -->
    <div class="flex items-center gap-3">
      <span class="text-xs text-slate-500 shrink-0">BPM</span>
      <input type="range" min="60" max="200" step="1" bind:value={beatBpm}
        class="flex-1 accent-cyan-500 h-1" />
      <span class="text-xs font-mono font-bold text-cyan-400 w-8 text-right">{beatBpm}</span>
      {#if beatActive.some(Boolean)}
        <button
          class="text-xs px-3 py-1 rounded-lg bg-red-950 text-red-400 border border-red-900 hover:bg-red-900 transition-colors shrink-0"
          on:click={stopAllBeats}>■ Stop</button>
      {/if}
    </div>
    <!-- 4 sensor butang -->
    <div class="grid grid-cols-4 gap-2">
      {#each $sensors as s, i}
        {@const sample = getSample($sensorSamples[i])}
        {@const looping = beatActive[i]}
        <button
          class="rounded-xl border-2 p-3 text-left transition-all duration-200 flex flex-col gap-1"
          style="border-color:{looping ? CLR[i] : sample.id ? CLR[i]+'66' : '#1e293b'};
                 background:{looping ? CLR[i]+'22' : sample.id ? CLR[i]+'0a' : '#0f172a'}"
          on:click={() => { selectedSensor.set(i); openPicker(); }}
        >
          <div class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
            {i === 0 ? '🥁' : i === 1 ? '🎹' : i === 2 ? '🪘' : '🎵'} {NAMES[i]}
          </div>
          {#if sample.id}
            <div class="text-xs font-medium truncate" style="color:{sample.color}">{sample.icon} {sample.label}</div>
            {#if looping}
              <div class="text-xs font-bold mt-0.5 animate-pulse" style="color:{CLR[i]}">▶ loop</div>
            {:else}
              <div class="text-xs mt-0.5 text-slate-600">kena sensor → loop</div>
            {/if}
          {:else}
            <div class="text-xs text-slate-600">— kosong —</div>
            <div class="text-xs text-slate-700 mt-0.5">klik assign</div>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <!-- DRUM PADS -->
  <section class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
    {#each $sensors as s, i}
      {@const sample = getSample($sensorSamples[i])}
      <div
        class="card p-4 transition-all duration-200"
        class:ring-1={!!sample.id && s.led > 0}
        style={sample.id && s.led > 0 ? `--tw-ring-color:${CLR[i]}` : ''}
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
            {i === 0 ? '🥁' : i === 1 ? '🎹' : i === 2 ? '🪘' : '🎵'} {NAMES[i]}
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
    <span class="text-slate-900">ESP32 · ADS1015 · Hall Sensor · HW-040</span>
  </footer>

</div>

<!-- Floating Sample Picker — muncul bila button NAV/SEL ditekan -->
<SamplePicker />
