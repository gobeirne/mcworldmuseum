/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
// ---------- step 3: arrange the museum and build the world
const B = MuseumBuild;
state.museum = false; state.mdim = 0; state.selGroup = null; state.gdrag = null; state.built = null;
state.mset = { backdrop: null, hub: { on: false, chunk: null, picks: {}, link: null },  name: 'World Museum', keepPlayer: true, spawnGroup: null, surround: 'ocean', seedFrom: '', seedText: '', pin: true, cutEdges: false, rough: 1, cheats: true };
const SUR = {
  ocean: ['Ocean', 'Open blue sea around every exhibit, with the water surface at the originals’ sea level.', '#2b558c'],
  warm_ocean: ['Warm ocean', 'Turquoise water with tropical fish, at the same sea level.', '#2a8db0'],
  frozen_ocean: ['Frozen ocean', 'Sea capped with ice, so you can walk between exhibits. Snow falls.', '#cfdfe7'],
  plains: ['Grassy plains', 'A flat meadow at sea level. Exhibits on higher ground sit on little plateaus.', '#7da35a'],
  desert: ['Desert', 'Flat sand at sea level. Exhibits on higher ground sit on little plateaus.', '#dccf98'],
  mushroom: ['Mushroom fields', 'Flat mycelium at sea level. Hostile mobs don’t spawn here, so it’s a peaceful gallery.', '#8e7c90'],
  void: ['Void', 'Nothing at all. Exhibits float as islands, with their undersides on show.', '#0d0f14'],
  seed: ['Normal terrain from a seed', 'Ordinary Minecraft landscape, generated from a seed you choose.', '#5d7050']
};
const worldKey = W => worldId(W);
const MSET_DEFAULTS = JSON.parse(JSON.stringify(state.mset));
try { Object.assign(state.mset, JSON.parse(localStorage.getItem('wm:museum') || '{}')); } catch (e) {}
// Arrangement: per exhibit, the chunk offset from its original position (so it survives footprint edits).
let arrange = {};
try { arrange = JSON.parse(localStorage.getItem('wm:arrange2') || '{}'); } catch (e) {}
const saveArrange = () => { try { localStorage.setItem('wm:arrange2', JSON.stringify(arrange)); localStorage.setItem('wm:museum', JSON.stringify(state.mset)); } catch (e) {} };
const dlReady = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

// Every kept area is its own exhibit. Chunks shared by two kept areas of the same world go to the
// area with the bigger footprint.
function buildGroups() {
  const groups = [];
  const bd = backdropW();
  if (bd) for (const dim of [0, 1, 2]) {
    const D = bd.dims[dim]; if (!D || !D.chunks.length) continue;
    const chunks = D.chunks.map(c => [c.x, c.z]);
    const g = { id: 'backdrop:' + dim, backdrop: true, exhibit: null, world: bd, dim, name: bd.name, chunks, set: new Set(chunks.map(([x, z]) => x + ',' + z)), minX: D.minX, minZ: D.minZ, maxX: D.maxX, maxZ: D.maxZ };
    // for packing, the backdrop's occupied land is its earlier exhibits, its hubs and anything built
    const occ = new Set(); const mi = bd.museumInfo || {};
    const ex = (mi.exhibits || {})[dim] || []; for (let i = 0; i + 1 < ex.length; i += 2) occ.add(ex[i] + ',' + ex[i + 1]);
    for (const c of D.chunks) if (c.score > 0) occ.add(c.x + ',' + c.z);
    for (const h of (mi.hubs || [])) if (dim === 0) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) occ.add(((h.x >> 4) + dx) + ',' + ((h.z >> 4) + dz));
    g.solid = [...occ].filter(k => g.set.has(k)).map(k => k.split(',').map(Number));
    g.comps = [chunks]; g.active = chunks; g.dropped = 0; g.droppedBuilt = 0;
    groups.push(g);
  }
  state.worlds.forEach(W => {
    if (W === bd) return;
    for (const dim of [0, 1, 2]) {
      const exs = (W.exhibits || []).filter(e => e.dim === dim && footprint(W, e).count);
      const owner = new Map();
      for (const e of exs.slice().sort((a, b) => footprint(W, b).count - footprint(W, a).count)) for (const k of footprint(W, e).all) if (!owner.has(k)) owner.set(k, e.id);
      for (const e of exs) {
        const chunks = [...footprint(W, e).all].filter(k => owner.get(k) === e.id).map(k => k.split(',').map(Number));
        if (!chunks.length) continue;
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const [x, z] of chunks) { if (x < minX) minX = x; if (z < minZ) minZ = z; if (x > maxX) maxX = x; if (z > maxZ) maxZ = z; }
        const g = { id: e.id, top: !!e.top, exhibit: e, world: W, dim, name: e.name, chunks, set: new Set(chunks.map(([x, z]) => x + ',' + z)), minX, minZ, maxX, maxZ };
        classifyLand(g); groups.push(g);
      }
    }
  });
  return groups;
}
let groups = [];
// The backdrop: a previously built museum (or any world you choose), carried over as the base world and fixed
// in place. New exhibits always go on top of it.
function backdropW() { const id = state.mset.backdrop; return id ? state.worlds.find(W => worldId(W) === id) || null : null; }
function surKind() { // the surroundings in force: the backdrop's own, if there is one
  const bd = backdropW(); if (!bd) return state.mset.surround;
  if (bd.generator === 1) return 'seed';
  return (bd.flatLayers && B.matchSurround(bd.flatLayers)) || 'custom';
}
const SUR_CUSTOM = ['Custom', 'A flat world with its own layers.', '#2b558c'];
const surInfo = k => SUR[k] || SUR_CUSTOM;
function autoBackdrop() {
  if (state.mset.backdrop) return;
  const W = state.worlds.find(X => X.museumInfo); if (!W) return;
  state.mset.backdrop = worldId(W); saveArrange();
  toast(`Recognised “${W.name}” as a museum built with this tool. It’s now the backdrop: carried over as the base world, with new exhibits going on top.`, 6000);
}
// Landmasses: connected pieces of an exhibit (touching diagonally counts), biggest first. For packing,
// the main land is the biggest piece, any piece at least half its size, and any piece with building
// evidence; smaller pieces may be overlapped and will give way.
function classifyLand(g) {
  const D = g.world.dims[g.dim]; const seen = new Set(); const comps = [];
  for (const [x, z] of g.chunks) {
    const k0 = x + ',' + z; if (seen.has(k0)) continue;
    const comp = []; const st = [[x, z]]; seen.add(k0);
    while (st.length) { const [a, c] = st.pop(); comp.push([a, c]); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const k = (a + dx) + ',' + (c + dz); if (!seen.has(k) && g.set.has(k)) { seen.add(k); st.push([a + dx, c + dz]); } } }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  g.comps = comps; g.solid = [];
  comps.forEach((comp, i) => {
    const evidence = comp.some(([x, z]) => { const c = D.index.get(x + ',' + z); return c && c.score > 0; });
    if (i === 0 || evidence || comp.length >= comps[0].length / 2) g.solid.push(...comp);
  });
  g.active = g.chunks; g.dropped = 0; g.droppedBuilt = 0;
}
// Where exhibits meet, the bigger landmass wins: pieces are placed biggest first, and a chunk is left
// out if it would overlap, or sit within the gap of, a chunk already placed by another exhibit.
function resolveOverlaps() {
  const gap = state.settings.gap;
  for (const g of groups) { g.active = g.chunks; g.dropped = 0; g.droppedBuilt = 0; }
  for (const dim of [0, 1, 2]) {
    const gs = groups.filter(g => g.dim === dim); if (gs.length < 2) continue;
    const pieces = []; for (const g of gs) for (const comp of g.comps) pieces.push({ g, comp });
    pieces.sort((a, b) => (a.g.backdrop ? 1 : 0) - (b.g.backdrop ? 1 : 0) || (b.g.top ? 1 : 0) - (a.g.top ? 1 : 0) || b.comp.length - a.comp.length || b.g.chunks.length - a.g.chunks.length);
    const owner = new Map(); const kept = new Map(gs.map(g => [g.id, []])); const bdIds = new Set(gs.filter(g => g.backdrop).map(g => g.id));
    for (const { g, comp } of pieces) {
      const dx = g.ox - g.minX, dz = g.oz - g.minZ; const D = g.world.dims[g.dim];
      for (const [x, z] of comp) {
        const X = x + dx, Z = z + dz; let clash = false;
        for (let i = -gap; i <= gap && !clash; i++) for (let j = -gap; j <= gap; j++) { const o = owner.get((X + i) + ',' + (Z + j)); if (o !== undefined && o !== g.id && (!(g.backdrop || bdIds.has(o)) || (i === 0 && j === 0))) { clash = true; break; } }
        if (clash) { g.dropped++; const c = D.index.get(x + ',' + z); if (c && c.score > 0) g.droppedBuilt++; }
        else { owner.set(X + ',' + Z, g.id); kept.get(g.id).push([x, z]); }
      }
    }
    for (const g of gs) if (g.dropped) g.active = kept.get(g.id);
  }
  for (const g of groups) { let h = 0; for (const [x, z] of g.active) h = (h * 31 + x * 7919 + z) | 0; g.sig = g.active.length + ':' + h; }
}
function layout(repack) {
  groups = buildGroups();
  const gap = state.settings.gap;
  const pinW = pinnedWorld();
  for (const g of groups) g.pinned = g.backdrop || g.world === pinW;
  const corner = (g, d) => [g.minX + d[0], g.minZ + d[1]];
  for (const dim of [0, 1, 2]) {
    const gs = groups.filter(g => g.dim === dim); if (!gs.length) continue;
    const fixed = {};
    for (const g of gs) if (g.pinned) fixed[g.id] = [g.minX, g.minZ];
    if (!repack) {
      // keep saved spots where an exhibit's main land still fits
      const occ = new Set();
      const cellsAt = (g, pos) => g.solid.map(([x, z]) => (x - g.minX + pos[0]) + ',' + (z - g.minZ + pos[1]));
      for (const g of gs) if (fixed[g.id]) for (const c of cellsAt(g, fixed[g.id])) occ.add(c);
      for (const g of gs.slice().sort((a, b) => b.chunks.length - a.chunks.length)) {
        if (fixed[g.id] || !Array.isArray(arrange[g.id])) continue;
        const pos = corner(g, arrange[g.id]); const cells = cellsAt(g, pos);
        if (cells.every(c => !occ.has(c))) { fixed[g.id] = pos; for (const c of cells) occ.add(c); }
      }
    }
    const res = B.pack(gs.map(g => ({ id: g.id, chunks: g.solid.length ? g.solid : g.chunks, ref: [g.minX, g.minZ] })), gap, fixed);
    for (const g of gs) arrange[g.id] = [res[g.id][0] - g.minX, res[g.id][1] - g.minZ];
  }
  for (const g of groups) { g.ox = g.minX + arrange[g.id][0]; g.oz = g.minZ + arrange[g.id][1]; }
  checkIssues(); saveArrange();
}
function seedWorld() { const M = state.mset; return !backdropW() && M.surround === 'seed' && M.seedFrom ? groups.map(g => g.world).find(W => worldKey(W) === M.seedFrom) || null : null; }
function pinnedWorld() { groups = groups.length ? groups : buildGroups(); return state.mset.pin ? seedWorld() : null; }
function seedProblem() {
  const M = state.mset; if (backdropW() || M.surround !== 'seed') return '';
  if (M.seedFrom) return seedWorld() ? '' : 'Choose which world’s seed to use.';
  const t = (M.seedText || '').trim();
  if (!/^-?\d+$/.test(t)) return 'Type a seed made of digits (an optional minus sign is fine). Word seeds aren’t supported here; use Minecraft’s numeric seed for the world instead.';
  const n = BigInt(t); if (n < -(2n ** 63n) || n >= 2n ** 64n) return 'That number is too large to be a Minecraft seed.';
  return '';
}
function placedChunks(g) { const dx = g.ox - g.minX, dz = g.oz - g.minZ; return g.active.map(([x, z]) => [x + dx, z + dz]); }
let issues = {};
function checkIssues() {
  hubCache = null;
  resolveOverlaps();
  issues = {};
  for (const g of groups) if (g.dropped) issues[g.id] = 'trimmed';
}
function spawnFor() {
  const ow = groups.filter(g => g.dim === 0 && g.active.length);
  const g = ow.find(x => x.id === state.mset.spawnGroup) || ow.slice().sort((a, b) => b.chunks.length - a.chunks.length)[0];
  if (!g) return { x: 0, y: 70, z: 0, group: null };
  const cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2;
  let best = g.active[0], bd = Infinity;
  for (const c of g.active) { const d = Math.hypot(c[0] - cx, c[1] - cz); if (d < bd) { bd = d; best = c; } }
  const D = g.world.dims[0]; const ch = D.index.get(best[0] + ',' + best[1]);
  const y = ch && ch.h ? Math.max(...ch.h) : 70;
  return { x: (best[0] - g.minX + g.ox) * 16 + 8, y: Math.min(318, y + 1), z: (best[1] - g.minZ + g.oz) * 16 + 8, group: g };
}

