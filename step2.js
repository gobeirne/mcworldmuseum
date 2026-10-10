/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
// ---------- step 2: kept areas ("exhibits"), margins and the water gap
const DN = ['Overworld', 'Nether', 'End'];
state.settings = { margin: 2, gap: 1, veil: true, smooth: 2, showSigns: true, showPins: false };
const SETTINGS_DEFAULTS = { ...state.settings, sv: 2 };
try {
  const stored = JSON.parse(localStorage.getItem('wm:settings') || '{}');
  if ((stored.sv || 1) < 2) { delete stored.showSigns; stored.sv = 2; } // signs were hidden by default earlier; back on
  Object.assign(state.settings, stored);
} catch (e) {}
state.mode = null; state.drag = null; state.selEx = null;
function saveSettings() { try { localStorage.setItem('wm:settings', JSON.stringify(state.settings)); } catch (e) {} }
// Plans are linked to a world by its folder ID and name, so they survive the world being played again.
const worldId = W => (W.folderId || W.folder) + '|' + W.name;
function wkey(W) { return 'wm:plan2:' + worldId(W); }
function loadPlan(W) {
  W.exhibits = [];
  W.bytesPerChunk = W.totalChunks ? W.dbBytes / W.totalChunks : 0;
  try {
    let raw = localStorage.getItem(wkey(W));
    if (raw === null) { // older plans were linked by folder path, name and chunk count
      const pre = 'wm:plan:' + W.folder + '|' + W.name + '|';
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(pre)) { raw = localStorage.getItem(k); localStorage.setItem(wkey(W), raw); break; } }
    }
    const p = JSON.parse(raw || 'null'); if (p && Array.isArray(p.exhibits)) W.exhibits = p.exhibits.filter(e => W.dims[e.dim] && Array.isArray(e.rects));
  } catch (e) {}
}
function savePlan(W) {
  try { localStorage.setItem(wkey(W), JSON.stringify({ exhibits: W.exhibits.map(({ id, name, dim, rects, margin, smooth, erase, top }) => ({ id, name, dim, rects, margin, smooth, erase, top })) })); } catch (e) {}
}
let exSeq = Date.now();
// Undo histories are kept separately: one per world (its map and Kept tab), and one for the museum
// screen. Undo always steps back through the history of what's on screen.
const histories = new Map();
const histKey = () => state.museum ? 'museum' : (state.worlds[state.w] ? 'w:' + wkey(state.worlds[state.w]) : '');
const stackFor = k => { if (!histories.has(k)) histories.set(k, []); return histories.get(k); };
const planJSON = W => JSON.stringify(W.exhibits.map(({ id, name, dim, rects, margin, smooth, erase, top }) => ({ id, name, dim, rects, margin, smooth, erase, top })));
function pushHist(k, h) { const st = stackFor(k); st.push(h); if (st.length > 80) st.shift(); updateUndo(); }
function snapshot(W) { pushHist('w:' + wkey(W), { kind: 'world', wi: state.worlds.indexOf(W), ex: planJSON(W) }); }
function museumSnapshot() { pushHist('museum', { kind: 'museum', arrange: JSON.stringify(arrange), hub: JSON.stringify(state.mset.hub), plans: state.worlds.map(planJSON) }); }
function updateUndo() { const n = stackFor(histKey()).length; for (const id of ['#undoBtn', '#mUndoBtn']) { const b = $(id); if (b) b.disabled = !n; } }
function undo() {
  const h = stackFor(histKey()).pop(); updateUndo(); if (!h) return;
  if (h.kind === 'world') {
    const W = state.worlds[h.wi]; W.exhibits = JSON.parse(h.ex); savePlan(W);
    if (state.mode && state.mode.target && !W.exhibits.some(e => e.id === state.mode.target)) state.mode.target = null;
    if (state.selEx && !W.exhibits.some(e => e.id === state.selEx)) state.selEx = null;
    renderExhibits(); renderPlaces(); draw();
  } else {
    arrange = JSON.parse(h.arrange); if (h.hub) state.mset.hub = JSON.parse(h.hub); state.placingHub = false;
    state.worlds.forEach((W, i) => { if (h.plans[i] !== undefined) { W.exhibits = JSON.parse(h.plans[i]); savePlan(W); } });
    saveArrange(); state.built = null; layout(false); renderMuseum(); renderExhibits(); draw();
  }
  toast('Undone.', 1500);
}
$('#undoBtn').onclick = undo;
if ($('#mUndoBtn')) $('#mUndoBtn').onclick = undo;
document.addEventListener('keydown', ev => {
  if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { ev.preventDefault(); undo(); }
});
function newExhibit(W, dim, rect, name) {
  const e = { id: 'e' + (exSeq++).toString(36), name, dim, rects: [rect], margin: state.settings.margin, smooth: state.settings.smooth };
  W.exhibits.push(e); savePlan(W); return e;
}
function changed(W, e) { e.fp = null; savePlan(W); }
function footprint(W, e) {
  if (e.fp) return e.fp;
  const D = W.dims[e.dim]; const core = new Set(), all = new Set();
  for (const [x0, z0, x1, z1] of e.rects) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    if ((bx - ax + 1) * (bz - az + 1) > 250000) continue;
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) { const k = x + ',' + z; if (D.index.has(k)) core.add(k); }
  }
  const m = e.margin | 0; const coreList = [...core].map(k => k.split(',').map(Number));
  for (const [x, z] of coreList) for (let dx = -m; dx <= m; dx++) for (let dz = -m; dz <= m; dz++) { const k = (x + dx) + ',' + (z + dz); if (D.index.has(k)) all.add(k); }
  const trimmed = smoothEdges(D, all, e.smooth | 0);
  for (const k of trimmed) { all.delete(k); core.delete(k); }
  let erased = 0;
  for (const [x0, z0, x1, z1] of (e.erase || [])) for (const k of [...all]) { const [x, z] = k.split(',').map(Number); if (x >= x0 && x <= x1 && z >= z0 && z <= z1) { all.delete(k); core.delete(k); erased++; } }
  const coreKept = [...core].map(k => k.split(',').map(Number));
  const allList = [...all].map(k => k.split(',').map(Number));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of allList) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return (e.fp = { core, all, coreList: coreKept, allList, count: all.size, trimmed: trimmed.length, erased, minX, maxX, minZ, maxZ });
}
// Subtractive edge smoothing (morphological opening with a round brush). Only chunks within n of the
// outside can go, enclosed holes don't grow, and chunks with any building evidence are never removed.
// Returns the keys to drop.
function smoothEdges(D, all, n) {
  if (!n || all.size < 2) return [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const pts = [...all].map(k => k.split(',').map(Number));
  for (const [x, z] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  const pad = n + 3;
  const Wd = maxX - minX + 1 + 2 * pad, Hd = maxZ - minZ + 1 + 2 * pad, N = Wd * Hd;
  if (N > 4e6) return [];
  const idx = (x, z) => (z - minZ + pad) * Wd + (x - minX + pad);
  const inside = new Uint8Array(N); for (const [x, z] of pts) inside[idx(x, z)] = 1;
  // outside = empty cells reachable from the border; enclosed holes count as inside for shaping
  const outside = new Uint8Array(N); const q = new Int32Array(N); let qh = 0, qt = 0;
  for (let i = 0; i < Wd; i++) for (const j of [i, N - Wd + i]) if (!inside[j] && !outside[j]) { outside[j] = 1; q[qt++] = j; }
  for (let r = 0; r < Hd; r++) for (const j of [r * Wd, r * Wd + Wd - 1]) if (!inside[j] && !outside[j]) { outside[j] = 1; q[qt++] = j; }
  while (qh < qt) {
    const j = q[qh++]; const x = j % Wd, z = (j / Wd) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= Wd || nz >= Hd) continue;
      const k = nz * Wd + nx; if (!inside[k] && !outside[k]) { outside[k] = 1; q[qt++] = k; }
    }
  }
  // chamfer 3-4 distance transform (≈ Euclidean, in thirds of a chunk) from a set of seed cells
  const distFrom = isSeed => {
    const d = new Float32Array(N); for (let j = 0; j < N; j++) d[j] = isSeed(j) ? 0 : 1e9;
    const pass = fwd => {
      const nb = fwd ? [[-1, 0, 3], [0, -1, 3], [-1, -1, 4], [1, -1, 4]] : [[1, 0, 3], [0, 1, 3], [1, 1, 4], [-1, 1, 4]];
      for (let z = fwd ? 0 : Hd - 1; fwd ? z < Hd : z >= 0; z += fwd ? 1 : -1) for (let x = fwd ? 0 : Wd - 1; fwd ? x < Wd : x >= 0; x += fwd ? 1 : -1) {
        const j = z * Wd + x; let v = d[j];
        for (const [dx, dz, w] of nb) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= Wd || nz >= Hd) continue; const c = d[nz * Wd + nx] + w; if (c < v) v = c; }
        d[j] = v;
      }
    };
    pass(true); pass(false); return d;
  };
  // 1. Find notches: open-air gaps that a smooth outline (closing with a round brush) would bridge.
  // 2. Cut back one chunk past them. 3. Round off what's left with an opening (round brush that must
  // fit inside). Never deeper than n from the original outside.
  const r3 = n * 3;
  const filled = j => !outside[j];
  const dOut = distFrom(j => outside[j]);
  const dToF = distFrom(filled);
  const dToGrown = distFrom(j => dToF[j] > r3);
  const dNotch = distFrom(j => outside[j] && dToGrown[j] > r3);
  const keep2 = new Uint8Array(N); for (let j = 0; j < N; j++) keep2[j] = filled(j) && dNotch[j] > 4 ? 1 : 0;
  const dOut2 = distFrom(j => !keep2[j]);
  const dCore = distFrom(j => dOut2[j] > r3);
  const drop = [];
  for (const [x, z] of pts) {
    const j = idx(x, z);
    if ((keep2[j] && dCore[j] <= r3) || dOut[j] > r3) continue; // smooth interior, or deeper than n
    const c = D.index.get(x + ',' + z); if (c && c.score > 0) continue; // building evidence stays
    drop.push(x + ',' + z);
  }
  return drop;
}
function cluesOutside(W, e) {
  const fp = footprint(W, e); if (!fp.count) return [];
  const out = [];
  for (const m of W.markers) {
    if (m.dim !== e.dim || !(m.weight > 0 || m.kind === 'sign')) continue;
    const cx = Math.floor(m.x) >> 4, cz = Math.floor(m.z) >> 4;
    if (fp.all.has(cx + ',' + cz)) continue;
    let near = false;
    for (let dx = -4; dx <= 4 && !near; dx++) for (let dz = -4; dz <= 4; dz++) if (fp.all.has((cx + dx) + ',' + (cz + dz))) { near = true; break; }
    if (near) out.push(m);
  }
  return out;
}
function keptBy(W, dim, p) {
  const k = (Math.floor(p.cx) >> 4) + ',' + (Math.floor(p.cz) >> 4);
  return (W.exhibits || []).find(e => e.dim === dim && footprint(W, e).core.has(k));
}
function keepPlace(i) {
  const W = state.worlds[state.w]; const p = W.places[state.dim][i];
  const kept = keptBy(W, state.dim, p);
  if (kept) { state.selEx = kept.id; openTab('exhibits'); renderExhibits(); draw(); return; }
  const name = placeTitle(p);
  snapshot(W);
  const e = newExhibit(W, state.dim, [p.minX, p.minZ, p.maxX, p.maxZ], name);
  state.selEx = e.id; renderPlaces(); renderExhibits(); draw();
  toast(`Kept “${name}”.`, 4000, true);
}
function finishRect(r) {
  const W = state.worlds[state.w];
  let e = state.mode.target && W.exhibits.find(x => x.id === state.mode.target);
  snapshot(W);
  if (e && e.dim === state.dim) { e.rects.push(r); changed(W, e); }
  else { e = newExhibit(W, state.dim, r, `Area ${W.exhibits.length + 1}`); state.mode.target = e.id; }
  state.selEx = e.id;
  if (!footprint(W, e).count) toast('That outline has no saved terrain in it.', 5000, true);
  else toast(`Added to “${e.name}”. Drag again for more, or tap Done.`, 0, true);
  renderExhibits(); renderPlaces();
}
function setMode(m) {
  state.mode = m; const b = $('#drawBtn');
  b.setAttribute('aria-pressed', !!m); b.textContent = m ? 'Done' : 'Draw area';
  if (m) {
    const W = state.worlds[state.w]; const t = m.target && W.exhibits.find(x => x.id === m.target);
    toast(t ? `Drag on the map to add to “${t.name}”. Pinch or scroll to zoom.` : 'Drag on the map to outline an area. Pinch or scroll to zoom.');
    toMap();
  } else toast('');
}
$('#drawBtn').onclick = () => setMode(state.mode ? null : { target: null });
let toastT = 0;
function toast(msg, ms, withUndo) {
  const t = $('#toast'); clearTimeout(toastT);
  if (!msg) { t.hidden = true; return; }
  t.textContent = msg; t.hidden = false;
  if (withUndo) { const b = document.createElement('button'); b.textContent = 'Undo'; b.onclick = undo; t.appendChild(b); }
  if (ms) toastT = setTimeout(() => { t.hidden = true; }, ms);
}

