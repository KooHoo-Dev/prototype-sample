// OWNER: P13 — 계약 §6.14 · §9.1 · §9.6 · §9.7 · §9.8 · §9.9 · §9.10
// 연출 레이어: 예고 표식 · 지속 효과 · 투사체 · 낙하체 · 타격 불꽃 · 속성 오라 12 · 상태 표시 · 스킬 연출 · 포털 소용돌이.
// 원칙(§9.1): 매 프레임 상태를 읽어 그린다 — 예고 채움 · 버프 고리 · 낙하 진행은 (tick + alpha − start)/(end − start)(틱 — 정지 화면에서도 같은 그림).
//   이벤트는 순간 연출(판정 순간 밝아짐 · 불꽃 · 먼지 · 고리 · 구)만 — 받은 틱을 적어 두고 다음 update 에서 그 나이로 그린다(놓쳐도 다음 프레임이 맞다).
//   실제 시간(dtReal)은 입자 · 흔들림 같은 장식에만(정지 화면(dtReal 0)이면 민 틱만큼).
// 화면을 덮는 연출 없음(QUALITY §4): 판정 순간 밝아짐은 그 모양 안에서만 · 불투명도 ≤ 0.6 · 0.1초. 구 · 기둥은 판정 모양 크기를 넘지 않는다 ·
//   점 스프라이트는 화면 높이의 12% 를 넘지 않는다.
// 판정과 보이는 것(§9.6 — 차이 0): 바닥 표식의 바깥 가장자리 = 효과 shape(원 r · 원뿔 r · angle · 선 len × width) · 스킬 순간 연출은 데이터(getSkillDef)의
//   radius · angleDeg · width 그대로 · 구 투사체의 반지름 = proj.r · 화살 0.8m.
// 풀 상한(§9.7): 데칼 200 · 입자 2,000(가산 1,100 + 먼지 300 + 스프라이트 600) · 투사체 256 — 넘는 것은 그리지 않는다(풀이 자라지 않는다).
// 내부 파일: view/fx/ — style(표) · decals(바닥 표식) · particles(입자 · 스프라이트) · batches(인스턴스 묶음) · actors(몬스터 · 플레이어 연출)

import { Group } from 'three';
import { CAM_AZIMUTH, DT } from '../core/constants.js';
import { EV } from '../core/events.js';
import { deg2rad } from '../core/math.js';
import { ticks } from '../core/time.js';
import { getMonDef, getSkillDef } from '../data/index.js';
import { QUALITY } from '../data/quality.js';
import {
  DoubleSide, InstBatch, arcGeometry, arrowGeometry, barrelGeometry, boxGeometry, glowMaterial, linkGeometry, pillarGeometry, rockGeometry,
  shardGeometry, shellMaterial, solidMaterial, sphereGeometry, spikeGeometry, starGeometry,
} from './fx/batches.js';
import { drawMonsterFx, drawPlayerFx } from './fx/actors.js';
import { DecalBatch, hash01, pointIn, shapeReach, writeBorder, writeEdge, writeFill, writePattern, writeSpiral } from './fx/decals.js';
import { ParticlePool, PointBuffer } from './fx/particles.js';
import {
  AFFIX_BURST, BURSTS, CAP, DEATH_STYLE, DECAL, FALL, HIT_FX, HIT_STYLE, HOSTILE, KIND_DEFAULT_FRIENDLY, KIND_DEFAULT_HOSTILE, KIND_STYLE,
  PLAYER_FX, POOL, PORTAL_FX, PROJ_DEFAULT, PROJ_STYLE, RIFT_FX, WHITE, col, light,
} from './fx/style.js';

const TAU = Math.PI * 2;
const MAX_DT = 0.25;
/** 점 스프라이트 크기 상한(화면 높이 비율) */
const MAX_POINT_FRAC = 0.12;
const JUMP_PROJ = 4;
const JUMP_PLAYER = 2.5;

/** kind → 그리는 법(표에 없으면 적대 · 비적대 기본) @param {string} kind @param {boolean} hostile */
export function styleOf(kind, hostile) {
  const s = Object.prototype.hasOwnProperty.call(KIND_STYLE, kind) ? KIND_STYLE[kind] : null;
  return s ?? (hostile ? KIND_DEFAULT_HOSTILE : KIND_DEFAULT_FRIENDLY);
}

