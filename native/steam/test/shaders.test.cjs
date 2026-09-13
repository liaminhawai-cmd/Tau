const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {game} = require('./game-harness.cjs');

// Exercise the production hook at its material insertion points. The small surrounding shader
// isolates our custom code from Three's lighting variants, while retaining every shared function,
// including Math's geometry helpers when another board's mode is selected at runtime.
async function boardShader(t) {
  const g = await game(); t.after(g.close);
  const shader = {uniforms:{}, vertexShader:`#version 300 es
precision highp float;
#define varying out
in vec3 position;
out vec3 vViewPosition;
uniform mat4 modelMatrix;
#include <common>
void main() {
  vec3 transformed = position;
  vViewPosition = position;
  gl_Position = vec4(position, 1.0);
  #include <fog_vertex>
}`, fragmentShader:`#version 300 es
precision highp float;
#define varying in
in vec3 vViewPosition;
out vec4 fragColor;
#include <common>
void main() {
  vec4 diffuseColor = vec4(1.0);
  float roughnessFactor = 0.5;
  vec3 normal = vec3(0.0, 0.0, 1.0);
  vec3 outgoingLight = vec3(1.0);
  #include <roughnessmap_fragment>
  #include <normal_fragment_maps>
  #include <opaque_fragment>
}`};
  const material = new g.w.THREE.MeshStandardMaterial();
  g.read('makeShowcaseBoards(THREE, CFG, {size:128})').installDetailShader(material);
  material.onBeforeCompile(shader);
  shader.vertexShader = shader.vertexShader.replace(/#include <\w+>/g,'');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <opaque_fragment>','fragColor = vec4(outgoingLight * diffuseColor.rgb, diffuseColor.a);')
    .replace(/#include <\w+>/g,'');
  return {g,shader};
}

test('shared board shader declares and binds every custom uniform, including dormant effects',async t=>{
  const {g,shader} = await boardShader(t);
  const source=shader.vertexShader+'\n'+shader.fragmentShader;
  const declarations=new Set([...source.matchAll(/\buniform\s+\w+\s+(u[A-Z]\w*)/g)].map(m=>m[1]));
  for(const [,name] of source.matchAll(/\b(u[A-Z]\w*)\b/g)){
    assert.ok(declarations.has(name),`${name} is declared even when its effect is inactive`);
    assert.ok(shader.uniforms[name],`${name} has a runtime binding`);
  }
  const geom=shader.uniforms.uBoardGeom.value;
  assert.deepEqual([geom.x,geom.y,geom.z,geom.w],Array.from(g.read(
    '[CFG.rings[0],CFG.rings[1],Math.abs(CFG.sideArcs[0].cx),CFG.sideArcs[0].r]')));
  assert.deepEqual(g.errors,[]);
});

test('shared board shader compiles and links with an OpenGL ES compiler',
  {skip:process.platform!=='linux'},async t=>{
    const {shader} = await boardShader(t);
    const result=spawnSync('python3',[path.join(__dirname,'compile-shader.py')],{
      input:JSON.stringify(shader),encoding:'utf8',timeout:30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.equal(JSON.parse(result.stdout).linked,true);
  });
