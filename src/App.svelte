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
  import FirmwareFlasher   from './lib/FirmwareFlasher.svelte';
  import SampleUpload      from './lib/SampleUpload.svelte';
  import MasterTransport   from './lib/MasterTransport.svelte';
  import { masterBpm, syncToGrid, leaveGrid } from './lib/transport.js';
  import { unlockAudio, isRunning, getAudioCtx, ensureRunning, stopWavSources, startWavLoop, stopWavLoop, updateWavLoopRate } from './lib/audio.js';
  import {
    portState, connected, sensors, packetCount,
    connect, disconnect, sendCmd,
    hitEvent, btnEvent, bpmCtrl, pitchCtrl,
  } from './lib/serial.js';
  import { get } from 'svelte/store';
  import {
    SAMPLE_FNS, BEAT_DATA, getSample,
    sensorSamples, selectedSensor,
    saveSample, deleteSample,
    btnNav, btnSel,
  } from './lib/sampleStore.js';

  const CLR   = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6', '#a78bfa', '#fb923c', '#34d399', '#f87171'];
  const NAMES = ['Congkak 1', 'Congkak 2', 'Congkak 3', 'Congkak 4', 'Congkak 5', 'Congkak 6', 'Congkak 7', 'Congkak 8'];

  let tab = 'drum';
  let sampleUploadRef;
  let lastError   = '';
  let audioReady  = false;
  let audioEnabled = true;
  let hits = [0, 0, 0, 0, 0, 0, 0, 0];
  let bpm  = [0, 0, 0, 0, 0, 0, 0, 0];
  const hitTimes = [[], [], [], [], [], [], [], []];

  // ── BPM override per sensor (dari potensio + button BPMNAV) ──
  // _sensorBpm: array plain JS (bukan Svelte reactive) — dibaca terus dalam setInterval closure
  // sensorBpm:  Svelte reactive copy — untuk update template sahaja
  const _sensorBpm = new Array(8).fill(120);   // dibaca dalam closure
  let   sensorBpm  = new Array(8).fill(120);   // untuk template display

  // ── Pitch override per sensor (dari potensio + button PITCHNAV) ──
  const _sensorPitch = new Array(8).fill(0);   // semitones -12..+12, dibaca dalam closure
  let   sensorPitch  = new Array(8).fill(0);   // untuk template display

  // ── Per-sensor beat sequencer (BEAT_DATA-driven) ──────────────
  // Setiap sensor memainkan pola beat lengkap (16-step) dari BEAT_DATA
  // Sequencer bermula apabila LED > 0, berhenti apabila LED = 0
  let seqActive = [false, false, false, false, false, false, false, false];
  const _seqTimers    = new Array(8).fill(null);
  const _seqPending   = new Array(8).fill(false); // guard async start race condition
  const _seqStep      = new Array(8).fill(0);
  const _seqNextTime  = new Array(8).fill(0);
  const _manualPlaying = new Array(8).fill(false); // dibaca dalam closure setInterval
  let   manualPads     = [..._manualPlaying];      // reactive copy untuk template
  let   manualPlayActive = false;

  function _setManualPad(idx, val) {
    _manualPlaying[idx] = val;
    manualPads = [..._manualPlaying]; // trigger Svelte reactivity
  }

  const SEQ_TICK_MS   = 25;
  const SEQ_LOOKAHEAD = 0.1;  // saat lookahead Web Audio

  async function _startSensorSeq(idx) {
    if (_seqTimers[idx] || _seqPending[idx]) return;
    _seqPending[idx] = true;

    // Snap ke bar boundary yang sama dengan semua sequencer lain
    const { nextNote } = await syncToGrid();
    _seqStep[idx]     = 0;
    _seqNextTime[idx] = nextNote;
    _seqPending[idx]  = false;

    // Uploaded WAV: loop terus tanpa step sequencer
    const beatId0 = get(sensorSamples)[idx];
    const beat0   = BEAT_DATA[beatId0];
    if (beat0?.isUpload && beat0?.buffer) {
      const initRate = (_sensorBpm[idx] / 120) * Math.pow(2, (_sensorPitch[idx] || 0) / 12);
      startWavLoop(beat0.buffer, idx, initRate);
    }

    _seqTimers[idx] = setInterval(() => {
      const ac2 = isRunning() ? getAudioCtx() : null;
      // Henti senyap — JANGAN sentuh seqActive dari sini (elak re-render)
      if (!ac2) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; leaveGrid(); return; }

      const beatId = get(sensorSamples)[idx];
      if (!beatId) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; leaveGrid(); return; }

      const s = get(sensors)[idx];
      if (s.led === 0 && !_manualPlaying[idx]) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; leaveGrid(); return; }

      const beat = BEAT_DATA[beatId];
      if (!beat) { clearInterval(_seqTimers[idx]); _seqTimers[idx] = null; _seqStep[idx] = 0; leaveGrid(); return; }

      const stepDur = 60 / get(masterBpm) / 4;  // guna masterBpm — sama dengan semua sequencer

      while (_seqNextTime[idx] < ac2.currentTime + SEQ_LOOKAHEAD) {
        const step = _seqStep[idx];
        const t    = _seqNextTime[idx];
        const vel  = _manualPlaying[idx]
          ? 0.8
          : (s.thresh?.[3] > s.thresh?.[0])
            ? Math.max(0.3, Math.min(1.0, (Math.abs(s.dev) - s.thresh[0]) / (s.thresh[3] - s.thresh[0])))
            : 0.7;

        const pitchRate = Math.pow(2, (_sensorPitch[idx] || 0) / 12);
        if (beat.isUpload) {
          // Uploaded WAV: loop sudah dimulakan di _startSensorSeq, skip di sini
        } else if (beat.isWav) {
          if (step % 4 === 0) SAMPLE_FNS[beatId]?.(t, vel, pitchRate, idx);
        } else {
          for (const [instrId, pattern] of Object.entries(beat.tracks)) {
            const v = pattern[step];
            if (v > 0) SAMPLE_FNS[instrId]?.(t, v * vel, pitchRate);
          }
        }

        _seqStep[idx]     = (step + 1) % 16;
        _seqNextTime[idx] += stepDur;
      }
    }, SEQ_TICK_MS);
    // seqActive dikemas kini oleh sensors.subscribe sahaja
  }

  function _stopSensorSeq(idx) {
    if (!_seqTimers[idx]) return;
    clearInterval(_seqTimers[idx]);
    _seqTimers[idx] = null;
    _seqStep[idx]   = 0;
    stopWavLoop(idx);
    stopWavSources(idx);
    leaveGrid();
  }

  async function playAll() {
    if (!isRunning()) await activateAudio();
    if (!isRunning()) return;
    const samples = get(sensorSamples);
    let changed = false;
    for (let i = 0; i < 8; i++) {
      if (samples[i] && !_manualPlaying[i]) {
        _setManualPad(i, true);
        _startSensorSeq(i);
        if (!seqActive[i]) { seqActive[i] = true; changed = true; }
      }
    }
    if (changed) seqActive = [...seqActive];
    manualPlayActive = _manualPlaying.some(Boolean);
  }

  function stopAllBeats() {
    for (let i = 0; i < 8; i++) {
      _setManualPad(i, false);
      _stopSensorSeq(i);
    }
    sampleUploadRef?.stopPreview();
    seqActive = [false, false, false, false, false, false, false, false];
    manualPlayActive = false;
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

  // Update playbackRate WAV loop bila BPM/pitch berubah
  function _updateWavLoopRate(idx) {
    const beatId = get(sensorSamples)[idx];
    const beat   = BEAT_DATA[beatId];
    if (!beat?.isUpload) return;
    const rate = (_sensorBpm[idx] / 120) * Math.pow(2, (_sensorPitch[idx] || 0) / 12);
    updateWavLoopRate(idx, rate);
  }

  // ── BPM control dari potensio + button BPMNAV ────────────────
  $: {
    const { sel, bpm: b } = $bpmCtrl;
    _sensorBpm[sel] = b;
    sensorBpm = [..._sensorBpm];
    _updateWavLoopRate(sel);
  }

  function applyBpm(sel, bpm) {
    const b = Math.max(40, Math.min(200, bpm));
    _sensorBpm[sel] = b;
    sensorBpm = [..._sensorBpm];
    bpmCtrl.set({ sel, bpm: b });
    _updateWavLoopRate(sel);
  }

  // ── Pitch control dari potensio + button PITCHNAV ─────────────
  $: {
    const { sel, pitch: p } = $pitchCtrl;
    _sensorPitch[sel] = p;
    sensorPitch = [..._sensorPitch];
    _updateWavLoopRate(sel);
  }

  function applyPitch(sel, pitch) {
    const p = Math.max(-12, Math.min(12, pitch));
    _sensorPitch[sel] = p;
    sensorPitch = [..._sensorPitch];
    pitchCtrl.set({ sel, pitch: p });
    _updateWavLoopRate(sel);
  }

  // ── Button fizikal NAV / SEL ───────────────────────────────────
  btnEvent.subscribe(e => {
    if (!e.ts) return;
    if (e.btn === 'NAV') {
      btnNav();
      tab = 'assign';
    }
    if (e.btn === 'SEL') {
      btnSel();
    }
  });

  let selectedBaud = 115200;
  const BAUD_OPTIONS = [115200, 74880, 9600];

  async function toggleConn() {
    lastError = '';
    unlockAudio();
    if ($connected) {
      await disconnect();
    } else {
      try { await connect(selectedBaud); } catch(e) { lastError = e.message; }
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

  // ── Trigger pad — toggle loop per pad (klik atau keyboard 1-8) ──
  async function triggerPad(idx) {
    // Jika pad sedang main → stop
    if (_manualPlaying[idx]) {
      _setManualPad(idx, false);
      _stopSensorSeq(idx);
      seqActive[idx] = false;
      seqActive = [...seqActive];
      manualPlayActive = _manualPlaying.some(Boolean);
      return;
    }

    const sampleId = get(sensorSamples)[idx];
    if (!sampleId) return;

    if (!isRunning()) await activateAudio();
    if (!isRunning()) return;

    // Mula loop untuk pad ini
    _setManualPad(idx, true);
    _startSensorSeq(idx);
    seqActive[idx] = true;
    seqActive = [...seqActive];
    manualPlayActive = true;
  }

  // Keyboard shortcut: N=NAV, S=SEL, B=next BPM sensor, [=BPM-5, ]=BPM+5
  // P=next Pitch sensor, ,=Pitch-1, .=Pitch+1
  // 1-8 = trigger pad langsung
  function onKeydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') { btnNav(); tab = 'assign'; }
    if (e.key === 's' || e.key === 'S') { btnSel(); }
    if (e.key === 'b' || e.key === 'B') {
      const nextSel = (get(bpmCtrl).sel + 1) % 8;
      bpmCtrl.set({ sel: nextSel, bpm: _sensorBpm[nextSel] });
    }
    if (e.key === '[') { const s = get(bpmCtrl).sel; applyBpm(s, _sensorBpm[s] - 5); }
    if (e.key === ']') { const s = get(bpmCtrl).sel; applyBpm(s, _sensorBpm[s] + 5); }
    if (e.key === 'p' || e.key === 'P') {
      const nextSel = (get(pitchCtrl).sel + 1) % 8;
      pitchCtrl.set({ sel: nextSel, pitch: _sensorPitch[nextSel] });
    }
    if (e.key === ',') { const s = get(pitchCtrl).sel; applyPitch(s, _sensorPitch[s] - 1); }
    if (e.key === '.') { const s = get(pitchCtrl).sel; applyPitch(s, _sensorPitch[s] + 1); }
    // Pad 1–8 trigger tanpa sensor
    if (e.key >= '1' && e.key <= '8') triggerPad(parseInt(e.key) - 1);
    // Space = play/stop semua
    if (e.key === ' ') { e.preventDefault(); manualPlayActive ? stopAllBeats() : playAll(); }
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
      {:else if $portState === 'connecting'}
        <span class="text-xs font-bold text-yellow-400 animate-pulse">⏳ Menyambung...</span>
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
        on:click={() => tab = 'assign'}
        title="Buka halaman Sample Assign"
      >🎵 Pilih Sample</button>
      {#if $connected}
        <button class="btn-gray" on:click={() => sendCmd('s')}>📋 Status</button>
        <button class="btn-gray" on:click={() => sendCmd('r')}>↺ Reset</button>
      {/if}
      {#if !$connected}
        <select
          bind:value={selectedBaud}
          class="text-xs px-2 py-1.5 rounded-md bg-slate-800 text-slate-400 ring-1 ring-slate-700 outline-none cursor-pointer"
          title="Baud rate — 115200 untuk firmware, 74880 untuk bootloader"
        >
          {#each BAUD_OPTIONS as b}
            <option value={b}>{b}</option>
          {/each}
        </select>
      {/if}
      <button
        class="{$connected ? 'btn-disconnect' : 'btn-connect'} disabled:opacity-40 disabled:cursor-not-allowed"
        on:click={toggleConn}
        disabled={$portState === 'connecting'}
      >
        {$connected ? '⏏ Putus' : $portState === 'connecting' ? '⏳ Tunggu...' : '⚡ Sambung'}
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

  <!-- Hint mod standalone -->
  {#if !$connected && audioReady}
    <div class="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-500 flex items-center gap-3">
      <span class="text-slate-400 font-medium">🥁 Mod Standalone</span>
      <span>Klik pad atau tekan <kbd class="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">1</kbd>–<kbd class="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">8</kbd> untuk hit · <kbd class="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono">Space</kbd> play/stop loop.</span>
    </div>
  {/if}

  {#if lastError}
    <div class="bg-red-950 border border-red-800 rounded-xl px-4 py-2 text-xs text-red-300 flex items-center justify-between">
      <span>⚠ {lastError}</span>
      <button class="text-red-500 ml-4" on:click={() => lastError=''}>✕</button>
    </div>
  {/if}

  <!-- SENSOR SELECTOR — 4 butang pilih sensor + sample + beat indicator -->
  <section class="card p-3 flex flex-col gap-2">
    <!-- BPM control panel — potensio + button BPMNAV / keyboard B [ ] -->
    <div class="flex items-center gap-2 px-1 py-1 rounded-lg bg-slate-900 border border-slate-800">
      <span class="text-[10px] text-slate-500 shrink-0">🎛 BPM:</span>
      <button
        class="text-[10px] px-2 py-0.5 rounded font-bold border transition-colors shrink-0"
        style="border-color:{CLR[$bpmCtrl.sel]}44; color:{CLR[$bpmCtrl.sel]}; background:{CLR[$bpmCtrl.sel]}15"
        on:click={() => { const next = ($bpmCtrl.sel + 1) % 8; bpmCtrl.set({ sel: next, bpm: _sensorBpm[next] }); }}
        title="Cycle sensor (B)"
      >▶ {NAMES[$bpmCtrl.sel]}</button>
      <button
        class="text-xs w-6 h-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 font-bold shrink-0"
        on:click={() => applyBpm($bpmCtrl.sel, sensorBpm[$bpmCtrl.sel] - 5)}
        title="BPM -5 ([)"
      >−</button>
      <span class="text-sm font-bold text-white w-12 text-center shrink-0">{sensorBpm[$bpmCtrl.sel]}</span>
      <button
        class="text-xs w-6 h-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 font-bold shrink-0"
        on:click={() => applyBpm($bpmCtrl.sel, sensorBpm[$bpmCtrl.sel] + 5)}
        title="BPM +5 (])"
      >+</button>
      <!-- BPM mini bar -->
      <div class="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden mx-1">
        <div class="h-full rounded-full transition-all duration-150"
          style="width:{((sensorBpm[$bpmCtrl.sel] - 40) / 160 * 100).toFixed(1)}%; background:{CLR[$bpmCtrl.sel]}"></div>
      </div>
      <span class="text-[10px] text-slate-600 shrink-0">kb: B [ ]</span>
    </div>
    <!-- Pitch control panel — potensio + button PITCHNAV / keyboard P , . -->
    <div class="flex items-center gap-2 px-1 py-1 rounded-lg bg-slate-900 border border-slate-800">
      <span class="text-[10px] text-slate-500 shrink-0">🎵 Pitch:</span>
      <button
        class="text-[10px] px-2 py-0.5 rounded font-bold border transition-colors shrink-0"
        style="border-color:{CLR[$pitchCtrl.sel]}44; color:{CLR[$pitchCtrl.sel]}; background:{CLR[$pitchCtrl.sel]}15"
        on:click={() => { const next = ($pitchCtrl.sel + 1) % 8; pitchCtrl.set({ sel: next, pitch: _sensorPitch[next] }); }}
        title="Cycle sensor (P)"
      >▶ {NAMES[$pitchCtrl.sel]}</button>
      <button
        class="text-xs w-6 h-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 font-bold shrink-0"
        on:click={() => applyPitch($pitchCtrl.sel, sensorPitch[$pitchCtrl.sel] - 1)}
        title="Pitch -1 (,)"
      >−</button>
      <span class="text-sm font-bold text-white w-14 text-center shrink-0">
        {sensorPitch[$pitchCtrl.sel] > 0 ? '+' : ''}{sensorPitch[$pitchCtrl.sel]} st
      </span>
      <button
        class="text-xs w-6 h-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 font-bold shrink-0"
        on:click={() => applyPitch($pitchCtrl.sel, sensorPitch[$pitchCtrl.sel] + 1)}
        title="Pitch +1 (.)"
      >+</button>
      <!-- Pitch bi-directional bar (tengah = 0) -->
      <div class="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden mx-1 relative">
        <div class="absolute top-0 h-full rounded-full transition-all duration-150"
          style="
            left:{sensorPitch[$pitchCtrl.sel] >= 0 ? '50%' : (50 + sensorPitch[$pitchCtrl.sel] / 12 * 50).toFixed(1) + '%'};
            width:{(Math.abs(sensorPitch[$pitchCtrl.sel]) / 12 * 50).toFixed(1)}%;
            background:{CLR[$pitchCtrl.sel]}
          "></div>
      </div>
      <span class="text-[10px] text-slate-600 shrink-0">kb: P , .</span>
    </div>
    <!-- Transport: Play / Stop toggle -->
    <div class="flex items-center gap-2 px-1 py-1 rounded-lg bg-slate-900 border border-slate-800">
      <button
        class="flex items-center gap-1.5 text-xs px-5 py-1.5 rounded-lg font-bold transition-all shrink-0
          {manualPlayActive
            ? 'bg-red-950 text-red-400 border border-red-900 hover:bg-red-900'
            : 'bg-green-950 text-green-400 border border-green-900 hover:bg-green-900'}"
        on:click={() => manualPlayActive ? stopAllBeats() : playAll()}
        title="Play / Stop (Space)"
      >
        {manualPlayActive ? '■ Stop' : '▶ Play'}
      </button>
      <div class="flex-1 text-xs text-slate-600 text-right pr-1">
        {#if manualPlayActive}
          <span class="text-green-500 animate-pulse">● sedang main</span>
        {:else if seqActive.some(Boolean)}
          <span class="text-amber-600">● sensor aktif</span>
        {:else}
          <span>kb: Space</span>
        {/if}
      </div>
    </div>
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
          on:click={() => { selectedSensor.set(i); tab = 'assign'; }}
        >
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold tracking-widest" style="color:{CLR[i]}">
              {NAMES[i]}
            </div>
            <div class="flex items-center gap-1 flex-wrap justify-end">
              {#if $bpmCtrl.sel === i}
                <span class="text-[9px] font-bold px-1 rounded" style="background:{CLR[i]}22; color:{CLR[i]}">🎛 {sensorBpm[i]} BPM</span>
              {:else}
                <span class="text-[9px] text-slate-700">{sensorBpm[i]} BPM</span>
              {/if}
              {#if $pitchCtrl.sel === i}
                <span class="text-[9px] font-bold px-1 rounded" style="background:{CLR[i]}22; color:{CLR[i]}">🎵 {sensorPitch[i] > 0 ? '+' : ''}{sensorPitch[i]}st</span>
              {:else if sensorPitch[i] !== 0}
                <span class="text-[9px] text-slate-700">{sensorPitch[i] > 0 ? '+' : ''}{sensorPitch[i]}st</span>
              {/if}
              <span class="text-[9px] text-slate-700">{chip}</span>
            </div>
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
            on:click={() => { selectedSensor.set(i); tab = 'assign'; }}
          >
            <span>{sample.icon}</span>
            <span>{sample.label}</span>
          </button>
        </div>
        <DrumPad
          idx          = {i}
          name         = {NAMES[i]}
          color        = {CLR[i]}
          adc          = {s.adc}
          dev          = {s.dev}
          led          = {s.led}
          hits         = {hits[i]}
          bpm          = {bpm[i]}
          seqBpm       = {sensorBpm[i]}
          pitch        = {sensorPitch[i]}
          bpmSelected  = {$bpmCtrl.sel === i}
          pitchSelected = {$pitchCtrl.sel === i}
          hasSample    = {!!sample.id}
          connected    = {$connected}
          playing      = {manualPads[i]}
          on:tap       = {() => triggerPad(i)}
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
      <button class="tab-item {tab==='upload'    ? 'active' : ''}" on:click={() => tab='upload'}>📤 Upload Sample</button>
      <button class="tab-item {tab==='monitor'   ? 'active' : ''}" on:click={() => tab='monitor'}>⬛ Serial Monitor</button>
      <button class="tab-item {tab==='flash'     ? 'active' : ''}" on:click={() => tab='flash'}>⚡ Flash Firmware</button>
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
        <MasterTransport />
        <div style="height:310px; flex:none"><BeatSequencer /></div>
        <div class="border-t border-slate-800" style="height:250px; flex:none"><SynthSequencer /></div>
        <div class="border-t-2 border-amber-900" style="height:290px; flex:none"><TagadingSequencer /></div>
        <div class="border-t-2 border-pink-900" style="height:280px; flex:none"><HasapiSequencer /></div>
      </div>

      <!-- Upload Sample — always mounted -->
      <div class="absolute inset-0" style="display:{tab==='upload' ? 'flex' : 'none'}; flex-direction:column">
        <SampleUpload bind:this={sampleUploadRef} />
      </div>

      <!-- Serial Monitor — always mounted -->
      <div class="absolute inset-0 p-2" style="display:{tab==='monitor' ? 'flex' : 'none'}; flex-direction:column">
        <SerialMonitor onSendCmd={sendCmd} />
      </div>

      <!-- Flash Firmware — always mounted -->
      <div class="absolute inset-0" style="display:{tab==='flash' ? 'flex' : 'none'}; flex-direction:column">
        <FirmwareFlasher />
      </div>

    </div>
  </section>

  <!-- FOOTER -->
  <footer class="flex justify-between items-center px-3 py-1.5 text-xs text-slate-700 bg-slate-950 border border-slate-900 rounded-xl">
    <span>
      {#if $portState === 'idle'}
        Klik ⚡ Sambung → pilih port ESP32 (115200) — Chrome / Edge sahaja
      {:else if $portState === 'connecting'}
        ⏳ Tunggu ESP32 boot + kalibrasi sensor (±5 saat)...
      {:else}
        ● Menerima data sensor drum
      {/if}
    </span>
    <span class="text-slate-900">ESP32 · ADS1015+ADS1115 · 8× Hall Sensor · HW-040</span>
  </footer>

</div>

<!-- Floating Sample Picker — muncul bila button NAV/SEL ditekan -->
<SamplePicker />
