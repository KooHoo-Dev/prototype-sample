// OWNER: P15 — 계약 §6.16 · §12.1 · §11.13
// 자동 플레이어. 사람처럼 매 틱 InputFrame 하나(커서 = 노리는 월드 점 · hover = 노리는 대상 src 'pick')만 만든다 — sim 은 사람의 입력과 같은 대상 검사(§5.2-1)를 한다.
// 보는 것은 플레이어에서 BOT.viewR 안(sense.js) · 반응 지연 N(0.22, 0.06) · 클릭 실수 2% · 예고를 알아챌 확률 0.9(무회피 0).
// step 뒤(afterStep): (autoCommit) 전환 commit · 스킬 배분 · 장착 · 사망이면 부활 · 마을 정비 명령 · 균열 레벨 선택.
// 봇의 난수는 자기 {s}(생성자의 seed) — sim 의 난수 줄기를 쓰지 않는다(결정성). bot/* 는 GameSim.js 를 import 하지 않는다(sim 인스턴스를 인자로 받는다).

import { SKILL_BAR } from '../core/constants.js';
import { hash32 } from '../core/hash.js';
import { makeRng, seedRng } from '../core/rng.js';
import { ticks } from '../core/time.js';
import { BOT, BOT_RULES } from '../data/bot.js';
import { DEATH } from '../data/combat.js';
import { isWalkableR, nearestWalkable } from '../sim/world/nav.js';
import { allocatePoints, RANDOM_BUILD } from './build.js';
import { currentTarget, dodgeInput, fightInput, globeInput, rangedBasic } from './combat.js';
import { awakeWithin, checkEquip, lootTarget } from './loot.js';
import { bfs, floorTileNear, makeTileGrid, pickExploreGoal, roomAt, tileIndex, waypointToward } from './nav.js';
import { SeenMemory, createSense, inThreat, senseRift } from './sense.js';
import { planTown, townAfter, townFrame } from './town.js';

/** @typedef {import('../types.js').InputFrame} InputFrame */
/** @typedef {import('../types.js').MonsterState} MonsterState */

export { RANDOM_BUILD };

const TAU = Math.PI * 2;

/** 매 틱 다시 채우는 입력(봇마다 하나 — 할당을 줄인다 · sim 은 입력을 붙잡지 않는다) @returns {InputFrame} */
function blankInput() {
  return {
    cursor: null, hover: null, lmb: false, lmbDown: false,
    slot: new Array(SKILL_BAR).fill(false), slotDown: new Array(SKILL_BAR).fill(false),
    shift: false, potionDown: false, recallDown: false,
  };
}