// map overlay
const vc = document.createElement('canvas'); const vg = vc.getContext('2d');
function drawExhibits(W, d, r) {
  const exs = (W.exhibits || []).filter(e => e.dim === d);
  const s = state.view.s; const cs = 16 * s;
  const vis = (sx, sy) => !(sx > r.w || sy > r.h || sx + cs < 0 || sy + cs < 0);
  if (exs.length && state.settings.veil) {
    if (vc.width !== cv.width || vc.height !== cv.height) { vc.width = cv.width; vc.height = cv.height; }
    vg.setTransform(dpr, 0, 0, dpr, 0, 0); vg.globalCompositeOperation = 'source-over';
    vg.clearRect(0, 0, r.w, r.h); vg.fillStyle = 'rgba(8,12,10,.58)'; vg.fillRect(0, 0, r.w, r.h);
    vg.globalCompositeOperation = 'destination-out'; vg.fillStyle = '#000';
    for (const e of exs) for (const [x, z] of footprint(W, e).allList) { const [sx, sy] = toScreen(x * 16, z * 16); if (vis(sx, sy)) vg.fillRect(sx - 0.5, sy - 0.5, cs + 1, cs + 1); }
    ctx.drawImage(vc, 0, 0, r.w, r.h);
  }
  const edges = (list, set) => {
    ctx.beginPath();
    for (const [x, z] of list) {
      const [sx, sy] = toScreen(x * 16, z * 16); if (!vis(sx, sy)) continue;
      if (!set.has(x + ',' + (z - 1))) { ctx.moveTo(sx, sy); ctx.lineTo(sx + cs, sy); }
      if (!set.has(x + ',' + (z + 1))) { ctx.moveTo(sx, sy + cs); ctx.lineTo(sx + cs, sy + cs); }
      if (!set.has((x - 1) + ',' + z)) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + cs); }
      if (!set.has((x + 1) + ',' + z)) { ctx.moveTo(sx + cs, sy); ctx.lineTo(sx + cs, sy + cs); }
    }
    ctx.stroke();
  };
  const oak = css('--oak');
  for (const e of exs) {
    const fp = footprint(W, e); if (!fp.count) continue;
    const sel = e.id === state.selEx;
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.setLineDash([5, 4]); edges(fp.allList, fp.all); ctx.setLineDash([]);
    ctx.lineWidth = sel ? 3 : 2; ctx.strokeStyle = oak; edges(fp.coreList, fp.core);
    const [lx, ly] = toScreen(fp.minX * 16, fp.minZ * 16);
    ctx.font = '700 13px ' + css('--display'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(e.name).width;
    ctx.fillStyle = sel ? oak : 'rgba(20,26,23,.85)'; ctx.fillRect(lx, ly - 20, tw + 12, 20);
    ctx.fillStyle = '#fffaf0'; ctx.fillText(e.name, lx + 6, ly - 4);
  }
  if (state.drag) {
    const [x0, z0, x1, z1] = state.drag;
    const [ax, ay] = toScreen(Math.min(x0, x1) * 16, Math.min(z0, z1) * 16), [bx, by] = toScreen((Math.max(x0, x1) + 1) * 16, (Math.max(z0, z1) + 1) * 16);
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(ax, ay, bx - ax, by - ay);
    ctx.lineWidth = 2; ctx.strokeStyle = oak; ctx.strokeRect(ax, ay, bx - ax, by - ay);
  }
}

