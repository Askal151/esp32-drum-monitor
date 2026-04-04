<!--
  SamplePicker.svelte — Floating overlay state machine
  State: idle | sensor | action | sample
  NAV = navigate  •  SEL = confirm/OK
-->
<script>
  import { fly, fade } from 'svelte/transition';
  import {
    SAMPLES, ACTIONS, getSample,
    sensorSamples, selectedSensor, cursorIdx, actionCursor,
    pickerState, closePicker,
    saveSample, deleteSample,
  } from './sampleStore.js';

  const SENSOR_NAMES  = ['SNARE', 'KICK', 'TOM', 'HI-HAT'];
  const SENSOR_ICONS  = ['🥁', '🎹', '🪘', '🎵'];
  const SENSOR_COLORS = ['#22d3ee', '#4ade80', '#f59e0b', '#f472b6'];
  const GROUPS = [...new Set(SAMPLES.map(s => s.group))];

  $: visible = $pickerState !== 'idle';

  // ── Label breadcrumb header ──────────────────────────────────
  $: headerLabel = {
    sensor: 'Pilih Sensor',
    action: SENSOR_NAMES[$selectedSensor],
    sample: SENSOR_NAMES[$selectedSensor] + ' › Pilih Sample',
  }[$pickerState] ?? '';

  $: headerSub = {
    sensor: 'NAV = tukar sensor  •  SEL = OK',
    action: 'NAV = tukar tindakan  •  SEL = OK',
    sample: 'NAV = tukar sample  •  SEL = simpan',
  }[$pickerState] ?? '';

  // Scroll sample kursor ke view
  let sampleListEl = null;
  $: if ($pickerState === 'sample' && sampleListEl) {
    const ci   = $cursorIdx[$selectedSensor];
    const item = sampleListEl.querySelector(`[data-idx="${ci}"]`);
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Klik sensor terus dari panel sensor
  function clickSensor(i) {
    selectedSensor.set(i);
    // Terus ke action state
    import('./sampleStore.js').then(m => {
      m.actionCursor.set(0);
      m.pickerState.set('action');
    });
  }

  // Klik sample terus dari panel sample
  function clickSample(idx) {
    cursorIdx.update(arr => { const n = [...arr]; n[$selectedSensor] = idx; return n; });
    saveSample($selectedSensor);
    closePicker();
  }

  // Klik tindakan terus
  function clickAction(actionIdx) {
    import('./sampleStore.js').then(m => {
      const action = ACTIONS[actionIdx];
      if (action.id === 'assign') {
        m.pickerState.set('sample');
      } else {
        deleteSample($selectedSensor);
        closePicker();
      }
    });
  }
</script>

{#if visible}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-40 bg-black/20"
    role="presentation"
    on:click={closePicker}
    transition:fade={{ duration: 120 }}
  ></div>

  <!-- Panel -->
  <div
    class="fixed bottom-4 right-4 z-50 w-72 rounded-2xl border border-slate-700 bg-[#080b12] shadow-2xl flex flex-col overflow-hidden"
    style="max-height:500px"
    transition:fly={{ y: 20, duration: 200 }}
    role="dialog"
  >
    <!-- Header -->
    <div class="px-4 py-3 flex items-center justify-between shrink-0 border-b border-slate-800"
      style="background:{SENSOR_COLORS[$selectedSensor]}14">
      <div>
        <div class="text-xs font-bold tracking-wider" style="color:{SENSOR_COLORS[$selectedSensor]}">
          {headerLabel}
        </div>
        <div class="text-xs text-slate-600 mt-0.5">{headerSub}</div>
      </div>
      <button class="text-slate-600 hover:text-slate-300 text-base leading-none transition-colors"
        on:click={closePicker}>✕</button>
    </div>

    <!-- ── STATE: SENSOR ── -->
    {#if $pickerState === 'sensor'}
      <div class="p-3 grid grid-cols-2 gap-2">
        {#each [0,1,2,3] as i}
          {@const isActive = $selectedSensor === i}
          {@const saved    = getSample($sensorSamples[i])}
          <button
            class="rounded-xl border-2 p-3 text-left transition-all"
            style="border-color:{isActive ? SENSOR_COLORS[i] : '#1e293b'};
                   background:{isActive ? SENSOR_COLORS[i]+'18' : '#0f172a'}"
            on:click={() => clickSensor(i)}
          >
            <div class="text-lg mb-1">{SENSOR_ICONS[i]}</div>
            <div class="text-xs font-bold" style="color:{SENSOR_COLORS[i]}">{SENSOR_NAMES[i]}</div>
            <div class="text-xs mt-0.5 truncate" style="color:{saved.id ? saved.color : '#475569'}">
              {saved.label}
            </div>
            {#if isActive}
              <div class="mt-1.5 text-xs font-bold" style="color:{SENSOR_COLORS[i]}">▶ dipilih</div>
            {/if}
          </button>
        {/each}
      </div>

    <!-- ── STATE: ACTION ── -->
    {:else if $pickerState === 'action'}
      <div class="p-3 flex flex-col gap-2">
        <!-- Info sensor aktif -->
        {#each [getSample($sensorSamples[$selectedSensor])] as saved}
        <div class="px-3 py-2 rounded-lg bg-slate-900 flex items-center gap-2 mb-1">
          <span class="text-base">{SENSOR_ICONS[$selectedSensor]}</span>
          <div>
            <div class="text-xs font-bold" style="color:{SENSOR_COLORS[$selectedSensor]}">
              {SENSOR_NAMES[$selectedSensor]}
            </div>
            <div class="text-xs" style="color:{saved.id ? saved.color : '#475569'}">{saved.label}</div>
          </div>
        </div>
        {/each}

        <!-- Pilihan tindakan -->
        {#each ACTIONS as action, i}
          {@const isActive = $actionCursor === i}
          <button
            class="rounded-xl border-2 px-4 py-3 flex items-center gap-3 transition-all text-left"
            style="border-color:{isActive ? (i === 0 ? '#22d3ee' : '#ef4444') : '#1e293b'};
                   background:{isActive ? (i === 0 ? '#22d3ee18' : '#ef444418') : '#0f172a'};
                   color:{isActive ? (i === 0 ? '#22d3ee' : '#ef4444') : '#64748b'}"
            on:click={() => clickAction(i)}
          >
            <span class="text-xl">{action.icon}</span>
            <div>
              <div class="text-sm font-bold">{action.label}</div>
              <div class="text-xs opacity-60">
                {i === 0 ? 'Pilih & simpan sample baru' : 'Kosongkan sensor ini'}
              </div>
            </div>
            {#if isActive}
              <span class="ml-auto text-xs font-bold">◀</span>
            {/if}
          </button>
        {/each}
      </div>

    <!-- ── STATE: SAMPLE ── -->
    {:else if $pickerState === 'sample'}
      <div class="flex-1 overflow-y-auto min-h-0 py-1" bind:this={sampleListEl}>
        {#each GROUPS as group}
          <div class="px-3 py-1 text-xs text-slate-700 font-bold tracking-wide uppercase sticky top-0 bg-[#080b12]">
            {group}
          </div>
          {#each SAMPLES as sample, idx}
            {#if sample.group === group}
              {@const isCursor = idx === $cursorIdx[$selectedSensor]}
              {@const isSaved  = $sensorSamples[$selectedSensor] === sample.id}
              <button
                data-idx={idx}
                class="w-full text-left px-3 py-2 flex items-center gap-2.5 text-xs transition-colors"
                style={isCursor
                  ? `background:${sample.color}22; color:${sample.color}`
                  : isSaved
                    ? `color:${sample.color}`
                    : 'color:#64748b'}
                on:click={() => clickSample(idx)}
              >
                <span class="w-4 text-center shrink-0">
                  {#if isCursor}▶{:else if isSaved}✓{:else}&nbsp;{/if}
                </span>
                <span class="text-sm">{sample.icon}</span>
                <span class="font-medium">{sample.label}</span>
                {#if isSaved && !isCursor}
                  <span class="ml-auto text-xs opacity-50">aktif</span>
                {/if}
              </button>
            {/if}
          {/each}
        {/each}
      </div>
    {/if}

    <!-- Footer -->
    <div class="shrink-0 border-t border-slate-800 px-3 py-2 flex items-center gap-3 bg-slate-950/80">
      <div class="flex items-center gap-1.5 text-xs text-slate-600">
        <kbd class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono text-xs">NAV</kbd>
        <span>navigasi</span>
      </div>
      <div class="flex items-center gap-1.5 text-xs text-slate-600">
        <kbd class="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono text-xs">SEL</kbd>
        <span>ok</span>
      </div>
      <span class="ml-auto text-xs text-slate-800">auto-cancel 8s</span>
    </div>
  </div>
{/if}
