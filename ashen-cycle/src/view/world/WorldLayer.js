// OWNER: P6 — 계약 §9.3
// 월드 레이어: 마을 + 아레나 3테마를 부팅 때 전부 만들어 두고 전환은 visible만 바꾼다(생성 비용 0 — 로딩 없음).
// 조명은 테마가 공유한다(반구광 1 · 그림자 방향광 1 · 카메라 채움광 1 · 점광원 4) — 광원 수가 변하지 않아 전환 때 셰이더 재컴파일이 없다.
// 이벤트 없이도 state(world.id · boss.phase)를 보고 스스로 전환한다(§9.1). sim 상태는 읽기만 한다.
import * as THREE from 'three';
import { EV } from '../../core/events.js';
import { damp, lerp } from '../../core/math2d.js';
import { PALETTE } from '../../data/palette.js';
import { QUALITY } from '../../data/settings.js';
import { WORLDS, getWorld } from '../../data/world.js';
import { getBossDef } from '../../data/bosses/index.js';
import { createSkyMaterial, createTextureLibrary } from './proceduralTextures.js';
import { buildTown } from './townScene.js';
import { buildArena } from './arenaScene.js';

/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').WorldDef} WorldDef */
/** @typedef {import('../../types.js').RenderContext} RenderContext */
/** @typedef {import('../../types.js').Settings} Settings */

const POINT_LIGHTS = 4;              // 테마 공용 점광원 수(고정 — 모자라면 세기 0으로 둔다)
const SUN_DISTANCE = 70;             // 그림자 광원이 초점에서 떨어진 거리(m)
const SUN_BOSS_REACH = 12;           // 초점이 보스 쪽으로 끌려가는 최대 거리의 두 배(m)
const PHASE_LAMBDA = 1.6;            // 2페이즈 톤으로 넘어가는 속도(damp λ)
const PULSE_DUR = 1.4;               // 페이즈 전환 순간의 조명 섬광 길이(초)
const PULSE_GAIN = 1.6;
const DRIFT_SCALE = { low: 0.4, medium: 0.75, high: 1 };   // 화질별 떠다니는 입자 비율
const SHADOW_BIAS = -0.0005;
const SHADOW_NORMAL_BIAS = 0.035;
const FILL_PITCH = 0.12;              // 채움광 방향의 y 성분(위로 살짝 — 턱 밑 · 방패 밑까지 닿는다. 바닥은 밝히지 않는다)
const VOID_DISC_PAD = 0.35;          // arenaScene의 DISC와 같다(룬 맵이 덮는 반경)
const VOID_RUNE_COLOR = 0x3c50c8;    // 심연 제단 바닥 룬(남색) — 텔레그래프의 보라(0x8a3cff)와 색조가 다르다

const _tmp = new THREE.Color();

/** 테마 환경값(숫자) → 미리 만든 Color 묶음. 프레임마다 할당하지 않으려고 한 번만 만든다. */
function prepareEnv(env) {
  const col = (v) => (Array.isArray(v) ? new THREE.Color().setRGB(v[0], v[1], v[2]) : new THREE.Color(v));
  return {
    env,
    fog: col(env.fog).multiplyScalar(env.fogGain ?? 1),
    hemiSky: col(env.hemiSky),
    hemiGround: col(env.hemiGround),
    sun: col(env.sunColor),
    sunDir: new THREE.Vector3().fromArray(env.sunDir).normalize(),
    fill: col(env.fillColor ?? 0xffffff),
    skyTop: col(env.sky.top),
    skyHorizon: col(env.sky.horizon),
    skyGlow: col(env.sky.glow),
    orb: col(env.sky.orbColor),
    lights: env.lights.slice(0, POINT_LIGHTS).map((l) => ({ ...l, c: col(l.color), phase: Math.random() * 6.28 })),
    tint: new THREE.Color(0xffffff),   // 2페이즈 목표색(보스 대표색) — 보스가 정해질 때 채운다
  };
}