export class Bot {
  /**
   * @param {{sim:any, strategy?:'basic'|'noDodge'|'challenge', cls:import('../types.js').ClassId, preset?:number, seed?:number, params?:typeof BOT, autoCommit?:boolean}} opts
   *   autoCommit false 면 afterStep 이 commitTravel 을 부르지 않는다(브라우저 — app 의 전환 막이 commit · §11.13).
   *   preset: 0 · 1 = PRESETS[cls] · RANDOM_BUILD(-1) = 점수 무작위 배분(측정 「스킬 트리가 의미 있다」).
   */
  constructor({ sim, strategy = 'basic', cls, preset = 0, seed = 1, params = BOT, autoCommit = true }) {
    this.sim = sim;
    this.strategy = strategy === 'noDodge' || strategy === 'challenge' ? strategy : 'basic';
    this.cls = cls ?? sim?.state?.char?.cls ?? 'warrior';
    this.preset = preset === RANDOM_BUILD ? RANDOM_BUILD : Number(preset) === 1 ? 1 : 0;
    this.seed = seed >>> 0;
    this.params = params ?? BOT;
    this.rules = BOT_RULES;
    this.autoCommit = autoCommit !== false;
    /** 봇의 난수(자기 {s}) */
    this.rngState = seedRng(hash32(this.seed, BOT_RULES.rngSalt));
    this.rng = makeRng(this.rngState);
    /** 측정이 고정하는 균열 레벨(null = 전략의 레벨 선택) */
    this.levelOverride = /** @type {number|null} */ (null);
    /** 측정이 「이 판을 버리고 새 균열」을 시킬 때(마을에서 포털 대신 균열석) */
    this.abandonRift = false;
    this.ranged = rangedBasic(this.cls);
    /** @type {Array<Object>} */
    this._log = [];
    this.counters = { dodges: 0, dodgeSkills: 0, kites: 0, casts: /** @type {Record<string, number>} */ ({}), equips: 0, sold: 0, repairGold: 0, recalls: 0, keys: 0, stuck: 0 };
    this._inp = blankInput();
    this._cursor = { x: 0, z: 0 };
    this._hover = { kind: /** @type {'monster'|'drop'|'object'} */ ('monster'), id: /** @type {any} */ (0), src: /** @type {'pick'} */ ('pick') };
    this.sv = createSense();
    this.sit = { px: 0, pz: 0, life: 1, resource: 0, combat: false, mons: [], target: null, meleeNear: 0, kiteCount: this.params.kiteCount, walkable: null };
    this.sitPool = [];
    this.skScratch = { cost: 0, angleDeg: 120 };
    this.dodgeCand = [];
    /** 위협 ID → {noticed, at, last} */
    this.threatSeen = new Map();
    /** 표식 묶음(출처 · 시작 틱) → {noticed, at, last} — 한 패턴은 한 번에 알아챈다(밸런스 게이트 · sense.js) */
    this.threatGroups = new Map();
    /** 몬스터 ID → 다시 고를 수 있는 틱(포기) */
    this.ignore = new Map();
    this.tg = { id: /** @type {number|null} */ (null), lastRatio: 1, lastHitAt: 0, nextId: /** @type {number|null} */ (null), nextAt: 0 };
    this.dodge = /** @type {{x:number, z:number, until:number, skill:boolean}|null} */ (null);
    this.kite = /** @type {{x:number, z:number}|null} */ (null);
    this.kiteUntil = -1;
    this.kiteNextAt = -1;
    this.kiteArmed = true;
    this.kiteCalmSince = -1;
    this.pressedAt = new Array(SKILL_BAR).fill(-1);
    this.clickReadyAt = -1;
    this.lowLifeAt = -1;
    this.deadAt = -1;
    this.respawnAt = -1;
    this.bagBlocked = false;
    this.lootIgnore = new Map();
    this.lootTry = { id: -1, since: 0, last: -1e9 };
    /** 줍기 진척 시계(리뷰 수정 — loot.js lootTarget) — 바닥 드랍 수가 줄지 않은 채 줍기를 이어 간 시간 */
    this.lootStall = { since: 0, last: -1e9, live: Infinity };
    this.equipSeen = { level: -1, ids: new Set() };
    this.townPlan = null;
    this.lastScene = null;
    /** 지금 균열(상태 객체 — 마을에 다녀오면 shiftTicks 가 시각 필드를 밀므로 시각이 아니라 객체로 본다) */
    this.riftRef = null;
    /** 균열마다의 기억 — 본 몬스터 · 들어선 방 · 막힌 목표 · 길 */
    this.mem = this._freshMem();
    this.stuck = { x: 0, z: 0, at: -1, work: 0, until: -1, tx: 0, tz: 0 };
    /** @type {Set<number>} 탐색 목표를 고를 때 살아 있는 몬스터 ID(재사용) */
    this.aliveIds = new Set();
    this.walkable = (x, z) => {
      const map = this.sim.ctx.map;
      const p = this.sim.state.player;
      return !!map && isWalkableR(map, x, z, p.r) && !inThreat(this.sv, x, z, p.r + this.rules.dodgeSafePad);
    };
    this.sit.walkable = this.walkable;
  }

