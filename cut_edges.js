/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
const fs=require('fs'); const C=require('../src/core.js'); global.MuseumCore=C; const B=require('../src/build.js');
(async()=>{
 const z=await C.openZip(new Blob([fs.readFileSync('tests/out/world.zip')]));
 const W=await C.scanWorld(C.findWorlds(z,'w')[0]);
 // round-trip check on a real subchunk
 let checked=0;
 await C._readLevelDB(W.src,(k,seq,del,v)=>{ const ck=C.parseChunkKey(k); if(!ck||ck.tag!==47||del||checked>50) return; const d=B._decodeSub(v); const e=B._encodeSub(d,ck.sub); const d2=B._decodeSub(e);
   const nm=(dd,i)=>dd.layers[0].vals[dd.layers[0].idx[i]].name; for(let i=0;i<4096;i++) if(nm(d,i)!==nm(d2,i)) throw new Error('roundtrip mismatch'); checked++; });
 console.log('round-trip ok on',checked,'subchunks');
 // a group covering the house (-6..-4, 8..10) with land around it, cut to ocean
 const g={id:'h',world:W,dim:0,chunks:[]}; for(let x=-9;x<=-1;x++)for(let z=5;z<=13;z++)g.chunks.push([x,z]);
 g.offset=[0,0];
 const res=await B.buildMuseum({name:'Cut test',keepPlayer:false,cutEdges:true,surround:{kind:'ocean'},groups:[g],spawn:{x:-80,y:70,z:140}},()=>{});
 console.log(res.report);
 fs.writeFileSync('tests/out/cut.zip',Buffer.from(await res.blob.arrayBuffer()));
})().catch(e=>{console.error(e);process.exit(1)});