// Where everything ended up, with teleport commands.
const DIM_ID = ['overworld', 'nether', 'the_end'];
function surfaceAt(W, dim, x, z) {
  const c = W.dims[dim] && W.dims[dim].index.get((Math.floor(x) >> 4) + ',' + (Math.floor(z) >> 4));
  if (dim !== 0 || !c || !c.h) return null;
  return c.h[(Math.floor(z) & 15) * 16 + (Math.floor(x) & 15)];
}
function directory(noSpawnRow) {
  const sp = noSpawnRow ? {} : museumSpawn(); const rows = [];
  const lookup = new Map();
  for (const g of groups) { if (!g.activeSet || g.activeSet.n !== g.active.length) { g.activeSet = new Set(g.active.map(([x, z]) => x + ',' + z)); g.activeSet.n = g.active.length; } }
  const place = (W, dim, x, z) => { // source block -> museum block, if it was kept
    const k = (Math.floor(x) >> 4) + ',' + (Math.floor(z) >> 4);
    for (const g of groups) if (g.world === W && g.dim === dim && g.activeSet.has(k)) return { x: Math.floor(x) + (g.ox - g.minX) * 16, z: Math.floor(z) + (g.oz - g.minZ) * 16, g };
    return null;
  };
  const bdw = backdropW();
  if (bdw && !noSpawnRow) {
    if (sp.x !== undefined) rows.push({ world: '', label: 'Museum spawn (unchanged)', dim: 0, x: sp.x, y: sp.y, z: sp.z });
    const hp = hubPlan(); if (hp && hp.spawn) rows.push({ world: '', label: 'New transporter hub', dim: 0, x: hp.spawn.x, y: hp.spawn.y, z: hp.spawn.z });
    const oh = origHub(); if (oh) rows.push({ world: '', label: 'Original transporter hub', dim: 0, x: oh.x, y: oh.y, z: oh.z });
  } else if (sp.group || sp.hub) rows.push({ world: '', label: sp.hub ? 'Transporter hub (museum spawn)' : 'Museum spawn', dim: 0, x: sp.x, y: sp.y, z: sp.z });
  const worldsUsed = [...new Set(groups.filter(g => !g.backdrop).map(g => g.world))];
  for (const W of worldsUsed) {
    for (const g of groups.filter(x => x.world === W)) {
      if (!g.active.length) { rows.push({ world: W.name, label: g.name, missing: true, covered: true }); continue; }
      const cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2; let best = g.active[0], bd = Infinity;
      for (const c of g.active) { const d = Math.hypot(c[0] - cx, c[1] - cz); if (d < bd) { bd = d; best = c; } }
      const bx = best[0] * 16 + 8, bz = best[1] * 16 + 8;
      let y = surfaceAt(W, g.dim, bx, bz);
      if (y === null) { const ms = W.markers.filter(m => m.dim === g.dim && g.activeSet.has((Math.floor(m.x) >> 4) + ',' + (Math.floor(m.z) >> 4))); y = ms.length ? Math.round(ms[0].y) : 64; }
      rows.push({ world: W.name, W, g, area: g.name, kind: 'centre', label: g.name, dim: g.dim, x: bx + (g.ox - g.minX) * 16, y: Math.min(318, y + 1), z: bz + (g.oz - g.minZ) * 16, approxY: g.dim !== 0 });
    }
    if (W.player) {
      const p = place(W, W.player.dim, W.player.x, W.player.z);
      rows.push(p ? { world: W.name, W, g: p.g, area: p.g.name, kind: 'last', label: 'Where you last stood', dim: W.player.dim, x: p.x, y: Math.round(W.player.y), z: p.z } : { world: W.name, W, kind: 'last', label: 'Where you last stood', missing: true });
    }
    const s0 = W.level.spawn;
    if (s0) {
      const p = place(W, 0, s0.x, s0.z);
      let y = s0.y; if (!(y > -64 && y < 320)) { const h = surfaceAt(W, 0, s0.x, s0.z); y = h === null ? 70 : h + 1; }
      rows.push(p ? { world: W.name, W, g: p.g, area: p.g.name, kind: 'spawn', label: 'World spawn', dim: 0, x: p.x, y, z: p.z } : { world: W.name, W, kind: 'spawn', label: 'World spawn', missing: true });
    }
  }
  return rows;
}
// ---------- transporter hub
// One hub station per destination (command block at ground level, button on its front, sign on top),
// and a "Back to the hub" station beside every destination.
let hubCache = null;
function ownerMap() {
  const m = new Map();
  for (const g of groups) { const dx = g.ox - g.minX, dz = g.oz - g.minZ; for (const [x, z] of g.active) m.set(g.dim + '|' + (x + dx) + '|' + (z + dz), g); }
  return m;
}
function surfaceMuseum(om, dim, X, Z) {
  const g = om.get(dim + '|' + Math.floor(X / 16) + '|' + Math.floor(Z / 16)); if (!g) return undefined;
  return surfaceAt(g.world, dim, X - (g.ox - g.minX) * 16, Z - (g.oz - g.minZ) * 16);
}
const KIND_LABEL = { last: 'Last visited', spawn: 'Spawn', centre: '', orig: '' };
function hubPlan() {
  const H = state.mset.hub; if (!H || !H.on) return null;
  if (hubCache) return hubCache;
  const out = { blocks: [], stations: [], pads: [], missing: [], problems: [], spawn: null, padless: 0 };
  const rows = directory(true).filter(r => r.W);
  const dests = [];
  for (const W of [...new Set(rows.map(r => r.W))]) {
    const pick = H.picks[worldKey(W)] || 'both';
    const wr = rows.filter(r => r.W === W);
    const chosen = wr.filter(r => (r.kind === 'last' && pick !== 'spawn') || (r.kind === 'spawn' && pick !== 'last'));
    for (const r of chosen) (r.missing ? out.missing : dests).push(r);
    const covered = new Set(chosen.filter(r => !r.missing).map(r => r.g));
    for (const r of wr) if (r.kind === 'centre' && !r.missing && !covered.has(r.g)) dests.push(r);
  }
  const oh = origHub();
  if (oh) { const g0 = groups.find(g => g.backdrop && g.dim === 0); if (g0) dests.push({ world: '', area: 'Original hub', kind: 'orig', dim: 0, x: oh.x, y: oh.y, z: oh.z, g: g0 }); }
  out.dests = dests;
  if (!H.chunk) { out.problems.push('Choose where the hub goes: tap Place hub, then a spot on the overworld map.'); return (hubCache = out); }
  const om = ownerMap(); const sur = surKind(); const flat = !!B.SURROUNDINGS[sur];
  const platTop = flat ? B.surfaceTop(sur) : null;
  const ground = (X, Z) => { const s = surfaceMuseum(om, 0, X, Z); if (s !== undefined && s !== null) return s; return flat ? platTop + 1 : null; };
  const isOpen = (X, Z) => !om.has('0|' + Math.floor(X / 16) + '|' + Math.floor(Z / 16));
  const per = 8, n = Math.max(1, dests.length), across = Math.min(n, per);
  const x0 = H.chunk[0] * 16 + Math.max(1, 8 - across), z0 = H.chunk[1] * 16 + 12;
  const cmdTo = (d, dim) => dim === 0 ? `tp @p ${d.x} ${d.y} ${d.z}` : `execute in ${DIM_ID[dim]} run tp @p ${d.x} ${d.y} ${d.z}`;
  const pos = dests.map((d, i) => ({ d, X: x0 + (i % per) * 2, Z: z0 - Math.floor(i / per) * 4 }));
  // platform where the hub sits on open surroundings
  if (pos.length) {
    const xs = pos.map(p => p.X), zs = pos.map(p => p.Z);
    for (let X = Math.min(...xs) - 3; X <= Math.max(...xs) + 3; X++) for (let Z = Math.min(...zs) - 3; Z <= Math.max(...zs) + 4; Z++) {
      if (!isOpen(X, Z)) continue;
      if (!flat) { out.problems.push(backdropW() ? 'With this backdrop’s surroundings, the hub must sit entirely on the backdrop or an exhibit. Move it onto land.' : 'With normal terrain from a seed, the hub must sit entirely on an exhibit. Move it further onto one.'); return (hubCache = out); }
      out.blocks.push({ dim: 0, x: X, y: platTop, z: Z, kind: 'stone' });
    }
  }
  const hx = x0 + across - 1, hz = z0 + 2, hy = ground(hx, hz) ?? 64;
  out.spawn = { x: hx, y: hy, z: hz };
  for (const { d, X, Z } of pos) {
    const y = ground(X, Z) ?? hy;
    const text = [d.world, d.area, KIND_LABEL[d.kind]].filter(Boolean).join('\n');
    out.blocks.push({ dim: 0, x: X, y, z: Z, kind: 'cmd', cmd: cmdTo(d, d.dim) }, { dim: 0, x: X, y, z: Z + 1, kind: 'button', face: 3 }, { dim: 0, x: X, y: y + 1, z: Z, kind: 'sign', rot: 0, text });
    out.stations.push({ x: X, y, z: Z, d });
  }
  // return pads beside each destination, kept inside that destination's exhibit
  const back = dim => dim === 0 ? `tp @p ${hx} ${hy} ${hz}` : `execute in overworld run tp @p ${hx} ${hy} ${hz}`;
  for (const d of dests) {
    let placed = false;
    const H2 = state.mset.hub; const spots = d.kind === 'orig' && H2.link ? [[H2.link[0] - d.x, H2.link[1] - d.z]] : [[2, 0], [-2, 0], [0, -2], [2, -2], [-2, -2], [0, 3]];
    for (const [ox, oz] of spots) {
      const px = d.x + ox, pz = d.z + oz;
      const okCol = (X, Z) => om.get(d.dim + '|' + Math.floor(X / 16) + '|' + Math.floor(Z / 16)) === d.g;
      if (!okCol(px, pz) || !okCol(px, pz + 1)) continue;
      const py = d.dim === 0 ? (surfaceMuseum(om, 0, px, pz) ?? d.y) : Math.floor(d.y);
      out.blocks.push({ dim: d.dim, x: px, y: py, z: pz, kind: 'cmd', cmd: back(d.dim) }, { dim: d.dim, x: px, y: py, z: pz + 1, kind: 'button', face: 3 }, { dim: d.dim, x: px, y: py + 1, z: pz, kind: 'sign', rot: 0, text: d.kind === 'orig' ? 'To the\nnew hub' : 'Back to\nthe hub' });
      out.pads.push({ x: px, y: py, z: pz, dim: d.dim, link: d.kind === 'orig' }); placed = true; break;
    }
    if (!placed) out.padless++;
  }
  return (hubCache = out);
}
function origHub() { const bd = backdropW(); const h = bd && bd.museumInfo && bd.museumInfo.hub; return h && Number.isFinite(h.x) ? h : null; }
function museumSpawn() {
  const bd = backdropW();
  if (bd) { const s0 = bd.level.spawn; if (!s0) return { group: null }; let y = s0.y; if (!(y > -64 && y < 320)) { const h = surfaceAt(bd, 0, s0.x, s0.z); y = h === null ? 70 : h + 1; } return { x: s0.x, y, z: s0.z, group: true }; }
  const hp = hubPlan();
  if (hp && hp.spawn) return { ...hp.spawn, hub: true };
  return spawnFor();
}
state.placingHub = false; state.placingLink = false;
function startPlacingLink() { state.placingLink = true; state.placingHub = false; if (state.mdim !== 0) { state.mdim = 0; syncMuseumBar(); } const oh = origHub(); if (oh) flyTo(oh.x, oh.z, Math.max(state.view.s, 2)); toMap(); toast('Tap where the station leading to the new hub should go, near the original hub.'); }
function placeLinkAt(sx, sy) { const [x, z] = toWorld(sx, sy); museumSnapshot(); state.mset.hub.link = [Math.floor(x), Math.floor(z)]; state.placingLink = false; hubCache = null; state.built = null; saveArrange(); toast('Link station placed.', 4000, true); renderMuseum(); draw(); }
// What the next build records about itself, so it can be recognised as a backdrop later.
function museumMarker() {
  const bd = backdropW(); const mi = (bd && bd.museumInfo) || {}; const hp = hubPlan();
  const ex = { 0: [], 1: [], 2: [] };
  for (const g of groups) {
    if (g.backdrop) { const prev = (mi.exhibits || {})[g.dim] || []; const act = new Set(g.active.map(([x, z]) => x + ',' + z)); for (let i = 0; i + 1 < prev.length; i += 2) if (act.has(prev[i] + ',' + prev[i + 1])) ex[g.dim].push(prev[i], prev[i + 1]); continue; }
    const dx = g.ox - g.minX, dz = g.oz - g.minZ; for (const [x, z] of g.active) ex[g.dim].push(x + dx, z + dz);
  }
  const newHub = hp && hp.spawn ? { x: hp.spawn.x, y: hp.spawn.y, z: hp.spawn.z } : null;
  return { v: 1, name: state.mset.name, built: new Date().toISOString(), surround: surKind(), hub: newHub || mi.hub || null, hubs: [...(mi.hubs || []), ...(newHub ? [newHub] : [])], exhibits: ex };
}
function startPlacingHub() {
  state.placingHub = true;
  if (state.mdim !== 0) { state.mdim = 0; syncMuseumBar(); fitMuseum(); }
  toMap(); toast('Tap the spot on the map where the hub should go.'); draw();
}
function placeHubAt(sx, sy) {
  const [x, z] = toWorld(sx, sy);
  museumSnapshot();
  state.mset.hub.chunk = [Math.floor(x / 16), Math.floor(z / 16)];
  state.placingHub = false; hubCache = null; state.built = null; saveArrange();
  toast('Hub placed.', 4000, true); renderMuseum(); draw();
}

