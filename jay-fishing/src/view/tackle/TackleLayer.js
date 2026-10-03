// OWNER: P6 — 계약 §6.9 · §9.7 · §9.10
// 1인칭 채비. 카메라 자식 viewModel: 오른손 + 로드(마디 사슬 — 휨) + 릴 + 왼손(뜰채 때만).
// 월드(tackleRoot): 라인 · 찌 · 봉돌 · aimPreview 고리 · 뜰채 · 부러진 로드 끝.
// 상태를 읽기만 한다. 단계 전환은 이벤트를 받아도, 이벤트를 놓쳐도(상태가 바뀌면) 같은 모양이 된다(§9.1).
// 휨은 보이는 값만 sqrt(tension / rodMaxLoadKg) — 판정은 sim 그대로(§9.7 · §9.10: 게이지 · 휨 · 라인 톤이 같은 tension).

import * as THREE from 'three';
import { EV } from '../../core/events.js';
import { angleDiff, clamp, clamp01, damp, fwdX, fwdZ, lerp, smoothstep } from '../../core/math.js';
import { SIGNAL } from '../../data/bite.js';
import { GEAR_BY_ID } from '../../data/gear.js';
import { SPOTS_BY_ID } from '../../data/stages/index.js';
import { LEFT_HAND_CAM, NET_HOOP_R, netPose, fishPoint } from './netPose.js';

// ── 연출 상수(§9.7 의 값은 계약 그대로)

const DEG = Math.PI / 180;
const HANDLE_CAM = new THREE.Vector3(0.26, -0.30, -0.42);   // 로드 손잡이 = 카메라 공간(§9.7)
const POSE = { ready: 35, chargeFrom: 35, chargeTo: 110, swingFrom: 110, swingTo: 20, swingTime: 0.18, settle: 25, settleTime: 0.2,
  waitFloat: 25, waitBottom: 30, fightLow: 15, fightHigh: 75, landing: 60 };
const ROD_YAW_FOLLOW = 0.6;               // 파이팅: 로드가 물고기 방향으로 60%
const ROD_YAW_MAX = 1.0;
const BEND_ROLL = -0.75;                  // 휨 평면을 화면 안쪽(왼쪽)으로 돌린다 — 1인칭에서 휨이 깊이 방향으로만 숨지 않게
const LIFT_LEAN = -0.2;                   // 로드를 세울수록 오른쪽으로 눕힌다(세운 로드의 휨이 화면에 남는다)
const LIFT_VIEW_SLOPE = 0.6;   // 화면 패스: 파이팅의 보이는 각 = 15 + (각 − 15) × 이 값(75° → 51°) — 세운 로드의 휨이 화면 안에 남는다
const LIFT_ROLL = 0.35;       // 화면 패스: 세울수록 로드 윗부분을 화면 가운데 쪽으로 기울인다(rad · 카메라 앞 축)
const BEND_MAX = 1.1;                     // clamp(sqrt(tension / rodMaxLoadKg), 0, 1.1)
const BEND_TIP_RAD = 70 * DEG;            // 휨 1 → 끝 곡률 70°
const IDLE_BEND = 0.035;                  // 채비 무게로 살짝
const SMALL_FISH_F = 0.5;                 // k.Fmax < 0.5 → 상시 잔떨림
const SMALL_TREMBLE = 0.004;
const SMALL_TREMBLE_HZ = 12;
const STRESS_TREMBLE = [0.01, 0.03];
const STRESS_HZ = 17;
const STRESS_AT = 0.85;
const BOTTOM_NIBBLE_AMP = 0.02;           // 초리 떨림 ±0.02rad × strength · 18Hz
const BOTTOM_NIBBLE_HZ = 18;
const BOTTOM_TAKE_BOW = 15 * DEG;         // 본신 = 끝이 15° 숙여진다
const SHAKE_KICK = 0.05;                  // FIGHT_SHAKE strength 1 → 0.05rad 덜컹
const POSE_LAMBDA = 14;
const BEND_LAMBDA = 18;
const SEGMENTS = 12;
const BEND_EXP = 1.3;                     // 곡률 분포(끝으로 갈수록 크게 — 로드를 세웠을 때도 화면 안의 중간 마디가 휜다)
const BEND_W = (() => {
  const w = [];
  let sum = 0;
  for (let i = 0; i < SEGMENTS; i++) { w.push(Math.pow(i + 1, BEND_EXP)); sum += w[i]; }
  return w.map(v => v / sum);
})();
const GRIP_BACK = 0.24;                   // 손 뒤로 나온 손잡이(m)
const GRIP_FRONT = 0.16;                  // 손 앞의 손잡이 · 릴 시트
const R_BUTT = 0.0105;
const R_TIP = 0.0022;
const FLOAT_BODY = 0.10;                  // 찌 몸통(§9.7)
const FLOAT_ANT = 0.30;                   // 안테나
const FLOAT_SCALE_REF = 7;                // scale = clamp(dist / 7, 1, 18)
const FLOAT_SCALE_MAX = 18;
const FLOAT_HANG = 0.55;                  // ready 에서 로드 끝 아래로 매달린 길이
const NIBBLE_DUR = SIGNAL.float.nibbleDur;
const LIFT_RISE = 0.12;
const LIFT_TIME = 0.15;
const LIE_TIME = 0.2;
const SINK_TIME = 0.12;
const SAG_WAIT = 0.08;                    // 라인 늘어짐 0.08 × dist
const SAG_FIGHT = 0.15;                   // 0.15 × dist × (1 − clamp(tensionRatio × 4, 0, 1))
const SAG_CAST = 0.03;
const CAST_APEX = 0.25;                   // 포물선 꼭대기 = 0.25 × distM
const LINE_POINTS = 48;
const LINE_WATER_Y = 0.004;               // 늘어진 줄이 눕는 높이(수면 바로 위)
const RING_R = 0.6;                       // aimPreview 고리 반경(§9.7) — 7m 너머는 찌와 같은 규칙으로 키운다(중심은 정확히 aimPreview)
const RING_Y = 0.02;
const PIN_H = 0.45;                       // 고리 중심의 세로 표식(낮은 시선각에서 납작해지는 고리를 보완)
const REEL_M_PER_TURN = 0.7;              // 손잡이 한 바퀴에 감기는 라인(연출)
const RAISE_TIME = 0.3;                   // 로드 꺼내기 · 예비 로드 올라오기(§9.7)
const RAISE_DROP = 0.6;
const SWAP_DROP = 0.35;
const BREAK_FRAC = 1 / 3;                 // 끝 1/3 이 꺾여 떨어진다
const BREAK_LIFE = 1.4;
const GRAVITY = 9.8;
const NIGHT_GLOW = new THREE.Color('#8dff3a');
const DAY_TOP = new THREE.Color('#ff5a14');
const RING_WHITE = new THREE.Color('#ffffff');
const RING_PERFECT = new THREE.Color('#ffe03a');
/** 착수점이 장애물 띠 안(dist ≥ spot.snag.fromM) — 완벽보다 앞선다(HUD 「장애물 띠」와 같은 판정) */
const RING_SNAG = new THREE.Color('#ff4a3a');
const HOOKSET_KICK = 14 * DEG;            // 챔질: 로드가 확 선다(0.25초에 풀린다)
const HOOKSET_TIME = 0.25;
const LINE_COLOR = '#f1efe2';
const SKIN = '#d6a27c';
const SLEEVE = '#34404e';

