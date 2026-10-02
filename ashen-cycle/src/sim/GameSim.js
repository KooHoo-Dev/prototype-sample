// OWNER: P2 — 계약 §4.1 · §5 · §6.4
// 모든 패키지가 만나는 곳. 틱 순서는 §5.1의 A~M 그대로이고, 플러시는 §4.1의 모양 그대로다(재진입 안전).
// P1 · P3 · P4는 계약의 공개 함수로만 부른다 — 그 진입점은 this._ops에 모아 둔다(테스트가 갈아 끼우는 이음매).
import { EV } from '../core/events.js';
import { DT, EPS } from '../core/constants.js';
import { createRng, hashSeed } from '../core/rng.js';
import { clamp01 } from '../core/math2d.js';
import { resolveShape } from '../core/hitShapes.js';
import { pushOutOfCircle, resolveCircleVsWorld } from '../core/collide.js';
import { COMBAT } from '../data/combat.js';
import { PLAYER } from '../data/player.js';
import { getWorld } from '../data/world.js';
import { getBossDef } from '../data/bosses/index.js';
import {
  applyStatsToPlayer, bufferPlayerInput, createPlayerState, getPlayerHit, updatePlayer,
} from './player/playerSim.js';
import { createBossState, getBossHits, getBossTelegraphs, updateBoss } from './boss/bossSim.js';
import { getBossHooks } from './boss/hooks/index.js';
import { computeStatBlock } from './progression/stats.js';
import { applyReward, computeReward, getCycleScaling, noteAttempt } from './progression/economy.js';
import { resolveHitOnBoss, resolveHitOnDummy, resolveHitOnPlayer } from './combat/damage.js';
import { clearProjectiles, resolveProjectiles, spawnProjectile, updateProjectiles } from './projectiles.js';
import { clearHazards, resolveHazards, spawnHazard, updateHazards } from './hazards.js';
import { createDummyState, updateDummy } from './dummy.js';
import { updateTown } from './world/town.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').SimCtx} SimCtx */
/** @typedef {import('../types.js').Profile} Profile */
/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').BossId} BossId */
/** @typedef {import('../types.js').BossDef} BossDef */
/** @typedef {import('../types.js').BossHooks} BossHooks */
/** @typedef {import('../types.js').CycleScaling} CycleScaling */
/** @typedef {import('../types.js').RewardResult} RewardResult */
/** @typedef {import('../core/events.js').EventBus} EventBus */

const TOWN_ID = 'town';

/** 마을의 순환 배율(전부 중립). @type {Readonly<CycleScaling>} */
const NEUTRAL_SCALING = Object.freeze({ hpMul: 1, dmgMul: 1, rewardMul: 1, speedMul: 1, thinkMul: 1, chainBonus: 0 });

const NO_HITS = Object.freeze([]);

/**
 * 돌진하는 보스의 몸통 원이 플레이어와 겹치면 **진행 방향에 수직으로만** 비켜 세운다(§5.1 G3 — W3).
 * 한 틱에 최대 maxStep만큼만 옮긴다(그동안의 겹침은 허용한다 — 보스가 지나가며 옆으로 쓸어 낸다).
 * 정확히 중심선 위면 아레나 중심에 가까운 쪽으로 보낸다(벽 쪽으로 밀어 넣지 않는다).
 * @param {{x:number, z:number}} pos 플레이어 위치(제자리 수정)
 * @param {number} radius
 * @param {number} cx 몸통 원 @param {number} cz @param {number} cr
 * @param {number} fx 돌진 방향(단위) @param {number} fz
 * @param {number} maxStep
 * @returns {boolean} 겹쳤는가
 */
function shoveAside(pos, radius, cx, cz, cr, fx, fz, maxStep) {
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const R = radius + cr;
  if (dx * dx + dz * dz >= R * R) return false;
  const along = dx * fx + dz * fz;
  const side = dx * fz - dz * fx;             // 수직 축 (fz, −fx) 위의 좌표
  const need = Math.sqrt(Math.max(0, R * R - along * along));
  let sign = side > EPS ? 1 : side < -EPS ? -1 : 0;
  if (sign === 0) {
    // 원점(아레나 중심)에 더 가까워지는 쪽
    sign = (pos.x * fz - pos.z * fx) > 0 ? -1 : 1;
  }
  const step = Math.min(maxStep, need - Math.abs(side));
  if (step > 0) {
    pos.x += fz * sign * step;
    pos.z -= fx * sign * step;
  }
  return true;
}

