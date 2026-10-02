// OWNER: sim — (W5) 리뷰 지적의 회귀 테스트. 실제 GameSim(P1~P4 완성본)으로 재현 시나리오를 그대로 돌린다.
//   1. 대검 완충 강공격의 「그로기 → 처형 → 일어나자마자 다시 그로기」 루프(체간 잠금 · 한 타 상한 — §6.4 · §8.7)
//   2. 펜리르 도약이 기둥에 걸렸다가 마지막 틱에 순간이동하던 것(막힌 도약은 기둥 앞에 내려앉는다 — §8.4)
//   3. 표식 없는 보스 근접 판정이 보이는 무기 · 몸보다 1.3~2.5m 크던 것(§8.10~§8.12)
//   4. 탭 패링(§7.1) · 발밑 장판의 가드(§6.4 규칙 2)
// 단위 수준의 단언은 combat · player · boss.framework · core 테스트에 있다.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus, EV } from '../src/core/events.js';
import { DT, BOSS_IDS } from '../src/core/constants.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { resolveShape } from '../src/core/hitShapes.js';
import { circleOverlapsWorld } from '../src/core/collide.js';
import { COMBAT } from '../src/data/combat.js';
import { PLAYER } from '../src/data/player.js';
import { DEFAULT_SETTINGS } from '../src/data/settings.js';
import { getMoveDef } from '../src/data/weapons.js';
import { getBossDef } from '../src/data/bosses/index.js';
import { GameSim } from '../src/sim/GameSim.js';
import { CharacterLayer } from '../src/view/characters/CharacterLayer.js';
import { assertFiniteDeep, makeTestProfile } from './helpers.js';

const TICKS_PER_SEC = Math.round(1 / DT);

/** 보스전을 시작해 교전 구간까지 돌린다. */
function startFight(bossId, opts = {}) {
  const bus = new EventBus();
  const profile = opts.profile ?? makeTestProfile({ seed: opts.seed ?? 3 });
  const sim = new GameSim({ profile, bus });
  sim.startBossFight(bossId, opts.hooks ? { hooks: opts.hooks } : undefined);
  if (opts.god) sim.setDebug({ godMode: true });
  for (let i = 0; i < 300 && sim.state.fight.phase !== 'fight'; i++) sim.step(DT, NEUTRAL_INPUT);
  assert.equal(sim.state.fight.phase, 'fight');
  return { sim, bus, s: sim.state, profile };
}

/** 플레이어를 보스의 정면(보스가 보는 쪽) d m에 세운다. */
function placeInFront(s, d) {
  s.player.pos.x = s.boss.pos.x + Math.sin(s.boss.facing) * d;
  s.player.pos.z = s.boss.pos.z + Math.cos(s.boss.facing) * d;
  s.player.prevPos.x = s.player.pos.x;
  s.player.prevPos.z = s.player.pos.z;
}

// ───────────────────────────────────────────────────────────── 1. 체간 루프

/**
 * 루프 정책(리뷰의 재현): 붙어서 강공격을 끝까지 모아 친다 · 그로기면 정면에서 처형 ·
 * 보스가 executed/recover/phaseShift인 동안 그 상태가 끝나는 틱에 판정이 닿도록 완충 강공격을 미리 시작한다.
 */
function loopPolicy(state, recoverDur) {
  const p = state.player;
  const b = state.boss;
  const inp = { ...NEUTRAL_INPUT, heavyHeld: true };
  if (!b || p.hp <= 0 || b.hp <= 0) return inp;
  const mv = getMoveDef(p.stats.weaponId, 'heavy');
  const full = mv.windup + mv.chargeMax;
  const dx = b.pos.x - p.pos.x;
  const dz = b.pos.z - p.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  if (b.state === 'groggy') {
    if (p.canExecute) inp.lightPressed = true;
    else if (p.state !== 'attack' && p.state !== 'execute') {
      const tx = b.pos.x + Math.sin(b.facing) * (b.radius + 1.4) - p.pos.x;
      const tz = b.pos.z + Math.cos(b.facing) * (b.radius + 1.4) - p.pos.z;
      const l = Math.hypot(tx, tz);
      if (l > 0.2) {
        inp.moveX = tx / l;
        inp.moveZ = tz / l;
      }
    }
    return inp;
  }
  const reach = 3.3 + b.radius - 0.4;
  if (d > reach && p.state !== 'attack') {
    inp.moveX = dx / d;
    inp.moveZ = dz / d;
    inp.sprint = d > 6;
  }
  if (b.state === 'executed' || b.state === 'recover' || b.state === 'phaseShift') {
    let left = b.stateDur - b.stateTime;
    if (b.state === 'executed') left += recoverDur;
    if (left <= full + 0.02 && d <= reach + 0.5) inp.heavyPressed = p.state !== 'attack';
    return inp;
  }
  if (p.state !== 'attack' && d <= reach + 0.3) inp.heavyPressed = true;
  return inp;
}

