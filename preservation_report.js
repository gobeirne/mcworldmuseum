/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
const fs=require('fs'); const C=require('../src/core.js'); global.MuseumCore=C; const B=require('../src/build.js');
(async()=>{
 const z=await C.openZip(new Blob([fs.readFileSync(process.argv[2]||'tests/out/trouble.zip')]));
 const W=await C.scanWorld(C.findWorlds(z,'w')[0]);
 const g={id:'a',world:W,dim:0,chunks:[]}; for(let x=4;x<=8;x++)for(let zz=0;zz<=4;zz++)g.chunks.push([x,zz]); g.offset=[-6,-2];
 const n={id:'n',world:W,dim:1,chunks:[[3,3]],offset:[1,1]};
 const res=await B.buildMuseum({name:'Report test',keepPlayer:true,surround:{kind:'ocean'},groups:[g,n],spawn:{x:0,y:70,z:0},cheats:true,
   notes:[{sev:'info',code:'trimmed',title:'Fringe chunks trimmed by edge smoothing',detail:'…',count:12}]},()=>{});
 const P=res.report.preservation;
 console.log('totals', P.totals, '| verify', JSON.stringify(P.verify));
 for (const i of P.items) console.log(`[${i.sev}] ${i.title}${i.count>1?' ('+i.count+')':''}${i.examples.length?' e.g. '+i.examples.join('; '):''}`);
 fs.writeFileSync('tests/out/report.zip',Buffer.from(await res.blob.arrayBuffer()));
 const z2=await C.openZip(new Blob([fs.readFileSync('tests/out/report.zip')]));
 console.log('files in world:', z2.paths.filter(p=>!p.startsWith('db/')));
 console.log((new TextDecoder().decode(await z2.read('museum-report.txt'))).split('\n').slice(0,4).join('\n'));
})().catch(e=>{console.error(e);process.exit(1)});
