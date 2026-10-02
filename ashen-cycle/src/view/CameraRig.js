// OWNER: P6 — 계약 §9.4
// 3인칭 궤도 카메라. 자유 시점(마우스) · 록온(yaw 자동, pitch 조절) · 경계/기둥 충돌 + 올려다보기 · 흔들림 · 연출.
// 계약 상수는 전부 data/camera.js 의 CAMERA 에서 읽는다(아래의 파일 상수는 이 파일 내부의 감쇠 · 한계다). sim 상태는 읽기만 한다.
import { CAMERA } from '../data/camera.js';
import { EV } from '../core/events.js';
import { angleDiff, angleOf, clamp, damp, lerp, wrapAngle } from '../core/math2d.js';
import { segmentHitsCircle } from '../core/collide.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').Settings} Settings */

const TAU = Math.PI * 2;
const SOFT_CLAMP_EPS = 0.002; // 이 안이면 범위 끝에 붙인다(rad)
const BOX_PITCH_MAX = 1.42;   // 담을 등졌을 때 올려다보는 한계(rad) — 수직(π/2)까지 가면 lookAt의 위쪽 축이 불안정하다
// 충돌로 거리가 줄어드는 속도 · 담 올려다보기 각의 속도 상한은 CAMERA.collide.shrinkSpeed · boxLiftSpeed다(§9.4-3 —
// 기둥 · 상자 모서리가 카메라 선을 스치면 목표가 한 프레임에 꺾인다. 그대로 넣으면 화면이 순간이동한다).

/**
 * 선분 a→b가 축 정렬 상자(중심 x, z · 반폭 hw, hd)를 pad만큼 키운 것에 처음 닿는 매개변수 t(0..1).
 * a가 이미 안이면 0. 안 닿으면 null. (슬래브 법 — 카메라 전용이라 core/collide.js에 두지 않았다)
 * @returns {number|null}
 */
function segmentHitsBox(ax, az, bx, bz, box, pad) {
  const minX = box.x - box.hw - pad;
  const maxX = box.x + box.hw + pad;
  const minZ = box.z - box.hd - pad;
  const maxZ = box.z + box.hd + pad;
  if (ax >= minX && ax <= maxX && az >= minZ && az <= maxZ) return 0;
  const dx = bx - ax;
  const dz = bz - az;
  let t0 = 0;
  let t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < minX || ax > maxX) return null;
  } else {
    let u0 = (minX - ax) / dx;
    let u1 = (maxX - ax) / dx;
    if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
    if (t0 > t1) return null;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < minZ || az > maxZ) return null;
  } else {
    let u0 = (minZ - az) / dz;
    let u1 = (maxZ - az) / dz;
    if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
    if (u0 > t0) t0 = u0;
    if (u1 < t1) t1 = u1;
    if (t0 > t1) return null;
  }
  return t0;
}

