<script>
  import {
    uploadedSamples,
    addUploadedSample,
    removeUploadedSample,
  } from './sampleStore.js';
  import { isRunning, ensureRunning, startPreviewBuffer, stopPreviewBuffer } from './audio.js';

  let dragging  = false;
  let uploading = false;
  let errors    = [];
  let playingId = null;

  export function stopPreview() {
    stopPreviewBuffer();
    playingId = null;
  }

  async function togglePreview(s) {
    if (playingId === s.id) { stopPreview(); return; }
    stopPreview();
    await ensureRunning();
    if (!isRunning()) return;
    const src = startPreviewBuffer(s.buffer);
    src.onended = () => { playingId = null; };
    playingId = s.id;
  }

  async function handleFiles(files) {
    errors = [];
    uploading = true;
    for (const file of files) {
      if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3|ogg|flac|aac|m4a)$/i)) {
        errors = [...errors, `${file.name}: bukan fail audio`];
        continue;
      }
      try {
        const name = file.name.replace(/\.[^.]+$/, '');
        await addUploadedSample(name, file);
      } catch (e) {
        errors = [...errors, `${file.name}: ${e.message ?? 'gagal dimuatkan'}`];
      }
    }
    uploading = false;
  }

  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    handleFiles([...e.dataTransfer.files]);
  }

  function onDragover(e) {
    e.preventDefault();
    dragging = true;
  }

  function onFileInput(e) {
    handleFiles([...e.target.files]);
    e.target.value = '';
  }

  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return m > 0 ? `${m}:${s.padStart(4,'0')}` : `${s}s`;
  }
</script>

<div class="flex flex-col gap-3 h-full overflow-y-auto p-3">

  <!-- Drop zone -->
  <div
    role="region"
    aria-label="Zon muat naik audio"
    class="border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer select-none"
    class:border-cyan-500={dragging}
    class:bg-cyan-950={dragging}
    class:scale-[1.01]={dragging}
    class:border-slate-700={!dragging}
    class:bg-slate-900={!dragging}
    on:dragover={onDragover}
    on:dragleave={() => dragging = false}
    on:drop={onDrop}
  >
    <div class="text-3xl mb-2">{dragging ? '⬇' : '🎵'}</div>
    <div class="text-sm font-medium text-slate-300 mb-1">
      {dragging ? 'Lepaskan fail di sini' : 'Seret & lepas fail audio di sini'}
    </div>
    <div class="text-xs text-slate-600 mb-4">WAV · MP3 · OGG · FLAC · AAC · M4A</div>
    <label
      class="inline-flex items-center gap-2 text-xs px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer
             {uploading
               ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
               : 'bg-cyan-900 text-cyan-300 border border-cyan-700 hover:bg-cyan-800'}"
    >
      {#if uploading}
        <span class="animate-spin">⏳</span> Memuat...
      {:else}
        📂 Pilih Fail
      {/if}
      <input
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac,.aac,.m4a"
        multiple
        class="hidden"
        disabled={uploading}
        on:change={onFileInput}
      />
    </label>
  </div>

  <!-- Errors -->
  {#each errors as err}
    <div class="text-xs text-red-400 bg-red-950 border border-red-900 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
      <span>⚠ {err}</span>
      <button class="text-red-600 hover:text-red-400 shrink-0" on:click={() => errors = errors.filter(e => e !== err)}>✕</button>
    </div>
  {/each}

  <!-- Uploaded list -->
  <div class="flex items-center justify-between">
    <span class="text-xs text-slate-500 font-bold uppercase tracking-wide">
      Sample Dimuat Naik
    </span>
    <span class="text-xs text-slate-700">{$uploadedSamples.length} fail</span>
  </div>

  {#if $uploadedSamples.length === 0}
    <div class="text-xs text-slate-700 text-center py-8 border border-slate-800 rounded-xl">
      Belum ada sample dimuat naik.<br>
      <span class="text-slate-800">Sample akan muncul di library "🎵 Pilih Sample" selepas dimuat naik.</span>
    </div>
  {:else}
    <div class="flex flex-col gap-1.5">
      {#each $uploadedSamples as s (s.id)}
        <div class="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors">
          <span class="text-base shrink-0">📁</span>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold text-blue-300 truncate">{s.label}</div>
            <div class="text-xs text-slate-600">{fmt(s.buffer.duration)} · Upload</div>
          </div>
          <!-- Preview toggle -->
          <button
            class="text-xs px-2 py-1 rounded-lg border transition-colors shrink-0
              {playingId === s.id
                ? 'bg-red-950 text-red-400 border-red-800 hover:bg-red-900'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white'}"
            on:click={() => togglePreview(s)}
            title={playingId === s.id ? 'Stop preview' : 'Preview bunyi'}
          >{playingId === s.id ? '■ Stop' : '▶ Play'}</button>
          <!-- Delete -->
          <button
            class="text-xs px-2 py-1 rounded-lg bg-red-950 text-red-500 border border-red-900 hover:bg-red-900 transition-colors shrink-0"
            on:click={() => { if (playingId === s.id) stopPreview(); removeUploadedSample(s.id); }}
            title="Hapus sample"
          >✕</button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="text-xs text-slate-800 text-center mt-auto pt-2">
    Sample disimpan sementara — akan hilang bila browser ditutup
  </div>
</div>