export class GameSim {
  /**
   * 생성 직후 상태는 마을이다(플레이어 · 허수아비가 있는 유효한 GameState). 생성자는 이벤트를 내지 않는다.
   * PROFILE_CHANGED를 구독한다 — mode === 'town'이면 refreshStats(true).
   * 난수: 보스전마다 hashSeed(seed ?? profile.seed, 그 보스의 attempts), 마을은 seed ?? profile.seed.
   * @param {{profile:Profile, bus:EventBus, seed?:number}} opts
   */
  constructor(opts) {
    this.profile = opts.profile;
    this.bus = opts.bus;
    this._seed = opts.seed;
    this._flushing = false;
    this._rng = createRng(this._seed ?? this.profile.seed);

    const world = getWorld(TOWN_ID);
    /** @type {GameState} 바깥은 읽기만 한다 */
    this.state = {
      mode: 'town',
      tick: 0,
      time: 0,
      hitstop: 0,
      world,
      player: createPlayerState(computeStatBlock(this.profile), world.playerSpawn),
      boss: null,
      dummy: createDummyState(world),
      projectiles: [],
      hazards: [],
      telegraphs: [],
      fight: null,
      nearFacility: null,
      profile: this.profile,
      debug: { godMode: false, noStamina: false },
      events: [],
      hitLog: [],
      rngState: this._rng.getState(),
      nextId: 1,
    };

    /** P1 · P3의 틱 진입점. @private */
    this._ops = { updatePlayer, bufferPlayerInput, getPlayerHit, updateBoss, getBossHits, getBossTelegraphs };

    const state = this.state;
    /** 틱 컨텍스트 — 한 번 만들어 재사용한다. state · rng는 수명 내내 같은 객체다. @type {SimCtx} */
    const ctx = {
      state,
      rng: this._rng,
      emit: (name, payload = {}) => {
        state.events.push({ name, payload });
      },
      nextHitId: () => {
        const id = state.nextId;
        state.nextId += 1;
        return id;
      },
      requestHitstop: (seconds) => {
        if (!(seconds > 0)) return;
        state.hitstop = Math.min(COMBAT.hitstopMax, Math.max(state.hitstop, seconds));
        ctx.emit(EV.HITSTOP, { dur: state.hitstop });
      },
      shake: (amp, dur) => {
        ctx.emit(EV.CAMERA_SHAKE, { amp, dur });
      },
      spawnProjectile: (spec, x, z, dir, damageMul) => spawnProjectile(ctx, spec, x, z, dir, damageMul),
      spawnHazard: (spec, x, z, facing, damageMul) => spawnHazard(ctx, spec, x, z, facing, damageMul),
      bossDef: null,
      bossHooks: {},
      scaling: NEUTRAL_SCALING,
    };
    this._ctx = ctx;

    this._offProfile = this.bus.on(EV.PROFILE_CHANGED, () => {
      if (this.state.mode === 'town') this.refreshStats(true);
    });
  }

  /**
   * 마을로. computeStatBlock(profile)을 다시 계산해 플레이어를 playerSpawn에 새로 만든다(HP · 스태미나 · 플라스크 가득).
   * 보스 · 투사체 · 장판 · fight · hitLog 제거. MODE_CHANGED를 내고 플러시.
   */
  enterTown() {
    const s = this.state;
    const ctx = this._ctx;
    const world = getWorld(TOWN_ID);
    ctx.bossDef = null;
    ctx.bossHooks = {};
    ctx.scaling = NEUTRAL_SCALING;
    this._rng.setState(this._seed ?? this.profile.seed);
    s.mode = 'town';
    s.world = world;
    s.hitstop = 0;
    s.player = createPlayerState(computeStatBlock(this.profile), world.playerSpawn);
    s.boss = null;
    s.dummy = createDummyState(world);
    s.telegraphs = [];
    s.fight = null;
    s.hitLog = [];
    s.rngState = this._rng.getState();
    ctx.emit(EV.MODE_CHANGED, { mode: 'town', worldId: world.id, bossId: null });
    this._leaveWorld();
    this._flush();
  }

