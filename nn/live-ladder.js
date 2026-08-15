'use strict';
// Tau Live Ladder — read-only. Watches Elo files written by option 20 and serves a local live view.
const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const D=__dirname,F=n=>path.join(D,n),M=F('models'),R=F('elo-results.json'),I=F('elo-inbox.jsonl'),S=F('elo-summary.json'),S3=F('.evolution-d3-summary.json'),RP=F('models/.evolution-roster.json'),WM=F('models/.wild-mint-state.json'),WDM=F('models/.wild-dual-mint-state.json'),BM=F('models/.behemoth-mint-state.json'),DP=F('models/.dual-pop.json'),MP=F('models/.mutant-pop.json');
const host='127.0.0.1',port0=+(process.argv.find(x=>x.startsWith('--port='))||'--port=8765').split('=')[1];
const json=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}},txt=f=>{try{return fs.readFileSync(f,'utf8')}catch{return''}},sig=f=>{try{let s=fs.statSync(f);return s.size+':'+s.mtimeMs}catch{return'-'}};
const quant=(xs,p)=>{xs=xs.filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return null;let x=(xs.length-1)*p,l=Math.floor(x),h=Math.ceil(x);return l===h?xs[l]:xs[l]+(xs[h]-xs[l])*(x-l)};
function combined(){let out={},b=json(R,{results:{}});for(let[k,v]of Object.entries(b.results||{}))out[k]={w:+v.w||0,l:+v.l||0,d:+v.d||0};let recent=[],n=0;for(let line of txt(I).split(/\r?\n/)){if(!line)continue;try{let v=JSON.parse(line);if(!v.a||!v.b||v.a===v.b)continue;let k=v.a+'|'+v.b,r=out[k]||(out[k]={w:0,l:0,d:0});r.w+=+v.w||0;r.l+=+v.l||0;r.d+=+v.d||0;n++;recent.push({a:v.a,b:v.b,w:+v.w||0,l:+v.l||0,d:+v.d||0});if(recent.length>10)recent.shift()}catch{}}return{out,recent,n}}
function fit(rs){let ids=new Set,ps=[];for(let[k,r]of Object.entries(rs)){let z=k.indexOf('|');if(z<1)continue;let a=k.slice(0,z),b=k.slice(z+1),t=(+r.w||0)+(+r.l||0)+(+r.d||0);if(!a||!b||a===b||!t)continue;ids.add(a);ids.add(b);ps.push([a,b,+r.w||0,+r.l||0,+r.d||0,t])}ids=[...ids];if(!ids.length)return{elo:{},games:{},total:0,pairs:0};let ix=Object.fromEntries(ids.map((x,i)=>[x,i])),w=Array(ids.length).fill(0),g=Array(ids.length).fill(0),e=[],total=0;for(let[a,b,W,L,d,t]of ps){let i=ix[a],j=ix[b];w[i]+=W+d/2;w[j]+=L+d/2;g[i]+=t;g[j]+=t;total+=t;e.push([i,j,t])}let p=Array(ids.length).fill(1);for(let it=0;it<180;it++){let den=p.map(v=>1/(v+1));for(let[i,j,t]of e){let z=t/Math.max(1e-12,p[i]+p[j]);den[i]+=z;den[j]+=z}let n=p.map((_,i)=>(w[i]+.5)/Math.max(1e-12,den[i])),geo=Math.exp(n.reduce((s,v)=>s+Math.log(Math.max(v,1e-12)),0)/n.length),d=0;for(let i=0;i<n.length;i++){n[i]/=geo;d=Math.max(d,Math.abs(n[i]-p[i]))}p=n;if(d<1e-8)break}let elo={},games={};ids.forEach((x,i)=>{elo[x]=400*Math.log10(Math.max(p[i],1e-12));games[x]=g[i]});return{elo,games,total,pairs:ps.length}}
const parse=id=>{let m=id.match(/^(.*?)(\+P)?@D(\d+)$/);return m?{trunk:m[1],policy:!!m[2],depth:+m[3]}:{trunk:id,policy:false,depth:null}};
const tailEpochCache=new Map;function tailEpoch(file){try{let k=sig(file),old=tailEpochCache.get(file);if(old&&old.k===k)return old.n;let st=fs.statSync(file),n=Math.min(st.size,8192),fd=fs.openSync(file,'r'),b=Buffer.alloc(n);fs.readSync(fd,b,0,n,st.size-n);fs.closeSync(fd);let ms=[...b.toString('utf8').matchAll(/"trainedEpochs"\s*:\s*(\d+)/g)],v=ms.length?+ms.at(-1)[1]:null;tailEpochCache.set(file,{k,n:v});return v}catch{return null}}
function epochMap(ro){let out={};const put=(name,n)=>{n=+n;if(name&&Number.isFinite(n)&&n>=0)out[String(name).replace(/\.json$/,'')]=Math.round(n)};for(let bank of [ro?.active,ro?.retired])for(let[name,m]of Object.entries(bank||{}))put(name,m?.trainedEpochs??m?.epochs??m?.peakEpoch);for(let f of [DP,MP]){let j=json(f,{});for(let bank of [j.active,j.retired,j.history])for(let x of Array.isArray(bank)?bank:Object.values(bank||{})){if(!x||typeof x!=='object')continue;let n=x.trainedEpochs??x.epochs??x.peakEpoch,name=x.name||x.id||x.trunk,base=x.file?path.basename(x.file,'.json'):null;put(name,n);put(base,n)}}for(let f of [WM,WDM]){let j=json(f,{});for(let[name,x]of Object.entries(j.shapes||{}))put(name,x?.peakEpoch)}let b=json(BM,{});put(b.name||b.id||'behemoth-10x400-dense40',b.peakEpoch);return out}
function epochFor(name,meta,known){if(Number.isFinite(known[name]))return known[name];let n=meta?.trainedEpochs??meta?.epochs??meta?.peakEpoch;if(Number.isFinite(+n))return Math.round(+n);let fm=String(name).match(/-e(\d+)$/);if(fm)return+fm[1];let file=meta?.file?path.join(M,path.basename(meta.file)):path.join(M,name+'.json');return tailEpoch(file)}
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
function phaseFor(ro,id){
  const p=parse(id),pool=p.depth>=1&&p.depth<=4?ro?.facePools?.['D'+p.depth]:null;
  if(pool){
    if((pool.active||[]).includes(id))return'seat';
    if(pool.trial===id)return'trial';
    if((pool.waiting||[]).includes(id))return'waiting';
    if(own(pool.retired,id))return'retired';
    return'historical';
  }
  // Old roster files predate face pools. Keep their model-level interpretation so opening the
  // dashboard during migration does not make the whole field disappear.
  if(!ro?.facePools)return own(ro?.active,p.trunk)?'seat':own(ro?.retired,p.trunk)?'retired':'historical';
  return'historical'; // D5 and any other unmanaged, old rating identities
}
const livePhase=x=>x==='seat'||x==='trial';
function faceReading(ro,id){let p=parse(id),k='D'+p.depth+(p.policy?'+P':'');return ro?.latest?.[p.trunk]?.faces?.[k]||{};}
function listedFaces(ro){
  const out=[];for(let d=1;d<=4;d++){let p=ro?.facePools?.['D'+d];if(!p)continue;
    out.push(...(p.active||[]));if(p.trial)out.push(p.trial);out.push(...(p.waiting||[]));
  }return[...new Set(out)];
}
function snap(){
  let c=combined(),f=fit(c.out),sum={...(json(S,{players:{}}).players||{}),...(json(S3,{players:{}}).players||{})},ro=json(RP,null);
  if(ro){ro.active||={};ro.retired||={};ro.latest||={};ro.ladderActive||=[];ro.ladderRatings||={}}
  let ep=epochMap(ro),lad=new Set((ro?.ladderActive||[]).map(Number));
  let la=[...(ro?.ladderActive||[])].map(level=>({level:+level,elo:ro?.ladderRatings?.[level]?.elo})).filter(x=>Number.isFinite(x.elo)).sort((a,b)=>b.elo-a.elo),prot=new Set(la.length>=Math.min(6,lad.size)?la.slice(0,6).map(x=>x.level):[...lad]);
  let rows=[],seen=new Set;
  for(let[id,elo]of Object.entries(f.elo)){
    let lm=id.match(/^L(\d+)$/);if(lm){let level=+lm[1];rows.push({id,label:id,kind:'ladder',elo,games:f.games[id]||0,active:!ro||lad.has(level),phase:prot.has(level)?'protected':(!ro||lad.has(level))?'ladder':'retired',protected:prot.has(level)});continue}
    let p=parse(id),s=sum[id]||{},meta=ro?.active?.[p.trunk]||ro?.retired?.[p.trunk]||{},phase=phaseFor(ro,id);seen.add(id);
    rows.push({id,label:p.trunk,trunk:p.trunk,kind:'net',depth:p.depth,policy:p.policy,dual:!!meta.dual,epochs:epochFor(p.trunk,meta,ep),elo,games:f.games[id]||0,phase,active:livePhase(phase),waiting:phase==='waiting',retired:phase==='retired',rankLo:Number.isFinite(s.rankLo)?s.rankLo:null,rankHi:Number.isFinite(s.rankHi)?s.rankHi:null,rankLoEdge:s.rankLoEdge||null,rankHiEdge:s.rankHiEdge||null,extrapRank:Number.isFinite(s.extrapRank)?s.extrapRank:null,extrapRankLo:Number.isFinite(s.extrapRankLo)?s.extrapRankLo:null,extrapRankHi:Number.isFinite(s.extrapRankHi)?s.extrapRankHi:null})
  }
  // A queued face has no Elo identity yet, so it cannot be discovered from elo-results. Add the
  // exact queued face (including depth and +P), rather than one misleading model-level row.
  for(let id of listedFaces(ro)){if(seen.has(id))continue;let p=parse(id),meta=ro?.active?.[p.trunk]||{},r=faceReading(ro,id),phase=phaseFor(ro,id);
    rows.push({id,label:p.trunk,trunk:p.trunk,kind:'net',depth:p.depth,policy:p.policy,dual:!!meta.dual,epochs:epochFor(p.trunk,meta,ep),elo:Number.isFinite(r.elo)?r.elo:null,games:+r.games||0,phase,active:livePhase(phase),waiting:phase==='waiting',retired:false,rankLo:Number.isFinite(r.rankLo)?r.rankLo:null,rankHi:Number.isFinite(r.rankHi)?r.rankHi:null,rankLoEdge:r.rankLoEdge||null,rankHiEdge:r.rankHiEdge||null})
  }
  rows.sort((a,b)=>(Number.isFinite(b.elo)?b.elo:-1e99)-(Number.isFinite(a.elo)?a.elo:-1e99)||b.games-a.games||a.id.localeCompare(b.id,undefined,{numeric:true}));
  let place=0;rows.forEach(r=>r.place=Number.isFinite(r.elo)?++place:null);
  let pools={},liveIds=[];for(let d=1;d<=4;d++){let key='D'+d,p=ro?.facePools?.[key]||{active:[],trial:null,waiting:[],retired:{}};pools[key]={seats:(p.active||[]).length,trial:p.trial?1:0,waiting:(p.waiting||[]).length,retired:Object.keys(p.retired||{}).length};liveIds.push(...(p.active||[]),...(p.trial?[p.trial]:[]))}
  if(!ro?.facePools){liveIds=rows.filter(r=>r.kind==='net'&&r.active).map(r=>r.id);for(const id of liveIds){let p=parse(id),x=pools['D'+p.depth];if(x)x.seats++}}
  let liveRows=rows.filter(r=>r.kind==='net'&&r.active),liveById=new Map(liveRows.map(r=>[r.id,r])),liveModels=new Set(liveIds.map(id=>parse(id).trunk)),z1=liveIds.filter(id=>parse(id).depth===1&&!(liveById.get(id)?.games>0)).length,z2=liveIds.filter(id=>parse(id).depth===2&&!(liveById.get(id)?.games>0)).length;
  let ranks=liveRows.map(r=>r.rankLo).filter(Number.isFinite),med=quant(ranks,.5),duals=new Set(liveRows.filter(r=>r.dual).map(r=>r.trunk)).size,waiting=listedFaces(ro).filter(id=>phaseFor(ro,id)==='waiting').length,d3m=liveIds.filter(id=>parse(id).depth===3&&(liveById.get(id)?.games>0)).length;
  return{updated:new Date().toISOString(),rows,recent:c.recent,inbox:c.n,totalGames:f.total,pairs:f.pairs,cov:{models:liveModels.size,liveFaces:liveIds.length,z1,z2,d3:d3m,d3m,bank:+ro?.gamesSinceCull||0,median:med,duals,waiting,pools}}
}
let cacheK='',cache=null;function data(){let k=[R,I,S,S3,RP,WM,WDM,BM,DP,MP].map(sig).join('|');if(k!==cacheK){cacheK=k;cache=snap()}return cache}
const page=`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Tau Live Ladder</title><style>
:root{color-scheme:dark;--b:#0a0d12;--p:#111720;--l:#263142;--m:#8592a6;--t:#eef4ff;--g:#f3c85c;--c:#67d5ff;--v:#b49cff}*{box-sizing:border-box}body{margin:0;background:var(--b);color:var(--t);font:14px Segoe UI,Arial;overflow:hidden}header{height:82px;display:flex;gap:14px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--l)}h1{font-size:21px;margin:0}.sub{font-size:12px;color:var(--m)}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#67e09f;margin-right:6px}.stats{display:flex;gap:7px;flex:1}.s{min-width:88px;background:var(--p);border:1px solid var(--l);padding:7px 9px;border-radius:8px}.s b{font-size:17px;display:block}.s span{font-size:9px;color:var(--m);text-transform:uppercase}input,button{background:var(--p);border:1px solid var(--l);color:var(--t);border-radius:7px;padding:7px}input{width:180px}button.on{border-color:#63738b}main{height:calc(100vh - 82px);display:grid;grid-template-columns:1fr 300px}.wrap{overflow:auto;border-right:1px solid var(--l)}#board{position:relative;padding-top:32px}.head,.row{display:grid;grid-template-columns:48px minmax(260px,1fr) 80px 64px 64px 180px 210px 110px;align-items:center}.head{position:sticky;top:0;height:32px;background:#0d1219;z-index:4;padding:0 10px;color:var(--m);font-size:10px;text-transform:uppercase}.row{position:absolute;left:6px;right:6px;height:38px;padding:0 10px;border-bottom:1px solid #1c2531;transition:transform .55s,background .3s}.row:hover{background:#151d29}.lad{background:#15130c}.anchor{box-shadow:inset 3px 0 var(--g)}.trial{box-shadow:inset 3px 0 var(--c)}.wait{opacity:.72;border-style:dashed}.old{opacity:.35}.name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.brain{font-weight:650}.tag{font-size:10px;border:1px solid #435065;border-radius:4px;padding:2px 4px;margin-left:6px;color:#aab5c5}.dual{color:#ffd17c}.d2{color:var(--c)}.d3{color:var(--v)}.lad .brain{color:var(--g)}.elo{font-size:17px}.games,.epochs,.ci,.xrank,.state{color:#aab5c5;font-size:12px}.xrank{color:#c8a8ff}.side{padding:12px;overflow:auto}.side h2{font-size:11px;color:var(--m);text-transform:uppercase;letter-spacing:.08em}.event{background:var(--p);border:1px solid var(--l);border-radius:7px;padding:8px;margin-bottom:6px;font-size:12px}</style><header><div><h1>Tau Live Ladder</h1><div class=sub><i class=dot></i><span id=status>connecting…</span></div></div><div class=stats><div class=s><b id=games>—</b><span>rated games</span></div><div class=s><b id=inbox>—</b><span>live inbox</span></div><div class=s><b id=models>—</b><span>live faces</span></div><div class=s><b id=zeros>—</b><span>D1 / D2 zero</span></div><div class=s><b id=d3>—</b><span>D3 measured</span></div><div class=s><b id=cull>—</b><span>cull bank</span></div></div><input id=q placeholder="filter model…"><button id=a class=on>Live faces</button><button id=all>All faces</button></header><main><div class=wrap><div id=board><div class=head><span>#</span><span>brain</span><span>live Elo</span><span>games</span><span>epochs</span><span>measured 90% CI</span><span>extrapolated rank / 90% CI</span><span>state</span></div></div></div><aside class=side><h2>Readout</h2><div id=read class=event>Waiting…</div><h2>Incoming results</h2><div id=recent></div></aside></main><script>
const B=document.getElementById('board'),Q=document.getElementById('q'),A=document.getElementById('a'),ALL=document.getElementById('all');
let P=null,active=true,nodes=new Map;
A.onclick=()=>{active=true;A.className='on';ALL.className='';render()};
ALL.onclick=()=>{active=false;ALL.className='on';A.className='';render()};
Q.oninput=render;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function label(r){return r.kind==='ladder'?r.id:r.label+(r.policy?' +P':'')+(r.depth?' D'+r.depth:'')}
function node(r){if(nodes.has(r.id))return nodes.get(r.id);let e=document.createElement('div');e.className='row';e.innerHTML='<span class=place></span><span class=name></span><span class=elo></span><span class=games></span><span class=epochs></span><span class=ci></span><span class=xrank></span><span class=state></span>';B.appendChild(e);nodes.set(r.id,e);return e}
function ciBound(v,e){return e==='above'?'>L'+v.toFixed(1):e==='below'?'<L'+v.toFixed(1):'L'+v.toFixed(1)}
function render(){
  if(!P)return;
  let s=Q.value.toLowerCase(),rs=P.rows.filter(r=>(!active||r.active)&&(!s||label(r).toLowerCase().includes(s))),vis=new Set(rs.map(r=>r.id));
  for(let[id,e]of nodes)if(!vis.has(id))e.style.display='none';
  rs.forEach((r,i)=>{
    let e=node(r);e.style.display='grid';e.style.transform='translateY('+(32+i*38)+'px';
    e.className='row '+(r.kind==='ladder'?'lad ':'')+(r.protected?'anchor ':'')+(r.phase==='trial'?'trial ':'')+(r.phase==='waiting'?'wait ':'')+(!r.active?'old ':'');
    e.querySelector('.place').textContent=r.place??'—';
    let n='<b class=brain>'+esc(r.label)+'</b>';
    if(r.kind==='net'){if(r.dual)n+='<i class="tag dual">DUAL</i>';if(r.policy)n+='<i class=tag>+P</i>';if(r.depth)n+='<i class="tag d'+r.depth+'">D'+r.depth+'</i>';if(r.phase)n+='<i class=tag>'+esc(r.phase)+'</i>'}
    else if(r.protected)n+='<i class=tag>anchor</i>';
    e.querySelector('.name').innerHTML=n;e.querySelector('.elo').textContent=Number.isFinite(r.elo)?Math.round(r.elo):'—';e.querySelector('.games').textContent=Math.round(r.games);e.querySelector('.epochs').textContent=Number.isFinite(r.epochs)?Math.round(r.epochs):'—';e.querySelector('.ci').textContent=r.rankLo!=null&&r.rankHi!=null?ciBound(r.rankLo,r.rankLoEdge)+' – '+ciBound(r.rankHi,r.rankHiEdge):'—';e.querySelector('.xrank').textContent=Number.isFinite(r.extrapRank)?'xL'+r.extrapRank.toFixed(1)+(Number.isFinite(r.extrapRankLo)&&Number.isFinite(r.extrapRankHi)?' [xL'+r.extrapRankLo.toFixed(1)+' – xL'+r.extrapRankHi.toFixed(1)+']':''):'—';e.querySelector('.state').textContent=r.phase||'historical'
  });
  B.style.height=(32+rs.length*38+10)+'px'
}
function poolReadout(p){return['D1','D2','D3','D4'].map(k=>{let x=p&&p[k]||{};return k+': '+(x.seats||0)+' seats + '+(x.trial||0)+' trial · '+(x.waiting||0)+' waiting'}).join('<br>')}
async function tick(){
  try{
    P=await fetch('/api?t='+Date.now()).then(r=>r.json());games.textContent=Math.round(P.totalGames).toLocaleString();inbox.textContent=P.inbox;models.textContent=P.cov.liveFaces;zeros.textContent=P.cov.z1+' / '+P.cov.z2;d3.textContent=P.cov.d3;cull.textContent=Math.floor(P.cov.bank);status.textContent='live • '+new Date(P.updated).toLocaleTimeString();
    read.innerHTML='<b>'+P.cov.liveFaces+' live faces across '+P.cov.models+' model files</b><br>'+poolReadout(P.cov.pools)+'<br>'+P.cov.duals+' live dual trunks · cull decisions remain face-by-face';
    recent.innerHTML=P.recent.length?P.recent.slice().reverse().map(r=>'<div class=event><b>'+esc(r.a)+'</b> vs <b>'+esc(r.b)+'</b><br>'+r.w+'–'+r.l+(r.d?'–'+r.d:'')+'</div>').join(''):'<div class=event>No unmerged inbox games right now.</div>';render()
  }catch{status.textContent='reconnecting…'}
  setTimeout(tick,1500)
}
tick();</script>`;
function open(u){try{(process.platform==='win32'?spawn('cmd',['/c','start','',u],{detached:true,stdio:'ignore'}):process.platform==='darwin'?spawn('open',[u],{detached:true,stdio:'ignore'}):spawn('xdg-open',[u],{detached:true,stdio:'ignore'})).unref()}catch{}}
function start(port,n=0){let s=http.createServer((req,res)=>{if(req.url.startsWith('/api')){try{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data()))}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}))}}else{res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(page)}});s.on('error',e=>{if(e.code==='EADDRINUSE'&&n<10)return start(port+1,n+1);console.error(e.message)});s.listen(port,host,()=>{let u='http://'+host+':'+port;console.log('Tau Live Ladder\n  '+u+'\n  read-only; leave this window open');open(u)})}
if(require.main===module)start(port0);
module.exports={parse,phaseFor,livePhase,listedFaces,page};
