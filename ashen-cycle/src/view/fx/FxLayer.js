// OWNER: P7 — 계약 §9.7 · §9.8
// 연출 레이어. fxRoot(THREE.Group) 하나를 scene 아래에 두고 자기 것만 넣는다.
//   · 이벤트 → 연출(§9.7 첫 표): 버스에서 받은 이벤트를 큐에 쌓았다가 update에서 순서대로 처리한다
//     (그 프레임의 state · 보간 위치 · 소켓을 같이 쓸 수 있고, 이벤트는 틱 끝에 플러시되므로 같은 프레임에 그려진다).
//   · 상태 → 그리기(§9.7 둘째 표): 텔레그래프 · 투사체 · 장판 · 록온 표식 · 그로기 표식 · 분위기 입자.
// 입자 · 궤적 · 숫자는 렌더 시간(dt)으로 돈다 — 히트스톱으로 멈춘 화면 위로 스파크가 튄다(§5.2).
import * as THREE from 'three';
import { EV } from '../../core/events.js';
import { lerp, lerpAngle } from '../../core/math2d.js';
import { getBossDef } from '../../data/bosses/index.js';
import { PLAYER } from '../../data/player.js';
import { COMBAT } from '../../data/combat.js';
import { Particles, PK, ringSize } from './particles.js';
import { WeaponTrail } from './trails.js';
import { Telegraphs } from './telegraphs.js';
import { ProjectileFx, HazardFx } from './projectileFx.js';
import { DamageNumbers } from './damageNumbers.js';
import { Markers } from './markers.js';
import { ScreenOverlay } from './overlay.js';
import { COL, dustColor, styleColors } from './fxColors.js';

/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').Settings} Settings */

// ── 연출 상수 ──
/** 처리 전 이벤트 큐 상한(update가 불리지 않는 동안 무한히 쌓이지 않게) */
const QUEUE_MAX = 512;
const LIGHT_POOL = 3;
// 번쩍임 광원은 맞은 자리(= 몸의 표면)에 놓인다. 물리 감쇠(거리 제곱)면 광원에 닿은 면이 수백 배로 타서
// 대상이 통째로 하얗게 날아간다 — 완만한 감쇠(d^0.6)와 짧은 사거리로 「주변이 잠깐 밝아지는」 정도만 낸다.
// 호출부의 세기 값은 종전 눈금 그대로 두고 여기서 한 번에 줄인다(1m 거리의 조도 ≈ 값 × GAIN — 햇빛이 1.6쯤).
const LIGHT_RANGE = 9;
const LIGHT_DECAY = 0.6;
const LIGHT_GAIN = 0.14;
/** 궤적이 판정 뒤에도 샘플을 받는 시간(초) — §9.8 */
const TRAIL_TAIL_PLAYER = 0.08;
const TRAIL_TAIL_BOSS = 0.1;
/** 리본은 날의 바깥쪽 절반만 덮는다(날 전체를 덮으면 휘두른 부채꼴이 화면을 가린다). 보스는 날이 길어 그만큼 굵다 */
const TRAIL_INNER_PLAYER = 0.45;
const TRAIL_INNER_BOSS = 0.6;
/** 소켓이 없을 때 쓰는 보스 몸 높이 비율 */
const CHEST_FRAC = COMBAT.hitY.bossFrac;
const HEAD_FRAC = 1.0;
/** 무릎 꿇은 보스의 피격 높이(몸 키 대비) · 그 자세인 상태 */
const KNEEL_HIT_FRAC = 0.42;
const KNEELING = { groggy: true, executed: true, recover: true };
/** 머리 위 표식을 띄우는 높이(m) */
const MARK_ABOVE_HEAD = 0.5;
const DANGER_ABOVE_HEAD = 0.9;
/** 예고 발광의 입자가 모여드는 반경(m)과 초당 개수 */
const GATHER_RADIUS = 1.9;
const GATHER_RATE = 46;
const GATHER_LIFE = 0.26;
/** 브레스 · 광선 */
const BREATH_RATE = 170;
const BREATH_LIFE = 0.6;
const BEAM_RATE = 70;
const BEAM_CORE_FRAC = 0.2;
const BEAM_GLOW_FRAC = 0.42;
/** 광선의 HDR 배율 — 카메라 옆을 쓸고 지나가도 화면이 하얗게 뜨지 않게(심지만 블룸에 걸린다) */
const BEAM_CORE_HDR = 1.9;
const BEAM_GLOW_HDR = 0.9;
const BEAM_GLOW_OPACITY = 0.3;
const BEAM_INNER_START = 1.0;     // 광선 판정이 시작되는 거리(m) — 바닥 표식을 여기서부터 그린다
const SUSTAIN_SLACK = 1.5;        // 끝 이벤트를 못 받았을 때 스스로 끝나는 여유(초)
const SUSTAIN_DEFAULT_MAX = 6;
/** 분위기 입자가 도는 원통(플레이어 중심) */
const AMBIENT_RADIUS = 13;
const BONFIRE_EMBER_RATE = 9;
const ENCHANT_RATE = 38;
const TIMED_MAX = 8;
const SUSTAIN_MAX = 4;

/** 테마별 분위기 입자: 예산에서 차지하는 몫 · 수직 속도 범위 · 흩날림 · 생성 높이 범위 */
const AMBIENT = {
  town: { kind: PK.mote, share: 0.05, vy0: 0.15, vy1: 0.5, drift: 0.25, y0: 0.1, y1: 3.0, windX: 0, windZ: 0 },
  ember: { kind: PK.mote, share: 0.15, vy0: 0.3, vy1: 1.1, drift: 0.5, y0: 0.05, y1: 2.5, windX: 0.25, windZ: 0.1 },
  frost: { kind: PK.snow, share: 0.2, vy0: -1.5, vy1: -0.8, drift: 0.35, y0: 2.5, y1: 7.5, windX: 0.9, windZ: 0.35 },
  void: { kind: PK.mote, share: 0.14, vy0: -0.12, vy1: 0.3, drift: 0.3, y0: 0.2, y1: 4.5, windX: 0, windZ: 0 },
};

/** 이 레이어가 구독하는 이벤트(§9.7 표의 fx 열 전부) */
const FX_EVENTS = [
  EV.MODE_CHANGED, EV.PLAYER_SWING, EV.PLAYER_CHARGE_FULL, EV.HIT, EV.PLAYER_DODGED, EV.PLAYER_ROLL,
  EV.PLAYER_STEP, EV.BOSS_STEP, EV.PLAYER_FLASK, EV.PLAYER_RESTED, EV.PLAYER_DIED,
  EV.BOSS_ATTACK_WINDUP, EV.BOSS_ATTACK_ACTIVE, EV.BOSS_ATTACK_END, EV.BOSS_CUE, EV.BOSS_PHASE_CHANGED,
  EV.BOSS_GROGGY, EV.BOSS_TELEPORT, EV.BOSS_DEFEATED,
  EV.PROJECTILE_SPAWNED, EV.PROJECTILE_ENDED, EV.HAZARD_SPAWNED, EV.HAZARD_ACTIVATED, EV.HAZARD_ENDED,
  EV.LEVEL_UP, EV.WEAPON_UPGRADED, EV.ITEM_PURCHASED, EV.SETTINGS_CHANGED,
];

const rand = Math.random;
const rr = (a, b) => a + (b - a) * rand();

