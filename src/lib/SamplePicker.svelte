<!--
  SamplePicker.svelte — Floating overlay untuk pilih sample guna button fizikal
  Muncul apabila button NAV ditekan, hilang selepas 5s atau selepas SEL
  BTN_NAV (GPIO 26) = navigasi next sample
  BTN_SEL (GPIO 25) = confirm/simpan
-->
<script>
  import { fly, fade } from 'svelte/transition';
  import {
    SAMPLES, getSample,
    sensorSamples, selectedSensor, cursorIdx,
    pickerVisible, hidePicker, saveSample, showPicker,
  } from './sampleStore.js';

  const SENSOR_NAMES  = ['SNARE', 'KICK', 'TOM', 'HI-HAT'];
  const SENSOR_ICONS  = ['🥁', '🎹', '🪘', '🎵'];
  const SENSOR_COLORS = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6'];
  const GROUPS = [...new Set(SAMPLES.map(s => s.group))];

  // Scroll item kursor ke view setiap kali cursor berubah
  let listEl = null;
  $: {
    const ci = $cursorIdx[$selectedSensor];
    if (listEl) {
      const item = listEl.querySelector(`[data-idx="${ci}"]`);
      item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
</script>

{#if $pickerVisible}
  <!-- Backdrop tipis -->
  <div
    class="fixed inset-0 z-40"
    role="presentation"
    on:click={hidePicker}
    transition:fade={{ duration: 150 }}
  ></div>

  <!-- Panel picker -->
  <div
    class="fixed bottom-4 right-4 z-50 w-64 rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl flex flex-col overflow-hidden"
    style="max-height: 480px"
    transition:fly={{ y: 24, duration: 220 }}
    role="dialog"
    aria-label="Pilih sample"
  >
    <!-- Header -->
    <div
      class="px-3 py-2.5 flex items-center justify-between shrink-0 border-b border-slate-800"
      style="background: {SENSOR_COLORS[$selectedSensor]}18"
    >
      <div class="flex items-center gap-2">
        <span class="text-base">{SENSOR_ICONS[$selectedSensor]}</span>
        <div>
          <div class="text-xs font-bold tracking-widest" style="color:{SENSOR_COLORS[$selectedSensor]}">
            {SENSOR_NAMES[$selectedSensor]}
          </div>
          <div class="text-xs text-slate-600">Pilih sample</div>
        </div>
      </div>
      <button
        class="text-slate-600 hover:text-slate-400 text-sm transition-colors"
        on:click={hidePicker}
        title="Tutup"
      >✕</button>
    </div>

    <!-- Sample list -->
    <div class="flex-1 overflow-y-auto min-h-0 py-1" bind:this={listEl}>
      {#each GROUPS as group}
        <div class="px-3 py-1 text-xs text-slate-700 font-bold tracking-wide uppercase">
          {group}
        </div>
        {#each SAMPLES as sample, idx}
          {#if sample.group === group}
            {@const isCursor  = idx === $cursorIdx[$selectedSensor]}
            {@const isSaved   = $sensorSamples[$selectedSensor] === sample.id}
            <button
              data-idx={idx}
              class="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors text-xs"
              style={isCursor
                ? `background:${sample.color}22; color:${sample.color}`
                : isSaved
                  ? `color:${sample.color}`
                  : 'color:#64748b'}
              on:click={() => {
                cursorIdx.update(arr => { const n=[...arr]; n[$selectedSensor]=idx; return n; });
                saveSample($selectedSensor);
                hidePicker();
              }}
            >
              <!-- Indicator -->
              {#if isCursor}
                <span class="font-bold text-base leading-none" style="color:{sample.color}">▶</span>
              {:else if isSaved}
                <span class="text-sm leading-none" style="color:{sample.color}">✓</span>
              {:else}
                <span class="opacity-0 text-sm">·</span>
              {/if}

              <span class="mr-1">{sample.icon}</span>
              <span class="font-medium">{sample.label}</span>

              {#if isCursor && !isSaved}
                <span class="ml-auto text-xs opacity-50">preview</span>
              {/if}
              {#if isSaved}
                <span class="ml-auto text-xs opacity-60">aktif</span>
              {/if}
            </button>
          {/if}
        {/each}
      {/each}
    </div>

    <!-- Footer: panduan button -->
    <div class="shrink-0 border-t border-slate-800 px-3 py-2 flex items-center justify-between bg-slate-950">
      <div class="flex items-center gap-2 text-xs text-slate-600">
        <kbd class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-slate-400">NAV</kbd>
        <span>seterusnya</span>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-600">
        <kbd class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-slate-400">SEL</kbd>
        <span>simpan</span>
      </div>
    </div>
  </div>
{/if}
