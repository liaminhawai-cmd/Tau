const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'..');

// Runs the real main.js against a stub Electron and hands back everything it touched.
async function loadMain(){
  const windows=[], handlers=new Map(), opened=[], appEvents={};
  const counts={quits:0};
  class BrowserWindow {
    constructor(options){this.options=options;this.fullscreen=false;this.events={};
      this.webContents={on:(name,fn)=>this.events[name]=fn,setWindowOpenHandler:fn=>this.openLink=fn};windows.push(this);}
    on(name,fn){this.events[name]=fn;}
    loadFile(file,options){this.file=file;this.loadOptions=options;}
    isFullScreen(){return this.fullscreen;}
    setFullScreen(value){this.fullscreen=value;}
    static fromWebContents(sender){return windows.find(w=>w.webContents===sender);}
    static getAllWindows(){return windows;}
  }
  const app={requestSingleInstanceLock:()=>true,quit:()=>counts.quits++,isPackaged:false,
    commandLine:{appendSwitch(){}},on(name,fn){appEvents[name]=fn;},whenReady:()=>Promise.resolve()};
  const electron={app,BrowserWindow,ipcMain:{handle:(k,v)=>handlers.set(k,v)},
    shell:{openExternal:url=>opened.push(url)}};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'main.js'),'utf8'),{
    require:n=>{if(n==='electron')return electron;if(n==='steamworks.js')throw Error('Steam offline');
      return require(n.startsWith('.')?path.join(dir,n):n);},
    __dirname:dir,process:{platform:'linux'},module:{exports:{}},console,
  });
  await Promise.resolve();
  return {windows,handlers,opened,appEvents,counts};
}

test('Electron loads the unified game and reserves Escape for its menu',async()=>{
  const {windows,handlers,counts}=await loadMain();
  const win=windows[0];
  assert.equal(path.basename(win.file),'index.html');
  assert.equal(win.loadOptions.query.steam,'1');
  assert.equal(win.loadOptions.query.premium,'1');
  assert.equal(win.options.webPreferences.contextIsolation,true);
  assert.equal(win.options.webPreferences.nodeIntegration,false);
  assert.equal(win.options.webPreferences.sandbox,true);
  let prevented=0;
  const send=key=>win.events['before-input-event']({preventDefault:()=>prevented++},{type:'keyDown',key});
  send('F11');assert.equal(win.isFullScreen(),true);assert.equal(prevented,1);
  send('Escape');assert.equal(win.isFullScreen(),true);assert.equal(prevented,1);
  // F2 flips to the showcase page and back to the desktop game.
  send('F2');assert.equal(path.basename(win.file),'steam.html');assert.equal(win.loadOptions.query.steam,'1');
  win.webContents.getURL=()=>'file:///www/steam.html?steam=1';
  send('F2');assert.equal(path.basename(win.file),'index.html');assert.equal(win.loadOptions.query.premium,'1');
  delete win.webContents.getURL;
  const event={sender:win.webContents};
  assert.equal(handlers.get('desktop:fullscreen')(event,false),false);
  assert.equal(handlers.get('desktop:fullscreen')(event),false);
  assert.equal(handlers.get('steam:status')().available,false);
  handlers.get('desktop:quit')();assert.equal(counts.quits,1);
});

test('both native shells (Steam and the Android/iOS app) sync the premium showcase catalogue',()=>{
  // The Android APK used to ship the plain web build (no marble/colossus/etc.) because only the
  // Steam wrapper's sync-www passed --premium; the native app's own script silently didn't. Guard
  // both package.json scripts directly, so losing the flag again fails a test instead of an APK.
  const steamPkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const appPkg=JSON.parse(fs.readFileSync(path.join(dir,'..','app','package.json'),'utf8'));
  assert.match(steamPkg.scripts['sync-www'],/--premium\b/);
  // main.js requires loopback-auth.js at startup, so leaving it out of the packaged files would
  // break the shipped app on launch while every test here still passed.
  assert.ok(steamPkg.build.files.includes('loopback-auth.js'),'the packaged build ships the sign-in server');
  assert.match(appPkg.scripts['sync-www'],/--premium\b/);
});

