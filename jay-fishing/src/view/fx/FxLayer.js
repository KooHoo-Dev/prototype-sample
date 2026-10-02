// OWNER: P7 — 계약 §6.9 · §9.9
// 연출: 물보라(입자) · 파문(고리) · 라인이 물을 가르는 물보라 줄기 · 빗방울 튐.
// 입자 400 · 고리 24 는 생성자에서 한 번 만든 풀이다 — 판을 반복해도 지오메트리 · 재질 · 메시가 늘지 않는다.
// 이벤트는 받는 즉시 그리지 않고 고정 크기 큐에 적어 두었다가 update 에서 지금 상태(찌 · 물고기 위치)로 꺼낸다.
// 이벤트를 놓쳐도(?fixture · 불러오기) update 가 state 를 보고 맞춘다: 씬이 바뀌면 비우고, 공중의 물고기에는 물보라를 낸다.
// 화면 전체를 덮는 섬광 · 점멸 · 비네트 없음(QUALITY §4) — 물보라 불투명도 ≤ 0.8, 고리는 찌 둘레에서 바깥으로만 퍼진다.

import * as THREE from 'three';
import { EV } from '../../core/events.js';
import { clamp, clamp01, lerp, lerpAngle } from '../../core/math.js';
import { getSpot } from '../../data/stages/index.js';

// ── 연출 상수
const MAX_PARTICLES = 400;          // §9.9 풀 상한
const MAX_RINGS = 24;               // §9.9 풀 상한
const MAX_ALPHA = 0.8;              // §9.9 물보라 불투명도 상한
const GRAVITY = 9.8;                // m/s²
const WATER_Y = 0;                  // 수면
const RING_Y = 0.035;               // 고리 높이(수면 잔물결 위)
const RING_INNER = 0.8;             // 고리 안쪽 반경 비(바깥 1)
const RING_SEGMENTS = 48;
const RING_COLOR = '#f4fbfd';
const SPRAY_COLOR = '#eef8fb';
const LIGHT_MIN = 0.3;              // 밤에도 물보라가 아주 검어지지는 않는다(헤드랜턴)
const QUEUE_SIZE = 32;

// 보이는 크기: 멀리서도 읽히게 카메라 거리로 키운다(찌의 scale = clamp(dist / 7, 1, 18) 과 같은 생각)
const VIS_REF_M = 8;
const VIS_MAX = 10;

/** 물보라 종류 — count 개수 · 속도(m/s) · 크기(m) · 수명(s) · 불투명도 */
const SPLASH = {
  cast:    { count: 20, up: [1.8, 2.8], out: [0.4, 1.2], size: [0.07, 0.14], life: [0.5, 0.85], alpha: 0.75 },
  hook:    { count: 10, up: [1.0, 1.8], out: [0.3, 0.9], size: [0.04, 0.08], life: [0.35, 0.6], alpha: 0.6 },
  jump:    { count: 40, up: [2.2, 4.0], out: [0.8, 2.0], size: [0.09, 0.2], life: [0.6, 1.1], alpha: 0.78 },
  net:     { count: 24, up: [1.0, 2.0], out: [0.4, 1.1], size: [0.05, 0.10], life: [0.45, 0.8], alpha: 0.7 },
  release: { count: 12, up: [0.8, 1.5], out: [0.3, 0.8], size: [0.04, 0.08], life: [0.4, 0.7], alpha: 0.6 },
};
/** 파문 — 반경(m, 보이는 크기 배율 전) · 수명 · 불투명도 */
const RIPPLE = {
  cast:   { r0: 0.15, r1: 1.4, life: 1.4, alpha: 0.7 },
  nibble: { r0: 0.14, r1: 0.5, life: 0.9, alpha: 0.7 },
  take:   { r0: 0.18, r1: 0.9, life: 1.1, alpha: 0.78 },
  jump:   { r0: 0.3,  r1: 2.4, life: 1.8, alpha: 0.7 },
  net:    { r0: 0.2,  r1: 1.2, life: 1.2, alpha: 0.65 },
};
const TAKE_RING_GAP = 0.22;         // s — 본신 파문 두 개의 간격
const JUMP_LEN_REF = 0.5;           // m — 이 길이에서 점프 물보라 배율 1
const JUMP_SCALE = [0.6, 2.2];      // 점프 물보라 배율 범위(lengthM 에 비례)

