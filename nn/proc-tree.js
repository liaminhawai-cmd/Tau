'use strict';
// Process-tree plumbing for the trainer. On Windows, closing a console window kills the process
// that owned it and leaves every grandchild running: the league loop's rating pass, its arena
// workers, the retromine lanes. Those orphans keep the Elo writer lock and half the cores, so the
// next trainer spends its first hours standing down ("official Elo writer already active") while
// the leftovers crawl on at half speed -- and every restart stacks another layer. One day's league
// files carried two interleaved serial sequences: two league loops, one of them a ghost.
// killTree() takes a whole subtree down when a loop stops; reapOrphans() clears what an earlier
// trainer left behind before a new one starts; commandLine() lets the writer lock check that the
// pid it holds still belongs to a rating pass and not to whatever inherited that number.
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const win=process.platform==='win32';
const dir=__dirname;

// PowerShell via -EncodedCommand: the script never meets cmd/argv quoting rules on its way in.
function ps(script){
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
    '-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:20000,windowsHide:true});
  return r.status===0?String(r.stdout||''):null;
}
function linuxStat(pid){
  const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),rest=stat.slice(stat.lastIndexOf(')')+2).split(' ');
  return {state:rest[0],ppid:+rest[1]};
}
function linuxCmd(pid){return fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').join(' ').trim();}
function isNode(cmd){const exe=cmd.split(' ')[0].split(/[\\/]/).pop().toLowerCase();return exe==='node'||exe==='node.exe';}

// Every process on the box as [{pid,ppid,cmd}]; null when the listing itself failed. Callers treat
// null as "unknown", never as "nothing running".
function listAll(){
  try{
    if(win){
      const out=ps('Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }');
      if(out==null)return null;
      return out.split(/\r?\n/).map(l=>l.split('\t')).filter(p=>p.length>=2&&/^\d+$/.test(p[0]))
        .map(([pid,ppid,...c])=>({pid:+pid,ppid:+ppid,cmd:c.join('\t')}));
    }
    const out=[];
    for(const d of fs.readdirSync('/proc')){
      if(!/^\d+$/.test(d))continue;
      try{const s=linuxStat(d);if(s.state==='Z')continue;out.push({pid:+d,ppid:s.ppid,cmd:linuxCmd(d)});}catch(_){}
    }
    return out;
  }catch(_){return null;}
}

// Command line of one pid, or null when it cannot be read (gone, no permission, tool missing).
function commandLine(pid){
  pid=+pid;if(!Number.isFinite(pid)||pid<=0)return null;
  try{
    if(win){const s=ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`);return s==null?null:(s.trim()||null);}
    return linuxCmd(pid)||null;
  }catch(_){return null;}
}

function killTree(pid,signal){
  pid=+pid;if(!Number.isFinite(pid)||pid<=0)return;
  if(win){spawnSync('taskkill',['/T','/F','/PID',String(pid)],{stdio:'ignore',windowsHide:true});return;}
  const all=listAll()||[],order=[];
  const walk=p=>{for(const c of all)if(c.ppid===p&&c.pid!==p)walk(c.pid);order.push(p);};
  walk(pid);
  for(const p of order)try{process.kill(p,signal||'SIGKILL');}catch(_){}
}

// Kill every node process running one of `scripts` out of THIS nn directory, except ourselves.
// Only the roots are hit -- a target whose parent is also a target dies with that parent's tree --
// so an orphaned elorank-legacy still takes its arena workers with it. Returns what was closed,
// or null when processes could not be listed at all.
function reapOrphans(scripts){
  const all=listAll();if(all==null)return null;
  // Children are spawned with absolute paths, but the launcher runs `node nn\league-trainer.js` from
  // the repo root, so a bare `nn\<script>` token counts too.
  const norm=s=>win?s.toLowerCase():s,base=path.basename(dir);
  const marks=scripts.map(s=>({script:s,abs:norm(path.join(dir,s)),rel:[norm(`${base}/${s}`),norm(`${base}\\${s}`)]}));
  const tokens=cmd=>cmd.split(/\s+/).map(x=>norm(x.replace(/^["']|["']$/g,'')));
  const hit=p=>{if(!p.cmd||!isNode(p.cmd)||p.pid===process.pid)return null;const c=norm(p.cmd),tk=tokens(p.cmd);
    return marks.find(m=>c.includes(m.abs)||tk.some(x=>m.rel.some(r=>x===r||x.endsWith('/'+r)||x.endsWith('\\'+r))))||null;};
  const targets=[];for(const p of all){const m=hit(p);if(m)targets.push({pid:p.pid,ppid:p.ppid,script:m.script});}
  const tp=new Set(targets.map(t=>t.pid)),roots=targets.filter(t=>!tp.has(t.ppid));
  for(const r of roots)killTree(r.pid);
  return roots;
}
module.exports={listAll,commandLine,killTree,reapOrphans};
