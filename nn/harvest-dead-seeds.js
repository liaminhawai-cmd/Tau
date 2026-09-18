const fs=require('fs'); const S=process.argv[2]; const out=[]; const dirs=[S+'/retro-today/', 'nn/data/'];
const seen=new Set();
for(const dir of dirs) for(const f of fs.readdirSync(dir)){ if(!/^retro.*\.jsonl$/.test(f)) continue; const rows=fs.readFileSync(dir+f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean);
  const games=new Map(); for(const r of rows){ if(!r.g||!r.p) continue; if(!games.has(r.g)) games.set(r.g,[]); games.get(r.g).push(r); }
  for(const [g,rs] of games){ if(!/-0-0$/.test(g) && !/-\d+-0$/.test(g)) continue; // seed games only
    const n=rs.length; if(n<4) continue; const last=rs[n-1]; const winner=last.z>0?last.m:1-last.m; const loser=1-winner;
    for(const k of [1,2,3,4,5,6,7,8]){ const r=rs[n-k]; if(!r) break; if(r.m!==loser) continue; const key=r.p.map(v=>v.toFixed(2)).join(','); if(seen.has(key)) continue; seen.add(key);
      out.push({file:f, g, k, mover:r.m, p:r.p, z:r.z}); }
  }
}
fs.writeFileSync(S+'/dead/seeds.jsonl', out.map(o=>JSON.stringify(o)).join('\n')+'\n');
const byK={}; for(const o of out) byK[o.k]=(byK[o.k]||0)+1; console.log('seeds', out.length, 'by k', JSON.stringify(byK), 'files', new Set(out.map(o=>o.file)).size);