/** 단계별 로드 · 릴 재질(§9.7: 1단계 무광 회녹색 · 2단계 카본 검정 + 붉은 감기 · 3단계 광택 검정 + 금색 감기) */
const TIER_LOOK = {
  1: { blank: '#5d6b58', blankR: 0.78, blankM: 0.05, wrap: '#2f3a2c', wrapM: 0.1, grip: '#b08655', reel: '#6c7276', accent: '#3a4438' },
  2: { blank: '#17191c', blankR: 0.38, blankM: 0.35, wrap: '#b4161c', wrapM: 0.25, grip: '#202224', reel: '#2a2e33', accent: '#b4161c' },
  3: { blank: '#0a0a0c', blankR: 0.12, blankM: 0.55, wrap: '#d6a62a', wrapM: 0.85, grip: '#3a2c20', reel: '#141416', accent: '#d6a62a' },
};

const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;

// ── 순수 도우미(테스트가 쓴다)

/** 찌의 보이는 배율 = clamp(dist / 7, 1, 18) @param {number} distM */
export function floatScale(distM) {
  return clamp((Number.isFinite(distM) ? distM : 0) / FLOAT_SCALE_REF, 1, FLOAT_SCALE_MAX);
}

/** 로드 휨 0..1.1 = clamp(sqrt(tension / rodMaxLoadKg)) @param {number} tensionKg @param {number} rodMaxLoadKg */
export function rodBend(tensionKg, rodMaxLoadKg) {
  if (!(rodMaxLoadKg > 0) || !Number.isFinite(tensionKg)) return 0;
  return clamp(Math.sqrt(Math.max(0, tensionKg) / rodMaxLoadKg), 0, BEND_MAX);
}

/**
 * 찌 신호의 높이 오프셋(보이는 배율 적용 전 m)과 눕기(0..1) — §9.7
 * @param {{kind:string, t:number, strength:number, takeStyle:string}} sig @param {{y:number, lie:number}} out
 */
export function floatSignalOffset(sig, out) {
  out.y = 0;
  out.lie = 0;
  if (!sig) return out;
  const t = Math.max(0, sig.t || 0);
  if (sig.kind === 'nibble') {
    const x = t / NIBBLE_DUR;
    if (x < 1) {
      const env = x < 0.25 ? smoothstep(0, 0.25, x) : x < 0.7 ? 1 : 1 - smoothstep(0.7, 1, x);
      out.y = -clamp01(sig.strength) * 0.5 * FLOAT_ANT * env;
    }
  } else if (sig.kind === 'take') {
    if (sig.takeStyle === 'lift') {
      const rise = smoothstep(0, LIFT_TIME, t);
      const lie = smoothstep(LIFT_TIME, LIFT_TIME + LIE_TIME, t);
      out.y = LIFT_RISE * rise * (1 - lie) + 0.02 * lie;
      out.lie = lie;
    } else {
      out.y = -(FLOAT_ANT + 0.06) * smoothstep(0, SINK_TIME, t);
    }
  }
  return out;
}

/** 단계 → 로드 각(°, 수평 위) — 파이팅은 rodLift, 충전은 power, 캐스팅은 phaseTime @param {Object} state */
export function rodAngleDeg(state) {
  const r = state.rig;
  switch (r.phase) {
    case 'charging': return POSE.chargeFrom + (POSE.chargeTo - POSE.chargeFrom) * easeInOutSine(r.power);
    case 'casting': {
      const t = r.phaseTime;
      if (t < POSE.swingTime) return lerp(POSE.swingFrom, POSE.swingTo, easeOutCubic(t / POSE.swingTime));
      return lerp(POSE.swingTo, POSE.settle, smoothstep(0, POSE.settleTime, t - POSE.swingTime));
    }
    case 'waiting': case 'retrieving': case 'bite': return r.set === 'float' ? POSE.waitFloat : POSE.waitBottom;
    case 'fighting': return state.fight ? lerp(POSE.fightLow, POSE.fightHigh, clamp01(state.fight.rodLift)) : POSE.waitFloat;
    case 'landing': return POSE.landing;
    default: return POSE.ready;
  }
}

/**
 * 화면에 그리는 로드 각(°) — 판정 · 의미는 rodAngleDeg(계약 §9.7) 그대로이고, 파이팅 중 세운 로드만 화면 안으로 눕혀 그린다.
 * 화면 패스: 75° 로 세운 로드는 손잡이(카메라 0.42m 앞)에서 화면 위로 나가 휨 · 떨림이 보이지 않았다(펌핑 = 로드 파손 위험의 순간).
 * @param {Object} state @returns {number}
 */
export function presentAngleDeg(state) {
  const a = rodAngleDeg(state);
  if (state.rig.phase !== 'fighting' || a <= POSE.fightLow) return a;
  return POSE.fightLow + (a - POSE.fightLow) * LIFT_VIEW_SLOPE;
}

// ── 지오메트리 도우미

/** 축이 −Z 이고 [−1, 0] 을 차지하는 단위 원기둥 @param {number} r0 뒤 @param {number} r1 앞 @param {number} sides */
function unitCylZ(r0, r1, sides) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, sides, 1, false);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.5);
  return g;
}

