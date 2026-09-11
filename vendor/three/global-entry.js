// Entry for the global (non-module) build of three.js that the game's classic scripts use as
// window.THREE, with the addons the game needs hung off it (THREE.OrbitControls, THREE.MapControls,
// THREE.RoomEnvironment). Built by `npm run build:three` into three.global.js; the showcase page
// imports the module directly through its import map.
import * as THREE from './three.module.js';
import { OrbitControls } from './addons/controls/OrbitControls.js';
import { RoomEnvironment } from './addons/environments/RoomEnvironment.js';
export * from './three.module.js';
export { OrbitControls, RoomEnvironment };
// r169 ships MapControls as its own file, which is not vendored here; it is this small.
export class MapControls extends OrbitControls {
  constructor(object, domElement) {
    super(object, domElement);
    this.screenSpacePanning = false;
    this.mouseButtons.LEFT = THREE.MOUSE.PAN; this.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.touches.ONE = THREE.TOUCH.PAN; this.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  }
}
