/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
const fs=require('fs'); const C=require('../src/core.js'); global.MuseumCore=C; const B=require('../src/build.js');
(async()=>{
 const z=await C.openZip(new Blob([fs.readFileSync('tests/out/world.zip')]));
 const W=await C.scanWorld(C.findWorlds(z,'w')[0]);
 // two groups: around the Wet Grass base (6,2) and the house (-6..-4, 8..10); plus nether hub
 const g1={id:'a',world:W,dim:0,chunks:[]}, g2={id:'b',world:W,dim:0,chunks:[]}, g3={id:'c',world:W,dim:1,chunks:[[3,3]]};
 for(let x=4;x<=8;x++)for(let z=0;z<=4;z++)g1.chunks.push([x,z]);
 for(let x=-7;x<=-3;x++)for(let z=7;z<=11;z++)g2.chunks.push([x,z]);
 const offs=B.pack([g1,g2],1); const offN=B.pack([g3],1);
 console.log('pack',offs,offN);
 const minOf=g=>[Math.min(...g.chunks.map(c=>c[0])),Math.min(...g.chunks.map(c=>c[1]))];
 for(const g of [g1,g2]){const m=minOf(g);g.offset=[offs[g.id][0]-m[0],offs[g.id][1]-m[1]];}
 g3.offset=[offN.c[0]-3,offN.c[1]-3];
 const placed=[g1,g2].map(g=>({id:g.id,chunks:g.chunks.map(([x,z])=>[x+g.offset[0],z+g.offset[1]])}));
 console.log('issues',B.checkLayout(placed,1), 'offsets', g1.offset,g2.offset,g3.offset);
 const {blob,report}=await B.buildMuseum({name:'World Museum test',keepPlayer:true,groups:[g1,g2,g3],spawn:{x:0,y:70,z:0}},(m,f)=>{});
 console.log(report);
 fs.writeFileSync('tests/out/museum.zip',Buffer.from(await blob.arrayBuffer()));
 fs.writeFileSync('tests/out/offsets.json',JSON.stringify({a:g1.offset,b:g2.offset,c:g3.offset}));
})().catch(e=>{console.error(e);process.exit(1)});
