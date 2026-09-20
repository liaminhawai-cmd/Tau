'use strict';
// The run froze index.html before DEAD_CERTS existed. Its historical loader
// does not expose crossingSubstep, which the later forced-win.js needs.
// Expose that already-extracted rule function in memory; change no rule body.
const fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'repo/nn/engine.js');
const source=fs.readFileSync(file,'utf8'),needle='__exports = {';
if(source.split(needle).length!==2)throw Error('Unexpected loader export layout');
const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
m._compile(source.replace(needle,needle+'\n  crossingSubstep,'),file);
require.cache[file]=m;
module.exports={FW:require('./repo/nn/forced-win.js'),CL:require('./repo/nn/contact-law.js')};
