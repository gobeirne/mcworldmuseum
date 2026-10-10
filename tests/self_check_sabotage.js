/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
const fs=require('fs'); const C=require('../src/core.js'); global.MuseumCore=C; const B=require('../src/build.js');
(async()=>{
 const z=await C.openZip(new Blob([fs.readFileSync('tests/out/trouble.zip')])); const W=await C.scanWorld(C.findWorlds(z,'w')[0]);
 const g={id:'a',world:W,dim:0,chunks:[]}; for(let x=4;x<=8;x++)for(let zz=0;zz<=4;zz++)g.chunks.push([x,zz]); g.offset=[-6,-2];
 for (const [label, extra] of [['corrupted byte', {_testCorrupt: 40}], ['coordinate bug', {_testShift: 16}]]) {
   const res=await B.buildMuseum({name:'Sabotage',keepPlayer:true,surround:{kind:'ocean'},groups:[g],spawn:{x:0,y:70,z:0},...extra},()=>{});
   const P=res.report.preservation; console.log(`\n${label}: totals`, P.totals, 'self-check ok:', P.verify.ok);
   for (const i of P.items.filter(i=>i.code.startsWith('verify-') && i.sev==='error')) console.log(`  [${i.sev}] ${i.title}${i.count>1?' ('+i.count+')':''} e.g. ${i.examples.slice(0,2).join('; ')}`);
 }
})().catch(e=>{console.error(e);process.exit(1)});