export class CameraRig {
  /**
   * @param {{camera:import('three').PerspectiveCamera, bus:import('../core/events.js').EventBus, settings:Settings}} deps
   */
  constructor({ camera, bus, settings }) {
    this.camera = camera;
    this.bus = bus;
    this.settings = settings;
    /** 카메라가 보는 수평 방향(rad, §0.2). app이 이동 입력 변환에 읽는다. 마우스를 오른쪽으로 움직이면 감소한다. */
    this.yaw = 0;
    /** 양수 = 위에서 내려다봄. 자유 시점 [pitchMin, pitchMax], 록온 [lock.pitchMin, lock.pitchMax]. */
    this.pitch = CAMERA.pitchDefault;

    this._dist = -1;          // 현재 거리(충돌 반영). 음수 = 아직 없음(다음 update에서 목표로 스냅)
    this._wanted = -1;        // 감쇠된 "원하는 거리"
    this._locked = false;
    this._lockUser = false;   // 록온 중 사용자가 pitch를 만졌는가
    this._aimX = 0; this._aimZ = 0; this._aimY = 0;   // 조준점 오프셋(플레이어 피벗 기준, 감쇠)
    this._shakeAmp = 0; this._shakeDur = 0; this._shakeLeft = 0;
    this._shakePhA = 0; this._shakePhB = 0;
    this._zoomMul = 1; this._zoomTarget = 1; this._zoomLeft = 0;
    this._phaseLeft = 0;      // 2페이즈 포효 당김 남은 시간
    this._deathT = -1;        // 사망 후 경과(초). 음수 = 살아 있음
    this._deathLift = 0;
    this._boxLift = 0;        // 담(상자) 때문에 더 올려다보는 각(rad, 감쇠)
    /** @type {string|null} */
    this._worldId = null;
    this._pendingSnap = false;
    /** @type {import('../types.js').WorldDef|null} */
    this._blockWorld = null;
    /** @type {{x:number, z:number, r:number}[]} */
    this._blockers = [];
    /** @type {{x:number, z:number, hw:number, hd:number}[]} 상자 콜라이더(마을의 담 · 건물) */
    this._boxes = [];

    const fx = CAMERA.fx;
    this._offs = bus ? [
      bus.on(EV.CAMERA_SHAKE, (p) => this.addShake(p.amp, p.dur)),
      bus.on(EV.EXECUTE_STARTED, () => { this._zoomTarget = fx.executeZoom; this._zoomLeft = fx.executeDur; }),
      bus.on(EV.BOSS_PHASE_CHANGED, () => { this._zoomTarget = fx.phaseZoom; this._zoomLeft = fx.phaseDur; this._phaseLeft = fx.phaseDur; }),
      bus.on(EV.PLAYER_DIED, () => { if (this._deathT < 0) this._deathT = 0; }),
      // 이벤트에는 facing이 없다 — 다음 update에서 state를 보고 등 뒤로 붙는다.
      bus.on(EV.MODE_CHANGED, () => { this._pendingSnap = true; }),
    ] : [];
  }

