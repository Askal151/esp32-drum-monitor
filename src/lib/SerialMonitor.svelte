<!-- SerialMonitor.svelte — Canvas terminal, virtual scroll -->
<script>
  import { onMount } from 'svelte';
  import { onRawLine, rawHistory } from './serial.js';

  const MAX_LINES = 2000;
  const LINE_H = 17;
  const TS_W = 90, LN_W = 34;

  const FG = { data:'#38bdf8', error:'#f87171', ok:'#4ade80', info:'#60a5fa', tx:'#34d399', usb:'#22d3ee', sys:'#fbbf24', garbage:'#1e293b', default:'#64748b' };
  const BG = { data:'#03080f', error:'#0f0202', ok:'#020a04', info:'#020810', tx:'#020d08', usb:'#001a20', sys:'#0a0800', garbage:'#020305', default:'#030811' };

  function classify(t) {
    if (!t) return 'default';
    if (t.startsWith('HALL2|'))  return 'data';
    if (t.startsWith('>> '))     return 'tx';
    if (t.startsWith('[USB]'))   return 'usb';
    if (t.startsWith('[SISTEM]')) return 'sys';
    if (/error/i.test(t))       return 'error';
    if (t.startsWith('===') || t.startsWith('---')) return 'info';
    if (/selesai|berjaya/i.test(t)) return 'ok';
    const printable = t.split('').filter(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)<127).length;
    if (printable / Math.max(t.length,1) < 0.5) return 'garbage';
    return 'default';
  }

  let lines = [], dispLines = [], total = 0;
  let filterTxt = '', showData = true, autoScroll = true, scrollY = 0;
  let dragAnchor = null, dragScrollStart = 0;
  export let onSendCmd = null;
  let cmdInput = '';
  let wrap, canvas, ctx;
  let rafId, dirty = true, resizeObs;

  function pushLine(text, dir, ts) {
    total++;
    const type = classify(text);
    if (type === 'data' && !showData) { lines.push({text,type,ts:''}); if(lines.length>MAX_LINES)lines.shift(); return; }
    lines.push({text,type,ts:ts||new Date().toISOString().slice(11,23)});
    if (lines.length > MAX_LINES) lines.shift();
    rebuildDisp(); dirty = true;
    if (autoScroll) snapBottom();
  }

  function rebuildDisp() {
    const q = filterTxt.toLowerCase();
    dispLines = lines.filter(l=>l.ts&&(!q||l.text.toLowerCase().includes(q)));
    dirty = true;
  }

  function snapBottom() { scrollY = Math.max(0, dispLines.length*LINE_H-(canvas?.height??0)); }
  function maxScroll()  { return Math.max(0, dispLines.length*LINE_H-(canvas?.height??0)); }

  function draw() {
    if (!ctx||!canvas||canvas.width===0) return;
    const W=canvas.width, H=canvas.height;
    ctx.fillStyle='#020817'; ctx.fillRect(0,0,W,H);
    if (!dispLines.length) {
      ctx.fillStyle='#1e3a5f'; ctx.font='12px monospace';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('Menunggu data serial...', W/2, H/2);
      ctx.textAlign='left'; return;
    }
    ctx.font='12px "Cascadia Code","Courier New",monospace'; ctx.textBaseline='top';
    const first = Math.max(0, Math.floor(scrollY/LINE_H)-1);
    const last  = Math.min(dispLines.length-1, first+Math.ceil(H/LINE_H)+2);
    for (let i=first; i<=last; i++) {
      const {text,type,ts} = dispLines[i];
      const y = Math.round(i*LINE_H - scrollY);
      ctx.fillStyle=BG[type]??BG.default; ctx.fillRect(0,y,W-11,LINE_H-1);
      ctx.fillStyle='#1e293b'; ctx.fillText(String(i+1).padStart(4),2,y+2);
      ctx.fillStyle='#1e3a50'; ctx.fillText(ts,LN_W+2,y+2);
      ctx.save(); ctx.beginPath(); ctx.rect(TS_W+LN_W,y,W-TS_W-LN_W-13,LINE_H); ctx.clip();
      ctx.fillStyle=FG[type]??FG.default; ctx.fillText(text,TS_W+LN_W+2,y+2); ctx.restore();
    }
    const ms=maxScroll();
    if (ms>0) {
      const track=H-4, thumb=Math.max(24,(H/(dispLines.length*LINE_H))*track);
      const ty=2+(scrollY/ms)*(track-thumb);
      ctx.fillStyle='#0f172a'; ctx.fillRect(W-10,2,8,track);
      ctx.fillStyle=autoScroll?'#164e63':'#1d4ed8';
      ctx.beginPath(); ctx.roundRect(W-9,ty,6,thumb,3); ctx.fill();
    }
    if (!autoScroll) {
      ctx.fillStyle='#92400e18'; ctx.fillRect(0,H-20,W-11,20);
      ctx.fillStyle='#f59e0baa'; ctx.font='10px sans-serif'; ctx.textAlign='center';
      ctx.fillText('▼ Auto-scroll off', (W-11)/2, H-13); ctx.textAlign='left';
    }
  }

  function loop() { if(dirty){draw();dirty=false;} rafId=requestAnimationFrame(loop); }

  function onWheel(e) { e.preventDefault(); scrollY=Math.max(0,Math.min(maxScroll(),scrollY+e.deltaY*0.8)); autoScroll=scrollY>=maxScroll()-5; dirty=true; }
  function onClick(e) { const r=canvas.getBoundingClientRect(); if(e.clientY-r.top>canvas.height-20&&!autoScroll){autoScroll=true;snapBottom();dirty=true;} }
  function onKeydown(e) {
    const H=canvas?.height??0;
    if(e.key==='End')     {autoScroll=true; snapBottom(); dirty=true;}
    if(e.key==='Home')    {autoScroll=false;scrollY=0;dirty=true;}
    if(e.key==='PageDown'){autoScroll=false;scrollY=Math.min(maxScroll(),scrollY+H*0.8);dirty=true;}
    if(e.key==='PageUp')  {autoScroll=false;scrollY=Math.max(0,scrollY-H*0.8);dirty=true;}
  }
  function onMousedown(e) { const r=canvas.getBoundingClientRect(); if(e.clientX-r.left<canvas.width-11)return; dragAnchor=e.clientY;dragScrollStart=scrollY;e.preventDefault(); }
  function onMousemove(e) { if(dragAnchor===null)return; const ratio=(dispLines.length*LINE_H)/canvas.height; scrollY=Math.max(0,Math.min(maxScroll(),dragScrollStart+(e.clientY-dragAnchor)*ratio)); autoScroll=scrollY>=maxScroll()-5; dirty=true; }
  function onMouseup() { dragAnchor=null; }

  async function submitCmd(e) { e?.preventDefault(); if(!cmdInput.trim()||!onSendCmd)return; await onSendCmd(cmdInput.trim()); cmdInput=''; }

  onMount(() => {
    for (const h of rawHistory) pushLine(h.text,h.dir,h.ts);
    ctx = canvas.getContext('2d',{alpha:false});
    function resize(w,h) { if(w>0&&h>0){canvas.width=w;canvas.height=h;dirty=true;if(autoScroll)snapBottom();} }
    resize(wrap.clientWidth,wrap.clientHeight);
    resizeObs = new ResizeObserver(([e])=>resize(Math.floor(e.contentRect.width),Math.floor(e.contentRect.height)));
    resizeObs.observe(wrap);
    rafId = requestAnimationFrame(loop);
    const unsub = onRawLine((text,dir,ts)=>pushLine(text,dir,ts));
    return () => { unsub(); cancelAnimationFrame(rafId); resizeObs?.disconnect(); };
  });

  $: { filterTxt; showData; rebuildDisp(); if(autoScroll) snapBottom(); }
  function clearAll() { lines=[];dispLines=[];total=0;scrollY=0;dirty=true; }
