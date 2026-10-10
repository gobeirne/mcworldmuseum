/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Greg O'Beirne */
const fs=require('fs'); const C=require('../src/core.js');
(async()=>{
 const buf=fs.readFileSync(process.argv[2] || 'tests/out/world.zip'); const blob=new Blob([buf]);
 const z=await C.openZip(blob); const worlds=C.findWorlds(z,'world.zip');
 console.log('worlds',worlds.map(w=>w.dir));
 const t=Date.now(); const r=await C.scanWorld(worlds[0]);
 console.log('ms',Date.now()-t,'name',r.name,r.level,'stats',r.stats,'offset',r.d3Offset);
 for(const d in r.dims){const D=r.dims[d];console.log('dim',d,D.chunks.length,D.minX,D.maxX,D.minZ,D.maxZ);}
 const c=r.dims[0].index.get('-20,-20'), c2=r.dims[0].index.get('6,2');
 console.log('h -20,-20',c.h[0],c.b[0],'h 6,2',c2.h[0],c2.b[0], 'has 20,20', !!r.dims[0].index.get('20,20')?.h);
 console.log('markers',r.markers.map(m=>[m.dim,m.kind,m.id,m.text||m.name||'',m.weight]));
 console.log('places',JSON.stringify(r.places,null,0));
 console.log('player',r.player);
})().catch(e=>{console.error(e);process.exit(1)});
