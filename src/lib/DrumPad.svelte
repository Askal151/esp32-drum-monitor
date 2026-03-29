<!--
  DrumPad.svelte — Canvas drum pad dengan animasi hit dan glow
-->
<script>
  import { onMount } from 'svelte';
  import { hitEvent } from './serial.js';

  export let idx   = 0;       // 0=snare, 1=kick
  export let name  = 'SNARE';
  export let color = '#22d3ee';
  export let adc   = 0;
  export let dev   = 0;
  export let led   = 0;
  export let hits  = 0;
  export let bpm   = 0;

  let canvas, ctx, rafId;
  let W = 0, H = 0;

  // Animasi
  let glowAlpha  = 0;   // 0..1 — pudar selepas hit
  let ringScale  = 1;   // expand ring selepas hit
  let velocity   = 0;   // 0..100 hit velocity

  // Velocity arc (dari led, 0..4 → 0..100%)
  $: velPct = Math.min(1, led / 4);

  function onHit(e) {
    if (e.idx !== idx) return;
    glowAlpha = 1;
    ringScale = 1;
    velocity  = e.velocity;
  }

  function draw() {
    if (!ctx || W === 0) return;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * 0.38;

    // ── Outer glow ring (animasi hit) ─────────────────────────
    if (glowAlpha > 0.01) {
      const ringR = R * (1.15 + (1 - ringScale) * 0.3);
      const grad = ctx.createRadialGradient(cx, cy, ringR * 0.7, cx, cy, ringR * 1.3);
      grad.addColorStop(0, color + Math.round(glowAlpha * 0xcc).toString(16).padStart(2,'0'));
      grad.addColorStop(1, color + '00');
      ctx.beginPath();
      ctx.arc(cx, cy, ringR * 1.3, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // Fade & expand
      glowAlpha *= 0.88;
      ringScale  = Math.min(1, ringScale + 0.04);
    }

    // ── Velocity arc (luar pad) ───────────────────────────────
    const arcR = R * 1.08;
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * velPct);
    ctx.strokeStyle = color + 'cc';
    ctx.lineWidth   = 4;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Track arc (background)
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, -Math.PI / 2 + Math.PI * 2 * velPct, -Math.PI / 2 + Math.PI * 2);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth   = 4;
    ctx.stroke();

    // ── Pad body ──────────────────────────────────────────────
    const hitBright = glowAlpha > 0.05;

    // Shadow/depth ring
    ctx.beginPath();
    ctx.arc(cx, cy, R + 3, 0, Math.PI * 2);
    ctx.fillStyle = '#000000aa';
    ctx.fill();

    // Outer border ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    const borderGrad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    borderGrad.addColorStop(0, hitBright ? color : color + '80');
    borderGrad.addColorStop(1, hitBright ? color + 'aa' : color + '20');
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth   = hitBright ? 3 : 2;
    ctx.stroke();

    // Pad fill gradient
    const padGrad = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, R * 0.05, cx, cy, R);
    if (hitBright) {
      padGrad.addColorStop(0, color + '55');
      padGrad.addColorStop(0.5, color + '22');
      padGrad.addColorStop(1, '#0a1628');
    } else {
      padGrad.addColorStop(0, '#1e293b');
      padGrad.addColorStop(1, '#0a1020');
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = padGrad;
    ctx.fill();

    // Highlight specular
    ctx.beginPath();
    ctx.arc(cx - R * 0.28, cy - R * 0.28, R * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();

    // ── Teks dalam pad ────────────────────────────────────────
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Nama drum
    ctx.font      = `bold ${Math.round(R * 0.28)}px sans-serif`;
    ctx.fillStyle = hitBright ? color : color + 'aa';
    ctx.fillText(name, cx, cy - R * 0.18);

    // ADC value
    ctx.font      = `bold ${Math.round(R * 0.22)}px monospace`;
    ctx.fillStyle = hitBright ? '#ffffff' : '#475569';
    ctx.fillText(adc, cx, cy + R * 0.12);

    // LED bars
    const barW = R * 0.12, barH = R * 0.22, barGap = R * 0.06;
    const totalW = 4 * barW + 3 * barGap;
    let bx = cx - totalW / 2;
    const by = cy + R * 0.45;
    const ledColors = ['#fbbf24', '#f97316', '#ef4444', '#a855f7'];
    for (let i = 0; i < 4; i++) {
      const active = i < led;
      ctx.fillStyle = active ? ledColors[i] : '#1e293b';
      ctx.beginPath();
      ctx.roundRect(bx, by - barH / 2, barW, barH, 2);
      ctx.fill();
      if (active) {
        ctx.fillStyle = ledColors[i] + '44';
        ctx.beginPath();
        ctx.roundRect(bx - 1, by - barH / 2 - 1, barW + 2, barH + 2, 3);
        ctx.fill();
      }
      bx += barW + barGap;
    }

    dirty = false;
  }

  let dirty = true;
  function loop() {
    if (dirty || glowAlpha > 0.01) draw();
    rafId = requestAnimationFrame(loop);
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { alpha: true });
    const resize = () => {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W; canvas.height = H; dirty = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const unsub = hitEvent.subscribe(e => {
      if (e.ts && e.idx === idx) onHit(e);
    });

    rafId = requestAnimationFrame(loop);
    return () => { unsub(); cancelAnimationFrame(rafId); ro.disconnect(); };
  });

  $: { adc; dev; led; hits; dirty = true; }
</script>

<div class="flex flex-col items-center gap-2">
  <!-- Canvas pad -->
  <div class="relative w-full" style="padding-bottom:100%">
    <canvas
      bind:this={canvas}
      class="absolute inset-0 w-full h-full"
    ></canvas>
  </div>

  <!-- Stats bawah pad -->
  <div class="grid grid-cols-3 gap-2 w-full text-center">
    <div class="bg-slate-900 rounded-lg py-1.5">
      <div class="text-xs text-slate-600">HIT</div>
      <div class="text-sm font-bold font-mono" style="color:{color}">{hits}</div>
    </div>
    <div class="bg-slate-900 rounded-lg py-1.5">
      <div class="text-xs text-slate-600">BPM</div>
      <div class="text-sm font-bold font-mono" style="color:{color}">{bpm > 0 ? bpm : '—'}</div>
    </div>
    <div class="bg-slate-900 rounded-lg py-1.5">
      <div class="text-xs text-slate-600">DEV</div>
      <div class="text-sm font-bold font-mono" style="color:{color}">{dev}</div>
    </div>
  </div>
</div>
