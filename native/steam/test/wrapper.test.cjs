const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'..');

test('Electron loads the unified game and reserves Escape for its menu',async()=>{
  const windows=[], handlers=new Map();
  let quits=0;
  class BrowserWindow {
    constructor(options){this.options=options;this.fullscreen=false;this.events={};
      this.webContents={on:(name,fn)=>this.events[name]=fn,setWindowOpenHandler:fn=>this.openLink=fn};windows.push(this);}
    loadFile(file,options){this.file=file;this.loadOptions=options;}
    isFullScreen(){return this.fullscreen;}
    setFullScreen(value){this.fullscreen=value;}
    static fromWebContents(sender){return windows.find(w=>w.webContents===sender);}
    static getAllWindows(){return windows;}
  }
  const app={requestSingleInstanceLock:()=>true,quit:()=>quits++,isPackaged:false,
    commandLine:{appendSwitch(){}},on(){},whenReady:()=>Promise.resolve()};
  const electron={app,BrowserWindow,ipcMain:{handle:(k,v)=>handlers.set(k,v)},shell:{openExternal(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'main.js'),'utf8'),{
    require:n=>{if(n==='electron')return electron;if(n==='steamworks.js')throw Error('Steam offline');return require(n);},
    __dirname:dir,process:{platform:'linux'},module:{exports:{}},console,
  });
  await Promise.resolve();
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
  const event={sender:win.webContents};
  assert.equal(handlers.get('desktop:fullscreen')(event,false),false);
  assert.equal(handlers.get('desktop:fullscreen')(event),false);
  assert.equal(handlers.get('steam:status')().available,false);
  handlers.get('desktop:quit')();assert.equal(quits,1);
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
});