export class WorldLayer {
  /**
   * 마을 + 아레나 3종을 부팅 때 전부 만든다. 전부 숨긴 채 시작한다(§9.1).
   * @param {{rc:RenderContext, bus:import('../../core/events.js').EventBus, settings:Settings}} deps
   */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    /** worldRoot — 남의 그룹에 자식을 넣지 않는다(§9.1) */
    this.root = new THREE.Group();
    this.root.name = 'worldRoot';
    rc.scene.add(this.root);

    // ── 공용 조명 ──
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = SHADOW_BIAS;
    this.sun.shadow.normalBias = SHADOW_NORMAL_BIAS;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SUN_DISTANCE * 2;
    this.root.add(this.hemi, this.sun, this.sun.target);
    // 카메라 채움광: 카메라가 보는 수평 방향으로 비추는 그림자 없는 방향광. 해가 어느 쪽에 있든 「카메라를 향한 면」이
    // 검게 죽지 않는다 — 록온 카메라는 늘 보스의 정면(해를 등진 면)을 보기 때문에, 이것이 없으면 어두운 갑옷의
    // 보스가 어두운 아레나에서 실루엣만 남는다. 방향이 수평이라 바닥(법선이 위)은 거의 밝히지 않는다.
    this.fill = new THREE.DirectionalLight(0xffffff, 0);
    this.fill.castShadow = false;
    this.root.add(this.fill, this.fill.target);
    this._fwd = new THREE.Vector3();
    /** @type {THREE.PointLight[]} */
    this.points = [];
    for (let i = 0; i < POINT_LIGHTS; i++) {
      const p = new THREE.PointLight(0xffffff, 0, 20, 2);
      this.points.push(p);
      this.root.add(p);
    }

    // ── 하늘(메시 하나 — 테마는 uniform으로) ──
    this.skyMat = createSkyMaterial();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 900;        // 불투명체를 다 그린 뒤 — 가려진 픽셀은 깊이 검사로 버려진다
    this.sky.matrixAutoUpdate = false;
    this.sky.name = 'sky';
    this.root.add(this.sky);

    // ── 텍스처 · 스테이지 ──
    const voidWorld = Object.values(WORLDS).find((w) => w.theme === 'void');
    // 룬의 색은 텔레그래프(PALETTE.style.void.glow — 보라)에서 떼어 둔다: 더 푸르고 어둡게. 같은 보라면 공격 예고가 바닥 장식에 묻힌다
    const glowHex = VOID_RUNE_COLOR;
    this.lib = createTextureLibrary({
      voidDisc: (voidWorld ? voidWorld.radius : 22) + VOID_DISC_PAD,
      voidPillars: voidWorld ? voidWorld.colliders.filter((c) => c.type === 'circle') : [],
      runeColor: [(glowHex >> 16) & 255, (glowHex >> 8) & 255, glowHex & 255],
    });
    /** @type {Map<string, {stage:any, prep:ReturnType<typeof prepareEnv>}>} */
    this._stages = new Map();
    for (const world of Object.values(WORLDS)) this._build(world);

    /** @type {string|null} */
    this._worldId = null;
    /** @type {{stage:any, prep:ReturnType<typeof prepareEnv>}|null} */
    this._cur = null;
    /** @type {string|null} */
    this._bossId = null;
    this._time = 0;
    this._mix = 0;            // 2페이즈 톤 0..1
    this._phaseTarget = 0;
    this._pulse = 0;
    /** @type {string|null} */
    this._quality = null;
    this._shadowExtent = 0;
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._bufSize = new THREE.Vector2();

    this._applyQuality(rc.quality ?? settings.quality);
    this._prewarm();
    // 첫 MODE_CHANGED 전의 프레임도 멀쩡하게: 마을 환경값으로 조명 · 하늘만 맞춰 둔다(스테이지는 숨긴 채)
    const first = this._stages.get('town') ?? this._stages.values().next().value;
    if (first) this._applyStatic(first.prep);

