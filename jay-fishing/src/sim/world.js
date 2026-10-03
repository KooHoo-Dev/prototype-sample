// OWNER: P3 — 계약 §6.4 · §7.2b · §5.1 · §5.6(집 도착 순서)
// 걷기(볼록 다각형 · 벽 미끄러짐 · obstacles) · 상호작용 대상(반경 · 시선) · 배치 · env · 집 도착 처리.
// fishing/* 을 import 하지 않는다(§2.2) — 걷기 중 자리 진입은 updateWalk 가 enterSpotId 로 돌려주고 GameSim.step 이 enterSpot 을 부른다.

import { EV } from '../core/events.js';
import { DT, SET_IDS } from '../core/constants.js';
import { angleDiff, pointInConvex, yawOf } from '../core/math.js';
import { WEATHER } from '../data/weather.js';
import { WORLD } from '../data/world.js';
import { getStage } from '../data/stages/index.js';
import { grantFreeBaitIfNeeded, refillLine, sellAll } from './progression/economy.js';
import { rigStats } from './progression/modifiers.js';

/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').InteractTarget} InteractTarget */
/** @typedef {import('../types.js').StageDef} StageDef */
/** @typedef {import('../types.js').Vec2} Vec2 */

/** 집 도착 처리가 부르는 P4 함수 — world.test 가 순서를 보려고 바꿔 끼운다(rig 의 fightImpl 과 같은 방식) */
export const homeArrival = { sellAll, refillLine, grantFreeBaitIfNeeded };

/** 유한수가 아니면 0, [-1, 1] 로 자른다 */
function axis(v) {
  return Number.isFinite(v) ? (v < -1 ? -1 : v > 1 ? 1 : v) : 0;
}

/** 볼록 다각형 경계 위의 가장 가까운 점(밖에 있을 때 안으로 되돌린다) @param {Vec2[]} poly */
function closestOnPoly(poly, x, z) {
  let bx = x;
  let bz = z;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + ex * t;
    const pz = a.z + ez * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return { x: bx, z: bz };
}

/** walk 다각형 안(경계 포함)인가 — 다각형이 없으면 어디든 @param {StageDef} stage */
function inWalk(stage, x, z) {
  return !stage.walk || stage.walk.length < 3 || pointInConvex(stage.walk, x, z);
}

/** 시작점(안)에서 (dx, dz) 방향으로 walk 안에 머무는 가장 큰 비율 0..1(이분 탐색) */
function maxFrac(stage, x0, z0, dx, dz) {
  if (dx === 0 && dz === 0) return 0;
  if (inWalk(stage, x0 + dx, z0 + dz)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inWalk(stage, x0 + dx * mid, z0 + dz * mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** updateWalk 의 「진입 없음」 결과(틱마다 새로 만들지 않는다) */
const NO_ENTER = Object.freeze({ enterSpotId: null });

/** 틱마다 쓰는 임시 점(할당 없음) */
const scratch = { x: 0, z: 0 };

/** obstacles 원 안이면 원 둘레로 밀어낸다(중심 → 위치 방향 · 중심이면 +Z) — p 를 제자리에서 고친다 */
function pushOutOfObstacles(stage, p) {
  const obs = stage.obstacles || [];
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= o.r * o.r) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-9) {
      p.x = o.x + (dx / d) * o.r;
      p.z = o.z + (dz / d) * o.r;
    } else {
      p.x = o.x;
      p.z = o.z + o.r;
    }
  }
}

/**
 * 이동 · 볼록 다각형 충돌(벽을 따라 미끄러짐) · obstacles · nearby · 상호작용(§7.2b).
 * 자리 진입은 직접 하지 않고 돌려준다. 걷기 모드가 아니면 아무것도 하지 않는다.
 * @param {SimCtx} ctx @param {InputFrame} input @returns {{enterSpotId: string|null}}
 */