</script>

<div class="flex flex-col h-full bg-slate-950 rounded-lg overflow-hidden">
  <div class="flex items-center gap-2 px-2 py-1.5 bg-slate-900 border-b border-slate-800 shrink-0 flex-wrap">
    <span class="text-xs font-bold tracking-widest text-slate-600">SERIAL</span>
    <label class="flex items-center gap-1 text-xs text-slate-600 cursor-pointer select-none">
      <input type="checkbox" bind:checked={showData} class="accent-cyan-500" /> DATA
    </label>
    <div class="relative flex-1 min-w-16 max-w-48">
      <input class="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-400 font-mono outline-none focus:border-slate-600" placeholder="Filter..." bind:value={filterTxt} spellcheck="false" />
      {#if filterTxt}<button class="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-600 text-xs" on:click={()=>filterTxt=''}>✕</button>{/if}
    </div>
    <span class="text-xs font-mono text-slate-700">{dispLines.length}/{total}</span>
    <button class="text-xs px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-600 hover:text-red-400" on:click={clearAll}>🗑</button>
    <button class="text-xs px-2 py-1 rounded border {autoScroll?'bg-slate-800 border-cyan-900 text-cyan-400':'bg-slate-900 border-slate-800 text-slate-600'}"
      on:click={()=>{autoScroll=!autoScroll;if(autoScroll){snapBottom();dirty=true;}}}>{autoScroll?'⏬':'⏸'}</button>
  </div>
  <div class="flex-1 overflow-hidden outline-none cursor-default select-none" bind:this={wrap}
    on:wheel={onWheel} on:click={onClick} on:mousedown={onMousedown} on:keydown={onKeydown}
    tabindex="0" role="log" aria-label="Serial monitor">
    <canvas bind:this={canvas} style="display:block;width:100%;height:100%"></canvas>
  </div>
  <form class="flex items-center gap-2 px-2 py-1.5 bg-slate-900 border-t border-slate-800 shrink-0" on:submit={submitCmd}>
    <span class="text-green-400 font-mono text-xs">&gt;&gt;</span>
    <input class="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-green-400 font-mono outline-none focus:border-slate-600 caret-green-400 placeholder:text-slate-800"
      bind:value={cmdInput} placeholder="Taip perintah + Enter" spellcheck="false" autocomplete="off" />
    <button type="submit" class="text-xs px-3 py-1.5 rounded border border-cyan-900 bg-slate-950 text-cyan-400 disabled:opacity-30 hover:bg-slate-900" disabled={!cmdInput.trim()}>Hantar</button>
  </form>
</div>
<svelte:window on:mousemove={onMousemove} on:mouseup={onMouseup} />