/** 축이 +Z 이고 [0, 1] 을 차지하는 단위 원기둥 @param {number} r @param {number} sides */
function unitCylPlusZ(r, sides) {
  const g = new THREE.CylinderGeometry(r, r, 1, sides, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/** 그물 무늬(알파) DataTexture */
function netTexture() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const on = i % 8 < 1 || j % 8 < 1;
      const o = (j * n + i) * 4;
      data[o] = 40; data[o + 1] = 52; data[o + 2] = 40; data[o + 3] = on ? 235 : 0;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.5);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class TackleLayer {
  /** @param {{rc:import('../renderer.js').RenderContext, bus:Object, settings:Object, world:Object}} deps */
  constructor({ rc, bus, settings, world }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.world = world;
    this.time = 0;

    /** @type {THREE.Material[]} */ this._mats = [];
    /** @type {THREE.BufferGeometry[]} */ this._geos = [];
    /** @type {THREE.Texture[]} */ this._texs = [];

    this.root = new THREE.Group();
    this.root.name = 'tackleRoot';
    rc.scene.add(this.root);
    this.viewModel = new THREE.Group();
    this.viewModel.name = 'viewModel';
    this.viewModel.visible = false;
    rc.camera.add(this.viewModel);

    this._buildTierMaterials();
    this._buildRod();
    this._buildRightHand();
    this._buildLeftHand();
    this._buildFloat();
    this._buildSinker();
    this._buildLine();
    this._buildRing();
    this._buildNet();
    this._buildBrokenPiece();

    // 뷰 쪽 기억(상태 객체에는 붙이지 않는다)
    this._shown = false;
    this._raiseT = RAISE_TIME;
    this._raiseFrom = 0;
    this._lowering = false;
    this._lowerT = 0;
    this._set = /** @type {string|null} */ (null);
    this._rodId = /** @type {string|null} */ (null);
    this._tier = 1;
    this._rodLen = 3.6;
    this._phase = 'idle';
    this._angle = POSE.ready * DEG;
    this._liftShown = 0;
    this._yaw = 0;
    this._bend = 0;
    this._shakeT = 99;
    this._shakeAmp = 0;
    this._jerkT = 99;
    this._broken = false;
    this._brokeThisFail = false;
    this._pieceT = 99;
    this._handleAngle = 0;
    this._spoolAngle = 0;
    this._bailAngle = 0;
    this._sig = { y: 0, lie: 0 };
    this._v = { tip: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion() };
    this._pose = { hand: new THREE.Vector3(), dir: new THREE.Vector3(), hoop: new THREE.Vector3(), target: new THREE.Vector3(), handleLen: 1, reach: 1, p: 0 };
    this._pieceVel = new THREE.Vector3();
    this._pieceSpin = new THREE.Vector3();

    const on = (name, fn) => (bus && typeof bus.on === 'function' ? bus.on(name, fn) : () => {});
    this._offs = [
      on(EV.SCENE_CHANGED, () => this._reset()),
      on(EV.FISHING_ENTER, () => this._startRaise(RAISE_DROP)),
      on(EV.FISHING_EXIT, () => this._startLower()),
      on(EV.SET_CHANGED, () => this._startRaise(SWAP_DROP)),
      on(EV.HOOK_SET, () => { this._jerkT = 0; }),
      on(EV.FIGHT_SHAKE, (p) => this._kick(p && Number.isFinite(p.strength) ? p.strength : 0.5)),
      on(EV.FIGHT_END, (p) => { if (p && p.outcome === 'rodBreak') this._breakRod(true); }),
      on(EV.RIG_RESTORED, (p) => { if (this._broken || (p && p.rodReplaced)) this._restoreRod(); }),
    ];
  }

  // ── 만들기

  _track(x) {
    if (x instanceof THREE.Material) this._mats.push(x);
    else if (x instanceof THREE.BufferGeometry) this._geos.push(x);
    else if (x instanceof THREE.Texture) this._texs.push(x);
    return x;
  }

  _std(color, rough = 0.6, metal = 0, extra = {}) {
    return this._track(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }));
  }

  _buildTierMaterials() {
    /** @type {Record<number, {blank:THREE.Material, wrap:THREE.Material, grip:THREE.Material, reel:THREE.Material, accent:THREE.Material}>} */
    this._tierMats = {};
    for (const tier of [1, 2, 3]) {
      const L = TIER_LOOK[tier];
      this._tierMats[tier] = {
        blank: this._std(L.blank, L.blankR, L.blankM),
        wrap: this._std(L.wrap, 0.4, L.wrapM),
        grip: this._std(L.grip, 0.85, 0),
        reel: this._std(L.reel, 0.45, 0.4),
        accent: this._std(L.accent, 0.35, tier === 3 ? 0.85 : 0.3),
      };
    }
    this._metal = this._std('#b9bec4', 0.3, 0.9);
    this._dark = this._std('#1c1d1f', 0.6, 0.2);
    this._skin = this._std(SKIN, 0.7, 0);
    this._sleeve = this._std(SLEEVE, 0.9, 0);
    this._lineMat = this._track(new THREE.LineBasicMaterial({ color: LINE_COLOR, transparent: true, opacity: 0.9 }));
  }

  _buildRod() {
    const rigRoot = new THREE.Group();
    rigRoot.name = 'rodRig';
    rigRoot.position.copy(HANDLE_CAM);
    this.viewModel.add(rigRoot);
    const yawNode = new THREE.Group();
    rigRoot.add(yawNode);
    const pitchNode = new THREE.Group();
    pitchNode.rotation.order = 'YXZ';
    yawNode.add(pitchNode);
    this._rigRoot = rigRoot;
    this._yawNode = yawNode;
    this._pitchNode = pitchNode;

    // 손잡이 · 릴 시트 · 끝마개
    const grip = new THREE.Mesh(this._track(unitCylZ(0.0165, 0.0145, 10)), this._tierMats[1].grip);
    grip.position.z = GRIP_BACK;
    grip.scale.z = GRIP_BACK + GRIP_FRONT;
    pitchNode.add(grip);
    const cap = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.018, 10, 6)), this._dark);
    cap.position.z = GRIP_BACK;
    cap.scale.set(1, 1, 0.6);
    pitchNode.add(cap);
    const seat = new THREE.Mesh(this._track(unitCylZ(0.0135, 0.0135, 10)), this._metal);
    seat.position.z = 0.07;
    seat.scale.z = 0.1;
    pitchNode.add(seat);
    this._grip = grip;

    // 블랭크 마디 사슬
    this._segNodes = [];
    this._segMeshes = [];
    this._wraps = [];
    const guideGeo = this._track(new THREE.TorusGeometry(1, 0.12, 5, 12));
    const wrapGeo = this._track(unitCylZ(1, 1, 8));
    let parent = pitchNode;
    for (let i = 0; i < SEGMENTS; i++) {
      const node = new THREE.Group();
      node.name = `rodSeg${i}`;
      parent.add(node);
      if (i === 0) {
        node.rotation.order = 'ZXY';
        node.rotation.z = BEND_ROLL;
      }
      const r0 = lerp(R_BUTT, R_TIP, i / SEGMENTS);
      const r1 = lerp(R_BUTT, R_TIP, (i + 1) / SEGMENTS);
      const mesh = new THREE.Mesh(this._track(unitCylZ(r0, r1, 7)), this._tierMats[1].blank);
      node.add(mesh);
      this._segNodes.push(node);
      this._segMeshes.push(mesh);
      if (i % 2 === 1 || i === SEGMENTS - 1) {
        // 가이드(아래쪽 고리) + 감기
        const gr = Math.max(0.0045, r1 * 1.6 + 0.003);
        const guide = new THREE.Mesh(guideGeo, this._metal);
        guide.scale.setScalar(gr);
        guide.userData.offset = -(r1 + gr + 0.002);
        node.add(guide);
        const wrap = new THREE.Mesh(wrapGeo, this._tierMats[1].wrap);
        wrap.scale.set(r1 * 1.25, r1 * 1.25, 0.018);
        node.add(wrap);
        this._wraps.push({ guide, wrap });
      } else {
        this._wraps.push(null);
      }
      parent = node;
    }
    // 부러진 자리의 쪼개진 끝(파손 때만 — 잘린 마디 바로 앞 마디에 붙인다)
    const cutIdx = Math.floor(SEGMENTS * (1 - BREAK_FRAC));
    const splinter = new THREE.Mesh(this._track(new THREE.ConeGeometry(0.008, 0.05, 5)), this._std('#d9cfa8', 0.9, 0));
    splinter.rotation.x = -Math.PI / 2;
    splinter.visible = false;
    this._segNodes[cutIdx - 1].add(splinter);
    this._splinter = splinter;
    // 끝(라인이 나오는 점)과 방울(바닥 채비)
    const tip = new THREE.Group();
    tip.name = 'rodTip';
    parent.add(tip);
    this._tip = tip;
    const bellGroup = new THREE.Group();
    tip.add(bellGroup);
    const bell = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.016, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62)), this._std('#e0b440', 0.25, 0.9));
    bell.rotation.x = Math.PI;
    bell.position.y = -0.028;
    bellGroup.add(bell);
    const clip = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.002, 0.002, 0.025, 4)), this._metal);
    clip.position.y = -0.012;
    bellGroup.add(clip);
    this._bell = bellGroup;

    // 릴(스피닝 릴 — 로드 아래)
    const reel = new THREE.Group();
    reel.name = 'reel';
    reel.position.set(0, -0.014, 0.02);
    pitchNode.add(reel);
    const stem = new THREE.Mesh(this._track(new THREE.BoxGeometry(0.009, 0.06, 0.016)), this._tierMats[1].reel);
    stem.position.set(0, -0.032, 0);
    reel.add(stem);
    const body = new THREE.Mesh(this._track(unitCylZ(0.026, 0.022, 14)), this._tierMats[1].reel);
    body.position.set(0, -0.078, 0.035);
    body.scale.z = 0.06;
    reel.add(body);
    const spoolPivot = new THREE.Group();
    spoolPivot.position.set(0, -0.078, -0.025);
    reel.add(spoolPivot);
    const spool = new THREE.Mesh(this._track(unitCylZ(0.03, 0.03, 16)), this._metal);
    spool.scale.z = 0.026;
    spoolPivot.add(spool);
    const lineBand = new THREE.Mesh(this._track(unitCylZ(0.0315, 0.0315, 16)), this._std('#dfe3d0', 0.5, 0));
    lineBand.position.z = -0.004;
    lineBand.scale.z = 0.018;
    spoolPivot.add(lineBand);
    const lip = new THREE.Mesh(this._track(new THREE.BoxGeometry(0.004, 0.012, 0.006)), this._tierMats[1].accent);
    lip.position.set(0.03, 0, -0.013);
    spoolPivot.add(lip);
    this._spoolPivot = spoolPivot;
    const bailPivot = new THREE.Group();
    bailPivot.position.set(0, -0.078, -0.028);
    reel.add(bailPivot);
    const bail = new THREE.Mesh(this._track(new THREE.TorusGeometry(0.036, 0.0022, 4, 14, Math.PI)), this._metal);
    bail.rotation.y = Math.PI / 2;
    bailPivot.add(bail);
    this._bailPivot = bailPivot;
    const handlePivot = new THREE.Group();
    handlePivot.position.set(-0.03, -0.078, 0.04);
    reel.add(handlePivot);
    const arm = new THREE.Mesh(this._track(new THREE.BoxGeometry(0.004, 0.055, 0.008)), this._tierMats[1].reel);
    arm.position.set(-0.004, -0.026, 0);
    handlePivot.add(arm);
    const knob = new THREE.Mesh(this._track(new THREE.CylinderGeometry(0.007, 0.007, 0.022, 10)), this._tierMats[1].accent);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(-0.016, -0.052, 0);
    handlePivot.add(knob);
    this._handlePivot = handlePivot;
    this._reelParts = { stem, body, arm, lip, knob };
  }

  /** 손(벙어리장갑 꼴 손바닥 + 손가락 넷 + 엄지) @param {number} side 1 오른손 · −1 왼손 */
  _hand(side) {
    const g = new THREE.Group();
    const palm = new THREE.Mesh(this._track(new THREE.SphereGeometry(1, 12, 8)), this._skin);
    palm.scale.set(0.034, 0.03, 0.05);
    palm.position.set(side * 0.022, -0.012, 0.012);
    g.add(palm);
    const fingerGeo = this._track(new THREE.CapsuleGeometry(0.0085, 0.03, 3, 6));
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(fingerGeo, this._skin);
      f.position.set(-side * 0.004, -0.028, -0.026 + i * 0.019);
      f.rotation.z = side * 1.2;
      g.add(f);
    }
    const thumb = new THREE.Mesh(fingerGeo, this._skin);
    thumb.position.set(side * 0.006, 0.018, -0.006);
    thumb.rotation.set(-1.2, 0, side * 0.4);
    g.add(thumb);
    const cuff = new THREE.Mesh(this._track(unitCylPlusZ(0.042, 10)), this._sleeve);
    cuff.position.set(side * 0.03, -0.02, 0.05);
    cuff.scale.z = 0.5;
    cuff.rotation.set(0.35, side * 0.42, 0);
    g.add(cuff);
    return g;
  }

  _buildRightHand() {
    const h = this._hand(1);
    h.name = 'rightHand';
    h.position.set(0, 0, 0.03);
    this._pitchNode.add(h);
  }

  _buildLeftHand() {
    const h = this._hand(-1);
    h.name = 'leftHand';
    h.visible = false;
    this.viewModel.add(h);
    this._leftHand = h;
  }

  _buildFloat() {
    const g = new THREE.Group();
    g.name = 'float';
    const inner = new THREE.Group();
    g.add(inner);
    // 몸통: 아래 흰색 · 위 빨강(물속) — 원점 = 물높이
    const lower = this._track(new THREE.LatheGeometry([
      new THREE.Vector2(0.001, -FLOAT_BODY), new THREE.Vector2(0.012, -0.085), new THREE.Vector2(0.021, -0.055), new THREE.Vector2(0.022, -0.045),
    ], 12));
    const upper = this._track(new THREE.LatheGeometry([
      new THREE.Vector2(0.022, -0.045), new THREE.Vector2(0.02, -0.025), new THREE.Vector2(0.012, -0.008), new THREE.Vector2(0.006, 0),
    ], 12));
    inner.add(new THREE.Mesh(lower, this._std('#f2f0ea', 0.4, 0)));
    inner.add(new THREE.Mesh(upper, this._std('#d8261c', 0.35, 0)));
    // 안테나 3띠(노랑 · 주황 · 꼭대기 1/3 — 밤에 연두 발광)
    const antGeo = this._track(new THREE.CylinderGeometry(0.0135, 0.0135, FLOAT_ANT / 3, 8));
    const yellow = this._std('#ffd21a', 0.4, 0, { emissive: new THREE.Color('#ffd21a'), emissiveIntensity: 0.18 });
    const orange = this._std('#ff6a10', 0.4, 0, { emissive: new THREE.Color('#ff6a10'), emissiveIntensity: 0.18 });
    this._glowMat = this._std('#ff5a14', 0.4, 0, { emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 0.2 });
    const mats = [yellow, orange, this._glowMat];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(antGeo, mats[i]);
      m.position.y = (i + 0.5) * (FLOAT_ANT / 3);
      inner.add(m);
    }
    const top = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.017, 10, 8)), this._glowMat);
    top.position.y = FLOAT_ANT;
    inner.add(top);
    g.visible = false;
    this.root.add(g);
    this._float = g;
    this._floatInner = inner;
  }

  _buildSinker() {
    const g = new THREE.Group();
    g.name = 'sinker';
    const lead = new THREE.Mesh(this._track(new THREE.SphereGeometry(0.018, 10, 8)), this._std('#55595e', 0.45, 0.7));
    lead.scale.set(1, 1.5, 1);
    lead.position.y = -0.03;
    g.add(lead);
    const hook = new THREE.Mesh(this._track(new THREE.TorusGeometry(0.012, 0.0018, 4, 10, Math.PI * 1.3)), this._metal);
    hook.position.set(0, -0.09, 0);
    g.add(hook);
    const bait = new THREE.Mesh(this._track(new THREE.CapsuleGeometry(0.006, 0.02, 2, 6)), this._std('#a8584a', 0.8, 0));
    bait.position.set(0.01, -0.094, 0);
    bait.rotation.z = 0.8;
    g.add(bait);
    g.visible = false;
    this.root.add(g);
    this._sinker = g;
  }

  _buildLine() {
    const pos = new Float32Array(LINE_POINTS * 3);
    const geo = this._track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setDrawRange(0, LINE_POINTS);
    const line = new THREE.Line(geo, this._lineMat);
    line.name = 'fishingLine';
    line.frustumCulled = false;
    line.visible = false;
    this.root.add(line);
    this._line = line;
    this._linePos = pos;
  }

  _buildRing() {
    const g = new THREE.Group();
    g.name = 'aimPreview';
    const ringGeo = this._track(new THREE.RingGeometry(RING_R - 0.16, RING_R, 48));
    ringGeo.rotateX(-Math.PI / 2);
    this._ringMat = this._track(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false, depthTest: false }));
    const ring = new THREE.Mesh(ringGeo, this._ringMat);
    ring.renderOrder = 10;
    g.add(ring);
    const dotGeo = this._track(new THREE.CircleGeometry(0.09, 16));
    dotGeo.rotateX(-Math.PI / 2);
    const dot = new THREE.Mesh(dotGeo, this._ringMat);
    dot.renderOrder = 10;
    g.add(dot);
    const pinGeo = this._track(new THREE.CylinderGeometry(0.026, 0.026, PIN_H, 6));
    pinGeo.translate(0, PIN_H / 2, 0);
    const pin = new THREE.Mesh(pinGeo, this._ringMat);
    pin.renderOrder = 10;
    g.add(pin);
    const headGeo = this._track(new THREE.OctahedronGeometry(0.07, 0));
    headGeo.translate(0, PIN_H + 0.05, 0);
    const head = new THREE.Mesh(headGeo, this._ringMat);
    head.renderOrder = 10;
    g.add(head);
    g.visible = false;
    this.root.add(g);
    this._ring = g;
  }

  _buildNet() {
    const g = new THREE.Group();
    g.name = 'landingNet';
    const pole = new THREE.Mesh(this._track(unitCylPlusZ(0.012, 8)), this._std('#8d949b', 0.35, 0.8));
    g.add(pole);
    const hoopG = new THREE.Group();
    g.add(hoopG);
    const hoop = new THREE.Mesh(this._track(new THREE.TorusGeometry(NET_HOOP_R, 0.009, 6, 32)), this._std('#30353a', 0.4, 0.6));
    hoop.rotation.x = Math.PI / 2;
    hoopG.add(hoop);
    const tex = this._track(netTexture());
    const bagMat = this._track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 }));
    const bag = new THREE.Mesh(this._track(new THREE.CylinderGeometry(NET_HOOP_R * 0.97, 0.07, 0.42, 16, 3, true)), bagMat);
    bag.position.y = -0.21;
    hoopG.add(bag);
    g.visible = false;
    this.root.add(g);
    this._net = g;
    this._netPole = pole;
    this._netHoop = hoopG;
  }

  _buildBrokenPiece() {
    const m = new THREE.Mesh(this._track(unitCylZ(0.006, R_TIP, 7)), this._tierMats[1].blank);
    m.name = 'brokenTip';
    m.visible = false;
    this.root.add(m);
    this._piece = m;
  }

  // ── 이벤트 반응(상태로도 같은 전환을 한다)

  _reset() {
    this._shown = false;
    this._lowering = false;
    this.viewModel.visible = false;
    this._broken = false;
    this._brokeThisFail = false;
    this._pieceT = 99;
    this._piece.visible = false;
    this._shakeT = 99;
    this._phase = 'idle';
    this._setSegmentsVisible(true);
  }

  _startRaise(drop) {
    this._raiseT = 0;
    this._raiseFrom = drop;
    this._lowering = false;
  }

  _startLower() {
    if (!this._shown) return;
    this._lowering = true;
    this._lowerT = 0;
  }

  _kick(strength) {
    this._shakeT = 0;
    this._shakeAmp = SHAKE_KICK * clamp01(strength / 0.6 + 0.2);
  }

  _setSegmentsVisible(on) {
    const cut = Math.floor(SEGMENTS * (1 - BREAK_FRAC));
    this._segNodes[cut].visible = on;
    this._splinter.visible = !on;
  }

  /** @param {boolean} launch 끝 조각을 날린다(이벤트) · false 면 이미 부러진 모양만(고정 상태 · 이벤트 누락) */
  _breakRod(launch) {
    if (this._broken) return;
    this._broken = true;
    this._brokeThisFail = true;
    const cut = Math.floor(SEGMENTS * (1 - BREAK_FRAC));
    if (launch && this._shown) {
      // 끝 1/3 이 꺾여 떨어진다(월드 공간 조각)
      this.rc.camera.updateMatrixWorld(true);
      const node = this._segNodes[cut];
      node.updateWorldMatrix(true, false);
      node.getWorldPosition(this._piece.position);
      node.getWorldQuaternion(this._piece.quaternion);
      this._piece.scale.set(1, 1, this._rodLen * BREAK_FRAC);
      this._piece.material = this._tierMats[this._tier].blank;
      this._piece.visible = true;
      this._pieceT = 0;
      const yaw = this.rc.camera.rotation.y;
      this._pieceVel.set(fwdX(yaw) * 1.2, 1.6, fwdZ(yaw) * 1.2);
      this._pieceSpin.set(-4.5, 1.2, 0.8);
    }
    this._setSegmentsVisible(false);
  }

  _restoreRod() {
    if (!this._broken) return;
    this._broken = false;
    this._setSegmentsVisible(true);
    this._startRaise(RAISE_DROP);           // 예비 로드가 아래에서 올라온다(0.3초)
  }

  // ── 로드 모델(세트 · 단계 · 길이)

  /** @param {string} rodId */
  _applyRod(rodId) {
    const g = GEAR_BY_ID[rodId];
    const tier = g && (g.tier === 1 || g.tier === 2 || g.tier === 3) ? g.tier : 1;
    const len = g && g.lengthM > 0 ? g.lengthM : 3.0;
    this._rodId = rodId;
    this._tier = tier;
    this._rodLen = len;
    const M = this._tierMats[tier];
    const segLen = Math.max(0.05, (len - GRIP_FRONT - GRIP_BACK + 0.08) / SEGMENTS);
    for (let i = 0; i < SEGMENTS; i++) {
      const node = this._segNodes[i];
      node.position.z = i === 0 ? -GRIP_FRONT + 0.04 : -segLen;
      const mesh = this._segMeshes[i];
      mesh.scale.z = segLen;
      mesh.material = M.blank;
      const w = this._wraps[i];
      if (w) {
        w.wrap.material = M.wrap;
        w.wrap.position.z = -segLen * 0.98;
        w.guide.position.set(0, w.guide.userData.offset, -segLen * 0.98);
      }
    }
    this._tip.position.z = -segLen;
    this._splinter.position.set(0, 0, -segLen - 0.02);
    this._grip.material = M.grip;
    const P = this._reelParts;
    P.stem.material = M.reel;
    P.body.material = M.reel;
    P.arm.material = M.reel;
    P.lip.material = M.accent;
    P.knob.material = M.accent;
  }

  // ── 매 프레임

  /** @param {Object} state @param {number} alpha @param {number} dt */
  update(state, alpha, dt) {
    if (!state || !state.rig || !state.player) return;
    const fdt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    this.time += fdt;
    const rig = state.rig;
    const fight = state.fight;
    const phase = rig.phase;
    const active = state.player.mode === 'fish' && phase !== 'idle';

    // 보이기 · 숨기기(이벤트를 놓쳐도)
    if (active && (!this._shown || this._lowering)) {
      if (!this._shown) this._startRaise(RAISE_DROP);
      this._shown = true;
      this._lowering = false;
    } else if (!active && this._shown && !this._lowering) {
      this._startLower();
    }
    if (this._lowering) {
      this._lowerT += fdt;
      if (this._lowerT >= RAISE_TIME) {
        this._shown = false;
        this._lowering = false;
      }
    }
    this.viewModel.visible = this._shown;

    // 세트 · 로드 바뀜
    const set = rig.set === 'bottom' ? 'bottom' : 'float';
    const cfg = state.profile && state.profile.sets ? state.profile.sets[set] : null;
    const rodId = cfg ? cfg.rod : `rod_${set}_1`;
    if (this._set !== null && this._set !== set && this._shown && this._raiseT >= RAISE_TIME) this._startRaise(SWAP_DROP);
    this._set = set;
    if (rodId !== this._rodId && !this._broken) this._applyRod(rodId);   // 부러진 동안은 그 로드의 토막을 그대로 — 예비 로드는 복구 때

    // 파손 상태(이벤트 누락 · 고정 상태)
    if (phase === 'failed' && rig.failReason === 'rodBreak') {
      if (!this._broken && !this._brokeThisFail) this._breakRod(false);
    } else {
      this._brokeThisFail = false;
      if (this._broken && phase !== 'failed') this._restoreRod();
    }
    this._phase = phase;

    // 부러진 조각
    if (this._pieceT < BREAK_LIFE) {
      this._pieceT += fdt;
      this._pieceVel.y -= GRAVITY * fdt;
      this._piece.position.addScaledVector(this._pieceVel, fdt);
      this._piece.rotation.x += this._pieceSpin.x * fdt;
      this._piece.rotation.y += this._pieceSpin.y * fdt;
      if (this._pieceT >= BREAK_LIFE) this._piece.visible = false;
    }

    if (!this._shown) {
      this._hideWorld();
      return;
    }

    // 로드 자세
    const cam = this.rc.camera;
    const camYaw = cam.rotation.y;
    const camPitch = cam.rotation.x;
    const targetAngle = presentAngleDeg(state) * DEG;
    if (phase === 'casting') this._angle = targetAngle;
    else this._angle = damp(this._angle, targetAngle, phase === 'charging' ? POSE_LAMBDA * 2.5 : POSE_LAMBDA, fdt);
    let targetYaw = 0;
    if ((phase === 'fighting' || phase === 'landing') && fight) {
      const fb = fight.prevBearing + angleDiff(fight.prevBearing, fight.bearing) * clamp01(alpha);
      targetYaw = clamp(ROD_YAW_FOLLOW * angleDiff(camYaw, fb), -ROD_YAW_MAX, ROD_YAW_MAX);
    }
    this._yaw = damp(this._yaw, targetYaw, POSE_LAMBDA, fdt);

    // 휨
    let bend = IDLE_BEND;
    let tipExtra = 0;
    let tremble = 0;
    let trembleHz = 0;
    if ((phase === 'fighting' || phase === 'landing') && fight) {
      const rodMax = GEAR_BY_ID[rodId] ? GEAR_BY_ID[rodId].maxLoadKg : 0;
      bend = rodMax > 0 ? rodBend(fight.tension, rodMax) : clamp(Math.sqrt(Math.max(0, fight.rodLoadRatio || 0)), 0, BEND_MAX);
      if (phase === 'fighting') {
        if (fight.k && fight.k.Fmax < SMALL_FISH_F) {
          tremble = SMALL_TREMBLE;
          trembleHz = SMALL_TREMBLE_HZ;
        }
        if (fight.rodStress || fight.lineDanger) {
          const over = Math.max(fight.rodUp ? fight.rodLoadRatio || 0 : 0, fight.tensionRatio || 0);
          tremble = lerp(STRESS_TREMBLE[0], STRESS_TREMBLE[1], clamp01((over - STRESS_AT) / (1 - STRESS_AT)));
          trembleHz = STRESS_HZ;
        }
      }
    } else if (phase === 'bite' && set === 'bottom') {
      if (rig.signal.kind === 'take') tipExtra = BOTTOM_TAKE_BOW * smoothstep(0, 0.12, rig.signal.t);
      else if (rig.signal.kind === 'nibble') tipExtra = BOTTOM_NIBBLE_AMP * clamp01(rig.signal.strength) * Math.sin(this.time * Math.PI * 2 * BOTTOM_NIBBLE_HZ);
    } else if (phase === 'casting') {
      bend = IDLE_BEND + 0.25 * (1 - smoothstep(0, POSE.swingTime * 1.5, rig.phaseTime));
    }
    this._bend = damp(this._bend, bend, BEND_LAMBDA, fdt);

    // 떨림 · 덜컹
    let jx = 0;
    let jz = 0;
    if (tremble > 0) {
      const w = this.time * Math.PI * 2 * trembleHz;
      jx += tremble * (Math.sin(w) * 0.7 + Math.sin(w * 1.37 + 1.1) * 0.3);
      jz += tremble * 0.6 * Math.sin(w * 0.83 + 2.3);
    }
    if (this._jerkT < HOOKSET_TIME) {
      this._jerkT += fdt;
      jx += HOOKSET_KICK * Math.sin(Math.PI * clamp01(this._jerkT / HOOKSET_TIME));
    }
    if (this._shakeT < 1) {
      this._shakeT += fdt;
      const e = Math.exp(-8 * this._shakeT);
      jx += this._shakeAmp * e * Math.sin(this._shakeT * Math.PI * 2 * 11);
      jz += this._shakeAmp * 0.5 * e * Math.sin(this._shakeT * Math.PI * 2 * 7);
    }

    // 꺼내기 · 바꾸기 · 넣기 애니메이션
    let drop = 0;
    if (this._raiseT < RAISE_TIME) {
      this._raiseT += fdt;
      drop = this._raiseFrom * (1 - easeOutCubic(this._raiseT / RAISE_TIME));
    }
    if (this._lowering) drop = RAISE_DROP * smoothstep(0, RAISE_TIME, this._lowerT);

    this._rigRoot.position.set(HANDLE_CAM.x, HANDLE_CAM.y - drop, HANDLE_CAM.z);
    const lift = phase === 'fighting' && fight ? clamp01(fight.rodLift) : 0;
    this._liftShown = damp(this._liftShown, lift, POSE_LAMBDA, fdt);
    this._yawNode.rotation.y = this._yaw + LIFT_LEAN * lift;
    this._yawNode.rotation.z = LIFT_ROLL * this._liftShown;
    this._pitchNode.rotation.x = this._angle - camPitch + jx;
    this._pitchNode.rotation.z = -0.08 + jz;
    const totalBend = this._bend * BEND_TIP_RAD;
    for (let i = 0; i < SEGMENTS; i++) {
      const w = BEND_W[i];
      const tipW = i >= SEGMENTS - 3 ? 1 / 3 : 0;
      this._segNodes[i].rotation.x = -(totalBend * w + tipExtra * tipW);
    }

    // 릴: 손잡이 · 스풀 · 베일
    let turn = 0;
    if (phase === 'retrieving') {
      const reel = cfg ? GEAR_BY_ID[cfg.reel] : null;
      turn = (reel ? reel.speedMS : 1.5) / REEL_M_PER_TURN;
    } else if (phase === 'fighting' && fight) {
      turn = Math.max(0, fight.gainSpeed || 0) / REEL_M_PER_TURN;
    }
    this._handleAngle = (this._handleAngle + turn * Math.PI * 2 * fdt) % (Math.PI * 2);
    this._handlePivot.rotation.x = this._handleAngle;
    let spoolTurn = turn * 1.8;
    if (phase === 'fighting' && fight && fight.slipping) spoolTurn = -Math.max(0, fight.slipSpeed || 0) / (Math.PI * 0.06);
    this._spoolAngle = (this._spoolAngle + spoolTurn * Math.PI * 2 * fdt) % (Math.PI * 2);
    this._spoolPivot.rotation.z = this._spoolAngle;
    this._bailAngle = damp(this._bailAngle, rig.bailOpen ? 2.3 : 0, 20, fdt);
    this._bailPivot.rotation.z = this._bailAngle;

    // 방울(바닥 세트 · 물속에 있을 때)
    const inWater = phase === 'waiting' || phase === 'bite' || phase === 'retrieving';
    this._bell.visible = set === 'bottom' && inWater;
    if (this._bell.visible) {
      const ring = phase === 'bite' ? (rig.signal.kind === 'take' ? 0.5 : rig.signal.kind === 'nibble' ? 0.25 * clamp01(rig.signal.strength) : 0) : 0;
      this._bell.rotation.z = ring * Math.sin(this.time * Math.PI * 2 * 9);
    }

    // 로드 끝 월드 위치
    cam.updateMatrixWorld(true);
    this.viewModel.updateMatrixWorld(true);
    const tip = this._v.tip;
    if (this._broken) {
      const cut = Math.floor(SEGMENTS * (1 - BREAK_FRAC));
      this._segNodes[cut].getWorldPosition(tip);
    } else {
      this._tip.getWorldPosition(tip);
    }

    this._updateWorld(state, alpha, fdt, set, cfg);
  }

  _hideWorld() {
    this._float.visible = false;
    this._sinker.visible = false;
    this._line.visible = false;
    this._ring.visible = false;
    this._net.visible = false;
    this._leftHand.visible = false;
  }

  /** 라인을 a → b 포물선 늘어짐으로 — 늘어진 줄은 물에 닿으면 수면에 눕는다 @param {THREE.Vector3} a @param {THREE.Vector3} b @param {number} sag */
  _setLine(a, b, sag) {
    const p = this._linePos;
    const floor = Math.min(LINE_WATER_Y, b.y);
    for (let i = 0; i < LINE_POINTS; i++) {
      const s = i / (LINE_POINTS - 1);
      const o = i * 3;
      p[o] = a.x + (b.x - a.x) * s;
      p[o + 1] = Math.max(a.y + (b.y - a.y) * s - sag * 4 * s * (1 - s), sag > 0 ? floor : -Infinity);
      p[o + 2] = a.z + (b.z - a.z) * s;
    }
    const attr = /** @type {THREE.BufferAttribute} */ (this._line.geometry.attributes.position);
    attr.needsUpdate = true;
    this._line.visible = true;
  }

  /** @param {Object} state @param {number} alpha @param {number} dt @param {'float'|'bottom'} set @param {Object|null} cfg */
  _updateWorld(state, alpha, dt, set, cfg) {
    const rig = state.rig;
    const fight = state.fight;
    const phase = rig.phase;
    const tip = this._v.tip;
    const A = this._v.a;
    const B = this._v.b;
    const a = clamp01(Number.isFinite(alpha) ? alpha : 1);
    const env = state.env || { waveAmp: 0, wavePeriod: 4, headlamp: false };
    const night = !!env.headlamp || !!(state.clock && state.clock.night);
    const isFloat = set === 'float';
    const obj = isFloat ? this._float : this._sinker;
    const other = isFloat ? this._sinker : this._float;
    other.visible = false;
    this._ring.visible = false;
    this._net.visible = false;
    this._leftHand.visible = false;
    this._float.rotation.set(0, 0, 0);
    this._floatInner.position.set(0, 0, 0);
    this._floatInner.rotation.set(0, 0, 0);

    // 밤: 안테나 꼭대기 1/3 이 연두로 발광(§9.7)
    const top = night ? NIGHT_GLOW : DAY_TOP;
    this._glowMat.color.copy(top);
    this._glowMat.emissive.copy(top);
    this._glowMat.emissiveIntensity = night ? 1.0 : 0.2;

    const lost = phase === 'failed' && (rig.failReason === 'lineBreak' || rig.failReason === 'spoolEmpty' || rig.failReason === 'rodBreak');
    const hanging = phase === 'ready' || phase === 'charging' || phase === 'result' || (phase === 'failed' && !lost);

    if (this._broken || lost) {
      obj.visible = false;
      this._line.visible = false;
    } else if (hanging) {
      // 로드 끝에 매달려 흔들린다
      const sw = 0.12 * Math.sin(this.time * 2.1) + (phase === 'charging' ? 0.15 : 0);
      const cy = this.rc.camera.rotation.y;
      B.set(tip.x + Math.cos(cy) * Math.sin(sw) * FLOAT_HANG, tip.y - FLOAT_HANG * Math.cos(sw), tip.z - Math.sin(cy) * Math.sin(sw) * FLOAT_HANG);
      obj.position.copy(B);
      obj.position.y -= isFloat ? FLOAT_ANT + 0.02 : 0;
      obj.scale.setScalar(1);
      obj.visible = true;
      this._setLine(tip, B, 0);
    } else if (phase === 'casting') {
      // 로드 끝 → 착수점 포물선(castT · 꼭대기 0.25 × distM)
      const t = clamp01(rig.castT);
      const land = rig.bobber;
      const apex = CAST_APEX * Math.max(0, rig.dist);
      B.set(lerp(tip.x, land.x, t), lerp(tip.y, 0, t) + apex * 4 * t * (1 - t), lerp(tip.z, land.z, t));
      obj.position.copy(B);
      const hd = Math.hypot(B.x - rig.origin.x, B.z - rig.origin.z);
      obj.scale.setScalar(isFloat ? floatScale(hd) : 1);
      if (isFloat) obj.position.y -= (FLOAT_ANT * 0.5) * obj.scale.y;
      obj.visible = true;
      this._setLine(tip, B, SAG_CAST * hd);
    } else if (phase === 'waiting' || phase === 'bite' || phase === 'retrieving') {
      const bx = lerp(rig.prevBobber.x, rig.bobber.x, a);
      const bz = lerp(rig.prevBobber.z, rig.bobber.z, a);
      const dist = Math.hypot(bx - rig.origin.x, bz - rig.origin.z);
      const fl = cfg && cfg.float ? GEAR_BY_ID[cfg.float] : null;
      const stab = fl && Number.isFinite(fl.stability) ? fl.stability : 0.5;
      const period = env.wavePeriod > 0 ? env.wavePeriod : 4;
      const wave = (env.waveAmp || 0) * (1 - 0.6 * stab) * Math.sin((this.time * Math.PI * 2) / period + bx * 0.3);
      if (isFloat) {
        const sc = floatScale(dist);
        this._float.position.set(bx, wave, bz);
        this._float.scale.setScalar(sc);
        this._float.rotation.y = rig.bearing;
        const sig = phase === 'bite' ? floatSignalOffset(rig.signal, this._sig) : floatSignalOffset(null, this._sig);
        this._floatInner.position.y = sig.y;
        this._floatInner.rotation.z = sig.lie * (Math.PI / 2);
        this._float.visible = true;
      } else {
        this._sinker.visible = false;
      }
      B.set(bx, wave, bz);
      this._setLine(tip, B, SAG_WAIT * dist);
    } else if ((phase === 'fighting' || phase === 'landing') && fight) {
      obj.visible = false;
      if (phase === 'landing') {
        // 왼손 + 뜰채(손잡이 = netRangeM − 0.75)
        const pose = netPose(this.rc.camera, state, a, this._pose);
        this._leftHand.visible = true;
        this._leftHand.position.copy(LEFT_HAND_CAM);
        this._v.c.copy(pose.hand).sub(pose.dir);          // 손의 −Z(쥔 축)가 손잡이 쪽으로
        this._leftHand.lookAt(this._v.c);
        this._net.visible = true;
        this._net.position.copy(pose.hand);
        this._v.c.copy(pose.hand).add(pose.dir);
        this._net.lookAt(this._v.c);
        this._netPole.scale.set(1, 1, pose.handleLen);
        this._netHoop.position.set(0, 0, pose.handleLen + NET_HOOP_R);
        // 라인은 뜰채 속 물고기로
        B.copy(pose.hoop);
        B.y -= 0.1;
        this._setLine(tip, B, 0.02);
      } else {
        fishPoint(state, a, B);
        const lenM = fight.roll && fight.roll.lengthCm > 0 ? fight.roll.lengthCm / 100 : 0.3;
        if (fight.airborne > 0) B.y = clamp01(fight.airborne) * (0.3 + 0.5 * lenM);
        const dist = Math.hypot(B.x - rig.origin.x, B.z - rig.origin.z);
        const sag = SAG_FIGHT * dist * (1 - clamp((fight.tensionRatio || 0) * 4, 0, 1));
        this._setLine(tip, B, sag);
      }
    } else {
      obj.visible = false;
      this._line.visible = false;
    }

    // aimPreview 고리(충전 중 — 지금 놓으면 떨어질 점)
    if (phase === 'charging' && rig.aimPreview && Number.isFinite(rig.aimPreview.x) && Number.isFinite(rig.aimPreview.z)) {
      this._ring.position.set(rig.aimPreview.x, RING_Y, rig.aimPreview.z);
      this._ring.scale.setScalar(floatScale(Math.hypot(rig.aimPreview.x - rig.origin.x, rig.aimPreview.z - rig.origin.z)));
      const perfect = rig.power >= rig.perfectFrom;
      const spot = SPOTS_BY_ID[state.player.spotId];
      const snag = !!(spot && rig.aimPreview.distM >= spot.snag.fromM);
      this._ringMat.color.copy(snag ? RING_SNAG : perfect ? RING_PERFECT : RING_WHITE);
      this._ringMat.opacity = perfect ? 1 : 0.85;
      this._ring.visible = true;
    }
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    this.rc.camera.remove(this.viewModel);
    this.rc.scene.remove(this.root);
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    for (const t of this._texs) t.dispose();
    this._geos = [];
    this._mats = [];
    this._texs = [];
  }
}