  _freshMem() {
    return {
      seen: new SeenMemory(), visited: new Set(), skip: new Set(), grid: /** @type {any} */ (null),
      goal: /** @type {any} */ (null), wp: /** @type {{x:number, z:number}|null} */ (null), wpAt: -1, goalFails: 0, guardian: /** @type {{x:number, z:number}|null} */ (null),
      fight: { x: 0, z: 0, d: 0, tick: -1e9 },
      exitWp: /** @type {{x:number, z:number}|null} */ (null), exitWpAt: -1,   // 나가는 포털로 가는 타일 길(밸런스 게이트)
    };
  }

  // ───────────────────────── 공개 ─────────────────────────

  /** 이번 틱의 입력(§6.16) @returns {InputFrame} */
  frame() {
    const st = this.sim.state;
    const inp = this._inp;
    resetInput(inp);
    if (!st.char || st.pendingTravel || st.player.dead) return inp;
    if (st.scene === 'town') {
      if (!this.townPlan || this.lastScene !== 'town') { this.townPlan = planTown(this); this.lastScene = 'town'; }
      townFrame(this, inp);
    } else if (st.scene === 'rift' && st.rift) {
      if (this.lastScene !== 'rift') { this.lastScene = 'rift'; this.townPlan = null; }
      this._syncRift();
      this._riftFrame(inp);
    }
    return inp;
  }

  /** step 뒤 — (autoCommit) commit · 장면 · 스킬 · 장착 · 사망 · 마을 명령(§6.16) */
  afterStep() {
    const sim = this.sim;
    const st = sim.state;
    if (this.autoCommit && st.pendingTravel) sim.commitTravel();
    if (!st.char) return;
    if (st.scene !== this.lastScene) {
      this.lastScene = st.scene;
      if (st.scene === 'town') this.townPlan = st.pendingTravel ? null : planTown(this);
      else this.townPlan = null;
    }
    if (st.pendingTravel) return;
    allocatePoints(this);
    checkEquip(this);
    const p = st.player;
    if (p.dead) {
      if (this.deadAt < 0) {
        this.deadAt = st.tick;
        this.respawnAt = st.tick + Math.max(this.reactTicks(), ticks(DEATH.panelDelay));
        this.note('died', { level: st.rift?.level ?? 0, lives: st.rift?.lives ?? 0 });
      }
      if (st.tick >= this.respawnAt) {
        const r = sim.respawn();
        this.counters.keys++;
        this.note('respawn', { ok: !!r?.ok });
        this.respawnAt = st.tick + 30;   // 실패하면 1초 뒤 다시
        if (this.autoCommit && st.pendingTravel) sim.commitTravel();
        this._afterCommit();
      }
      return;
    }
    this.deadAt = -1;
    if (st.scene === 'town') {
      if (!this.townPlan) this.townPlan = planTown(this);
      townAfter(this);
      if (this.townPlan && this.townPlan.done && !st.pendingTravel && this.townPlan.mode !== 'return') {
        // 할 일이 끝났는데 마을에 그대로다(포털이 닫혔다 등) — 새 균열로
        this.townPlan = planTown(this);
        if (this.townPlan.mode === 'portal') { this.abandonRift = true; this.townPlan = planTown(this); }
      }
    }
    if (this.autoCommit && st.pendingTravel) {
      sim.commitTravel();
      this._afterCommit();
    }
  }

  /** 결정 기록(측정용 · 순수 배열) */
  get log() {
    return this._log;
  }

  // ───────────────────────── 도우미(봇 파일들이 쓴다) ─────────────────────────

  /** 반응 지연(틱) — N(reactSec, reactSd)을 [reactMin, reactMax]로 자른다 */
  reactTicks() {
    const u1 = Math.max(1e-9, this.rng.next()), u2 = this.rng.next();
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
    const sec = Math.min(this.rules.reactMax, Math.max(this.rules.reactMin, this.params.reactSec + n * this.params.reactSd));
    return Math.max(1, ticks(sec));
  }

  /** 결정 기록 한 줄 @param {string} kind @param {Object} [data] */
  note(kind, data = {}) {
    const st = this.sim.state;
    this._log.push({ tick: st.tick, kind, ...data });
    if (this._log.length > this.rules.logMax) this._log.splice(0, this._log.length - this.rules.logMax);
  }