  /**
   * 보스전 시작. noteAttempt → 능력치 재계산 → 플레이어/보스 생성 → fight = {phase:'intro'} · hitLog 비움.
   * PLAYER.lockOn.autoOnFight면 player.lockOn = true.
   * MODE_CHANGED · FIGHT_STARTED · FIGHT_PHASE(· LOCKON_CHANGED{on:true})를 내고 플러시. 해금 여부는 검사하지 않는다(호출자 책임).
   * @param {BossId} bossId
   * @param {{def?:BossDef, hooks?:BossHooks}} [override] 테스트용 주입
   */
  startBossFight(bossId, override) {
    const s = this.state;
    const ctx = this._ctx;
    const def = override?.def ?? getBossDef(bossId);
    const hooks = override?.hooks ?? getBossHooks(bossId);
    const world = getWorld(def.arenaId);
    noteAttempt(this.profile, bossId);
    const scaling = getCycleScaling(this.profile.cycle);
    const attempts = this.profile.bosses[bossId]?.attempts ?? 0;
    ctx.bossDef = def;
    ctx.bossHooks = hooks;
    ctx.scaling = scaling;
    this._rng.setState(hashSeed(this._seed ?? this.profile.seed, attempts));
    s.mode = 'boss';
    s.world = world;
    s.hitstop = 0;
    s.player = createPlayerState(computeStatBlock(this.profile), world.playerSpawn);
    s.boss = createBossState(def, scaling, world.bossSpawn);
    s.dummy = null;
    s.telegraphs = [];
    s.hitLog = [];
    s.fight = {
      bossId,
      phase: 'intro',
      time: 0,
      phaseTime: 0,
      damageDealt: 0,
      damageTaken: 0,
      parries: 0,
      executions: 0,
      outcome: null,
      reward: null,
    };
    s.rngState = this._rng.getState();
    ctx.emit(EV.MODE_CHANGED, { mode: 'boss', worldId: world.id, bossId });
    this._leaveWorld();
    ctx.emit(EV.FIGHT_STARTED, { bossId, cycle: this.profile.cycle, hpMax: s.boss.hpMax });
    ctx.emit(EV.FIGHT_PHASE, { phase: 'intro' });
    if (PLAYER.lockOn.autoOnFight) {
      // 죽고 재도전할 때마다 다시 누르지 않게 켠 채로 시작한다.
      s.player.lockOn = true;
      ctx.emit(EV.LOCKON_CHANGED, { on: true });
    }
    this._flush();
  }

  /**
   * 보스전을 포기하고 지금까지 준 피해만큼 사망 보상을 받는다(일시정지 → 마을로). fight.phase === 'fight'일 때만 동작:
   * 투사체 · 장판 정리 → computeReward(victory:false) → applyReward → fight.outcome = 'death' · fight.reward
   * → REWARD_GRANTED · PROFILE_CHANGED{reward} · FIGHT_PHASE{done} → phase = 'done'. (outro · PLAYER_DIED · FIGHT_ENDED 없음)
   * 그 밖의 phase(intro · outro · done)나 마을에서는 아무것도 하지 않는다.
   * @returns {RewardResult|null}
   */
  forfeitFight() {
    const fight = this.state.fight;
    if (this.state.mode !== 'boss' || !fight || fight.phase !== 'fight') return null;
    const ctx = this._ctx;
    clearProjectiles(ctx);
    clearHazards(ctx);
    this.state.telegraphs = [];
    const reward = this._grantReward(false);
    fight.phase = 'done';
    fight.phaseTime = 0;
    ctx.emit(EV.FIGHT_PHASE, { phase: 'done' });
    this._flush();
    return reward;
  }

  /** 마을에서만: HP · 스태미나 · 플라스크 가득. PLAYER_RESTED. */
  restAtBonfire() {
    if (this.state.mode === 'town') {
      applyStatsToPlayer(this.state.player, computeStatBlock(this.profile), true);
      this._ctx.emit(EV.PLAYER_RESTED, {});
    }
    this._flush();
  }

  /**
   * computeStatBlock(profile)을 다시 불러 플레이어에 적용(applyStatsToPlayer).
   * @param {boolean} refill
   */
  refreshStats(refill) {
    applyStatsToPlayer(this.state.player, computeStatBlock(this.profile), !!refill);
    this._flush();
  }