  /**
   * @param {GameState} state
   * @param {number} alpha 보간 계수 0..1(§5.4)
   * @param {number} dt 렌더 프레임 시간(초, 일시정지면 0)
   * @param {{dx:number, dy:number}} look 이번 프레임 마우스 이동량(픽셀). 게임패드는 app이 픽셀 상당량으로 환산
   */
  update(state, alpha, dt, look) {
    const C = CAMERA;
    const L = C.lock;
    const col = C.collide;
    const fx = C.fx;
    const p = state.player;
    const world = state.world;
    if (!(dt >= 0)) dt = 0;

    // 모드 전환(이벤트 · 이벤트 없는 상태 변화 둘 다) → 등 뒤로 스냅
    if (this._pendingSnap || world.id !== this._worldId) {
      this._worldId = world.id;
      this._pendingSnap = false;
      this.snapBehind(p.facing);
    }

    const px = lerp(p.prevPos.x, p.pos.x, alpha);
    const pz = lerp(p.prevPos.z, p.pos.z, alpha);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return;

    const sens = C.rotSpeed * (this.settings.mouseSensitivity ?? 1);
    const inv = this.settings.invertY ? -1 : 1;
    const dx = look && Number.isFinite(look.dx) ? look.dx : 0;
    const dy = look && Number.isFinite(look.dy) ? look.dy : 0;

    const boss = state.boss;
    const locked = !!(p.lockOn && boss);
    let distWanted = state.mode === 'boss' ? C.distBoss : C.distTown;
    let aimTX = 0;
    let aimTZ = 0;
    let aimTY = 0;

    if (locked) {
      if (!this._locked) this._lockUser = false;
      const bx = lerp(boss.prevPos.x, boss.pos.x, alpha);
      const bz = lerp(boss.prevPos.z, boss.pos.z, alpha);
      const by = lerp(boss.prevY ?? 0, boss.y ?? 0, alpha);
      const ddx = bx - px;
      const ddz = bz - pz;
      const d = Math.hypot(ddx, ddz);
      if (d > L.minDist) {
        // 밀착 시에는 각이 빠르게 돌기 때문에 λ를 낮추고, 순간이동처럼 큰 각 차는 각속도 상한으로 누른다.
        const near = clamp(d / L.nearDist, L.nearMin, 1);
        const diff = angleDiff(this.yaw, angleOf(ddx, ddz));
        const maxStep = L.yawMaxSpeed * dt;
        const step = clamp(diff * (1 - Math.exp(-L.yawLambda * near * dt)), -maxStep, maxStep);
        this.yaw = wrapAngle(this.yaw + step);
      }
      const wasInside = this.pitch >= L.pitchMin && this.pitch <= L.pitchMax;
      if (dy !== 0) {
        this._lockUser = true;
        this.pitch += dy * sens * inv;
      } else if (!this._lockUser) {
        this.pitch = damp(this.pitch, L.pitchEnter, L.pitchLambda, dt);
      }
      const cl = clamp(this.pitch, L.pitchMin, L.pitchMax);
      if (wasInside) {
        this.pitch = cl;
      } else if (cl !== this.pitch) {
        // 자유 시점의 pitch가 록온 범위 밖이었으면 튀지 않게 범위 끝으로 끌어온다.
        this.pitch = Math.abs(this.pitch - cl) < SOFT_CLAMP_EPS ? cl : damp(this.pitch, cl, L.pitchLambda * 2, dt);
      }
      distWanted = C.distBoss
        + clamp((d - L.distFrom) * L.distPerMeter, 0, L.distExtraMax)
        + Math.max(0, boss.radius - L.bossRadiusRef) * L.bossRadiusMul;
      const blend = this._phaseLeft > 0 ? fx.phaseAimBlend : L.aimBlend;
      let ax = ddx * blend;
      let az = ddz * blend;
      const al = Math.hypot(ax, az);
      if (al > L.aimMax) { ax *= L.aimMax / al; az *= L.aimMax / al; }
      aimTX = ax;
      aimTZ = az;
      aimTY = Number.isFinite(by) ? by * blend * L.aimHeight : 0;
    } else {
      this.yaw = wrapAngle(this.yaw - dx * sens);
      this.pitch = clamp(this.pitch + dy * sens * inv, C.pitchMin, C.pitchMax);
    }
    this._locked = locked;

    // ── 연출: 줌 · 사망 후퇴 ──
    if (this._zoomLeft > 0) {
      this._zoomLeft -= dt;
      if (this._zoomLeft <= 0) this._zoomTarget = 1;
    }
    if (this._phaseLeft > 0) this._phaseLeft -= dt;
    this._zoomMul = damp(this._zoomMul, this._zoomTarget, fx.zoomLambda, dt);
    if (p.state === 'dead') {
      if (this._deathT < 0) this._deathT = 0;   // PLAYER_DIED를 못 받아도 상태를 보고 시작한다
    } else if (p.hp > 0) {
      this._deathT = -1;
    }
    let deathLiftTarget = 0;
    if (this._deathT >= 0) {
      this._deathT += dt;
      distWanted += Math.min(fx.deathPull, this._deathT * fx.deathRate);
      deathLiftTarget = fx.deathLift;
    }
    this._deathLift = damp(this._deathLift, deathLiftTarget, fx.deathLambda, dt);
    distWanted *= this._zoomMul;

    this._wanted = this._wanted < 0 ? distWanted : damp(this._wanted, distWanted, C.distLambda, dt);
    this._aimX = damp(this._aimX, aimTX, L.aimLambda, dt);
    this._aimZ = damp(this._aimZ, aimTZ, L.aimLambda, dt);
    this._aimY = damp(this._aimY, aimTY, L.aimLambda, dt);

    // ── 충돌: 피벗 → 카메라 선분(XZ) ──
    const basePitch = this.pitch + this._deathLift;
    const dirx = -Math.sin(this.yaw);
    const dirz = -Math.cos(this.yaw);
    // 올려다보기(lift)로 pitch가 바뀌어도 수평 길이가 검사한 길이를 넘지 않게, 가능한 가장 긴 수평 투영으로 검사한다.
    const cMax = Math.max(0.05, basePitch < 0 && basePitch + col.liftMax > 0
      ? 1
      : Math.max(Math.cos(basePitch), Math.cos(basePitch + col.liftMax)));
    const hWant = this._wanted * cMax;
    let hFree = hWant;
    const ex = px + dirx * hWant;
    const ez = pz + dirz * hWant;
    const R = world.radius - col.wallPad;
    if (ex * ex + ez * ez > R * R) {
      // |P + t·D| = R (D는 단위 벡터)의 바깥쪽 해
      const b = px * dirx + pz * dirz;
      const c = px * px + pz * pz - R * R;
      const disc = b * b - c;
      const t = disc > 0 ? -b + Math.sqrt(disc) : 0;
      hFree = clamp(t, 0, hFree);
    }
    const blockers = this._blockersOf(world);
    for (let i = 0; i < blockers.length; i++) {
      const cc = blockers[i];
      const t = segmentHitsCircle(px, pz, ex, ez, cc.x, cc.z, cc.r + col.hitPad);
      if (t !== null && t * hWant < hFree) hFree = t * hWant;
    }
    // 상자(안개문 옆 담 · 대장간 · 좌판): 담을 등지면 카메라가 담 너머로 나가 화면이 벽 속이 된다 — 원과 같은 식으로 줄인다
    const boxes = this._boxes;
    let hBox = Infinity;   // 상자가 허락하는 수평 거리(m)
    for (let i = 0; i < boxes.length; i++) {
      const t = segmentHitsBox(px, pz, ex, ez, boxes[i], col.hitPad);
      if (t === null) continue;
      if (t * hWant < hBox) hBox = t * hWant;
      if (t * hWant < hFree) hFree = t * hWant;
    }
    const target = Math.min(this._wanted, Math.max(C.distMin, hFree / cMax));
    // 담을 등졌다: 최소 거리(distMin)로도 수평으로는 담을 넘는다(경계 밖 구조물과 달리 담은 바로 등 뒤에 있다)
    // → 수평 투영이 담 앞에서 멎을 때까지 위로 올려, 머리 위에서 내려다본다. 필요한 각은 **목표 거리**로 잰다
    // (줄어드는 중인 거리로 재면 모서리를 스칠 때 각이 넘쳤다가 돌아온다).
    const pitchT = basePitch + Math.min(col.liftMax, Math.max(0, this._wanted - target) * col.liftPerMeter);
    const boxLiftT = hBox < target * Math.cos(pitchT)
      ? Math.max(0, Math.min(BOX_PITCH_MAX, Math.acos(clamp(hBox / target, 0, 1))) - pitchT)
      : 0;
    // 기둥 · 모서리가 선을 스치는 순간 목표는 불연속으로 바뀐다. 거리 · 각 모두 속도 상한으로 따라간다(순간이동 금지).
    // 다시 늘어날 때는 damp로 부드럽게. 스냅 직후(첫 프레임)에만 목표를 그대로 넣는다.
    if (this._dist < 0) {
      this._dist = target;
      this._boxLift = boxLiftT;
    } else {
      this._dist = target < this._dist
        ? Math.max(target, this._dist - col.shrinkSpeed * dt)
        : damp(this._dist, target, col.growLambda, dt);
      this._boxLift = boxLiftT > this._boxLift
        ? Math.min(boxLiftT, this._boxLift + col.boxLiftSpeed * dt)
        : damp(this._boxLift, boxLiftT, col.growLambda, dt);
    }
    const lift = Math.min(col.liftMax, Math.max(0, this._wanted - this._dist) * col.liftPerMeter);
    let pitchEff = basePitch + lift;
    if (this._boxLift > 1e-4) pitchEff = Math.min(pitchEff + this._boxLift, Math.max(BOX_PITCH_MAX, pitchEff));

    const cp = Math.cos(pitchEff);
    const sp = Math.sin(pitchEff);
    const cam = this.camera;
    cam.position.set(
      px + dirx * cp * this._dist,
      Math.max(col.minY, C.pivotY + sp * this._dist),
      pz + dirz * cp * this._dist,
    );
    cam.lookAt(px + this._aimX, C.pivotY + C.lookAtY + this._aimY, pz + this._aimZ);

    // ── 흔들림(렌더 시간으로 돈다 — 히트스톱 중에도 흔들린다) ──
    if (this._shakeLeft > 0) {
      this._shakeLeft -= dt;
      const S = C.shake;
      const left = Math.max(0, this._shakeLeft);
      const k = left / this._shakeDur;
      const amp = this._shakeAmp * k * k * (this.settings.cameraShake ?? 1);
      if (amp > 0) {
        const t = this._shakeDur - left;
        const ox = Math.sin(t * S.freqA * TAU + this._shakePhA) * amp;
        const oy = Math.sin(t * S.freqB * TAU + this._shakePhB) * amp * 0.8;
        cam.translateX(ox);
        cam.translateY(oy);
        cam.rotateZ(ox * S.roll);
      }
    }
  }