describe('(W5) 체간: 한 방 그로기 루프가 성립하지 않는다', () => {
  // [보스, 순환, 대검 강화, 기량] — 완충 강공격의 체간(26 × 2 × postureMul)이 전부 postureMax를 넘는 조합이다
  const CASES = [['nihil', 0, 0, 15], ['valder', 0, 4, 15], ['fenrir', 0, 2, 30], ['valder', 3, 10, 40], ['nihil', 3, 10, 40]];
  for (const [bossId, cycle, level, dex] of CASES) {
    test(`${bossId} · 순환 ${cycle} · 대검 +${level} · 기량 ${dex}: 그로기와 그로기 사이에 보스의 판정이 반드시 한 번은 나온다`, () => {
      const profile = makeTestProfile({ seed: 5, cycle, points: { dex } });
      profile.equippedWeapon = 'greatsword';
      profile.weapons.greatsword.level = level;
      // 무적 · 스태미나 무한: 플레이어의 공격이 한 번도 끊기지 않는 가장 유리한 조건
      const { sim, bus, s } = startFight(bossId, { profile, god: true });
      sim.setDebug({ noStamina: true });
      const def = getBossDef(bossId);
      const fullHeavy = getMoveDef('greatsword', 'heavy').posture * PLAYER.chargePostureMul * s.player.stats.postureMul;
      assert.ok(fullHeavy >= s.boss.postureMax, `전제: 완충 강공격의 체간 ${fullHeavy.toFixed(1)} ≥ ${s.boss.postureMax}`);

      let groggy = 0;
      let activeSince = 0;
      let maxGain = 0;
      const offs = [
        bus.on(EV.BOSS_GROGGY, (p) => {
          if (!p.on) return;
          if (groggy > 0) assert.ok(activeSince >= 1, `${groggy + 1}번째 그로기 전에 보스의 판정 구간이 없었다(무한 루프)`);
          groggy += 1;
          activeSince = 0;
        }),
        bus.on(EV.BOSS_ATTACK_ACTIVE, () => { activeSince += 1; }),
        bus.on(EV.HIT, (r) => { if (r.target === 'boss' && r.posture > maxGain) maxGain = r.posture; }),
      ];
      for (let i = 0; i < 60 * TICKS_PER_SEC && s.fight.phase === 'fight'; i++) {
        const before = s.boss.state;
        sim.step(DT, loopPolicy(s, def.recoverDur));
        // 일어난 직후(recover → 고민 → 예고)에는 체간이 0에서 움직이지 않는다
        if (s.boss.postureGuard) assert.equal(s.boss.posture, 0, `잠금 중 체간 ${s.boss.posture} (${before} → ${s.boss.state})`);
      }
      for (const off of offs) off();
      assert.ok(groggy >= 2, `그로기가 ${groggy}번 — 시나리오가 루프를 시도하지 못했다`);
      assert.ok(maxGain <= s.boss.postureMax * COMBAT.postureHitCap + 1e-9, `한 타의 체간 ${maxGain}`);
      assertFiniteDeep(s);
      sim.dispose();
    });
  }
});

// ───────────────────────────────────────────────────────────── 2. 도약 × 기둥

