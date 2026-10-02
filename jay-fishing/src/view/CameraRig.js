// OWNER: P5 — 계약 §6.9 · §9.5
// STUB — W0 스텁(§6.14): 카메라를 보간한 player.pos + (0, heightAt + 눈높이, 0)에 두고 look 을 적용한다. P5 가 채운다.

import { lerp } from '../core/math.js';
import { WORLD } from '../data/world.js';

export class CameraRig {
  /** @param {{camera:import('three').PerspectiveCamera, settings:Object, world:{heightAt(x:number, z:number):number}}} deps */
  constructor({ camera, settings, world }) {
    this.camera = camera;
    this.settings = settings;
    this.world = world;
  }

  /**
   * @param {Object} state GameState @param {number} alpha @param {number} dt
   * @param {{yaw:number, pitch:number}} look app 의 최신 시선(보간하지 않는다)
   */
  update(state, alpha, dt, look) {
    void dt;
    const p = state.player;
    const x = lerp(p.prevPos.x, p.pos.x, alpha);
    const z = lerp(p.prevPos.z, p.pos.z, alpha);
    const cam = this.camera;
    cam.position.set(x, this.world.heightAt(x, z) + WORLD.eyeHeight, z);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = look.yaw;
    cam.rotation.x = look.pitch;
    cam.rotation.z = 0;
    if (cam.fov !== this.settings.fov) {
      cam.fov = this.settings.fov;
      cam.updateProjectionMatrix();
    }
  }

  dispose() {}
}
