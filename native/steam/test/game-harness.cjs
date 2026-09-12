// Runs the shipped HTML and desktop script with offline services and a CPU-only canvas.
// This checks gameplay/DOM behavior; it does not validate GPU rendering or native hardware.
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '../../..');

async function game(query = '?steam=1&premium=1', storage = {}) {
  const errors = [], frames = new Map(), timers = new Map();
  let now = 0, id = 0;
  const logs = new VirtualConsole();
  logs.on('jsdomError', e => errors.push(e.message));
  class Assets extends ResourceLoader {
    fetch(url) {
      const u = new URL(url);
      if (u.origin !== 'https://tau.test') return null;
      const file = path.join(root, decodeURIComponent(u.pathname));
      return fs.existsSync(file) ? Promise.resolve(fs.readFileSync(file)) : null;
    }
  }
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'https://tau.test/index.html' + query,
    runScripts:'dangerously', resources:new Assets(), virtualConsole:logs,
    pretendToBeVisual:true,
    beforeParse(w) {
      for (const [key,value] of Object.entries(storage)) w.localStorage.setItem(key,value);
      w.innerWidth=1280; w.innerHeight=800;
      // The showcase boards bake 2048^2 procedural maps; on the CPU canvas stub that is pure cost
      // with nothing to look at, so the desktop asks for tiny bakes when this flag is present.
      w.TAU_TEST_BAKE_SIZE=128;
      w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
      // Pin the web/PWA render-quality heuristic (index.html's detectQualityTier) to its 'basic'
      // branch by default: JSDOM's real hardwareConcurrency (4) would otherwise silently promote
      // every plain web-mode test to 'balanced' and turn TAU_PREMIUM on where tests assume it off.
      // A test exercising the heuristic itself overrides this with its own defineProperty first.
      try { Object.defineProperty(w.navigator, 'hardwareConcurrency', { value: 2, configurable: true }); } catch(e) {}
      w.fetch=async()=>{throw new Error('Offline test');};
      w.TextEncoder=TextEncoder; w.TextDecoder=TextDecoder;
      w.performance.now=()=>now;
      w.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
      w.cancelAnimationFrame=i=>frames.delete(i);
      w.setTimeout=(fn,ms=0,...args)=>{timers.set(++id,{fn:()=>fn(...args),at:now+ms});return id;};
      w.setInterval=(fn,ms=0)=>{timers.set(++id,{fn,at:now+ms,interval:Math.max(1,ms)});return id;};
      w.clearTimeout=w.clearInterval=i=>timers.delete(i);
      w.HTMLElement.prototype.getClientRects=function(){
        for(let p=this;p;p=p.parentElement) if(p.hidden||w.getComputedStyle(p).display==='none')return [];
        return [{x:0,y:0,width:100,height:40}];
      };
      w.HTMLCanvasElement.prototype.getContext=function(type){
        if(type!=='2d')return null;
        const noop=()=>{}, gradient={addColorStop:noop};
        return this._ctx ||= new Proxy({canvas:this,
          createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,
          measureText:s=>({width:String(s).length*8}),
          createImageData:(x,y)=>({data:new Uint8ClampedArray(x*y*4)}),
          getImageData:(x,y,a,b)=>({data:new Uint8ClampedArray(a*b*4)}),
        },{get:(o,k)=>k in o?o[k]:noop});
      };
      w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';
    },
  });
  const w = dom.window;
  await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
  await Promise.resolve();
  function tick(ms=16) {
    for(let remaining=ms;remaining>0;remaining-=16){
      now+=Math.min(16,remaining);
      for(const [key,t] of [...timers])if(t.at<=now){
        if(t.interval)t.at=now+t.interval;else timers.delete(key);
        t.fn();
      }
      const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(now));
    }
  }
  const $=id=>w.document.getElementById(id);
  function key(key,type='keydown') {
    w.document.activeElement.dispatchEvent(new w.KeyboardEvent(type,{key,bubbles:true,cancelable:true}));
  }
  return {w,$,errors,tick,key,close:()=>w.close(),read:code=>w.eval(code)};
}
module.exports={game,root};
