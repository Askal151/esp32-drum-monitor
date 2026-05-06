<!--
  MasterTransport.svelte — Central Lock untuk semua sequencer
  - Play All / Stop All: semua sequencer start/stop serentak, snap ke bar boundary
  - Shared BPM: satu slider kawalan semua sequencer
  - Tap BPM: ketuk untuk detect tempo
  - Beat clock: 4 titik tunjuk posisi beat semasa (visual sync)
-->
<script>
  import { onDestroy } from 'svelte';
  import { masterBpm, masterCommand, getGridPhase } from './transport.js';
  import { ensureRunning } from './audio.js';

  let allPlaying = false;
  let step = -1;
  let rafId = null;

  // Beat clock via requestAnimationFrame
  function tick() {
    step = getGridPhase();
    rafId = requestAnimationFrame(tick);
  }

  async function playAll() {
    await ensureRunning();
    allPlaying = true;
    masterCommand.play();
    if (!rafId) tick();
  }

  function stopAll() {
    allPlaying = false;
    masterCommand.stop();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    step = -1;
  }

  // Tap BPM
  const _taps = [];
  function tapBpm() {
    const now = performance.now();
    _taps.push(now);
    if (_taps.length > 8) _taps.shift();
    if (_taps.length >= 2) {
      const intervals = _taps.slice(1).map((t, i) => t - _taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const tapped = Math.round(60000 / avg);
      masterBpm.set(Math.max(40, Math.min(220, tapped)));
    }
  }

  // Hapus taps lama jika berhenti 3 saat
  let _tapTimeout = null;
  function onTap() {
    clearTimeout(_tapTimeout);
    tapBpm();
    _tapTimeout = setTimeout(() => _taps.length = 0, 3000);
  }

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    clearTimeout(_tapTimeout);
  });

  // Label beat clock
  const BEAT_LABELS = ['1', '2', '3', '4'];
</script>

<div class="flex items-center gap-3 px-4 py-2.5 bg-slate-950 border-b-2 border-emerald-900 shrink-0 flex-wrap gap-y-2">

  <!-- Sync Lock badge -->
  <div class="flex items-center gap-1.5 shrink-0">
    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 tracking-widest">
      🔗 SYNC LOCK
    </span>
  </div>

  <!-- Beat clock — 4 titik untuk 4 beat -->
  <div class="flex items-center gap-1.5 shrink-0" title="Beat clock — posisi beat semasa">
    {#each [0, 4, 8, 12] as s, i}
      <div class="flex flex-col items-center gap-0.5">
        <div class="w-3.5 h-3.5 rounded-full transition-all duration-75
          {allPlaying && step >= s && step < s + 4
            ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] scale-110'
            : 'bg-slate-800 scale-100'}">
        </div>
        <span class="text-[8px] text-slate-700">{BEAT_LABELS[i]}</span>
      </div>
    {/each}
  </div>

  <!-- Play All / Stop All -->
  <button
    class="px-5 py-1.5 rounded-md text-xs font-bold ring-1 transition-all shrink-0
      {allPlaying
        ? 'bg-red-950 text-red-400 ring-red-900 hover:bg-red-900'
        : 'bg-emerald-950 text-emerald-400 ring-emerald-900 hover:bg-emerald-900'}"
    on:click={allPlaying ? stopAll : playAll}
    title="Play / Stop semua sequencer serentak"
  >
    {allPlaying ? '■ Stop All' : '▶ Play All'}
  </button>

  <!-- Divider -->
  <div class="w-px h-5 bg-slate-800 shrink-0"></div>

  <!-- Shared BPM slider -->
  <div class="flex items-center gap-2 flex-1 min-w-[180px]">
    <span class="text-[10px] text-slate-500 shrink-0 font-bold tracking-widest">BPM</span>
    <input
      type="range" min="40" max="220" step="1"
      bind:value={$masterBpm}
      class="flex-1 accent-emerald-500 cursor-pointer h-1"
    />
    <span class="text-base font-mono font-bold text-emerald-300 w-10 text-right shrink-0">{$masterBpm}</span>
  </div>

  <!-- Tap BPM -->
  <button
    class="text-xs px-3 py-1.5 rounded-md font-bold ring-1 ring-slate-700 bg-slate-900 text-slate-400
      hover:text-emerald-300 hover:ring-emerald-800 hover:bg-emerald-950 transition-all shrink-0 active:scale-95"
    on:click={onTap}
    title="Ketuk mengikut tempo untuk set BPM"
  >TAP</button>

  <!-- Status hint -->
  {#if allPlaying}
    <span class="text-[10px] text-emerald-500 animate-pulse shrink-0">● semua sync</span>
  {:else}
    <span class="text-[10px] text-slate-700 shrink-0">ketuk Play All untuk sync</span>
  {/if}

</div>