  /** 커서만(hover 없음) @param {InputFrame} inp @param {number} x @param {number} z */
  setCursor(inp, x, z) {
    this._cursor.x = x;
    this._cursor.z = z;
    inp.cursor = this._cursor;
    inp.hover = null;
  }

  /** 클릭 실수 — missClick 확률로 커서를 missOffset 안에서 흐트린다(누름 에지마다 한 번) @param {InputFrame} inp */
  _miss(inp) {
    if (!inp.cursor) return;
    if (!this.rng.chance(this.params.missClick)) return;
    const a = this.rng.range(0, TAU), d = Math.sqrt(this.rng.next()) * this.params.missOffset;
    this._cursor.x += Math.sin(a) * d;
    this._cursor.z += Math.cos(a) * d;
  }

  /**
   * 땅을 눌러 이동(좌클릭 누르고 있기 — move-follow). edge 면 이번 틱에 누름 에지(그 밖에는 의도가 이동이 아닐 때만 · pressGap 간격)
   * @param {InputFrame} inp @param {number} x @param {number} z @param {boolean} edge
   */
  moveTo(inp, x, z, edge) {
    const st = this.sim.state;
    const p = st.player;
    this.setCursor(inp, x, z);
    inp.lmb = true;
    const it = p.intent;
    const need = !(it && it.kind === 'move' && it.held);
    if (edge || (need && st.tick >= this.clickReadyAt)) {
      inp.lmbDown = true;
      this.clickReadyAt = st.tick + this.rules.pressGap;
      this._miss(inp);
    }
  }

  /** 대상 몬스터를 누르고 있기(기본 공격 의도) @param {InputFrame} inp @param {MonsterState} m */
  attack(inp, m) {
    const st = this.sim.state;
    const p = st.player;
    this.setCursor(inp, m.pos.x, m.pos.z);
    this._hover.kind = 'monster';
    this._hover.id = m.id;
    inp.hover = /** @type {any} */ (this._hover);
    inp.lmb = true;
    const it = p.intent;
    const holding = it && it.kind === 'attack' && it.targetId === m.id && it.held;
    // 선입력이 있으면 덮어쓰지 않는다(누른 스킬이 잠김이 풀린 틱에 나가게 — 새 누름이 버퍼를 덮어쓴다 §5.3)
    if (!holding && !p.buffer && st.tick >= this.clickReadyAt) {
      inp.lmbDown = true;
      this.clickReadyAt = st.tick + this.rules.pressGap;
    }
  }

  /** 드랍 · 물체 누르기(한 번 — 걸어가는 것은 sim 의 의도) @param {InputFrame} inp @param {'drop'|'object'} kind @param {number|string} id @param {number} x @param {number} z @param {boolean} edge */
  _clickThing(inp, kind, id, x, z, edge) {
    this.setCursor(inp, x, z);
    this._hover.kind = kind;
    this._hover.id = id;
    inp.hover = /** @type {any} */ (this._hover);
    if (edge) {
      inp.lmb = true;
      inp.lmbDown = true;
      this.clickReadyAt = this.sim.state.tick + this.rules.pressGap;
    }
  }

  /** 마을 물체 · 균열 포털 누르기 @param {InputFrame} inp @param {string} id @param {number} x @param {number} z @param {boolean} edge */
  clickObject(inp, id, x, z, edge) { this._clickThing(inp, 'object', id, x, z, edge); }

  /** 스킬 칸 누름(에지 한 번) — 커서 = 목표 · hover = 대상 몬스터(있으면) @param {InputFrame} inp @param {number} i @param {number} x @param {number} z @param {MonsterState|null} mon */
  pressSlot(inp, i, x, z, mon) {
    const st = this.sim.state;
    this.setCursor(inp, x, z);
    if (mon) {
      this._hover.kind = 'monster';
      this._hover.id = mon.id;
      inp.hover = /** @type {any} */ (this._hover);
    }
    inp.slot[i] = true;
    inp.slotDown[i] = true;
    this.pressedAt[i] = st.tick + this.rules.pressGap;
    this._miss(inp);
    // 좌클릭을 누르고 있던 공격은 그대로 둔다(스킬이 끝나면 이어진다)
    const it = st.player.intent;
    if (it && it.kind === 'attack' && it.held) inp.lmb = true;
  }