  /**
   * 한 틱(§5.1). dt는 항상 DT.
   * @param {number} dt
   * @param {InputFrame} input
   */
  step(dt, input) {
    const s = this.state;
    const ctx = this._ctx;
    const ops = this._ops;
    const player = s.player;
    const boss = s.boss;
    const fight = s.fight;

    // A. tick · prev 복사 (히트스톱 틱에도 돈다 → prev = cur이 되어 화면이 멈춘다)
    s.tick += 1;
    player.prevPos.x = player.pos.x;
    player.prevPos.z = player.pos.z;
    player.prevFacing = player.facing;
    if (boss) {
      boss.prevPos.x = boss.pos.x;
      boss.prevPos.z = boss.pos.z;
      boss.prevFacing = boss.facing;
      boss.prevY = boss.y;
    }
    for (let i = 0; i < s.projectiles.length; i++) {
      const pr = s.projectiles[i];
      pr.prevX = pr.x;
      pr.prevZ = pr.z;
    }

    // B. 결과 화면 동안 세계 정지
    if (fight && fight.phase === 'done') return this._endTick();

    // C. 히트스톱 — 선입력과 록온 토글만 받는다. time은 진행하지 않는다.
    if (s.hitstop > 0) {
      // 부동소수 찌꺼기(1e-17) 때문에 한 틱 더 멈추지 않게 EPS 아래는 0으로 본다.
      const left = s.hitstop - dt;
      s.hitstop = left > EPS ? left : 0;
      ops.bufferPlayerInput(ctx, input, dt);
      return this._endTick();
    }

    // D.
    s.time += dt;

    // E · F. 상대 상태는 읽기만 한다(F는 E가 끝난 플레이어 위치를 본다).
    ops.updatePlayer(ctx, input, dt);
    if (boss) ops.updateBoss(ctx, dt);

    // G. 충돌 해소
    this._resolveCollisions();

    // H.
    updateProjectiles(ctx, dt);
    updateHazards(ctx, dt);

    // I. 판정 해소 — I0: 양쪽 판정을 먼저 수집한다(맞교환: I1이 보스 공격을 끊어도 이번 틱의 판정은 유효하다).
    const pHit = ops.getPlayerHit(ctx);
    const bHits = boss ? ops.getBossHits(ctx) : NO_HITS;
    if (s.mode === 'boss') {
      if (pHit) resolveHitOnBoss(ctx, pHit); // I1
      // 승리 틱에는 플레이어가 맞지 않는다.
      if (boss && boss.hp > 0) {
        for (let i = 0; i < bHits.length; i++) resolveHitOnPlayer(ctx, bHits[i]); // I2
        resolveProjectiles(ctx); // I3
        resolveHazards(ctx); // I4
      }
      this._updateFight(dt); // J
    } else {
      if (pHit) resolveHitOnDummy(ctx, pHit); // I1
      updateTown(ctx, input, dt); // K
      updateDummy(ctx, dt);
    }

    // L.
    this._rebuildTelegraphs();

    // M.
    return this._endTick();
  }

  /** 디버그. @param {{godMode?:boolean, noStamina?:boolean}} partial */
  setDebug(partial) {
    Object.assign(this.state.debug, partial);
    this._flush();
  }

  /** 판정 파이프라인을 거쳐 보스에 피해(HIT 이벤트 포함). 무적 무시. @param {number} amount */
  debugDamageBoss(amount) {
    const s = this.state;
    const ctx = this._ctx;
    const boss = s.boss;
    if (boss && s.fight && s.fight.phase !== 'done') {
      const p = s.player;
      resolveHitOnBoss(ctx, {
        source: 'player',
        attackId: 'debug',
        hitId: ctx.nextHitId(),
        shapeDef: { type: 'circle', r: 0 },
        x: p.pos.x,
        z: p.pos.z,
        facing: p.facing,
        damage: amount,
        posture: 0,
        guardable: false,
        parryable: false,
        knockdown: false,
        heavy: false,
        execute: false,
        hitstop: 0,
      }, { force: true });
    }
    this._flush();
  }

  /** hp만 바꾼다(다음 틱에 updateBoss의 폴링이 페이즈 전환/사망을 처리한다 — §8.7). @param {number} f 0..1 */
  debugSetBossHpFraction(f) {
    const boss = this.state.boss;
    if (boss) boss.hp = Math.round(boss.hpMax * clamp01(Number(f) || 0));
    this._flush();
  }

  /** 구독 해제. */
  dispose() {
    if (this._offProfile) this._offProfile();
    this._offProfile = null;
  }