export class FxLayer {
  /**
   * @param {{scene:THREE.Scene, camera:THREE.PerspectiveCamera,
   *          bus:import('../../core/events.js').EventBus,
   *          characters:{getSocketWorld:(who:'player'|'boss', socket:string, out:THREE.Vector3)=>boolean}|null,
   *          settings:Settings}} deps  characters = CharacterLayer (getSocketWorld만 쓴다)
   */
  constructor({ scene, camera, bus, characters, settings }) {
    this.scene = scene;
    this.camera = camera;
    this.bus = bus;
    this.characters = characters;
    this.settings = settings;

    /** fxRoot — 남의 그룹에 자식을 넣지 않는다(§9.1) */
    this.root = new THREE.Group();
    this.root.name = 'fxRoot';
    scene.add(this.root);

    this.telegraphs = new Telegraphs(this.root);
    this.particles = new Particles(this.root, settings.quality);
    this.playerTrail = new WeaponTrail(this.root);
    this.bossTrail = new WeaponTrail(this.root);
    this.numbers = new DamageNumbers(this.root);
    this.markers = new Markers(this.root, camera);
    this.overlay = new ScreenOverlay(this.root);

    // 점광원 풀 — 개수가 바뀌면 재질이 다시 컴파일되므로 처음부터 세 개를 켜 두고 세기만 바꾼다
    /** @type {{light:THREE.PointLight, t:number, dur:number, peak:number}[]} */
    this._lights = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, LIGHT_RANGE, LIGHT_DECAY);
      this.root.add(light);
      this._lights.push({ light, t: 0, dur: 0, peak: 0 });
    }
    const flashLight = (x, y, z, color, intensity, dur) => this._flash(x, y, z, color, intensity, dur);
    this.projectiles = new ProjectileFx(this.root, this.particles, flashLight);
    this.hazards = new HazardFx(this.root, this.particles, flashLight);

    // 광선 메시(하나): 원점에서 +Z로 뻗는 단위 원기둥 두 겹
    this._beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    this._beamGeo.rotateX(Math.PI / 2);
    this._beamGeo.translate(0, 0, 0.5);
    this._beamCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this._beamGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false, transparent: true, opacity: BEAM_GLOW_OPACITY, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this._beamCore = new THREE.Mesh(this._beamGeo, this._beamCoreMat);
    this._beamGlow = new THREE.Mesh(this._beamGeo, this._beamGlowMat);
    this._beam = new THREE.Group();
    this._beam.add(this._beamCore, this._beamGlow);
    this._beam.visible = false;
    this.root.add(this._beam);

    /** 지속 연출(브레스 · 광선 · 예고 발광) — seq로 시작과 끝을 짝짓는다(§4.2) */
    this._sustain = [];
    for (let i = 0; i < SUSTAIN_MAX; i++) {
      this._sustain.push({ on: false, type: '', seq: 0, style: 'fire', length: 0, half: 0, width: 0, socket: '', y: NaN, t: 0, maxT: 0 });
    }
    /** 시간제 방출기(재 · 격파 불씨 · 상승 빛 · 돌진 먼지) */
    this._timed = [];
    for (let i = 0; i < TIMED_MAX; i++) {
      this._timed.push({ on: false, type: '', t: 0, dur: 0, x: 0, y: 0, z: 0, r: 1, color: COL.white, color2: COL.white });
    }

    // 프레임 캐시(보간 위치)
    this._px = 0; this._pz = 0;
    this._hasBoss = false;
    this._bx = 0; this._by = 0; this._bz = 0; this._bf = 0;
    this._bossHeight = 2.5;
    this._bossFloater = false;
    this._bossStyle = 'fire';
    this._theme = 'town';
    this._worldRadius = 20;
    /** @type {{x:number, z:number}|null} */
    this._bonfire = null;
    // 모드 캐시 — 이벤트 없이 상태만 바뀌어도 따라간다(§9.1)
    this._mode = null;
    this._worldId = null;
    this._bossId = null;
    this._prewarm = false;
    this._time = 0;
    this._v0 = new THREE.Vector3();
    this._v1 = new THREE.Vector3();
    this._zone = { type: 'arc', x: 0, z: 0, r: 0, rInner: 0, dir: 0, halfAngle: 0 };
    this._zoneCap = { type: 'capsule', ax: 0, az: 0, bx: 0, bz: 0, r: 0 };

    /** 이벤트 큐: [이름, payload, 이름, payload, …] */
    this._queue = [];
    this._offs = FX_EVENTS.map((name) => bus.on(name, (p) => {
      if (this._queue.length >= QUEUE_MAX * 2) this._queue.splice(0, 2);
      this._queue.push(name, p);
    }));
  }

  /**
   * @param {GameState} state
   * @param {number} alpha
   * @param {number} dt 렌더 프레임 시간(초, 일시정지면 0). 히트스톱 중에도 입자는 렌더 시간으로 돈다
   */
  update(state, alpha, dt) {
    this._time += dt;
    this._syncMode(state);
    this._sample(state, alpha);

    // 이벤트 → 연출
    const q = this._queue;
    if (q.length) {
      this._queue = [];
      for (let i = 0; i < q.length; i += 2) this._handle(q[i], q[i + 1], state);
    }

    // 상태 → 그리기
    this.telegraphs.beginFrame();
    const tgs = state.telegraphs;
    for (let i = 0; i < tgs.length; i++) {
      const t = tgs[i];
      const sc = styleColors(t.style);
      this.telegraphs.put(t.id, t.shape, t.progress, sc.glow, sc.core, 0);
    }
    const hz = state.hazards;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.state !== 'active') continue;
      const sc = styleColors(h.style);
      this.telegraphs.put(h.id, h.shape, 1, sc.glow, sc.core, 1);
    }
    this._updateSustained(state, dt);
    this.telegraphs.endFrame(dt);

    this.projectiles.update(state, alpha, dt);
    this.hazards.update(state, alpha, dt);
    this._updateTimed(dt);
    this._updateTrails(state, dt);
    this._updateMarkers(state, dt);
    this._updateAmbient(state, dt);
    this._updateLights(dt);
    this.particles.update(dt);
    this.numbers.update(dt);
    this.overlay.update(dt);
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._queue.length = 0;
    this.telegraphs.dispose();
    this.particles.dispose();
    this.playerTrail.dispose();
    this.bossTrail.dispose();
    this.numbers.dispose();
    this.markers.dispose();
    this.overlay.dispose();
    this.projectiles.dispose();
    this.hazards.dispose();
    this._beamGeo.dispose();
    this._beamCoreMat.dispose();
    this._beamGlowMat.dispose();
    for (const l of this._lights) l.light.dispose();
    this.scene.remove(this.root);
  }

  // ───────────────────────── 프레임 준비 ─────────────────────────

  /** 모드 · 월드 · 보스가 캐시와 다르면 MODE_CHANGED를 받은 것처럼 전부 정리한다. @param {GameState} state */
  _syncMode(state) {
    const worldId = state.world ? state.world.id : null;
    const bossId = state.boss ? state.boss.id : null;
    if (state.mode === this._mode && worldId === this._worldId && bossId === this._bossId) return;
    this._mode = state.mode;
    this._worldId = worldId;
    this._bossId = bossId;
    this._clearAll();
  }

  /** 보간 위치와 월드 정보를 프레임 캐시에 담는다. @param {GameState} state @param {number} alpha */
  _sample(state, alpha) {
    const p = state.player;
    this._px = lerp(p.prevPos.x, p.pos.x, alpha);
    this._pz = lerp(p.prevPos.z, p.pos.z, alpha);
    const b = state.boss;
    this._hasBoss = !!b;
    if (b) {
      this._bx = lerp(b.prevPos.x, b.pos.x, alpha);
      this._bz = lerp(b.prevPos.z, b.pos.z, alpha);
      this._by = lerp(b.prevY, b.y, alpha);
      this._bf = lerpAngle(b.prevFacing, b.facing, alpha);
      const def = getBossDef(b.id);
      if (def) {
        this._bossHeight = def.height;
        this._bossFloater = def.rig === 'floater';
        this._bossStyle = def.style;
      }
    }
    const w = state.world;
    if (w) {
      this._theme = w.theme;
      this._worldRadius = w.radius;
      this._bonfire = null;
      for (let i = 0; i < w.facilities.length; i++) if (w.facilities[i].id === 'bonfire') this._bonfire = w.facilities[i];
    }
  }

  /**
   * 소켓의 월드 위치. 캐릭터 레이어가 없거나 스텁(false)이면 false.
   * @param {'player'|'boss'} who @param {string} socket @param {THREE.Vector3} out
   */
  _socket(who, socket, out) {
    const ch = this.characters;
    if (!ch || typeof ch.getSocketWorld !== 'function') return false;
    return ch.getSocketWorld(who, socket, out) === true && Number.isFinite(out.x + out.y + out.z);
  }

  /** 소켓이 없을 때의 보스 몸 높이(m). 부유체는 키에 부유 높이가 포함돼 있다. @param {number} frac */
  _bossY(frac) {
    const body = this._bossFloater ? Math.max(0.5, this._bossHeight - this._by) : this._bossHeight;
    return this._by + body * frac;
  }

  /**
   * 보스의 한 지점(소켓 우선, 없으면 보간 위치 + 높이 비율).
   * @param {string} socket @param {number} frac @param {THREE.Vector3} out
   */
  _bossPoint(socket, frac, out) {
    if (socket && this._socket('boss', socket, out)) return out;
    return out.set(this._bx, this._bossY(frac), this._bz);
  }

  /** 점광원 번쩍. 가장 덜 쓰이는 광원을 고른다. */
  _flash(x, y, z, color, intensity, dur) {
    let best = this._lights[0];
    for (const l of this._lights) {
      if (l.dur - l.t < best.dur - best.t) best = l;
    }
    best.light.position.set(x, y, z);
    best.light.color.copy(color);
    best.light.intensity = intensity * LIGHT_GAIN;
    best.peak = intensity * LIGHT_GAIN;
    best.t = 0;
    best.dur = dur;
  }

  /** @param {number} dt */
  _updateLights(dt) {
    for (const l of this._lights) {
      if (l.dur <= 0) continue;
      l.t += dt;
      const u = l.t / l.dur;
      if (u >= 1) {
        l.dur = 0;
        l.t = 0;
        l.light.intensity = 0;
      } else {
        l.light.intensity = l.peak * (1 - u) * (1 - u);
      }
    }
  }

  _clearAll() {
    this.particles.clear();
    this.telegraphs.clear();
    this.playerTrail.clear();
    this.bossTrail.clear();
    this.numbers.clear();
    this.markers.clear();
    this.overlay.clear();
    this.projectiles.clear();
    this.hazards.clear();
    this._beam.visible = false;
    for (const s of this._sustain) s.on = false;
    for (const t of this._timed) t.on = false;
    for (const l of this._lights) { l.dur = 0; l.t = 0; l.light.intensity = 0; }
    this._prewarm = true;
  }

  // ───────────────────────── 이벤트 → 연출 ─────────────────────────

  /** @param {string} name @param {any} p @param {GameState} state */
  _handle(name, p, state) {
    const P = this.particles;
    switch (name) {
      case EV.MODE_CHANGED:
        this._clearAll();
        break;
      case EV.SETTINGS_CHANGED:
        this.particles.setQuality(this.settings.quality);
        if (!this.settings.damageNumbers) this.numbers.clear();
        break;
      case EV.PLAYER_SWING: {
        const heavy = !!p.heavy;
        this.playerTrail.start((p.dur ?? 0.15) + TRAIL_TAIL_PLAYER, COL.white, heavy ? COL.spark : COL.steel,
          heavy ? 2.0 + 0.6 * (p.charge ?? 0) : 1.5, TRAIL_INNER_PLAYER);
        break;
      }
      case EV.PLAYER_CHARGE_FULL: {
        const v = this._v0;
        if (!this._socket('player', 'weaponTip', v)) v.set(p.x, PLAYER.height * 0.75, p.z);
        P.emitSized(PK.flare, v.x, v.y, v.z, 0.4, 1.5, 0.24, COL.white);
        P.emitSized(PK.ring, v.x, v.y, v.z, ringSize(0.15), ringSize(0.7), 0.22, COL.spark);
        P.burst(PK.streak, 10, v.x, v.y, v.z, 0, 1, 0, 1, 2, 6, COL.spark);
        this._flash(v.x, v.y, v.z, COL.spark, 12, 0.2);
        break;
      }
      case EV.HIT:
        this._onHit(p, state);
        break;
      case EV.PLAYER_DODGED: {
        // 잔상: 몸 높이를 따라 흐린 줄
        const x = this._px;
        const z = this._pz;
        for (let i = P.count(9); i > 0; i--) {
          P.emit(PK.streak, x + rr(-0.3, 0.3), rr(0.2, PLAYER.height), z + rr(-0.3, 0.3), 0, rr(1.5, 4), 0, COL.ghost, 1.6, 1.2);
        }
        P.emitSized(PK.glow, x, PLAYER.height * 0.55, z, 1.3, 2.0, 0.22, COL.ghost, 0.35);
        break;
      }
      case EV.PLAYER_ROLL: {
        const dust = dustColor(this._theme);
        const dx = -Math.sin(p.dir);
        const dz = -Math.cos(p.dir);
        P.burst(PK.dust, p.backstep ? 5 : 9, p.x, 0.15, p.z, dx, 0.35, dz, 0.5, 0.8, 2.6, dust, 0.9, 0.3);
        break;
      }
      case EV.PLAYER_STEP:
        P.burst(PK.dust, p.sprint ? 2.2 : 1.2, p.x, 0.08, p.z, 0, 1, 0, 0.8, 0.3, 0.9, dustColor(this._theme), p.sprint ? 0.6 : 0.45, 0.2);
        break;
      case EV.BOSS_STEP: {
        const dust = dustColor(this._theme);
        P.burst(PK.dust, p.heavy ? 9 : 5, p.x, 0.12, p.z, 0, 1, 0, 0.85, 0.8, 2.4, dust, p.heavy ? 1.3 : 0.95, 0.6);
        if (p.heavy) P.emitSized(PK.groundRing, p.x, 0.05, p.z, ringSize(0.3), ringSize(1.8), 0.3, dust, 0.5);
        break;
      }
      case EV.PLAYER_FLASK:
        if (p.phase === 'heal') {
          this._startTimed('rise', 0.7, this._px, 0, this._pz, 0.6, COL.heal, COL.white);
          P.emitSized(PK.groundGlow, this._px, 0.05, this._pz, 1.0, 2.6, 0.5, COL.heal, 0.6);
          P.emitSized(PK.glow, this._px, PLAYER.height * 0.6, this._pz, 1.0, 2.2, 0.3, COL.heal, 0.5);
        }
        break;
      case EV.PLAYER_RESTED:
        this._startTimed('rise', 1.0, this._px, 0, this._pz, 0.8, COL.ember, COL.spark);
        P.emitSized(PK.groundRing, this._px, 0.05, this._pz, ringSize(0.3), ringSize(1.6), 0.6, COL.ember);
        break;
      case EV.LEVEL_UP:
      case EV.WEAPON_UPGRADED:
      case EV.ITEM_PURCHASED:
        if (state.mode === 'town') {
          this._startTimed('rise', 0.9, this._px, 0, this._pz, 0.7, COL.gold, COL.spark);
          P.emitSized(PK.groundRing, this._px, 0.05, this._pz, ringSize(0.2), ringSize(1.5), 0.5, COL.gold);
          P.emitSized(PK.groundGlow, this._px, 0.05, this._pz, 0.8, 2.4, 0.5, COL.gold, 0.5);
        }
        break;
      case EV.PLAYER_DIED:
        this._startTimed('ash', 1.4, p.x, 0, p.z, 0.5, COL.ash, COL.ember);
        this.overlay.vignette(COL.blood, 0.7, 0.8);
        break;
      case EV.BOSS_ATTACK_WINDUP:
        if (p.glow && p.glow !== 'none') {
          this._startSustain('gather', p.seq, p.glow, (p.windup ?? 1) + 0.3);
          if (p.glow === 'danger') {
            // 패링 불가 신호: 머리 위 붉은 네 갈래 별(0.35초) + 퍼지는 고리
            const v = this._bossPoint('head', HEAD_FRAC, this._v0);
            this.markers.flashDanger();
            this.markers.setDangerPos(v.setY(v.y + DANGER_ABOVE_HEAD));
            P.emitSized(PK.ring, v.x, v.y, v.z, ringSize(0.3), ringSize(1.6), 0.3, styleColors('danger').glow);
            this._flash(v.x, v.y, v.z, styleColors('danger').glow, 20, 0.3);
          }
        }
        break;
      case EV.BOSS_ATTACK_ACTIVE: {
        this._endSustain('gather', p.seq);
        // 보스 무기 궤적 — 소켓이 있을 때만(사족 · 스텁 리그는 건너뛴다)
        if (this._socket('boss', 'weaponBase', this._v0) && this._socket('boss', 'weaponTip', this._v1)) {
          const b = state.boss;
          const glow = b && b.attack && b.attack.glow !== 'none' ? b.attack.glow : null;
          const lit = glow || (b && b.phase === 2);
          const sc = styleColors(glow ?? this._bossStyle);
          this.bossTrail.start((p.active ?? 0.15) + TRAIL_TAIL_BOSS, lit ? sc.core : COL.white, lit ? sc.glow : COL.steel,
            lit ? 1.7 : 1.3, TRAIL_INNER_BOSS);
        }
        break;
      }
      case EV.BOSS_ATTACK_END:
        this._endSustain('', p.seq);
        break;
      case EV.BOSS_CUE:
        this._onCue(p, state);
        break;
      case EV.BOSS_PHASE_CHANGED: {
        const sc = styleColors(this._bossStyle);
        const x = this._bx;
        const z = this._bz;
        const y = this._bossY(CHEST_FRAC);
        const R = this._worldRadius * 1.15;
        P.emitSized(PK.groundShock, x, 0.06, z, ringSize(0.5), ringSize(R), 0.95, sc.glow, 1);
        P.emitSized(PK.groundShock, x, 0.06, z, ringSize(0.3), ringSize(R * 0.6), 1.2, sc.core, 0.7);
        P.emitSized(PK.shock, x, y, z, ringSize(0.4), ringSize(9), 0.6, sc.core);
        P.emitSized(PK.glow, x, y, z, 2, 7, 0.4, sc.glow, 0.45);
        P.ringBurst(PK.ember, 46, x, 0.4, z, 0.8, 5, 13, 4, sc.glow, 1.3);
        P.ringBurst(PK.dust, 16, x, 0.2, z, 1.2, 4, 9, 0.8, dustColor(this._theme), 1.4);
        this.overlay.flash(sc.glow, 0.16, 5);
        this._flash(x, y, z, sc.glow, 60, 0.7);
        break;
      }
      case EV.BOSS_GROGGY:
        if (p.on) {
          const v = this._bossPoint('chest', CHEST_FRAC, this._v0);
          P.burst(PK.spark, 18, v.x, v.y, v.z, 0, 1, 0, 0.9, 2, 7, COL.spark);
          P.emitSized(PK.ring, v.x, v.y, v.z, ringSize(0.3), ringSize(2.2), 0.35, styleColors('danger').glow);
          P.ringBurst(PK.dust, 10, p.x, 0.15, p.z, 0.6, 1.5, 3.5, 0.5, dustColor(this._theme));
        }
        break;
      case EV.BOSS_TELEPORT: {
        const sc = styleColors(this._bossStyle);
        const y = this._bossY(CHEST_FRAC);
        P.burst(PK.ember, 14, p.fromX, y, p.fromZ, 0, 1, 0, 1, 0.5, 2.5, sc.glow, 1.2, 0.9);
        P.emitSized(PK.groundRing, p.fromX, 0.06, p.fromZ, ringSize(1.4), ringSize(0.2), 0.3, sc.glow, 0.8);
        P.burst(PK.spark, 12, p.toX, y, p.toZ, 0, 1, 0, 1, 2, 6, sc.core);
        P.emitSized(PK.groundRing, p.toX, 0.06, p.toZ, ringSize(0.2), ringSize(1.8), 0.35, sc.glow);
        this._flash(p.toX, y, p.toZ, sc.glow, 22, 0.25);
        break;
      }
      case EV.BOSS_DEFEATED: {
        const sc = styleColors(this._bossStyle);
        const y = this._bossY(CHEST_FRAC);
        P.emitSized(PK.glow, p.x, y, p.z, 2.5, 7, 0.5, sc.core, 0.55);
        P.emitSized(PK.flare, p.x, y, p.z, 1.5, 5, 0.45, COL.white);
        P.emitSized(PK.shock, p.x, y, p.z, ringSize(0.4), ringSize(7), 0.6, sc.glow);
        P.emitSized(PK.groundShock, p.x, 0.06, p.z, ringSize(0.5), ringSize(13), 0.9, sc.glow);
        P.burst(PK.spark, 50, p.x, y, p.z, 0, 1, 0, 0.9, 4, 14, sc.core, 1.3, 0.8);
        P.burst(PK.ember, 30, p.x, y, p.z, 0, 1, 0, 1, 1, 5, sc.glow, 1.4, 1.2);
        this._startTimed('defeat', 2.0, p.x, 0, p.z, 0.9, sc.glow, sc.core);
        this.overlay.flash(COL.white, 0.28, 7);
        this._flash(p.x, y, p.z, sc.core, 70, 0.9);
        break;
      }
      case EV.PROJECTILE_SPAWNED:
        this.projectiles.onSpawned(p);
        break;
      case EV.PROJECTILE_ENDED:
        this.projectiles.onEnded(p);
        break;
      case EV.HAZARD_SPAWNED:
        this.hazards.onSpawned(p);
        break;
      case EV.HAZARD_ACTIVATED:
        this.hazards.onActivated(p);
        break;
      case EV.HAZARD_ENDED:
        this.hazards.onEnded(p);
        break;
      default:
        break;
    }
  }

  /** @param {any} p HIT payload(DamageResult + kind) @param {GameState} state */
  _onHit(p, state) {
    const P = this.particles;
    const x = p.x;
    let y = p.y;
    const z = p.z;
    // 무릎 꿇은 보스(그로기 · 처형 · 일어나는 중)는 몸이 낮다. sim의 피격 높이는 선 자세 기준(키 × 0.55)이라
    // 그대로 쓰면 스파크 · 피해 숫자가 머리 위 허공에서 난다 — 꿇은 몸통 높이로 내린다.
    const boss = state ? state.boss : null;
    if (p.target === 'boss' && boss && KNEELING[boss.state]) {
      const body = this._bossFloater ? Math.max(0.5, this._bossHeight - this._by) : this._bossHeight;
      y = Math.min(y, body * KNEEL_HIT_FRAC);
    }
    const sx = Math.sin(p.dir);
    const cz = Math.cos(p.dir);
    switch (p.outcome) {
      case 'hit':
        if (p.target === 'player') {
          // 붉은 파편 + 화면 가장자리 붉은 번쩍
          P.burst(PK.shard, p.knockdown ? 16 : 10, x, y, z, sx, 0.45, cz, 0.5, 2.5, 7, COL.blood, 1.2, 0.3);
          P.burst(PK.spark, p.knockdown ? 12 : 7, x, y, z, sx, 0.5, cz, 0.6, 3, 9, COL.hurt);
          P.emitSized(PK.glow, x, y, z, 0.6, 1.5, 0.14, COL.hurt, 0.55);
          // 가장자리만 붉게 — 화면 가운데(보스의 다음 예고)를 덮지 않는다(overlay.js의 edge 범위와 한 쌍)
          this.overlay.vignette(COL.hurt, p.knockdown ? 0.55 : 0.4, 3.6);
          this._flash(x, y, z, COL.hurt, 10, 0.16);
        } else {
          // 스파크는 dir 축의 원뿔이되 맞은 표면에서 바깥(공격자 쪽)으로 튄다 — +dir 쪽은 대상의 몸 안이라 보이지 않는다
          const big = p.heavy || p.crit || p.execute;
          const n = p.execute ? 44 : big ? 28 : 15;
          P.burst(PK.spark, n, x, y, z, -sx, 0.55, -cz, 0.55, 3, p.execute ? 15 : big ? 12 : 9, COL.spark, big ? 1.25 : 1, 0.15);
          // 섬광은 맞은 자리만 덮는다 — 대상의 자세 · 피해 숫자가 섬광에 묻히지 않게(처형도 몸통 크기 안)
          P.emitSized(PK.flare, x, y, z, 0.4, p.execute ? 1.5 : big ? 1.4 : 1.0, 0.16, COL.white);
          P.emitSized(PK.glow, x, y, z, 0.5, p.execute ? 1.2 : big ? 1.3 : 1.0, 0.13, COL.spark, p.execute ? 0.35 : 0.55);
          if (p.crit || p.execute) {
            P.emitSized(PK.ring, x, y, z, ringSize(0.2), ringSize(p.execute ? 2.6 : 1.5), 0.26, COL.gold);
            P.burst(PK.streak, p.execute ? 22 : 10, x, y, z, 0, 1, 0, 1, 6, 14, COL.gold);
          }
          if (p.postureBroken) {
            P.emitSized(PK.ring, x, y, z, ringSize(0.3), ringSize(3.2), 0.4, COL.white);
            P.emitSized(PK.groundRing, x, 0.06, z, ringSize(0.4), ringSize(4), 0.5, COL.gold);
          }
          this._flash(x, y, z, COL.spark, p.execute ? 30 : big ? 20 : 11, p.execute ? 0.3 : 0.14);
          if (this.settings.damageNumbers && p.damage > 0) this.numbers.spawn(x, y, z, p.damage, !!p.crit, !!p.execute);
        }
        break;
      case 'guard':
        // 흰 스파크(작게) — 공격자 쪽으로 튄다. 가드가 깨지면 크게
        P.burst(PK.spark, p.guardBreak ? 24 : 9, x, y, z, -sx, 0.6, -cz, 0.6, 2.5, p.guardBreak ? 10 : 6.5, COL.white, p.guardBreak ? 1.1 : 0.8);
        P.emitSized(PK.glow, x, y, z, 0.4, p.guardBreak ? 1.5 : 0.9, 0.1, COL.white, 0.5);
        if (p.guardBreak) {
          P.emitSized(PK.ring, x, y, z, ringSize(0.2), ringSize(1.6), 0.3, styleColors('danger').glow);
          P.burst(PK.shard, 10, x, y, z, sx, 0.5, cz, 0.7, 2, 6, COL.steel);
        }
        this._flash(x, y, z, COL.white, p.guardBreak ? 18 : 8, 0.12);
        break;
      case 'parry':
        // 큰 고리 섬광 + 사방으로 뻗는 줄
        P.emitSized(PK.ring, x, y, z, ringSize(0.25), ringSize(1.9), 0.3, COL.white);
        P.emitSized(PK.ring, x, y, z, ringSize(0.15), ringSize(1.1), 0.2, COL.spark);
        P.emitSized(PK.flare, x, y, z, 0.8, 2.2, 0.24, COL.white);
        P.emitSized(PK.glow, x, y, z, 0.6, 1.5, 0.14, COL.spark, 0.5);
        P.burst(PK.streak, 24, x, y, z, 0, 1, 0, 1, 7, 16, COL.white, 1.2);
        P.burst(PK.spark, 16, x, y, z, -sx, 0.5, -cz, 0.7, 4, 11, COL.spark);
        this._flash(x, y, z, COL.white, 28, 0.22);
        break;
      case 'immune':
        P.burst(PK.spark, 6, x, y, z, -sx, 0.5, -cz, 0.6, 2, 5, COL.dull, 0.8);
        break;
      default:
        break;
    }
  }

  /** @param {any} p BOSS_CUE payload @param {GameState} state */
  _onCue(p, state) {
    const P = this.particles;
    const sc = styleColors(p.style ?? this._bossStyle);
    const dust = dustColor(this._theme);
    const x = p.x;
    const z = p.z;
    switch (p.cue) {
      case 'slam': {
        // 무기가 닿은 자리(소켓이 멀리 튀면 정면 2m)
        const v = this._v0;
        if (!this._socket('boss', 'weaponTip', v) || Math.hypot(v.x - x, v.z - z) > 7) {
          v.set(x + Math.sin(p.facing) * 2, 0, z + Math.cos(p.facing) * 2);
        }
        this._impact(v.x, v.z, 3.6, 1, sc, dust);
        break;
      }
      case 'land':
        this._impact(x, z, 5, 1.4, sc, dust);
        break;
      case 'stomp':
        this._impact(x, z, 2.4, 0.6, sc, dust);
        break;
      case 'roar':
      case 'howl': {
        const v = this._bossPoint(p.cue === 'howl' ? 'mouth' : 'head', 0.85, this._v0);
        const col = p.cue === 'howl' ? sc.core : sc.glow;
        P.emitSized(PK.shock, v.x, v.y, v.z, ringSize(0.4), ringSize(4.5), 0.5, col);
        P.emitSized(PK.shock, v.x, v.y, v.z, ringSize(0.2), ringSize(7.5), 0.8, col, 0.5);
        P.emitSized(PK.groundShock, x, 0.06, z, ringSize(0.6), ringSize(10), 0.7, col, 0.8);
        P.ringBurst(PK.dust, 18, x, 0.2, z, 1.0, 4, 9, 0.6, dust, 1.2);
        P.ringBurst(PK.ember, 14, x, 0.5, z, 0.8, 3, 8, 3, sc.glow);
        break;
      }
      case 'whoosh':
        break;   // 무기의 출발은 소리가 알린다 — 궤적은 BOSS_ATTACK_ACTIVE에서 시작한다
      case 'charge_start': {
        const dx = -Math.sin(p.facing);
        const dz = -Math.cos(p.facing);
        P.burst(PK.dust, 14, x, 0.2, z, dx, 0.3, dz, 0.45, 2, 6, dust, 1.3, 0.8);
        P.emitSized(PK.groundRing, x, 0.06, z, ringSize(0.4), ringSize(2.6), 0.35, dust, 0.6);
        this._startTimed('bossDust', 0.6, x, 0, z, 0.8, dust, sc.glow);
        break;
      }
      case 'cast': {
        const v = this._bossPoint('handL', 0.62, this._v0);
        P.emitSized(PK.flare, v.x, v.y, v.z, 0.5, 2.0, 0.26, sc.core);
        P.emitSized(PK.ring, v.x, v.y, v.z, ringSize(0.15), ringSize(1.1), 0.28, sc.glow);
        P.burst(PK.streak, 12, v.x, v.y, v.z, 0, 1, 0, 1, 2, 6, sc.glow);
        this._flash(v.x, v.y, v.z, sc.glow, 18, 0.3);
        break;
      }
      case 'blink_out': {
        const top = this._bossY(1);
        for (let i = P.count(18); i > 0; i--) {
          P.emit(PK.streak, x + rr(-0.5, 0.5), rr(0.2, top), z + rr(-0.5, 0.5), 0, rr(3, 9), 0, sc.glow, 1.8, 1.2);
        }
        P.emitSized(PK.ring, x, this._bossY(CHEST_FRAC), z, ringSize(1.7), ringSize(0.15), 0.22, sc.core);
        P.emitSized(PK.glow, x, this._bossY(CHEST_FRAC), z, 2.6, 0.6, 0.2, sc.glow, 0.7);
        break;
      }
      case 'blink_in': {
        const y = this._bossY(CHEST_FRAC);
        P.emitSized(PK.ring, x, y, z, ringSize(0.2), ringSize(2.0), 0.28, sc.core);
        P.emitSized(PK.flare, x, y, z, 0.6, 2.6, 0.22, sc.core);
        P.burst(PK.spark, 14, x, y, z, 0, 1, 0, 1, 3, 8, sc.glow);
        for (let i = P.count(10); i > 0; i--) {
          P.emit(PK.streak, x + rr(-0.5, 0.5), rr(1.5, 3.5), z + rr(-0.5, 0.5), 0, -rr(3, 8), 0, sc.glow, 1.8, 1.1);
        }
        break;
      }
      case 'breath_start':
      case 'beam_start': {
        const type = p.cue === 'breath_start' ? 'breath' : 'beam';
        const b = state.boss;
        // 끝 이벤트를 놓쳐도 판정이 끝나면 스스로 멎게 상한을 둔다
        const maxT = b && b.attack && b.attack.seq === p.seq ? b.attack.active + SUSTAIN_SLACK : SUSTAIN_DEFAULT_MAX;
        const s = this._startSustain(type, p.seq, p.style ?? this._bossStyle, maxT);
        s.length = p.length ?? 8;
        s.half = p.halfAngle ?? 0.5;
        s.width = p.width ?? 1;
        s.socket = p.socket ?? '';
        s.y = typeof p.y === 'number' ? p.y : NaN;
        break;
      }
      case 'breath_end':
        this._endSustain('breath', p.seq);
        break;
      case 'beam_end':
        this._endSustain('beam', p.seq);
        break;
      case 'enchant': {
        // 무기에 불이 붙는다(소켓이 없으면 가슴에서)
        const a = this._v0;
        const t = this._v1;
        if (this._socket('boss', 'weaponBase', a) && this._socket('boss', 'weaponTip', t)) {
          for (let i = P.count(30); i > 0; i--) {
            const u = rand();
            P.emit(rand() < 0.5 ? PK.flame : PK.ember, lerp(a.x, t.x, u), lerp(a.y, t.y, u), lerp(a.z, t.z, u),
              rr(-1.5, 1.5), rr(1, 4), rr(-1.5, 1.5), rand() < 0.3 ? sc.core : sc.glow, 0.8);
          }
          a.lerp(t, 0.5);
        } else {
          this._bossPoint('chest', CHEST_FRAC, a);
          P.burst(PK.flame, 20, a.x, a.y, a.z, 0, 1, 0, 0.8, 1, 4, sc.glow, 0.9, 0.8);
        }
        P.emitSized(PK.ring, a.x, a.y, a.z, ringSize(0.3), ringSize(2.4), 0.4, sc.glow);
        P.emitSized(PK.glow, a.x, a.y, a.z, 1.2, 3.0, 0.3, sc.core, 0.55);
        this._flash(a.x, a.y, a.z, sc.glow, 40, 0.5);
        break;
      }
      case 'shatter': {
        const y = this._bossY(0.4);
        P.burst(PK.crystal, 26, x, y, z, 0, 1, 0, 0.9, 3, 10, sc.core, 1.2, 1.2);
        P.emitSized(PK.groundRing, x, 0.06, z, ringSize(0.5), ringSize(5), 0.45, sc.core);
        P.ringBurst(PK.mist, 8, x, 0.4, z, 1, 1.5, 4, 0.5, sc.core);
        break;
      }
      default:
        break;
    }
  }

  /** 바닥 충격: 먼지 고리 + 돌 파편 + 보스 색 스파크 + 번쩍. */
  _impact(x, z, radius, power, sc, dust) {
    const P = this.particles;
    P.emitSized(PK.groundRing, x, 0.06, z, ringSize(0.4), ringSize(radius), 0.42, sc.glow);
    P.emitSized(PK.groundGlow, x, 0.05, z, radius * 0.8, radius * 1.6, 0.3, sc.glow, 0.4);
    P.ringBurst(PK.dust, 18 * power, x, 0.2, z, 0.5, 2.5, 6.5, 1.2, dust, 1.3);
    P.burst(PK.shard, 14 * power, x, 0.2, z, 0, 1, 0, 0.6, 4, 10, COL.stone, 1.3, 0.8);
    P.burst(PK.spark, 14 * power, x, 0.25, z, 0, 1, 0, 0.75, 3, 9, sc.core);
    this._flash(x, 0.8, z, sc.glow, 24 * power, 0.25);
  }

  // ───────────────────────── 지속 연출(seq로 짝짓는다) ─────────────────────────

  /** @param {string} type @param {number} seq @param {string} style @param {number} maxT */
  _startSustain(type, seq, style, maxT) {
    // 같은 (종류, seq)가 이미 있으면 그 칸, 없으면 빈 칸, 그것도 없으면 가장 오래된 칸
    let slot = null;
    for (const s of this._sustain) if (s.on && s.type === type && s.seq === seq) slot = s;
    if (!slot) for (const s of this._sustain) if (!s.on) { slot = s; break; }
    if (!slot) {
      slot = this._sustain[0];
      for (const s of this._sustain) if (s.t > slot.t) slot = s;
    }
    slot.on = true;
    slot.type = type;
    slot.seq = seq;
    slot.style = style;
    slot.t = 0;
    slot.maxT = maxT;
    return slot;
  }

  /** 같은 seq의 지속 연출을 끝낸다. type이 ''이면 그 seq 전부. @param {string} type @param {number} seq */
  _endSustain(type, seq) {
    for (const s of this._sustain) {
      if (s.on && s.seq === seq && (type === '' || s.type === type)) s.on = false;
    }
  }

  /** @param {GameState} state @param {number} dt */
  _updateSustained(state, dt) {
    const P = this.particles;
    let beamOn = false;
    // 교전이 끝나면(결과 화면) sim이 멈춰 끝 이벤트가 오지 않는다 — 사망 뒤 아웃트로에서 시작된 브레스 · 광선이
    // 얼어붙은 보스에서 maxT까지 계속 나오지 않게 여기서 접는다
    const over = !!state.fight && state.fight.phase === 'done';
    for (const s of this._sustain) {
      if (!s.on) continue;
      s.t += dt;
      // 보스가 사라졌거나, 교전이 끝났거나, 끝 이벤트 없이 시간이 넘었으면 접는다
      if (!this._hasBoss || over || s.t > s.maxT) { s.on = false; continue; }
      const sc = styleColors(s.style);
      if (s.type === 'gather') {
        const c = this._bossPoint('chest', CHEST_FRAC, this._v0);
        for (let i = Math.floor(GATHER_RATE * dt * P.countScale + rand()); i > 0; i--) {
          const u = rand() * 2 - 1;
          const a = rand() * Math.PI * 2;
          const q = Math.sqrt(1 - u * u);
          const dx = q * Math.cos(a);
          const dz = q * Math.sin(a);
          const sp = GATHER_RADIUS / GATHER_LIFE;
          P.emit(PK.streak, c.x + dx * GATHER_RADIUS, c.y + u * GATHER_RADIUS, c.z + dz * GATHER_RADIUS,
            -dx * sp, -u * sp, -dz * sp, rand() < 0.3 ? sc.core : sc.glow, 1.2, GATHER_LIFE / 0.22);
        }
        if (rand() < 12 * dt) P.emitSized(PK.glow, c.x, c.y, c.z, 0.5, 1.5, 0.2, sc.glow, 0.45);
        continue;
      }
      // 브레스 · 광선의 원점: 소켓 → 실패하면 보스 보간 위치 + (0, y ?? 키 × 0.55, 0). 방향은 보간 facing, 수평(§4.2)
      const o = this._v0;
      if (!this._socket('boss', s.socket, o)) {
        o.set(this._bx, Number.isFinite(s.y) ? this._by + s.y : this._bossY(CHEST_FRAC), this._bz);
      }
      const f = this._bf;
      const fx = Math.sin(f);
      const fz = Math.cos(f);
      if (s.type === 'breath') {
        const speed = s.length / BREATH_LIFE;
        for (let i = Math.floor(BREATH_RATE * dt * P.countScale + rand()); i > 0; i--) {
          const a = f + rr(-1, 1) * s.half;
          // 입에서 나와 사거리 끝에서는 바닥 가까이 닿게 살짝 아래로 분다
          const vy = -(o.y - 0.6) / BREATH_LIFE * rr(0.3, 1.0);
          const sp = speed * rr(0.75, 1.1);
          if (rand() < 0.65) P.emit(PK.breath, o.x, o.y, o.z, Math.sin(a) * sp, vy, Math.cos(a) * sp, rand() < 0.6 ? sc.core : sc.glow, 1, BREATH_LIFE / 0.575);
          else P.emit(PK.crystal, o.x, o.y, o.z, Math.sin(a) * sp * 1.1, vy + rr(0, 2), Math.cos(a) * sp * 1.1, sc.core, 0.8, 0.8);
        }
        if (rand() < 20 * dt) P.emitSized(PK.glow, o.x, o.y, o.z, 0.8, 1.8, 0.18, sc.core, 0.6);
        // 지금 때리는 구역을 바닥에 그린다(판정은 보스 위치 기준 부채꼴)
        const zn = this._zone;
        zn.x = this._bx; zn.z = this._bz; zn.r = s.length; zn.rInner = Math.min(1, s.length * 0.1); zn.dir = f; zn.halfAngle = s.half;
        this.telegraphs.put(-s.seq, zn, 1, sc.glow, sc.core, 2);
      } else if (s.type === 'beam') {
        beamOn = true;
        // 아레나 경계 밖으로는 그리지 않는다
        const od = o.x * fx + o.z * fz;
        const disc = od * od - (o.x * o.x + o.z * o.z - this._worldRadius * this._worldRadius);
        const len = Math.max(0.5, Math.min(s.length, disc > 0 ? -od + Math.sqrt(disc) : s.length));
        const open = Math.min(1, s.t / 0.08);
        const flick = 1 + 0.12 * Math.sin(this._time * 61) + 0.06 * Math.sin(this._time * 137);
        const rad = s.width * open * flick;
        this._beam.visible = true;
        this._beam.position.copy(o);
        this._beam.rotation.y = f;
        this._beamCore.scale.set(rad * BEAM_CORE_FRAC, rad * BEAM_CORE_FRAC, len);
        this._beamGlow.scale.set(rad * BEAM_GLOW_FRAC, rad * BEAM_GLOW_FRAC, len);
        this._beamCoreMat.color.copy(sc.core).multiplyScalar(BEAM_CORE_HDR);
        this._beamGlowMat.color.copy(sc.glow).multiplyScalar(BEAM_GLOW_HDR);
        for (let i = Math.floor(BEAM_RATE * dt * P.countScale + rand()); i > 0; i--) {
          const d = rand() * len;
          P.emit(PK.streak, o.x + fx * d, o.y + rr(-0.3, 0.3), o.z + fz * d, rr(-2, 2), rr(-1, 3), rr(-2, 2), rand() < 0.4 ? sc.core : sc.glow, 1.3);
        }
        // 원점 · 끝의 빛 덩어리는 매 프레임 한 장씩 쌓인다(수명 0.1초 → 예닐곱 장이 겹친다) — 옅게
        P.emitSized(PK.glow, o.x, o.y, o.z, s.width * 1.2, s.width * 1.8, 0.1, sc.core, 0.22);
        P.emitSized(PK.glow, o.x + fx * len, o.y, o.z + fz * len, s.width * 1.0, s.width * 1.6, 0.1, sc.glow, 0.22);
        const zc = this._zoneCap;
        const d0 = Math.min(BEAM_INNER_START, len);
        zc.ax = this._bx + fx * d0; zc.az = this._bz + fz * d0;
        zc.bx = this._bx + fx * len; zc.bz = this._bz + fz * len;
        zc.r = s.width / 2;
        this.telegraphs.put(-s.seq, zc, 1, sc.glow, sc.core, 1);
      }
    }
    if (!beamOn) this._beam.visible = false;
  }

  // ───────────────────────── 시간제 방출기 ─────────────────────────

  _startTimed(type, dur, x, y, z, r, color, color2) {
    let slot = this._timed[0];
    for (const t of this._timed) {
      if (!t.on) { slot = t; break; }
      if (t.dur - t.t < slot.dur - slot.t) slot = t;
    }
    slot.on = true;
    slot.type = type;
    slot.t = 0;
    slot.dur = dur;
    slot.x = x; slot.y = y; slot.z = z; slot.r = r;
    slot.color = color;
    slot.color2 = color2;
  }

  /** @param {number} dt */
  _updateTimed(dt) {
    const P = this.particles;
    for (const t of this._timed) {
      if (!t.on) continue;
      t.t += dt;
      if (t.t >= t.dur) { t.on = false; continue; }
      const k = 1 - t.t / t.dur;
      switch (t.type) {
        case 'rise': {
          // 플레이어를 따라가는 상승 빛(회복 · 성장 · 휴식)
          for (let i = Math.floor(70 * k * dt * P.countScale + rand()); i > 0; i--) {
            const a = rand() * Math.PI * 2;
            const r = t.r * rr(0.5, 1);
            P.emit(PK.rise, this._px + Math.sin(a) * r, rr(0.05, 0.6), this._pz + Math.cos(a) * r, 0, rr(1.2, 2.6), 0, rand() < 0.3 ? t.color2 : t.color);
          }
          break;
        }
        case 'ash': {
          for (let i = Math.floor(60 * k * dt * P.countScale + rand()); i > 0; i--) {
            P.emit(PK.ash, t.x + rr(-t.r, t.r), rr(0.1, 1.3), t.z + rr(-t.r, t.r), rr(-0.8, 0.8), rr(0.3, 1.4), rr(-0.8, 0.8), t.color);
          }
          if (rand() < 14 * dt) P.emit(PK.ember, t.x + rr(-t.r, t.r), rr(0.2, 1.0), t.z + rr(-t.r, t.r), rr(-0.4, 0.4), rr(0.5, 1.5), rr(-0.4, 0.4), t.color2, 0.8);
          break;
        }
        case 'defeat': {
          // 쓰러진 보스가 흩어진다 — 몸 전체에서 불씨가 오른다
          const top = Math.max(0.6, this._bossHeight * 0.7 * k);
          for (let i = Math.floor(80 * k * dt * P.countScale + rand()); i > 0; i--) {
            P.emit(PK.ember, t.x + rr(-t.r, t.r), rr(0.1, top), t.z + rr(-t.r, t.r), rr(-0.7, 0.7), rr(0.8, 3), rr(-0.7, 0.7), rand() < 0.35 ? t.color2 : t.color, 1.3, 1.2);
          }
          for (let i = Math.floor(18 * k * dt * P.countScale + rand()); i > 0; i--) {
            P.emit(PK.ash, t.x + rr(-t.r, t.r), rr(0.1, top), t.z + rr(-t.r, t.r), rr(-0.6, 0.6), rr(0.4, 1.6), rr(-0.6, 0.6), COL.ash, 1.2);
          }
          break;
        }
        case 'bossDust': {
          if (!this._hasBoss) { t.on = false; break; }
          for (let i = Math.floor(40 * dt * P.countScale + rand()); i > 0; i--) {
            P.emit(PK.dust, this._bx + rr(-t.r, t.r), 0.15, this._bz + rr(-t.r, t.r), rr(-0.8, 0.8), rr(0.2, 1.2), rr(-0.8, 0.8), t.color, 1.1);
          }
          break;
        }
        default:
          t.on = false;
      }
    }
  }

  // ───────────────────────── 상태 → 그리기 ─────────────────────────

  /** 무기 궤적: 샘플 중이면 소켓을 읽는다. 히트스톱 동안은 궤적도 멈춘다. @param {GameState} state @param {number} dt */
  _updateTrails(state, dt) {
    const tdt = state.hitstop > 0 ? 0 : dt;
    const a = this._v0;
    const b = this._v1;
    if (this.playerTrail.sampling) {
      // 소켓이 없으면(스텁 리그) 궤적을 건너뛴다
      if (this._socket('player', 'weaponBase', a) && this._socket('player', 'weaponTip', b)) this.playerTrail.addSample(a, b);
    }
    this.playerTrail.update(tdt);
    if (this.bossTrail.sampling) {
      if (this._socket('boss', 'weaponBase', a) && this._socket('boss', 'weaponTip', b)) this.bossTrail.addSample(a, b);
    }
    this.bossTrail.update(tdt);

    // 인챈트된 무기(발더 2페이즈)에 불씨를 붙인다
    const boss = state.boss;
    if (boss && boss.ext && boss.ext.enchanted && boss.state !== 'dead' && dt > 0) {
      if (this._socket('boss', 'weaponBase', a) && this._socket('boss', 'weaponTip', b)) {
        const P = this.particles;
        const sc = styleColors(this._bossStyle);
        for (let i = Math.floor(ENCHANT_RATE * dt * P.countScale + rand()); i > 0; i--) {
          const u = rr(0.15, 1);
          const x = lerp(a.x, b.x, u);
          const y = lerp(a.y, b.y, u);
          const z = lerp(a.z, b.z, u);
          if (rand() < 0.6) P.emit(PK.flame, x, y, z, rr(-0.3, 0.3), rr(0.5, 1.6), rr(-0.3, 0.3), rand() < 0.3 ? sc.core : sc.glow, 0.42, 0.6);
          else P.emit(PK.ember, x, y, z, rr(-0.8, 0.8), rr(0.5, 2), rr(-0.8, 0.8), sc.core, 0.9, 0.6);
        }
      }
    }
  }

  /** 록온 고리 · 그로기 표식 · danger 섬광의 위치. @param {GameState} state @param {number} dt */
  _updateMarkers(state, dt) {
    const boss = state.boss;
    const alive = !!boss && state.mode === 'boss' && boss.state !== 'dead';
    if (alive && state.player.lockOn) this.markers.setLockOn(true, this._bossPoint('chest', CHEST_FRAC, this._v0));
    else this.markers.setLockOn(false);
    if (alive && boss.state === 'groggy') {
      const v = this._bossPoint('head', HEAD_FRAC, this._v0);
      this.markers.setGroggy(true, v.setY(v.y + MARK_ABOVE_HEAD), !!state.player.canExecute);
    } else {
      this.markers.setGroggy(false);
    }
    if (this.markers.dangerActive && alive) {
      const v = this._bossPoint('head', HEAD_FRAC, this._v0);
      this.markers.setDangerPos(v.setY(v.y + DANGER_ABOVE_HEAD));
    }
    this.markers.update(dt);
  }

  /** 테마별 분위기 입자(불씨 · 눈 · 심연 먼지) + 마을 화톳불의 불씨. @param {GameState} state @param {number} dt */
  _updateAmbient(state, dt) {
    const cfg = AMBIENT[this._theme] ?? AMBIENT.town;
    const P = this.particles;
    const k = cfg.kind;
    const phase2 = state.boss && state.boss.phase === 2;
    const target = P.budget * cfg.share * (phase2 ? 1.6 : 1);
    const life = (k.life0 + k.life1) / 2;
    let n;
    if (this._prewarm) {
      // 전환 직후 빈 하늘로 시작하지 않게 나이를 흩뜨려 채운다
      this._prewarm = false;
      n = -Math.floor(target);
    } else {
      n = Math.floor((target / life) * dt + rand());
    }
    const warm = n < 0;
    const sc = styleColors(this._bossStyle);
    for (let i = Math.abs(n); i > 0; i--) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * AMBIENT_RADIUS;
      const x = this._px + Math.sin(a) * r;
      const z = this._pz + Math.cos(a) * r;
      if (x * x + z * z > (this._worldRadius + 3) * (this._worldRadius + 3)) continue;
      let color;
      if (this._theme === 'frost') color = COL.snowflake;
      else if (this._theme === 'void') color = rand() < 0.3 ? sc.core : styleColors('void').glow;
      else color = phase2 && rand() < 0.5 ? sc.core : COL.ember;
      const idx = P.emit(k, x, rr(cfg.y0, cfg.y1), z,
        cfg.windX + rr(-1, 1) * cfg.drift, rr(cfg.vy0, cfg.vy1), cfg.windZ + rr(-1, 1) * cfg.drift, color);
      if (warm) P.preAge(k, idx, rand() * 0.9);
    }
    const bf = this._bonfire;
    if (bf && dt > 0) {
      for (let i = Math.floor(BONFIRE_EMBER_RATE * dt * P.countScale + rand()); i > 0; i--) {
        P.emit(PK.ember, bf.x + rr(-0.35, 0.35), rr(0.4, 1.1), bf.z + rr(-0.35, 0.35), rr(-0.35, 0.35), rr(0.9, 2.2), rr(-0.35, 0.35), rand() < 0.3 ? COL.spark : COL.ember, 0.7, 1.2);
      }
    }
  }
}