  /** 스킬 칸 누르고 있기(채널 — 회오리) @param {InputFrame} inp @param {number} i @param {number} x @param {number} z */
  holdSlot(inp, i, x, z) {
    const st = this.sim.state;
    this.setCursor(inp, x, z);
    inp.slot[i] = true;
    const ch = st.player.channel;
    if (!(st.player.act === 'channel' && ch)) {
      inp.slotDown[i] = true;
      this.pressedAt[i] = st.tick + this.rules.pressGap;
    }
  }

  // ───────────────────────── 균열 ─────────────────────────

  /** 새 균열이면 균열 기억을 새로 */
  _syncRift() {
    const st = this.sim.state;
    const rift = st.rift;
    if (rift !== this.riftRef) {
      this.riftRef = rift;
      this.mem = this._freshMem();
      this.threatSeen.clear();
      this.threatGroups.clear();
      this.ignore.clear();
      this.lootIgnore.clear();
      this.tg.id = null;
      this.tg.nextId = null;
      this.dodge = null;
      this.kiteUntil = -1;
      this.note('enterRift', { level: rift.level, seed: rift.seed });
    }
    const map = this.sim.ctx.map;
    if (map && (!this.mem.grid || this.mem.grid.id !== map.id)) this.mem.grid = makeTileGrid(map);
  }

  /** commit 직후(같은 afterStep 안) — 장면 기록 갱신 */
  _afterCommit() {
    const st = this.sim.state;
    if (st.pendingTravel || st.scene === this.lastScene) return;
    this.lastScene = st.scene;
    this.townPlan = st.scene === 'town' ? planTown(this) : null;
  }

  /**
   * 균열 한 틱: 시야 → 포션 → (귀환 시전 중이면 가만히) → 끼임 풀기 → 피하기 → 완료 뒤 줍기 · 나가는 포털 → 구슬 → 싸움(깨어 있는 대상) →
   * 줍기 → 가방이 차면 귀환 → 잠든 대상 → 탐색
   * @param {InputFrame} inp
   */
  _riftFrame(inp) {
    const st = this.sim.state;
    const rift = st.rift;
    const p = st.player;
    const tick = st.tick;
    const sv = senseRift(this);
    this._potion(inp);
    const goal = this.tg.id !== null ? this._targetPos() : this.mem.wp;
    if (dodgeInput(this, sv, inp, goal)) return;   // 귀환 시전 중이어도 피한다(새 입력이 귀환을 끊는다 — 사람도 그렇다)
    if (p.act === 'recall' || p.recall) return;   // 귀환 시전 — 다른 입력이 끊는다
    if (this._unstick(inp)) return;
    // 완료 뒤 — 남은 장비를 줍고 나가는 포털
    if (rift.phase === 'complete') {
      const d = lootTarget(this, sv);
      if (d) { this._clickDrop(inp, d); return; }
      this._exitPortal(inp);
      return;
    }
    if (globeInput(this, sv, inp)) return;
    const awakeNear = sv.awakeN > 0;
    if (awakeNear) {
      const T = currentTarget(this, sv, false);
      if (T) { fightInput(this, sv, inp, T); return; }
      if (this.tg.nextId !== null) { this._hold(inp); return; }   // 반응 지연 — 하던 것을 잠깐 이어 간다
    }
    const d = lootTarget(this, sv);
    if (d) { this._clickDrop(inp, d); return; }
    // 밸런스 게이트: 수호자 단계에서는 귀환하지 않는다 — 원거리 마법사가 수호자에게서 lootSafeR 밖이라 보스 싸움 한가운데 귀환했다(완료 마무리 직전에 떠난 판 · NOTES-BALANCE)
    if (this.bagBlocked && st.char.scrolls > 0 && rift.phase !== 'guardian' && !awakeWithin(sv, this.params.lootSafeR)) {
      this._recall(inp);
      return;
    }
    // 방금까지 싸우던 떼가 화면 밖(순간이동 · 도약 · 물러서기 뒤) — 그쪽으로 돌아선다(사람의 기억 · fightMemorySec)
    const f = this.mem.fight;
    if (!awakeNear && tick - f.tick <= ticks(this.rules.fightMemorySec)) {
      this.moveTo(inp, f.x, f.z, false);
      return;
    }
    const T2 = currentTarget(this, sv, true);
    if (T2) { fightInput(this, sv, inp, T2); return; }
    if (this.tg.nextId !== null) { this._hold(inp); return; }
    this._explore(inp);
  }

