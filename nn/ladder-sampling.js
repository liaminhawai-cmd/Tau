'use strict';
// Shared opponent policy for fixed ladder rungs.
//
// The ladder is useful because it is permanent and non-learning, not because it deserves a fixed
// slice of compute forever.  The live NNs already use the evolution roster's strength+need draw
// equation.  Rungs do not have bootstrap rank CIs of their own, so their equivalent "need" is the
// cheap, honest proxy we do have: how many rated games that permanent identity has accumulated.
// A new rung therefore gets sampled; an old rung with 500+ games rapidly fades to a tiny reference
// share.  Strength still comes from the SAME shared Elo graph as the nets.
const fs=require('fs');
const path=require('path');
const ELO_TEMP=400;

function state(dir){
  try{return JSON.parse(fs.readFileSync(path.join(dir,'models','.evolution-roster.json'),'utf8'));}
  catch(_){return{latest:{},ladderRatings:{}};}
}
function ladderDefs(){
  try{return require('./engine.js').createEngine().AI_LADDER;}catch(_){return null;}
}
function productionTop(top=3){
  const defs=ladderDefs();
  if(!defs)return [9,10,11].slice(-Math.max(1,top));
  const prod=defs.map((d,i)=>d&&!d.experimental?i+1:null).filter(Boolean).slice(-Math.max(1,top));
  // a focus rung (below) is always in the reference set, whatever `top` says
  for(const f of focusRungs(defs))if(!prod.includes(f.level))prod.push(f.level);
  return prod.sort((a,b)=>a-b);
}
// Rungs the trainer is told to concentrate on: AI_LADDER entries carrying trainerFocus
// {share, seatShare}. `share` is the fraction of all ladder-game tickets that rung takes (the
// other rungs split the rest by their strength*need weights as before); `seatShare` lifts the cap
// on how many self-play seats the ladder class gets at all, so the focus is extra games against
// that rung, not the same few ladder games re-cut. Corner L12 carries one: the nets were measured
// soft against the corner-cross opening because nothing in training played it on purpose, and a
// rung that plays it every game only fills that gap if the nets actually meet it a lot.
function focusRungs(defs){
  defs=defs||ladderDefs(); if(!defs)return[];
  return defs.map((d,i)=>d&&d.trainerFocus?{level:i+1,share:Math.max(0,Math.min(.9,+d.trainerFocus.share||0)),
    seatShare:Math.max(0,Math.min(.5,+d.trainerFocus.seatShare||0))}:null).filter(Boolean);
}
// Re-weight rows so each focus rung holds its share of the total; the rest keep their proportions.
function applyFocus(rows,focus){
  const fset=new Map(focus.map(f=>[f.level,f]));
  const restMass=rows.filter(r=>!fset.has(r.level)).reduce((s,r)=>s+(r.weight>0?r.weight:0),0)||1;
  const focusShare=Math.min(.95,focus.filter(f=>rows.some(r=>r.level===f.level)).reduce((s,f)=>s+f.share,0));
  for(const r of rows){const f=fset.get(r.level);if(f)r.weight=restMass*f.share/Math.max(.05,1-focusShare);r.focus=!!f;}
  return rows;
}
function tickets(rows,count=30){
  if(!rows.length)return[];
  const good=rows.map(r=>({...r,w:Number.isFinite(+r.weight)&&+r.weight>0?+r.weight:1}));
  const sum=good.reduce((s,r)=>s+r.w,0)||1;
  // Every selected top rung gets one ticket.  The remainder is proportional, using a cumulative
  // quantile rather than repeating a sorted prefix (which would quietly favour lower level ids).
  const out=good.map(r=>r.level), left=Math.max(0,count-out.length);
  for(let i=0;i<left;i++){
    let x=(i+.5)/Math.max(1,left)*sum,chosen=good[good.length-1];
    for(const r of good){x-=r.w;if(x<=0){chosen=r;break;}}
    out.push(chosen.level);
  }
  return out;
}
function mixString(m){return `nnnn:${m.nnnn.toFixed(6)},nnladder:${m.nnladder.toFixed(6)},ladder:${m.ladder.toFixed(6)}`;}

