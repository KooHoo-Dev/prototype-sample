// OWNER: P1 — 계약 §6.7 · §5.2 · §5.1-4
// STUB — W1 에서 P1 이 채운다(클릭 해석 10규칙 · 선입력 · 경로 · 이동 · 상호작용 도착).
// W0: 좌클릭이면 커서 쪽으로 직선 이동만(최소 부트에서 움직여 보려고 · 벽은 moveCircle) · placePlayer · resetPlayerForScene 은 최소 동작

import { DT } from '../../core/constants.js';
import { turnToward, yawOf } from '../../core/math.js';
import { CLASSES, PLAYER } from '../../data/classes.js';
import { moveCircle } from '../world/nav.js';

/** @typedef {import('../../types.js').SimCtx} SimCtx */
/** @typedef {import('../../types.js').InputFrame} InputFrame */

/**
 * STUB — 플레이어 한 틱(§5.1 4 · 2). W0: lmbDown 이면 그 커서 점을 목표로 · lmb 를 누르고 있으면 커서를 따라 직선 이동
 * @param {SimCtx} ctx @param {InputFrame} input
 */
export function updatePlayer(ctx, input) {
  const p = ctx.state.player;
  const map = ctx.map;
  p.speed = 0;
  p.moving = false;
  if (!map || p.dead || !input) return;
  if ((input.lmbDown || input.lmb) && input.cursor) {
    p.intent = { kind: 'move', point: { x: input.cursor.x, z: input.cursor.z }, follow: true, held: !!input.lmb };
  } else if (!input.lmb && p.intent.kind === 'move') {
    p.intent.held = false;
  }
  if (p.intent.kind !== 'move' || !p.intent.point) return;
  const dx = p.intent.point.x - p.pos.x, dz = p.intent.point.z - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= PLAYER.arriveR) {
    p.intent = { kind: 'none' };
    p.act = 'idle';
    return;
  }
  const speed = ctx.stats?.moveSpeed ?? CLASSES[0].moveSpeed;
  const step = Math.min(d, speed * DT);
  const next = moveCircle(map, p.pos, p.r, (dx / d) * step, (dz / d) * step);
  const moved = Math.hypot(next.x - p.pos.x, next.z - p.pos.z);
  p.pos = next;
  p.facing = turnToward(p.facing, yawOf(dx, dz), PLAYER.turnRate * DT);
  p.speed = moved / DT;
  p.moving = moved > 0;
  p.act = p.moving ? 'move' : 'idle';
  if (!p.moving) p.intent = { kind: 'none' };
}

/**
 * 위치 · prevPos · 경로 · 의도 · 행동 초기화(장면 전환 · 부활 · 디버그)
 * @param {SimCtx} ctx @param {number} x @param {number} z @param {number} [facing]
 */
export function placePlayer(ctx, x, z, facing = 0) {
  const p = ctx.state.player;
  p.pos = { x, z };
  p.prevPos = { x, z };
  p.facing = facing;
  p.path = [];
  p.intent = { kind: 'none' };
  p.buffer = null;
  p.act = p.dead ? 'dead' : 'idle';
  p.actSkill = null;
  p.channel = null;
  p.recall = null;
  p.air = null;
  p.knock = null;
  p.speed = 0;
  p.moving = false;
}

/**
 * STUB — full 이면 생명 · 마나 가득 · 분노 0 · 버프 · 상태 정리(refreshStats 뒤에 부른다). W0: 생명 · 자원 · 사망 · 상태만
 * @param {SimCtx} ctx @param {{full:boolean}} opts
 */
export function resetPlayerForScene(ctx, { full }) {
  const p = ctx.state.player;
  if (!full) return;
  p.life = p.lifeMax;
  const cls = ctx.state.char?.cls;
  const def = CLASSES.find(c => c.id === cls) ?? CLASSES[0];
  p.resource = def.resource === 'rage' ? 0 : p.resourceMax;
  p.dead = false;
  p.deadAt = -1;
  p.act = 'idle';
  p.buffs = [];
  p.shield = 0;
  p.st = { slowPct: 0, slowUntil: 0, rootUntil: 0 };
  p.sk = { hitIds: [], hits: 0, nextAt: -1 };
  p.knock = null;
  p.lowLife = false;
}