  /** 지금 대상의 자리(피하기 표본의 「대상에 가까운 점」) */
  _targetPos() {
    const sv = this.sv;
    for (let i = 0; i < sv.mons.length; i++) if (sv.mons[i].id === this.tg.id) return sv.mons[i].pos;
    return null;
  }

  /** 반응 지연 동안 — 하던 이동을 그대로 누르고 있는다 @param {InputFrame} inp */
  _hold(inp) {
    const p = this.sim.state.player;
    const it = p.intent;
    if (it && it.kind === 'move' && it.held && it.point) {
      this.setCursor(inp, it.point.x, it.point.z);
      inp.lmb = true;
    } else if (it && it.kind === 'attack' && it.held) {
      const m = this._monVisible(it.targetId);
      if (m) this.attack(inp, m);
    }
  }

  /** 보이는 몬스터 @param {number|undefined} id */
  _monVisible(id) {
    const sv = this.sv;
    for (let i = 0; i < sv.mons.length; i++) if (sv.mons[i].id === id) return sv.mons[i];
    return null;
  }

  /** 포션 — 생명 < potionAt 을 처음 본 틱에서 반응 지연 뒤 · 포션이 있고 쿨다운이 끝났으면 @param {InputFrame} inp */
  _potion(inp) {
    const st = this.sim.state;
    const p = st.player;
    const ch = st.char;
    const low = p.lifeMax > 0 && p.life / p.lifeMax < this.params.potionAt;
    if (!low) { this.lowLifeAt = -1; return; }
    if (this.lowLifeAt < 0) this.lowLifeAt = st.tick + this.reactTicks();
    if (st.tick >= this.lowLifeAt && ch.potions > 0 && st.tick >= p.potionReadyAt && !(p.potionQueuedUntil > st.tick)) {
      inp.potionDown = true;
      this.lowLifeAt = st.tick + ticks(this.rules.potionRepressSec);   // 같은 하락에 또 누르지 않게(쿨다운이 덮는다)
    }
  }

  /** 드랍 누르기 — 줍기 의도가 그것이 아니면 에지 @param {InputFrame} inp @param {import('../types.js').Drop} d */
  _clickDrop(inp, d) {
    const st = this.sim.state;
    const it = st.player.intent;
    const going = it && it.kind === 'pickup' && it.targetId === d.id;
    const edge = !going && st.tick >= this.clickReadyAt;
    this._clickThing(inp, 'drop', d.id, d.pos.x, d.pos.z, edge);
  }

  /** 귀환 두루마리(T) — 한 번 누르고 시전 동안 가만히 @param {InputFrame} inp */
  _recall(inp) {
    const st = this.sim.state;
    if (st.tick < this.clickReadyAt) return;
    inp.recallDown = true;
    this.clickReadyAt = st.tick + ticks(this.rules.recallGapSec);
    this.counters.recalls++;
    this.note('recall', { bag: true });
  }