function trainerProfile(dir,modelWeights={},opts={}){
  const focus=focusRungs();
  const top=Math.max(1,+opts.top||3), maxSeatShare=Math.max(0,Math.min(.5,Math.max(+opts.maxSeatShare||.04,...focus.map(f=>f.seatShare))));
  const refGames=Math.max(1,+opts.refGames||24), floor=Math.max(0,Math.min(.2,+opts.needFloor||.015));
  const s=state(dir),levels=productionTop(top);
  const modelElos=Object.values(s.latest||{}).map(r=>+r.elo).filter(Number.isFinite);
  const rungRows=levels.map(level=>{
    const r=(s.ladderRatings||{})[level]||(s.ladderRatings||{})[String(level)]||{};
    return{level,elo:Number.isFinite(+r.elo)?+r.elo:null,games:+r.games||0};
  });
  const allElos=[...modelElos,...rungRows.map(r=>r.elo)].filter(Number.isFinite),maxE=allElos.length?Math.max(...allElos):0;
  for(const r of rungRows){
    const strength=Number.isFinite(r.elo)?Math.exp((r.elo-maxE)/ELO_TEMP):.25;
    // No special ladder uncertainty loading: this is only an evidence-need decay.  At 500 games
    // with the 24-game reference it is ~0.21; as history grows it keeps falling toward a tiny floor.
    const need=r.games>0?Math.max(floor,Math.sqrt(refGames/(refGames+r.games))):1;
    r.strength=strength;r.need=need;r.weight=strength*need;
  }
  applyFocus(rungRows,focus);
  const modelMass=Object.values(modelWeights||{}).map(Number).filter(x=>Number.isFinite(x)&&x>0).reduce((a,b)=>a+b,0)||1;
  const ladderMass=rungRows.reduce((s,r)=>s+r.weight,0);
  const raw=ladderMass/(modelMass+ladderMass);
  // a focus rung pins the ladder class at its lifted cap: the point is more games against it
  const seatShare=focus.length?maxSeatShare:Math.min(maxSeatShare,Math.max(0,raw));
  // No ladder-vs-ladder training games: two deterministic brains replay the same game, so those
  // rows are duplicates (and a focus rung plays from the true start, where they would be exact).
  // The seats that draw would have taken go to net-vs-ladder instead.
  const n=1-seatShare,mix={nnnn:n*n,nnladder:1-n*n,ladder:0};
  return{levels:tickets(rungRows,30),rows:rungRows,seatShare,mix,mixString:mixString(mix)};
}

function factoryProfile(dir,medals,opts={}){
  const focus=focusRungs();
  const top=Math.max(1,+opts.top||3), ladderGameShare=Math.max(0,Math.min(.5,Math.max(+opts.ladderGameShare||.10,...focus.map(f=>f.seatShare))));
  const s=state(dir),levels=productionTop(top);
  const medalRows=(medals||[]).map(m=>({...m,elo:Number.isFinite(+m.elo)?+m.elo:null}));
  const rungRows=levels.map(level=>{
    const r=(s.ladderRatings||{})[level]||(s.ladderRatings||{})[String(level)]||{};
    return{level,elo:Number.isFinite(+r.elo)?+r.elo:null};
  });
  const all=[...medalRows.map(r=>r.elo),...rungRows.map(r=>r.elo)].filter(Number.isFinite),maxE=all.length?Math.max(...all):0;
  const weightOf=e=>Number.isFinite(e)?Math.exp((e-maxE)/ELO_TEMP):.15;
  const modelWeights={};for(const m of medalRows)modelWeights[m.name]=+weightOf(m.elo).toFixed(6);
  for(const r of rungRows)r.weight=weightOf(r.elo);
  applyFocus(rungRows,focus);
  // Factory deliberately has NO uncertainty/need loading.  It is exploitation data: strong medals
  // most of the time, a small fixed reference slice whose top rungs are chosen by shared Elo.
  const mix={nnnn:1-ladderGameShare,nnladder:ladderGameShare,ladder:0};
  return{modelWeights,levels:tickets(rungRows,30),rows:rungRows,mix,mixString:mixString(mix)};
}

module.exports={productionTop,trainerProfile,factoryProfile,focusRungs};