// Kept tab
const mb = bytes => bytes < 1e6 ? '<1 MB' : (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0) + ' MB';
function renderExhibits() {
  const pane = $('#pane-exhibits'); if (!pane) return;
  const all = []; state.worlds.forEach((W, wi) => (W.exhibits || []).forEach(e => all.push([W, wi, e])));
  let chunks = 0, bytes = 0; const worldsUsed = new Set();
  for (const [W, wi, e] of all) { const fp = footprint(W, e); chunks += fp.count; bytes += fp.count * W.bytesPerChunk; worldsUsed.add(wi); }
  const S = state.settings;
  let h = `<div class="settings">
    <label class="rng">Landscape margin for new areas <output id="o-margin">${S.margin} chunk${S.margin === 1 ? '' : 's'}</output><input id="s-margin" type="range" min="0" max="8" value="${S.margin}"></label>
    <label class="rng">Smooth edges for new areas <output id="o-smooth">${S.smooth ? 'up to ' + S.smooth + ' chunk' + (S.smooth === 1 ? '' : 's') : 'off'}</output><input id="s-smooth" type="range" min="0" max="6" value="${S.smooth}"></label>
    <label class="rng">Gap between exhibits <output id="o-gap">${S.gap} chunk${S.gap === 1 ? '' : 's'}</output><input id="s-gap" type="range" min="1" max="8" value="${S.gap}"></label>
    <label class="check"><input id="s-veil" type="checkbox" ${S.veil ? 'checked' : ''}> Fade everything that isn’t kept</label>
  </div>`;
  if (!all.length) {
    h += `<p class="hint">Nothing kept yet. Use Draw area to outline somewhere, guided by the red building shading${showPins() ? ', or tap a numbered pin and choose Keep' : ''}. Each kept area becomes one exhibit, copied from bedrock to sky.</p>`;
  } else {
    h += `<div class="total">${all.length} exhibit${all.length > 1 ? 's' : ''} from ${worldsUsed.size} world${worldsUsed.size > 1 ? 's' : ''}: ${chunks.toLocaleString()} chunks, about ${mb(bytes)}</div>
      <p class="small" style="margin:0 0 6px">The gap is applied when the museum is assembled. Your plan is saved in this browser, so reopening the same worlds brings it back.</p>`;
    for (const [W, wi, e] of all) {
      const fp = footprint(W, e); const clues = cluesOutside(W, e);
      const wb = fp.count ? (fp.maxX - fp.minX + 1) * 16 : 0, hb = fp.count ? (fp.maxZ - fp.minZ + 1) * 16 : 0;
      h += `<div class="ex${e.id === state.selEx ? ' on' : ''}" data-w="${wi}" data-id="${e.id}">
        <input class="exname" value="${esc(e.name)}" aria-label="Exhibit name" maxlength="60">
        <div class="pmeta" data-meta>${esc(W.name)}, ${DN[e.dim]}. ${fp.count ? `${fp.count.toLocaleString()} chunks, ${wb}×${hb} blocks, about ${mb(fp.count * W.bytesPerChunk)}` : 'No saved terrain inside this outline'}</div>
        <label class="rng">Landscape margin <output>${e.margin} chunk${e.margin === 1 ? '' : 's'}</output><input data-act="margin" type="range" min="0" max="8" value="${e.margin}"></label>
        <label class="rng">Smooth edges <output>${(e.smooth | 0) ? 'up to ' + e.smooth + ' chunk' + (e.smooth === 1 ? '' : 's') + (fp.trimmed ? `, ${fp.trimmed} trimmed` : '') : 'off'}</output><input data-act="smooth" type="range" min="0" max="6" value="${e.smooth | 0}"></label>
        ${clues.length ? `<div class="warn">${clues.length} building clue${clues.length > 1 ? 's' : ''} just outside, possibly a tunnel or outbuilding.<button data-act="extend">Include ${clues.length > 1 ? 'them' : 'it'}</button><button data-act="peek">Show</button></div>` : ''}
        <div class="exbtns">
          <button data-act="show">Show</button>
          <button data-act="add">Add area</button>
          <button data-act="undo" ${e.rects.length < 2 ? 'disabled' : ''}>Undo last area</button>
          ${(e.erase || []).length ? `<button data-act="unerase">Restore erased areas</button>` : ''}
          <button data-act="remove" class="danger">Remove</button>
        </div></div>`;
    }
  }
  const curW = state.worlds[state.w];
  if (curW && state.mset && state.mset.backdrop === worldId(curW)) h = `<p class="warn">${esc(curW.name)} is the museum’s backdrop, so the whole world is carried over as the base and its kept areas below are ignored. Change this in the World tab.</p>` + h;
  pane.innerHTML = h; updateBadges();
  const plural = n => `${n} chunk${n == 1 ? '' : 's'}`;
  $('#s-margin').oninput = ev => { S.margin = +ev.target.value; $('#o-margin').textContent = plural(S.margin); saveSettings(); };
  const smoothTxt = n => n ? `up to ${n} chunk${n === 1 ? '' : 's'}` : 'off';
  $('#s-smooth').oninput = ev => { S.smooth = +ev.target.value; $('#o-smooth').textContent = smoothTxt(S.smooth); saveSettings(); };
  $('#s-gap').oninput = ev => { S.gap = +ev.target.value; $('#o-gap').textContent = plural(S.gap); saveSettings(); };
  $('#s-veil').onchange = ev => { S.veil = ev.target.checked; saveSettings(); draw(); };
  pane.querySelectorAll('.ex').forEach(card => {
    const W = state.worlds[+card.dataset.w]; const e = W.exhibits.find(x => x.id === card.dataset.id);
    card.querySelector('.exname').onchange = ev => { const v = ev.target.value.trim(); if (v && v !== e.name) { snapshot(W); e.name = v; savePlan(W); draw(); } else ev.target.value = e.name; };
    card.querySelectorAll('[data-act]').forEach(el => {
      const act = el.dataset.act;
      if (act === 'smooth') {
        el.oninput = () => {
          if (!el._snap) { snapshot(W); el._snap = true; }
          e.smooth = +el.value; changed(W, e);
          const fp = footprint(W, e);
          el.previousElementSibling.textContent = e.smooth ? `up to ${e.smooth} chunk${e.smooth === 1 ? '' : 's'}${fp.trimmed ? `, ${fp.trimmed} trimmed` : ''}` : 'off';
          card.querySelector('[data-meta]').textContent = `${W.name}, ${DN[e.dim]}. ${fp.count.toLocaleString()} chunks, about ${mb(fp.count * W.bytesPerChunk)}`;
          if (state.worlds[state.w] === W) draw();
        };
        el.onchange = () => { el._snap = false; renderExhibits(); };
        return;
      }
      if (act === 'margin') {
        el.oninput = () => {
          if (!el._snap) { snapshot(W); el._snap = true; }
          e.margin = +el.value; changed(W, e);
          el.previousElementSibling.textContent = plural(e.margin);
          const fp = footprint(W, e); card.querySelector('[data-meta]').textContent = `${W.name}, ${DN[e.dim]}. ${fp.count.toLocaleString()} chunks, about ${mb(fp.count * W.bytesPerChunk)}`;
          if (state.worlds[state.w] === W) draw();
        };
        el.onchange = () => { el._snap = false; renderExhibits(); };
        return;
      }
      el.onclick = () => exhibitAction(W, +card.dataset.w, e, act, el);
    });
  });
}
function showExhibit(wi, e) {
  if (state.w !== wi) { state.w = wi; $('#worldSel').value = wi; selectWorld(wi); }
  if (state.dim !== e.dim) selectDim(e.dim, false);
  const W = state.worlds[wi]; const fp = footprint(W, e); state.selEx = e.id; toMap();
  if (!fp.count) { draw(); return; }
  const span = Math.max(fp.maxX - fp.minX + 1, fp.maxZ - fp.minZ + 1) * 16 + 64; const r = mapRect();
  flyTo((fp.minX + fp.maxX + 1) * 8, (fp.minZ + fp.maxZ + 1) * 8, Math.max(0.05, Math.min(6, Math.min(r.w, r.h) * 0.6 / span)));
}
function exhibitAction(W, wi, e, act, el) {
  if (act === 'show') { showExhibit(wi, e); renderExhibits(); }
  else if (act === 'add') { showExhibit(wi, e); setMode({ target: e.id }); renderExhibits(); }
  else if (act === 'unerase') { snapshot(W); e.erase = []; changed(W, e); renderExhibits(); draw(); toast('Erased areas restored.', 4000, true); }
  else if (act === 'undo') { if (e.rects.length > 1) { snapshot(W); e.rects.pop(); changed(W, e); renderExhibits(); renderPlaces(); draw(); } }
  else if (act === 'extend') {
    snapshot(W);
    const seen = new Set();
    for (const m of cluesOutside(W, e)) { const cx = Math.floor(m.x) >> 4, cz = Math.floor(m.z) >> 4, k = cx + ',' + cz; if (!seen.has(k)) { seen.add(k); e.rects.push([cx, cz, cx, cz]); } }
    changed(W, e); renderExhibits(); draw();
  }
  else if (act === 'peek') {
    showExhibit(wi, e); const c = cluesOutside(W, e)[0]; if (c) setTimeout(() => { flyTo(c.x, c.z, Math.max(state.view.s, 2)); showPop(c); }, 480);
  }
  else if (act === 'remove') {
    if (el.dataset.armed) { snapshot(W); W.exhibits = W.exhibits.filter(x => x !== e); toast(`Removed “${e.name}”.`, 5000, true); savePlan(W); if (state.mode && state.mode.target === e.id) setMode(null); renderExhibits(); renderPlaces(); draw(); }
    else { el.dataset.armed = '1'; el.textContent = 'Tap again to remove'; setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = 'Remove'; } }, 3000); }
  }
}