const tpCmd = r => `/execute in ${DIM_ID[r.dim]} run tp @s ${r.x} ${r.y} ${r.z}`;
function directoryText(rows) {
  const lines = [`${state.mset.name}: directory`, 'Teleport commands need cheats turned on for this world.', ''];
  let cur = null;
  for (const r of rows) {
    if (r.world !== cur) { cur = r.world; if (cur) lines.push('', cur); }
    const ind = r.world ? '  ' : '';
    if (r.missing) lines.push(`${ind}${r.label}: ${r.covered ? 'entirely covered by a bigger exhibit' : 'not kept in the museum'}`);
    else lines.push(`${ind}${r.label} (${['Overworld', 'Nether', 'End'][r.dim]}): ${r.x} ${r.y} ${r.z}${r.approxY ? ' (height approximate)' : ''}`, `${ind}  ${tpCmd(r)}`);
  }
  return lines.join('\n') + '\n';
}
async function copyText(t, okMsg) {
  try { await navigator.clipboard.writeText(t); toast(okMsg, 1600); }
  catch (e) { toast('Copying isn’t allowed here. Press and hold the text to copy it instead.', 3000); }
}

// group thumbnails
const gcache = new Map();
function groupCanvas(g) {
  const key = g.id + ':' + g.sig;
  if (gcache.has(key)) return gcache.get(key);
  const w = g.maxX - g.minX + 1, h = g.maxZ - g.minZ + 1;
  const r = Math.max(1, Math.ceil(Math.max(w, h) * 16 / 1024));
  const c = document.createElement('canvas'); c.width = Math.ceil(w * 16 / r); c.height = Math.ceil(h * 16 / r);
  const ctx2 = c.getContext('2d'); ctx2.imageSmoothingEnabled = r > 1;
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = 16; const tg = tmp.getContext('2d'); const img = tg.createImageData(16, 16);
  const D = g.world.dims[g.dim]; const sea = g.dim === 0 ? 62 : 0;
  for (const [x, z] of g.active) {
    const ch = D.index.get(x + ',' + z); if (!ch) continue;
    MuseumCore.chunkPixels(ch, D, img.data, 0, 0, 16, sea); tg.putImageData(img, 0, 0);
    ctx2.drawImage(tmp, (x - g.minX) * 16 / r, (z - g.minZ) * 16 / r, 16 / r, 16 / r);
  }
  const out = { c, r }; gcache.set(key, out); return out;
}

