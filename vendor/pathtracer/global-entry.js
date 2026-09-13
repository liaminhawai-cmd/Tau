// Entry for the global (non-module) build of the optional path tracer, exposed as window.TAU_PT
// and loaded only when a player turns Ray tracing (Ultra) on. Built by
// scripts/build-pathtracer-global.mjs into pathtracer.global.js.
//
// CubeToEquirectGenerator is not in the package's own index.js, but the desktop layer needs it:
// the game lights itself from a PMREM environment, which the tracer cannot sample, so the room is
// re-rendered into a cube map and converted here into the equirect map the tracer does understand.
export * from './three-gpu-pathtracer/src/index.js';
export { CubeToEquirectGenerator } from './three-gpu-pathtracer/src/utils/CubeToEquirectGenerator.js';