describe('(W5) 도약: 기둥에 막히면 그 앞에 내려앉는다 — 공중에서 멈추거나 마지막 틱에 순간이동하지 않는다', () => {
  /** 펜리르를 (bx, bz), 플레이어를 (px, pz)에 두고 pounce 한 번. */
  function pounce(bx, bz, px, pz) {
    const { sim, s } = startFight('fenrir', { god: true, hooks: { forceAttack: () => 'pounce' } });
    Object.assign(s.boss.pos, { x: bx, z: bz });
    Object.assign(s.boss.prevPos, { x: bx, z: bz });
    Object.assign(s.player.pos, { x: px, z: pz });
    s.boss.facing = Math.atan2(px - bx, pz - bz);
    const mv = getBossDef('fenrir').attacks.pounce.move;
    const hit = getBossDef('fenrir').attacks.pounce.hits[0];
    const out = { maxStep: 0, stall: 0, moved: 0, tele: null, land: null, y0: -1 };
    let seen = false;
    for (let i = 0; i < 900; i++) {
      const bxy = { x: s.boss.pos.x, z: s.boss.pos.z };
      const tel = s.telegraphs.find((t) => t.source === 'boss');
      if (tel) out.tele = tel.shape;
      sim.step(DT, NEUTRAL_INPUT);
      const a = s.boss.attack;
      if (!a || a.id !== 'pounce') {
        if (seen) break;
        continue;
      }
      seen = true;
      const tA = a.t - a.windup;
      const step = Math.hypot(s.boss.pos.x - bxy.x, s.boss.pos.z - bxy.z);
      if (tA > mv.t0 && tA <= 1e-9) {
        out.moved += step;
        out.maxStep = Math.max(out.maxStep, step);
        if (step < 0.005 && s.boss.y > 0.01) out.stall += 1;
      }
      if (tA >= -1e-9 && !out.land) {
        out.land = resolveShape(hit.shape, s.boss.pos.x, s.boss.pos.z, s.boss.facing);
        out.y0 = s.boss.y;
        out.overlap = circleOverlapsWorld(s.boss.pos.x, s.boss.pos.z, s.boss.radius, s.world);
      }
    }
    assert.ok(seen && out.land && out.tele, 'pounce가 끝까지 돌았다');
    assertFiniteDeep(s);
    sim.dispose();
    return out;
  }

  test('기둥 (0, 15) 뒤의 플레이어에게: 축 위 · 0.5m 옆 · 2m 옆 — 틱당 이동이 고르고 착지 판정 = 바닥 표식', () => {
    const mv = getBossDef('fenrir').attacks.pounce.move;
    const cruise = (mv.dist / (mv.t1 - mv.t0)) * DT;   // 가장 먼 도약의 틱당 이동(0.4m)
    for (const bx of [0, 0.5, 2]) {
      const r = pounce(bx, 6, 0, 17.2);
      assert.ok(r.maxStep <= cruise * 1.5, `보스 x ${bx}: 한 틱에 ${r.maxStep.toFixed(2)}m(고치기 전: 2.8~5.2m)`);
      assert.equal(r.stall, 0, `보스 x ${bx}: 공중에서 ${r.stall}틱 멈췄다(고치기 전: 9틱)`);
      assert.ok(r.moved > 5, `보스 x ${bx}: ${r.moved.toFixed(2)}m를 날았다`);
      const off = Math.hypot(r.land.x - r.tele.x, r.land.z - r.tele.z);
      assert.ok(off < 0.05, `보스 x ${bx}: 착지 판정이 표식에서 ${off.toFixed(2)}m 어긋난다(고치기 전: 2.1~2.2m)`);
      assert.equal(r.overlap, false, '기둥과 겹치지 않은 자리에 내린다');
      assert.equal(r.y0, 0, '판정 시작 틱에 지면에 있다');
      // 기둥 앞에 내려앉았다: 착지 원의 중심이 기둥(z 15)을 넘지 않는다
      assert.ok(r.land.z < 15, `착지 원의 중심 z ${r.land.z.toFixed(2)}`);
    }
  });

  test('막히지 않은 도약은 그대로다: 플레이어 앞 stopShort에 내리고 표식 = 플레이어 자리', () => {
    const r = pounce(0, -8, 0, 2);
    assert.ok(Math.hypot(r.land.x - 0, r.land.z - 2) < 0.05);
    assert.ok(Math.hypot(r.tele.x - 0, r.tele.z - 2) < 0.05);
    assert.equal(r.stall, 0);
  });
});

// ───────────────────────────────────────────────────────────── 3. 근접 판정 = 보이는 무기 · 몸