const cutCache = new Map();
function cutCanvas(g, gc) {
  const key = g.id + ':' + g.sig + ':' + surKind() + ':' + state.mset.rough;
  if (cutCache.has(key)) return cutCache.get(key);
  const c = document.createElement('canvas'); c.width = gc.c.width; c.height = gc.c.height;
  const x2 = c.getContext('2d'); const img = x2.createImageData(c.width, c.height);
  const col = surInfo(surKind())[2]; const rgb = [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16));
  for (const [k, mask] of B.planCuts(g.active, state.mset.rough)) {
    const [cx, cz] = k.split(',').map(Number);
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      if (!mask[lx * 16 + lz]) continue;
      const px = Math.floor(((cx - g.minX) * 16 + lx) / gc.r), pz = Math.floor(((cz - g.minZ) * 16 + lz) / gc.r);
      const o = (pz * c.width + px) * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
  x2.putImageData(img, 0, 0); cutCache.set(key, c); return c;
}
function cutControlsHTML(M) {
  return `<label class="check"><input id="m-cut" type="checkbox" ${M.cutEdges ? 'checked' : ''}> Cut edges as smooth curves, block by block</label>
      <p class="small" style="margin:4px 0 0">Trims a few blocks from the outermost chunks so outlines curve instead of stepping in 16-block squares. Columns with anything crafted in them are never cut. Caves and tunnels crossing the curve get sealed.</p>
      ${M.cutEdges ? `<label class="rng">Edge texture <output>${['Smooth', 'Natural', 'Rugged'][M.rough]}</output><input id="m-rough" type="range" min="0" max="2" value="${M.rough}"></label>` : ''}`;
}
function backdropHTML(M) {
  const bd = backdropW(); const k = surKind();
  return `<div class="ex" style="background:var(--panel)"><div class="ptitle">Backdrop: ${esc(bd.name)}</div>
    <div class="pmeta">Carried over as the base world, with its terrain, builds and world-wide data such as maps and portals, fixed in place. New exhibits go on top of it: drag them onto blank areas. Its surroundings (${esc(k === 'seed' ? 'terrain from its seed' : surInfo(k)[0].toLowerCase())}), spawn and your player stay as they are.</div>
    <div class="exbtns"><button id="m-nobd">Stop using it as the backdrop</button></div></div>
    ${B.CUT_KINDS.has(k) ? cutControlsHTML(M) : ''}`;
}
const cutsOn = () => state.mset.cutEdges && B.CUT_KINDS.has(surKind());
function paintMuseum() {
  const r = mapRect(); const s = state.view.s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = state.mdim === 0 ? surInfo(surKind())[2] : state.mdim === 1 ? '#3a1d1a' : '#15141f'; ctx.fillRect(0, 0, r.w, r.h);
  if (s >= 0.6) {
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.beginPath();
    const [x0, z0] = toWorld(0, 0), [x1, z1] = toWorld(r.w, r.h);
    for (let x = Math.floor(x0 / 16) * 16; x <= x1; x += 16) { const [sx] = toScreen(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, r.h); }
    for (let z = Math.floor(z0 / 16) * 16; z <= z1; z += 16) { const [, sy] = toScreen(0, z); ctx.moveTo(0, sy); ctx.lineTo(r.w, sy); }
    ctx.stroke();
  }
  const oak = css('--oak'); const red = css('--m-red'); const sign = css('--m-sign');
  const gs = groups.filter(g => g.dim === state.mdim);
  const multiWorld = new Set(groups.filter(g => !g.backdrop).map(g => g.world)).size > 1;
  for (const g of gs) {
    const gc = groupCanvas(g); const [sx, sy] = toScreen(g.ox * 16, g.oz * 16);
    ctx.imageSmoothingEnabled = s * gc.r < 1;
    ctx.drawImage(gc.c, sx, sy, gc.c.width * gc.r * s, gc.c.height * gc.r * s);
    if (g.dim === 0 && cutsOn()) ctx.drawImage(cutCanvas(g, gc), sx, sy, gc.c.width * gc.r * s, gc.c.height * gc.r * s);
  }
  for (const g of gs) {
    const set = new Set(placedChunks(g).map(([x, z]) => x + ',' + z));
    const iss = issues[g.id]; const sel = g.id === state.selGroup;
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.strokeStyle = sel ? oak : iss === 'trimmed' ? sign : 'rgba(255,255,255,.75)';
    ctx.setLineDash(iss === 'trimmed' ? [6, 4] : []);
    ctx.beginPath(); const cs = 16 * s;
    for (const k of set) {
      const [x, z] = k.split(',').map(Number); const [sx, sy] = toScreen(x * 16, z * 16);
      if (!set.has(x + ',' + (z - 1))) { ctx.moveTo(sx, sy); ctx.lineTo(sx + cs, sy); }
      if (!set.has(x + ',' + (z + 1))) { ctx.moveTo(sx, sy + cs); ctx.lineTo(sx + cs, sy + cs); }
      if (!set.has((x - 1) + ',' + z)) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + cs); }
      if (!set.has((x + 1) + ',' + z)) { ctx.moveTo(sx + cs, sy); ctx.lineTo(sx + cs, sy + cs); }
    }
    ctx.stroke(); ctx.setLineDash([]);
    const [lx, ly] = toScreen(g.ox * 16, g.oz * 16);
    if (g.backdrop) continue;
    const label = (multiWorld ? `${g.world.name}: ${g.name}` : g.name) + (g.top ? ' (on top)' : '') + (g.pinned ? ' (pinned)' : '');
    ctx.font = '700 13px ' + css('--display'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const tw = Math.min(ctx.measureText(label).width, 320);
    ctx.fillStyle = sel ? oak : 'rgba(20,26,23,.85)'; ctx.fillRect(lx, ly - 20, tw + 12, 20);
    ctx.fillStyle = '#fffaf0'; ctx.fillText(label, lx + 6, ly - 4, 320);
  }
  const hp = hubPlan();
  if (hp) {
    ctx.fillStyle = css('--oak');
    for (const p of hp.pads) if (p.dim === state.mdim) { const [px, py] = toScreen(p.x + 0.5, p.z + 0.5); ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    if (state.mdim === 0 && state.mset.hub.chunk) {
      const [cx, cz] = state.mset.hub.chunk; const [ax, ay] = toScreen(cx * 16, cz * 16); const cs = 16 * s;
      const sts = hp.stations;
      if (sts.length) { const xs = sts.map(t => t.x), zs = sts.map(t => t.z); const [bx, by] = toScreen(Math.min(...xs) - 1, Math.min(...zs) - 1), [ex, ey] = toScreen(Math.max(...xs) + 2, Math.max(...zs) + 3); ctx.fillStyle = 'rgba(185,133,56,.55)'; ctx.fillRect(bx, by, ex - bx, ey - by); }
      ctx.lineWidth = 2.5; ctx.strokeStyle = css('--oak'); ctx.strokeRect(ax, ay, cs, cs);
      ctx.font = '700 13px ' + css('--display'); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText('Hub').width; ctx.fillStyle = css('--oak'); ctx.fillRect(ax, ay - 20, tw + 12, 20); ctx.fillStyle = '#fffaf0'; ctx.fillText('Hub', ax + 6, ay - 4);
    }
  }
  if (state.edrag) {
    const r = state.edrag; const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]) + 1, z0 = Math.min(r[1], r[3]), z1 = Math.max(r[1], r[3]) + 1;
    const [ax, ay] = toScreen(x0 * 16, z0 * 16), [bx, by] = toScreen(x1 * 16, z1 * 16); const cs = 16 * s;
    for (const { g, list } of chunksInRect(r)) {
      const D = g.world.dims[g.dim]; const dx = g.ox - g.minX, dz = g.oz - g.minZ;
      for (const [x, z] of list) { const c = D.index.get(x + ',' + z); const [sx, sy] = toScreen((x + dx) * 16, (z + dz) * 16); ctx.fillStyle = c && c.score > 0 ? 'rgba(207,63,53,.75)' : 'rgba(255,255,255,.45)'; ctx.fillRect(sx, sy, cs, cs); }
    }
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.setLineDash([]);
  }
  if (state.mdim === 0) {
    const oh = origHub(); if (oh) { const [ox, oy] = toScreen(oh.x, oh.z); ctx.fillStyle = css('--oak'); ctx.fillRect(ox - 6, oy - 6, 12, 12); ctx.font = '700 12px ' + css('--display'); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('Original hub', ox + 10, oy); }
    const sp = museumSpawn(); if (sp.group || sp.hub) {
      const [sx, sy] = toScreen(sp.x, sp.z);
      ctx.beginPath(); ctx.moveTo(sx, sy - 10); ctx.lineTo(sx + 8, sy + 6); ctx.lineTo(sx - 8, sy + 6); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
    }
  }
}
function groupAt(sx, sy) {
  const [x, z] = toWorld(sx, sy); const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  const gs = groups.filter(g => g.dim === state.mdim);
  for (let i = gs.length - 1; i >= 0; i--) { const g = gs[i]; if (g.backdrop) continue; const k = (cx - g.ox + g.minX) + ',' + (cz - g.oz + g.minZ); if (g.set.has(k) && (g.active === g.chunks || g.active.some(([x, z]) => x + ',' + z === k))) return g; }
  return null;
}
function fitMuseum() {
  const gs = groups.filter(g => g.dim === state.mdim); if (!gs.length) return;
  const minX = Math.min(...gs.map(g => g.ox)) * 16 - 64, minZ = Math.min(...gs.map(g => g.oz)) * 16 - 64;
  const maxX = Math.max(...gs.map(g => g.ox + g.maxX - g.minX + 1)) * 16 + 64, maxZ = Math.max(...gs.map(g => g.oz + g.maxZ - g.minZ + 1)) * 16 + 64;
  const r = mapRect();
  state.view.s = Math.max(0.02, Math.min(4, Math.min(r.w / (maxX - minX), r.h / (maxZ - minZ)) * 0.85));
  state.view.x = (minX + maxX) / 2; state.view.z = (minZ + maxZ) / 2;
  const off = panelOffset(); state.view.x += off.x / state.view.s; state.view.z += off.z / state.view.s;
}
function enterMuseum() {
  const total = state.worlds.reduce((n, W) => n + (W.exhibits || []).length, 0);
  if (!total) { toast('Keep at least one place first: use Draw area on a world’s map.', 3500); return; }
  setMode(null); hidePop();
  state.museum = true; state.built = null;
  layout(false);
  state.mdim = groups.some(g => g.dim === 0) ? 0 : groups[0].dim;
  document.body.classList.add('museum');
  setMTab(isMobile() ? 'map' : 'museum'); updateUndo(); saveView();
  syncMuseumBar(); fitMuseum(); renderMuseum(); draw();
  const r = mapRect(); requestAnimationFrame(() => readout(r.w / 2, r.h / 2));
}
function exitMuseum() {
  if (state.erase) setErase(false);
  state.museum = false; setTimeout(updateUndo, 0); document.body.classList.remove('museum');
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => selectDim(+b.dataset.dim, true));
  selectWorld(state.w); setMTab(isMobile() ? 'map' : 'exhibits'); saveView();
}
function syncMuseumBar() {
  document.querySelectorAll('.seg button').forEach(b => {
    const d = +b.dataset.dim; const has = groups.some(g => g.dim === d);
    b.disabled = !has; b.setAttribute('aria-pressed', d === state.mdim);
    b.onclick = () => { state.mdim = d; syncMuseumBar(); fitMuseum(); draw(); saveView(); };
  });
}
$('#arrangeBtn').onclick = enterMuseum;
// Erase: drag a rectangle on the museum map to remove those chunks from whichever exhibits sit there.
state.erase = false; state.edrag = null;
function setErase(on) {
  state.erase = on; const b = $('#eraseBtn'); b.setAttribute('aria-pressed', on); b.textContent = on ? 'Done erasing' : 'Erase area';
  if (on) { toMap(); toast('Drag across exhibits to erase. Chunks with builds show in red while you drag.'); } else toast('');
  draw();
}
$('#eraseBtn').onclick = () => setErase(!state.erase);
function chunksInRect(r) { // placed chunks under a museum-space chunk rectangle, per group
  const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), z0 = Math.min(r[1], r[3]), z1 = Math.max(r[1], r[3]);
  const hits = [];
  for (const g of groups) {
    if (g.dim !== state.mdim || g.backdrop) continue;
    const dx = g.ox - g.minX, dz = g.oz - g.minZ; const list = [];
    for (const [x, z] of g.active) { const X = x + dx, Z = z + dz; if (X >= x0 && X <= x1 && Z >= z0 && Z <= z1) list.push([x, z]); }
    if (list.length) hits.push({ g, list, src: [x0 - dx, z0 - dz, x1 - dx, z1 - dz] });
  }
  return hits;
}
function finishErase(r) {
  const hits = chunksInRect(r);
  if (!hits.length) { toast('Nothing to erase there.', 1800); return; }
  museumSnapshot();
  let n = 0;
  for (const { g, list, src } of hits) {
    const e = g.exhibit; e.erase = e.erase || []; e.erase.push(src); n += list.length;
    e.fp = null; savePlan(g.world);
  }
  state.built = null; layout(false); renderMuseum(); renderExhibits(); draw();
  toast(`Erased ${n} chunk${n === 1 ? '' : 's'}.`, 4000, true);
}
window.__wm.group = i => { const g = groups[i]; return { main: toScreen((g.ox + (g.solid[0][0] - g.minX)) * 16 + 8, (g.oz + (g.solid[0][1] - g.minZ)) * 16 + 8), id: g.id, s: state.view.s }; }; // tests
$('#backBtn').onclick = exitMuseum;