  /**
   * 이전 월드에 남은 것을 치운다(모드 전환). MODE_CHANGED 뒤에 부른다 — 전환의 첫 이벤트는 항상 MODE_CHANGED다.
   * @private
   */
  _leaveWorld() {
    const s = this.state;
    const ctx = this._ctx;
    clearProjectiles(ctx);
    clearHazards(ctx);
    ctx._interactCd = 0;
    if (s.nearFacility !== null) {
      s.nearFacility = null;
      ctx.emit(EV.NEAR_FACILITY_CHANGED, { id: null });
    }
  }

  /**
   * §5.1 G. 플레이어만 밀려난다 — 보스는 플레이어에게 밀리지 않는다.
   * @private
   */
  _resolveCollisions() {
    const s = this.state;
    const player = s.player;
    const boss = s.boss;
    const world = s.world;
    resolveCircleVsWorld(player.pos, player.radius, world); // G1
    let pushed = false;
    if (boss) {
      resolveCircleVsWorld(boss.pos, boss.radius, world); // G2
      // G3. 쓰러진 보스는 밀지 않는다.
      if (boss.state !== 'dead' && boss.hp > 0) {
        const parts = this._ctx.bossDef?.bodyParts;
        const sin = Math.sin(boss.facing);
        const cos = Math.cos(boss.facing);
        // 돌진 중에는 옆으로 비켜 세운다(W3) — 중심선 방향으로 밀면 일직선의 플레이어를 끝까지 밀고 간다.
        const charging = this._bossCharging();
        const shove = charging ? COMBAT.chargeShoveSpeed * DT : 0;
        if (parts && parts.length > 0) {
          for (let i = 0; i < parts.length; i++) {
            const px = boss.pos.x + parts[i].fwd * sin;
            const pz = boss.pos.z + parts[i].fwd * cos;
            const hit = charging
              ? shoveAside(player.pos, player.radius, px, pz, parts[i].r, sin, cos, shove)
              : pushOutOfCircle(player.pos, player.radius, px, pz, parts[i].r);
            if (hit) pushed = true;
          }
        } else if (charging
          ? shoveAside(player.pos, player.radius, boss.pos.x, boss.pos.z, boss.radius, sin, cos, shove)
          : pushOutOfCircle(player.pos, player.radius, boss.pos.x, boss.pos.z, boss.radius)) {
          pushed = true;
        }
      }
    }
    const dummy = s.dummy;
    if (dummy && pushOutOfCircle(player.pos, player.radius, dummy.x, dummy.z, dummy.radius)) pushed = true;
    // G4. 벽이 우선이다 — 그 결과 보스 원과 다시 겹치는 것은 허용한다.
    if (pushed) resolveCircleVsWorld(player.pos, player.radius, world);
  }

  /**
   * 보스가 이번 틱에 돌진(move.kind 'charge')으로 달리는 중인가(§5.1 G3 · §8.4).
   * @private
   * @returns {boolean}
   */
  _bossCharging() {
    const boss = this.state.boss;
    const def = this._ctx.bossDef;
    const atk = boss ? boss.attack : null;
    if (!boss || !def || boss.state !== 'attack' || !atk) return false;
    const ad = def.attacks ? def.attacks[atk.id] : null;
    const mv = ad ? ad.move : null;
    if (!mv || mv.kind !== 'charge') return false;
    const tA = atk.t - atk.windup;
    return tA >= mv.t0 - EPS && tA <= mv.t1 + EPS;
  }

  /**
   * §5.1 J — HP로 판정한다(상태 이름에 기대지 않는다).
   * @private
   * @param {number} dt
   */
  _updateFight(dt) {
    const s = this.state;
    const ctx = this._ctx;
    const fight = s.fight;
    const boss = s.boss;
    if (!fight || !boss) return;
    fight.phaseTime += dt;
    switch (fight.phase) {
      case 'intro':
        if (boss.state !== 'intro' || fight.phaseTime >= ctx.bossDef.introDur) this._setFightPhase('fight');
        break;
      case 'fight': {
        fight.time += dt;
        // 둘 다 0이면(디버그) 승리로 본다.
        const victory = boss.hp <= 0;
        if (!victory && s.player.hp > 0) break;
        clearProjectiles(ctx);
        clearHazards(ctx);
        if (victory) ctx.emit(EV.BOSS_DEFEATED, { bossId: fight.bossId, x: boss.pos.x, z: boss.pos.z });
        else ctx.emit(EV.PLAYER_DIED, { x: s.player.pos.x, z: s.player.pos.z, bossId: fight.bossId });
        this._grantReward(victory);
        this._setFightPhase('outro');
        break;
      }
      case 'outro': {
        const dur = fight.outcome === 'victory' ? COMBAT.outroVictory : COMBAT.outroDeath;
        if (fight.phaseTime < dur) break;
        // 사망 뒤 보스가 마저 낸 것까지 치우고 세계를 멈춘다.
        clearProjectiles(ctx);
        clearHazards(ctx);
        this._setFightPhase('done');
        ctx.emit(EV.FIGHT_ENDED, {
          bossId: fight.bossId,
          outcome: fight.outcome,
          reward: fight.reward,
          duration: fight.time,
          damageFraction: fight.reward ? fight.reward.damageFraction : 0,
        });
        break;
      }
      default:
    }
  }

