/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
const fs=require('fs'); const C=require('../src/core.js'); global.MuseumCore=C; const B=require('../src/build.js');
(async()=>{
 const z=await C.openZip(new Blob([fs.readFileSync('tests/out/world.zip')]));
 const W=await C.scanWorld(C.findWorlds(z,'w')[0]);
 const g={id:'a',world:W,dim:0,chunks:[]}; for(let x=4;x<=8;x++)for(let zz=0;zz<=4;zz++)g.chunks.push([x,zz]); g.offset=[0,0];
 const blocks=[];
 // hub on open sea at chunk (20,20): platform + two stations
 const top=B.surfaceTop('ocean'); const y=top+1;
 for(let x=320;x<=336;x++)for(let zz=320;zz<=335;zz++) blocks.push({dim:0,x,y:top,z:zz,kind:'stone'});
 for(const [i,dest] of [[0,'tp @p 100 70 40'],[1,'execute in nether run tp @p 50 70 50']]){ const sx=322+i*2, sz=332;
   blocks.push({dim:0,x:sx,y,z:sz,kind:'cmd',cmd:dest},{dim:0,x:sx,y,z:sz+1,kind:'button',face:3},{dim:0,x:sx,y:y+1,z:sz,kind:'sign',rot:0,text:'Cushion Society\nArea '+(i+1)+'\nLast visited'}); }
 // return pad inside the exhibit at (102, 70, 40)
 blocks.push({dim:0,x:102,y:70,z:40,kind:'cmd',cmd:'tp @p 329 63 334'},{dim:0,x:102,y:70,z:41,kind:'button',face:3},{dim:0,x:102,y:71,z:40,kind:'sign',rot:0,text:'Back to\nthe hub'});
 const res=await B.buildMuseum({name:'Hub test',keepPlayer:false,surround:{kind:'ocean'},groups:[g],spawn:{x:329,y:63,z:334},cheats:true,structures:{blocks}},()=>{});
 console.log(res.report); fs.writeFileSync('tests/out/hub.zip',Buffer.from(await res.blob.arrayBuffer()));
})().catch(e=>{console.error(e);process.exit(1)});