export function updateWalk(ctx, input) {
  const s = ctx.state;
  const p = s.player;
  if (p.mode !== 'walk') return NO_ENTER;
  const stage = ctx.stage || getStage(s.scene);
  if (!p.vel) p.vel = { x: 0, z: 0 };
  const vel = p.vel;

  // 목표 속도: 앞(moveZ) · 옆(moveX) — 대각선은 정규화 · 뒤 backMul · 옆 strafeMul
  let mx = axis(input.moveX);
  let mz = axis(input.moveZ);
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const fwdSpeed = WORLD.walkSpeed * mz * (mz >= 0 ? 1 : WORLD.backMul);
  const sideSpeed = WORLD.walkSpeed * mx * WORLD.strafeMul;
  const yaw = Number.isFinite(p.yaw) ? p.yaw : 0;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // 앞 = (−sin, −cos) · 오른쪽 = (cos, −sin)
  const tx = -sin * fwdSpeed + cos * sideSpeed;
  const tz = -cos * fwdSpeed - sin * sideSpeed;
  // 가속(멈출 때도 같은 가속) — 벡터 단위로 다가간다
  const dvx = tx - vel.x;
  const dvz = tz - vel.z;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = WORLD.accel * DT;
  if (dv <= maxDv) { vel.x = tx; vel.z = tz; } else { vel.x += (dvx / dv) * maxDv; vel.z += (dvz / dv) * maxDv; }
  if (!Number.isFinite(vel.x) || !Number.isFinite(vel.z)) { vel.x = 0; vel.z = 0; }

  const pos = p.pos;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) { pos.x = stage.spawn.x; pos.z = stage.spawn.z; }
  const ox = pos.x;
  const oz = pos.z;
  // 밖에 있으면(잘못된 배치) 먼저 안으로 되돌린다
  if (!inWalk(stage, ox, oz)) {
    const c = closestOnPoly(stage.walk, ox, oz);
    pos.x = c.x;
    pos.z = c.z;
  }
  const sx = pos.x;
  const sz = pos.z;
  const dx = vel.x * DT;
  const dz = vel.z * DT;
  if (dx !== 0 || dz !== 0) {
    let nx = sx + dx;
    let nz = sz + dz;
    if (!inWalk(stage, nx, nz)) {
      // 벽을 따라 미끄러진다: x 를 갈 수 있는 데까지 → 그 점에서 z 를 갈 수 있는 데까지(벽에 딱 붙는다)
      const tx = maxFrac(stage, sx, sz, dx, 0);
      nx = sx + dx * tx;
      const tz = maxFrac(stage, nx, sz, 0, dz);
      nz = sz + dz * tz;
      if (tx < 1) vel.x = 0;
      if (tz < 1) vel.z = 0;
    }
    const np = scratch;
    np.x = nx;
    np.z = nz;
    pushOutOfObstacles(stage, np);
    if (inWalk(stage, np.x, np.z)) { pos.x = np.x; pos.z = np.z; }
    // 밀어낸 점이 다각형 밖이면(모서리) 움직이지 않는다
  } else {
    // 정지 중에도 장애물 안이면 밀어낸다(배치 직후 등)
    const np = scratch;
    np.x = sx;
    np.z = sz;
    pushOutOfObstacles(stage, np);
    if ((np.x !== sx || np.z !== sz) && inWalk(stage, np.x, np.z)) { pos.x = np.x; pos.z = np.z; }
  }
  p.speed = Math.hypot(pos.x - sx, pos.z - sz) / DT;

  // 상호작용 대상(프롬프트) — 바뀌지 않았으면 제자리에서 거리만 고친다
  const near = findNearby(s, stage);
  if (!near) p.nearby = null;
  else if (p.nearby && p.nearby.kind === near.kind && p.nearby.id === near.id) p.nearby.dist = near.dist;
  else p.nearby = near;

  if (input.interact && p.nearby) {
    const t = p.nearby;
    if (t.kind === 'spot') return { enterSpotId: t.id };
    ctx.emit(EV.INTERACT, { kind: t.kind, id: t.id });
  }
  return NO_ENTER;
}

/**
 * 시선이 상호작용 물체를 향하는가 — 점, 또는 점 뒤(approach → 점 방향) WORLD.interactDepthM 지점이 interactFov 안.
 * 물체는 깊이가 있다: 벽 위의 점(문)에 몸을 붙이면 점은 옆(90°)이지만 벽을 보면 점 뒤는 앞에 있다(리뷰 수정).
 * @param {number} yaw @param {number} dx 점 − 플레이어 @param {number} dz @param {any} q InteractPoint
 */
function lookingAt(yaw, dx, dz, q) {
  if (Math.abs(angleDiff(yaw, yawOf(dx, dz))) <= WORLD.interactFov) return true;
  const ap = q.approach;
  if (!ap) return false;
  const ax = q.x - ap.x;
  const az = q.z - ap.z;
  const al = Math.hypot(ax, az);
  if (!(al > 1e-6)) return false;
  const k = WORLD.interactDepthM / al;
  return Math.abs(angleDiff(yaw, yawOf(dx + ax * k, dz + az * k))) <= WORLD.interactFov;
}