  /** 나가는 포털(완료 뒤) — 보이면 누르고, 안 보이면 수호자 자리 쪽으로 @param {InputFrame} inp */
  _exitPortal(inp) {
    const st = this.sim.state;
    const rift = st.rift;
    const p = st.player;
    let portal = null;
    for (const po of rift.portals) if (po.kind === 'exit') portal = po;
    if (portal) {
      // 밸런스 게이트: 멀면(벽 너머 · 화면 밖) 타일 길로 다가간다 — 미니맵의 포털을 보고 걷는 사람(전에는 클릭만 해서 길이 없으면 영영 섰다)
      const R = this.rules;
      const map = this.sim.ctx.map;
      const g = this.mem.grid;
      if (g && map && Math.hypot(portal.pos.x - p.pos.x, portal.pos.z - p.pos.z) > R.exitClickR) {
        const mem = this.mem;
        if (!mem.exitWp || st.tick - mem.exitWpAt >= ticks(R.repathSec) || Math.hypot(p.pos.x - mem.exitWp.x, p.pos.z - mem.exitWp.z) < R.waypointReach) {
          bfs(g, floorTileNear(g, p.pos.x, p.pos.z));
          const t = floorTileNear(g, portal.pos.x, portal.pos.z);
          mem.exitWp = t >= 0 && g.dist[t] > 1 ? waypointToward(g, map, t, R.waypointTiles, p.r) : null;
          mem.exitWpAt = st.tick;
        }
        if (mem.exitWp) { this.moveTo(inp, mem.exitWp.x, mem.exitWp.z, false); return; }
      }
      const it = p.intent;
      const going = it && it.kind === 'interact' && it.objectId === portal.id;
      this.clickObject(inp, portal.id, portal.pos.x, portal.pos.z, !going && st.tick >= this.clickReadyAt);
      return;
    }
    // 포털이 아직(완료 마무리 1.5초) — 서 있는다
  }

  // ───────────────────────── 탐색 ─────────────────────────

  /**
   * 탐색 — 게이지 100%면 수호자 자리(본 자리) · 아니면 끝나지 않은 가장 가까운 방 가운데 → 기억한 몬스터 → 탐색 경계. 타일 BFS 의 길 위 몇 타일 앞을 누른다.
   * @param {InputFrame} inp
   */
  _explore(inp) {
    const st = this.sim.state;
    const rift = st.rift;
    const p = st.player;
    const map = this.sim.ctx.map;
    const mem = this.mem;
    const g = mem.grid;
    const R = this.rules;
    const tick = st.tick;
    if (!map || !g) return;
    if (rift.guardianSpawn) mem.guardian = { x: rift.guardianSpawn.x, z: rift.guardianSpawn.z };
    // 들어선 방
    const ri = roomAt(map, p.pos.x, p.pos.z);
    if (ri >= 0) {
      const r = map.rooms[ri];
      if (Math.hypot(r.cx - p.pos.x, r.cz - p.pos.z) <= R.roomArriveR) mem.visited.add(ri);
    }
    const due = !mem.wp || tick - mem.wpAt >= ticks(R.repathSec) || Math.hypot(p.pos.x - mem.wp.x, p.pos.z - mem.wp.z) < R.waypointReach;
    if (due) {
      const src = floorTileNear(g, p.pos.x, p.pos.z);
      bfs(g, src);
      let goal = null;
      if (rift.phase === 'guardian' && mem.guardian) {
        const t = floorTileNear(g, mem.guardian.x, mem.guardian.z);
        if (t >= 0 && g.dist[t] >= 0) goal = { tile: t, x: mem.guardian.x, z: mem.guardian.z, kind: 'guardian', key: 'guardian', room: -1 };
      }
      if (!goal) {
        const alive = this.aliveIds;
        alive.clear();
        for (const m of rift.mons) if (!m.dead && !m.gone && m.hp > 0) alive.add(m.id);
        goal = pickExploreGoal(g, map, rift.explored, { visited: mem.visited, skip: mem.skip, seen: mem.seen.map, alive: (id) => alive.has(id) }, R.roomDoneFrac);
      }
      if (goal && (!mem.goal || mem.goal.key !== goal.key)) { mem.goal = goal; mem.goalFails = 0; }
      if (!goal) mem.goal = null;
      mem.wp = null;
      if (goal) {
        const here = tileIndex(g, p.pos.x, p.pos.z);
        if (here === goal.tile || g.dist[goal.tile] <= 1) {
          mem.wp = { x: goal.x, z: goal.z };
          const q = nearestWalkable(map, goal.x, goal.z, 2);
          if (q) mem.wp = { x: q.x, z: q.z };
          // 닿았다 — 그 목표는 끝(방은 visited · 몬스터는 보이면 싸운다)
          if (goal.kind === 'room') mem.visited.add(goal.room);
          else if (goal.kind !== 'guardian' && Math.hypot(p.pos.x - goal.x, p.pos.z - goal.z) < 2.5) mem.skip.add(goal.key);
        } else mem.wp = waypointToward(g, map, goal.tile, R.waypointTiles, p.r);
      }
      mem.wpAt = tick;
    }
    if (mem.wp) this.moveTo(inp, mem.wp.x, mem.wp.z, false);
  }

