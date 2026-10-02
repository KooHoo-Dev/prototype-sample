// OWNER: P7 — 계약 §9.7
// 투사체(state.projectiles — prevX/prevZ → x/z 보간)와 장판(state.hazards — kind 6종) 연출.
// reason 'clear'는 폭발 · 입자 없이 사라진다.
import * as THREE from 'three';
import { DT } from '../../core/constants.js';
import { PK, ringSize } from './particles.js';
import { COL, styleColors } from './fxColors.js';

/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').Hazard} Hazard */
/** @typedef {import('../../types.js').HitShape} HitShape */
/** @typedef {import('./particles.js').Particles} Particles */
/** @typedef {(x:number, y:number, z:number, color:THREE.Color, intensity:number, dur:number)=>void} FlashLight */

const rand = Math.random;
const rr = (a, b) => a + (b - a) * rand();

// ───────────────────────── 투사체 ─────────────────────────

const ORB_MAX = 16;
/** 구체 심지의 크기(판정 반경 대비) — 바깥 빛은 입자가 채운다 */
const ORB_CORE_FRAC = 0.62;
const ORB_HDR = 2.0;
/** 초당 꼬리 입자 수(구체 하나) */
const ORB_TRAIL_RATE = 42;

export class ProjectileFx {
  /**
   * @param {THREE.Object3D} parent fxRoot
   * @param {Particles} particles
   * @param {FlashLight} flashLight
   */
  constructor(parent, particles, flashLight) {
    this.parent = parent;
    this.particles = particles;
    this.flashLight = flashLight;
    this.geometry = new THREE.SphereGeometry(1, 14, 10);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, ORB_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, COL.white);   // instanceColor 버퍼를 미리 만든다
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._time = 0;
  }

  /**
   * @param {GameState} state
   * @param {number} alpha
   * @param {number} dt
   */
  update(state, alpha, dt) {
    this._time += dt;
    const list = state.projectiles;
    const n = Math.min(list.length, ORB_MAX);
    const P = this.particles;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const z = p.prevZ + (p.z - p.prevZ) * alpha;
      const sc = styleColors(p.style);
      const s = p.r * ORB_CORE_FRAC * (1 + 0.12 * Math.sin(this._time * 22 + p.id * 1.7));
      this._m.makeScale(s, s, s).setPosition(x, p.y, z);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c.copy(sc.core).multiplyScalar(ORB_HDR));
      // 꼬리: 바깥 빛 + 흩날리는 잔불
      const k = Math.floor(ORB_TRAIL_RATE * dt * P.countScale + rand());
      for (let j = 0; j < k; j++) {
        P.emitSized(PK.glow, x, p.y, z, p.r * 2.6, p.r * 1.1, 0.16, sc.glow, 0.4);
        P.emit(PK.streak, x + rr(-0.5, 0.5) * p.r, p.y + rr(-0.5, 0.5) * p.r, z + rr(-0.5, 0.5) * p.r,
          rr(-0.6, 0.6), rr(-0.3, 0.9), rr(-0.6, 0.6), sc.glow, 1.3, 1.6);
      }
    }
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** @param {{style:string, x:number, y:number, z:number}} p PROJECTILE_SPAWNED */
  onSpawned(p) {
    const sc = styleColors(p.style);
    const P = this.particles;
    P.emitSized(PK.flare, p.x, p.y, p.z, 0.5, 1.5, 0.2, sc.core);
    P.emitSized(PK.ring, p.x, p.y, p.z, ringSize(0.2), ringSize(0.9), 0.22, sc.glow);
    P.burst(PK.streak, 8, p.x, p.y, p.z, 0, 1, 0, 1, 2, 5, sc.glow);
  }

  /** @param {{style:string, x:number, y:number, z:number, reason:string}} p PROJECTILE_ENDED */
  onEnded(p) {
    if (p.reason === 'clear') return;
    const sc = styleColors(p.style);
    const P = this.particles;
    if (p.reason === 'parry') {
      // 쳐내는 섬광
      P.emitSized(PK.flare, p.x, p.y, p.z, 0.8, 2.4, 0.22, COL.white);
      P.emitSized(PK.ring, p.x, p.y, p.z, ringSize(0.3), ringSize(1.5), 0.26, sc.core);
      P.burst(PK.streak, 16, p.x, p.y, p.z, 0, 1, 0, 1, 6, 13, COL.white);
      P.burst(PK.spark, 10, p.x, p.y, p.z, 0, 1, 0, 0.9, 3, 8, sc.glow);
      this.flashLight(p.x, p.y, p.z, sc.core, 20, 0.18);
      return;
    }
    if (p.reason === 'expire') {
      P.emitSized(PK.glow, p.x, p.y, p.z, 0.9, 0.3, 0.2, sc.glow, 0.7);
      P.burst(PK.ember, 6, p.x, p.y, p.z, 0, 1, 0, 1, 0.5, 1.6, sc.glow);
      return;
    }
    // hit · guard · wall: 폭발
    const big = p.reason === 'hit';
    P.emitSized(PK.glow, p.x, p.y, p.z, 1.0, big ? 2.2 : 1.7, 0.2, sc.core, 0.6);
    P.emitSized(PK.ring, p.x, p.y, p.z, ringSize(0.25), ringSize(big ? 1.4 : 1.0), 0.25, sc.glow);
    P.burst(PK.spark, big ? 18 : 12, p.x, p.y, p.z, 0, 1, 0, 0.95, 3, 9, sc.glow);
    P.burst(PK.ember, 8, p.x, p.y, p.z, 0, 1, 0, 1, 0.6, 2.2, sc.core);
    if (p.reason === 'guard') P.burst(PK.spark, 8, p.x, p.y, p.z, 0, 1, 0, 0.9, 3, 7, COL.white);
    this.flashLight(p.x, p.y, p.z, sc.glow, big ? 18 : 12, 0.2);
  }

  clear() {
    this.mesh.count = 0;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ───────────────────────── 장판 ─────────────────────────

const SWORD_MAX = 16;
const SWORD_LEN = 2.6;
/** 검이 떨어지기 시작하는 높이(m) */
const SWORD_DROP = 15;
const SWORD_FADE = 0.35;
const SWORD_HDR = 2.4;
const SPIKE_MAX = 72;
const SPIKE_GROW = 0.09;
const SPIKE_SHRINK = 0.28;
/** 띠(충격파) 둘레 1m당 초당 입자 수와 그 상한 */
const WAVE_RATE_PER_M = 9;
const WAVE_RATE_MAX = 200;
/** 불길 줄 1m당 초당 입자 수 */
const TRAIL_RATE_PER_M = 9;    // 불길이 겹쳐 하얗게 뜨지 않을 만큼만(구역은 바닥 표식이 그린다)
const PILLAR_RATE = 130;

const FREE = 0;
const SW_FALL = 1;
const SW_STUCK = 2;
const SW_FADE = 3;
const SP_UP = 1;
const SP_DOWN = 2;

const easeOutBack = (t) => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** 셰이프 안의 무작위 점 하나를 out(길이 2 배열)에 쓴다. */
function randomPointIn(shape, out) {
  switch (shape.type) {
    case 'circle': {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * shape.r;
      out[0] = shape.x + Math.sin(a) * r;
      out[1] = shape.z + Math.cos(a) * r;
      return;
    }
    case 'ring': {
      const a = rand() * Math.PI * 2;
      const r = rr(shape.rInner, shape.rOuter);
      out[0] = shape.x + Math.sin(a) * r;
      out[1] = shape.z + Math.cos(a) * r;
      return;
    }
    case 'arc': {
      const a = shape.dir + rr(-1, 1) * Math.min(Math.PI, shape.halfAngle);
      const r = rr(shape.rInner, shape.r);
      out[0] = shape.x + Math.sin(a) * r;
      out[1] = shape.z + Math.cos(a) * r;
      return;
    }
    default: {
      const t = rand();
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * shape.r;
      out[0] = shape.ax + (shape.bx - shape.ax) * t + Math.sin(a) * r;
      out[1] = shape.az + (shape.bz - shape.az) * t + Math.cos(a) * r;
    }
  }
}

/** 셰이프의 대표 중심 · 크기. out = [x, z, 반경] */
function shapeCenter(shape, out) {
  if (shape.type === 'capsule') {
    out[0] = (shape.ax + shape.bx) / 2;
    out[1] = (shape.az + shape.bz) / 2;
    out[2] = Math.hypot(shape.bx - shape.ax, shape.bz - shape.az) / 2 + shape.r;
  } else {
    out[0] = shape.x;
    out[1] = shape.z;
    out[2] = shape.type === 'ring' ? shape.rOuter : shape.r;
  }
}

export class HazardFx {
  /**
   * @param {THREE.Object3D} parent fxRoot
   * @param {Particles} particles
   * @param {FlashLight} flashLight
   */
  constructor(parent, particles, flashLight) {
    this.parent = parent;
    this.particles = particles;
    this.flashLight = flashLight;
    this._dummy = new THREE.Object3D();
    this._c = new THREE.Color();
    this._pt = [0, 0];
    this._ctr = [0, 0, 0];

    // 떨어지는 검: 끝(원점)이 아래를 향한 납작한 사각뿔
    this.swordGeo = new THREE.ConeGeometry(0.17, SWORD_LEN, 4, 1);
    this.swordGeo.rotateX(Math.PI);
    this.swordGeo.translate(0, SWORD_LEN / 2, 0);
    this.swordGeo.scale(1, 1, 0.3);
    this.swordMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95 });
    this.swords = new THREE.InstancedMesh(this.swordGeo, this.swordMat, SWORD_MAX);
    this.swords.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.swords.setColorAt(0, COL.white);
    this.swords.frustumCulled = false;
    this.swords.visible = false;
    this._sw = {
      state: new Uint8Array(SWORD_MAX), id: new Int32Array(SWORD_MAX),
      x: new Float32Array(SWORD_MAX), z: new Float32Array(SWORD_MAX), y: new Float32Array(SWORD_MAX),
      yaw: new Float32Array(SWORD_MAX), lean: new Float32Array(SWORD_MAX), t: new Float32Array(SWORD_MAX),
    };

    // 얼음 가시: 밑면이 원점인 오각뿔
    this.spikeGeo = new THREE.ConeGeometry(0.5, 1, 5, 1);
    this.spikeGeo.translate(0, 0.5, 0);
    const frost = styleColors('frost');
    this.spikeMat = new THREE.MeshStandardMaterial({
      color: 0xbfe4ff, emissive: frost.glow, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1, flatShading: true,
    });
    this.spikes = new THREE.InstancedMesh(this.spikeGeo, this.spikeMat, SPIKE_MAX);
    this.spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spikes.frustumCulled = false;
    this.spikes.visible = false;
    this._sp = {
      state: new Uint8Array(SPIKE_MAX), id: new Int32Array(SPIKE_MAX),
      x: new Float32Array(SPIKE_MAX), z: new Float32Array(SPIKE_MAX), h: new Float32Array(SPIKE_MAX),
      w: new Float32Array(SPIKE_MAX), yaw: new Float32Array(SPIKE_MAX), lx: new Float32Array(SPIKE_MAX),
      lz: new Float32Array(SPIKE_MAX), t: new Float32Array(SPIKE_MAX),
    };
    this._spikeNext = 0;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SWORD_MAX; i++) this.swords.setMatrixAt(i, this._zero);
    for (let i = 0; i < SPIKE_MAX; i++) this.spikes.setMatrixAt(i, this._zero);
    parent.add(this.swords, this.spikes);
  }

  /** @param {{id:number, kind:string, style:string, x:number, z:number, warn:number, shape:HitShape}} p HAZARD_SPAWNED */
  onSpawned(p) {
    if (p.kind !== 'void_sword') return;
    const s = this._sw;
    let i = s.state.indexOf(FREE);
    if (i < 0) i = 0;
    shapeCenter(p.shape, this._ctr);
    s.state[i] = SW_FALL;
    s.id[i] = p.id;
    s.x[i] = this._ctr[0];
    s.z[i] = this._ctr[1];
    s.y[i] = SWORD_DROP;
    s.yaw[i] = rand() * Math.PI * 2;
    s.lean[i] = rr(-0.12, 0.12);
    s.t[i] = 0;
    this.swords.setColorAt(i, this._c.copy(styleColors(p.style).core).multiplyScalar(SWORD_HDR));
    this.swords.instanceColor.needsUpdate = true;
    this.swords.visible = true;
  }

  /** @param {{id:number, kind:string, style:string, shape:HitShape}} p HAZARD_ACTIVATED */
  onActivated(p) {
    const P = this.particles;
    const sc = styleColors(p.style);
    const shape = p.shape;
    const ctr = this._ctr;
    const pt = this._pt;
    shapeCenter(shape, ctr);
    switch (p.kind) {
      case 'shockwave':
        // 달리는 고리는 update가 매 프레임 따라 그린다 — 여기서는 출발의 번쩍임만
        P.emitSized(PK.groundGlow, ctr[0], 0.05, ctr[1], 2, ctr[2] * 2.0, 0.3, sc.glow, 0.5);
        break;
      case 'fire_trail':
        for (let i = P.count(26); i > 0; i--) {
          randomPointIn(shape, pt);
          P.emit(PK.flame, pt[0], 0.15, pt[1], rr(-0.5, 0.5), rr(2, 5), rr(-0.5, 0.5), sc.glow);
        }
        this.flashLight(ctr[0], 1, ctr[1], sc.glow, 16, 0.4);
        break;
      case 'fire_pillar':
        for (let i = P.count(34); i > 0; i--) {
          randomPointIn(shape, pt);
          P.emit(PK.flame, pt[0], rr(0.1, 0.8), pt[1], rr(-0.6, 0.6), rr(6, 13), rr(-0.6, 0.6), rand() < 0.3 ? sc.core : sc.glow, 1.3);
        }
        P.burst(PK.ember, 22, ctr[0], 0.5, ctr[1], 0, 1, 0, 0.5, 4, 11, sc.core);
        P.emitSized(PK.groundRing, ctr[0], 0.06, ctr[1], ringSize(ctr[2] * 0.4), ringSize(ctr[2] * 1.5), 0.4, sc.glow);
        P.emitSized(PK.glow, ctr[0], 1.2, ctr[1], ctr[2] * 1.4, ctr[2] * 2.4, 0.2, sc.core, 0.4);
        this.flashLight(ctr[0], 1.6, ctr[1], sc.glow, 32, 0.35);
        break;
      case 'ice_spike':
        this._raiseSpikes(p.id, shape);
        P.emitSized(PK.groundRing, ctr[0], 0.06, ctr[1], ringSize(ctr[2] * 0.3), ringSize(ctr[2] * 1.2), 0.35, sc.core);
        for (let i = P.count(18); i > 0; i--) {
          randomPointIn(shape, pt);
          P.emit(PK.crystal, pt[0], rr(0.2, 0.9), pt[1], rr(-3, 3), rr(3, 8), rr(-3, 3), sc.core);
        }
        for (let i = P.count(6); i > 0; i--) {
          randomPointIn(shape, pt);
          P.emit(PK.mist, pt[0], 0.4, pt[1], rr(-1, 1), rr(0.4, 1.4), rr(-1, 1), sc.core);
        }
        this.flashLight(ctr[0], 1, ctr[1], sc.glow, 24, 0.25);
        break;
      case 'void_burst':
        P.emitSized(PK.glow, ctr[0], 0.8, ctr[1], ctr[2] * 1.2, ctr[2] * 2.4, 0.26, sc.core, 0.5);
        P.emitSized(PK.ring, ctr[0], 0.9, ctr[1], ringSize(ctr[2] * 0.3), ringSize(ctr[2] * 1.3), 0.3, sc.glow);
        P.emitSized(PK.groundRing, ctr[0], 0.06, ctr[1], ringSize(ctr[2] * 0.3), ringSize(ctr[2] * 1.35), 0.4, sc.glow);
        for (let i = P.count(30); i > 0; i--) {
          randomPointIn(shape, pt);
          P.emit(PK.spark, pt[0], 0.2, pt[1], (pt[0] - ctr[0]) * 2.2, rr(4, 11), (pt[1] - ctr[1]) * 2.2, rand() < 0.3 ? sc.core : sc.glow, 1.2);
        }
        P.burst(PK.ember, 14, ctr[0], 0.6, ctr[1], 0, 1, 0, 0.7, 1.5, 5, sc.glow);
        this.flashLight(ctr[0], 1.4, ctr[1], sc.glow, 34, 0.35);
        break;
      case 'void_sword': {
        const i = this._swordOf(p.id);
        if (i >= 0) {
          this._sw.state[i] = SW_STUCK;
          this._sw.y[i] = 0;
          this._sw.t[i] = 0;
        }
        P.emitSized(PK.groundRing, ctr[0], 0.06, ctr[1], ringSize(0.2), ringSize(ctr[2] * 1.25), 0.3, sc.glow);
        P.emitSized(PK.glow, ctr[0], 0.5, ctr[1], 1.2, 2.6, 0.18, sc.core, 0.8);
        P.burst(PK.spark, 14, ctr[0], 0.15, ctr[1], 0, 1, 0, 0.75, 3, 9, sc.glow);
        break;
      }
      default:
        P.emitSized(PK.groundRing, ctr[0], 0.06, ctr[1], ringSize(ctr[2] * 0.3), ringSize(ctr[2] * 1.2), 0.35, sc.glow);
        P.burst(PK.spark, 12, ctr[0], 0.2, ctr[1], 0, 1, 0, 0.8, 3, 8, sc.glow);
    }
  }

  /** @param {{id:number, reason:string}} p HAZARD_ENDED */
  onEnded(p) {
    const clear = p.reason === 'clear';
    const sw = this._sw;
    for (let i = 0; i < SWORD_MAX; i++) {
      if (sw.state[i] === FREE || sw.id[i] !== p.id) continue;
      if (clear) this._freeSword(i);
      else if (sw.state[i] !== SW_FADE) { sw.state[i] = SW_FADE; sw.t[i] = 0; }
    }
    const sp = this._sp;
    const frost = styleColors('frost');
    for (let i = 0; i < SPIKE_MAX; i++) {
      if (sp.state[i] === FREE || sp.id[i] !== p.id) continue;
      if (clear) {
        sp.state[i] = FREE;
        this.spikes.setMatrixAt(i, this._zero);
        this.spikes.instanceMatrix.needsUpdate = true;
      } else if (sp.state[i] === SP_UP) {
        sp.state[i] = SP_DOWN;
        sp.t[i] = 0;
        // 부서지는 파편
        this.particles.burst(PK.crystal, 3, sp.x[i], sp.h[i] * 0.5, sp.z[i], 0, 1, 0, 0.9, 1.5, 4.5, frost.core);
      }
    }
  }

  /**
   * 살아 있는 장판의 지속 연출 + 검 낙하 + 가시 애니메이션.
   * @param {GameState} state
   * @param {number} alpha
   * @param {number} dt
   */
  update(state, alpha, dt) {
    const P = this.particles;
    const pt = this._pt;
    const hazards = state.hazards;
    for (let hi = 0; hi < hazards.length; hi++) {
      const h = hazards[hi];
      if (h.state !== 'active') continue;
      const sc = styleColors(h.style);
      const shape = h.shape;
      switch (h.kind) {
        case 'shockwave': {
          if (shape.type !== 'ring') break;
          const mid = (shape.rInner + shape.rOuter) / 2;
          const rate = Math.min(WAVE_RATE_MAX, mid * Math.PI * 2 * WAVE_RATE_PER_M);
          for (let i = Math.floor(rate * dt * P.countScale + rand()); i > 0; i--) {
            const a = rand() * Math.PI * 2;
            const r = rr(shape.rInner, shape.rOuter);
            const s = Math.sin(a);
            const c = Math.cos(a);
            const kind = h.style === 'frost' ? PK.mist : PK.flame;
            P.emit(kind, shape.x + s * r, rr(0.1, 0.5), shape.z + c * r, s * 2.5, rr(1.5, 4), c * 2.5, rand() < 0.25 ? sc.core : sc.glow, 0.9, 0.8);
            if (rand() < 0.3) P.emit(PK.spark, shape.x + s * r, 0.2, shape.z + c * r, s * rr(2, 6), rr(2, 6), c * rr(2, 6), sc.core);
          }
          break;
        }
        case 'fire_trail': {
          const len = shape.type === 'capsule' ? Math.hypot(shape.bx - shape.ax, shape.bz - shape.az) + shape.r : 4;
          for (let i = Math.floor(len * TRAIL_RATE_PER_M * dt * P.countScale + rand()); i > 0; i--) {
            randomPointIn(shape, pt);
            P.emit(PK.flame, pt[0], rr(0.05, 0.3), pt[1], rr(-0.4, 0.4), rr(1.5, 4.5), rr(-0.4, 0.4), rand() < 0.2 ? sc.core : sc.glow);
            if (rand() < 0.2) P.emit(PK.ember, pt[0], 0.4, pt[1], rr(-0.8, 0.8), rr(1.5, 4), rr(-0.8, 0.8), sc.core);
          }
          break;
        }
        case 'fire_pillar':
          for (let i = Math.floor(PILLAR_RATE * dt * P.countScale + rand()); i > 0; i--) {
            randomPointIn(shape, pt);
            P.emit(PK.flame, pt[0], rr(0.1, 1.5), pt[1], rr(-0.5, 0.5), rr(5, 12), rr(-0.5, 0.5), rand() < 0.3 ? sc.core : sc.glow, 1.2);
          }
          break;
        case 'void_burst':
          for (let i = Math.floor(60 * dt * P.countScale + rand()); i > 0; i--) {
            randomPointIn(shape, pt);
            P.emit(PK.ember, pt[0], rr(0.1, 1.2), pt[1], rr(-1, 1), rr(1, 5), rr(-1, 1), sc.glow);
          }
          break;
        default:
          break;
      }
    }
    this._updateSwords(state, alpha, dt);
    this._updateSpikes(state, dt);
  }

  /** @param {GameState} state @param {number} id @returns {Hazard|null} */
  _hazardOf(state, id) {
    const list = state.hazards;
    for (let k = 0; k < list.length; k++) if (list[k].id === id) return list[k];
    return null;
  }

  /** @param {number} id @returns {number} 칸(없으면 −1) */
  _swordOf(id) {
    const s = this._sw;
    for (let i = 0; i < SWORD_MAX; i++) if (s.state[i] !== FREE && s.id[i] === id) return i;
    return -1;
  }

  _freeSword(i) {
    this._sw.state[i] = FREE;
    this.swords.setMatrixAt(i, this._zero);
    this.swords.instanceMatrix.needsUpdate = true;
  }

  /**
   * 검의 높이는 장판의 sim 시각(hazard.t / warn)에서 계산한다 — 히트스톱에도 착지가 활성화 틱과 맞는다.
   * @param {GameState} state @param {number} alpha @param {number} dt
   */
  _updateSwords(state, alpha, dt) {
    const s = this._sw;
    const d = this._dummy;
    const P = this.particles;
    const void_ = styleColors('void');
    const sub = state.hitstop > 0 ? 0 : alpha * DT;
    let any = false;
    for (let i = 0; i < SWORD_MAX; i++) {
      const st = s.state[i];
      if (st === FREE) continue;
      any = true;
      let scale = 1;
      if (st === SW_FALL || st === SW_STUCK) {
        const h = this._hazardOf(state, s.id[i]);
        if (!h) { s.state[i] = SW_FADE; s.t[i] = 0; continue; }   // 끝 이벤트 없이 사라진 장판 — 검이 남지 않게 한다
        if (st === SW_STUCK) {
          s.y[i] = 0;
        } else if (h.state === 'active') {
          s.state[i] = SW_STUCK;
          s.y[i] = 0;
        } else {
          const u = h.warn > 0 ? Math.min(1, (h.t + sub) / h.warn) : 1;
          s.y[i] = SWORD_DROP * (1 - u * u);
          scale = Math.min(1, u * 6 + 0.2);
          if (rand() < 50 * dt * P.countScale) {
            P.emit(PK.streak, s.x[i], s.y[i] + SWORD_LEN * rand(), s.z[i], 0, rr(1, 3), 0, void_.glow, 1.4, 1.3);
          }
        }
      } else if (st === SW_FADE) {
        s.t[i] += dt;
        const u = s.t[i] / SWORD_FADE;
        if (u >= 1) { this._freeSword(i); continue; }
        scale = 1 - u;
        s.y[i] = -u * 0.6;
      }
      d.position.set(s.x[i], s.y[i], s.z[i]);
      d.rotation.set(s.lean[i], s.yaw[i], s.lean[i] * 0.6, 'XZY');
      d.scale.set(scale, 1, scale);
      d.updateMatrix();
      this.swords.setMatrixAt(i, d.matrix);
      this.swords.instanceMatrix.needsUpdate = true;
    }
    this.swords.visible = any;
  }

  /** @param {number} id @param {HitShape} shape */
  _raiseSpikes(id, shape) {
    const ctr = this._ctr;
    const pt = this._pt;
    shapeCenter(shape, ctr);
    if (shape.type === 'capsule') {
      const len = Math.hypot(shape.bx - shape.ax, shape.bz - shape.az);
      const n = Math.max(2, Math.min(16, Math.ceil(len / (shape.r * 0.85))));
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0.5 : k / (n - 1);
        const a = rand() * Math.PI * 2;
        const off = rr(0, 0.45) * shape.r;
        this._addSpike(id, shape.ax + (shape.bx - shape.ax) * t + Math.sin(a) * off, shape.az + (shape.bz - shape.az) * t + Math.cos(a) * off,
          shape.r * rr(1.1, 1.9), shape.r * rr(0.5, 0.75), rr(-0.25, 0.25), rr(-0.25, 0.25));
      }
      return;
    }
    const r = ctr[2];
    // 가운데 큰 가시 하나 + 둘레의 작은 가시(바깥으로 기운다)
    this._addSpike(id, ctr[0], ctr[1], r * rr(1.25, 1.55), r * 0.62, rr(-0.08, 0.08), rr(-0.08, 0.08));
    const around = 5;
    const a0 = rand() * Math.PI * 2;
    for (let k = 0; k < around; k++) {
      const a = a0 + (k / around) * Math.PI * 2 + rr(-0.3, 0.3);
      const d = r * rr(0.42, 0.72);
      const lean = rr(0.25, 0.5);
      pt[0] = ctr[0] + Math.sin(a) * d;
      pt[1] = ctr[1] + Math.cos(a) * d;
      // 바깥(sin a, cos a) 쪽으로 눕힌다: x축 회전은 +Z로, z축 회전은 −X로 기울인다
      this._addSpike(id, pt[0], pt[1], r * rr(0.6, 1.0), r * rr(0.34, 0.46), Math.cos(a) * lean, -Math.sin(a) * lean);
    }
  }

  _addSpike(id, x, z, h, w, lx, lz) {
    const s = this._sp;
    let i = s.state.indexOf(FREE);
    if (i < 0) { i = this._spikeNext; this._spikeNext = (i + 1) % SPIKE_MAX; }   // 가득 차면 돌려 쓴다
    s.state[i] = SP_UP;
    s.id[i] = id;
    s.x[i] = x; s.z[i] = z; s.h[i] = h; s.w[i] = w;
    s.yaw[i] = rand() * Math.PI * 2;
    s.lx[i] = lx; s.lz[i] = lz;
    s.t[i] = 0;
    this.spikes.visible = true;
  }

  /** @param {GameState} state @param {number} dt */
  _updateSpikes(state, dt) {
    const s = this._sp;
    const d = this._dummy;
    let any = false;
    for (let i = 0; i < SPIKE_MAX; i++) {
      const st = s.state[i];
      if (st === FREE) continue;
      s.t[i] += dt;
      let k;
      if (st === SP_UP) {
        k = s.t[i] < SPIKE_GROW ? easeOutBack(s.t[i] / SPIKE_GROW) : 1;
        // 끝 이벤트 없이 장판이 사라졌으면 가시도 거둔다
        if (!this._hazardOf(state, s.id[i])) { s.state[i] = SP_DOWN; s.t[i] = 0; }
      } else {
        k = 1 - s.t[i] / SPIKE_SHRINK;
        if (k <= 0) {
          s.state[i] = FREE;
          this.spikes.setMatrixAt(i, this._zero);
          this.spikes.instanceMatrix.needsUpdate = true;
          continue;
        }
      }
      any = true;
      d.position.set(s.x[i], 0, s.z[i]);
      d.rotation.set(s.lx[i], s.yaw[i], s.lz[i], 'XZY');
      d.scale.set(s.w[i], Math.max(0.001, s.h[i] * k), s.w[i]);
      d.updateMatrix();
      this.spikes.setMatrixAt(i, d.matrix);
      this.spikes.instanceMatrix.needsUpdate = true;
    }
    this.spikes.visible = any;
  }

  clear() {
    this._sw.state.fill(FREE);
    this._sp.state.fill(FREE);
    for (let i = 0; i < SWORD_MAX; i++) this.swords.setMatrixAt(i, this._zero);
    for (let i = 0; i < SPIKE_MAX; i++) this.spikes.setMatrixAt(i, this._zero);
    this.swords.instanceMatrix.needsUpdate = true;
    this.spikes.instanceMatrix.needsUpdate = true;
    this.swords.visible = false;
    this.spikes.visible = false;
  }

  dispose() {
    this.parent.remove(this.swords, this.spikes);
    this.swords.dispose();
    this.spikes.dispose();
    this.swordGeo.dispose();
    this.swordMat.dispose();
    this.spikeGeo.dispose();
    this.spikeMat.dispose();
  }
}
