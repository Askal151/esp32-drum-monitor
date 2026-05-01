<!-- FirmwareFlasher.svelte — Flash ESP32 firmware terus dari browser via Web Serial -->
<script>
  import { ESPLoader, Transport } from 'esptool-js';
  import { connected, disconnect } from './serial.js';
  import { get } from 'svelte/store';

  // Base URL dari vite config (misal: /esp32-drum-monitor/)
  const BASE = import.meta.env.BASE_URL;
  const BINS = [
    { label: 'Bootloader',      url: `${BASE}firmware/bootloader.bin`, address: 0x1000  },
    { label: 'Partition Table', url: `${BASE}firmware/partitions.bin`, address: 0x8000  },
    { label: 'Firmware',        url: `${BASE}firmware/firmware.bin`,   address: 0x10000 },
  ];

  // ── State ────────────────────────────────────────────────────
  let phase = 'idle'; // idle | connecting | flashing | done | error
  let flashProgress = 0;   // 0–100
  let flashLabel   = '';   // "Bootloader" / "Partition Table" / "Firmware"
  let errorMsg = '';
  let logLines = [];
  let logEl;

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString('ms-MY', { hour12: false });
    logLines = [...logLines, { ts, msg }];
    setTimeout(() => { if (logEl) logEl.scrollTop = logEl.scrollHeight; }, 10);
  }

  // Latin-1 decode: satu-satu byte → satu char (diperlukan oleh esptool-js)
  function toStr(buf) {
    const u8 = new Uint8Array(buf);
    let s = '';
    // Proses dalam blok 8KB untuk elak terlalu banyak string concatenation
    const CHUNK = 8192;
    for (let i = 0; i < u8.length; i += CHUNK) {
      s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
    }
    return s;
  }

  // ── Main flash routine ───────────────────────────────────────
  async function startFlash() {
    phase = 'connecting';
    logLines = [];
    flashProgress = 0;
    flashLabel = '';
    errorMsg = '';

    try {
      // 1. Putuskan serial monitor dulu supaya port bebas
      if (get(connected)) {
        addLog('Putuskan serial monitor...');
        await disconnect();
        await delay(700);
      }

      // 2. Dapatkan port — guna port yang sudah diberi kebenaran, atau minta baru
      let port;
      const ports = await navigator.serial.getPorts();
      if (ports.length) {
        port = ports[0];
        addLog(`Port dijumpai — guna port yang sedia ada.`);
      } else {
        addLog('Tiada port dibenarkan — pilih port ESP32...');
        port = await navigator.serial.requestPort();
      }

      // Pastikan port tertutup sepenuhnya sebelum esptool-js buka semula
      // (port mungkin masih terbuka dari serial monitor atau sesi sebelumnya)
      addLog('Pastikan port tertutup...');
      try { await port.close(); } catch {}
      await delay(500);

      // 3. Setup esptool-js terminal → redirect log ke UI
      const terminal = {
        clean()       { /* bersihkan terminal — tidak perlu */ },
        writeLine(d)  { addLog(d); },
        write(d)      { /* skip partial line (progress dots) */ },
      };

      const transport = new Transport(port, true);
      const loader    = new ESPLoader({ transport, baudrate: 115200, terminal });

      // 4. Masuk bootloader mode (esptool-js toggle DTR/RTS sendiri)
      addLog('Masuk bootloader mode — ESP32 akan auto-reset...');
      await loader.main();
      addLog('Chip berjaya dikesan!');

      // 5. Muat fail binari dari server
      addLog('Muat fail firmware dari server...');
      const fileArray = [];
      for (const bin of BINS) {
        addLog(`  → Muat ${bin.label} (${bin.url})...`);
        const res = await fetch(bin.url);
        if (!res.ok) throw new Error(`Gagal muat ${bin.label}: HTTP ${res.status}`);
        const buf  = await res.arrayBuffer();
        fileArray.push({ data: toStr(buf), address: bin.address });
        addLog(`  ✓ ${bin.label} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
      }

      // 6. Flash!
      phase = 'flashing';
      addLog('Mula proses flash...');

      // DIO mode — lebih serasi dengan pelbagai ESP32 module (termasuk clone)
      // Firmware juga dikompil semula dengan DIO mode supaya bootloader sesuai
      await loader.writeFlash({
        fileArray,
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: '40m',
        eraseAll:  true,
        compress:  false,
        reportProgress(fileIdx, written, total) {
          flashProgress = total > 0 ? Math.round((written / total) * 100) : 0;
          flashLabel    = BINS[fileIdx]?.label ?? 'File';
        },
      });

      // 7. Selesai — putuskan transport (ESP32 akan reboot sendiri)
      addLog('Flash selesai — tutup port...');
      await transport.disconnect();

      phase = 'done';
      flashProgress = 100;
      addLog('');
      addLog('✅ Berjaya! ESP32 sedang restart dengan firmware drum_monitor baru.');
      addLog('👉 Klik butang ⚡ Sambung di atas untuk sambung ke serial monitor.');

    } catch (err) {
      // Pengguna batal pilih port — balik ke idle sahaja
      if (err.name === 'NotFoundError') { phase = 'idle'; return; }
      phase = 'error';
      errorMsg = err.message;
      addLog(`❌ ERROR: ${err.message}`);
      console.error('[flash]', err);
    }
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));
</script>

<div class="flex flex-col gap-3 p-3 h-full overflow-y-auto">

  <!-- Header info -->
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
    <h2 class="text-sm font-bold text-cyan-400 mb-1">⚡ Flash Firmware ESP32</h2>
    <p class="text-xs text-slate-500">
      Flash firmware <span class="text-slate-300 font-mono">drum_monitor</span> terus dari browser tanpa Arduino IDE.
      Firmware akan ditulis ke ESP32 melalui Web Serial API.
    </p>
    <div class="mt-2 grid grid-cols-3 gap-2 text-xs">
      {#each BINS as b, i}
        <div class="bg-slate-950 rounded-lg px-3 py-2 border border-slate-800">
          <div class="text-slate-600 text-[10px] mb-0.5">0x{b.address.toString(16).toUpperCase()}</div>
          <div class="text-slate-400 font-medium">{b.label}</div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Flash button + progress -->
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
    {#if phase === 'idle' || phase === 'done' || phase === 'error'}
      <button
        class="w-full py-3 rounded-xl font-bold text-sm transition-all
          {phase === 'done'
            ? 'bg-green-950 text-green-400 border border-green-900 hover:bg-green-900'
            : phase === 'error'
            ? 'bg-red-950 text-red-400 border border-red-900 hover:bg-red-900'
            : 'bg-cyan-950 text-cyan-300 border border-cyan-900 hover:bg-cyan-900 active:scale-95'}"
        on:click={startFlash}
      >
        {#if phase === 'done'}✅ Flash Lagi{:else if phase === 'error'}⚠ Cuba Lagi{:else}⚡ Flash Firmware Sekarang{/if}
      </button>

      {#if phase === 'error'}
        <div class="bg-red-950 border border-red-900 rounded-lg px-3 py-2 text-xs text-red-300">
          <span class="font-bold">Error:</span> {errorMsg}
        </div>
      {/if}

      {#if phase === 'idle'}
        <div class="text-xs text-slate-600 space-y-1">
          <p>📌 Pastikan ESP32 disambung ke USB sebelum klik Flash.</p>
          <p>📌 Jika ada sambungan serial monitor aktif, ia akan diputuskan dahulu secara automatik.</p>
          <p>📌 Jangan cabut USB semasa proses flash berlangsung.</p>
        </div>
      {/if}
    {:else}
      <!-- Progress bar semasa flash -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between text-xs">
          <span class="text-slate-400 font-medium">
            {#if phase === 'connecting'}
              🔗 Menyambung ke bootloader...
            {:else}
              ⚡ Flash: {flashLabel}
            {/if}
          </span>
          <span class="text-cyan-400 font-mono font-bold">{flashProgress}%</span>
        </div>
        <div class="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-200"
            style="width:{flashProgress}%; background: linear-gradient(90deg, #0891b2, #22d3ee)"
          ></div>
        </div>
        <p class="text-xs text-slate-600 text-center animate-pulse">
          {#if phase === 'connecting'}Jangan cabut USB...{:else}Menulis ke flash memory — jangan cabut USB!{/if}
        </p>
      </div>
    {/if}
  </div>

  <!-- Log output -->
  {#if logLines.length > 0}
    <div class="flex-1 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col min-h-40">
      <div class="px-3 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <span class="text-xs font-bold text-slate-600 tracking-widest">LOG</span>
        <button
          class="text-xs text-slate-700 hover:text-slate-500"
          on:click={() => logLines = []}
        >bersih</button>
      </div>
      <div
        bind:this={logEl}
        class="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5"
      >
        {#each logLines as l}
          <div class="flex gap-2">
            <span class="text-slate-700 shrink-0">{l.ts}</span>
            <span class="{l.msg.startsWith('✅') ? 'text-green-400' : l.msg.startsWith('❌') ? 'text-red-400' : l.msg.startsWith('  →') ? 'text-slate-600' : l.msg.startsWith('  ✓') ? 'text-green-600' : 'text-slate-400'}">{l.msg}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

</div>
