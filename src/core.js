/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
/* World Museum — core reader. No DOM; runs in browsers and Node 18+. */
const MuseumCore = (() => {
  'use strict';
  const utf8 = new TextDecoder('utf-8');

  // ---------- small helpers
  async function inflate(u8, format) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const yieldToUI = () => new Promise(r => setTimeout(r, 0));
  function concat(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function i32(u8, p) { return (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)); }
  function u32(u8, p) { return i32(u8, p) >>> 0; }
  function hex(u8) { let s = ''; for (const b of u8) s += (b < 16 ? '0' : '') + b.toString(16); return s; }
  function ascii(u8, start, len) { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(u8[start + i]); return s; }

  // ---------- virtual file systems (ZIP or picked folder)
  async function openZip(blob) {
    const size = blob.size;
    const tailLen = Math.min(size, 65557);
    const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a ZIP archive.');
    const dv = new DataView(tail.buffer);
    let count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xFFFFFFFF || count === 0xFFFF || cdSize === 0xFFFFFFFF) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(loc + 8, true));
        const z = new DataView(await blob.slice(z64, z64 + 56).arrayBuffer());
        count = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true));
      }
    }
    const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const cdv = new DataView(cd.buffer);
    const entries = new Map();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cdv.getUint32(p, true) !== 0x02014b50) break;
      const method = cdv.getUint16(p + 10, true);
      let csize = cdv.getUint32(p + 20, true), usize = cdv.getUint32(p + 24, true);
      const nlen = cdv.getUint16(p + 28, true), elen = cdv.getUint16(p + 30, true), clen = cdv.getUint16(p + 32, true);
      let lho = cdv.getUint32(p + 42, true);
      const name = utf8.decode(cd.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
      let e = p + 46 + nlen; const eend = e + elen;
      while (e + 4 <= eend) {
        const id = cdv.getUint16(e, true), sz = cdv.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (usize === 0xFFFFFFFF) { usize = Number(cdv.getBigUint64(q, true)); q += 8; }
          if (csize === 0xFFFFFFFF) { csize = Number(cdv.getBigUint64(q, true)); q += 8; }
          if (lho === 0xFFFFFFFF) { lho = Number(cdv.getBigUint64(q, true)); q += 8; }
        }
        e += 4 + sz;
      }
      if (!name.endsWith('/')) entries.set(name, { method, csize, usize, lho });
      p += 46 + nlen + elen + clen;
    }
    return {
      paths: [...entries.keys()],
      size: path => entries.get(path).usize,
      async read(path) {
        const en = entries.get(path);
        const h = new Uint8Array(await blob.slice(en.lho, en.lho + 30).arrayBuffer());
        if (u32(h, 0) !== 0x04034b50) throw new Error('Damaged ZIP entry: ' + path);
        const start = en.lho + 30 + (h[26] | (h[27] << 8)) + (h[28] | (h[29] << 8));
        const raw = new Uint8Array(await blob.slice(start, start + en.csize).arrayBuffer());
        if (en.method === 0) return raw;
        if (en.method === 8) return inflate(raw, 'deflate-raw');
        throw new Error('Unsupported ZIP compression in ' + path + '. Re-zip it with the Files app.');
      }
    };
  }
  function openFileList(files) {
    const map = new Map();
    for (const f of files) map.set((f.webkitRelativePath || f.name).replace(/\\/g, '/'), f);
    return {
      paths: [...map.keys()],
      size: p => map.get(p).size,
      async read(p) { return new Uint8Array(await map.get(p).arrayBuffer()); }
    };
  }
  function findWorlds(fs, sourceName) {
    const worlds = [];
    for (const path of fs.paths) {
      if (path.includes('__MACOSX')) continue;
      if (!(path === 'level.dat' || path.endsWith('/level.dat'))) continue;
      const dir = path.slice(0, path.length - 'level.dat'.length);
      const dbFiles = fs.paths.filter(q => q.startsWith(dir + 'db/') && !q.slice(dir.length + 3).includes('/'));
      if (dbFiles.length) worlds.push({ fs, dir, dbFiles, sourceName });
    }
    return worlds;
  }

  // ---------- little-endian NBT
  function readNBT(u8, off = 0) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = off;
    const str = () => { const n = dv.getUint16(p, true); p += 2; const s = utf8.decode(u8.subarray(p, p + n)); p += n; return s; };
    const payload = t => {
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p, true); p += 2; return v; }
        case 3: { const v = dv.getInt32(p, true); p += 4; return v; }
        case 4: { const v = Number(dv.getBigInt64(p, true)); p += 8; return v; }
        case 5: { const v = dv.getFloat32(p, true); p += 4; return v; }
        case 6: { const v = dv.getFloat64(p, true); p += 8; return v; }
        case 7: { const n = dv.getInt32(p, true); p += 4 + n; return { byteArray: n }; }
        case 8: return str();
        case 9: { const et = u8[p++]; const n = dv.getInt32(p, true); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
        case 10: { const o = {}; for (;;) { const tt = u8[p++]; if (tt === 0) break; const k = str(); o[k] = payload(tt); } return o; }
        case 11: { const n = dv.getInt32(p, true); p += 4; const a = []; for (let i = 0; i < n; i++) { a.push(dv.getInt32(p, true)); p += 4; } return a; }
        case 12: { const n = dv.getInt32(p, true); p += 4 + 8 * n; return { longArray: n }; }
      }
      throw new Error('Unreadable NBT (tag ' + t + ')');
    };
    const t = u8[p++];
    if (t === 0) return { value: null, end: p };
    str();
    return { value: payload(t), end: p };
  }
  function readNBTMany(u8) {
    const out = []; let p = 0;
    while (p < u8.length) { const r = readNBT(u8, p); p = r.end; if (r.value) out.push(r.value); }
    return out;
  }

  // ---------- LevelDB (Mojang flavour: zlib / raw zlib blocks)
  function makeReader(u8, p = 0) {
    return {
      get p() { return p; }, set p(v) { p = v; },
      varint() { let r = 0, mul = 1, b; do { b = u8[p++]; r += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80); return r; },
      bytes(n) { const s = u8.subarray(p, p + n); p += n; return s; },
      str() { return this.bytes(this.varint()); }
    };
  }
  function snappy(src) {
    const r = makeReader(src); const len = r.varint(); let p = r.p;
    const out = new Uint8Array(len); let o = 0;
    while (p < src.length) {
      const tag = src[p++]; const t = tag & 3;
      if (t === 0) {
        let l = tag >>> 2;
        if (l >= 60) { const nb = l - 59; l = 0; for (let i = 0; i < nb; i++) l |= src[p++] << (8 * i); }
        l += 1; out.set(src.subarray(p, p + l), o); p += l; o += l;
      } else {
        let l, off;
        if (t === 1) { l = ((tag >>> 2) & 7) + 4; off = ((tag >>> 5) << 8) | src[p++]; }
        else if (t === 2) { l = (tag >>> 2) + 1; off = src[p] | (src[p + 1] << 8); p += 2; }
        else { l = (tag >>> 2) + 1; off = u32(src, p); p += 4; }
        for (let i = 0; i < l; i++) { out[o] = out[o - off]; o++; }
      }
    }
    return out;
  }
  async function readBlock(u8, off, size, stats) {
    const data = u8.subarray(off, off + size);
    const type = u8[off + size];
    if (type === 0) return data;
    if (type === 2) return inflate(data, 'deflate');
    if (type === 4) return inflate(data, 'deflate-raw');
    if (type === 1) return snappy(data);
    stats.badBlocks++;
    return null;
  }
  function blockEntries(b, cb) {
    const nRestarts = u32(b, b.length - 4);
    const limit = b.length - 4 - 4 * nRestarts;
    const r = makeReader(b);
    let key = new Uint8Array(0);
    while (r.p < limit) {
      const shared = r.varint(), nonShared = r.varint(), vlen = r.varint();
      const k = new Uint8Array(shared + nonShared);
      k.set(key.subarray(0, shared)); k.set(b.subarray(r.p, r.p + nonShared), shared);
      r.p += nonShared;
      const v = b.subarray(r.p, r.p + vlen); r.p += vlen;
      key = k; cb(k, v);
    }
  }
  async function readTable(u8, onRecord, stats) {
    const n = u8.length;
    if (n < 48 || u32(u8, n - 8) !== 0x8b80fb57 || u32(u8, n - 4) !== 0xdb477524) { stats.badFiles++; return; }
    const f = makeReader(u8, n - 48);
    f.varint(); f.varint(); // metaindex handle (filters) — not needed
    const idxOff = f.varint(), idxSize = f.varint();
    const index = await readBlock(u8, idxOff, idxSize, stats);
    if (!index) return;
    const handles = [];
    blockEntries(index, (k, v) => { const r = makeReader(v); handles.push([r.varint(), r.varint()]); });
    for (let i = 0; i < handles.length; i += 48) {
      const batch = handles.slice(i, i + 48);
      const blocks = await Promise.all(batch.map(([o, s]) => readBlock(u8, o, s, stats).catch(() => { stats.badBlocks++; return null; })));
      for (const b of blocks) {
        if (!b) continue;
        blockEntries(b, (k, v) => {
          const L = k.length - 8;
          const lo = u32(k, L), hi = u32(k, L + 4);
          const seq = Math.floor((hi * 4294967296 + lo) / 256);
          onRecord(k.subarray(0, L), seq, (lo & 0xff) === 0, v);
        });
      }
    }
  }
  function logRecords(u8) {
    const out = []; let p = 0, frag = null; const BS = 32768;
    while (p + 7 <= u8.length) {
      const left = BS - (p % BS);
      if (left < 7) { p += left; continue; }
      const len = u8[p + 4] | (u8[p + 5] << 8), type = u8[p + 6];
      if (type === 0) { p += left; continue; }
      const data = u8.subarray(p + 7, p + 7 + len); p += 7 + len;
      if (type === 1) out.push(data);
      else if (type === 2) frag = [data];
      else if (type === 3) { if (frag) frag.push(data); }
      else if (type === 4) { if (frag) { frag.push(data); out.push(concat(frag)); frag = null; } }
    }
    return out;
  }
  function readLog(u8, onRecord, stats) {
    for (const rec of logRecords(u8)) {
      if (rec.length < 12) continue;
      let seq = u32(rec, 0) + u32(rec, 4) * 4294967296;
      const count = u32(rec, 8);
      const r = makeReader(rec, 12);
      try {
        for (let i = 0; i < count && r.p < rec.length; i++, seq++) {
          const t = rec[r.p++];
          const k = r.str();
          if (t === 1) onRecord(k, seq, false, r.str());
          else onRecord(k, seq, true, null);
        }
      } catch (e) { stats.badLogRecords++; }
    }
  }
  function parseManifest(u8) {
    const live = new Set(); let logNumber = 0, prevLog = 0;
    for (const rec of logRecords(u8)) {
      const r = makeReader(rec);
      while (r.p < rec.length) {
        const tag = r.varint();
        if (tag === 1) r.str();
        else if (tag === 2) logNumber = r.varint();
        else if (tag === 3 || tag === 4) r.varint();
        else if (tag === 9) prevLog = r.varint();
        else if (tag === 5) { r.varint(); r.str(); }
        else if (tag === 6) { r.varint(); live.delete(r.varint()); }
        else if (tag === 7) { r.varint(); const num = r.varint(); r.varint(); r.str(); r.str(); live.add(num); }
        else throw new Error('unknown manifest tag ' + tag);
      }
    }
    return { live, logNumber, prevLog };
  }
  async function readLevelDB(world, onRecord, progress) {
    const { fs, dir, dbFiles } = world;
    const stats = { badBlocks: 0, badFiles: 0, badLogRecords: 0, usedManifest: false, tables: 0, logs: 0 };
    const num = p => parseInt(p.slice(p.lastIndexOf('/') + 1), 10);
    let tables = dbFiles.filter(p => /\.(ldb|sst)$/.test(p));
    let logs = dbFiles.filter(p => /\.log$/.test(p) && !/LOG/.test(p.slice(p.lastIndexOf('/') + 1)));
    try {
      const cur = utf8.decode(await fs.read(dir + 'db/CURRENT')).trim();
      const mp = dir + 'db/' + cur;
      if (fs.paths.includes(mp)) {
        const m = parseManifest(await fs.read(mp));
        const filtered = tables.filter(p => m.live.has(num(p)));
        if (filtered.length === m.live.size || filtered.length > 0) {
          tables = filtered;
          logs = logs.filter(p => num(p) >= m.logNumber || num(p) === m.prevLog);
          stats.usedManifest = true;
          stats.missingTables = m.live.size - filtered.length;
        }
      }
    } catch (e) { stats.manifestError = String(e.message || e); }
    const files = [...tables.map(p => ['t', p]), ...logs.map(p => ['l', p])];
    let done = 0; const totalBytes = files.reduce((s, [, p]) => s + (fs.size(p) || 0), 0) || 1;
    for (const [kind, p] of files) {
      const u8 = await fs.read(p);
      if (kind === 't') { await readTable(u8, onRecord, stats); stats.tables++; }
      else { readLog(u8, onRecord, stats); stats.logs++; }
      done += fs.size(p) || 0;
      progress && progress(done / totalBytes);
      await yieldToUI();
    }
    return stats;
  }

  // ---------- Bedrock world interpretation
  const BIOMES = { // id: [name, colour, isWater]
    0: ['Ocean', '#2f5f9e', 1], 1: ['Plains', '#8db360'], 2: ['Desert', '#e3d39a'], 3: ['Windswept hills', '#7f8c7a'],
    4: ['Forest', '#4f7f3a'], 5: ['Taiga', '#3f6b4f'], 6: ['Swamp', '#4c5e3a'], 7: ['River', '#3b6fbf', 1],
    8: ['Nether wastes', '#8a3b2e'], 9: ['The End', '#d8d6a4'], 10: ['Frozen ocean', '#7fa3c9', 1], 11: ['Frozen river', '#9ab8d8', 1],
    12: ['Snowy plains', '#eef2f2'], 13: ['Snowy mountains', '#d8e0e0'], 14: ['Mushroom fields', '#9a7d9e'], 15: ['Mushroom shore', '#a58fa8'],
    16: ['Beach', '#e8dcab'], 17: ['Desert hills', '#d6c68b'], 18: ['Forest hills', '#4a7536'], 19: ['Taiga hills', '#3a6248'],
    20: ['Windswept edge', '#86937f'], 21: ['Jungle', '#3e8a24'], 22: ['Jungle hills', '#3a7f22'], 23: ['Sparse jungle', '#5c9a33'],
    24: ['Deep ocean', '#22487a', 1], 25: ['Stony shore', '#9a9a92'], 26: ['Snowy beach', '#e9e6d4'], 27: ['Birch forest', '#6a9a4a'],
    28: ['Birch hills', '#628f45'], 29: ['Dark forest', '#36572a'], 30: ['Snowy taiga', '#c9d8d0'], 31: ['Snowy taiga hills', '#c2d1c9'],
    32: ['Old growth taiga', '#4d6a3e'], 33: ['Old growth taiga hills', '#47623a'], 34: ['Windswept forest', '#5a7a52'],
    35: ['Savanna', '#b5b05a'], 36: ['Savanna plateau', '#a9a455'], 37: ['Badlands', '#c2683a'], 38: ['Wooded badlands', '#b06a40'],
    39: ['Badlands plateau', '#b8673d'], 40: ['Warm ocean', '#3a86b8', 1], 41: ['Deep warm ocean', '#2c6c96', 1],
    42: ['Lukewarm ocean', '#33739f', 1], 43: ['Deep lukewarm ocean', '#285b82', 1], 44: ['Cold ocean', '#2d5a8c', 1],
    45: ['Deep cold ocean', '#234873', 1], 46: ['Frozen ocean', '#7fa3c9', 1], 47: ['Deep frozen ocean', '#6f92b8', 1],
    48: ['Bamboo jungle', '#4f9a2c'], 49: ['Bamboo hills', '#4a9029'], 129: ['Sunflower plains', '#9bbd62'],
    130: ['Desert lakes', '#dccc90'], 131: ['Gravelly hills', '#80887e'], 132: ['Flower forest', '#5f9044'], 133: ['Taiga mountains', '#3d684c'],
    134: ['Swamp hills', '#4a5a38'], 140: ['Ice spikes', '#d9eef5'], 149: ['Modified jungle', '#3e8a24'], 151: ['Modified jungle edge', '#5c9a33'],
    155: ['Old growth birch', '#6f9f4c'], 156: ['Tall birch hills', '#679448'], 157: ['Dark forest hills', '#34532a'],
    158: ['Snowy taiga mountains', '#c5d4cc'], 160: ['Old growth spruce taiga', '#486538'], 161: ['Giant spruce hills', '#446036'],
    162: ['Gravelly mountains+', '#5a7a52'], 163: ['Windswept savanna', '#a8a04f'], 164: ['Shattered plateau', '#a39d52'],
    165: ['Eroded badlands', '#cc6f3c'], 166: ['Modified wooded badlands', '#b06a40'], 167: ['Modified badlands', '#b8673d'],
    168: ['Bamboo jungle', '#4f9a2c'], 169: ['Bamboo hills', '#4a9029'],
    178: ['Soul sand valley', '#5e4a3a'], 179: ['Crimson forest', '#9a2f2f'], 180: ['Warped forest', '#2b7b72'], 181: ['Basalt deltas', '#5a5a60'],
    182: ['Jagged peaks', '#e4ecef'], 183: ['Frozen peaks', '#cfe0ea'], 184: ['Snowy slopes', '#e8eeee'], 185: ['Grove', '#b9cfc2'],
    186: ['Meadow', '#9ec46b'], 187: ['Lush caves', '#5aa040'], 188: ['Dripstone caves', '#8a7a68'], 189: ['Stony peaks', '#a3a39b'],
    190: ['Deep dark', '#1f3a40'], 191: ['Mangrove swamp', '#4a6a3a'], 192: ['Cherry grove', '#e6a8c4'], 193: ['Pale garden', '#9aa59c']
  };
  const biomeRGB = {};
  for (const [id, [, c]] of Object.entries(BIOMES)) biomeRGB[id] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const UNKNOWN_RGB = [120, 140, 110];

  const BE_WEIGHT = {
    Sign: 6, HangingSign: 6, ItemFrame: 4, GlowItemFrame: 4, Beacon: 6, CommandBlock: 5, Conduit: 4, Lodestone: 4,
    Jukebox: 3, Music: 3, Comparator: 3, DaylightDetector: 3, EnchantTable: 3, ShulkerBox: 3, EnderChest: 3, RespawnAnchor: 3, Crafter: 3,
    Hopper: 2, Dispenser: 2, Dropper: 2, PistonArm: 2, BrewingStand: 2, Banner: 2, ChiseledBookshelf: 2, StructureBlock: 2,
    Chest: 1, Barrel: 1, Furnace: 1, BlastFurnace: 1, Smoker: 1, Bed: 1, Lectern: 1, Campfire: 1, Cauldron: 1, FlowerPot: 1, Skull: 1,
    Bell: 0.5, DecoratedPot: 0.5
  };
  const BE_KIND = id => /Sign/.test(id) ? 'sign'
    : /Chest|Barrel|ShulkerBox|Hopper|Dispenser|Dropper/.test(id) ? 'storage'
    : /Comparator|PistonArm|DaylightDetector|CommandBlock|Crafter|MovingBlock/.test(id) ? 'redstone'
    : 'build';

  function signText(be) {
    const parts = [];
    for (const side of [be.FrontText, be.BackText]) if (side && typeof side.Text === 'string') parts.push(side.Text);
    if (!parts.length && typeof be.Text === 'string') parts.push(be.Text);
    return parts.join('\n').replace(/§./g, '').split('\n').map(s => s.trim()).filter(Boolean).join(' / ');
  }
  function itemsCount(be) { return Array.isArray(be.Items) ? be.Items.filter(i => i && i.Count).length : 0; }

  function parseChunkKey(k) {
    const L = k.length;
    if (L !== 9 && L !== 10 && L !== 13 && L !== 14) return null;
    let dim = 0, tp = 8;
    if (L >= 13) { dim = i32(k, 8); if (dim !== 1 && dim !== 2) return null; tp = 12; }
    const tag = k[tp];
    const isSub = L === 10 || L === 14;
    const x = i32(k, 0), z = i32(k, 4);
    if ((tag >= 43 && tag <= 65) || tag === 118) {
      if (isSub !== (tag === 47)) return null;
      return { x, z, dim, tag, sub: isSub ? (k[tp + 1] << 24 >> 24) : null };
    }
    // An unfamiliar record type is treated as chunk-level only when the key unambiguously has a chunk
    // key's shape: plausible coordinates, and not readable text (world-wide keys are named in text).
    if (Math.abs(x) > 2000000 || Math.abs(z) > 2000000) return null;
    let printable = true; for (let i = 0; i < L; i++) if (k[i] < 32 || k[i] > 126) { printable = false; break; }
    if (printable) return null;
    return { x, z, dim, tag, sub: isSub ? (k[tp + 1] << 24 >> 24) : null, unknown: true };
  }

  function decodeBiomes3D(d, floorCy) {
    // returns per-section biome lookup (function giving id at x,z for section index)
    const sections = []; let p = 512; let prev = null;
    while (p < d.length) {
      const hdr = d[p++]; const bits = hdr >> 1;
      if (bits === 127) { sections.push(prev); continue; }
      let sec;
      if (bits === 0) { sec = { single: i32(d, p) }; p += 4; }
      else {
        const vpw = Math.floor(32 / bits), words = Math.ceil(4096 / vpw);
        const wordsAt = p; p += words * 4;
        const plen = u32(d, p); p += 4;
        const pal = []; for (let i = 0; i < plen; i++) { pal.push(i32(d, p)); p += 4; }
        sec = { bits, vpw, wordsAt, pal, d };
      }
      sections.push(sec); prev = sec;
    }
    return sections;
  }
  function biomeAt(sec, x, y, z) {
    if (!sec) return -1;
    if (sec.single !== undefined) return sec.single;
    const idx = (x << 8) | (z << 4) | y;
    const w = Math.floor(idx / sec.vpw), shift = (idx % sec.vpw) * sec.bits;
    const word = u32(sec.d, sec.wordsAt + w * 4);
    const v = (word >>> shift) & ((1 << sec.bits) - 1);
    return sec.pal[v] ?? -1;
  }

  // ---------- crafted-block evidence from subchunk palettes
  const CRAFT = [
    [/concrete(_powder)?$/, 2], [/glazed_terracotta$/, 2], [/stained_glass(_pane)?$/, 2],
    [/^(iron|gold|diamond|emerald|lapis|netherite|redstone|copper|coal|raw_iron|raw_gold|raw_copper)_block$/, 2],
    [/^(observer|repeater|unpowered_repeater|powered_repeater|unpowered_comparator|powered_comparator|redstone_lamp|lit_redstone_lamp|daylight_detector|daylight_detector_inverted|scaffolding|slime|honey_block|honeycomb_block|target|lightning_rod|noteblock|jukebox|beacon|anvil|chipped_anvil|damaged_anvil|grindstone|stonecutter_block|loom|cartography_table|fletching_table|smithing_table|enchanting_table|brewing_stand|cauldron|frame|glow_frame)$/, 2],
    [/_sign$/, 2], [/wool$/, 1.5], [/carpet$/, 1.5], [/^glass$/, 1.5], [/redstone_wire$/, 1.5],
    [/^(smooth_stone|quartz_block|quartz_bricks|quartz_pillar|smooth_quartz)$/, 1.5],
    [/^(sea_lantern|lantern|soul_lantern|end_rod|glowstone)$/, 1], [/(sticky_)?piston$/, 1], [/^tnt$/, 0.5],
    [/trapdoor$/, 1], [/door$/, 1], [/_stairs$/, 1], [/(_slab|slab\d*)$/, 1], [/fence_gate$/, 1], [/fence$/, 0.5],
    [/^(torch|wall_torch|soul_torch|redstone_torch|unlit_redstone_torch|lit_redstone_torch)$/, 1],
    [/^(crafting_table|furnace|lit_furnace|blast_furnace|lit_blast_furnace|smoker|lit_smoker|bookshelf|chest|trapped_chest|barrel|bed|flower_pot|lectern)$/, 1],
    [/glass_pane$/, 1], [/^(brick_block|bricks)$/, 1], [/planks$/, 0.5], [/^ladder$/, 0.5],
    [/(stonebrick|stone_bricks)$/, 0.5], [/^polished_/, 0.5], [/_wall$/, 0.5], [/^iron_bars$/, 0.5],
    [/^hay_block$/, 0.3], [/^(grass_path|dirt_path)$/, 0.3]
  ];
  const craftCache = new Map();
  function craftWeight(name) {
    let w = craftCache.get(name);
    if (w === undefined) {
      const n = name.replace(/^minecraft:/, ''); w = 0;
      for (const [re, wt] of CRAFT) if (re.test(n)) { w = wt; break; }
      craftCache.set(name, w);
    }
    return w;
  }
  // Pre-1.2.13 worlds store numeric block ids.
  const LEGACY = new Float32Array(256);
  for (const [ids, w] of [[[236, 241, 160, 41, 42, 57, 133, 22, 152, 93, 94, 149, 150, 123, 124, 151, 178, 84, 25, 138, 145, 116, 117, 118, 63, 68, 199, 165], 2],
    [[35, 171, 20, 55, 155], 1.5], [[89, 169, 33, 29], 1], [[53, 67, 108, 109, 114, 128, 134, 135, 136, 156, 163, 164, 180, 203, 44, 158, 182, 96, 64, 71, 193, 194, 195, 196, 197, 107, 183, 184, 185, 186, 187, 50, 76, 75, 58, 61, 62, 47, 54, 146, 26, 140, 102, 45], 1],
    [[5, 85, 65, 98, 139, 101], 0.5]]) for (const id of ids) LEGACY[id] = w;
  // Default-variant samples of the blocks the edge cutter fills with, collected world-wide so that
  // chunks lacking (say) sand can borrow a correctly spelled entry from elsewhere in the same world.
  const SAMPLE_NAMES = new Set(['minecraft:sand', 'minecraft:sandstone', 'minecraft:stone', 'minecraft:water', 'minecraft:gravel', 'minecraft:bedrock', 'minecraft:air', 'minecraft:dirt', 'minecraft:grass_block', 'minecraft:ice']);
  function sampleOk(name, st) {
    st = st || {};
    if (name === 'minecraft:water') return (st.liquid_depth ?? 0) === 0;
    if (name === 'minecraft:stone') return !st.stone_type || st.stone_type === 'stone';
    if (name === 'minecraft:sand') return !st.sand_type || st.sand_type === 'normal';
    if (name === 'minecraft:sandstone') return !st.sand_stone_type || st.sand_stone_type === 'default';
    if (name === 'minecraft:dirt') return !st.dirt_type || st.dirt_type === 'normal';
    return true;
  }
  function scanSubchunk(v, found, samples) {
    const ver = v[0];
    if (ver === 0 || (ver >= 2 && ver <= 7)) { for (let i = 1; i < 4097 && i < v.length; i++) if (LEGACY[v[i]]) found.set('#' + v[i], LEGACY[v[i]]); return; }
    let n, p;
    if (ver === 1) { n = 1; p = 1; } else if (ver === 8) { n = v[1]; p = 2; } else if (ver === 9) { n = v[1]; p = 3; } else return;
    for (let s = 0; s < n && s < 2; s++) {
      const hdr = v[p++]; if (hdr & 1) return;
      const bits = hdr >> 1; let plen = 1;
      if (bits > 0) { const vpw = Math.floor(32 / bits); p += Math.ceil(4096 / vpw) * 4; plen = u32(v, p); p += 4; }
      if (plen > 4096) return;
      for (let i = 0; i < plen; i++) {
        if (v[p] !== 10) return;
        const start = p; const r = readNBT(v, p); p = r.end;
        const name = r.value && r.value.name;
        if (samples && s === 0 && SAMPLE_NAMES.has(name) && sampleOk(name, r.value.states)) {
          const ver = r.value.version | 0; const cur = samples.get(name);
          if (!cur || ver > cur.version) samples.set(name, { raw: v.slice(start, r.end), version: ver });
        }
        if (name) { const w = craftWeight(name); if (w) found.set(name, w); }
      }
    }
  }

  async function scanWorld(world, progress) {
    const fs = world.fs;
    const level = { name: null };
    try {
      const ld = await fs.read(world.dir + 'level.dat');
      level.data = readNBT(ld, 8).value || {};
      level.name = level.data.LevelName;
      let h = 0x811c9dc5; for (let i = 0; i < ld.length; i++) { h ^= ld[i]; h = Math.imul(h, 16777619); } level.fp = (h >>> 0).toString(16);
    } catch (e) { level.error = String(e.message || e); level.data = {}; }
    try {
      const lt = world.dir + 'levelname.txt';
      if (fs.paths.includes(lt)) level.nameTxt = utf8.decode(await fs.read(lt)).trim();
    } catch (e) {}

    const chunks = new Map(); const blockSamples = new Map();
    const actors = new Map();
    const actorDims = new Map();
    const singles = new Map();
    const newer = (slot, seq) => !slot || seq > slot.seq;
    const actorPrefix = [97, 99, 116, 111, 114, 112, 114, 101, 102, 105, 120]; // "actorprefix"
    const isPrefix = (k, pre) => { if (k.length < pre.length) return false; for (let i = 0; i < pre.length; i++) if (k[i] !== pre[i]) return false; return true; };

    const onRecord = (k, seq, del, v) => {
      const ck = parseChunkKey(k);
      if (ck) {
        const id = ck.dim + '|' + ck.x + '|' + ck.z;
        let c = chunks.get(id);
        if (!c) { c = { dim: ck.dim, x: ck.x, z: ck.z, subLo: 0, subHi: 0 }; chunks.set(id, c); }
        if (ck.tag === 47) {
          if (!del) {
            c.anySub = true;
            const found = new Map();
            try { scanSubchunk(v, found, blockSamples); } catch (e) {}
            if (found.size) {
              if (!c.craft) c.craft = new Map();
              for (const [k2, w] of found) c.craft.set(k2, w);
              c.cyMin = Math.min(c.cyMin ?? 99, ck.sub); c.cyMax = Math.max(c.cyMax ?? -99, ck.sub);
            }
          }
          return;
        }
        const field = ck.tag === 43 ? 'd3' : ck.tag === 45 ? 'd2' : ck.tag === 48 ? 'legacy' : ck.tag === 49 ? 'be' : ck.tag === 50 ? 'ent' : null;
        if (field && newer(c[field], seq)) c[field] = { seq, v: del ? null : v.slice() };
        return;
      }
      if (isPrefix(k, actorPrefix) && k.length === 19) {
        const uid = hex(k.subarray(11));
        const slot = actors.get(uid);
        if (newer(slot, seq)) {
          let info = null;
          if (!del) { try { info = actorInfo(readNBT(v).value); } catch (e) { info = null; } }
          actors.set(uid, { seq, info });
        }
        return;
      }
      if (k.length === 16 && k[0] === 100 && k[1] === 105 && k[2] === 103 && k[3] === 112 && !del) { // digp with dimension
        const dim = i32(k, 12);
        for (let p = 0; p + 8 <= v.length; p += 8) actorDims.set(hex(v.subarray(p, p + 8)), dim);
        return;
      }
      if (k.length >= 7 && k.length <= 64) {
        const s = ascii(k, 0, k.length);
        if (s === 'world_museum') { if (newer(singles.get(s), seq)) singles.set(s, { seq, v: del ? null : v.slice() }); return; }
        if (s === '~local_player' || s.startsWith('player_server_')) {
          if (newer(singles.get(s), seq)) singles.set(s, { seq, v: del ? null : v.slice() });
        }
      }
    };
    const stats = await readLevelDB(world, onRecord, progress);

    // Work out heightmap convention from the data: Data3D values are measured from the
    // bottom of the world in current versions; detect rather than assume.
    const samples = [];
    for (const c of chunks.values()) {
      if (c.dim === 0 && c.d3 && c.d3.v && c.d3.v.length >= 512) {
        samples.push(c.d3.v[255 * 2] | (c.d3.v[255 * 2 + 1] << 8));
        if (samples.length > 4000) break;
      }
    }
    samples.sort((a, b) => a - b);
    const median = samples.length ? samples[samples.length >> 1] : 0;
    const d3Offset = median > 100 ? -64 : 0;

    const dims = {};
    const markers = [];
    const getDim = d => dims[d] || (dims[d] = { chunks: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    for (const c of chunks.values()) {
      const D = getDim(c.dim);
      const out = { x: c.x, z: c.z, h: null, b: null, sub: c.anySub || false, score: 0, build: 0 };
      if (c.craft) {
        for (const w of c.craft.values()) out.build += w;
        out.blockTypes = c.craft.size; out.yMin = c.cyMin * 16; out.yMax = c.cyMax * 16 + 15;
        out.score += out.build >= 2.5 ? out.build : 0;
      }
      try {
        if (c.d3 && c.d3.v && c.d3.v.length >= 512) {
          const d = c.d3.v; const h = new Int16Array(256); const b = new Uint8Array(256);
          const floorY = c.dim === 0 ? -64 : 0;
          const off = c.dim === 0 ? d3Offset : 0;
          let secs = null; try { secs = decodeBiomes3D(d); } catch (e) { secs = []; }
          for (let i = 0; i < 256; i++) {
            const raw = d[i * 2] | (d[i * 2 + 1] << 8);
            const y = (raw << 16 >> 16) + off; h[i] = y;
            const x = i & 15, z = i >> 4;
            const yy = c.dim === 0 ? Math.max(y - 1, floorY) : 64;
            const si = Math.max(0, Math.floor((yy - floorY) / 16));
            const sec = secs[Math.min(si, secs.length - 1)];
            const id = biomeAt(sec, x, ((yy - floorY) % 16 + 16) % 16, z);
            b[i] = id < 0 ? 255 : Math.min(id, 254);
          }
          out.h = h; out.b = b;
        } else if (c.d2 && c.d2.v && c.d2.v.length >= 768) {
          const d = c.d2.v; const h = new Int16Array(256); const b = new Uint8Array(256);
          for (let i = 0; i < 256; i++) { h[i] = (d[i * 2] | (d[i * 2 + 1] << 8)) << 16 >> 16; b[i] = d[512 + i]; }
          out.h = h; out.b = b;
        } else if (c.legacy && c.legacy.v && c.legacy.v.length >= 83200) {
          const d = c.legacy.v; const h = new Int16Array(256); const b = new Uint8Array(256);
          for (let i = 0; i < 256; i++) { h[i] = d[81920 + i]; b[i] = d[82176 + i * 4]; }
          out.h = h; out.b = b;
        }
      } catch (e) { stats.badChunks = (stats.badChunks || 0) + 1; }
      if (c.be && c.be.v) {
        try {
          for (const be of readNBTMany(c.be.v)) {
            const id = be.id || '?';
            let w = BE_WEIGHT[id] ?? 0;
            if (be.LootTable) { w = 0; out.structure = true; } // untouched generated loot = natural
            if (id === 'Bell' || id === 'MobSpawner' || id === 'EndPortal' || id === 'TrialSpawner' || id === 'Vault') out.structure = true;
            if (be.CustomName) w += 3;
            const m = { world: null, dim: c.dim, x: be.x, y: be.y, z: be.z, id, kind: BE_KIND(id), weight: w };
            if (m.kind === 'sign') m.text = signText(be);
            if (be.CustomName) m.name = String(be.CustomName);
            const n = itemsCount(be); if (n) m.items = n;
            if (w > 0 || m.kind === 'sign') markers.push(m);
            out.score += w;
          }
        } catch (e) { stats.badBlockEntities = (stats.badBlockEntities || 0) + 1; }
      }
      if (c.ent && c.ent.v) {
        try { for (const e of readNBTMany(c.ent.v)) { const info = actorInfo(e); if (info) { info.dim = c.dim; markers.push(info); out.score += info.weight; } } } catch (e) {}
      }
      if (out.h || out.sub) {
        D.chunks.push(out);
        if (c.x < D.minX) D.minX = c.x; if (c.x > D.maxX) D.maxX = c.x;
        if (c.z < D.minZ) D.minZ = c.z; if (c.z > D.maxZ) D.maxZ = c.z;
      }
    }
    for (const [uid, a] of actors) {
      if (!a.info) continue;
      a.info.dim = actorDims.get(uid) ?? 0;
      markers.push(a.info);
    }
    // credit entity weights to their chunks
    for (const d of Object.keys(dims)) {
      const D = dims[d]; D.index = new Map(D.chunks.map(c => [c.x + ',' + c.z, c]));
    }
    for (const m of markers) {
      if (m.kind !== 'mob') continue;
      const D = dims[m.dim]; if (!D) continue;
      const c = D.index.get((Math.floor(m.x) >> 4) + ',' + (Math.floor(m.z) >> 4));
      if (c) c.score += m.weight;
    }
    let player = null;
    const lp = singles.get('~local_player');
    if (lp && lp.v) { try { const pv = readNBT(lp.v).value; if (pv && Array.isArray(pv.Pos)) player = { x: pv.Pos[0], y: pv.Pos[1], z: pv.Pos[2], dim: pv.DimensionId ?? 0 }; } catch (e) {} }

    let museumInfo = null;
    const mk = singles.get('world_museum');
    if (mk && mk.v) { try { museumInfo = JSON.parse(utf8.decode(mk.v)); } catch (e) {} }
    if (!museumInfo && fs.paths.includes(world.dir + 'museum-directory.txt')) museumInfo = { v: 0 };
    const name = level.name || level.nameTxt || world.dir.replace(/\/$/, '').split('/').pop() || world.sourceName;
    const dbBytes = world.dbFiles.reduce((s, p) => s + (fs.size(p) || 0), 0);
    let totalChunks = 0; for (const d of Object.keys(dims)) totalChunks += dims[d].chunks.length;
    const folderId = world.dir.replace(/\/$/, '').split('/').pop() || '';
    const result = { museumInfo, flatLayers: typeof level.data.FlatWorldLayers === 'string' ? level.data.FlatWorldLayers : null, generator: level.data.Generator, fp: level.fp || '', folderId, blockSamples, src: world, levelVersion: level.data.lastOpenedWithVersion, dbBytes, totalChunks, name, folder: world.dir.replace(/\/$/, ''), source: world.sourceName, level: summarizeLevel(level.data), dims, markers, player, stats, d3Offset };
    result.places = {};
    for (const d of Object.keys(dims)) result.places[d] = findPlaces(dims[d], markers.filter(m => m.dim == d));
    return result;
  }

  function actorInfo(e) {
    if (!e || !Array.isArray(e.Pos)) return null;
    const id = String(e.identifier || '').replace('minecraft:', '');
    const name = e.CustomName ? String(e.CustomName) : '';
    const tamed = e.IsTamed === 1 || (e.OwnerNew !== undefined && e.OwnerNew !== -1);
    let weight = 0;
    if (name) weight += 4;
    if (tamed) weight += 3;
    if (/armor_stand|painting/.test(id)) weight += 2;
    if (!weight) return null;
    return { dim: 0, x: e.Pos[0], y: e.Pos[1], z: e.Pos[2], id, kind: 'mob', name, tamed, weight };
  }

  function summarizeLevel(d) {
    const v = Array.isArray(d.lastOpenedWithVersion) ? d.lastOpenedWithVersion.slice(0, 4).join('.') : '';
    return {
      seed: d.RandomSeed, lastPlayed: d.LastPlayed ? new Date(d.LastPlayed * 1000) : null, version: v,
      gameMode: ['Survival', 'Creative', 'Adventure', 'Spectator'][d.GameType] ?? '', generator: ['Old', 'Infinite', 'Flat'][d.Generator] ?? '',
      spawn: d.SpawnX !== undefined ? { x: d.SpawnX, y: d.SpawnY, z: d.SpawnZ } : null
    };
  }

  // Group chunks with evidence of building into candidate places.
  function findPlaces(D, dimMarkers) {
    const hot = D.chunks.filter(c => c.score >= 2.5);
    const byKey = new Map(hot.map(c => [c.x + ',' + c.z, c]));
    const seen = new Set(); const R = 3; const places = [];
    for (const c of hot) {
      const k0 = c.x + ',' + c.z; if (seen.has(k0)) continue;
      const comp = []; const stack = [c]; seen.add(k0);
      while (stack.length) {
        const a = stack.pop(); comp.push(a);
        for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
          const k = (a.x + dx) + ',' + (a.z + dz);
          if (!seen.has(k) && byKey.has(k)) { seen.add(k); stack.push(byKey.get(k)); }
        }
      }
      const score = comp.reduce((s, a) => s + a.score, 0);
      if (score < 6) continue;
      let sx = 0, sz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const a of comp) { sx += a.x * a.score; sz += a.z * a.score; minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x); minZ = Math.min(minZ, a.z); maxZ = Math.max(maxZ, a.z); }
      let yMin = null; for (const a of comp) if (a.yMin !== undefined && a.build >= 2.5) yMin = yMin === null ? a.yMin : Math.min(yMin, a.yMin);
      places.push({ cx: (sx / score) * 16 + 8, cz: (sz / score) * 16 + 8, score, chunks: comp.length, minX, maxX, minZ, maxZ,
        structure: comp.some(a => a.structure), blockYMin: yMin, buildChunks: comp.filter(a => a.build >= 2.5).length });
    }
    places.sort((a, b) => b.score - a.score);
    for (const p of places) {
      const inside = dimMarkers.filter(m => (Math.floor(m.x) >> 4) >= p.minX - 1 && (Math.floor(m.x) >> 4) <= p.maxX + 1 && (Math.floor(m.z) >> 4) >= p.minZ - 1 && (Math.floor(m.z) >> 4) <= p.maxZ + 1);
      p.signs = inside.filter(m => m.kind === 'sign' && m.text).map(m => m.text);
      p.counts = { signs: inside.filter(m => m.kind === 'sign').length, storage: inside.filter(m => m.kind === 'storage').length, mobs: inside.filter(m => m.kind === 'mob').length };
      p.names = inside.filter(m => m.name).map(m => m.name);
      const ys = inside.map(m => m.y).filter(Number.isFinite);
      p.minY = ys.length ? Math.min(...ys) : null; p.maxY = ys.length ? Math.max(...ys) : null;
      if (p.blockYMin !== null && (p.minY === null || p.blockYMin < p.minY)) p.minY = p.blockYMin;
    }
    return places;
  }

  // ---------- colours for the map
  const WATER = [64, 110, 170];
  function chunkPixels(c, D, out, ox, oy, stride, seaLevel) {
    const hN = D.index.get(c.x + ',' + (c.z - 1)), hW = D.index.get((c.x - 1) + ',' + c.z);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = z * 16 + x; const o = ((oy + z) * stride + ox + x) * 4;
      if (!c.h) { const g = (x + z) % 2 ? 132 : 140; out[o] = g; out[o + 1] = g; out[o + 2] = g + 6; out[o + 3] = 255; continue; }
      const y = c.h[i]; const bid = c.b[i]; const info = BIOMES[bid];
      let rgb = biomeRGB[bid] || UNKNOWN_RGB;
      let isWater = info && info[2] && y <= seaLevel + 1;
      let k = 1;
      if (isWater) { rgb = biomeRGB[bid] || WATER; k = 0.92 + ((x * 7 + z * 13) % 5) * 0.01; }
      else {
        let yn = z > 0 ? c.h[i - 16] : (hN && hN.h ? hN.h[240 + x] : y);
        let yw = x > 0 ? c.h[i - 1] : (hW && hW.h ? hW.h[i + 15] : y);
        const slope = (y - yn) + (y - yw);
        k = 1 + Math.max(-0.35, Math.min(0.3, slope * 0.05));
        k *= 0.82 + Math.max(0, Math.min(0.35, (y - seaLevel) / 260));
      }
      out[o] = Math.min(255, rgb[0] * k); out[o + 1] = Math.min(255, rgb[1] * k); out[o + 2] = Math.min(255, rgb[2] * k); out[o + 3] = 255;
    }
  }

  return { craftWeight, readNBTMany, _readLevelDB: readLevelDB, openZip, openFileList, findWorlds, scanWorld, chunkPixels, BIOMES, readNBT, parseChunkKey };
})();
if (typeof module !== 'undefined') module.exports = MuseumCore;
