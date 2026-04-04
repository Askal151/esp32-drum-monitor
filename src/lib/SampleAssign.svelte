<!--
  SampleAssign.svelte — UI untuk assign sample ke setiap sensor
  - 4 kolom sensor, klik untuk pilih sensor aktif
  - Klik sample untuk terus assign + preview
  - Button NAV (GPIO 26) = next sample, Button SEL (GPIO 25) = simpan
-->
<script>
  import {
    SAMPLES, SAMPLE_FNS, getSample,
    sensorSamples, selectedSensor, cursorIdx,
    saveSample, deleteSample, openPicker,
  } from './sampleStore.js';
  import { getAudioCtx, ensureRunning } from './audio.js';

  const SENSOR_NAMES  = ['SNARE', 'KICK', 'TOM', 'HI-HAT'];
  const SENSOR_COLORS = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6'];

  const GROUPS = [...new Set(SAMPLES.map(s => s.group))];

  async function previewSample(sampleId) {
    await ensureRunning();
    SAMPLE_FNS[sampleId]?.(getAudioCtx().currentTime, 0.7);
  }

  function clickSensor(i) {
    selectedSensor.set(i);
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
    <button
      class="text-xs px-2.5 py-1 rounded border border-amber-900 text-amber-400 bg-amber-950 hover:bg-amber-900 transition-colors"
      on:click={openPicker}
      title="Buka picker (atau tekan NAV button di ESP32)"
    >🎵 Pilih Sample</button>
  </div>

  <!-- 4 Sensor columns -->
  <div class="grid grid-cols-4 gap-2 flex-1 min-h-0">
    {#each [0, 1, 2, 3] as si}
      {@const savedId  = $sensorSamples[si]}
      {@const saved    = getSample(savedId)}
      {@const cursor   = $cursorIdx[si]}
      {@const isActive = $selectedSensor === si}

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
          <div class="flex items-center gap-1">
            <span class="text-xs">{saved.icon}</span>
            <span class="text-xs font-medium truncate" style="color:{savedId ? saved.color : '#64748b'}">{saved.label}</span>
            {#if savedId}
              <button
                class="ml-auto text-xs text-red-600 hover:text-red-400 transition-colors shrink-0"
                on:click|stopPropagation={() => deleteSample(si)}
                title="Kosongkan sensor ini"
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
                    {idx === cursor && isActive
                      ? 'text-slate-900 font-bold'
                      : savedId === sample.id
                        ? 'text-slate-200'
                        : 'text-slate-600 hover:text-slate-400'}"
                  style={idx === cursor && isActive
                    ? `background:${sample.color}; color:#080b12`
                    : savedId === sample.id
                      ? `color:${sample.color}`
                      : ''}
                  on:click|stopPropagation={() => clickSample(si, idx)}
                >
                  {#if savedId === sample.id}
                    <span class="text-xs">✓</span>
                  {:else if idx === cursor && isActive}
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
              title="Simpan sample (atau tekan SEL button di ESP32)"
            >💾 Simpan</button>
            <button
              class="text-xs px-2 py-1 rounded bg-slate-900 text-slate-500 border border-slate-800 hover:text-red-400 hover:border-red-900 transition-colors"
              on:click|stopPropagation={() => deleteSample(si)}
              title="Kosongkan sensor"
            >🗑</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Legend -->
  <div class="text-xs text-slate-700 flex items-center gap-3 shrink-0">
    <span>NAV button = sample seterusnya</span>
    <span>·</span>
    <span>SEL button = simpan sample</span>
  </div>
</div>
