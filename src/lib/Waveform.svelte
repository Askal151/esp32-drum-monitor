<!--
  Waveform.svelte — Canvas rolling waveform 60fps, kedua sensor
-->
<script>
  import { onMount, tick } from 'svelte';
  import { plotBuf, chartTick, MAX_POINTS, sensors } from './serial.js';

  const CLR   = ['#22d3ee', '#4ade80'];
  const NAMES = ['SNARE', 'KICK'];

  let wrap, canvas, ctx;
  let W = 0, H = 0;
  let rafId, dirty = true;
  let sens = [
    { thresh: [82,329,720,1049], baseline: 0 },
    { thresh: [82,329,720,1049], baseline: 0 },
  ];

  const PAD = { l: 52, r: 10, t: 10, b: 18 };

  function draw() {
    if (!ctx || W === 0 || H === 0) return;
    ctx.fillStyle = '#020817';
    ctx.fillRect(0, 0, W, H);

    const panelH = Math.floor((H - 4) / 2);

    for (let si = 0; si < 2; si++) {
      const py0 = si * (panelH + 4);
      const x0 = PAD.l, x1 = W - PAD.r;
      const y0 = py0 + PAD.t, y1 = py0 + panelH - PAD.b;
      const pw = x1 - x0, ph = y1 - y0;
      if (pw <= 0 || ph <= 0) continue;

      const buf = plotBuf[si].adc;

      // Auto-range
      let vMin = Infinity, vMax = -Infinity;
      for (let i = 0; i < MAX_POINTS; i++) {
        if (buf[i] < vMin) vMin = buf[i];
        if (buf[i] > vMax) vMax = buf[i];
      }
      if (vMin === vMax) { vMin -= 50; vMax += 50; }
      const margin = (vMax - vMin) * 0.1;
      vMin -= margin; vMax += margin;
      const ys = ph / (vMax - vMin);
      const toY = v => y1 - (v - vMin) * ys;

      // Background
      ctx.fillStyle = '#02081700';
      ctx.fillRect(x0, y0, pw, ph);

      // Grid + Y labels
      ctx.strokeStyle = '#ffffff07';
      ctx.lineWidth = 1;
      ctx.font = '9px monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const gv = vMin + (vMax - vMin) * (i / 4);
        const gy = Math.round(toY(gv));
        ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
        ctx.fillStyle = '#334155';
        ctx.fillText(Math.round(gv), x0 - 3, gy);
      }

      // Threshold lines
      const thresh = sens[si].thresh ?? [];
      const tclr = ['#fbbf24','#f97316','#ef4444','#a855f7'];
      for (let i = 0; i < thresh.length; i++) {
        const ty = toY(thresh[i]);
        if (ty < y0 || ty > y1) continue;
        ctx.strokeStyle = tclr[i] + '66';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(x1, ty); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Baseline
      const base = sens[si].baseline;
      if (base) {
        const by = toY(base);
        if (by >= y0 && by <= y1) {
          ctx.strokeStyle = CLR[si] + '30';
          ctx.lineWidth = 1; ctx.setLineDash([6,3]);
          ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Waveform fill
      const step = pw / (MAX_POINTS - 1);
      ctx.beginPath();
      ctx.moveTo(x0, y1);
      for (let i = 0; i < MAX_POINTS; i++) {
        const px = x0 + i * step;
        const py = Math.max(y0, Math.min(y1, toY(buf[i])));
        ctx.lineTo(px, py);
      }
      ctx.lineTo(x0 + (MAX_POINTS - 1) * step, y1);
      ctx.closePath();
      ctx.fillStyle = CLR[si] + '15';
      ctx.fill();

      // Waveform line
      ctx.beginPath();
      ctx.strokeStyle = CLR[si];
      ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      for (let i = 0; i < MAX_POINTS; i++) {
        const px = x0 + i * step;
        const py = Math.max(y0, Math.min(y1, toY(buf[i])));
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Label
      ctx.fillStyle = CLR[si];
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(NAMES[si], x0 + 3, y0 + 2);

      // Latest value
      const last = buf[MAX_POINTS - 1];
      ctx.fillStyle = '#64748b';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(last, x1 - 2, y0 + 2);

      // Panel border
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(x0, y0, pw, ph); ctx.stroke();
    }

    // Divider between panels
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, panelH + 2); ctx.lineTo(W, panelH + 2); ctx.stroke();

    dirty = false;
  }

  function loop() {
    if (dirty) draw();
    rafId = requestAnimationFrame(loop);
  }

  onMount(async () => {
    await tick();
    ctx = canvas.getContext('2d', { alpha: false });

    const unsubS = sensors.subscribe(arr => {
      sens = arr.map(s => ({ ...s }));
      dirty = true;
    });
    const unsubT = chartTick.subscribe(() => { dirty = true; });

    const resize = () => {
      W = Math.floor(wrap.clientWidth);
      H = Math.floor(wrap.clientHeight);
      if (W > 0 && H > 0) { canvas.width = W; canvas.height = H; dirty = true; }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    rafId = requestAnimationFrame(loop);
    return () => { unsubS(); unsubT(); cancelAnimationFrame(rafId); ro.disconnect(); };
  });
</script>

<div bind:this={wrap} class="w-full h-full">
  <canvas bind:this={canvas} style="display:block;width:100%;height:100%"></canvas>
</div>