  /** @private @param {'intro'|'fight'|'outro'|'done'} phase */
  _setFightPhase(phase) {
    const fight = this.state.fight;
    fight.phase = phase;
    fight.phaseTime = 0;
    this._ctx.emit(EV.FIGHT_PHASE, { phase });
  }

  /**
   * 보상 계산 · 지급 · 이벤트(REWARD_GRANTED → PROFILE_CHANGED{reward} → CYCLE_ADVANCED). fight.outcome · fight.reward를 채운다.
   * @private
   * @param {boolean} victory
   * @returns {RewardResult}
   */
  _grantReward(victory) {
    const s = this.state;
    const ctx = this._ctx;
    const fight = s.fight;
    const boss = s.boss;
    const damageFraction = boss.hpMax > 0 ? clamp01(fight.damageDealt / boss.hpMax) : 0;
    const reward = computeReward(this.profile, fight.bossId, { victory, damageFraction, duration: fight.time });
    applyReward(this.profile, reward);
    fight.outcome = victory ? 'victory' : 'death';
    fight.reward = reward;
    ctx.emit(EV.REWARD_GRANTED, { reward });
    ctx.emit(EV.PROFILE_CHANGED, { reason: 'reward' });
    if (reward.cycleAdvanced) ctx.emit(EV.CYCLE_ADVANCED, { cycle: this.profile.cycle });
    return reward;
  }

  /**
   * §5.1 L — 보스의 예고 표식(월드로 푼다) + warn 중인 장판. 그릴 것이 없으면 빈 배열을 그대로 둔다.
   * @private
   */
  _rebuildTelegraphs() {
    const s = this.state;
    const boss = s.boss;
    const fighting = boss !== null && boss.hp > 0 && s.fight !== null && s.fight.phase !== 'done';
    const srcs = fighting ? this._ops.getBossTelegraphs(this._ctx) : NO_HITS;
    let warnCount = 0;
    for (let i = 0; i < s.hazards.length; i++) if (s.hazards[i].state === 'warn') warnCount += 1;
    if (srcs.length === 0 && warnCount === 0) {
      if (s.telegraphs.length > 0) s.telegraphs = [];
      return;
    }
    const out = [];
    for (let i = 0; i < srcs.length; i++) {
      const t = srcs[i];
      out.push({
        id: t.id,
        shape: resolveShape(t.shapeDef, t.x, t.z, t.facing),
        progress: clamp01(t.progress),
        style: t.style,
        source: 'boss',
      });
    }
    for (let i = 0; i < s.hazards.length; i++) {
      const h = s.hazards[i];
      if (h.state !== 'warn') continue;
      out.push({
        id: `hz:${h.id}`,
        shape: { ...h.shape },
        progress: h.warn > 0 ? clamp01(h.t / h.warn) : 1,
        style: h.style,
        source: 'hazard',
      });
    }
    s.telegraphs = out;
  }

  /** §5.1 M. @private */
  _endTick() {
    this.state.rngState = this._rng.getState();
    this._flush();
  }

  /** §4.1 — 재진입에 안전한 플러시. step의 끝과 모든 공개 명령 메서드의 끝에서 부른다. @private */
  _flush() {
    if (this._flushing) return; // 안쪽 호출은 큐에 쌓기만 한다
    this._flushing = true;
    try {
      while (this.state.events.length) {
        const q = this.state.events;
        this.state.events = [];
        for (const e of q) this.bus.emit(e.name, e.payload);
      }
    } finally {
      this._flushing = false;
    }
  }
}