// 라인이 물을 가르는 물보라 줄기(질주 · 미끄러짐 — 속도 ∝ slipSpeed)
const STREAM_BASE = 24;             // 개/s
const STREAM_PER_SLIP = 30;         // 개/s per (m/s)
const STREAM_MAX = 90;              // 개/s
const STREAM_BACK_M = 0.35;         // 물고기 자리에서 낚시꾼 쪽으로(라인이 수면을 자르는 점)
const STREAM = { up: [1.1, 2.1], side: [0.3, 0.9], size: [0.06, 0.12], life: [0.3, 0.55], alpha: 0.55 };

// 빗방울 튐(medium 이상 · env.rain)
const RAIN_RATE = { low: 0, medium: 45, high: 90 };   // 개/s × rain
const RAIN_RADIUS = [2.5, 16];      // m — 카메라 둘레
const RAIN_RESERVE = 120;           // 이 개수만큼은 이벤트 물보라 몫으로 비워 둔다
const RAIN_DROP = { up: [0.5, 0.9], size: [0.02, 0.035], life: [0.18, 0.28], alpha: 0.45 };
const RELEASE_PAD_M = 0.4;          // 방생 물보라: 해안선(edgeM)에서 물 쪽으로

const EVT = { CAST: 1, NIBBLE: 2, TAKE: 3, HOOK: 4, JUMP: 5, NET: 6, RELEASE: 7, CLEAR: 8, STREAM_OFF: 9 };

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(0.05, -mv.z);
  gl_PointSize = aAlpha > 0.0 ? clamp(aSize * uScale / d, 1.5, 64.0) : 0.0;
  vAlpha = aAlpha;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uLight;
