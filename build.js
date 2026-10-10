/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
/* World Museum — step 3: arrange exhibits and write a new Bedrock world. No DOM. */
const MuseumBuild = (() => {
  'use strict';
  const C = (typeof MuseumCore !== 'undefined') ? MuseumCore : require('./core.js');
  const enc = new TextEncoder(), dec = new TextDecoder();

  // ---------- checksums
  const CRC32C = new Uint32Array(256), CRC32 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let a = i, b = i;
    for (let k = 0; k < 8; k++) { a = a & 1 ? (a >>> 1) ^ 0x82F63B78 : a >>> 1; b = b & 1 ? (b >>> 1) ^ 0xEDB88320 : b >>> 1; }
    CRC32C[i] = a >>> 0; CRC32[i] = b >>> 0;
  }
  function crc(table, parts) {
    let c = 0xFFFFFFFF;
    for (const u8 of parts) for (let i = 0; i < u8.length; i++) c = table[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const maskCrc = c => ((((c >>> 15) | (c << 17)) >>> 0) + 0xa282ead8) >>> 0;

  // ---------- byte writer
  class Out {
    constructor(n = 1024) { this.b = new Uint8Array(n); this.n = 0; }
    need(k) { if (this.n + k > this.b.length) { const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); nb.set(this.b.subarray(0, this.n)); this.b = nb; } }
    u8(v) { this.need(1); this.b[this.n++] = v & 0xff; }
    bytes(u) { this.need(u.length); this.b.set(u, this.n); this.n += u.length; }
    u16(v) { this.u8(v); this.u8(v >> 8); }
    u32(v) { this.need(4); new DataView(this.b.buffer).setUint32(this.n, v >>> 0, true); this.n += 4; }
    i32(v) { this.need(4); new DataView(this.b.buffer).setInt32(this.n, v, true); this.n += 4; }
    i64(v) { this.need(8); new DataView(this.b.buffer).setBigInt64(this.n, BigInt(v), true); this.n += 8; }
    f32(v) { this.need(4); new DataView(this.b.buffer).setFloat32(this.n, v, true); this.n += 4; }
    f64(v) { this.need(8); new DataView(this.b.buffer).setFloat64(this.n, v, true); this.n += 8; }
    varint(v) { while (v >= 128) { this.u8((v % 128) | 128); v = Math.floor(v / 128); } this.u8(v); }
    lstr(u) { this.varint(u.length); this.bytes(u); }
    done() { return this.b.slice(0, this.n); }
  }
  const concat = parts => { const o = new Out(parts.reduce((s, p) => s + p.length, 0) || 1); for (const p of parts) o.bytes(p); return o.done(); };

  // ---------- typed NBT (little-endian) for level.dat and the player record
  function parseTyped(u8, off = 0) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = off;
    const str = () => { const n = dv.getUint16(p, true); p += 2; const s = dec.decode(u8.subarray(p, p + n)); p += n; return s; };
    const pay = t => {
      switch (t) {
        case 1: return dv.getInt8(p++);
        case 2: { const v = dv.getInt16(p, true); p += 2; return v; }
        case 3: { const v = dv.getInt32(p, true); p += 4; return v; }
        case 4: { const v = dv.getBigInt64(p, true); p += 8; return v; }
        case 5: { const v = dv.getFloat32(p, true); p += 4; return v; }
        case 6: { const v = dv.getFloat64(p, true); p += 8; return v; }
        case 7: { const n = dv.getInt32(p, true); p += 4; const v = u8.slice(p, p + n); p += n; return v; }
        case 8: return str();
        case 9: { const et = u8[p++]; const n = dv.getInt32(p, true); p += 4; const items = []; for (let i = 0; i < n; i++) items.push(pay(et)); return { et, items }; }
        case 10: { const e = []; for (;;) { const tt = u8[p++]; if (tt === 0) break; const k = str(); e.push([k, { t: tt, v: pay(tt) }]); } return e; }
        case 11: { const n = dv.getInt32(p, true); p += 4; const a = []; for (let i = 0; i < n; i++) { a.push(dv.getInt32(p, true)); p += 4; } return a; }
        case 12: { const n = dv.getInt32(p, true); p += 4; const a = []; for (let i = 0; i < n; i++) { a.push(dv.getBigInt64(p, true)); p += 8; } return a; }
      }
      throw new Error('bad NBT tag ' + t);
    };
    const t = u8[p++]; const name = str();
    return { root: { t, v: pay(t) }, name, end: p };
  }
  function writeTyped(root, name = '') {
    const o = new Out(4096);
    const str = s => { const b = enc.encode(s); o.u16(b.length); o.bytes(b); };
    const pay = (t, v) => {
      switch (t) {
        case 1: return o.u8(v); case 2: return o.u16(v); case 3: return o.i32(v); case 4: return o.i64(v);
        case 5: return o.f32(v); case 6: return o.f64(v); case 7: o.i32(v.length); return o.bytes(v);
        case 8: return str(v);
        case 9: o.u8(v.items.length ? v.et : (v.et || 0)); o.i32(v.items.length); for (const it of v.items) pay(v.et, it); return;
        case 10: for (const [k, n] of v) { o.u8(n.t); str(k); pay(n.t, n.v); } return o.u8(0);
        case 11: o.i32(v.length); for (const x of v) o.i32(x); return;
        case 12: o.i32(v.length); for (const x of v) o.i64(x); return;
      }
    };
    o.u8(root.t); str(name); pay(root.t, root.v);
    return o.done();
  }
  const tget = (c, k) => { const e = c.find(x => x[0] === k); return e ? e[1] : undefined; };
  const tset = (c, k, t, v) => { const e = c.find(x => x[0] === k); if (e) e[1] = { t, v }; else c.push([k, { t, v }]); };
  const tdel = (c, re) => { for (let i = c.length - 1; i >= 0; i--) if (re.test(c[i][0])) c.splice(i, 1); };

  // ---------- in-place numeric patching of NBT (positions and ids keep their size)
  function walkNBT(u8, start, visit) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = start; const path = [];
    const skipStr = () => { const n = dv.getUint16(p, true); p += 2 + n; };
    const readStr = () => { const n = dv.getUint16(p, true); p += 2; const s = dec.decode(u8.subarray(p, p + n)); p += n; return s; };
    const pay = t => {
      switch (t) {
        case 1: visit(path, t, p, dv); p += 1; return;
        case 2: visit(path, t, p, dv); p += 2; return;
        case 3: case 5: visit(path, t, p, dv); p += 4; return;
        case 4: case 6: visit(path, t, p, dv); p += 8; return;
        case 7: { const n = dv.getInt32(p, true); p += 4 + n; return; }
        case 8: skipStr(); return;
        case 9: { const et = u8[p++]; const n = dv.getInt32(p, true); p += 4; for (let i = 0; i < n; i++) { path.push(i); pay(et); path.pop(); } return; }
        case 10: for (;;) { const tt = u8[p++]; if (tt === 0) return; const k = readStr(); path.push(k); pay(tt); path.pop(); }
        case 11: { const n = dv.getInt32(p, true); p += 4 + 4 * n; return; }
        case 12: { const n = dv.getInt32(p, true); p += 4 + 8 * n; return; }
      }
      throw new Error('bad NBT tag ' + t);
    };
    const t = u8[p++]; if (t === 0) return p; skipStr(); pay(t); return p;
  }
  function patchAll(v, visit) {
    const u = v.slice(); let p = 0;
    while (p < u.length) { const np = walkNBT(u, p, visit); if (np <= p) break; p = np; }
    return u;
  }
  const addI = (dv, off, d) => dv.setInt32(off, dv.getInt32(off, true) + d, true);
  const addF = (dv, off, d) => dv.setFloat32(off, dv.getFloat32(off, true) + d, true);

  // ---------- keys
  const hexOf = u8 => { let s = ''; for (const x of u8) s += (x < 16 ? '0' : '') + x.toString(16); return s; };
  const latin = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  const fromLatin = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  function chunkKey(x, z, dim, tag, sub) {
    const o = new Out(16); o.i32(x); o.i32(z); if (dim) o.i32(dim); o.u8(tag); if (sub !== null && sub !== undefined) o.u8(sub & 0xff);
    return o.done();
  }
  const i32 = (u8, p) => (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24));
  const ACTOR = enc.encode('actorprefix'), DIGP = enc.encode('digp');
  const startsWith = (k, pre) => { if (k.length < pre.length) return false; for (let i = 0; i < pre.length; i++) if (k[i] !== pre[i]) return false; return true; };
  function cmpBytes(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }

  // ---------- packing (chunk coordinates). groups: [{id, chunks:[[x,z]...] (source coords), fixed?:[ox,oz]}]
  // Returns offsets placing each group's bounding-box corner; gap = empty chunks between shapes.
  function pack(groups, gap, fixed = {}) {
    const occ = new Set(); const boxes = [];
    const out = {};
    const order = [...groups].sort((a, b) => (fixed[b.id] ? 1 : 0) - (fixed[a.id] ? 1 : 0) || b.chunks.length - a.chunks.length);
    for (const g of order) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of g.chunks) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
      if (g.ref) { minX = g.ref[0]; minZ = g.ref[1]; } // offsets are reported for this corner (the full exhibit's)
      const w = maxX - minX + 1, h = maxZ - minZ + 1;
      const shape = g.chunks.map(([x, z]) => [x - minX, z - minZ]);
      const fits = (ox, oz) => {
        let overlapBox = false;
        for (const b of boxes) if (ox <= b.x1 + gap && ox + w - 1 >= b.x0 - gap && oz <= b.z1 + gap && oz + h - 1 >= b.z0 - gap) { overlapBox = true; break; }
        if (!overlapBox) return true;
        for (const [x, z] of shape) if (occ.has((ox + x) + ',' + (oz + z))) return false;
        return true;
      };
      let best = fixed[g.id] ? fixed[g.id].slice() : null;
      if (best) {}
      else if (!boxes.length) best = [-Math.floor(w / 2), -Math.floor(h / 2)];
      else {
        const cx0 = -Math.floor(w / 2), cz0 = -Math.floor(h / 2);
        const step = Math.max(1, Math.floor(Math.min(w, h) / 8));
        for (let r = 0; r < 4000 && !best; r += step) {
          let cand = null, cd = Infinity;
          for (let dx = -r; dx <= r; dx += step) for (const dz of (Math.abs(dx) === r ? rangeStep(-r, r, step) : [-r, r])) {
            const ox = cx0 + dx, oz = cz0 + dz;
            const d = Math.hypot(ox + w / 2, oz + h / 2);
            if (d < cd && fits(ox, oz)) { cd = d; cand = [ox, oz]; }
          }
          best = cand;
        }
      }
      out[g.id] = best;
      const [ox, oz] = best;
      boxes.push({ x0: ox, z0: oz, x1: ox + w - 1, z1: oz + h - 1 });
      for (const [x, z] of shape) for (let dx = -gap; dx <= gap; dx++) for (let dz = -gap; dz <= gap; dz++) occ.add((ox + x + dx) + ',' + (oz + z + dz));
    }
    return out;
  }
  function rangeStep(a, b, s) { const r = []; for (let v = a; v <= b; v += s) r.push(v); if (r[r.length - 1] !== b) r.push(b); return r; }

  // Check placements: overlaps (fatal) and gap violations (cosmetic).
  function checkLayout(placed, gap) {
    const owner = new Map(); const issues = {};
    for (const g of placed) for (const [x, z] of g.chunks) {
      const k = x + ',' + z;
      if (owner.has(k) && owner.get(k) !== g.id) { issues[g.id] = 'overlap'; issues[owner.get(k)] = 'overlap'; }
      owner.set(k, g.id);
    }
    for (const g of placed) {
      if (issues[g.id]) continue;
      outer: for (const [x, z] of g.chunks) for (let dx = -gap; dx <= gap; dx++) for (let dz = -gap; dz <= gap; dz++) {
        const o = owner.get((x + dx) + ',' + (z + dz));
        if (o !== undefined && o !== g.id) { issues[g.id] = 'close'; if (!issues[o]) issues[o] = 'close'; break outer; }
      }
    }
    return issues;
  }

  // ---------- LevelDB writer (Mojang flavour: raw-zlib blocks)
  async function deflateRaw(u8) {
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  class BlockBuilder {
    constructor(interval) { this.o = new Out(8192); this.restarts = [0]; this.counter = 0; this.last = null; this.interval = interval; this.count = 0; }
    add(k, v) {
      let shared = 0;
      if (this.counter < this.interval) { if (this.last) { const m = Math.min(this.last.length, k.length); while (shared < m && this.last[shared] === k[shared]) shared++; } }
      else { this.restarts.push(this.o.n); this.counter = 0; }
      this.o.varint(shared); this.o.varint(k.length - shared); this.o.varint(v.length);
      this.o.bytes(k.subarray(shared)); this.o.bytes(v);
      this.last = k; this.counter++; this.count++;
    }
    get size() { return this.o.n; }
    finish() { for (const r of this.restarts) this.o.u32(r); this.o.u32(this.restarts.length); return this.o.done(); }
  }
  function handle(off, size) { const o = new Out(20); o.varint(off); o.varint(size); return o.done(); }
  async function buildTable(entries) {
    const raws = []; const lastKeys = [];
    let bb = new BlockBuilder(16), last = null;
    for (const [k, v] of entries) { bb.add(k, v); last = k; if (bb.size >= 32768) { raws.push(bb.finish()); lastKeys.push(last); bb = new BlockBuilder(16); } }
    if (bb.count) { raws.push(bb.finish()); lastKeys.push(last); }
    const comps = [];
    for (let i = 0; i < raws.length; i += 32) comps.push(...await Promise.all(raws.slice(i, i + 32).map(deflateRaw)));
    const parts = []; let off = 0; const index = new BlockBuilder(1);
    const emit = (data, type) => {
      const t = new Uint8Array([type]);
      const tr = new Out(5); tr.u8(type); tr.u32(maskCrc(crc(CRC32C, [data, t])));
      parts.push(data, tr.done()); const h = handle(off, data.length); off += data.length + 5; return h;
    };
    raws.forEach((raw, i) => {
      const useComp = comps[i].length < raw.length * 0.875;
      index.add(lastKeys[i], emit(useComp ? comps[i] : raw, useComp ? 4 : 0));
    });
    const metaH = emit(new BlockBuilder(1).finish(), 0);
    const idxH = emit(index.finish(), 0);
    const footer = new Out(48); footer.bytes(metaH); footer.bytes(idxH);
    while (footer.n < 40) footer.u8(0);
    footer.u32(0x8b80fb57); footer.u32(0xdb477524);
    parts.push(footer.done());
    return concat(parts);
  }
  function logFile(records) {
    const o = new Out(4096); const BS = 32768;
    for (const rec of records) {
      let p = 0; let first = true;
      do {
        const left = BS - (o.n % BS);
        if (left < 7) { for (let i = 0; i < left; i++) o.u8(0); continue; }
        const avail = left - 7; const len = Math.min(avail, rec.length - p);
        const end = p + len === rec.length;
        const type = first && end ? 1 : first ? 2 : end ? 4 : 3;
        const data = rec.subarray(p, p + len);
        o.u32(maskCrc(crc(CRC32C, [new Uint8Array([type]), data]))); o.u16(len); o.u8(type); o.bytes(data);
        p += len; first = false;
      } while (p < rec.length);
    }
    return o.done();
  }
  // ---------- output: a ZIP written piece by piece, to disk when the browser allows it
  async function openStore(fileName = 'world-museum-build.zip') {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory && typeof FileSystemFileHandle !== 'undefined' && FileSystemFileHandle.prototype.createWritable) {
        const root = await navigator.storage.getDirectory();
        try { await root.removeEntry(fileName); } catch (e) {}
        const fh = await root.getFileHandle(fileName, { create: true });
        const w = await fh.createWritable();
        return { kind: 'disk', write: d => w.write(d), close: async () => { await w.close(); return fh.getFile(); } };
      }
    } catch (e) {}
    const parts = [];
    return { kind: 'memory', write: async d => { parts.push(new Blob([d])); }, close: async () => new Blob(parts, { type: 'application/zip' }) };
  }
  class ZipSink {
    constructor(store) { this.store = store; this.central = []; this.off = 0; this.count = 0; }
    async addRaw(nm, method, c32, csize, usize, body) {
      const h = new Out(30 + nm.length);
      h.u32(0x04034b50); h.u16(20); h.u16(0x0800); h.u16(method); h.u16(0); h.u16(0x21);
      h.u32(c32); h.u32(csize); h.u32(usize); h.u16(nm.length); h.u16(0); h.bytes(nm);
      const hb = h.done(); await this.store.write(hb); await this.store.write(body);
      const c = new Out(46 + nm.length);
      c.u32(0x02014b50); c.u16(20); c.u16(20); c.u16(0x0800); c.u16(method); c.u16(0); c.u16(0x21);
      c.u32(c32); c.u32(csize); c.u32(usize); c.u16(nm.length); c.u16(0); c.u16(0); c.u16(0); c.u16(0); c.u32(0); c.u32(this.off); c.bytes(nm);
      this.central.push(c.done()); this.off += hb.length + csize; this.count++;
    }
    async add(name, data, deflate) {
      const nm = enc.encode(name); const c32 = crc(CRC32, [data]);
      let body = data, method = 0;
      if (deflate && data.length > 64) { const d = await deflateRaw(data); if (d.length < data.length) { body = d; method = 8; } }
      const h = new Out(30 + nm.length);
      h.u32(0x04034b50); h.u16(20); h.u16(0x0800); h.u16(method); h.u16(0); h.u16(0x21);
      h.u32(c32); h.u32(body.length); h.u32(data.length); h.u16(nm.length); h.u16(0); h.bytes(nm);
      const hb = h.done();
      await this.store.write(hb); await this.store.write(body);
      const c = new Out(46 + nm.length);
      c.u32(0x02014b50); c.u16(20); c.u16(20); c.u16(0x0800); c.u16(method); c.u16(0); c.u16(0x21);
      c.u32(c32); c.u32(body.length); c.u32(data.length); c.u16(nm.length); c.u16(0); c.u16(0); c.u16(0); c.u16(0); c.u32(0); c.u32(this.off); c.bytes(nm);
      this.central.push(c.done()); this.off += hb.length + body.length; this.count++;
    }
    async finish() {
      const cd = concat(this.central);
      const e = new Out(22); e.u32(0x06054b50); e.u16(0); e.u16(0); e.u16(this.count); e.u16(this.count); e.u32(cd.length); e.u32(this.off); e.u16(0);
      await this.store.write(cd); await this.store.write(e.done());
      return this.store.close();
    }
  }
  // LevelDB writer. Each addSorted() run is written as small tables on its own level, so runs from
  // different worlds never have to be merged in memory. Keys must be unique across runs.
  class DBWriter {
    constructor(zip) { this.zip = zip; this.seq = 0; this.fileNo = 2; this.tables = []; }
    async addSorted(entries, level, progress) {
      let batch = [], bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        const data = await buildTable(batch); const num = this.fileNo++;
        await this.zip.add('db/' + String(num).padStart(6, '0') + '.ldb', data, false);
        this.tables.push({ num, level, size: data.length, smallest: batch[0][0], largest: batch[batch.length - 1][0] });
        batch = []; bytes = 0;
      };
      for (let i = 0; i < entries.length; i++) {
        const [k, v] = entries[i]; this.seq++;
        const ik = new Uint8Array(k.length + 8); ik.set(k);
        new DataView(ik.buffer).setBigUint64(k.length, BigInt(this.seq) * 256n + 1n, true);
        batch.push([ik, v]); bytes += k.length + v.length + 16;
        entries[i] = null;
        if (bytes > 2 * 1024 * 1024) { await flush(); progress && progress(i / entries.length); }
      }
      await flush();
    }
    async finish() {
      const logNo = this.fileNo++; const nextFile = this.fileNo;
      const ve = new Out(4096);
      ve.varint(1); ve.lstr(enc.encode('leveldb.BytewiseComparator'));
      ve.varint(2); ve.varint(logNo); ve.varint(9); ve.varint(0);
      ve.varint(3); ve.varint(nextFile); ve.varint(4); ve.varint(this.seq);
      for (const t of this.tables) { ve.varint(7); ve.varint(t.level); ve.varint(t.num); ve.varint(t.size); ve.lstr(t.smallest); ve.lstr(t.largest); }
      await this.zip.add('db/MANIFEST-000001', logFile([ve.done()]), true);
      await this.zip.add('db/CURRENT', enc.encode('MANIFEST-000001\n'), false);
      await this.zip.add('db/' + String(logNo).padStart(6, '0') + '.log', new Uint8Array(0), false);
    }
  }

  // ---------- gather what a world contributes
  // chunkMap: Map("dim|x|z" -> {dx, dz}) chunk offsets for every kept chunk.
  async function gather(world, chunkMap, wantPlayer, progress, wantGlobals) {
    const globals = new Map(); const skipped = { count: 0, names: new Set() };
    const keep = new Map(); // latin key -> {seq, del, v}
    const put = (k, seq, del, v) => { const s = latin(k); const old = keep.get(s); if (!old || seq > old.seq) keep.set(s, { seq, del, v: del ? null : v.slice() }); };
    const actors = new Map();
    await readLevelDBRaw(world, (k, seq, del, v) => {
      const ck = C.parseChunkKey(k);
      if (ck) { if (chunkMap.has(ck.dim + '|' + ck.x + '|' + ck.z)) put(k, seq, del, v); return; }
      if (k.length === 19 && startsWith(k, ACTOR)) { const s = latin(k); const old = actors.get(s); if (!old || seq > old.seq) actors.set(s, { seq, del, v: del ? null : v.slice() }); return; }
      if ((k.length === 12 || k.length === 16) && startsWith(k, DIGP)) {
        const dim = k.length === 16 ? i32(k, 12) : 0;
        if (chunkMap.has(dim + '|' + i32(k, 4) + '|' + i32(k, 8))) put(k, seq, del, v);
        return;
      }
      if (k.length === 28 && dec.decode(k) === 'LevelChunkMetaDataDictionary') { put(k, seq, del, v); return; }
      if (wantPlayer && k.length === 13 && dec.decode(k) === '~local_player') { put(k, seq, del, v); return; }
      if (!wantGlobals) { // an exhibit world's maps, portals, villages and so on stay behind
        if (!del && !(k.length === 12 && dec.decode(k) === 'world_museum'.slice(0, 12))) { skipped.count++; if (skipped.names.size < 8) skipped.names.add(globalName(k)); }
        return;
      }
      { // a backdrop keeps everything else too: maps, portals, villages, scoreboard and so on
        const s = latin(k);
        if (s === '~local_player' || s === 'world_museum') return;
        const old = globals.get(s); if (!old || seq > old.seq) globals.set(s, { seq, v: del ? null : v.slice() });
      }
    }, progress);
    return { keep, actors, globals, skipped, stats: lastReadStats };
  }
  let lastReadStats = null;
  // A readable label for a world-wide key: its text if it's text, otherwise its leading letters.
  function globalName(k) { let s = ''; for (const c of k) { if (c >= 32 && c < 127) s += String.fromCharCode(c); else break; } return s.replace(/[_\d]+$/, '') || 'binary key'; }
  async function readLevelDBRaw(world, onRecord, progress) {
    // reuse the reader from core via a tiny shim
    lastReadStats = await C._readLevelDB(world, onRecord, progress); return lastReadStats;
  }

  function parseMetaDict(v) {
    try {
      const n = (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0; let p = 4; const out = [];
      for (let i = 0; i < n; i++) { const h = latin(v.subarray(p, p + 8)); const start = p + 8; const r = C.readNBT(v, start); out.push([h, v.slice(start, r.end)]); p = r.end; }
      return p === v.length ? out : null;
    } catch (e) { return null; }
  }

  // Flat surroundings. Bedrock flat worlds start at Y -64; every preset tops out at sea level (water at 62, land at 63).
  const L = (name, count) => ({ block_name: 'minecraft:' + name, count });
  const SURROUNDINGS = {
    ocean: { biome: 0, layers: [L('bedrock', 1), L('stone', 101), L('sand', 2), L('water', 23)] },
    warm_ocean: { biome: 40, layers: [L('bedrock', 1), L('stone', 99), L('sandstone', 2), L('sand', 2), L('water', 23)] },
    frozen_ocean: { biome: 46, layers: [L('bedrock', 1), L('stone', 101), L('gravel', 2), L('water', 22), L('ice', 1)] },
    plains: { biome: 1, layers: [L('bedrock', 1), L('stone', 124), L('dirt', 2), L('grass_block', 1)] },
    desert: { biome: 2, layers: [L('bedrock', 1), L('stone', 121), L('sandstone', 3), L('sand', 3)] },
    mushroom: { biome: 14, layers: [L('bedrock', 1), L('stone', 124), L('dirt', 2), L('mycelium', 1)] },
    void: { biome: 1, layers: [L('air', 1)] }
  };
  const flatLayers = kind => {
    const p = SURROUNDINGS[kind] || SURROUNDINGS.ocean;
    return JSON.stringify({ biome_id: p.biome, block_layers: p.layers, encoding_version: 6, structure_options: null, world_version: 'version.post_1_18' });
  };
  const FLAT_LAYERS = flatLayers('ocean');

  /*
   plan = {
     name, gap, keepPlayer,
     groups: [{ id, world (scan result with .src {fs,dir,dbFiles,sourceName}), dim, chunks:[[x,z]] source coords, offset:[dx,dz] chunk delta }]
     spawn: {x,y,z} block coords in the new world (overworld)
   }
  */
  // ---------- block-level edge cutting
  // A smooth outline is traced through the outermost chunks: the chunk mask is blurred with a
  // Gaussian (σ = 6 blocks) and columns below 0.75 are cut. Straight edges lose about four blocks,
  // corners and staircases become curves, and the curve never leaves the kept chunks.
  const CUT_KINDS = new Set(['ocean', 'warm_ocean', 'desert', 'void']);
  const SIG = 6, THRESH = 0.75;
  let AW = null;
  function chunkWeights() {
    if (AW) return AW;
    const g = b => Math.exp(-b * b / (2 * SIG * SIG)); let tot = 0; for (let b = -48; b <= 48; b++) tot += g(b);
    AW = [];
    for (let p = 0; p < 16; p++) { const row = []; for (let d = -2; d <= 2; d++) { let s = 0; for (let b = d * 16; b < d * 16 + 16; b++) s += g(b - p); row.push(s / tot); } AW.push(row); }
    return AW;
  }
  // chunks: [[x,z]] -> Map("x,z" -> Uint8Array(256) of columns to cut, index lx*16+lz)
  // Coherent value noise in source block coordinates: a broad wobble plus finer jaggedness, so curved
  // edges look weathered rather than drawn with compasses. Same input, same coastline, every time.
  function hash2(x, z) { let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vnoise(x, z, s) {
    const fx = x / s, fz = z / s, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const u = tx * tx * (3 - 2 * tx), w = tz * tz * (3 - 2 * tz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    const top = a + (b - a) * u, bot = c + (d - c) * u; return top + (bot - top) * w;
  }
  const edgeNoise = (x, z) => (vnoise(x, z, 11) - 0.5) * 1.4 + (vnoise(x + 977, z - 313, 4.5) - 0.5) * 0.7 + (vnoise(x - 51, z + 733, 2) - 0.5) * 0.3;
  const ROUGH = [0, 0.12, 0.22];
  function planCuts(chunks, rough = 0) {
    const amp = ROUGH[rough] || 0;
    const A = chunkWeights(); const set = new Set(chunks.map(([x, z]) => x + ',' + z)); const out = new Map();
    for (const [x, z] of chunks) {
      const m = new Float32Array(25); let full = true;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const h = set.has((x + dx) + ',' + (z + dz)) ? 1 : 0; m[(dx + 2) * 5 + dz + 2] = h; if (!h) full = false; }
      if (full) continue;
      const cut = new Uint8Array(256); let any = false;
      for (let px = 0; px < 16; px++) for (let pz = 0; pz < 16; pz++) {
        let v = 0;
        for (let dx = 0; dx < 5; dx++) { const ax = A[px][dx]; if (ax < 1e-6) continue; for (let dz = 0; dz < 5; dz++) if (m[dx * 5 + dz]) v += ax * A[pz][dz]; }
        if (v < THRESH + (amp ? amp * edgeNoise(x * 16 + px, z * 16 + pz) : 0)) { cut[px * 16 + pz] = 1; any = true; }
      }
      if (any) out.set(x + ',' + z, cut);
    }
    return out;
  }
  function fillNameAt(kind, y) {
    let top = -65;
    for (const l of SURROUNDINGS[kind].layers) { if (y <= top + l.count) return l.block_name; top += l.count; }
    return 'minecraft:air';
  }
  function fillTop(kind) { let top = -65, last = -999; for (const l of SURROUNDINGS[kind].layers) { top += l.count; if (l.block_name !== 'minecraft:air') last = top; } return last; }
  const FALLBACK = { 'minecraft:sand': ['minecraft:sand', 'minecraft:gravel', 'minecraft:stone'], 'minecraft:sandstone': ['minecraft:sandstone', 'minecraft:sand', 'minecraft:stone'], 'minecraft:gravel': ['minecraft:gravel', 'minecraft:stone'] };
  const SYNTH_STATES = { 'minecraft:air': [], 'minecraft:water': [['liquid_depth', { t: 3, v: 0 }]], 'minecraft:bedrock': [['infiniburn_bit', { t: 1, v: 0 }]], 'minecraft:stone': [] };
  function stateOk(name, st) {
    st = st || {};
    if (name === 'minecraft:water') return (st.liquid_depth ?? 0) === 0;
    if (name === 'minecraft:stone') return !st.stone_type || st.stone_type === 'stone';
    if (name === 'minecraft:sand') return !st.sand_type || st.sand_type === 'normal';
    if (name === 'minecraft:sandstone') return !st.sand_stone_type || st.sand_stone_type === 'default';
    return true;
  }
  function decodeSub(v) {
    const ver = v[0]; let n, p, y = null;
    if (ver === 1) { n = 1; p = 1; } else if (ver === 8) { n = v[1]; p = 2; } else if (ver === 9) { n = v[1]; y = v[2]; p = 3; } else return null;
    const layers = [];
    for (let s = 0; s < n; s++) {
      const hdr = v[p++]; if (hdr & 1) return null;
      const bits = hdr >> 1; const idx = new Uint16Array(4096); let plen = 1;
      if (bits > 0) {
        const vpw = Math.floor(32 / bits), words = Math.ceil(4096 / vpw), mask = (1 << bits) - 1;
        for (let i = 0; i < 4096; i++) { const w = (v[p + ((i / vpw) | 0) * 4] | (v[p + ((i / vpw) | 0) * 4 + 1] << 8) | (v[p + ((i / vpw) | 0) * 4 + 2] << 16) | (v[p + ((i / vpw) | 0) * 4 + 3] << 24)) >>> 0; idx[i] = (w >>> ((i % vpw) * bits)) & mask; }
        p += words * 4; plen = (v[p] | (v[p + 1] << 8) | (v[p + 2] << 16) | (v[p + 3] << 24)) >>> 0; p += 4;
      }
      const pal = [], vals = [];
      for (let i = 0; i < plen; i++) { const r = C.readNBT(v, p); pal.push(v.slice(p, r.end)); vals.push(r.value || {}); p = r.end; }
      layers.push({ pal, vals, idx });
    }
    return { ver, y, layers };
  }
  function encodeSub(d, sub) {
    const o = new Out(8192);
    const ver = d.ver === 9 ? 9 : 8;
    o.u8(ver); o.u8(d.layers.length); if (ver === 9) o.u8(sub & 0xff);
    for (const L of d.layers) {
      const used = new Uint8Array(L.pal.length); for (let i = 0; i < 4096; i++) used[L.idx[i]] = 1;
      const remap = new Int32Array(L.pal.length).fill(-1); const pal = [];
      for (let i = 0; i < L.pal.length; i++) if (used[i]) { remap[i] = pal.length; pal.push(L.pal[i]); }
      let bits = 1; for (const b of [1, 2, 3, 4, 5, 6, 8, 16]) { bits = b; if ((1 << b) >= pal.length) break; }
      const vpw = Math.floor(32 / bits), words = Math.ceil(4096 / vpw);
      o.u8(bits << 1);
      const w = new Uint32Array(words);
      for (let i = 0; i < 4096; i++) w[(i / vpw) | 0] |= (remap[L.idx[i]] << ((i % vpw) * bits)) >>> 0;
      for (let i = 0; i < words; i++) o.u32(w[i]);
      o.u32(pal.length); for (const e of pal) o.bytes(e);
    }
    return o.done();
  }
  // Rewrites the cut columns of one chunk (records: [{ck, v}]) with the surroundings' layers.
  function cutChunk(recs, cut, kind, d3Offset, samples) {
    const subs = new Map(); let sampleVersion = null;
    for (const r of recs) if (r.ck.tag === 47) { const d = decodeSub(r.v); if (!d) return { recs, cut: 0, protectedCols: 0 }; subs.set(r.ck.sub, d); }
    if (!subs.size) return { recs, cut: 0, protectedCols: 0 };
    // never cut a column holding anything crafted or any block entity
    const prot = new Uint8Array(256);
    for (const d of subs.values()) for (const L of d.layers) {
      const crafted = L.vals.map(v => { if (sampleVersion === null && typeof v.version === 'number') sampleVersion = v.version; return C.craftWeight(String(v.name || '')) > 0; });
      if (!crafted.some(Boolean)) continue;
      for (let i = 0; i < 4096; i++) if (crafted[L.idx[i]]) prot[i >> 4] = 1;
    }
    for (const r of recs) if (r.ck.tag === 49) { try { for (const be of C.readNBTMany(r.v)) if (Number.isFinite(be.x) && Number.isFinite(be.z)) prot[(be.x & 15) * 16 + (be.z & 15)] = 1; } catch (e) {} }
    const fin = new Uint8Array(256); let nCut = 0, nProt = 0;
    for (let c = 0; c < 256; c++) if (cut[c]) { if (prot[c]) nProt++; else { fin[c] = 1; nCut++; } }
    if (!nCut) return { recs, cut: 0, protectedCols: nProt };
    const cols = []; for (let c = 0; c < 256; c++) if (fin[c]) cols.push(c);
    // palette pool from this chunk, for block names valid in this world's version
    const pool = [];
    for (const d of subs.values()) for (let i = 0; i < d.layers[0].pal.length; i++) pool.push({ raw: d.layers[0].pal[i], v: d.layers[0].vals[i] });
    const version = sampleVersion ?? 18100737;
    const synth = name => writeTyped({ t: 10, v: [['name', { t: 8, v: name }], ['states', { t: 10, v: SYNTH_STATES[name] || [] }], ['version', { t: 3, v: version }]] });
    const findIn = (L, name) => { for (let i = 0; i < L.vals.length; i++) if (L.vals[i].name === name && stateOk(name, L.vals[i].states)) return i; return -1; };
    const indexFor = (L, want) => {
      L.cache = L.cache || {}; if (L.cache[want] !== undefined) return L.cache[want];
      const chain = FALLBACK[want] || [want];
      for (const name of chain) {
        let i = findIn(L, name); if (i >= 0) return (L.cache[want] = i);
        const pe = pool.find(e => e.v.name === name && stateOk(name, e.v.states));
        if (pe) { L.pal.push(pe.raw); L.vals.push(pe.v); return (L.cache[want] = L.pal.length - 1); }
        const ws = samples && samples.get(name);
        if (ws) { L.pal.push(ws.raw); L.vals.push(C.readNBT(ws.raw).value); return (L.cache[want] = L.pal.length - 1); }
      }
      const name = SYNTH_STATES[want] ? want : 'minecraft:stone';
      synthCount++;
      const raw = synth(name); L.pal.push(raw); L.vals.push(C.readNBT(raw).value); return (L.cache[want] = L.pal.length - 1);
    };
    const top = fillTop(kind);
    const touched = new Set();
    for (let si = -4; si < 20; si++) {
      let d = subs.get(si);
      const needs = si * 16 <= top;
      if (!d) {
        if (!needs) continue;
        const air = synth('minecraft:air');
        d = { ver: 9, y: si, layers: [{ pal: [air], vals: [C.readNBT(air).value], idx: new Uint16Array(4096) }] };
        subs.set(si, d);
      }
      const L0 = d.layers[0];
      for (let y = 0; y < 16; y++) {
        const ix = indexFor(L0, fillNameAt(kind, si * 16 + y));
        for (const c of cols) L0.idx[(c << 4) | y] = ix;
      }
      for (let li = 1; li < d.layers.length; li++) { const L = d.layers[li]; const ax = indexFor(L, 'minecraft:air'); for (const c of cols) for (let y = 0; y < 16; y++) L.idx[(c << 4) | y] = ax; }
      touched.add(si);
    }
    const out = [];
    const base = recs[0].ck;
    for (const r of recs) {
      if (r.ck.tag === 47) { if (!touched.has(r.ck.sub)) out.push(r); continue; }
      if (r.ck.tag === 43 && r.v.length >= 512) {
        const v = r.v.slice(); const dv = new DataView(v.buffer);
        const raw = (top < -64 ? -64 : top + 1) - d3Offset;
        for (const c of cols) { const lx = c >> 4, lz = c & 15; dv.setInt16((lz * 16 + lx) * 2, raw, true); }
        out.push({ ck: r.ck, v }); continue;
      }
      out.push(r);
    }
    for (const si of touched) out.push({ ck: { x: base.x, z: base.z, dim: base.dim, tag: 47, sub: si }, v: encodeSub(subs.get(si), si) });
    return { recs: out, cut: nCut, protectedCols: nProt };
  }

  // ---------- preservation report
  // Three severities: info (expected behaviour), warn (unfamiliar data or an unconfirmed assumption),
  // error (something meant to be kept that didn't make it into the finished world).
  function newReport() {
    const items = new Map();
    const R = {
      note(sev, code, title, detail, example, n = 1) {
        let it = items.get(code); if (!it) { it = { sev, code, title, detail, count: 0, examples: [] }; items.set(code, it); }
        it.count += n; if (example !== undefined && it.examples.length < 6 && !it.examples.includes(example)) it.examples.push(example);
      },
      list() { const order = { error: 0, warn: 1, info: 2 }; return [...items.values()].sort((a, b) => order[a.sev] - order[b.sev]); },
      totals() { const t = { error: 0, warn: 0, info: 0 }; for (const it of items.values()) t[it.sev]++; return t; }
    };
    return R;
  }
  // 52-bit key hashes (two FNV variants) and 32-bit value hashes, for the read-back comparison.
  function fnv(u8, seed) { let h = seed >>> 0; for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); } h ^= u8.length; return h >>> 0; }
  const hashKey = k => fnv(k, 0x811c9dc5) * 2097152 + (fnv(k, 0x01000193) & 0x1fffff);
  const hashVal = v => fnv(v, 0x811c9dc5);
  // Parts of the format this tool writes from current understanding rather than a confirmed round trip
  // through Minecraft. Each is reported, while it applies, until confirmed in game.
  const ASSUMPTIONS = {
    heights: ['Heightmaps', 'Chunk heights are read and written as measured from the bottom of the world in newer worlds (detected per world). Used for trimmed edges, hub stations and new chunks.'],
    commandVersion: ['Command block version', 'Command blocks are written with command version ' + 38 + ', expected to accept today’s command syntax, including “execute in … run tp”.'],
    hubBlocks: ['Hub block names', 'Command blocks, stone buttons and standing signs are written with the block names and states current Minecraft uses (“minecraft:standing_sign” for oak signs).'],
    signFormat: ['Sign text format', 'Hub signs store their text in both the current front-text format and the older single-text format.'],
    voidLayers: ['Void surroundings', 'The void preset is a flat world whose only layer is air.'],
    newChunks: ['New chunks', 'Chunks built from scratch (open surroundings under the hub) copy their version and generation-state records from a chunk of the base world.'],
    synthBlocks: ['Blocks written from scratch', 'Some blocks had no example in the world to copy, so their names and states were written from current understanding.'],
    metaDict: ['Chunk metadata dictionary', 'The world-wide dictionary that newer chunks refer to was merged from several worlds, assuming its current layout.'],
    actorIds: ['Mob and object IDs', 'IDs of mobs and objects from different worlds were kept apart by altering one byte of each ID.']
  };
  function assumptionsFor(flags) { return Object.entries(ASSUMPTIONS).filter(([k]) => flags[k]).map(([code, [title, detail]]) => ({ code: 'assume-' + code, title, detail })); }
  let synthCount = 0;
  const textOf = be => { const f = be.FrontText && typeof be.FrontText.Text === 'string' ? be.FrontText.Text : (typeof be.Text === 'string' ? be.Text : undefined); return f; };
  const itemsOf = be => Array.isArray(be.Items) ? be.Items.filter(i => i && i.Count).length : undefined;

  // ---------- placed structures: transporter hub and return pads
  // plan.structures.blocks: [{dim, x, y, z, kind: 'cmd'|'button'|'sign'|'stone'|'air', cmd, text, face, rot}]
  // in museum block coordinates. Blocks landing in kept chunks are written into those chunks; blocks
  // landing in open surroundings get new chunks built from the surroundings' layers.
  const CMD_VERSION = 38;
  function commandBlockBE(x, y, z, cmd) {
    const T = (t, v) => ({ t, v });
    return writeTyped({ t: 10, v: [['id', T(8, 'CommandBlock')], ['x', T(3, x)], ['y', T(3, y)], ['z', T(3, z)], ['isMovable', T(1, 1)],
      ['Command', T(8, cmd)], ['CustomName', T(8, '')], ['ExecuteOnFirstTick', T(1, 0)], ['LPCommandMode', T(3, 0)], ['LPCondionalMode', T(1, 0)],
      ['LPRedstoneMode', T(1, 0)], ['LastExecution', T(4, 0n)], ['LastOutput', T(8, '')], ['LastOutputParams', T(9, { et: 8, items: [] })],
      ['SuccessCount', T(3, 0)], ['TickDelay', T(3, 0)], ['TrackOutput', T(1, 1)], ['Version', T(3, CMD_VERSION)], ['auto', T(1, 0)],
      ['conditionMet', T(1, 0)], ['conditionalMode', T(1, 0)], ['powered', T(1, 0)]] });
  }
  function signBE(x, y, z, text) {
    const T = (t, v) => ({ t, v });
    const side = s => T(10, [['Text', T(8, s)], ['SignTextColor', T(3, -16777216)], ['IgnoreLighting', T(1, 0)], ['HideGlowOutline', T(1, 0)], ['PersistFormatting', T(1, 1)], ['TextOwner', T(8, '')], ['FilteredText', T(8, '')]]);
    return writeTyped({ t: 10, v: [['id', T(8, 'Sign')], ['x', T(3, x)], ['y', T(3, y)], ['z', T(3, z)], ['isMovable', T(1, 1)], ['IsWaxed', T(1, 1)], ['FrontText', side(text)], ['BackText', side('')], ['Text', T(8, text)]] });
  }
  const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  function placeInChunk(recs, blocks, samples, base) {
    const subs = new Map(); let version = null;
    for (const r of recs) if (r.ck.tag === 47) { const d = decodeSub(r.v); if (!d) throw new Error('unreadable subchunk'); subs.set(r.ck.sub, d); for (const v of d.layers[0].vals) if (version === null && typeof v.version === 'number') version = v.version; }
    version = version ?? 18100737;
    const syn = (name, states) => writeTyped({ t: 10, v: [['name', { t: 8, v: name }], ['states', { t: 10, v: states }], ['version', { t: 3, v: version }]] });
    const T = (t, v) => ({ t, v });
    const rawFor = b => {
      if (b.kind === 'stone') { const sm = samples && samples.get('minecraft:stone'); if (sm) return sm.raw; synthCount++; return syn('minecraft:stone', []); }
      if (b.kind === 'air') return syn('minecraft:air', []);
      if (b.kind === 'cmd') return syn('minecraft:command_block', [['conditional_bit', T(1, 0)], ['facing_direction', T(3, 1)]]);
      if (b.kind === 'button') return syn('minecraft:stone_button', [['button_pressed_bit', T(1, 0)], ['facing_direction', T(3, b.face)]]);
      if (b.kind === 'sign') return syn('minecraft:standing_sign', [['ground_sign_direction', T(3, b.rot || 0)]]);
      throw new Error('unknown block ' + b.kind);
    };
    const airRaw = syn('minecraft:air', []);
    const bes = []; const touched = new Set();
    for (const b of blocks) {
      const si = Math.floor(b.y / 16), ly = ((b.y % 16) + 16) % 16, lx = ((b.x % 16) + 16) % 16, lz = ((b.z % 16) + 16) % 16;
      let d = subs.get(si);
      if (!d) { d = { ver: 9, y: si, layers: [{ pal: [airRaw], vals: [C.readNBT(airRaw).value], idx: new Uint16Array(4096) }] }; subs.set(si, d); }
      const raw = rawFor(b); const L0 = d.layers[0];
      let ix = L0.pal.findIndex(p => sameBytes(p, raw));
      if (ix < 0) { L0.pal.push(raw); L0.vals.push(C.readNBT(raw).value); ix = L0.pal.length - 1; }
      const at = (lx << 8) | (lz << 4) | ly; L0.idx[at] = ix;
      for (let li = 1; li < d.layers.length; li++) { const L = d.layers[li]; let a = L.vals.findIndex(v => v.name === 'minecraft:air'); if (a < 0) { L.pal.push(airRaw); L.vals.push(C.readNBT(airRaw).value); a = L.pal.length - 1; } L.idx[at] = a; }
      touched.add(si);
      if (b.kind === 'cmd') bes.push(commandBlockBE(b.x, b.y, b.z, b.cmd));
      if (b.kind === 'sign') bes.push(signBE(b.x, b.y, b.z, b.text));
    }
    const out = [];
    let beDone = false;
    for (const r of recs) {
      if (r.ck.tag === 47 && touched.has(r.ck.sub)) continue;
      if (r.ck.tag === 49 && bes.length) { out.push({ ck: r.ck, v: concat([r.v, ...bes]) }); beDone = true; continue; }
      out.push(r);
    }
    for (const si of touched) out.push({ ck: { x: base.x, z: base.z, dim: base.dim, tag: 47, sub: si }, v: encodeSub(subs.get(si), si) });
    if (bes.length && !beDone) out.push({ ck: { x: base.x, z: base.z, dim: base.dim, tag: 49, sub: null }, v: concat(bes) });
    return out;
  }
  // A brand-new chunk made of the surroundings' layers (open sea, desert, void and so on).
  function makeSurroundChunk(kind, cx, cz, samples, d3Offset, verRec, finRec) {
    const air = writeTyped({ t: 10, v: [['name', { t: 8, v: 'minecraft:air' }], ['states', { t: 10, v: [] }], ['version', { t: 3, v: 18100737 }]] });
    const sub0 = encodeSub({ ver: 9, y: 0, layers: [{ pal: [air], vals: [C.readNBT(air).value], idx: new Uint16Array(4096) }] }, 0);
    const d3 = new Out(600); for (let i = 0; i < 256; i++) d3.u16(0); d3.u8(1); d3.i32(SURROUNDINGS[kind].biome); for (let i = 0; i < 23; i++) d3.u8(0xff);
    const ck = t => ({ x: cx, z: cz, dim: 0, tag: t, sub: t === 47 ? 0 : null });
    let recs = [{ ck: ck(44), v: verRec || new Uint8Array([40]) }, { ck: ck(54), v: finRec || new Uint8Array([2, 0, 0, 0]) }, { ck: ck(43), v: d3.done() }, { ck: ck(47), v: sub0 }];
    if (kind !== 'void') recs = cutChunk(recs, new Uint8Array(256).fill(1), kind, d3Offset, samples).recs;
    return recs;
  }

  // ---------- self-check: re-read the finished world and compare it with what was meant to be written
  function describeKey(k) {
    const ck = C.parseChunkKey(k);
    if (ck) return `chunk ${ck.x}, ${ck.z}${ck.dim ? ' (' + ['', 'Nether', 'End'][ck.dim] + ')' : ''}, record type ${ck.tag}`;
    if (k.length === 19 && startsWith(k, ACTOR)) return 'mob or object ' + hexOf(k.subarray(11));
    return globalName(k);
  }
  async function verifyWorld(blob, expect, plan, R, progress) {
    const fs = await C.openZip(blob); const w = C.findWorlds(fs, 'museum')[0];
    if (!w) { R.note('error', 'verify-open', 'The finished world couldn’t be reopened', 'The self-check couldn’t find the world inside the file it just wrote.'); return null; }
    const seen = new Set(); let records = 0, extra = 0, mism = 0, subs = 0, subFail = 0;
    const beFound = new Set(); let beWrong = 0, beOutside = 0; const actorIds = new Set(); let dupActors = 0, actorOk = 0; const digp = []; let playerOk = null;
    const counts = { sign: 0, container: 0, command: 0, other: 0 };
    const stats = await C._readLevelDB(w, (k, seq, del, v) => {
      if (del) return; records++;
      const kh = hashKey(k); const ev = expect.kv.get(kh);
      if (ev === undefined) { extra++; R.note('error', 'verify-extra', 'Unexpected records in the finished world', 'The finished world holds records this build didn’t intend to write.', describeKey(k)); }
      else { seen.add(kh); if (ev !== hashVal(v)) { mism++; R.note('error', 'verify-mismatch', 'Records that came back different', 'Reading the finished world back gave different data from what was written.', describeKey(k)); } }
      const ck = C.parseChunkKey(k);
      if (ck && ck.tag === 47 && (v[0] === 1 || v[0] === 8 || v[0] === 9)) { subs++; let ok = false; try { ok = !!decodeSub(v); } catch (e) {} if (!ok) { subFail++; R.note('error', 'verify-subchunk', 'Unreadable block data', 'Block data in the finished world couldn’t be decoded.', describeKey(k)); } }
      if (ck && ck.tag === 49) {
        let list = []; try { list = C.readNBTMany(v); } catch (e) { R.note('error', 'verify-be-read', 'Unreadable block data records', 'Signs, chests or similar records in the finished world couldn’t be read back.', describeKey(k)); }
        for (const be of list) {
          if (Math.floor(be.x / 16) !== ck.x || Math.floor(be.z / 16) !== ck.z) { beOutside++; R.note('error', 'verify-be-outside', 'Blocks filed in the wrong chunk', 'A sign, chest or similar record says it’s somewhere other than the chunk it’s stored in, so Minecraft may ignore it.', `${be.id} at ${be.x} ${be.y} ${be.z}`); }
          const key = `${ck.dim}|${be.x}|${be.y}|${be.z}`; const e = expect.be.get(key); if (!e) continue;
          const ok = e.id === be.id && (e.text === undefined || e.text === textOf(be)) && (e.items === undefined || e.items === itemsOf(be)) && (e.cmd === undefined || e.cmd === be.Command);
          if (ok) { beFound.add(key); if (e.id === 'CommandBlock') counts.command++; else if (e.text !== undefined) counts.sign++; else if (e.items) counts.container++; else counts.other++; }
          else { beWrong++; R.note('error', 'verify-be-wrong', 'Signs, chests or similar that changed', 'Text, contents or type differ from the original.', `${be.id} at ${be.x} ${be.y} ${be.z} (from ${e.from})`); }
        }
      }
      if (k.length === 19 && startsWith(k, ACTOR)) {
        const id = hexOf(k.subarray(11)); if (actorIds.has(id)) dupActors++; actorIds.add(id);
        const e = expect.actors.get(id);
        if (e) { let pos = null; try { pos = (C.readNBT(v).value || {}).Pos; } catch (er) {}
          if (Array.isArray(pos) && pos.every((p, i) => Math.fround(p) === e.pos[i])) actorOk++;
          else R.note('error', 'verify-actor-pos', 'Mobs or objects in the wrong place', 'A mob or object isn’t where it should have moved to.', e.from); }
      }
      if ((k.length === 12 || k.length === 16) && startsWith(k, DIGP)) for (let p = 0; p + 8 <= v.length; p += 8) digp.push(hexOf(v.subarray(p, p + 8)));
      if (k.length === 13 && dec.decode(k) === '~local_player' && expect.player) { try { const pos = C.readNBT(v).value.Pos; playerOk = pos.every((p, i) => Math.fround(p) === expect.player[i]); } catch (e) { playerOk = false; } }
    }, progress);
    const missing = expect.kv.size - seen.size;
    if (missing > 0) R.note('error', 'verify-missing', 'Records missing from the finished world', 'Records this build wrote couldn’t be found when the world was read back.', `${missing} record${missing === 1 ? '' : 's'}`, missing);
    for (const [key, e] of expect.be) if (!beFound.has(key)) { const [d, x, y, z] = key.split('|'); if (!beWrong) R.note('error', 'verify-be-missing', 'Signs, chests or similar not found', 'Expected at their new positions but not found there.', `${e.id} for ${x} ${y} ${z} (from ${e.from})`); }
    const orphan = digp.filter(id => !actorIds.has(id)).length;
    if (orphan) R.note('error', 'verify-digp', 'Chunks listing missing mobs', 'Chunks list mobs or objects that aren’t in the finished world.', `${orphan}`, orphan);
    if (dupActors) R.note('error', 'verify-dup', 'Mobs sharing an ID', 'Two mobs or objects ended up with the same ID; Minecraft may drop one.', `${dupActors}`, dupActors);
    const missingActors = expect.actors.size - actorOk; if (missingActors > 0 && !R.list().some(i => i.code === 'verify-actor-pos')) R.note('error', 'verify-actor-missing', 'Mobs or objects not found', 'Mobs or objects meant to be carried over weren’t found.', `${missingActors}`, missingActors);
    if (expect.player && playerOk === false) R.note('error', 'verify-player', 'Player position not as intended', 'Your player record came back with a different position.');
    if (expect.player && playerOk === null) R.note('error', 'verify-player', 'Player missing', 'Your player record wasn’t found in the finished world.');
    if (stats.badBlocks || stats.badFiles) R.note('error', 'verify-read', 'Parts of the finished world unreadable', 'The self-check couldn’t decode parts of the database it just wrote.', `${stats.badBlocks} blocks, ${stats.badFiles} files`);
    try {
      const ld = await fs.read(w.dir + 'level.dat'); const t = parseTyped(ld, 8).root; const nm = tget(t.v, 'LevelName');
      if (!nm || nm.v !== plan.name) R.note('error', 'verify-level', 'World settings not as intended', 'level.dat came back with a different name.');
      if ((plan.cheats) && !(tget(t.v, 'commandsEnabled') || {}).v) R.note('error', 'verify-level', 'World settings not as intended', 'Cheats were meant to be on.');
    } catch (e) { R.note('error', 'verify-level', 'World settings unreadable', 'level.dat couldn’t be read back.'); }
    const ok = !R.list().some(i => i.code.startsWith('verify-') && i.sev === 'error');
    const v = { records, subchunks: subs, blockEntities: beFound.size, signs: counts.sign, containers: counts.container, commandBlocks: counts.command, actors: actorOk, player: playerOk, ok };
    R.note('info', 'verify-done', 'Self-check', ok
      ? `The finished world was read back from the saved file: all ${records.toLocaleString()} records matched what was written, ${subs.toLocaleString()} block sections decoded, ${counts.sign} sign${counts.sign === 1 ? '' : 's'} kept their text, ${counts.container} container${counts.container === 1 ? '' : 's'} kept their contents${counts.command ? `, ${counts.command} command block${counts.command === 1 ? '' : 's'} have their commands` : ''}, and ${actorOk} mob${actorOk === 1 ? '' : 's'} and object${actorOk === 1 ? '' : 's'} are at their new positions.`
      : `The finished world was read back from the saved file (${records.toLocaleString()} records). See the problems listed above.`);
    return v;
  }
  // Copies a finished ZIP into a new one with extra files (the reports) added, without loading it whole.
  async function appendToZip(blob, files) {
    const size = blob.size; const tail = new Uint8Array(await blob.slice(Math.max(0, size - 65557)).arrayBuffer());
    let eocd = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { eocd = i; break; }
    const dv = new DataView(tail.buffer); const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    const cd = new Uint8Array(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()); const cdv = new DataView(cd.buffer);
    const store = await openStore('world-museum-final.zip'); const zipw = new ZipSink(store);
    let p = 0;
    for (let i = 0; i < count; i++) {
      const method = cdv.getUint16(p + 10, true), crc32 = cdv.getUint32(p + 16, true), csize = cdv.getUint32(p + 20, true), usize = cdv.getUint32(p + 24, true);
      const nlen = cdv.getUint16(p + 28, true), elen = cdv.getUint16(p + 30, true), clen = cdv.getUint16(p + 32, true), lho = cdv.getUint32(p + 42, true);
      const name = cd.slice(p + 46, p + 46 + nlen);
      const lh = new Uint8Array(await blob.slice(lho, lho + 30).arrayBuffer()); const start = lho + 30 + (lh[26] | (lh[27] << 8)) + (lh[28] | (lh[29] << 8));
      await zipw.addRaw(name, method, crc32, csize, usize, blob.slice(start, start + csize));
      p += 46 + nlen + elen + clen;
    }
    for (const f of files) await zipw.add(f.name, f.data, true);
    return zipw.finish();
  }
  function reportText(plan, R, report) {
    const t = R.totals(); const L = [];
    L.push(`World Museum preservation report`, `${plan.name}, built ${new Date().toLocaleString()}`, '');
    L.push(t.error ? `Result: ${t.error} problem${t.error === 1 ? '' : 's'} where something meant to be kept didn’t make it. Keep your original worlds.` : 'Result: no preservation loss found.');
    L.push(`${t.warn} warning${t.warn === 1 ? '' : 's'} (unfamiliar data or unconfirmed assumptions), ${t.info} note${t.info === 1 ? '' : 's'} (expected behaviour).`, '');
    for (const [sev, head] of [['error', 'PRESERVATION LOSS'], ['warn', 'WARNINGS'], ['info', 'INFORMATION']]) {
      const its = R.list().filter(i => i.sev === sev); if (!its.length) continue;
      L.push(head);
      for (const i of its) { L.push(`- ${i.title}${i.count > 1 ? ` (${i.count.toLocaleString()})` : ''}: ${i.detail}`); if (i.examples.length) L.push(`    e.g. ${i.examples.join('; ')}`); }
      L.push('');
    }
    return L.join('\n');
  }

  async function buildMuseum(plan, progress) {
    plan.surround = plan.surround || { kind: 'ocean' };
    const say = (msg, f) => progress && progress(msg, f);
    const worlds = [...new Set(plan.groups.map(g => g.world))];
    // the newest world provides level.dat and (optionally) the player
    const ver = W => (W.levelVersion || []).map(n => String(n).padStart(5, '0')).join('.');
    const base = plan.backdrop && worlds.includes(plan.backdrop) ? plan.backdrop : worlds.slice().sort((a, b) => ver(b).localeCompare(ver(a)))[0];
    const bd = plan.backdrop && worlds.includes(plan.backdrop) ? plan.backdrop : null;
    const R = newReport(); synthCount = 0;
    const expect = { kv: new Map(), be: new Map(), actors: new Map(), player: null };
    let run = []; let sabotage = 0;
    const add = (k, v) => {
      expect.kv.set(hashKey(k), hashVal(v));
      if (plan._testCorrupt && ++sabotage === plan._testCorrupt) { v = v.slice(); v[v.length - 1] ^= 0xff; } // test hook: proves the self-check notices damage
      run.push([k, v]);
    };
    for (const n of (plan.notes || [])) R.note(n.sev, n.code, n.title, n.detail, n.example, n.count || 1);
    const flags = {};
    let bdFlat = null; let metaWorlds = 0;
    const structByChunk = new Map(); const structUsed = new Set(); let sampleVer = null, sampleFin = null;
    for (const bk of ((plan.structures || {}).blocks || [])) {
      if (bk.kind === 'cmd') expect.be.set(`${bk.dim}|${bk.x}|${bk.y}|${bk.z}`, { id: 'CommandBlock', cmd: bk.cmd, from: 'hub' });
      if (bk.kind === 'sign') expect.be.set(`${bk.dim}|${bk.x}|${bk.y}|${bk.z}`, { id: 'Sign', text: bk.text, from: 'hub' }); const k = bk.dim + '|' + Math.floor(bk.x / 16) + '|' + Math.floor(bk.z / 16); if (!structByChunk.has(k)) structByChunk.set(k, []); structByChunk.get(k).push(bk); }
    // The base world goes first so its player id is known before other worlds' pets are re-owned.
    const order = [base, ...worlds.filter(w => w !== base)];
    const nb = Math.min(6, order.length); const bucketOf = i => Math.floor(i * nb / order.length);
    const store = await openStore(); const zipw = new ZipSink(store); const dbw = new DBWriter(zipw);
    const meta = new Map(); let rawMeta = null;
    let playerUid = null; let playerRaw = null;
    const chunkIds = new Set();
    const report = { chunks: 0, blockEntities: 0, actors: 0, worlds: worlds.length, droppedPlayer: false, keys: 0, cutColumns: 0, protectedColumns: 0, cutFailures: 0, placedBlocks: 0, placeFailures: 0, newChunks: 0 };

    for (let wi = 0; wi < order.length; wi++) {
      const W = order[wi]; const isBase = W === base;
      const chunkMap = new Map();
      for (const g of plan.groups) if (g.world === W) for (const [x, z] of g.chunks) chunkMap.set(g.dim + '|' + x + '|' + z, { dx: g.offset[0], dz: g.offset[1] });
      const placeMaps = new Map(); // source chunk id -> blocks in source coordinates
      for (const g of plan.groups) {
        if (g.world !== W) continue;
        for (const [x, z] of g.chunks) {
          const list = structByChunk.get(g.dim + '|' + (x + g.offset[0]) + '|' + (z + g.offset[1]));
          if (!list) continue;
          placeMaps.set(g.dim + '|' + x + '|' + z, list.map(bk => ({ ...bk, x: bk.x - g.offset[0] * 16, z: bk.z - g.offset[1] * 16 })));
          structUsed.add(g.dim + '|' + (x + g.offset[0]) + '|' + (z + g.offset[1]));
        }
      }
      const cutMaps = new Map();
      if (plan.cutEdges && CUT_KINDS.has((plan.surround || {}).kind)) {
        for (const g of plan.groups) if (g.world === W && g.dim === 0 && !g.backdrop) for (const [k, mask] of planCuts(g.chunks, plan.rough || 0)) cutMaps.set('0|' + k.replace(',', '|'), mask);
      }
      say(`Reading ${W.name} (${wi + 1} of ${worlds.length})`, 0);
      const { keep, actors, globals, skipped, stats: rs } = await gather(W.src, chunkMap, isBase && plan.keepPlayer, f => say(`Reading ${W.name} (${wi + 1} of ${worlds.length})`, f), W === bd);
      if (rs) {
        if (rs.badBlocks) R.note('error', 'read-blocks', 'Unreadable parts of an original world', 'Parts of the original database couldn’t be decoded, so anything stored in them is missing from the museum.', `${W.name}: ${rs.badBlocks} block${rs.badBlocks === 1 ? '' : 's'}`, rs.badBlocks);
        if (rs.badFiles) R.note('error', 'read-files', 'Unreadable database files', 'Some database files in an original world were damaged or not in the expected format.', `${W.name}: ${rs.badFiles}`, rs.badFiles);
        if (rs.missingTables) R.note('error', 'read-missing', 'Database files missing from a ZIP', 'The world’s index lists files the ZIP doesn’t contain. Re-zip the world folder with Minecraft closed.', `${W.name}: ${rs.missingTables}`, rs.missingTables);
        if (rs.badLogRecords) R.note('warn', 'read-log', 'Unreadable recent changes', 'Some recent changes in an original world’s log couldn’t be read; the last few moments of play may be missing.', W.name, rs.badLogRecords);
        if (!rs.usedManifest) R.note('warn', 'read-nomanifest', 'Database read without its index', 'A world’s index file couldn’t be used, so every database file was read. Old, replaced data could reappear.', W.name);
      }
      if (skipped && skipped.count) R.note('info', 'globals-skipped', 'World-wide records left behind', 'Maps, portal links, villages, scoreboards and other world-wide records from exhibit worlds aren’t brought into the museum. Only a backdrop keeps them.', `${W.name}: ${skipped.count} (${[...skipped.names].join(', ')})`, skipped.count);
      if (W === bd) for (const [ks, rec] of globals) if (rec.v && ks !== 'game_flatworldlayers') add(fromLatin(ks), rec.v);
      if (W === bd && globals.has('game_flatworldlayers') && globals.get('game_flatworldlayers').v) bdFlat = globals.get('game_flatworldlayers').v;
      const salt = BigInt(wi) << 48n; // keeps entity ids from different worlds apart
      const remap = id => (id === -1n ? id : id ^ salt);
      if (isBase && plan.keepPlayer) {
        const lp = keep.get('~local_player');
        if (lp && lp.v) { playerRaw = lp.v; try { const t = parseTyped(lp.v).root; const u = tget(t.v, 'UniqueID'); if (u) playerUid = u.v; } catch (e) {} }
      }
      const entityVisit = (bx, bz, ownerFix) => (path, t, off, dv) => {
        const n = path.length, k0 = path[0];
        if (k0 === 'Pos' && n === 2 && t === 5) { if (path[1] === 0) addF(dv, off, bx); else if (path[1] === 2) addF(dv, off, bz); }
        else if (t === 4 && n === 1 && (k0 === 'UniqueID' || k0 === 'LeasherID' || k0 === 'TargetID')) dv.setBigInt64(off, remap(dv.getBigInt64(off, true)), true);
        else if (t === 4 && n === 3 && k0 === 'LinksTag' && path[2] === 'entityID') dv.setBigInt64(off, remap(dv.getBigInt64(off, true)), true);
        else if (t === 4 && n === 1 && k0 === 'OwnerNew' && ownerFix !== null) { if (dv.getBigInt64(off, true) !== -1n) dv.setBigInt64(off, ownerFix, true); }
      };
      const ownerFix = (!isBase && playerUid !== null) ? playerUid : null;
      const neededActors = [];
      const emitChunkRec = (ck, v0) => {
          if (ck.dim === 0 && ck.tag === 44 && !sampleVer) sampleVer = v0.slice();
          if (ck.dim === 0 && ck.tag === 54 && !sampleFin) sampleFin = v0.slice();
          const m = chunkMap.get(ck.dim + '|' + ck.x + '|' + ck.z);
          const bx = m.dx * 16, bz = m.dz * 16;
          let v = v0;
          if (ck.tag === 57) { R.note('info', 'spawn-areas', 'Structure spawn areas', 'Records marking where witch-hut, fortress and similar mobs spawn hold fixed positions, so they aren’t moved. Those special spawns stop in moved exhibits.', W.name); return; }
          if (ck.unknown) R.note('warn', 'unknown-' + ck.tag, `Unfamiliar chunk record (type ${ck.tag})`, 'This chunk-level record type isn’t one this tool knows. It was copied unchanged; if it holds positions, they weren’t updated.', `${W.name} chunk ${ck.x}, ${ck.z}`);
          try {
            if (ck.tag === 49) {
              for (const be of C.readNBTMany(v0)) if (Number.isFinite(be.x) && Number.isFinite(be.z)) {
                const e = { id: be.id, text: textOf(be), items: itemsOf(be), cmd: typeof be.Command === 'string' ? be.Command : undefined, from: `${W.name} ${be.x} ${be.y} ${be.z}` };
                expect.be.set(`${ck.dim}|${be.x + bx}|${be.y}|${be.z + bz}`, e);
              }
              v = patchAll(v, (path, t, off, dv) => {
                const n = path.length, k0 = path[0];
                if (t === 3 && n === 1) {
                  if (k0 === 'x' || k0 === 'pairx' || k0 === 'pistonPosX') addI(dv, off, bx + (plan._testShift || 0)); // test hook: a deliberate coordinate bug
                  else if (k0 === 'z' || k0 === 'pairz' || k0 === 'pistonPosZ') addI(dv, off, bz);
                } else if (t === 3 && n === 2 && (k0 === 'AttachedBlocks' || k0 === 'BreakBlocks' || k0 === 'ExitPortal')) {
                  if (path[1] % 3 === 0) addI(dv, off, bx); else if (path[1] % 3 === 2) addI(dv, off, bz);
                }
              });
              report.blockEntities++;
            } else if (ck.tag === 50) {
              v = patchAll(v, entityVisit(bx, bz, ownerFix));
            } else if (ck.tag === 51 || ck.tag === 58) {
              v = patchAll(v, (path, t, off, dv) => { if (t === 3) { const last = path[path.length - 1]; if (last === 'x') addI(dv, off, bx); else if (last === 'z') addI(dv, off, bz); } });
            }
          } catch (e) { R.note('error', 'translate-failed', 'Records that couldn’t be moved safely', 'These records couldn’t be read well enough to update the positions inside them, so they were left out rather than written with wrong positions.', `${W.name} chunk ${ck.x}, ${ck.z} (type ${ck.tag})`); return; }
          chunkIds.add(ck.dim + '|' + (ck.x + m.dx) + '|' + (ck.z + m.dz));
          add(chunkKey(ck.x + m.dx, ck.z + m.dz, ck.dim, ck.tag, ck.sub), v);
      };
      const deferred = new Map(); // chunks whose edges get cut block by block
      for (const [ks, rec] of keep) {
        if (!rec.v) continue;
        const k = fromLatin(ks);
        const ck = C.parseChunkKey(k);
        if (ck) {
          const cid = ck.dim + '|' + ck.x + '|' + ck.z;
          if (cutMaps.has(cid) || placeMaps.has(cid)) { if (!deferred.has(cid)) deferred.set(cid, []); deferred.get(cid).push({ ck, v: rec.v }); continue; }
          emitChunkRec(ck, rec.v);
          continue;
        }
        if (startsWith(k, DIGP)) {
          const dim = k.length === 16 ? i32(k, 12) : 0;
          const x = i32(k, 4), z = i32(k, 8);
          const m = chunkMap.get(dim + '|' + x + '|' + z);
          const ids = new Out(rec.v.length || 8);
          for (let p = 0; p + 8 <= rec.v.length; p += 8) {
            const dv = new DataView(rec.v.buffer, rec.v.byteOffset + p, 8); const id = dv.getBigInt64(0, true);
            const a = actors.get(latin(ACTOR) + latin(rec.v.subarray(p, p + 8)));
            if (!a || !a.v) { R.note('warn', 'missing-actor', 'Mobs listed without data', 'A chunk listed mobs or objects whose data was already missing in the original world. Nothing to copy.', `${W.name} chunk ${x}, ${z}`); continue; }
            neededActors.push({ v: a.v, id: remap(id), bx: m.dx * 16, bz: m.dz * 16, from: `${W.name} chunk ${x}, ${z}` });
            ids.i64(remap(id));
          }
          const nk = new Out(16); nk.bytes(DIGP); nk.i32(x + m.dx); nk.i32(z + m.dz); if (dim) nk.i32(dim);
          add(nk.done(), ids.done());
          continue;
        }
        if (ks === 'LevelChunkMetaDataDictionary') {
          const d = parseMetaDict(rec.v);
          if (d) { for (const [h, nbt] of d) meta.set(h, nbt); metaWorlds++; } else { if (isBase) rawMeta = rec.v; R.note('warn', 'meta-raw', 'Unfamiliar chunk metadata layout', 'A world-wide chunk metadata record wasn’t in the expected layout. The base world’s copy was kept as it was; other worlds’ entries were not merged.', W.name); }
        }
      }
      for (const [cid, recs] of deferred) {
        let out = recs;
        if (cutMaps.has(cid)) {
          try { const r = cutChunk(recs, cutMaps.get(cid), plan.surround.kind, W.d3Offset || 0, W.blockSamples); out = r.recs; report.cutColumns += r.cut; report.protectedColumns += r.protectedCols; }
          catch (e) { out = recs; report.cutFailures++; R.note('error', 'cut-failed', 'Edges that couldn’t be curved', 'These chunks couldn’t be decoded for curving, so they were copied with straight edges.', `${W.name} chunk ${cid.split('|').slice(1).join(', ')}`); }
          flags.heights = true;
        }
        if (placeMaps.has(cid)) {
          try { out = placeInChunk(out, placeMaps.get(cid), W.blockSamples, out[0].ck); report.placedBlocks += placeMaps.get(cid).length; }
          catch (e) { report.placeFailures++; R.note('error', 'place-failed', 'Hub blocks that couldn’t be placed', 'The chunk for these hub blocks couldn’t be decoded, so the blocks are missing.', `chunk ${cid.split('|').slice(1).join(', ')}`); }
        }
        if (out !== recs) { const before = out.length; out = out.filter(r => r.ck.tag !== 59); if (out.length < before) R.note('info', 'checksums', 'Checksums in edited chunks', 'Older worlds keep checksum records per chunk. In chunks this tool edited, they were removed so Minecraft recalculates them.', `${W.name} chunk ${cid.split('|').slice(1).join(', ')}`); }
        for (const r of out) emitChunkRec(r.ck, r.v);
      }
      for (const a of neededActors) {
        try {
          const v = patchAll(a.v, entityVisit(a.bx, a.bz, ownerFix));
          const k = new Out(19); k.bytes(ACTOR); k.i64(a.id);
          const src = C.readNBT(a.v).value;
          if (src && Array.isArray(src.Pos)) expect.actors.set(hexOf(k.done().subarray(11)), { pos: [Math.fround(src.Pos[0] + a.bx), Math.fround(src.Pos[1]), Math.fround(src.Pos[2] + a.bz)], from: a.from });
          add(k.done(), v); report.actors++;
          if (wi > 0) flags.actorIds = true;
        } catch (e) { R.note('error', 'actor-failed', 'Mobs or objects that couldn’t be moved', 'Their data couldn’t be read well enough to update their positions, so they were left out.', a.from); }
      }
      keep.clear(); actors.clear();
      if (wi === order.length - 1 || bucketOf(wi + 1) !== bucketOf(wi)) {
        say(`Writing ${W.name} into the new world`, 0);
        run.sort((a, b) => cmpBytes(a[0], b[0])); report.keys += run.length;
        await dbw.addSorted(run, bucketOf(wi) + 1, f => say(`Writing ${W.name} into the new world`, f)); run = [];
      }
    }

    if (meta.size) {
      const o = new Out(1024); o.u32(meta.size);
      for (const [h, nbt] of meta) { o.bytes(fromLatin(h)); o.bytes(nbt); }
      add(enc.encode('LevelChunkMetaDataDictionary'), o.done());
    } else if (rawMeta) add(enc.encode('LevelChunkMetaDataDictionary'), rawMeta);

    const sp = plan.spawn;
    if (playerRaw) {
      try {
        const pt = parseTyped(playerRaw).root;
        if (bd) { add(enc.encode('~local_player'), playerRaw); const pv = C.readNBT(playerRaw).value; if (pv && Array.isArray(pv.Pos)) expect.player = pv.Pos.map(Math.fround); throw 'kept'; }
        tset(pt.v, 'Pos', 9, { et: 5, items: [sp.x + 0.5, sp.y + 1.62, sp.z + 0.5] });
        tset(pt.v, 'DimensionId', 3, 0);
        tdel(pt.v, /^(SpawnX|SpawnY|SpawnZ|SpawnDimension|SpawnBlockPositionX|SpawnBlockPositionY|SpawnBlockPositionZ)$/);
        expect.player = [sp.x + 0.5, sp.y + 1.62, sp.z + 0.5].map(Math.fround);
        add(enc.encode('~local_player'), writeTyped(pt));
      } catch (e) { if (e !== 'kept') { report.droppedPlayer = true; R.note('error', 'player-failed', 'Your player wasn’t carried over', 'The player record couldn’t be read, so you’ll arrive as a new player with an empty inventory.', base.name); } }
    }
    const sur = plan.surround || { kind: 'ocean' };
    let seed = null;
    if (sur.kind === 'seed') {
      if (sur.seedWorld) { const t = parseTyped(await sur.seedWorld.src.fs.read(sur.seedWorld.src.dir + 'level.dat'), 8).root; const n = tget(t.v, 'RandomSeed'); seed = n ? BigInt(n.v) : 0n; }
      else seed = BigInt.asIntN(64, BigInt(sur.seedText));
    } else if (bd) { if (bdFlat) add(enc.encode('game_flatworldlayers'), bdFlat); }
    else add(enc.encode('game_flatworldlayers'), enc.encode(flatLayers(sur.kind)));
    if (plan.marker) add(enc.encode('world_museum'), enc.encode(JSON.stringify(plan.marker)));

    for (const [k, list] of structByChunk) {
      if (structUsed.has(k)) continue;
      const [dim, cx, cz] = k.split('|').map(Number);
      if (dim !== 0 || !SURROUNDINGS[plan.surround.kind]) { report.placeFailures += list.length; continue; }
      try {
        const recs = placeInChunk(makeSurroundChunk(plan.surround.kind, cx, cz, base.blockSamples, base.d3Offset || 0, sampleVer, sampleFin), list, base.blockSamples, { x: cx, z: cz, dim: 0 });
        for (const r of recs) add(chunkKey(r.ck.x, r.ck.z, 0, r.ck.tag, r.ck.sub), r.v);
        chunkIds.add('0|' + cx + '|' + cz); report.newChunks++; report.placedBlocks += list.length;
      } catch (e) { report.placeFailures += list.length; }
    }
    say('Finishing the database', 0.95);
    run.sort((a, b) => cmpBytes(a[0], b[0])); report.keys += run.length;
    await dbw.addSorted(run, 0); run = [];
    await dbw.finish();

    // level.dat from the newest world
    const ldRaw = await base.src.fs.read(base.src.dir + 'level.dat');
    const storageVer = (ldRaw[0] | (ldRaw[1] << 8) | (ldRaw[2] << 16) | (ldRaw[3] << 24));
    const lt = parseTyped(ldRaw, 8).root; const lv = lt.v;
    tset(lv, 'LevelName', 8, plan.name);
    if (!bd) { // a backdrop keeps its own terrain settings and spawn
      if (seed !== null) { tset(lv, 'Generator', 3, 1); tset(lv, 'RandomSeed', 4, seed); }
      else { tset(lv, 'Generator', 3, 2); tset(lv, 'FlatWorldLayers', 8, flatLayers(sur.kind)); }
      tset(lv, 'SpawnX', 3, sp.x); tset(lv, 'SpawnY', 3, sp.y); tset(lv, 'SpawnZ', 3, sp.z);
    }
    tset(lv, 'LastPlayed', 4, BigInt(Math.floor(Date.now() / 1000)));
    if (plan.cheats) tset(lv, 'commandsEnabled', 1, 1);
    const body = writeTyped(lt);
    const hdr = new Out(8); hdr.i32(storageVer); hdr.i32(body.length);
    await zipw.add('level.dat', concat([hdr.done(), body]), true);
    await zipw.add('levelname.txt', enc.encode(plan.name), false);
    if (plan.directoryText) await zipw.add('museum-directory.txt', enc.encode(plan.directoryText), true);
    try { const icon = base.src.dir + 'world_icon.jpeg'; if (base.src.fs.paths.includes(icon)) await zipw.add('world_icon.jpeg', await base.src.fs.read(icon), false); } catch (e) {}
    const blob1 = await zipw.finish();
    // which parts of the format this build relied on without a confirmed round trip
    if (report.placedBlocks) { flags.commandVersion = true; flags.hubBlocks = true; flags.signFormat = true; flags.heights = true; }
    if (report.newChunks) flags.newChunks = true;
    if (plan.surround.kind === 'void' && !bd) flags.voidLayers = true;
    if (synthCount) flags.synthBlocks = true;
    if (metaWorlds > 1) flags.metaDict = true;
    for (const a of assumptionsFor(flags)) R.note('warn', a.code, a.title + ' (not yet confirmed in Minecraft)', a.detail);
    say('Checking the finished world', 0);
    const verify = await verifyWorld(blob1, expect, plan, R, f => say('Checking the finished world', f));
    const json = { format: 'world-museum-report', version: 1, name: plan.name, built: new Date().toISOString(), totals: R.totals(), items: R.list(), verify,
      counts: { chunks: chunkIds.size, keys: report.keys, actors: report.actors, cutColumns: report.cutColumns, protectedColumns: report.protectedColumns, placedBlocks: report.placedBlocks, newChunks: report.newChunks }, tool: 'World Museum' };
    const text = reportText(plan, R, report);
    say('Adding the report', 0.98);
    const blob = await appendToZip(blob1, [{ name: 'museum-report.txt', data: enc.encode(text) }, { name: 'museum-report.json', data: enc.encode(JSON.stringify(json, null, 1)) }]);
    report.preservation = json; report.reportText = text;
    report.chunks = chunkIds.size; report.bytes = blob.size; report.base = base.name; report.player = !!playerRaw; report.storage = store.kind; report.surround = sur.kind; report.seed = seed === null ? null : String(seed);
    say('Done', 1);
    return { blob, report };
  }

  // Which preset a flat world's layers match, if any (used for backdrops).
  function matchSurround(json) {
    try { const j = JSON.parse(json); for (const [k, p] of Object.entries(SURROUNDINGS)) { if (p.biome !== j.biome_id || p.layers.length !== (j.block_layers || []).length) continue; if (p.layers.every((l, i) => l.block_name === j.block_layers[i].block_name && l.count === j.block_layers[i].count)) return k; } } catch (e) {}
    return null;
  }
  return { assumptionsFor, matchSurround, surfaceTop: kind => kind === 'void' ? 63 : fillTop(kind), planCuts, CUT_KINDS, _decodeSub: (v) => decodeSub(v), _encodeSub: (d, s) => encodeSub(d, s), _openStore: openStore, pack, checkLayout, buildMuseum, parseTyped, writeTyped, patchAll, FLAT_LAYERS, flatLayers, SURROUNDINGS };
})();
if (typeof module !== 'undefined') module.exports = MuseumBuild;
