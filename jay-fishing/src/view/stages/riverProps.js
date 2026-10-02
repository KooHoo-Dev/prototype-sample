// OWNER: P12 — 계약 §9.4 · §8.3
// STUB — W0 스텁(§6.14): 빈 그룹 · no-op. P12 가 그 장소의 소품을 채운다(three 만 — Node 에서도 만들어진다 · DataTexture 만).

import * as THREE from 'three';

/** @typedef {{hour:number, light:number, night:boolean, sunDir:THREE.Vector3, weather:string, waveAmp:number, wavePeriod:number, time:number, camPos:THREE.Vector3}} PropsEnv */

/**
 * STUB
 * @param {{stage:import('../../types.js').StageDef, quality:'low'|'medium'|'high', heightAt:(x:number, z:number) => number}} args
 * @returns {{group:THREE.Group, update(env:PropsEnv, dt:number):void, setQuality(q:'low'|'medium'|'high'):void, dispose():void}}
 */
export function buildRiverProps(args) {
  void args;
  const group = new THREE.Group();
  group.name = 'props:river';
  return {
    group,
    update(env, dt) { void env; void dt; },
    setQuality(q) { void q; },
    dispose() {},
  };
}
