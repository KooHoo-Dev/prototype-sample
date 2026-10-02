// OWNER: P5 — 계약 §6.9 · §9.5 · §5.9
// 1인칭 카메라: 위치 = 보간한 player.pos + (0, heightAt(pos) + 눈높이, 0) · 회전 = app 의 최신 look(보간 없음) · fov = settings.fov.
// PLAYER_PLACED · SCENE_CHANGED(WorldLayer.placeSerial 로 안다) 또는 상태 교체 · 씬/모드 변화에서만 한 프레임에 붙는다(보간을 끊는다).
// 걷기 흔들림: speed > 0.1 이면 진폭 0.03m · 빈도 1.8Hz × (speed / walkSpeed). 낚시 모드 · 패널(sim 이 멈춤) 중에는 없다.

import { clamp, damp, lerp } from '../core/math.js';
import { WORLD } from '../data/world.js';

// 연출 상수
const BOB_AMP = 0.03;          // m(§9.5)
const BOB_HZ = 1.8;            // Hz(§9.5)
const BOB_SPEED_MIN = 0.1;     // m/s
const BOB_SWAY = 0.45;         // 옆 흔들림(진폭 배율 · 걸음 반 빈도)
const BOB_FADE = 8;            // 1/s — 멈추면 진폭이 부드럽게 0으로

export class CameraRig {
  /** @param {{camera:import('three').PerspectiveCamera, settings:Object, world:{heightAt(x:number, z:number):number, heightAtScene?:Function, placeSerial?:number, settings?:Object}}} deps */
  constructor({ camera, settings, world }) {
    this.camera = camera;
    this.settings = settings;
    this.world = world;
    this._serial = -1;
    this._state = null;
    this._scene = null;
    this._mode = null;
    this._tick = null;
    this._phase = 0;
    this._amp = 0;
    /** 마지막 프레임에 순간이동(보간 없이 붙음)했는가 — 테스트 · 디버그용 */
    this.snapped = false;
  }

  /**
   * @param {import('../types.js').GameState} state @param {number} alpha @param {number} dt
   * @param {{yaw:number, pitch:number}} look app 의 최신 시선(보간하지 않는다)
   */
  update(state, alpha, dt, look) {
    const p = state.player;
    const w = this.world;
    const serial = typeof w.placeSerial === 'number' ? w.placeSerial : 0;
    const snap = serial !== this._serial || state !== this._state || state.scene !== this._scene || p.mode !== this._mode;
    this._serial = serial;
    this._state = state;
    this._scene = state.scene;
    this._mode = p.mode;
    this.snapped = snap;

    const a = snap ? 1 : clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    const x = lerp(p.prevPos.x, p.pos.x, a);
    const z = lerp(p.prevPos.z, p.pos.z, a);
    const ground = typeof w.heightAtScene === 'function' ? w.heightAtScene(state.scene, x, z) : w.heightAt(x, z);

    // 걷기 흔들림 — sim 이 멈춘 동안(패널 · 일시정지 · 고정 상태)은 위상이 흐르지 않는다
    const step = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.25));
    const advancing = this._tick !== null && state.tick !== this._tick;
    this._tick = state.tick;
    const walking = p.mode === 'walk' && p.speed > BOB_SPEED_MIN && advancing;
    if (snap) {
      this._amp = 0;
      this._phase = 0;
    } else {
      const target = walking ? BOB_AMP : 0;
      this._amp = damp(this._amp, target, BOB_FADE, step);
      if (walking) this._phase += step * BOB_HZ * (p.speed / WORLD.walkSpeed) * Math.PI * 2;
    }
    const bobY = Math.sin(this._phase) * this._amp;
    const bobX = Math.sin(this._phase * 0.5) * this._amp * BOB_SWAY;

    const cam = this.camera;
    const yaw = look && Number.isFinite(look.yaw) ? look.yaw : p.yaw;
    const pitch = clamp(look && Number.isFinite(look.pitch) ? look.pitch : p.pitch, WORLD.pitchMin, WORLD.pitchMax);
    // 옆 흔들림은 오른쪽 벡터 (cos θ, −sin θ) 방향(§0.2)
    cam.position.set(x + Math.cos(yaw) * bobX, ground + WORLD.eyeHeight + bobY, z - Math.sin(yaw) * bobX);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = yaw;
    cam.rotation.x = pitch;
    cam.rotation.z = 0;
    const s = (w.settings && typeof w.settings.fov === 'number') ? w.settings : this.settings;
    const fov = s && Number.isFinite(s.fov) ? s.fov : cam.fov;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  dispose() {
    this._state = null;
  }
}