function renderMuseum() {
  const pane = $('#pane-museum'); const S = state.settings, M = state.mset;
  let chunks = 0, bytes = 0, dropped = 0, droppedBuilt = 0, covered = 0, coveredBuilt = 0;
  for (const g of groups) { chunks += g.active.length; bytes += g.active.length * g.world.bytesPerChunk; if (g.backdrop) { covered += g.dropped; coveredBuilt += g.droppedBuilt; } else { dropped += g.dropped; droppedBuilt += g.droppedBuilt; } }
  const nEx = groups.filter(g => !g.backdrop).length;
  const worldsUsed = [...new Set(groups.filter(g => !g.backdrop).map(g => g.world))];
  const ver = W => (W.levelVersion || []).map(n => String(n).padStart(5, '0')).join('.');
  const base = backdropW() || worldsUsed.slice().sort((a, b) => ver(b).localeCompare(ver(a)))[0];
  const ow = groups.filter(g => g.dim === 0);
  const sp = spawnFor();
  pane.innerHTML = `
    <h2>Arrange your museum</h2>
    <p class="hint">Drag exhibits to move them. Everything outside them becomes the surroundings you choose below.</p>
    <label class="rng" style="grid-template-columns:1fr">World name<input id="m-name" class="search" style="margin:4px 0 0" value="${esc(M.name)}" maxlength="60"></label>
    ${backdropW() ? backdropHTML(M) : `    <label class="rng" style="grid-template-columns:1fr">Surroundings<select id="m-sur" class="search" style="margin:4px 0 0">${Object.entries(SUR).map(([k, v]) => `<option value="${k}" ${M.surround === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
    <p class="small" style="margin:4px 0 0">${SUR[M.surround][1]}</p>
    ${B.CUT_KINDS.has(M.surround) ? `<label class="check"><input id="m-cut" type="checkbox" ${M.cutEdges ? 'checked' : ''}> Cut edges as smooth curves, block by block</label>
      <p class="small" style="margin:4px 0 0">Trims a few blocks from the outermost chunks so outlines curve instead of stepping in 16-block squares. Columns with anything crafted in them are never cut. Caves and tunnels crossing the curve get sealed.</p>
      ${M.cutEdges ? `<label class="rng">Edge texture <output>${['Smooth', 'Natural', 'Rugged'][M.rough]}</output><input id="m-rough" type="range" min="0" max="2" value="${M.rough}"></label>` : ''}`
      : M.surround !== 'seed' ? '<p class="small" style="margin:6px 0 0">Curved, block-by-block edges are available with Ocean, Warm ocean, Desert and Void.</p>' : ''}
    ${M.surround === 'void' ? '<p class="warn">A fall off the edge is a fall forever, and anything you drop is gone. Mobs only spawn on the exhibits themselves.</p>' : ''}
    ${M.surround === 'seed' ? `<p class="warn">Minecraft will generate ordinary landscape right up to each exhibit’s edges, with no blending. Expect cliffs, sliced hills, and terrain that buries or strands parts of exhibits. The gaps between exhibits fill with that terrain too.</p>
      <label class="rng" style="grid-template-columns:1fr">Seed from<select id="m-seedfrom" class="search" style="margin:4px 0 0">
        ${worldsUsed.map(W => `<option value="${esc(worldKey(W))}" ${M.seedFrom === worldKey(W) ? 'selected' : ''}>${esc(W.name)}</option>`).join('')}
        <option value="" ${!M.seedFrom ? 'selected' : ''}>Type a seed</option></select></label>
      ${!M.seedFrom ? `<input id="m-seedtext" class="search" inputmode="numeric" placeholder="For example 1234567890" value="${esc(M.seedText || '')}" aria-label="Seed">` : ''}
      ${seedWorld() ? `<label class="check"><input id="m-pin" type="checkbox" ${M.pin ? 'checked' : ''}> Leave ${esc(seedWorld().name)}’s exhibits at their original spots, so the land around them matches the original world</label>
        <p class="small" style="margin:4px 0 0">Pinned exhibits can’t be dragged. Worlds first created before Minecraft 1.18 (late 2021) generate different terrain today, so their surroundings won’t match.</p>` : ''}
      ${seedProblem() ? `<p class="err">${esc(seedProblem())}</p>` : ''}` : ''}`}
    <label class="rng">Gap between exhibits <output>${S.gap} chunk${S.gap === 1 ? '' : 's'}</output><input id="m-gap" type="range" min="1" max="8" value="${S.gap}"></label>
    <p class="small" style="margin:6px 0 0">Where exhibits meet, the bigger landmass wins: smaller pieces lose any chunks that would overlap it or sit within the gap. Exhibits that lost chunks have dashed outlines.</p>
    <div class="exbtns"><button id="m-repack">Re-pack automatically</button></div>
    ${!M.hub.on && ow.filter(g => g.active.length).length ? `<label class="rng" style="grid-template-columns:1fr">Start the world at<select id="m-spawn" class="search" style="margin:4px 0 0">${ow.filter(g => g.active.length).map(g => `<option value="${esc(g.id)}" ${sp.group === g ? 'selected' : ''}>${esc(g.world.name)}: ${esc(g.name)}</option>`).join('')}</select></label>` : ''}
    <label class="check"><input id="m-player" type="checkbox" ${M.keepPlayer ? 'checked' : ''}> Bring my player and inventory from ${esc(base ? base.name : 'the newest world')}, and make every tamed pet mine</label>
    ${waitingWorlds().length ? `<p class="warn">Not loaded: ${waitingWorlds().map(w => esc(w.name)).join(', ')}. ${waitingWorlds().length === 1 ? 'Its exhibits are' : 'Their exhibits are'} saved but left out of this build. <button id="m-addzips">Add ZIPs</button></p>` : ''}
    <div class="total">${backdropW() ? 'Backdrop plus ' : ''}${nEx} exhibit${nEx === 1 ? '' : 's'}, ${chunks.toLocaleString()} chunks, about ${mb(bytes)}</div>
    ${covered ? `<p class="warn">New exhibits cover ${covered.toLocaleString()} chunk${covered === 1 ? '' : 's'} of the backdrop${coveredBuilt ? `, <b>including ${coveredBuilt} with building evidence</b>` : ''}.</p>` : ''}
    ${dropped ? `<p class="warn">${dropped.toLocaleString()} chunk${dropped === 1 ? '' : 's'} left out where exhibits meet${droppedBuilt ? `, <b>including ${droppedBuilt} with building evidence</b>` : ''}.</p>` : ''}
    ${groups.some(g => g.dim !== 0) ? '<p class="small">Nether and End exhibits go into the museum’s Nether and End. New terrain there generates normally.</p>' : ''}
    <h3>Transporter hub</h3>
    <label class="check" style="margin-top:0"><input id="m-hub" type="checkbox" ${M.hub.on ? 'checked' : ''}> Build a transporter hub: a button to every destination, and a “Back to the hub” button at each one</label>
    ${M.hub.on ? (() => { const hp = hubPlan(); return `
      <div class="exbtns"><button id="m-placehub" ${state.placingHub ? 'aria-pressed="true"' : ''}>${M.hub.chunk ? 'Move the hub' : 'Place the hub'}</button>${origHub() ? `<button id="m-placelink">${M.hub.link ? 'Move the link station' : 'Place the link station'}</button>` : ''}</div>
      ${origHub() ? `<p class="small" style="margin:6px 0 0">The backdrop already has a hub. This one is separate: it gets a station leading back to the original, and the original gets one station leading here${M.hub.link ? '' : ', beside its arrival point unless you place it'}.</p>` : ''}
      <p class="small" style="margin:6px 0 0">${M.hub.chunk ? `The hub is at X ${hp.spawn ? hp.spawn.x : M.hub.chunk[0] * 16}, Z ${hp.spawn ? hp.spawn.z : M.hub.chunk[1] * 16}${hp.blocks.some(b => b.kind === 'stone') ? ', on a stone platform' : ''}${backdropW() ? '. Your spawn stays where it was' : ', and the world starts there'}.` : 'Not placed yet.'} Signs in the world show the destination names.</p>
      ${worldsUsed.map(W => `<label class="rng" style="grid-template-columns:1fr">${esc(W.name)}<select class="search" style="margin:4px 0 0" data-pick="${esc(worldKey(W))}">${[['both', 'Spawn and last visited'], ['last', 'Last visited'], ['spawn', 'Spawn']].map(([v, t]) => `<option value="${v}" ${(M.hub.picks[worldKey(W)] || 'both') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`).join('')}
      <p class="small" style="margin:6px 0 0">${hp.dests.length} destination${hp.dests.length === 1 ? '' : 's'}${hp.dests.some(d => d.kind === 'centre') ? ', including the centre of each exhibit that holds neither point' : ''}.${hp.missing.length ? ` ${hp.missing.map(r => `${esc(r.world)} ${r.kind === 'last' ? 'last visited' : 'spawn'}`).join(', ')} ${hp.missing.length === 1 ? 'isn’t' : 'aren’t'} in anything you kept, so ${hp.missing.length === 1 ? 'it gets' : 'they get'} no button.` : ''}${hp.padless ? ` ${hp.padless} destination${hp.padless === 1 ? ' has' : 's have'} no room for a return pad inside ${hp.padless === 1 ? 'its' : 'their'} exhibit.` : ''}</p>
      ${hp.problems.map(p => `<p class="err">${esc(p)}</p>`).join('')}
      <p class="small" style="margin:6px 0 0">Command blocks need cheats, so the hub turns them on. Anyone can press the buttons, even in survival. Stations replace whatever blocks were in those spots.</p>`; })() : ''}
    <label class="check"><input id="m-cheats" type="checkbox" ${M.cheats || M.hub.on ? 'checked' : ''} ${M.hub.on ? 'disabled' : ''}> Turn on cheats, so the directory’s teleport commands work${M.hub.on ? ' (needed by the hub)' : ''}</label>
    <p class="small" style="margin:4px 0 0">Minecraft turns off achievements for worlds with cheats.</p>
    ${preBuildSummaryHTML()}
    <div class="exbtns"><button class="primary" id="m-build" ${seedProblem() || (M.hub.on && hubPlan().problems.length) ? 'disabled' : ''}>Build the world</button></div>
    <div id="m-progress" class="progress"></div>
    <div id="m-result"></div>
    <h3>Directory</h3>
    <p class="small" style="margin:0 0 6px">Where everything is in the museum. Tap a row to copy its teleport command. The list is also saved inside the world as museum-directory.txt.</p>
    <div id="m-dir">${directory().map((r, i) => r.missing
      ? `<div class="sign" style="cursor:default"><b>${esc(r.label)}</b><span>${esc(r.world)}: ${r.covered ? 'entirely covered by a bigger exhibit' : 'not kept in the museum'}</span></div>`
      : `<button class="sign" data-dir="${i}"><b>${esc(r.label)}</b><span>${r.world ? esc(r.world) + ', ' : ''}${['Overworld', 'Nether', 'End'][r.dim]}, X ${r.x} Y ${r.y}${r.approxY ? '?' : ''} Z ${r.z}</span></button>`).join('')}</div>
    <div class="exbtns"><button id="m-copyall">Copy the whole list</button><button id="m-savedir">Save as text</button></div>
    <h3>Plan file</h3>
    <p class="small" style="margin:0 0 6px">Every choice you’ve made, without the worlds: a backup, or a way to move this museum to another device.</p>
    <div class="exbtns"><button id="m-saveplan">Save plan file</button><button id="m-openplan">Open plan file</button></div>
    <h3>Exhibits</h3>
    ${groups.filter(g => !g.backdrop).map(g => `<div class="place"><button class="sign pfly" style="border:0" data-g="${esc(g.id)}"><b>${esc(g.name)}${g.top ? ' (on top)' : ''}</b><span>${esc(g.world.name)}, ${DN[g.dim]}, ${g.active.length.toLocaleString()} chunks${!g.active.length ? ', entirely covered by a bigger exhibit' : g.dropped ? `, ${g.dropped} left out where it meets others${g.droppedBuilt ? ` (${g.droppedBuilt} with builds)` : ''}` : ''}</span></button><button class="keep" data-top="${esc(g.id)}" aria-pressed="${g.top}">${g.top ? 'On top' : 'Bring to top'}</button></div>`).join('')}
  `;
  if ($('#m-sur')) $('#m-sur').onchange = ev => {
    M.surround = ev.target.value; state.built = null;
    if (M.surround === 'seed' && M.seedFrom === undefined) M.seedFrom = '';
    if (M.surround === 'seed' && !M.seedFrom && !M.seedText && worldsUsed[0]) M.seedFrom = worldKey(worldsUsed[0]);
    saveArrange(); layout(false); renderMuseum(); draw();
  };
  if ($('#m-cut')) $('#m-cut').onchange = ev => { M.cutEdges = ev.target.checked; state.built = null; saveArrange(); renderMuseum(); draw(); };
  if ($('#m-rough')) $('#m-rough').oninput = ev => { M.rough = +ev.target.value; ev.target.previousElementSibling.textContent = ['Smooth', 'Natural', 'Rugged'][M.rough]; state.built = null; saveArrange(); draw(); };
  if ($('#m-seedfrom')) $('#m-seedfrom').onchange = ev => { M.seedFrom = ev.target.value; state.built = null; saveArrange(); layout(false); fitMuseum(); renderMuseum(); draw(); };
  if ($('#m-seedtext')) $('#m-seedtext').onchange = ev => { M.seedText = ev.target.value.trim(); state.built = null; saveArrange(); renderMuseum(); };
  if ($('#m-pin')) $('#m-pin').onchange = ev => { M.pin = ev.target.checked; state.built = null; saveArrange(); layout(false); fitMuseum(); renderMuseum(); draw(); };
  $('#m-name').onchange = ev => { M.name = ev.target.value.trim() || 'World Museum'; saveArrange(); };
  $('#m-gap').oninput = ev => { S.gap = +ev.target.value; ev.target.previousElementSibling.textContent = `${S.gap} chunk${S.gap === 1 ? '' : 's'}`; saveSettings(); };
  $('#m-gap').onchange = () => { state.built = null; layout(true); fitMuseum(); renderMuseum(); draw(); };
  $('#m-repack').onclick = () => { museumSnapshot(); state.built = null; layout(true); fitMuseum(); renderMuseum(); draw(); toast('Re-packed.', 1500); };
  if ($('#m-spawn')) $('#m-spawn').onchange = ev => { M.spawnGroup = ev.target.value; saveArrange(); draw(); };
  $('#m-player').onchange = ev => { M.keepPlayer = ev.target.checked; saveArrange(); };
  $('#m-build').onclick = runBuild;
  $('#m-saveplan').onclick = savePlanFile; $('#m-openplan').onclick = () => $('#planInput').click();
  if ($('#m-addzips')) $('#m-addzips').onclick = () => $('#zipInput').click();
  $('#m-hub').onchange = ev => { museumSnapshot(); M.hub.on = ev.target.checked; hubCache = null; state.built = null; saveArrange(); renderMuseum(); draw(); if (M.hub.on && !M.hub.chunk) startPlacingHub(); };
  if ($('#m-placehub')) $('#m-placehub').onclick = startPlacingHub;
  pane.querySelectorAll('[data-pick]').forEach(sel => sel.onchange = () => { museumSnapshot(); M.hub.picks[sel.dataset.pick] = sel.value; hubCache = null; state.built = null; saveArrange(); renderMuseum(); draw(); });
  $('#m-cheats').onchange = ev => { M.cheats = ev.target.checked; state.built = null; saveArrange(); };
  const rows = directory();
  pane.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => copyText(tpCmd(rows[+b.dataset.dir]), 'Teleport command copied.'));
  $('#m-copyall').onclick = () => copyText(directoryText(rows), 'Directory copied.');
  $('#m-savedir').onclick = () => saveBlob(new Blob([directoryText(rows)], { type: 'text/plain' }), (state.mset.name || 'World Museum') + ' directory', 'txt');
  pane.querySelectorAll('[data-top]').forEach(b => b.onclick = () => {
    const g = groups.find(x => x.id === b.dataset.top); if (!g || !g.exhibit) return;
    museumSnapshot(); g.exhibit.top = !g.exhibit.top; savePlan(g.world); state.built = null; layout(false); renderMuseum(); draw();
  });
  if ($('#m-nobd')) $('#m-nobd').onclick = () => { museumSnapshot(); state.mset.backdrop = null; state.built = null; saveArrange(); layout(false); fitMuseum(); renderMuseum(); draw(); toast('The backdrop is now an ordinary world again.', 4000, true); };
  if ($('#m-placelink')) $('#m-placelink').onclick = startPlacingLink;
  pane.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
    const g = groups.find(x => x.id === b.dataset.g); state.selGroup = g.id; toMap();
    if (state.mdim !== g.dim) { state.mdim = g.dim; syncMuseumBar(); }
    const span = Math.max(g.maxX - g.minX + 1, g.maxZ - g.minZ + 1) * 16 + 64; const r = mapRect();
    flyTo((g.ox + (g.maxX - g.minX + 1) / 2) * 16, (g.oz + (g.maxZ - g.minZ + 1) / 2) * 16, Math.max(0.05, Math.min(4, Math.min(r.w, r.h) * 0.6 / span)));
  });
  if (state.built) showResult(state.built);
}
// What the build will keep, trim and leave out, before it runs. The same notes go into the report.
function preBuildNotes() {
  const notes = []; const N = (sev, code, title, detail, count, example) => notes.push({ sev, code, title, detail, count, example });
  let trimmed = 0, erased = 0;
  for (const g of groups) if (g.exhibit) { const fp = footprint(g.world, g.exhibit); trimmed += fp.trimmed || 0; erased += fp.erased || 0; }
  if (trimmed) N('info', 'trimmed', 'Fringe chunks trimmed by edge smoothing', 'Half-explored chunks at exhibit edges, none holding building evidence.', trimmed);
  if (erased) N('info', 'erased', 'Chunks you erased', 'Removed with Erase area on the museum map.', erased);
  for (const g of groups) if (!g.backdrop && g.dropped) {
    N(g.droppedBuilt ? 'warn' : 'info', g.droppedBuilt ? 'overlap-built' : 'overlap', g.droppedBuilt ? 'Chunks with builds left out where exhibits meet' : 'Chunks left out where exhibits meet', g.droppedBuilt ? 'A bigger or on-top exhibit took priority over chunks holding building evidence.' : 'A bigger or on-top exhibit took priority.', g.dropped, `${g.world.name}: ${g.name}, ${g.dropped}${g.droppedBuilt ? ` (${g.droppedBuilt} with builds)` : ''}`);
  }
  for (const g of groups) if (g.backdrop && g.dropped) N(g.droppedBuilt ? 'warn' : 'info', 'backdrop-covered', 'Backdrop chunks covered by new exhibits', g.droppedBuilt ? 'Some of the covered chunks hold building evidence.' : 'Blank backdrop replaced by new exhibits.', g.dropped, `${g.dropped}${g.droppedBuilt ? `, ${g.droppedBuilt} with builds` : ''}`);
  for (const w of waitingWorlds()) N('info', 'not-loaded', 'Worlds not loaded', 'Their exhibits are saved but left out of this build.', 1, w.name);
  if (!state.mset.keepPlayer) N('info', 'no-player', 'Player not carried over', 'You chose to arrive as a new player.', 1);
  return notes;
}
function preBuildSummaryHTML() {
  const ex = groups.filter(g => !g.backdrop); const worlds = new Set(ex.map(g => g.world));
  const kept = groups.reduce((n, g) => n + g.active.length, 0);
  const notes = preBuildNotes();
  const flags = { heights: cutsOn() || (state.mset.hub.on && !!state.mset.hub.chunk), commandVersion: state.mset.hub.on, hubBlocks: state.mset.hub.on, signFormat: state.mset.hub.on, voidLayers: surKind() === 'void' && !backdropW(), actorIds: worlds.size > 1, metaDict: worlds.size > 1, newChunks: !!(state.mset.hub.on && hubPlan() && hubPlan().blocks.some(b => b.kind === 'stone')) };
  const assumptions = B.assumptionsFor(flags);
  const sum = c => notes.filter(n => n.code === c).reduce((t, n) => t + n.count, 0);
  const lines = [
    `${backdropW() ? 'Backdrop plus ' : ''}${ex.length} exhibit${ex.length === 1 ? '' : 's'} from ${worlds.size} world${worlds.size === 1 ? '' : 's'}`,
    `${kept.toLocaleString()} chunks kept`,
    sum('trimmed') ? `${sum('trimmed').toLocaleString()} fringe chunks trimmed by smoothing` : '',
    sum('erased') ? `${sum('erased').toLocaleString()} chunks erased` : '',
    `${(sum('overlap') + sum('overlap-built')).toLocaleString()} chunks left out where exhibits meet`,
    (sum('overlap') + sum('overlap-built')) ? `${ex.reduce((t, g) => t + g.droppedBuilt, 0)} of them holding detected builds` : '',
    sum('backdrop-covered') ? `${sum('backdrop-covered').toLocaleString()} backdrop chunks covered` : '',
  ].filter(Boolean);
  const warns = notes.filter(n => n.sev === 'warn').length + assumptions.length;
  return `<div class="ex" style="background:var(--panel)"><div class="ptitle">Museum ready to build</div>
    <ul class="sumlist">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="small" style="margin:6px 0 0">${warns ? `${warns} thing${warns === 1 ? '' : 's'} to note: ${[...notes.filter(n => n.sev === 'warn').map(n => n.title), ...assumptions.map(a => a.title)].map(esc).join(', ')}. ` : ''}After building, the tool re-reads the finished world and reports anything that didn’t survive.</p></div>`;
}
async function runBuild() {
  const btn = $('#m-build'); btn.disabled = true;
  const prog = $('#m-progress'); $('#m-result').innerHTML = '';
  prog.innerHTML = '<div class="prow"><div id="m-msg">Starting</div><div class="bar-o"><div class="bar-i" id="m-bar"></div></div></div>';
  const sp = museumSpawn();
  const plan = {
    name: state.mset.name, keepPlayer: state.mset.keepPlayer, spawn: { x: sp.x, y: sp.y, z: sp.z },
    notes: preBuildNotes(), backdrop: backdropW(), marker: museumMarker(), surround: { kind: surKind(), seedWorld: seedWorld(), seedText: state.mset.seedText }, cutEdges: cutsOn(), rough: state.mset.rough, cheats: state.mset.cheats || state.mset.hub.on, structures: state.mset.hub.on ? { blocks: hubPlan().blocks } : null, directoryText: directoryText(directory()),
    groups: groups.map(g => ({ id: g.id, backdrop: !!g.backdrop, world: g.world, dim: g.dim, chunks: g.active, offset: [g.ox - g.minX, g.oz - g.minZ] }))
  };
  const t0 = performance.now();
  // free map images before the heavy lifting; they rebuild on demand
  state.built = null;
  for (const W of state.worlds) { W.tiles.clear(); W.overview = {}; }
  await new Promise(r => setTimeout(r, 50));
  try {
    const res = await B.buildMuseum(plan, (msg, f) => { $('#m-msg').textContent = msg; $('#m-bar').style.width = Math.round((f || 0) * 100) + '%'; });
    res.seconds = (performance.now() - t0) / 1000;
    state.built = res; prog.innerHTML = ''; showResult(res);
  } catch (e) {
    console.error(e);
    prog.innerHTML = `<p class="err">The build stopped: ${esc(e.message || e)}. Your plan is unchanged; try again, or send me this message.</p>`;
  }
  btn.disabled = false;
}
function showResult(res) {
  const r = res.report;
  const P = r.preservation || { totals: { error: 0, warn: 0, info: 0 }, items: [] }; const T = P.totals;
  const sevName = { error: 'Preservation loss', warn: 'Warning', info: 'Information' };
  $('#m-result').innerHTML = `<div class="ex on" style="background:var(--panel)">
    <div class="ptitle">Ready: ${esc(state.mset.name)}</div>
    <div class="verdict ${T.error ? 'bad' : 'good'}">${T.error ? `${T.error} preservation problem${T.error === 1 ? '' : 's'}: something meant to be kept didn’t make it. Keep your original worlds.` : (P.verify && P.verify.ok ? 'Self-check passed: no preservation loss found.' : 'No preservation loss found.')}</div>
    <p class="small" style="margin:4px 0 6px">${T.warn} warning${T.warn === 1 ? '' : 's'}, ${T.info} note${T.info === 1 ? '' : 's'}. Warnings mean unfamiliar data or parts of the format not yet confirmed in Minecraft; they don’t mean the build failed.</p>
    <details class="report"><summary>Full report</summary>${P.items.map(i => `<div class="ri ${i.sev}"><b>${sevName[i.sev]}: ${esc(i.title)}${i.count > 1 ? ` (${i.count.toLocaleString()})` : ''}</b><div>${esc(i.detail)}</div>${i.examples.length ? `<div class="small">e.g. ${i.examples.map(esc).join('; ')}</div>` : ''}</div>`).join('')}</details>
    <div class="pmeta">${r.chunks.toLocaleString()} chunks, ${r.blockEntities ? r.blockEntities.toLocaleString() + ' chunks with signs, chests and other block data, ' : ''}${r.actors} mob${r.actors === 1 ? '' : 's'} and object${r.actors === 1 ? '' : 's'}, ${mb(r.bytes)}. ${r.cutColumns ? `Edges curved: ${r.cutColumns.toLocaleString()} block columns trimmed${r.protectedColumns ? `, ${r.protectedColumns.toLocaleString()} left alone because they hold built blocks` : ''}. ` : ''}${state.mset.hub.on ? `Transporter hub with ${hubPlan().stations.length} destination${hubPlan().stations.length === 1 ? '' : 's'} and ${hubPlan().pads.length} return pad${hubPlan().pads.length === 1 ? '' : 's'}${r.placeFailures ? ` (${r.placeFailures} blocks couldn’t be placed)` : ''}. ` : ''}Surroundings: ${esc(SUR[r.surround] ? SUR[r.surround][0] : 'Ocean')}${r.seed !== null ? ` (seed ${esc(r.seed)})` : ''}. Settings come from ${esc(r.base)}${r.player ? ', and so do you' : ''}.</div>
    <div class="exbtns"><button class="primary" id="m-save">Save the world</button><button id="m-savereport">Save report</button></div>
    <p class="small" style="margin:6px 0 0">The report is also saved inside the world, as museum-report.txt and museum-report.json.</p>
    ${r.storage === 'memory' && r.bytes > 100e6 ? '<p class="small">This is a big file and this browser had to keep it in memory. If saving fails, build it on a computer, or from the GitHub copy of the tool opened in Safari.</p>' : ''}
    <p class="small" id="m-saved"></p>
  </div>`;
  $('#m-save').onclick = () => saveWorld(res.blob);
  $('#m-savereport').onclick = () => saveBlob(new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' }), (state.mset.name || 'World Museum') + ' report', 'json');
}
async function saveBlob(blob, base, ext) {
  const safe = base.replace(/[\\/:*?"<>|]+/g, '').trim() || 'World Museum';
  const dl = await dlReady;
  if (dl) { try { await dl.save({ filename: safe + '.' + ext, data: blob }); toast('Saved.', 1500); } catch (e) { if (!(e && e.code === 'declined')) toast('Saving isn’t available here.', 2500); } return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = safe + '.' + ext;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function saveWorld(blob) {
  const safe = (state.mset.name || 'World Museum').replace(/[\\/:*?"<>|]+/g, '').trim() || 'World Museum';
  const note = $('#m-saved');
  const dl = await dlReady;
  if (dl) {
    try {
      await dl.save({ filename: safe + '.zip', data: blob });
      note.innerHTML = `Saved as <b>${esc(safe)}.zip</b>. To open it in Minecraft on iPhone: in Files, rename it to end in <b>.mcworld</b> instead of .zip, then tap it. Or tap the ZIP to unpack it and move the folder into Minecraft’s minecraftWorlds folder.`;
    } catch (e) {
      note.textContent = e && e.code === 'declined' ? 'Not saved. Tap Save the world again whenever you’re ready.' : e && e.code === 'rate_limited' ? 'A save prompt is already open.' : 'Saving isn’t available in this view. Open the page in a browser to save.';
    }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = safe + '.mcworld';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  note.innerHTML = `Downloaded <b>${esc(safe)}.mcworld</b>. Open it to import into Minecraft.`;
}