describe('(W5) 표식 없는 보스 근접 판정은 보이는 무기 · 몸의 도달 거리 + 0.7m 안이다', () => {
  const v = new THREE.Vector3();

  /** 판정 구간 동안 보스 뷰의 모든 메시 정점이 보스 중심에서 닿는 범위(수평 · 보스 기준 앞/옆/뒤). */
  function visibleReach(bossId, attackId) {
    const bus = new EventBus();
    const scene = new THREE.Scene();
    const layer = new CharacterLayer({ scene, bus, settings: { ...DEFAULT_SETTINGS } });
    const sim = new GameSim({ profile: makeTestProfile({ seed: 3 }), bus });
    sim.startBossFight(bossId, { hooks: { forceAttack: () => attackId } });
    sim.setDebug({ godMode: true });
    const s = sim.state;
    for (let i = 0; i < 300 && s.fight.phase !== 'fight'; i++) {
      sim.step(DT, NEUTRAL_INPUT);
      layer.update(s, 1, DT);
    }
    placeInFront(s, 3);
    const ext = { r: 0, fwd: 0, side: 0, back: 0 };
    let seen = false;
    for (let i = 0; i < 900; i++) {
      sim.step(DT, NEUTRAL_INPUT);
      layer.update(s, 1, DT);
      const a = s.boss.attack;
      if (!a || a.id !== attackId) {
        if (seen) break;
        continue;
      }
      seen = true;
      const tA = a.t - a.windup;
      if (tA < -0.05 || tA > a.active + 0.05) continue;
      const root = scene.getObjectByName(`boss:${bossId}`);
      assert.ok(root, '보스 뷰가 씬에 있다');
      const fx = Math.sin(s.boss.facing);
      const fz = Math.cos(s.boss.facing);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const pos = o.geometry.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          const dx = v.x - s.boss.pos.x;
          const dz = v.z - s.boss.pos.z;
          const f = dx * fx + dz * fz;
          ext.r = Math.max(ext.r, Math.hypot(dx, dz));
          ext.fwd = Math.max(ext.fwd, f);
          ext.back = Math.max(ext.back, -f);
          ext.side = Math.max(ext.side, Math.abs(dx * fz - dz * fx));
        }
      });
    }
    assert.ok(seen, `${attackId}가 나왔다`);
    layer.dispose();
    sim.dispose();
    return ext;
  }

  // [보스, 공격, 판정이 닿는 거리(셰이프에서), 보이는 도달 거리(메시에서)]
  const CASES = [
    ['valder', 'slash_r', (sh) => sh.r, (e) => e.r],
    ['valder', 'slash_l', (sh) => sh.r, (e) => e.r],
    ['valder', 'overhead', (sh) => sh.fwd1 + sh.r, (e) => e.fwd],
    ['valder', 'spin_slash', (sh) => sh.r, (e) => e.r],
    ['valder', 'delayed_cleave', (sh) => sh.r, (e) => e.r],
    ['fenrir', 'bite', (sh) => sh.r, (e) => e.fwd],
    ['fenrir', 'claw_swipe', (sh) => sh.fwd + sh.r, (e) => e.fwd],
    ['fenrir', 'claw_swipe', (sh) => sh.r, (e) => e.side],            // 옆으로
    ['fenrir', 'tail_sweep', (sh) => sh.r, (e) => Math.max(e.back, e.side)],
    ['nihil', 'scythe_slash', (sh) => sh.r, (e) => e.r],
  ];
  const cache = {};
  for (const [bossId, attackId, hitReach, seenReach] of CASES) {
    test(`${bossId} ${attackId}`, () => {
      const h = getBossDef(bossId).attacks[attackId].hits[0];
      assert.equal(h.telegraph, false, '표식이 없는 공격 — 보이는 무기 · 몸이 곧 판정이다');
      const ext = cache[`${bossId}:${attackId}`] ??= visibleReach(bossId, attackId);
      const hit = hitReach(h.shape);
      const seen = seenReach(ext);
      assert.ok(hit <= seen + 0.7, `판정 ${hit.toFixed(2)}m > 보이는 ${seen.toFixed(2)}m + 0.7(고치기 전: +1.0~2.5m)`);
      assert.ok(hit >= seen - 0.3, `판정 ${hit.toFixed(2)}m가 보이는 ${seen.toFixed(2)}m보다 0.3m 넘게 짧다(닿았는데 안 맞는다)`);
    });
  }

  test('선택 거리 · 연속기 거리의 끝에 서 있어도 닿는다(전진 + 판정 + 몸 0.4m ≥ 거리)', () => {
    const reach = (sh) => (sh.type === 'capsule' ? sh.fwd1 + sh.r : sh.type === 'circle' ? (sh.fwd ?? 0) + sh.r : sh.r);
    for (const bossId of BOSS_IDS) {
      const def = getBossDef(bossId);
      const total = (id) => {
        const a = def.attacks[id];
        const lunge = a.move && a.move.kind === 'lunge' ? a.move.dist : 0;
        return lunge + reach(a.hits[0].shape) + PLAYER.radius;
      };
      for (const id of Object.keys(def.attacks)) {
        const a = def.attacks[id];
        if (a.hits.length === 0 || a.hits[0].telegraph) continue;
        if (a.sel) assert.ok(total(id) >= a.sel.maxRange - 1e-9, `${bossId} ${id}: 선택 거리 ${a.sel.maxRange} vs 닿는 거리 ${total(id).toFixed(2)}`);
      }
      for (const id of Object.keys(def.attacks)) {
        for (const c of def.attacks[id].chain) {
          const n = def.attacks[c.next];
          if (c.maxRange === undefined || n.hits.length === 0 || n.hits[0].telegraph) continue;
          assert.ok(total(c.next) >= c.maxRange - 1e-9, `${bossId} ${id} → ${c.next}: 연속기 거리 ${c.maxRange} vs ${total(c.next).toFixed(2)}`);
        }
      }
    }
  });

  test('발더 slash_r: 칼끝 밖(4.5m)에 서 있으면 맞지 않는다 — 고치기 전에는 23 피해', () => {
    const { sim, s } = startFight('valder', { hooks: { forceAttack: () => 'slash_r' } });
    const hp = s.player.hp;
    let done = false;
    for (let i = 0; i < 600 && !done; i++) {
      // 매 틱 보스 정면 4.5m에 다시 세운다(전진 1.4m를 따라 물러난 셈 — 칼끝의 최대 도달 2.9m보다 1.6m 밖)
      placeInFront(s, 4.5);
      sim.step(DT, NEUTRAL_INPUT);
      const a = s.boss.attack;
      done = !!a && a.id === 'slash_r' && a.phase === 'recovery';
    }
    assert.ok(done);
    assert.equal(s.player.hp, hp, '칼끝에서 1.6m 떨어져 있었다');
    sim.dispose();
  });
});