test('sync-www.mjs --premium bundles the showcase catalogue; without it, only the plain web build',()=>{
  const os=require('node:os'), {execFileSync}=require('node:child_process');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tau-sync-'));
  const script=path.join(dir,'..','scripts','sync-www.mjs');
  try {
    execFileSync(process.execPath,[script,path.join(tmp,'plain')]);
    assert.equal(fs.existsSync(path.join(tmp,'plain','desktop')),false,'plain build carries no showcase code');
    assert.equal(fs.existsSync(path.join(tmp,'plain','steam.html')),false);
    execFileSync(process.execPath,[script,path.join(tmp,'premium'),'--premium']);
    assert.ok(fs.existsSync(path.join(tmp,'premium','desktop','boards.js')));
    assert.ok(fs.existsSync(path.join(tmp,'premium','desktop','presentation.js')));
    assert.ok(fs.existsSync(path.join(tmp,'premium','steam.html')));
    assert.ok(fs.existsSync(path.join(tmp,'premium','vendor','three','three.global.js')));
    // Ray tracing (Ultra) loads its bundle from disk at the moment a player turns it on, so an
    // offline shell that did not ship the file would offer a setting that can never work.
    assert.ok(fs.existsSync(path.join(tmp,'premium','vendor','pathtracer','pathtracer.global.js')));
    assert.equal(fs.existsSync(path.join(tmp,'plain','vendor','pathtracer')),false,'never in the plain web build');
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});

test('preload exposes a narrow desktop and Steam IPC bridge',async()=>{
  let name,api;const calls=[];
  const electron={contextBridge:{exposeInMainWorld:(n,a)=>{name=n;api=a;}},
    ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve(true);}}};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'preload.js'),'utf8'),{require:()=>electron});
  assert.equal(name,'tauSteam');
  await api.isFullscreen();await api.setFullscreen(false);await api.quit();
  assert.deepEqual(calls,[['desktop:fullscreen'],['desktop:fullscreen',false],['desktop:quit']]);
  assert.equal(api.ipcRenderer,undefined);
  // The desktop Google sign-in: reserve the loopback port, then hand over the authorize URL.
  calls.length=0;
  await api.googleAuthBegin();
  await api.googleSignIn('https://project.supabase.co/auth/v1/authorize?x=1','STATE');
  await api.googleSignIn();
  // preload.js runs in its own vm realm here, so its payloads are read field by field.
  assert.deepEqual(calls.map(c=>c[0]),['auth:google-begin','auth:google','auth:google']);
  assert.equal(calls[1][1].url,'https://project.supabase.co/auth/v1/authorize?x=1');
  assert.equal(calls[1][1].state,'STATE');
  assert.equal(calls[2][1].url,'','a call with nothing in it still sends a plain, harmless payload');
  assert.equal(calls[2][1].state,'');
});

test('the desktop Google flow opens the system browser and carries the code back',async()=>{
  const {handlers,appEvents,opened}=await loadMain();
  const http=require('node:http');
  const fetchBack=url=>new Promise((resolve,reject)=>{
    const req=http.get(url,res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);
  });

  // Nothing happens before the renderer has asked for a port. (main.js runs in its own vm realm,
  // so its replies are compared field by field: deepEqual would trip over the foreign prototype.)
  assert.equal((await handlers.get('auth:google')({}, {url:'https://x/',state:'anything'})).error,
    'Sign-in was not started.');

  const begin=await handlers.get('auth:google-begin')();
  if (begin.error) return;   // all three fixed ports busy on this machine: nothing to test
  assert.equal(begin.redirectUri,`http://127.0.0.1:${begin.port}/`);
  assert.ok([8765,8766,8767].includes(begin.port),'only the whitelisted ports are used');

  // A caller that does not know the state the main process minted gets nowhere, and the attempt
  // it tried to hijack is torn down with it.
  assert.equal((await handlers.get('auth:google')({}, {url:'https://evil.example/',state:'guess'})).error,
    'Sign-in request was rejected.');
  await assert.rejects(fetchBack(begin.redirectUri),/ECONNREFUSED/,'and the port is released');

  const second=await handlers.get('auth:google-begin')();
  const url='https://project.supabase.co/auth/v1/authorize?provider=google';
  const waiting=handlers.get('auth:google')({}, {url,state:second.state});
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual([...opened],[url],'the SYSTEM browser is sent there -- the game window is never navigated');
  assert.equal(await fetchBack(`${second.redirectUri}?code=FROM_GOOGLE&state=${second.state}`),200);
  assert.equal((await waiting).code,'FROM_GOOGLE');

  // Quitting (or closing the window) can never leave a listener behind.
  const third=await handlers.get('auth:google-begin')();
  appEvents['before-quit']();
  await assert.rejects(fetchBack(third.redirectUri),/ECONNREFUSED/);
});
