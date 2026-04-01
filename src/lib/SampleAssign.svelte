<!--
  SampleAssign.svelte — UI untuk assign sample ke setiap sensor via encoder
  - 4 kolom sensor
  - Daftar sample per group (Western / Batak / Synth / Hasapi)
  - Encoder mode: 'sensor' = pilih sensor, 'sample' = scroll sample
-->
<script>
  import {
    SAMPLES, SAMPLE_FNS, getSample,
    sensorSamples, selectedSensor, encoderMode, cursorIdx,
    saveSample, deleteSample, encButton,
  } from './sampleStore.js';
  import { getAudioCtx, ensureRunning } from './audio.js';

  const SENSOR_NAMES  = ['SNARE', 'KICK', 'TOM', 'HI-HAT'];
  const SENSOR_COLORS = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6'];

  // Kelompokkan sample berdasarkan group
  const GROUPS = [...new Set(SAMPLES.map(s => s.group))];

  async function previewSample(sampleId) {
    await ensureRunning();
    const fn = SAMPLE_FNS[sampleId];
    fn?.(getAudioCtx().currentTime, 0.7);
  }

  function clickSensor(i) {
    selectedSensor.set(i);
    encoderMode.set('sample');
  }

  function clickSample(sensorIdx, sampleIdx) {
    cursorIdx.update(arr => {
      const next = [...arr];
      next[sensorIdx] = sampleIdx;
      return next;
    });
    previewSample(SAMPLES[sampleIdx].id);
  }

  // Scroll item kursor ke dalam view saat berubah
  let listEls = [null, null, null, null];
  $: {
    const si = $selectedSensor;
    const ci = $cursorIdx[si];
    const el = listEls[si];
    if (el) {
      const item = el.querySelector(`[data-idx="${ci}"]`);
      item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
</script>

<div class="flex flex-col gap-3 h-full bg-slate-950 rounded-lg p-3 overflow-y-auto">

  <!-- Header -->
  <div class="flex items-center justify-between shrink-0">
    <span class="text-xs font-bold tracking-widest text-slate-600">SAMPLE ASSIGN</span>
    <div class="flex items-center gap-2">
      <!-- Mode badge -->
      <span class="text-xs px-2 py-0.5 rounded font-bold
        {$encoderMode === 'sample'
          ? 'bg-amber-950 text-amber-400 border border-amber-900'
          : 'bg-slate-900 text-slate-600 border border-slate-800'}">
        {$encoderMode === 'sensor' ? '🎛 PILIH SENSOR' : '🔊 PILIH SAMPLE'}
      </span>
      <button
        class="text-xs px-2.5 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors"
        on:click={encButton}
        title="Toggle mode (sama dengan tekan SW encoder)"
      >Toggle Mode</button>
    </div>
  </div>

  <!-- 4 Sensor columns -->
  <div class="grid grid-cols-4 gap-2 flex-1 min-h-0">
    {#each [0, 1, 2, 3] as si}
      {@const savedId  = $sensorSamples[si]}
      {@const saved    = getSample(savedId)}
      {@const cursor   = $cursorIdx[si]}
      {@const isActive = $selectedSensor === si}
      {@const isSampleMode = isActive && $encoderMode === 'sample'}

      <div
        class="flex flex-col rounded-lg border-2 transition-all duration-200 overflow-hidden cursor-pointer
          {isActive
            ? 'border-current shadow-lg'
            : 'border-slate-800 opacity-70 hover:opacity-90'}"
        style="border-color:{isActive ? SENSOR_COLORS[si] : ''}"
        on:click={() => clickSensor(si)}
        role="button"
        tabindex="0"
        on:keydown={e => e.key === 'Enter' && clickSensor(si)}
      >
        <!-- Sensor header -->
        <div
          class="px-2 py-1.5 flex flex-col gap-0.5 shrink-0"
          style="background:{isActive ? SENSOR_COLORS[si] + '22' : 'transparent'}"
        >
          <span class="text-xs font-bold" style="color:{SENSOR_COLORS[si]}">{SENSOR_NAMES[si]}</span>
          <!-- Sample tersimpan -->
          <div class="flex items-center gap-1">
            <span class="text-xs">{saved.icon}</span>
            <span class="text-xs text-slate-300 font-medium truncate">{saved.label}</span>
            {#if savedId !== ['snare','kick','taganing','hihat'][si]}
              <button
                class="ml-auto text-xs text-red-600 hover:text-red-400 transition-colors shrink-0"
                on:click|stopPropagation={() => deleteSample(si)}
                title="Reset ke default"
              >✕</button>
            {/if}
          </div>
        </div>

        <!-- Sample list -->
        <div
          class="flex-1 overflow-y-auto min-h-0 py-1"
          bind:this={listEls[si]}
        >
          {#each GROUPS as group}
            <div class="px-2 py-0.5 text-xs text-slate-700 font-bold tracking-wide uppercase">
              {group}
            </div>
            {#each SAMPLES as sample, idx}
              {#if sample.group === group}
                <button
                  data-idx={idx}
                  class="w-full text-left px-2 py-1 text-xs flex items-center gap-1.5 transition-colors
                    {idx === cursor && isSampleMode
                      ? 'text-slate-900 font-bold'
                      : savedId === sample.id
                        ? 'text-slate-200'
                        : 'text-slate-600 hover:text-slate-400'}"
                  style={idx === cursor && isSampleMode
                    ? `background:${sample.color}; color:#080b12`
                    : savedId === sample.id
                      ? `color:${sample.color}`
                      : ''}
                  on:click|stopPropagation={() => clickSample(si, idx)}
                >
                  {#if savedId === sample.id}
                    <span class="text-xs">✓</span>
                  {:else if idx === cursor && isSampleMode}
                    <span class="text-xs">▶</span>
                  {:else}
                    <span class="text-xs opacity-0">·</span>
                  {/if}
                  <span>{sample.label}</span>
                </button>
              {/if}
            {/each}
          {/each}
        </div>

        <!-- Save / Delete footer -->
        {#if isActive}
          <div class="flex gap-1 p-1.5 border-t border-slate-800 shrink-0">
            <button
              class="flex-1 text-xs py-1 rounded font-bold bg-emerald-950 text-emerald-400 border border-emerald-900 hover:bg-emerald-900 transition-colors"
              on:click|stopPropagation={() => saveSample(si)}
              title="Simpan sample (atau tekan SAVE button di ESP32)"
            >💾 Save</button>
            <button
              class="text-xs px-2 py-1 rounded bg-slate-900 text-slate-500 border border-slate-800 hover:text-red-400 hover:border-red-900 transition-colors"
              on:click|stopPropagation={() => deleteSample(si)}
              title="Reset ke default (atau tekan DEL button di ESP32)"
            >🗑</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Legend -->
  <div class="text-xs text-slate-700 flex items-center gap-3 shrink-0">
    <span>Encoder: putar = navigasi · tekan SW = ganti mode</span>
    <span>·</span>
    <span>SAVE button = simpan · DEL button = reset</span>
  </div>
</div>