  /**
   * 끼임 풀기 — stuckSec 동안 stuckDist 안 · 준 피해 그대로 · 행동 가능하면 둘레 unstickR 의 걷기 가능 점을 unstickSec 동안 누른다.
   * 같은 목표에서 stuckGoalMax 번 끼이면 그 목표를 버린다. → 이번 틱 입력을 만들었으면 true
   * @param {InputFrame} inp
   */
  _unstick(inp) {
    const st = this.sim.state;
    const p = st.player;
    const rift = st.rift;
    const s = this.stuck;
    const R = this.rules;
    const tick = st.tick;
    const map = this.sim.ctx.map;
    if (s.until > tick) {
      this.moveTo(inp, s.tx, s.tz, false);
      return true;
    }
    const work = rift.stats.dmgDealt + (st.char?.gold ?? 0) * 1e-3 + rift.drops.length * 1e-6;
    // 가려는 곳이 없으면(의도 없음 — 할 일이 없어 서 있다) 끼인 것이 아니다
    const trying = p.intent && p.intent.kind !== 'none';
    if (s.at < 0 || !trying || Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > R.stuckDist || work !== s.work || p.act === 'recall' || this.dodge) {
      s.x = p.pos.x; s.z = p.pos.z; s.at = tick; s.work = work;
      return false;
    }
    if (tick - s.at < ticks(R.stuckSec) || !map) return false;
    // 끼였다
    this.counters.stuck++;
    s.at = tick;
    const base = this.rng.range(0, TAU);
    let found = false;
    for (let k = 0; k < R.unstickTries && !found; k++) {
      const a = base + (k * TAU) / R.unstickTries;
      const x = p.pos.x + Math.sin(a) * R.unstickR, z = p.pos.z + Math.cos(a) * R.unstickR;
      if (isWalkableR(map, x, z, p.r)) { s.tx = x; s.tz = z; found = true; }
    }
    if (!found) return false;
    s.until = tick + ticks(R.unstickSec);
    const mem = this.mem;
    if (mem.goal) {
      mem.goalFails++;
      if (mem.goalFails >= R.stuckGoalMax && mem.goal.kind !== 'guardian') { mem.skip.add(mem.goal.key); mem.goal = null; mem.wp = null; }
    }
    if (this.tg.id !== null) { this.ignore.set(this.tg.id, tick + ticks(R.giveUpIgnoreSec)); this.tg.id = null; }
    this.note('unstick', { x: Math.round(p.pos.x), z: Math.round(p.pos.z) });
    this.moveTo(inp, s.tx, s.tz, true);
    return true;
  }
}

/** 입력 비우기(재사용) @param {InputFrame} inp */
function resetInput(inp) {
  inp.cursor = null;
  inp.hover = null;
  inp.lmb = false;
  inp.lmbDown = false;
  for (let i = 0; i < SKILL_BAR; i++) { inp.slot[i] = false; inp.slotDown[i] = false; }
  inp.shift = false;
  inp.potionDown = false;
  inp.recallDown = false;
}