/**
 * 지금 E 를 누르면 상호작용할 대상 — 걷기 모드에서 spotRadius 안의 자리(가장 가까운 것)가 먼저,
 * 없으면 radius 안이고 시선이 interactFov 안(점 또는 점 뒤 interactDepthM — lookingAt)인 상호작용 점 중 가장 가까운 것(§7.2b). 순수.
 * @param {Object} state @param {StageDef} stage @returns {InteractTarget|null}
 */
export function findNearby(state, stage) {
  const p = state.player;
  if (!p || p.mode !== 'walk' || !stage) return null;
  const x = p.pos.x;
  const z = p.pos.z;
  let best = null;
  let bestD = Infinity;
  const spots = stage.spots || [];
  for (let i = 0; i < spots.length; i++) {
    const sp = spots[i];
    const d = Math.hypot(sp.stand.x - x, sp.stand.z - z);
    if (d <= WORLD.spotRadius && d < bestD) { best = sp; bestD = d; }
  }
  if (best) return { kind: 'spot', id: best.id, dist: bestD };
  const yaw = Number.isFinite(p.yaw) ? p.yaw : 0;
  let pt = null;
  const points = stage.points || [];
  for (let i = 0; i < points.length; i++) {
    const q = points[i];
    const dx = q.x - x;
    const dz = q.z - z;
    const d = Math.hypot(dx, dz);
    if (d > q.radius || d >= bestD) continue;
    if (d > 1e-6 && !lookingAt(yaw, dx, dz, q)) continue;
    pt = q;
    bestD = d;
  }
  return pt ? { kind: pt.kind, id: pt.id, dist: bestD } : null;
}

/**
 * 플레이어를 놓고 PLAYER_PLACED 를 낸다(보간 끊기 — prevPos 도 같은 점 · 속도 0).
 * @param {SimCtx} ctx @param {Vec2} pos @param {number} yaw @param {number} pitch
 * @param {'spawn'|'spot'|'exitSpot'|'debug'} reason
 */
export function placePlayer(ctx, pos, yaw, pitch, reason) {
  const p = ctx.state.player;
  const y = Number.isFinite(yaw) ? yaw : 0;
  const pi = Number.isFinite(pitch) ? Math.max(WORLD.pitchMin, Math.min(WORLD.pitchMax, pitch)) : 0;
  p.pos = { x: pos.x, z: pos.z };
  p.prevPos = { x: pos.x, z: pos.z };
  p.yaw = y;
  p.pitch = pi;
  p.speed = 0;
  p.vel = { x: 0, z: 0 };
  ctx.emit(EV.PLAYER_PLACED, { x: pos.x, z: pos.z, yaw: y, pitch: pi, reason });
}

/** env(§3.4 EnvState) — view · audio 용 파생 값 @param {SimCtx} ctx */
export function updateEnv(ctx) {
  const s = ctx.state;
  const stage = ctx.stage || getStage(s.scene);
  const outdoor = stage.kind === 'outdoor';
  const w = WEATHER[s.weather.current] || WEATHER.clear;
  const env = s.env;
  env.waveAmp = outdoor ? stage.waves.amp * w.waveMul : 0;
  env.wavePeriod = stage.waves.period;
  env.headlamp = outdoor && !!(s.clock && s.clock.night);
  env.rain = outdoor ? w.rain : 0;
  env.ambience = stage.ambience;
}

/**
 * 집 도착 처리(§5.6 — 이 순서 그대로): ① 어창 자동 판매 ② line_1 세트 무료 감기 ③ 무료 미끼(판매 뒤의 돈으로 판정) ④ SAVE_REQUEST{scene}.
 * ①은 어창이 비었으면, ②는 이미 가득이면 부르지 않는다(빈 SOLD · LINE_REFILLED 알림을 내지 않게).
 * @param {SimCtx} ctx
 */
export function arriveHome(ctx) {
  const prof = ctx.state.profile;
  if (prof.hold.length > 0) homeArrival.sellAll(ctx, { auto: true });
  for (const set of SET_IDS) {
    const cfg = prof.sets[set];
    if (!cfg || cfg.lineId !== 'line_1') continue;
    const cap = rigStats(prof, set, ctx.mods).spoolCapM;
    if (!(cfg.lineM >= cap)) homeArrival.refillLine(ctx, set, 'line_1', { free: true });
  }
  homeArrival.grantFreeBaitIfNeeded(ctx);
  ctx.refresh();
  ctx.emit(EV.SAVE_REQUEST, { reason: 'scene' });
}