    this._offs = bus ? [
      bus.on(EV.MODE_CHANGED, (p) => {
        const w = getWorld(p.worldId);
        if (w) this._setWorld(w);
        this._bossId = null;   // 같은 아레나에서 재도전해도 다음 update가 2페이즈 톤을 새 보스 상태로 스냅한다
      }),
      bus.on(EV.BOSS_PHASE_CHANGED, () => { this._pulse = 1; this._phaseTarget = 1; }),
    ] : [];
  }

  /** @param {WorldDef} world */
  _build(world) {
    const stage = world.kind === 'town' ? buildTown(world, this.lib) : buildArena(world, this.lib);
    stage.group.visible = false;
    this.root.add(stage.group);
    const entry = { stage, prep: prepareEnv(stage.env) };
    this._stages.set(world.id, entry);
    return entry;
  }

  /** 네 월드를 전부 켠 채 셰이더를 컴파일하고 텍스처를 올린다 → 첫 전환에 멈칫이 없다. */
  _prewarm() {
    const r = this.rc.renderer;
    try {
      for (const t of this.lib.all()) r.initTexture(t);
      for (const e of this._stages.values()) e.stage.group.visible = true;
      if (typeof this.rc.prewarm === 'function') this.rc.prewarm();
      else r.compile(this.rc.scene, this.rc.camera);
    } catch (err) {
      console.warn('[WorldLayer] 선컴파일을 건너뛴다', err);
    } finally {
      for (const e of this._stages.values()) e.stage.group.visible = false;
    }
  }

  /** @param {string} q */
  _applyQuality(q) {
    const id = QUALITY[q] ? q : 'medium';
    if (id === this._quality) return;
    this._quality = id;
    const cfg = QUALITY[id];
    // 광원의 castShadow가 바뀌면 조명 상태 해시가 달라져 재질이 그림자 없는 프로그램으로 갈아탄다
    this.sun.castShadow = cfg.shadows;
    const size = cfg.shadowMapSize || 512;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    const k = DRIFT_SCALE[id] ?? 1;
    for (const e of this._stages.values()) {
      for (const d of e.stage.drifts) d.geometry.setDrawRange(0, Math.max(1, Math.floor(d.geometry.attributes.position.count * k)));
    }
  }

  /** 테마가 바뀔 때 한 번만 넣는 값(방향 · 위치 · 하늘 모양). */
  _applyStatic(prep) {
    const env = prep.env;
    const u = this.skyMat.uniforms;
    u.uGlowDir.value.fromArray(env.sky.glowDir).normalize();
    u.uGlowPow.value = env.sky.glowPow;
    u.uOrbDir.value.fromArray(env.sky.orbDir).normalize();
    u.uOrbSize.value = env.sky.orbSize;
    u.uOrbRing.value = env.sky.orbRing;
    u.uStars.value = env.sky.stars;
    u.uCloud.value = env.sky.cloud;
    for (let i = 0; i < POINT_LIGHTS; i++) {
      const p = this.points[i];
      const l = prep.lights[i];
      if (l) {
        p.position.set(l.x, l.y, l.z);
        p.distance = l.distance;
      } else {
        p.intensity = 0;
      }
    }
    // 그림자 상자: 테마마다 크기가 다르다
    const ext = env.shadowExtent;
    if (ext !== this._shadowExtent) {
      this._shadowExtent = ext;
      const cam = this.sun.shadow.camera;
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.updateProjectionMatrix();
    }
    // 텍셀 맞춤용 광원 공간 축
    this._right.set(0, 1, 0).cross(prep.sunDir).normalize();
    this._up.copy(prep.sunDir).cross(this._right).normalize();
    this._applyDynamic(prep, 0);
  }

  /** 매 프레임: 2페이즈 톤 혼합 · 일렁임 · 섬광. 할당 없음. */
  _applyDynamic(prep, dt) {
    const env = prep.env;
    const p2 = env.phase2;
    const m = p2 ? this._mix : 0;
    const gain = 1 + (p2 ? (p2.gain - 1) * m : 0) + this._pulse * PULSE_GAIN;
    const tint = prep.tint;
    const fog = this.rc.scene.fog;
    if (fog) {
      fog.color.copy(prep.fog);
      if (p2) fog.color.lerp(_tmp.copy(tint).multiplyScalar(0.22), p2.fog * m);
      fog.density = env.fogDensity * (p2 ? lerp(1, p2.fogDensityMul, m) : 1);
    }
    this.hemi.color.copy(prep.hemiSky);
    this.hemi.groundColor.copy(prep.hemiGround);
    if (p2) this.hemi.color.lerp(tint, p2.hemi * m);
    this.hemi.intensity = env.hemiIntensity * (1 + this._pulse * 0.5);
    this.sun.color.copy(prep.sun);
    if (p2) this.sun.color.lerp(tint, p2.sun * m);
    this.sun.intensity = env.sunIntensity * gain;
    this.fill.color.copy(prep.fill);
    this.fill.intensity = env.fillIntensity ?? 0;

    const t = this._time;
    for (let i = 0; i < prep.lights.length; i++) {
      const l = prep.lights[i];
      const p = this.points[i];
      p.color.copy(l.c);
      if (p2) p.color.lerp(tint, p2.lights * m);
      // 불빛의 일렁임: 서로 다른 주기의 사인 셋
      const f = 1 + l.flicker * (0.13 * Math.sin(t * 11.3 + l.phase) + 0.08 * Math.sin(t * 23.7 + l.phase * 2.1) + 0.05 * Math.sin(t * 37.1 + l.phase * 0.7));
      p.intensity = l.intensity * f * gain;
      p.position.y = l.y + l.flicker * 0.04 * Math.sin(t * 17.0 + l.phase);
    }

    const u = this.skyMat.uniforms;
    u.uTop.value.copy(prep.skyTop);
    u.uHorizon.value.copy(prep.skyHorizon);
    u.uGlow.value.copy(prep.skyGlow);
    if (p2) {
      u.uHorizon.value.lerp(_tmp.copy(tint).multiplyScalar(0.3), p2.sky * m);
      u.uGlow.value.lerp(tint, p2.sky * m);
    }
    u.uGlow.value.multiplyScalar(1 + this._pulse);
    u.uOrbColor.value.copy(prep.orb).multiplyScalar(gain);
    u.uBottom.value.copy(fog ? fog.color : prep.fog);
    u.uTime.value = t;
  }

  /** @param {WorldDef} world */
  _setWorld(world) {
    if (world.id === this._worldId) return;
    const entry = this._stages.get(world.id) ?? this._build(world);
    if (this._cur) this._cur.stage.group.visible = false;
    entry.stage.group.visible = true;
    this._cur = entry;
    this._worldId = world.id;
    this._mix = 0;
    this._phaseTarget = 0;
    this._pulse = 0;
    this._bossId = null;
    this._applyStatic(entry.prep);
  }

  /**
   * @param {GameState} state
   * @param {number} alpha
   * @param {number} dt
   */
  update(state, alpha, dt) {
    if (!(dt >= 0)) dt = 0;
    if (state.world.id !== this._worldId) this._setWorld(state.world);
    const cur = this._cur;
    if (!cur) return;
    const q = this.rc.quality ?? this.settings.quality;
    if (q !== this._quality) this._applyQuality(q);

    // 2페이즈 톤: 이벤트가 없어도 boss.phase를 본다
    const boss = state.boss;
    const bossId = boss ? boss.id : null;
    const target = boss && boss.phase === 2 ? 1 : 0;
    if (bossId !== this._bossId) {
      this._bossId = bossId;
      const def = bossId ? getBossDef(bossId) : null;
      const style = def ? PALETTE.style[def.style] : null;
      cur.prep.tint.set(style ? style.glow : 0xffffff);
      this._mix = target;                       // 보스가 바뀐 순간에는 스냅
      this._phaseTarget = target;
    } else if (target !== this._phaseTarget) {
      if (target > this._phaseTarget) this._pulse = 1;
      this._phaseTarget = target;
    }
    this._time += dt;
    this._mix = damp(this._mix, this._phaseTarget, PHASE_LAMBDA, dt);
    if (this._pulse > 0) this._pulse = Math.max(0, this._pulse - dt / PULSE_DUR);

    this._applyDynamic(cur.prep, dt);

    const stage = cur.stage;
    const t = this._time;
    const tu = stage.timeUniforms;
    for (let i = 0; i < tu.length; i++) tu[i].value = t;
    stage.tick(t, dt, cur.prep.env.phase2 ? this._mix : 0, this._pulse);
    if (stage.drifts.length) {
      // 점 크기 = 월드 크기 × (화면 높이 × 투영 배율 / 2) / 거리
      this.rc.renderer.getDrawingBufferSize(this._bufSize);
      const scale = this._bufSize.y * 0.5 * this.rc.camera.projectionMatrix.elements[5];
      for (let i = 0; i < stage.drifts.length; i++) stage.drifts[i].material.uniforms.uScale.value = scale;
    }

    this._followSun(state, alpha, cur.prep);
    this._aimFill();
  }

  /** 채움광을 카메라가 보는 수평 방향에 맞춘다(카메라는 이 레이어보다 먼저 갱신된다 — §11.1 프레임 순서). */
  _aimFill() {
    const cam = this.rc.camera;
    const f = cam.getWorldDirection(this._fwd);
    f.y = FILL_PITCH;
    if (f.lengthSq() < 1e-6) return;
    f.normalize();
    this.fill.position.copy(cam.position);
    this.fill.target.position.copy(cam.position).add(f);
  }

  /** 그림자 광원이 플레이어(와 보스 쪽 절반)를 따라간다. 그림자 맵 텍셀에 맞춰 움직여 가장자리가 떨리지 않는다. */
  _followSun(state, alpha, prep) {
    const p = state.player;
    let fx = lerp(p.prevPos.x, p.pos.x, alpha);
    let fz = lerp(p.prevPos.z, p.pos.z, alpha);
    if (!Number.isFinite(fx) || !Number.isFinite(fz)) return;
    const b = state.boss;
    if (b) {
      const dx = lerp(b.prevPos.x, b.pos.x, alpha) - fx;
      const dz = lerp(b.prevPos.z, b.pos.z, alpha) - fz;
      const l = Math.hypot(dx, dz);
      if (l > 0 && Number.isFinite(l)) {
        const k = (Math.min(l, SUN_BOSS_REACH) / l) * 0.5;
        fx += dx * k;
        fz += dz * k;
      }
    }
    const r = this._right;
    const up = this._up;
    const texel = (this._shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const uu = fx * r.x + fz * r.z;
    const vv = fx * up.x + fz * up.z;
    const su = Math.round(uu / texel) * texel - uu;
    const sv = Math.round(vv / texel) * texel - vv;
    const cx = fx + r.x * su + up.x * sv;
    const cy = r.y * su + up.y * sv;
    const cz = fz + r.z * su + up.z * sv;
    const d = prep.sunDir;
    this.sun.target.position.set(cx, cy, cz);
    this.sun.position.set(cx + d.x * SUN_DISTANCE, cy + d.y * SUN_DISTANCE, cz + d.z * SUN_DISTANCE);
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    for (const e of this._stages.values()) e.stage.dispose();
    this._stages.clear();
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    if (this.sun.shadow.map) this.sun.shadow.map.dispose();
    this.lib.dispose();
    this.rc.scene.remove(this.root);
    this._cur = null;
    this._worldId = null;
  }
}
