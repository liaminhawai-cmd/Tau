'use strict';
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const dir=__dirname;
function getArg(a,n,d=null){const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;}
function setArg(a,n,v){const k='--'+n,i=a.indexOf(k);if(i>=0)a.splice(i,2,k,String(v));else a.push(k,String(v));}
function has(a,n){return a.includes('--'+n);}
function run(file,args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,file),...args],{stdio:'inherit'});ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error(file+' exited '+c)));});}
function mutateShape(spec){const a=String(spec||'').split(',').map(Number).filter(n=>n>0);if(!a.length)return spec;const snap=n=>Math.max(8,Math.round(n/4)*4),ops=['widen','narrow','add',...(a.length>2?['drop']:[])];for(let z=0;z<10;z++){const b=a.slice(),op=ops[Math.floor(Math.random()*ops.length)],i=Math.floor(Math.random()*b.length);if(op==='widen')b[i]=snap(b[i]*1.25);else if(op==='narrow')b[i]=snap(b[i]*.78);else if(op==='add'){const j=Math.floor(Math.random()*(b.length+1)),x=b[j-1]||b[0],y=b[j]||b[b.length-1];b.splice(j,0,snap(Math.sqrt(x*y)));}else b.splice(i,1);if(b.join(',')!==spec)return b.join(',');}return spec;}
async function birth(plan){if(!plan)return null;const args=plan.kind==='extra'?['--epochs','8','--resume',plan.parentPath,'--out',plan.outPath]:['--epochs','30','--hidden',plan.kind==='mutant'?mutateShape(plan.shape):plan.shape,'--out',plan.outPath];console.log(`[evolution] replacement ${plan.kind} from ${plan.parent} -> ${path.basename(plan.outPath)}`);await run('train.js',args);if(fs.existsSync(plan.outPath)){evo.noteBirth(dir,plan);return path.basename(plan.outPath,'.json');}return null;}
(async()=>{
  const original=process.argv.slice(2), refit=has(original,'refit'), summary=getArg(original,'summary',path.join(dir,'elo-summary.json'));
  evo.sync(dir); evo.ingestSummary(dir,summary);
  const requested=String(getArg(original,'focus','')).split(',').filter(Boolean);
  const focus=evo.filterFocus(dir,requested), rotating=evo.ratingSlice(dir), seen=new Set(), slice=[];
  for(const p of [...focus,...rotating]){const k=path.resolve(p);if(!seen.has(k)){seen.add(k);slice.push(p);}}
  const levels=evo.activeLadderLevels(dir), st=evo.status(dir);
  console.log(`[evolution] rating roster ${st.models} nets + ${st.ladders} ladder; rotating ${slice.length}; cull bank ${st.gamesSinceCull.toFixed(0)} games`);
  const base=original.slice(); setArg(base,'models',slice.join(',')); setArg(base,'levels',levels.join(',')); setArg(base,'depths','1,2');
  if(!refit){setArg(base,'focus',slice.join(','));setArg(base,'focusPairs','0');}
  await run('elorank-legacy.js',base);
  evo.ingestSummary(dir,summary);
  if(!refit){
    // Catch up at most three ~100-game pruning beats per placement; any larger backlog remains for
    // the next cycle rather than deleting half the historical field against one frozen fit.
    for(let i=0;i<3;i++){
      const c=evo.cull(dir); if(!c.culled.length) break;
      console.log(`[evolution] culled ${c.culled.map(x=>x.name).join(', ')}`);
      if(c.birth){const b=await birth(c.birth);if(b)console.log(`[evolution] replacement born ${b}`);}
    }
    const d3=evo.d3Slice(dir);
    if(d3.length){
      const a=original.slice(); setArg(a,'models',d3.join(',')); setArg(a,'levels',evo.activeLadderLevels(dir).join(','));
      setArg(a,'depths','3'); setArg(a,'focus',d3.join(',')); setArg(a,'focusPairs','0');
      const bh=+getArg(original,'budgetHours',0);if(bh>0)setArg(a,'budgetHours',Math.max(.03,bh*.25));
      console.log(`[evolution] D3 earned by ${d3.length}: lower CI is above the active-model median`);
      await run('elorank-legacy.js',a); evo.ingestSummary(dir,summary);
    }
  }
  const end=evo.status(dir);console.log(`[evolution] roster now ${end.models} nets + ${end.ladders} ladder; cull bank ${end.gamesSinceCull.toFixed(0)}`);
})().catch(e=>{console.error('[evolution] elorank wrapper failed:',e.message);process.exitCode=1;});