  /**
   * 카메라를 막는 원 콜라이더 목록(월드마다 한 번 계산해 둔다). 상자(담 · 건물)는 this._boxes에 따로 모은다.
   * 시설 중심 · NPC 자리에 놓인 원(화톳불 · NPC)은 낮아서 카메라가 그 위를 넘는다 — 부활 지점이 화톳불 바로
   * 북쪽이라(§7.8) 이것까지 막으면 부활하자마자 카메라가 등에 붙는다(§9.3의 "화톳불 위를 넘어 본다"). docs/NOTES-P6.md.
   * @param {import('../types.js').WorldDef} world
   */
  _blockersOf(world) {
    if (this._blockWorld === world) return this._blockers;
    const low = (c) => {
      for (const f of world.facilities ?? []) if (Math.hypot(f.x - c.x, f.z - c.z) < c.r) return true;
      for (const n of world.npcs ?? []) if (Math.hypot(n.x - c.x, n.z - c.z) < c.r) return true;
      return false;
    };
    this._blockWorld = world;
    this._blockers = world.colliders.filter((c) => c.type === 'circle' && !low(c));
    this._boxes = world.colliders.filter((c) => c.type === 'box');
    return this._blockers;
  }

  /** yaw = facing, pitch = pitchDefault. 감쇠 중이던 거리 · 조준점 · 연출도 버린다. @param {number} facing */
  snapBehind(facing) {
    this.yaw = Number.isFinite(facing) ? wrapAngle(facing) : 0;
    this.pitch = CAMERA.pitchDefault;
    this._dist = -1;
    this._wanted = -1;
    this._locked = false;
    this._lockUser = false;
    this._aimX = 0; this._aimZ = 0; this._aimY = 0;
    this._zoomMul = 1; this._zoomTarget = 1; this._zoomLeft = 0;
    this._phaseLeft = 0;
    this._deathT = -1;
    this._deathLift = 0;
    this._boxLift = 0;
  }

  /** 겹치면 큰 쪽. @param {number} amp 진폭(m) @param {number} dur 길이(초) */
  addShake(amp, dur) {
    if (!(amp > 0) || !(dur > 0)) return;
    const a = Math.min(amp, CAMERA.shake.maxAmp);
    const k = this._shakeLeft > 0 ? this._shakeLeft / this._shakeDur : 0;
    if (a < this._shakeAmp * k * k) return;
    this._shakeAmp = a;
    this._shakeDur = dur;
    this._shakeLeft = dur;
    this._shakePhA = Math.random() * TAU;
    this._shakePhB = Math.random() * TAU;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }
}