uniform float uMaxAlpha;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0 || vAlpha <= 0.0) discard;
  float a = min(vAlpha, uMaxAlpha) * (1.0 - smoothstep(0.35, 1.0, r2));
  gl_FragColor = vec4(uColor * uLight, a);
}`;

const rnd = (a, b) => a + Math.random() * (b - a);

export class FxLayer {
  /** @param {{rc:import('../renderer.js').RenderContext, bus:import('../../core/events.js').EventBus, settings:Object, world:{heightAt:(x:number,z:number)=>number}}} deps */
  constructor({ rc, bus, settings, world }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.world = world;
    this.root = new THREE.Group();
    this.root.name = 'fxRoot';
    rc.scene.add(this.root);

    // ── 입자 풀(Points 하나)
    const n = MAX_PARTICLES;
    this.pPos = new Float32Array(n * 3);
    this.pVel = new Float32Array(n * 3);
    this.pSize = new Float32Array(n);
    this.pAlpha = new Float32Array(n);
    this.pAge = new Float32Array(n);
    this.pLife = new Float32Array(n);      // 0 = 빈 칸
    this.pBase = new Float32Array(n);      // 시작 불투명도
    this.active = 0;
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);   // 매 프레임 다시 재지 않는다
    this.pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 600 },
        uColor: { value: new THREE.Color(SPRAY_COLOR) },
        uLight: { value: 1 },
        uMaxAlpha: { value: MAX_ALPHA },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.pointsMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.root.add(this.points);

    // ── 고리 풀(같은 지오메트리 · 고리마다 재질 — 프로그램은 하나)
    this.ringGeo = new THREE.RingGeometry(RING_INNER, 1, RING_SEGMENTS, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringColor = new THREE.Color(RING_COLOR);
    /** @type {{mesh:THREE.Mesh, mat:THREE.MeshBasicMaterial, x:number, z:number, r0:number, r1:number, age:number, life:number, alpha:number, delay:number}[]} */
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: this.ringColor.clone(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = true;
      this.root.add(mesh);
      this.rings.push({ mesh, mat, x: 0, z: 0, r0: 0, r1: 0, age: 0, life: 0, alpha: 0, delay: 0 });
    }
    this.ringsActive = 0;

    // ── 이벤트 큐(고정 크기 · 재사용)
    this.queue = [];
    for (let i = 0; i < QUEUE_SIZE; i++) this.queue.push({ type: 0, x: 0, z: 0, a: 0, b: 0 });
    this.qLen = 0;

    this.sceneId = null;
    this.airSplashed = false;     // 이번 공중 구간에 물보라를 냈는가(이벤트 · 상태 어느 쪽이든)
    this.streamAcc = 0;
    this.rainAcc = 0;
    /** @type {Object|null} FIGHT_END · FISHING_EXIT 로 끝난 파이팅(같은 객체면 줄기를 다시 켜지 않는다) */
    this.endedFight = null;
    this.fishX = 0;
    this._tmpX = 0;
    this._tmpZ = 0;
    this.fishZ = 0;

    const B = EV;
    this._offs = [
      bus.on(B.CAST_SPLASH, (p) => this._push(EVT.CAST, p.x, p.z, 0, 0)),
      bus.on(B.BITE_NIBBLE, (p) => { if (p.set !== 'bottom') this._push(EVT.NIBBLE, 0, 0, num(p.strength, 0.5), 0); }),
      bus.on(B.BITE_TAKE, (p) => { if (p.set !== 'bottom') this._push(EVT.TAKE, 0, 0, 0, 0); }),
      bus.on(B.HOOK_SET, () => this._push(EVT.HOOK, 0, 0, 0, 0)),
      bus.on(B.FIGHT_JUMP, (p) => this._push(EVT.JUMP, p.x, p.z, num(p.lengthM, JUMP_LEN_REF), p.phase === 'land' ? 1 : 0)),
      bus.on(B.NET_START, (p) => this._push(EVT.NET, p.x, p.z, num(p.lengthM, JUMP_LEN_REF), 0)),
      bus.on(B.CATCH_RELEASED, () => this._push(EVT.RELEASE, 0, 0, 0, 0)),
      bus.on(B.SCENE_CHANGED, () => this._push(EVT.CLEAR, 0, 0, 0, 0)),
      bus.on(B.FISHING_EXIT, () => this._push(EVT.STREAM_OFF, 0, 0, 0, 0)),
      bus.on(B.FIGHT_END, () => this._push(EVT.STREAM_OFF, 0, 0, 0, 0)),
    ];
  }

  _push(type, x, z, a, b) {
    if (this.qLen >= QUEUE_SIZE) {      // 가득 차면 가장 오래된 것을 버린다(한 프레임에 32개가 넘는 일은 없다)
      const first = this.queue[0];
      for (let i = 1; i < QUEUE_SIZE; i++) this.queue[i - 1] = this.queue[i];
      this.queue[QUEUE_SIZE - 1] = first;
      this.qLen = QUEUE_SIZE - 1;
    }
    const e = this.queue[this.qLen++];
    e.type = type; e.x = num(x, 0); e.z = num(z, 0); e.a = a; e.b = b;
  }

  /** @param {import('../../types.js').GameState} state @param {number} alpha @param {number} dt */
  update(state, alpha, dt) {
    if (!state) return;
    const step = clamp(num(dt, 0), 0, 0.1);   // 큰 dt(탭 복귀) 에서 입자가 순간이동하지 않게

    // 씬이 바뀌었으면(이벤트를 놓쳤어도) 비운다
    if (state.scene !== this.sceneId) {
      this.sceneId = state.scene;
      this.clear();
    }

    // 물고기 입수점(보간)
    const fight = state.fight;
    const rig = state.rig;
    const fighting = !!fight && !!rig && rig.phase === 'fighting';
    if (fight && rig) {
      const a = clamp01(num(alpha, 1));
      const b = lerpAngle(num(fight.prevBearing, fight.bearing), num(fight.bearing, 0), a);
      const d = lerp(num(fight.prevDist, fight.dist), num(fight.dist, 0), a);
      this.fishX = rig.origin.x - Math.sin(b) * d;
      this.fishZ = rig.origin.z - Math.cos(b) * d;
    }

    // 이벤트 → 연출
    for (let i = 0; i < this.qLen; i++) this._apply(this.queue[i], state);
    this.qLen = 0;

    // 공중의 물고기: 이벤트 없이 상태만 와도 물보라(한 공중 구간에 한 번)
    const air = fight ? num(fight.airborne, 0) : 0;
    if (fighting && air > 0) {
      if (!this.airSplashed) {
        this.airSplashed = true;
        this._jumpSplash(this.fishX, this.fishZ, fight.roll ? num(fight.roll.lengthCm, 50) / 100 : JUMP_LEN_REF);
      }
    } else if (air <= 0) {
      this.airSplashed = false;
    }

    // 라인이 물을 가르는 물보라 줄기
    if (fighting && fight !== this.endedFight && air <= 0 && (fight.slipping || fight.behavior === 'run' || fight.behavior === 'dive')) {
      const slip = fight.slipping ? Math.max(0, num(fight.slipSpeed, 0)) : 0;
      const rate = Math.min(STREAM_MAX, STREAM_BASE + STREAM_PER_SLIP * slip);
      this.streamAcc += rate * step;
      if (this.streamAcc > STREAM_MAX * 0.1) this.streamAcc = STREAM_MAX * 0.1;
      const bx = rig.origin.x - this.fishX;
      const bz = rig.origin.z - this.fishZ;
      const bl = Math.hypot(bx, bz) || 1;
      const ux = bx / bl;
      const uz = bz / bl;
      const ex = this.fishX + ux * STREAM_BACK_M;
      const ez = this.fishZ + uz * STREAM_BACK_M;
      const vis = this._vis(ex, ez);
      const sp = 1 + 0.25 * slip;
      while (this.streamAcc >= 1) {
        this.streamAcc -= 1;
        const side = (Math.random() < 0.5 ? -1 : 1) * rnd(STREAM.side[0], STREAM.side[1]) * sp;
        // 라인에 수직(옆) 으로 튀고, 물고기가 가는 쪽(낚시꾼 반대)으로 조금 밀린다
        this._spawn(ex, WATER_Y + 0.02, ez,
          -uz * side - ux * 0.3 * sp, rnd(STREAM.up[0], STREAM.up[1]) * Math.sqrt(sp), ux * side - uz * 0.3 * sp,
          rnd(STREAM.size[0], STREAM.size[1]) * vis, rnd(STREAM.life[0], STREAM.life[1]), STREAM.alpha);
      }
    } else {
      this.streamAcc = 0;
    }

    // 비
    const env = state.env;
    const q = this.rc.quality || (this.settings && this.settings.quality) || 'medium';
    const rainRate = (RAIN_RATE[q] || 0) * (env ? clamp01(num(env.rain, 0)) : 0);
    if (rainRate > 0 && state.scene !== 'home') {
      this.rainAcc += rainRate * step;
      if (this.rainAcc > 8) this.rainAcc = 8;
      const cam = this.rc.camera.position;
      while (this.rainAcc >= 1) {
        this.rainAcc -= 1;
        if (this.active >= MAX_PARTICLES - RAIN_RESERVE) break;
        const ang = Math.random() * Math.PI * 2;
        const r = rnd(RAIN_RADIUS[0], RAIN_RADIUS[1]);
        const x = cam.x + Math.cos(ang) * r;
        const z = cam.z + Math.sin(ang) * r;
        if (!this._isWater(x, z)) continue;
        this._spawn(x, WATER_Y + 0.01, z, 0, rnd(RAIN_DROP.up[0], RAIN_DROP.up[1]), 0,
          rnd(RAIN_DROP.size[0], RAIN_DROP.size[1]), rnd(RAIN_DROP.life[0], RAIN_DROP.life[1]), RAIN_DROP.alpha);
      }
    } else {
      this.rainAcc = 0;
    }

    // 빛(밤에는 어둡게 — 헤드랜턴 몫으로 바닥값)
    const light = state.clock ? clamp01(num(state.clock.light, 1)) : 1;
    const lum = LIGHT_MIN + (1 - LIGHT_MIN) * light;
    this.pointsMat.uniforms.uLight.value = lum;
    const el = this.rc.renderer && this.rc.renderer.domElement;
    const h = el && el.height > 0 ? el.height : 720;
    const fov = this.rc.camera.fov || 70;
    this.pointsMat.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));

    this._stepParticles(step);
    this._stepRings(step, lum);
  }

  /** @param {{type:number, x:number, z:number, a:number, b:number}} e @param {import('../../types.js').GameState} state */
  _apply(e, state) {
    const rig = state.rig;
    switch (e.type) {
      case EVT.CAST:
        this._splash(SPLASH.cast, e.x, e.z, 1);
        this._ring(RIPPLE.cast, e.x, e.z, 0, this._bobberVis(state, e.x, e.z));
        break;
      case EVT.NIBBLE:
        if (rig && rig.bobber) {
          const s = clamp(e.a, 0.2, 1);
          const vis = this._bobberVis(state, rig.bobber.x, rig.bobber.z);
          this._ring(RIPPLE.nibble, rig.bobber.x, rig.bobber.z, 0, vis, s);
        }
        break;
      case EVT.TAKE:
        if (rig && rig.bobber) {
          const vis = this._bobberVis(state, rig.bobber.x, rig.bobber.z);
          this._ring(RIPPLE.take, rig.bobber.x, rig.bobber.z, 0, vis);
          this._ring(RIPPLE.take, rig.bobber.x, rig.bobber.z, TAKE_RING_GAP, vis);
        }
        break;
      case EVT.HOOK: {
        // 입수점: 파이팅이 섰으면 물고기 자리, 아니면 찌
        let x = 0;
        let z = 0;
        if (state.fight) { x = this.fishX; z = this.fishZ; } else if (rig && rig.bobber) { x = rig.bobber.x; z = rig.bobber.z; } else break;
        this._splash(SPLASH.hook, x, z, 1);
        break;
      }
      case EVT.JUMP:
        if (e.b === 0) {
          if (this.airSplashed) break;      // 상태로 이미 냈다
          this.airSplashed = true;
        }
        this._jumpSplash(e.x, e.z, e.a);
        break;
      case EVT.NET:
        this._splash(SPLASH.net, e.x, e.z, clamp(e.a / JUMP_LEN_REF, 0.7, 1.6));
        this._ring(RIPPLE.net, e.x, e.z, 0, 1);
        break;
      case EVT.RELEASE: {
        if (this._releasePoint(state)) this._splash(SPLASH.release, this._tmpX, this._tmpZ, 1);
        break;
      }
      case EVT.CLEAR:
        this.clear();
        break;
      case EVT.STREAM_OFF:
        this.streamAcc = 0;
        this.endedFight = state.fight || null;
        break;
      default:
        break;
    }
  }

  _jumpSplash(x, z, lengthM) {
    const k = clamp(num(lengthM, JUMP_LEN_REF) / JUMP_LEN_REF, JUMP_SCALE[0], JUMP_SCALE[1]);
    this._splash(SPLASH.jump, x, z, k);
    this._ring(RIPPLE.jump, x, z, 0, Math.sqrt(k));
  }

  /** 방생 물보라 자리 — 발밑 해안선에서 물 쪽으로. 결과는 _tmpX/_tmpZ @returns {boolean} */
  _releasePoint(state) {
    const player = state.player;
    if (!player) return false;
    const spot = player.spotId ? getSpot(player.spotId) : null;
    if (spot) {
      const d = num(spot.edgeM, 1.5) + RELEASE_PAD_M;
      this._tmpX = spot.stand.x - Math.sin(spot.facing) * d;
      this._tmpZ = spot.stand.z - Math.cos(spot.facing) * d;
      return true;
    }
    this._tmpX = player.pos.x - Math.sin(player.yaw) * (1 + RELEASE_PAD_M);
    this._tmpZ = player.pos.z - Math.cos(player.yaw) * (1 + RELEASE_PAD_M);
    return true;
  }

  /** 찌 둘레 파문의 크기 — 찌의 보이는 크기(clamp(dist/7, 1, 18))를 따라가되 조금 덜 */
  _bobberVis(state, x, z) {
    const o = state.rig && state.rig.origin;
    const d = o ? Math.hypot(x - o.x, z - o.z) : 7;
    return Math.pow(clamp(d / 7, 1, 18), 0.8);
  }

  /** 카메라 거리로 정하는 물보라 크기 배율 */
  _vis(x, z) {
    const c = this.rc.camera.position;
    return clamp(Math.hypot(x - c.x, z - c.z) / VIS_REF_M, 1, VIS_MAX);
  }

  _isWater(x, z) {
    const w = this.world;
    if (!w || typeof w.heightAt !== 'function') return true;
    const h = w.heightAt(x, z);
    return Number.isFinite(h) && h < -0.02;
  }

  /** @param {typeof SPLASH.cast} def */
  _splash(def, x, z, scale) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const vis = this._vis(x, z);
    const spd = Math.sqrt(scale) * Math.sqrt(vis);
    for (let i = 0; i < def.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const out = rnd(def.out[0], def.out[1]) * spd;
      this._spawn(
        x + Math.cos(ang) * 0.05 * vis, WATER_Y + 0.02, z + Math.sin(ang) * 0.05 * vis,
        Math.cos(ang) * out, rnd(def.up[0], def.up[1]) * spd, Math.sin(ang) * out,
        rnd(def.size[0], def.size[1]) * scale * vis, rnd(def.life[0], def.life[1]) * Math.sqrt(scale), def.alpha,
      );
    }
  }

  _spawn(x, y, z, vx, vy, vz, size, life, alpha) {
    // 빈 칸을 찾고, 없으면 가장 오래 산(수명 비율이 큰) 칸을 덮어쓴다
    let idx = -1;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      const i = (this.cursor + k) % MAX_PARTICLES;
      if (this.pLife[i] === 0) { idx = i; break; }
    }
    if (idx < 0) {
      let best = 0;
      let bestF = -1;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const f = this.pAge[i] / this.pLife[i];
        if (f > bestF) { bestF = f; best = i; }
      }
      idx = best;
    } else {
      this.active++;
    }
    this.cursor = (idx + 1) % MAX_PARTICLES;
    const j = idx * 3;
    this.pPos[j] = x; this.pPos[j + 1] = y; this.pPos[j + 2] = z;
    this.pVel[j] = vx; this.pVel[j + 1] = vy; this.pVel[j + 2] = vz;
    this.pSize[idx] = size;
    this.pAge[idx] = 0;
    this.pLife[idx] = Math.max(0.05, life);
    this.pBase[idx] = Math.min(MAX_ALPHA, alpha);
    this.pAlpha[idx] = this.pBase[idx];
  }

  _stepParticles(dt) {
    if (this.active === 0) return;
    let alive = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.pLife[i];
      if (life === 0) continue;
      const age = this.pAge[i] + dt;
      const j = i * 3;
      const vy = this.pVel[j + 1] - GRAVITY * dt;
      const y = this.pPos[j + 1] + vy * dt;
      if (age >= life || (y < WATER_Y && vy < 0)) {
        this.pLife[i] = 0;
        this.pAlpha[i] = 0;
        this.pSize[i] = 0;
        continue;
      }
      alive++;
      this.pAge[i] = age;
      this.pVel[j + 1] = vy;
      this.pPos[j] += this.pVel[j] * dt;
      this.pPos[j + 1] = y;
      this.pPos[j + 2] += this.pVel[j + 2] * dt;
      const f = age / life;
      this.pAlpha[i] = this.pBase[i] * (1 - f * f);
    }
    this.active = alive;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /** @param {typeof RIPPLE.cast} def @param {number} delay s @param {number} vis 크기 배율 @param {number} [strength] */
  _ring(def, x, z, delay, vis, strength = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const rings = this.rings;
    let r = null;
    for (let i = 0; i < rings.length; i++) if (rings[i].life === 0) { r = rings[i]; break; }
    if (!r) {             // 가득 차면 가장 오래 산 고리
      let bestF = -1;
      for (let i = 0; i < rings.length; i++) {
        const c = rings[i];
        const f = c.delay > 0 ? 0 : c.age / c.life;
        if (f > bestF) { bestF = f; r = c; }
      }
    } else {
      this.ringsActive++;
    }
    r.x = x; r.z = z;
    r.r0 = def.r0 * vis; r.r1 = def.r1 * vis;
    r.age = 0; r.life = def.life; r.delay = Math.max(0, delay);
    r.alpha = Math.min(MAX_ALPHA, def.alpha * clamp(strength, 0, 1));
    r.mesh.visible = false;
    r.mat.opacity = 0;
  }

  _stepRings(dt, lum) {
    if (this.ringsActive === 0) return;
    let alive = 0;
    const rings = this.rings;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (r.life === 0) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        alive++;
        continue;
      }
      r.age += dt;
      if (r.age >= r.life) {
        r.life = 0;
        r.mesh.visible = false;
        r.mat.opacity = 0;
        continue;
      }
      alive++;
      const f = r.age / r.life;
      const e = 1 - (1 - f) * (1 - f);          // easeOut — 처음에 빨리 퍼진다
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.position.set(r.x, RING_Y, r.z);
      r.mesh.scale.set(rad, 1, rad);
      r.mat.opacity = r.alpha * (1 - f);
      r.mat.color.copy(this.ringColor).multiplyScalar(lum);
      r.mesh.visible = true;
    }
    this.ringsActive = alive;
  }

  /** 입자 · 고리를 전부 비운다(씬 전환 · 판 정리) */
  clear() {
    this.pLife.fill(0);
    this.pAlpha.fill(0);
    this.pSize.fill(0);
    this.active = 0;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    for (const r of this.rings) {
      r.life = 0;
      r.delay = 0;
      r.mesh.visible = false;
      r.mat.opacity = 0;
    }
    this.ringsActive = 0;
    this.streamAcc = 0;
    this.rainAcc = 0;
    this.airSplashed = false;
  }

  /** @returns {{particles:number, meshes:number}} particles = 살아 있는 입자 수 · meshes = 보이는 고리 수 + 입자 메시(1) */
  stats() {
    let rings = 0;
    for (let i = 0; i < this.rings.length; i++) if (this.rings[i].life !== 0) rings++;
    return { particles: this.active, meshes: rings + 1 };
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    this.root.removeFromParent();
    this.points.geometry.dispose();
    this.pointsMat.dispose();
    this.ringGeo.dispose();
    for (const r of this.rings) r.mat.dispose();
    this.rings = [];
    this.qLen = 0;
  }
}

/** 유한수가 아니면 기본값 */
function num(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
