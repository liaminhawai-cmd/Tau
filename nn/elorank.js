'use strict';
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const evo=require('./evolution-roster.js');
const medals=require('./publish-medals.js');
const dir=__dirname;
function getArg(a,n,d=null){const i=a.indexOf('--'+n);return i>=0?a[i+1]:d;}
function setArg(a,n,v){const k='--'+n,i=a.indexOf(k);if(i>=0)a.splice(i,2,k,String(v));else a.push(k,String(v));}
function has(a,n){return a.includes('--'+n);}
function run(file,args){return new Promise((ok,bad)=>{const ch=spawn(process.execPath,[path.join(dir,file),...args],{stdio:'inherit'});ch.on('error',bad);ch.on('exit',c=>c===0?ok():bad(new Error(file+' exited '+c)));});}
function mutateShape(spec){const a=String(spec||'').split(',').map(Number).filter(n=>n>0);if(!a.length)return spec;const snap=n=>Math.max(8,Math.round(n/4)*4),ops=['widen','narrow','add',...(a.length>2?['drop']:[])];for(let z=0;z<10;z++){const b=a.slice(),op=ops[Math.floor(Math.random()*ops.length)],i=Math.floor(Math.random()*b.length);if(op==='widen')b[i]=snap(b[i]*1.25);else if(op==='narrow')b[i]=snap(b[i]*.78);else if(op==='add'){const j=Math.floor(Math.random()*(b.length+1)),x=b[j-1]||b[0],y=b[j]||b[b.length-1];b.splice(j,0,snap(Math.sqrt(x*y)));}else b.splice(i,1);if(b.join(',')!==spec)return b.join(',');}return spec;}
async function birth(plan){if(!plan)return null;const args=plan.kind==='extra'?['--epochs','8','--resume',plan.parentPath,'--out',plan.outPath]:['--epochs','30','--hidden',plan.kind==='mutant'?mutateShape(plan.shape):plan.shape,'--out',plan.outPath];console.log(`[evolution] replacement ${plan.kind} from ${plan.parent} -> ${path.basename(plan.outPath)}`);await run('train-value.js',args);if(fs.existsSync(plan.outPath)){evo.noteBirth(dir,plan);return path.basename(plan.outPath,'.json');}return null;}
(async()=>{
  const original=process.argv.slice(2), refit=has(original,'refit'), summary=getArg(original,'summary',path.join(dir,'elo-summary.json'));
  evo.sync(dir); evo.ingestSummary(dir,summary);
  const restoredAtStart=evo.restoreDepthSpecialists(dir);
  if(restoredAtStart.length)console.log(`[evolution] restored depth specialists: `+
    restoredAtStart.map(x=>`${x.name} (${x.strong} strong / ${x.weak} weak)`).join(', '));
  if(has(original,'cullOnly')){
    const all=[];
    // This is deliberately bounded by the target, not by a small arbitrary number of passes:
    // above 50, the roster is supposed to whittle. Each cull() still requires its normal CI gate
    // and 100-game bank debit, so this spends accumulated evidence; it does not lower the bar.
    while(evo.status(dir).models > evo.TARGET_MODELS){
      const c=evo.cull(dir);
      if(!c.culled.length) break;
      all.push(...c.culled);
      console.log(`[evolution] maintenance culled ${c.culled.map(x=>x.name).join(', ')}`);
    }
    const end=evo.status(dir);
    console.log(`[evolution] cull-only complete: ${all.length} retired; roster ${end.models} nets + ` +
                `${end.ladders} ladder; cull bank ${end.gamesSinceCull.toFixed(0)}`);
    // A cull can invalidate an alias immediately. Refresh now instead of letting the laptop spend
    // the next 45-minute rating cycle on a medal whose source just retired.
    try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}
    return;
  }
  const requested=String(getArg(original,'focus','')).split(',').filter(Boolean);
  const focus=evo.filterFocus(dir,requested), rotating=evo.ratingSlice(dir), seen=new Set(), slice=[];
  for(const p of [...focus,...rotating]){const k=path.resolve(p);if(!seen.has(k)){seen.add(k);slice.push(p);}}
  const levels=evo.activeLadderLevels(dir), st=evo.status(dir);
  console.log(`[evolution] rating roster ${st.models} nets + ${st.ladders} ladder; rotating ${slice.length}; cull bank ${st.gamesSinceCull.toFixed(0)} games`);
  const base=original.slice(); setArg(base,'models',slice.join(',')); setArg(base,'levels',levels.join(',')); setArg(base,'depths','1,2');
  if(!refit){setArg(base,'focus',slice.join(','));setArg(base,'focusPairs','0');}
  await run('elorank-legacy.js',base);
  evo.ingestSummary(dir,summary);
  const restored=evo.restoreDepthSpecialists(dir);
  if(restored.length)console.log(`[evolution] restored depth specialists: `+
    restored.map(x=>`${x.name} (${x.strong} strong / ${x.weak} weak)`).join(', '));

  if(!refit){
    for(let i=0;i<3;i++){
      const c=evo.cull(dir); if(!c.culled.length) break;
      console.log(`[evolution] culled ${c.culled.map(x=>x.name).join(', ')}`);
      if(c.birth){const b=await birth(c.birth);if(b)console.log(`[evolution] replacement born ${b}`);}
    }
  }

  const d3=evo.d3Slice(dir);
  if(d3.length){
    const a=original.slice(), d3Summary=evo.d3SummaryPath(dir);
    setArg(a,'models',d3.join(',')); setArg(a,'levels',evo.activeLadderLevels(dir).join(','));
    setArg(a,'depths','3'); setArg(a,'summary',d3Summary);
    if(!refit){
      setArg(a,'focus',d3.join(',')); setArg(a,'focusPairs','0');
      const bh=+getArg(original,'budgetHours',0);if(bh>0)setArg(a,'budgetHours',Math.max(.03,bh*.25));
    }
    console.log(`[evolution] D3 earned by ${d3.length}: lower CI is above the active-model median`);
    await run('elorank-legacy.js',a);
    evo.ingestSummary(dir,d3Summary);
  }

  const d4=evo.d4Slice(dir);
  if(d4.length){
    const a=original.slice(), d4Summary=evo.d4SummaryPath(dir);
    setArg(a,'models',d4.join(',')); setArg(a,'levels',evo.activeLadderLevels(dir).join(','));
    setArg(a,'depths','4'); setArg(a,'summary',d4Summary);
    setArg(a,'games','1'); setArg(a,'workers','1');
    if(!refit){
      setArg(a,'focus',d4.join(',')); setArg(a,'focusPairs','0');
      const bh=+getArg(original,'budgetHours',0);
      if(bh>0)setArg(a,'budgetHours',Math.max(.02,Math.min(.08,bh*.10)));
    }
    console.log(`[evolution] D4 probe for top ${d4.length} D3 model(s); 1 worker, 1 game per pairing, no D5`);
    await run('elorank-legacy.js',a);
    evo.ingestSummary(dir,d4Summary);
    const dropped=evo.retireBadD4(dir);
    if(dropped.length)console.log(`[evolution] D4 privilege retired for ${dropped.join(', ')}: D4 Elo below own D3 after >=2 D4 games`);
  }
  if(!refit){try{medals.main();}catch(e){console.error('[medals] refresh failed:',e.message);}}
  const end=evo.status(dir);console.log(`[evolution] roster now ${end.models} nets + ${end.ladders} ladder; cull bank ${end.gamesSinceCull.toFixed(0)}`);
})().catch(e=>{console.error('[evolution] elorank wrapper failed:',e.message);process.exitCode=1;});
