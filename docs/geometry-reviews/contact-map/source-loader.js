'use strict';
const fs=require('fs'),path=require('path'),Module=require('module'),crypto=require('crypto');
const repo=path.resolve(process.argv[2]||process.cwd());
const expected={
 'index.html':'c79872b8f3a8cad175075c2639320fa7cf915c29',
 'nn/engine.js':'e7d333a50ea8eb983dbd8308e5748606dbb0ec04',
 'nn/contact-law.js':'b9c7860e8722cf15990228efb401517a180de5b2',
 'nn/forced-win.js':'999af955e2a02e51c163d1fb23c4465526efb28b',
 'nn/opening.js':'4dba6585cde95f2430e14d31b70ac691524474f7',
 'nn/throw-cert.js':'e321f0ab70e729874f61d5dba17b30959ea38ae7'
};
for(const [p,sha]of Object.entries(expected)){
 const b=fs.readFileSync(path.join(repo,p)),actual=crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
 if(actual!==sha)throw Error(p+' hash differs from pinned Brief 7 source: '+actual);
}
const src=path.join(repo,'nn/throw-cert.js');
function loadChecker(patch=s=>s){const m=new Module(src);m.filename=src;m.paths=Module._nodeModulePaths(path.dirname(src));
 let s=fs.readFileSync(src,'utf8').replace('module.exports = { certify, analyse, sweep, pushSubstep, LIM_SUB };','module.exports = { certify, analyse, sweep, pushSubstep, LIM_SUB, arcPts, segClosest3, pairDist };');
 m._compile(patch(s),src);return m.exports;}
const pieces=[{x:-24.31126879077936,y:-37.34799285619334,rot:1.3448263401595464},{x:-11.7593,y:-23.2838,rot:2.9442}];
module.exports={loadChecker,TC:loadChecker(),CL:require(path.join(repo,'nn/contact-law.js')),pieces};