// ───────────────────────────────────────────────────────────── 4. 탭 패링

describe('(W5) 탭 패링: 창 안에서 버튼을 뗐어도 패링이 난다', () => {
  /** 발더 slash_r의 판정 lead틱 전에 가드를 누르고 hold틱 동안만 누른다. HIT(target player)의 outcome을 돌려준다. */
  function tap(lead, hold) {
    const { sim, bus, s } = startFight('valder', { hooks: { forceAttack: () => 'slash_r' } });
    placeInFront(s, 2.4);
    let outcome = null;
    const off = bus.on(EV.HIT, (r) => { if (r.target === 'player' && outcome === null) outcome = r.outcome; });
    let pressed = -1;
    for (let i = 0; i < 900 && outcome === null; i++) {
      const a = s.boss.attack;
      let guard = false;
      if (a && a.id === 'slash_r') {
        const ticksToActive = Math.round((a.windup - a.t) / DT);
        if (pressed < 0 && ticksToActive <= lead) pressed = i;
        guard = pressed >= 0 && i - pressed < hold;
      }
      sim.step(DT, { ...NEUTRAL_INPUT, guard });
    }
    off();
    sim.dispose();
    return outcome;
  }

  test('판정 6틱(0.10초) 전에 누르고 1 · 3 · 4 · 5틱만에 떼도 패링 — 창(0.18초) 밖에서 누른 탭은 그대로 맞는다', () => {
    assert.equal(tap(6, 60), 'parry', '누르고 있으면 패링(기준)');
    for (const hold of [1, 3, 4, 5]) assert.equal(tap(6, hold), 'parry', `${hold}틱(${(hold * DT * 1000).toFixed(0)}ms) 탭`);
    // 너무 이른 탭(판정 20틱 = 0.33초 전): 창이 끝나 가드도 내려갔다 → 피격
    assert.equal(tap(20, 4), 'hit');
    // 이르게 누르고 계속 쥐고 있으면 가드
    assert.equal(tap(20, 60), 'guard');
  });
});