/** 0..1 진행 */
function prog(start, end, now) {
  if (!(end > start)) return 1;
  const p = (now - start) / (end - start);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function easeOut(u) { return 1 - (1 - u) * (1 - u); }

/** 낙하 진행 u 의 자리(out = [x, y, z]) — 수평은 from → 중심 직선 · 높이는 y0 → 0 + 포물선 정점 apex */
function fallPos(F, f, s, apex, u, out) {
  out[0] = f.x + (s.x - f.x) * u;
  out[1] = F.y0 * (1 - u) + 4 * apex * u * (1 - u) + F.size * 0.6;
  out[2] = f.z + (s.z - f.z) * u;
  return out;
}

/** 순간 연출 기록(풀) */
function newRec() {
  return {
    alive: false, type: '', burst: '', spawned: false, atPlayer: false, tick: 0, durT: 1, growT: 0,
    x: 0, y: 0, z: 0, x2: 0, z2: 0, shape: { type: 'circle', x: 0, z: 0, r: 0, r0: 0, facing: 0, angle: 0, len: 0, width: 0 },
    hex: 0xffffff, hex2: 0xffffff, k: 1, h: 0, glow: true, id: 0, scale: 1,
  };
}

export class FxLayer {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings ?? {};
    this.group = new Group();
    this.group.name = 'fx';
    rc.layers.fx.add(this.group);

    // 바닥 표식(보통 · 가산) — 드로콜 2
    this.decals = new DecalBatch(CAP.decalVerts, false, -2);
    this.glow = new DecalBatch(CAP.glowVerts, true, -1);
    // 입자(시뮬) · 스프라이트(프레임마다)
    this.sparks = new ParticlePool(CAP.particlesAdd, true, 6, 'fxSparks');
    this.dust = new ParticlePool(CAP.particlesDust, false, 5, 'fxDust');
    this.glyphs = new PointBuffer(CAP.glyphs, true, 1.6, 7, 'fxGlyphs');
    // 인스턴스 묶음
    this.segs = new InstBatch('fxSegs', boxGeometry(), glowMaterial(), CAP.segs, 4);
    this.orbs = new InstBatch('fxOrbs', sphereGeometry(10, 8), glowMaterial(), CAP.proj, 4);
    this.shells = new InstBatch('fxShells', sphereGeometry(20, 14), shellMaterial(), CAP.shells, 3);
    this.pillars = new InstBatch('fxPillars', pillarGeometry(), shellMaterial(0.06, 1.6, { vertexColors: true, side: DoubleSide }), CAP.pillars, 3);
    this.arcs = new InstBatch('fxArcs', arcGeometry(), glowMaterial({ side: DoubleSide }), CAP.arcs, 4);
    this.links = new InstBatch('fxLinks', linkGeometry(), solidMaterial(), CAP.links, 0);
    this.stars = new InstBatch('fxStars', starGeometry(), glowMaterial({ side: DoubleSide }), CAP.stars, 4);
    this.shards = new InstBatch('fxShards', shardGeometry(), glowMaterial(), CAP.proj, 4);
    this.arrows = new InstBatch('fxArrows', arrowGeometry(), solidMaterial({ vertexColors: true }), CAP.proj, 0);
    this.solids = new InstBatch('fxSolids', rockGeometry(), solidMaterial(), CAP.solids, 0);
    this.spikes = new InstBatch('fxSpikes', spikeGeometry(), solidMaterial(), CAP.spikes, 0);
    this.barrels = new InstBatch('fxBarrels', barrelGeometry(), solidMaterial(), CAP.solids, 0);
    /** @type {InstBatch[]} */
    this.batches = [this.segs, this.orbs, this.shells, this.pillars, this.arcs, this.links, this.stars, this.shards, this.arrows, this.solids, this.spikes, this.barrels];
    this.group.add(this.decals.mesh, this.glow.mesh, this.sparks.buf.points, this.dust.buf.points, this.glyphs.points);
    for (const b of this.batches) this.group.add(b.mesh);

    /** 순간 연출 기록 */
    this.recs = Array.from({ length: CAP.transients }, newRec);
    /** HIT 고리 버퍼 */
    this.hitQ = Array.from({ length: CAP.hits }, () => ({ tick: 0, id: 0, x: 0, z: 0, type: '', crit: false, big: false, dot: false, immune: false, blocked: false }));
    this.hitHead = 0;
    this.hitN = 0;
    this.time = 0;
    this._lastSimT = -1;
    /** @type {import('../types.js').GameState|null} 마지막으로 그린 상태(이벤트에 틱을 적는다) */
    this._st = null;
    this.map = null;
    /** @type {{x:number, z:number, facing:number}|null} */
    this.townPortal = null;
    this.q = 1;
    this.pxScale = 800;
    this.pxMax = 96;
    this.decalCount = 0;
    this.px = 0; this.pz = 0;
    this.ctx = 0; this.ctz = 0;
    /** 판정 순간 연출을 이미 세운 플레이어 행동 번호(actId) */
    this.seenAct = -1;
    /** 돌진 먼지 자취(돌진이 끝나면 순간 연출로 넘긴다) */
    this._dash = { live: false, x0: 0, z0: 0, x1: 0, z1: 0, w: 0 };
    /** @type {Map<string, any>} */
    this._skill = new Map();
    /** @type {Map<string, any>} */
    this._mon = new Map();
    /** @type {WeakMap<object, {fPrev:number, fCur:number, fTick:number}>} 몬스터마다 그린 방향 보간 기록(fx/actors.js — 몸과 같은 trackFacing) */
    this.monFace = new WeakMap();
    this._pt = [0, 0];
    this._fallPt = [0, 0, 0];

    const on = (name, fn) => bus.on(name, fn);
    this._offs = [
      on(EV.MAP_LOADED, () => this.clear()),
      on(EV.RIFT_CLOSED, () => this.clear()),
      on(EV.SETTINGS_CHANGED, (e) => { if (e && e.settings) this.settings = e.settings; }),
      on(EV.EFFECT_HIT, (e) => this._onEffectHit(e)),
      on(EV.HIT, (e) => this._onHit(e)),
      on(EV.MON_DIED, (e) => this._onMonDied(e)),
      on(EV.ACTION_START, (e) => this._onActionStart(e)),
      on(EV.ACTION_HIT, (e) => this._onActionHit(e)),
      on(EV.PLAYER_HIT, (e) => { if (e && (e.amount > 0 || e.absorbed > 0)) this._burstRec(e.amount > 0 ? 'hurt' : 'frostPuff', e.x, 1.1, e.z, 0.6, false); }),
      on(EV.PLAYER_HEAL, (e) => { if (e && e.amount > 0) this._burstRec(e.source === 'potion' ? 'healRed' : 'healGreen', 0, 0.9, 0, 1, true); }),
      on(EV.SHIELD, (e) => { if (e && e.broken) this._burstRec('shieldBreak', 0, 1.0, 0, 1, true); }),
      on(EV.LEVEL_UP, () => this._onLevelUp()),
      on(EV.RECALL, (e) => { if (e && e.phase === 'cancel') this._burstRec('frostPuff', 0, 1.0, 0, 1, true); }),
      on(EV.AFFIX, (e) => this._onAffix(e)),
      on(EV.MON_SPAWNED, (e) => this._onMonSpawned(e)),
      on(EV.GUARDIAN_APPEAR, (e) => this._onGuardian(e)),
      on(EV.PORTAL_OPENED, (e) => { if (e) this._burstRec('portal', e.x, 1.4, e.z, 1, false); }),
      on(EV.PROJ_END, (e) => this._onProjEnd(e)),
    ];
  }

  // ───────────────────────── 공개 API(§6.14) ─────────────────────────

  /** 맵이 바뀌었다 — 마을 포털 자리 · 순간 연출 · 입자 정리 @param {import('../types.js').MapData|null} map */
  setMap(map) {
    this.map = map;
    this.townPortal = null;
    if (map && Array.isArray(map.objects)) {
      for (const o of map.objects) {
        if (o && o.kind === 'townPortal') { this.townPortal = { x: o.x, z: o.z, facing: o.facing ?? 0 }; break; }
      }
    }
    this.clear();
  }

  /** 순간 연출 · 입자 · 대기 중인 HIT 를 비운다(맵 전환 · 균열 닫힘) */
  clear() {
    for (const r of this.recs) r.alive = false;
    this.hitN = 0;
    this.sparks.clear();
    this.dust.clear();
    this._dash.live = false;
    this._lastSimT = -1;
  }

  /**
   * @param {import('../types.js').GameState} state @param {number} alpha 0..1 @param {number} dtReal 초 @param {{x:number, z:number}|null} cameraTarget
   */
  update(state, alpha, dtReal, cameraTarget) {
    if (!state) return;
    this._st = state;
    const a = Number.isFinite(alpha) ? clamp01(alpha) : 1;
    const tick = state.tick;
    const now = tick + a;
    const simDt = this._lastSimT >= 0 ? Math.min(MAX_DT, Math.max(0, (now - this._lastSimT) * DT)) : 0;
    this._lastSimT = now;
    const dt = dtReal > 0 ? Math.min(MAX_DT, dtReal) : simDt;
    this.time += dt;
    const Q = QUALITY[this.settings?.quality] ?? QUALITY.medium;
    this.q = Q.particles;
    const p = state.player;
    const jump = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z) > JUMP_PLAYER;
    this.px = jump ? p.pos.x : p.prevPos.x + (p.pos.x - p.prevPos.x) * a;
    this.pz = jump ? p.pos.z : p.prevPos.z + (p.pos.z - p.prevPos.z) * a;
    this.ctx = cameraTarget ? cameraTarget.x : this.px;
    this.ctz = cameraTarget ? cameraTarget.z : this.pz;

    this.decals.begin();
    this.glow.begin();
    this.glyphs.begin();
    for (let i = 0; i < this.batches.length; i++) this.batches[i].begin();
    this.decalCount = 0;

    const rift = state.scene === 'rift' ? state.rift : null;
    if (rift) {
      this._effects(rift, tick, now);
      this._projectiles(rift, tick, a);
      drawMonsterFx(this, rift, tick, now, a);
      this._riftPortals(rift, now);
    } else if (state.scene === 'town') {
      this._townPortal(state);
    }
    drawPlayerFx(this, state, tick, now);
    this._transients(state, now);
    this._hits(state, now);

    this._pointScale();
    const scale = this.pxScale, maxPx = this.pxMax;
    this.sparks.update(dt, scale, maxPx);
    this.dust.update(dt, scale, maxPx);
    this.glyphs.end(scale, maxPx);
    this.decals.end();
    this.glow.end();
    for (let i = 0; i < this.batches.length; i++) this.batches[i].end();
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    this.decals.geometry.dispose(); this.decals.material.dispose();
    this.glow.geometry.dispose(); this.glow.material.dispose();
    this.sparks.dispose();
    this.dust.dispose();
    this.glyphs.dispose();
    for (const b of this.batches) b.dispose();
    this.group.clear();
    this.rc.layers.fx.remove(this.group);
  }

  /** 진단(테스트 · __game) — 지금 그린 것의 수 */
  info() {
    let recs = 0;
    for (const r of this.recs) if (r.alive) recs++;
    return {
      decals: this.decalCount, decalVerts: this.decals.n, glowVerts: this.glow.n,
      particles: this.sparks.alive + this.dust.alive, glyphs: this.glyphs.n, transients: recs,
      projectiles: this.orbs.n + this.shards.n + this.arrows.n, instances: this.batches.reduce((s, b) => s + b.n, 0),
    };
  }

  // ───────────────────────── 도우미(fx/actors.js 도 쓴다) ─────────────────────────

  /** 카메라 대상에서 32m 밖인가(§9.1) */
  far(x, z, reach = 0) {
    const dx = x - this.ctx, dz = z - this.ctz;
    const R = CAP.cullR + reach;
    return dx * dx + dz * dz > R * R;
  }

  /** 스킬 수치(없으면 null · 캐시) @param {string|null} id */
  skillDef(id) {
    if (!id) return null;
    if (this._skill.has(id)) return this._skill.get(id);
    let d = null;
    try { d = getSkillDef(id); } catch { d = null; }
    this._skill.set(id, d);
    return d;
  }

  /** 몬스터 종류(공격 ID → 행 · 템플릿 — 캐시) @param {string} typeId */
  monInfo(typeId) {
    if (this._mon.has(typeId)) return this._mon.get(typeId);
    let info = null;
    try {
      const def = getMonDef(typeId);
      /** @type {Record<string, any>} */
      const atk = {};
      for (const a of def.attacks ?? []) atk[a.id] = a;
      info = { template: def.template, atk };
    } catch { info = null; }
    this._mon.set(typeId, info);
    return info;
  }

  /** 지금 상태의 틱(이벤트에 적는다) */
  _tick() { return this._st ? this._st.tick : 0; }

  /** 점 크기 환산 → pxScale(픽셀 / (m · 거리 1)) · pxMax(화면 높이의 MAX_POINT_FRAC) */
  _pointScale() {
    const el = this.rc.renderer && this.rc.renderer.domElement;
    const h = el && el.height > 0 ? el.height : 720;
    const fov = this.rc.camera && this.rc.camera.fov > 0 ? this.rc.camera.fov : 40;
    this.pxScale = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.pxMax = Math.max(8, h * MAX_POINT_FRAC);
  }

  /**
   * 입자 묶음 하나(BURSTS[name]) — scale = 개수 배율 · age0 = 이미 지난 나이(초) · radius = 퍼지는 원(ring · disk) · dir = 치우침(수평)
   */
  burst(name, x, y, z, scale = 1, age0 = 0, radius = 0, dirX = 0, dirZ = 0) {
    const B = Object.prototype.hasOwnProperty.call(BURSTS, name) ? BURSTS[name] : null;
    if (!B) return;
    if (age0 >= B.life * 1.3) return;
    const pool = B.pool === 'add' ? this.sparks : this.dust;
    const n = Math.max(1, Math.round(B.n * this.q * scale));
    const c0 = col(B.c0), c1 = col(B.c1);
    for (let i = 0; i < n; i++) {
      let ox = 0, oy = 0, oz = 0, vx = 0, vy = 0, vz = 0;
      const sp = B.speed * (0.55 + 0.45 * Math.random());
      switch (B.spread) {
        case 'ring': {
          const t = ((i + Math.random() * 0.6) / n) * TAU;
          const sx = Math.sin(t), sz = Math.cos(t);
          ox = sx * radius; oz = sz * radius;
          vx = sx * sp; vz = sz * sp; vy = B.up * (0.4 + 0.6 * Math.random());
          break;
        }
        case 'up': {
          const t = Math.random() * TAU;
          vx = Math.sin(t) * sp * 0.3; vz = Math.cos(t) * sp * 0.3; vy = B.up * (0.7 + 0.6 * Math.random());
          break;
        }
        case 'disk': {
          const t = Math.random() * TAU, rr = radius * Math.sqrt(Math.random());
          ox = Math.sin(t) * rr; oz = Math.cos(t) * rr;
          vx = Math.sin(t) * sp * 0.4; vz = Math.cos(t) * sp * 0.4; vy = B.up * (0.5 + 0.5 * Math.random());
          break;
        }
        default: {
          const t = Math.random() * TAU, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
          vx = Math.sin(t) * s * sp + dirX * sp * 0.8; vz = Math.cos(t) * s * sp + dirZ * sp * 0.8; vy = Math.abs(u) * sp * 0.6 + B.up * Math.random();
          break;
        }
      }
      const life = B.life * (0.7 + 0.6 * Math.random());
      pool.spawn(x + ox, y + oy, z + oz, vx, vy, vz, life, B.s0, B.s1, c0, c1, B.a, B.grav, B.drag, age0);
    }
  }

  // ───────────────────────── 상태의 효과(§9.7 · §9.8) ─────────────────────────

  /** @param {import('../types.js').RiftState} rift @param {number} tick @param {number} now */
  _effects(rift, tick, now) {
    const list = rift.effects;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.end <= tick) continue;
      if (this.decalCount >= CAP.decals) break;
      const s = e.shape;
      if (!s) continue;
      const st = styleOf(e.kind, e.hostile);
      if (s.type !== 'poly' && this.far(s.x, s.z, shapeReach(s))) continue;
      if (tick < e.hitAt) {
        const p = prog(e.start, e.hitAt, now);
        if (st.pattern === 'rift') this._riftTele(e, p);
        else if (st.tele) this._telegraph(e, st, p);
        if (st.fall && e.from) this._fall(e, st.fall, p);
        this.decalCount++;
        continue;
      }
      // 판정 순간 — EFFECT_HIT 을 놓쳤으면(고정 상태 · 레이어가 늦게 붙음) 상태로 같은 순간 연출을 세운다(효과 ID 로 한 번만)
      if (st.hit && (e.spec || e.tickSpec) && !this._hasRec(e.id) && (now - e.hitAt) < this._hitDurT(st)) this._hitRec(e.kind, e.hostile, s, e.id, e.hitAt);
      if (st.pool || (!st.hit && e.end - e.hitAt > 1)) {
        this._persist(e, st, now);
        this.decalCount++;
      }
    }
  }

  /**
   * 예고 — 바탕 · 채움(진행 = 틱) · 무늬 · 앞머리 · 테두리(적대 = 붉은 #ff3b30 · 최종 크기)
   * @param {import('../types.js').Effect} e @param {any} st @param {number} p
   */
  _telegraph(e, st, p) {
    const B = this.decals, s = e.shape;
    const k = e.hostile ? 1 : (st.faint ?? 1);
    const inner = col(st.inner);
    const bc = e.hostile ? HOSTILE : col(st.border ?? 0xffffff);
    B.mark('base', e.id);
    writeFill(B, s, 1, inner, DECAL.baseA * k);
    B.unmark();
    B.mark('fill', e.id);
    writeFill(B, s, p, inner, DECAL.fillA * k);
    B.unmark();
    if (st.pattern) {
      B.mark('pattern', e.id);
      writePattern(B, st.pattern, s, e.id, this.time, p, light(st.inner, 0.45), DECAL.patternA * k * (0.45 + 0.55 * p));
      B.unmark();
    }
    B.mark('edge', e.id);
    writeEdge(B, s, p, DECAL.edge, light(st.inner, 0.35), DECAL.edgeA * k);
    B.unmark();
    B.mark('border', e.id);
    writeBorder(B, s, DECAL.border, bc, DECAL.borderA * k * (0.85 + 0.15 * p));
    B.unmark();
  }

  /** 수호자 출현 예고 — 검은 균열이 자라고 보라 균열선 · 소용돌이 */
  _riftTele(e, p) {
    const s = e.shape, ep = easeOut(p);
    this.decals.mark('fill', e.id);
    writeFill(this.decals, s, ep, col(RIFT_FX.dark), 0.85);
    this.decals.unmark();
    const cc = col(RIFT_FX.crack);
    writePattern(this.glow, 'rift', s, e.id, this.time, ep, cc, 0.9);
    const R = (s.r ?? 0) * ep;
    this.glow.band(s.x, s.z, Math.max(0, R - 0.16), R, 0, TAU, cc, 0.55 + 0.3 * p);
    const n = Math.max(8, Math.round(RIFT_FX.swirlN * this.q));
    const sw = col(RIFT_FX.swirl), t = this.time;
    for (let i = 0; i < n; i++) {
      const u = (t * 0.5 + i / n) % 1;
      const ang = i * 2.39996 + t * 3 + u * 5;
      const rr = (s.r ?? 0) * (1.35 - 1.2 * u) * ep;
      this.glyphs.pushC(s.x + Math.sin(ang) * rr, 0.1 + u * 1.4, s.z + Math.cos(ang) * rr, 0.38 * (1 - u * 0.5), sw, 0.9 * (1 - u));
    }
  }

  /** 낙하체(몰타르 포탄 · 메테오 바위 · 잿불) — from → 표식 중심 · 진행 = 틱 · p = 1 에 땅에 닿는다 */
  _fall(e, kind, p) {
    const F = FALL[kind];
    if (!F) return;
    const s = e.shape, f = /** @type {{x:number, z:number}} */ (e.from);
    const apex = F.apex + F.apexPerM * Math.hypot(s.x - f.x, s.z - f.z);
    const t = this.time;
    const P = this._fallPt;
    fallPos(F, f, s, apex, p, P);
    this.solids.addEuler(P[0], P[1], P[2], t * 3.1, t * 2.3, 0, F.size, F.size, F.size, col(F.solid));
    const gc = col(F.glow);
    this.glyphs.pushC(P[0], P[1], P[2], F.glowSize, gc, 0.85);
    const n = Math.round(F.trail * Math.max(0.5, this.q));
    for (let j = 1; j <= n; j++) {
      const u = p - j * 0.035;
      if (u <= 0) break;
      fallPos(F, f, s, apex, u, P);
      this.glyphs.pushC(P[0], P[1], P[2], F.glowSize * (0.75 - 0.1 * j), gc, 0.5 * (1 - j / (n + 1)));
    }
  }

  /**
   * 지속 [hitAt, end) — 웅덩이(역병 · 독) · 불타는 바닥(메테오) · 소용돌이 · 번개 꺾은선 · 그 밖(채움 + 테두리)
   * @param {import('../types.js').Effect} e @param {any} st @param {number} now
   */
  _persist(e, st, now) {
    const s = e.shape, t = this.time;
    const f = Math.min(clamp01((now - e.hitAt) / Math.max(1, ticks(DECAL.poolFadeIn))), clamp01((e.end - now) / Math.max(1, ticks(DECAL.poolFadeOut))));
    if (!(f > 0)) return;
    const inner = col(st.inner);
    const bc = e.hostile ? HOSTILE : col(st.border ?? 0xffffff);
    const B = this.decals;
    switch (st.pool) {
      case 'arc': this._arc(e, f, now); return;
      case 'burning': {
        const P = POOL.burning;
        B.mark('fill', e.id);
        writeFill(B, s, 1, inner, 0.22 * f);
        B.unmark();
        const flick = 0.8 + 0.2 * Math.sin(t * 11 + e.id) * Math.sin(t * 7.3);
        if (s.type === 'circle') this.glow.fan(s.x, s.z, s.r, 0, TAU, col(P.glow), 0.1 * f * flick, 0.38 * f * flick);
        B.mark('border', e.id);
        writeBorder(B, s, DECAL.border, bc, 0.75 * f);
        B.unmark();
        const n = Math.round(P.flames * this.q);
        const fc = col(P.flame);
        for (let i = 0; i < n; i++) {
          const u = (t * 1.1 + i / n + hash01(e.id, i)) % 1;
          pointIn(s, 0.1 + 0.8 * hash01(e.id, i + 7), (hash01(e.id, i + 13) + t * 0.05) % 1, this._pt);
          this.glyphs.pushC(this._pt[0], 0.1 + u * 1.2, this._pt[1], 0.45 * (1 - u * 0.6), fc, 0.75 * (1 - u) * f);
        }
        return;
      }
      case 'vortex': {
        const P = POOL.vortex;
        const gc = col(P.glow);
        if (s.type === 'circle') writeSpiral(this.glow, s.x, s.z, s.r, P.arms, t * P.spin, gc, 0.55 * f);
        this.glow.mark('border', e.id);
        writeBorder(this.glow, s, DECAL.border, bc, 0.6 * f);
        this.glow.unmark();
        const n = Math.round(8 * this.q);
        for (let i = 0; i < n; i++) {
          const ang = t * P.spin + (i / n) * TAU;
          const rr = (s.r ?? 0) * (0.3 + 0.6 * ((i * 0.37) % 1));
          this.glyphs.pushC(s.x + Math.sin(ang) * rr, 0.3 + 0.8 * ((i * 0.61 + t) % 1), s.z + Math.cos(ang) * rr, 0.25, gc, 0.8 * f);
        }
        return;
      }
      default: {
        // 웅덩이(역병 · 독) — 채움 + 기포 + 테두리(적대 = 붉은 테두리 그대로)
        B.mark('fill', e.id);
        writeFill(B, s, 1, inner, DECAL.poolA * f);
        B.unmark();
        if (st.pattern) {
          B.mark('pattern', e.id);
          writePattern(B, st.pattern, s, e.id, t, 1, light(st.inner, 0.4), 0.7 * f);
          B.unmark();
        }
        B.mark('border', e.id);
        writeBorder(B, s, DECAL.border, bc, 0.8 * f);
        B.unmark();
        if (st.pool) {
          const n = Math.round(3 * this.q);
          const bcol = light(st.inner, 0.3);
          for (let i = 0; i < n; i++) {
            const u = (t * 0.6 + i / Math.max(1, n) + hash01(e.id, i)) % 1;
            pointIn(s, 0.1 + 0.7 * hash01(e.id, i + 3), hash01(e.id, i + 5), this._pt);
            this.glyphs.pushC(this._pt[0], 0.05 + u * 0.7, this._pt[1], 0.16, bcol, 0.6 * (1 - u) * f);
          }
        }
      }
    }
  }

  /** 연쇄 번개 꺾은선(0.2초) — 마디마다 들쭉날쭉 · 흰 심 + 보라 빛 */
  _arc(e, f, now) {
    const s = e.shape, pts = s.pts;
    if (!pts || pts.length < 2) return;
    const P = POOL.arc;
    const u = prog(e.hitAt, e.end, now);
    const k = f * (1 - 0.6 * u);
    const seed = Math.floor(this.time * 30);
    const core = col(P.core), glow = col(P.glow);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const L = Math.hypot(dx, dz);
      if (!(L > 0.01)) continue;
      const nx = -dz / L, nz = dx / L;
      const parts = Math.max(3, Math.min(8, Math.round(L / 0.8)));
      let x0 = a.x, y0 = P.y, z0 = a.z;
      for (let j = 1; j <= parts; j++) {
        const v = j / parts;
        const jit = j < parts ? (hash01(seed + i * 17, j) - 0.5) * P.jitter * 2 : 0;
        const x1 = a.x + dx * v + nx * jit, z1 = a.z + dz * v + nz * jit;
        const y1 = P.y + (j < parts ? (hash01(seed + i * 31, j + 9) - 0.5) * 0.4 : 0);
        this.segs.addSeg(x0, y0, z0, x1, y1, z1, P.glowWidth, glow, 0.7 * k);
        this.segs.addSeg(x0, y0, z0, x1, y1, z1, P.width, core, 1.2 * k);
        x0 = x1; y0 = y1; z0 = z1;
      }
      this.glyphs.pushC(b.x, P.y, b.z, 0.7, glow, 0.8 * k);
    }
    this.glyphs.pushC(pts[0].x, P.y, pts[0].z, 0.5, glow, 0.7 * k);
  }

  // ───────────────────────── 투사체(§9.7 — 인스턴싱 + 풀 256) ─────────────────────────

  /** @param {import('../types.js').RiftState} rift @param {number} tick @param {number} a */
  _projectiles(rift, tick, a) {
    const list = rift.projs;
    let drawn = 0;
    const t = this.time;
    for (let i = 0; i < list.length && drawn < CAP.proj; i++) {
      const pr = list[i];
      if (!pr || pr.until <= tick) continue;
      const jump = Math.hypot(pr.pos.x - pr.prevPos.x, pr.pos.z - pr.prevPos.z) > JUMP_PROJ;
      const x = jump ? pr.pos.x : pr.prevPos.x + (pr.pos.x - pr.prevPos.x) * a;
      const z = jump ? pr.pos.z : pr.prevPos.z + (pr.pos.z - pr.prevPos.z) * a;
      if (this.far(x, z)) continue;
      drawn++;
      const S = Object.prototype.hasOwnProperty.call(PROJ_STYLE, pr.visual) ? PROJ_STYLE[pr.visual] : PROJ_DEFAULT;
      const vx = pr.vel?.x ?? 0, vz = pr.vel?.z ?? 0;
      const sp = Math.hypot(vx, vz);
      const dx = sp > 1e-6 ? vx / sp : 0, dz = sp > 1e-6 ? vz / sp : 1;
      const yaw = Math.atan2(dx, dz);
      const y = S.y, r = pr.r > 0 ? pr.r : 0.2;
      const core = col(S.core ?? 0xffffff), glow = col(S.glow);
      switch (S.form) {
        case 'streak': {
          const L = S.len ?? 0.8;
          this.segs.mark('proj');
          this.segs.addSeg(x - dx * L, y, z - dz * L, x, y, z, r * 0.7, glow, 0.9);
          this.segs.addSeg(x - dx * L * 0.7, y, z - dz * L * 0.7, x, y, z, r * 0.25, core, 1.3);
          this.orbs.mark('proj');
          this.orbs.addTRS(x, y, z, 0, r * 0.55, r * 0.55, r * 0.55, core, 1.2);
          break;
        }
        case 'shard':
          this.shards.mark('proj');
          this.shards.addTRS(x, y, z, yaw, r * 1.2, r * 1.2, S.len ?? 0.6, core, 1.1);
          break;
        case 'arrow':
          this.arrows.mark('proj');
          this.arrows.addTRS(x, y, z, yaw, 1, 1, 1, WHITE);
          this.segs.addSeg(x - dx * 0.4, y, z - dz * 0.4, x + dx * 0.4, y, z + dz * 0.4, 0.06, glow, 0.35);
          break;
        default:
          this.orbs.mark('proj');
          this.orbs.addTRS(x, y, z, t * 5, r, r, r, core, S.coreK ?? 1.0);
          if (S.arcs) {
            const seed = Math.floor(t * 24) + pr.id * 7;
            for (let k = 0; k < 2; k++) {
              const ang = hash01(seed, k) * TAU, el = (hash01(seed, k + 5) - 0.5) * 1.6;
              const L = r * (1.2 + hash01(seed, k + 9));
              this.segs.addSeg(x, y, z, x + Math.sin(ang) * L, y + el * r, z + Math.cos(ang) * L, 0.025, core, 1.2);
            }
          }
      }
      this.glyphs.pushC(x, y, z, S.halo, glow, 0.75);
      const n = S.trail ? Math.max(1, Math.round(S.trail * this.q)) : 0;
      if (n) {
        const tc = col(S.trailColor ?? S.glow);
        for (let j = 1; j <= n; j++) {
          const back = j * Math.max(0.12, r * 0.7);
          this.glyphs.pushC(x - dx * back, y, z - dz * back, S.halo * (0.7 - 0.1 * j), tc, 0.55 * (1 - j / (n + 1)));
        }
      }
    }
  }

  // ───────────────────────── 포털 소용돌이 ─────────────────────────

  _riftPortals(rift, now) {
    const list = rift.portals;
    if (!list || !list.length) return;
    const rx = Math.cos(CAM_AZIMUTH), rz = -Math.sin(CAM_AZIMUTH);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || this.far(p.pos.x, p.pos.z)) continue;
      const grow = clamp01(((now - p.born) * DT) / 0.4);
      const R = (p.r || 1) * (0.2 + 0.8 * grow);
      this._swirl(p.pos.x, 1.45, p.pos.z, rx, rz, R * 0.8, R * 1.2, col(p.kind === 'exit' ? PORTAL_FX.exit : PORTAL_FX.recall), i);
    }
  }

  _townPortal(state) {
    const tp = this.townPortal;
    if (!tp || !state.town || !state.town.portalOpen) return;
    this._swirl(tp.x, 2.15, tp.z, Math.cos(tp.facing), -Math.sin(tp.facing), 1.0, 1.6, col(PORTAL_FX.town), 0);
  }

  /** 포털 평면(오른쪽 (rx, 0, rz) · 위 +Y)의 안으로 도는 나선 */
  _swirl(cx, cy, cz, rx, rz, ax, ay, c, phase) {
    const n = Math.max(10, Math.round(PORTAL_FX.n * this.q));
    const t = this.time + phase * 1.7;
    for (let i = 0; i < n; i++) {
      const u = (t * 0.4 + i / n) % 1;
      const ang = i * 2.39996 + t * PORTAL_FX.spin + u * 3;
      const rr = 1 - u;
      const lx = Math.sin(ang) * rr * ax, ly = Math.cos(ang) * rr * ay;
      const fade = (u < 0.1 ? u / 0.1 : 1) * (1 - u * 0.5);
      this.glyphs.pushC(cx + rx * lx, cy + ly, cz + rz * lx, 0.2 + 0.14 * rr, c, 0.85 * fade);
    }
    this.glyphs.pushC(cx, cy, cz, Math.min(ax, ay) * 1.2, c, 0.22);
  }

  // ───────────────────────── 순간 연출(이벤트) ─────────────────────────

  /** 빈 기록 하나(없으면 null — 상한) · tick = 그 순간의 틱(기본 지금) */
  _rec(type, burst, tick = this._tick()) {
    for (const r of this.recs) {
      if (r.alive) continue;
      r.alive = true; r.type = type; r.burst = burst ?? ''; r.spawned = false; r.atPlayer = false;
      r.tick = tick; r.durT = 1; r.growT = 0; r.k = 1; r.h = 0; r.glow = true; r.id = 0; r.scale = 1;
      r.x = 0; r.y = 0; r.z = 0; r.x2 = 0; r.z2 = 0;
      return r;
    }
    return null;
  }

  /** 모양을 기록에 복사 */
  _copyShape(r, s) {
    const d = r.shape;
    d.type = s.type; d.x = s.x; d.z = s.z; d.r = s.r ?? 0; d.r0 = s.r0 ?? 0; d.facing = s.facing ?? 0; d.angle = s.angle ?? 0; d.len = s.len ?? 0; d.width = s.width ?? 0;
    r.x = s.x; r.z = s.z;
  }

  /** 입자만(기록 하나 — 다음 update 에서 그 나이로) */
  _burstRec(name, x, y, z, scale, atPlayer, tick = this._tick()) {
    const r = this._rec('none', name, tick);
    if (!r) return;
    r.x = x; r.y = y; r.z = z; r.scale = scale; r.atPlayer = atPlayer;
  }

  _onEffectHit(e) {
    if (!e || !e.shape || e.shape.type === 'poly') return;
    this._hitRec(e.kind, !!e.hostile, e.shape, e.id ?? 0, this._tick());
  }

  /** kind 의 판정 순간 연출 길이(틱) */
  _hitDurT(st) {
    switch (st.hit) {
      case 'flash': return Math.max(2, ticks(DECAL.flashSec));
      case 'ring': return Math.max(1, ticks(st.grow ?? 0.25)) + Math.max(1, ticks(st.fade ?? 0.3));
      case 'sphere': return Math.max(1, ticks(st.grow ?? 0.1)) + Math.max(1, ticks(st.fade ?? 0.15));
      default: return Math.max(2, ticks(st.fade ?? 0.3));
    }
  }

  /** 그 효과 ID 의 순간 연출이 살아 있다 */
  _hasRec(id) {
    for (const r of this.recs) if (r.alive && r.id === id && r.type !== 'none') return true;
    return false;
  }

  /**
   * 효과의 판정 순간(EFFECT_HIT · 또는 상태에서 본 판정) — 밝아짐 · 고리 · 부채 · 선 · 구 + 입자
   * @param {string} kind @param {boolean} hostile @param {import('../types.js').Shape} s @param {number} id @param {number} tick 판정 틱
   */
  _hitRec(kind, hostile, s, id, tick) {
    const st = styleOf(kind, hostile);
    const type = st.hit ?? 'none';
    const r = this._rec(type, st.burst, tick);
    if (!r) return;
    this._copyShape(r, s);
    r.hex = st.inner;
    r.hex2 = hostile ? 0xff3b30 : (st.border ?? 0xffffff);
    r.id = id;
    r.durT = this._hitDurT(st);
    if (type === 'ring') { r.growT = Math.max(1, ticks(st.grow ?? 0.25)); r.k = 0.75; }
    else if (type === 'sphere') r.growT = Math.max(1, ticks(st.grow ?? 0.1));
    if (st.burst === 'spikes' && s.type === 'line') {
      const sp = this._rec('spikes', '', tick);
      if (sp) { this._copyShape(sp, s); sp.durT = ticks(0.6); sp.id = id; }
    }
  }

  _onHit(e) {
    if (!e) return;
    const i = (this.hitHead + this.hitN) % CAP.hits;
    if (this.hitN < CAP.hits) this.hitN++;
    else this.hitHead = (this.hitHead + 1) % CAP.hits;
    const h = this.hitQ[i];
    h.tick = this._tick(); h.id = e.targetId ?? -1; h.x = e.x; h.z = e.z; h.type = e.type; h.crit = !!e.crit; h.big = !!e.big;
    h.dot = !!e.dot; h.immune = !!e.immune; h.blocked = !!e.blocked;
  }

  _onMonDied(e) {
    if (!e) return;
    const info = this.monInfo(e.typeId);
    const r = this._rec('death', '');
    if (!r) return;
    r.x = e.x; r.z = e.z; r.y = 0.6;
    r.burst = info && Object.prototype.hasOwnProperty.call(DEATH_STYLE, info.template) ? info.template : 'humanoid';
    r.x2 = e.launch ? e.launch.x : 0; r.z2 = e.launch ? e.launch.z : 0;
    r.scale = e.elite ? 1.6 : 1;
  }

  _onActionStart(e) {
    if (!e) return;
    const def = this.skillDef(e.skillId);
    if (def && def.behavior === 'blink') this._pillarRec(e.x, e.z, 0.7, 2.4, PLAYER_FX.blink, 0.35, 0.9);
  }

  _onActionHit(e) {
    if (!e) return;
    const st = this._st;
    // 지금 행동의 판정이면 그 행동 번호를 적는다(상태로 다시 세우지 않게 — drawPlayerFx 의 대체 경로)
    if (st && st.player && st.player.actSkill === e.skillId) this.seenAct = st.player.actId;
    this._skillHit(e.skillId, e.x, e.z, e.facing ?? 0, e.tx ?? e.x, e.tz ?? e.z, this._tick());
  }

  /**
   * 스킬 판정 순간(동작 behavior 로 — 치수는 데이터 그대로: 원뿔 radius · angleDeg · 원 radius)
   * @param {string} skillId @param {number} tick 판정 틱
   */
  _skillHit(skillId, x, z, facing, tx, tz, tick) {
    const def = this.skillDef(skillId);
    if (!def) return;
    switch (def.behavior) {
      case 'cone': {
        const r = this._rec('fan', 'dust', tick);
        if (!r) return;
        r.shape.type = 'cone'; r.shape.x = x; r.shape.z = z; r.shape.r = def.radius ?? 0; r.shape.facing = facing;
        r.shape.angle = deg2rad(def.angleDeg ?? 0); r.x = x; r.z = z;
        r.hex = PLAYER_FX.stomp; r.hex2 = 0xfff2d6; r.durT = ticks(0.3);
        break;
      }
      case 'leap': this._ringRec(x, z, def.radius ?? 0, PLAYER_FX.dust, 0.2, 0.35, false, 'dustRing', tick); break;
      case 'nova': this._ringRec(x, z, def.radius ?? 0, PLAYER_FX.frost, 0.18, 0.3, true, 'frost', tick); break;
      case 'buff':
        this._ringRec(x, z, 3.0, PLAYER_FX.gold, 0.25, 0.35, true, 'gold', tick);
        this._pillarRec(x, z, 0.9, 2.2, PLAYER_FX.gold, 0.45, 0.7, false, tick);
        break;
      case 'shield': this._burstRec('frostPuff', x, 1.0, z, 1.2, false, tick); break;
      case 'blink': this._pillarRec(tx, tz, 0.7, 2.4, PLAYER_FX.blink, 0.35, 0.9, false, tick); break;
      case 'quake': this._burstRec('dust', x, 0.2, z, 1, false, tick); break;
      default:
        if (def.type && def.type !== 'phys') this._burstRec('cast', x + Math.sin(facing) * 0.5, 1.2, z + Math.cos(facing) * 0.5, 1, false, tick);
    }
  }

  /** 퍼지는 고리(반지름 r 까지 · glow = 가산) */
  _ringRec(x, z, r, hex, growSec, fadeSec, glow, burst, tick = this._tick()) {
    const rec = this._rec('ring', burst, tick);
    if (!rec) return;
    rec.shape.type = 'circle'; rec.shape.x = x; rec.shape.z = z; rec.shape.r = r; rec.x = x; rec.z = z;
    rec.hex = hex; rec.hex2 = hex; rec.glow = glow; rec.k = glow ? 0.8 : 0.6;
    rec.growT = Math.max(1, ticks(growSec)); rec.durT = rec.growT + Math.max(1, ticks(fadeSec));
  }

  /** 빛기둥(반지름 r · 높이 h · sec 초) */
  _pillarRec(x, z, r, h, hex, sec, k, atPlayer = false, tick = this._tick()) {
    const rec = this._rec('pillar', '', tick);
    if (!rec) return;
    rec.x = x; rec.z = z; rec.shape.r = r; rec.h = h; rec.hex = hex; rec.durT = Math.max(2, ticks(sec)); rec.k = k; rec.atPlayer = atPlayer;
  }

  _onLevelUp() {
    // 화면 패스: r 0.9 · 세기 0.8 의 가산 기둥이 플레이어 몸을 노랗게 덮었다(QUALITY §4 — 플레이어를 가리는 연출 금지) — 넓고 옅게
    this._pillarRec(0, 0, 1.25, 4.0, PLAYER_FX.gold, 1.4, 0.32, true);
    this._burstRec('gold', 0, 1.0, 0, 2, true);
  }

  _onAffix(e) {
    if (!e) return;
    const name = Object.prototype.hasOwnProperty.call(AFFIX_BURST, e.what) ? AFFIX_BURST[e.what] : null;
    if (name) this._burstRec(name, e.x, e.what === 'mortarFire' ? 1.9 : 1.0, e.z, 1, false);
    if (e.what === 'teleportIn' || e.what === 'teleportOut') this._pillarRec(e.x, e.z, 0.6, 2.2, 0xa35bff, 0.3, 0.7);
    else if (e.what === 'shieldOn') this._ringRec(e.x, e.z, 1.2, 0xffd23d, 0.12, 0.25, true, '');
  }

  _onMonSpawned(e) {
    if (!e) return;
    switch (e.reason) {
      case 'split': this._burstRec('pink', e.x, 0.6, e.z, 0.6, false); break;
      case 'revive':
        this._burstRec('revive', e.x, 0.3, e.z, 1, false);
        this._pillarRec(e.x, e.z, 0.5, 2.0, 0x7cff6a, 0.5, 0.6);
        break;
      case 'summon': this._burstRec('ash', e.x, 0.5, e.z, 0.7, false); break;
      case 'nest': this._burstRec('bones', e.x, 0.3, e.z, 0.6, false); break;
      default: break;
    }
  }

  _onGuardian(e) {
    if (!e || !this._st || this._st.scene !== 'rift') return;
    this._burstRec('guardian', e.x, 0.3, e.z, 1, false);
    this._pillarRec(e.x, e.z, 1.6, 4.0, 0xa35bff, 0.7, 0.8);
  }

  _onProjEnd(e) {
    if (!e || e.reason === 'cancel') return;
    const S = Object.prototype.hasOwnProperty.call(PROJ_STYLE, e.visual) ? PROJ_STYLE[e.visual] : PROJ_DEFAULT;
    if (S.end) this._burstRec(S.end, e.x, S.y, e.z, 0.35, false);
  }

  /** 순간 연출 그리기 · 첫 프레임에 입자 */
  _transients(state, now) {
    const t = this.time;
    for (const r of this.recs) {
      if (!r.alive) continue;
      const age = now - r.tick;
      if (r.atPlayer && !r.spawned) { r.x += this.px; r.z += this.pz; }
      if (!r.spawned) {
        r.spawned = true;
        this._spawnBurst(r, Math.max(0, age * DT));
      }
      if (r.type === 'none' || r.type === 'death' || age >= r.durT || age < -1) { r.alive = false; continue; }
      const u = clamp01(age / r.durT);
      const s = r.shape;
      switch (r.type) {
        case 'flash': {
          if (this.decalCount >= CAP.decals) break;
          this.decalCount++;
          // 그 모양 안에서만 · 불투명도 ≤ 0.6 · 0.1초(§9.7)
          this.decals.mark('flash', r.id);
          writeFill(this.decals, s, 1, light(r.hex, DECAL.flashWhite), DECAL.flashA * (1 - u));
          this.decals.unmark();
          break;
        }
        case 'ring': {
          if (this.decalCount >= CAP.decals) break;
          this.decalCount++;
          const g = clamp01(age / r.growT);
          const R = s.r * easeOut(g);
          const fade = age < r.growT ? 1 : 1 - (age - r.growT) / Math.max(1, r.durT - r.growT);
          const B = r.glow ? this.glow : this.decals;
          B.mark('ring', r.id);
          B.band(s.x, s.z, Math.max(0, R - 0.35), R, 0, TAU, col(r.hex), r.k * fade, 0.05 * fade);
          B.unmark();
          break;
        }
        case 'fan':
        case 'line': {
          if (this.decalCount >= CAP.decals) break;
          this.decalCount++;
          const fade = 1 - u;
          this.glow.mark(r.type, r.id);
          writeFill(this.glow, s, 1, col(r.hex), 0.4 * fade);
          writeBorder(this.glow, s, DECAL.border, col(r.hex2), 0.7 * fade);
          this.glow.unmark();
          if (r.type === 'fan') writePattern(this.decals, 'cracks', s, r.id || 1, t, 1, col(0x2a221a), 0.6 * fade);
          break;
        }
        case 'trail': {
          if (this.decalCount >= CAP.decals) break;
          this.decalCount++;
          this.decals.mark('trail', r.id);
          this.decals.rect(r.x, r.z, s.facing, 0, s.len, -s.width / 2, s.width / 2, col(PLAYER_FX.dust), 0.35 * (1 - u));
          this.decals.unmark();
          break;
        }
        case 'sphere': {
          const g = clamp01(age / r.growT);
          const R = s.r * easeOut(g);
          const fade = age < r.growT ? 1 : 1 - (age - r.growT) / Math.max(1, r.durT - r.growT);
          this.shells.mark('sphere');
          this.shells.addTRS(s.x, 0, s.z, 0, R, R, R, col(r.hex), 0.95 * fade);
          if (s.type === 'circle' && this.decalCount < CAP.decals) {
            this.decalCount++;
            this.glow.fan(s.x, s.z, R, 0, TAU, col(r.hex), 0.04 * fade, 0.2 * fade);
          }
          break;
        }
        case 'pillar': {
          const g = clamp01(age / Math.max(1, r.durT * 0.25));
          this.pillars.mark('pillar');
          // 플레이어에 붙은 기둥(레벨업)은 플레이어를 따라간다
          const x = r.atPlayer ? this.px : r.x, z = r.atPlayer ? this.pz : r.z;
          this.pillars.addTRS(x, 0.02, z, t * 2, s.r * (0.6 + 0.4 * g), r.h * easeOut(g), s.r * (0.6 + 0.4 * g), col(r.hex), r.k * (1 - u * u));
          break;
        }
        case 'spikes': {
          const n = Math.max(3, Math.round(s.len / 1.2));
          const H = u < 0.12 ? u / 0.12 : u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
          const fx = Math.sin(s.facing), fz = Math.cos(s.facing), rx = -Math.cos(s.facing), rz = Math.sin(s.facing);
          const bone = col(0xe8dcc0);
          for (let j = 0; j < n; j++) {
            const d = ((j + 0.5) * s.len) / n, o = ((j & 1) ? 0.22 : -0.22) * s.width;
            this.spikes.addTRS(s.x + fx * d + rx * o, 0, s.z + fz * d + rz * o, j * 1.3, 0.2, 1.3 * H * (0.8 + 0.4 * hash01(r.id, j)), 0.2, bone);
          }
          break;
        }
        default: break;
      }
    }
  }

  /** 기록의 입자(첫 프레임) — age0 = 그 이벤트 뒤 지난 초 */
  _spawnBurst(r, age0) {
    if (r.type === 'death') {
      const D = DEATH_STYLE[r.burst] ?? DEATH_STYLE.humanoid;
      const n = Math.max(2, Math.round(D.n * this.q * r.scale));
      const c0 = col(D.chips), c1 = col(D.dust);
      const lx = r.x2 * 0.25, lz = r.z2 * 0.25;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 1.5 + 2.5 * Math.random();
        this.dust.spawn(r.x, r.y, r.z, Math.sin(a) * sp + lx, 2 + 3 * Math.random(), Math.cos(a) * sp + lz, 0.6 + 0.4 * Math.random(), 0.14, 0.1, c0, c0, 0.95, 12, 0.6, age0);
      }
      this.burst('dust', r.x, 0.2, r.z, 0.6 * r.scale, age0, 0.3);
      return;
    }
    if (!r.burst) return;
    const s = r.shape;
    switch (r.type) {
      case 'flash': case 'fan': case 'line': case 'sphere': {
        // 모양을 따라 퍼뜨린다(원 · 원뿔 · 선)
        if (s.type === 'line') {
          const fx = Math.sin(s.facing), fz = Math.cos(s.facing);
          for (let j = 0; j < 4; j++) {
            const d = ((j + 0.5) * s.len) / 4;
            this.burst(r.burst, s.x + fx * d, 0.2, s.z + fz * d, 0.35, age0, s.width * 0.4);
          }
        } else if (s.type === 'cone') {
          const d = s.r * 0.55;
          this.burst(r.burst, s.x + Math.sin(s.facing) * d, 0.2, s.z + Math.cos(s.facing) * d, 1, age0, s.r * 0.35);
        } else {
          this.burst(r.burst, s.x, 0.3, s.z, 1, age0, Math.min(s.r, 3) * 0.6);
        }
        break;
      }
      case 'ring': this.burst(r.burst, s.x, 0.25, s.z, 1, age0, s.r * 0.15); break;
      default: this.burst(r.burst, r.x, r.y, r.z, r.scale, age0, 0.3);
    }
  }

  /** HIT 불꽃(피해 종류별 · 치명타 크게) — 고리 버퍼를 비운다 */
  _hits(state, now) {
    if (!this.hitN) return;
    const rift = state.scene === 'rift' ? state.rift : null;
    const px = this.px, pz = this.pz;
    for (let k = 0; k < this.hitN; k++) {
      const h = this.hitQ[(this.hitHead + k) % CAP.hits];
      const age0 = (now - h.tick) * DT;
      if (age0 > HIT_FX.life || age0 < -0.1) continue;
      if (!Number.isFinite(h.x) || !Number.isFinite(h.z) || this.far(h.x, h.z)) continue;
      let y = 1.0;
      if (rift && h.id >= 0) {
        const mons = rift.mons;
        for (let i = 0; i < mons.length; i++) if (mons[i].id === h.id) { y = Math.max(0.3, mons[i].height * HIT_FX.y); break; }
      }
      if (h.immune) { this.burst('goldFade', h.x, y, h.z, 0.5, age0); continue; }
      const S = HIT_STYLE[h.type] ?? HIT_STYLE.phys;
      const ca = col(S.a), cb = h.blocked ? col(0x9a9a9a) : col(S.b);
      const n = Math.max(1, Math.round((h.dot ? HIT_FX.nDot : h.big ? HIT_FX.nBig : h.crit ? HIT_FX.nCrit : HIT_FX.n) * this.q));
      let dx = h.x - px, dz = h.z - pz;
      const L = Math.hypot(dx, dz);
      if (L > 1e-3) { dx /= L; dz /= L; } else { dx = 0; dz = 0; }
      const size = h.crit || h.big ? HIT_FX.sizeCrit : HIT_FX.size;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u);
        const sp = HIT_FX.speed * (0.5 + Math.random()) * (h.dot ? 0.4 : 1);
        this.sparks.spawn(h.x - dx * 0.3, y, h.z - dz * 0.3, (Math.sin(a) * s * 0.8 + dx * 0.7) * sp, (u * 0.5 + 0.4) * sp, (Math.cos(a) * s * 0.8 + dz * 0.7) * sp,
          HIT_FX.life * (0.7 + 0.6 * Math.random()), size, 0.03, ca, cb, 1, 6, 4, age0);
      }
      if ((h.crit || h.big) && !h.dot) this.sparks.spawn(h.x - dx * 0.3, y, h.z - dz * 0.3, 0, 0, 0, HIT_FX.critLife, HIT_FX.critFlash, HIT_FX.critFlash * 0.5, ca, cb, 0.7, 0, 0, age0);
    }
    this.hitN = 0;
  }

  /** 돌진이 끝났다 — 먼지 자취를 순간 연출로(0.5초에 사라진다) */
  _endDash() {
    const d = this._dash;
    if (!d.live) return;
    d.live = false;
    const L = Math.hypot(d.x1 - d.x0, d.z1 - d.z0);
    if (!(L > 0.05)) return;
    const r = this._rec('trail', '');
    if (!r) return;
    r.x = d.x0; r.z = d.z0;
    r.shape.type = 'line'; r.shape.x = d.x0; r.shape.z = d.z0; r.shape.facing = Math.atan2(d.x1 - d.x0, d.z1 - d.z0); r.shape.len = L; r.shape.width = d.w;
    r.durT = ticks(0.5);
  }
}

