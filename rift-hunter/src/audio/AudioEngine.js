// OWNER: P14 — 계약 §6.15 · §9.9 · §9.11
// WebAudio 합성 소리 전부(외부 에셋 0). 소리 표 · 손잡이는 ./sounds.js.
//
// 그래프: 소리(층 → 필터 → 엔벌로프) → 소리 출력 → (팬) → 버스(효과 · UI · 환경) → 마스터 → 리미터(DynamicsCompressor −10dB · 12:1) → 출력
// 규칙:
// - AudioContext 는 unlock()에서 처음 만든다. 그 전의 모든 호출 · 이벤트는 조용히 무시한다(QUALITY §5).
// - 동시 발음 상한 32 · 종류별 상한(sounds.js CATS) · 같은 소리 30ms 안 재발음은 합친다(§9.11).
// - 지속음(회오리 · 귀환 시전 · 환경음)은 update(state)가 상태에서 맞춘다 — 이벤트를 놓쳐도 다음 프레임에 맞는다(§4.1).
// - 메뉴 · 모달 일시정지(PAUSED): 전투 지속음은 멎고 환경음은 줄인다 · UI · 거래음은 그대로(NOTES-P9).
//   탭 숨김(setPaused(true)): 모든 소리를 끊고 컨텍스트를 suspend.
// - 장면 전환 · 사망 · 캐릭터 교체: 회오리 · 귀환 시전이 바로 멎는다. 환경음은 다음 update 에서 새 장면 것으로 교차 페이드.
// - 노드는 소리가 끝나면 끊는다(onended · 시간 정리 둘 다) — stats().nodes 가 늘지 않는다(§11.12).
// - 상태는 읽기만 한다: scene · rift.tileset · player.channel · player.recall(지속음) · player.lowLife · player.dead · player.pos(듣는 자리)
//   · rift.mons(몬스터 ID → 템플릿 · 등급 — 처음 볼 때 한 번 · 캐시) — NOTES-P14.

import { EV } from '../core/events.js';
import { TICK_HZ } from '../core/constants.js';
import { MONSTERS_BY_ID, GUARDIANS_BY_ID, SKILL_NODES_BY_ID, TILESETS_BY_ID } from '../data/index.js';
import { BASIC_SKILLS } from '../data/skills.js';
import { DEFAULT_SETTINGS } from '../data/settings.js';
import { PLAYER } from '../data/classes.js';
import {
  MIX, VOICE, CATS, SPACE, TEMPLATE_TONE, HIT_BY_TYPE, TYPE_PITCH, START_BY_BEHAVIOR, HIT_BY_BEHAVIOR, ACT_BY_TELEGRAPH, ACT_SWELL,
  DIE_BY_TEMPLATE, AFFIX_SOUND, EFFECT_WARN, EFFECT_WARN_DEFAULT, EFFECT_BOOM, EFFECT_BOOM_HOSTILE_DEFAULT, SHOT_BY_VISUAL, SHOT_DEFAULT,
  DROP_BY_RARITY, DROP_BY_KIND, PICK_BY_KIND, TRADE_SOUND, TRADE_DEFAULT, SPAWN_SOUND, INTERACT_SOUND, FAIL_PITCH, BAG_CLICK,
  SOUNDS, LOOPS, BUFFERS,
} from './sounds.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').Settings} Settings */

const EPS = 0.0001;                 // 지수 램프의 바닥(0 은 안 된다)
const F_MIN = 20, F_MAX = 18000;    // 주파수 자르기(Hz)
const PAN_RX = Math.SQRT1_2, PAN_RZ = -Math.SQRT1_2;   // 화면 오른쪽 = 월드 (1, 0, −1)/√2(계약 §0.2)
const TOWN_TILESET = 'town';        // 마을 장면의 타일셋 ID(TilesetId — 환경음 표 data/tilesets.js)
const ELITE_RANKS = { champion: true, elite: true };
const MINOR_RANKS = { minion: true, split: true, spawn: true };
const SOFT_REASONS = { menu: true, modal: true, blur: true, debug: true, context: true };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clampF = (f) => clamp(f, F_MIN, F_MAX);
/** 볼륨 설정값 → 0..1(잘못된 값이면 기본값) */
const vol = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : d);
/** 프라미스 거절을 삼킨다(unhandledrejection 0 — check:dist) */
function quiet(p) {
  if (p && typeof p.then === 'function') p.then(undefined, () => {});
}
/** 노드 하나를 끊는다(이미 끊겼으면 무시) */
function cut(node) {
  try { node.disconnect(); } catch { /* 이미 끊김 */ }
}
/** 소스를 그 시각에 멈춘다(이미 멈췄거나 시작 전이면 무시) */
function halt(src, t) {
  try { src.stop(t); } catch { /* 이미 멈춤 */ }
}

/**
 * @typedef {Object} Voice
 * @property {string} id @property {string} cat @property {number} prio
 * @property {number} t0 @property {number} end   컨텍스트 시각(초)
 * @property {any[]} nodes @property {any[]} srcs @property {any} out
 * @property {number} level @property {number} base
 * @property {boolean} dead      밀려나 사라지는 중(상한에 세지 않는다)
 * @property {boolean} released  노드를 끊었다
 */
/**
 * @typedef {Object} Loop
 * @property {string} id @property {any[]} nodes @property {any[]} srcs @property {any} out
 * @property {number} level @property {number} end   Infinity = 도는 중
 * @property {boolean} released
 */

export class AudioEngine {
  /** @param {{bus:any, settings:any}} deps — AudioContext 는 unlock()에서 처음 만든다 */
  constructor({ bus, settings } = /** @type {any} */ ({})) {
    this.bus = bus ?? null;
    this.settings = settings ?? null;
    /** @type {any} */ this.ctx = null;
    /** @type {any} */ this._out = null;          // {comp, master, sfx, ui, amb}
    /** @type {any} */ this._buf = null;          // {noise, crackle, bubble}
    this._baseNodes = 0;                           // 마스터 체인 노드 수
    this._nodes = 0;                               // 소리 · 루프가 가진 노드 수
    /** @type {Voice[]} */ this._voices = [];
    /** @type {Record<string, Loop|null>} */ this._loops = { whirl: null, recall: null, amb: null };
    /** @type {Loop[]} */ this._dying = [];
    /** @type {Map<string, Voice>} */ this._last = new Map();
    /** @type {Map<number, {tpl:string|null, rank:string}>} */ this._mon = new Map();
    this._hard = false;                            // 탭 숨김 — suspend
    this._hardByEvent = false;                     // PAUSED{hidden}으로 걸린 hard(앱이 setPaused를 부르지 않았을 때)
    this._soft = false;                            // 메뉴 · 모달 일시정지
    this._disposed = false;
    /** @type {GameState|null} */ this._state = null;
    this._lx = 0; this._lz = 0; this._hasListener = false;
    /** @type {{x:number, z:number}|null} */ this._pendingGuardian = null;
    this._heartAt = 0;
    this._ambDuck = 1;
    this._resumeWait = 0;
    this._burstAt = -1; this._burstN = 0;          // 몰림 창(컨텍스트 시각) · 그 안에 시작한 수
    this._rng = 0x2545f491;
    this._count = { played: 0, merged: 0, dropped: 0, stolen: 0, errors: 0 };
    /** @type {string|null} */ this._lastError = null;
    /** @type {Array<() => void>} */ this._offs = [];
    this._subscribe();
  }

  // ───────────────────────── 공개 API(계약 §6.15) ─────────────────────────

  /** 첫 사용자 제스처(키 · 클릭)에서 app 이 부른다 — 여러 번 불려도 된다(멈춘 컨텍스트를 다시 깨운다) */
  unlock() {
    if (this._disposed) return;
    if (this.ctx) {
      if (!this._hard && this.ctx.state === 'suspended') quiet(this.ctx.resume());
      return;
    }
    const AC = /** @type {any} */ (globalThis).AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext;
    if (typeof AC !== 'function') return;                     // WebAudio 없음 — 조용히 꺼진 채
    let ctx = null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch {
      try { ctx = new AC(); } catch { return; }
    }
    try {
      this.ctx = ctx;
      this._buildChain();
      this._buf = this._makeBuffers();
      this.applySettings(this.settings);
    } catch {
      // 일부 브라우저의 노드 생성 실패 — 소리 없이 계속(예외를 게임으로 올리지 않는다)
      this._teardown();
      return;
    }
    if (this._hard) quiet(ctx.suspend?.());
    else if (ctx.state === 'suspended') quiet(ctx.resume?.());
  }

  /**
   * 지속음 상태 맞추기 · 듣는 자리 · 낮은 생명 박동 · 미뤄 둔 수호자 출현음 — 렌더 프레임마다
   * @param {GameState} state @param {number} dtReal
   */
  update(state, dtReal) {
    if (!state || typeof state !== 'object') return;
    this._state = state;
    const p = state.player;
    if (p && p.pos && Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)) {
      this._lx = p.pos.x;
      this._lz = p.pos.z;
      this._hasListener = true;
    }
    const ctx = this.ctx;
    if (!ctx || this._disposed) return;
    const now = ctx.currentTime;
    this._prune(now);
    if (this._hard) return;
    // 숨김에서 돌아왔는데 resume 이 거절됐다 · 브라우저가 멈췄다(interrupted) — 실제 시간 간격으로 다시 깨운다(app 의 unlock 은 한 번뿐)
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      this._resumeWait += Number.isFinite(dtReal) && dtReal > 0 ? Math.min(dtReal, MIX.resumeRetry) : 0;
      if (this._resumeWait >= MIX.resumeRetry) {
        this._resumeWait = 0;
        quiet(ctx.resume?.());
      }
    } else this._resumeWait = 0;

    const inRift = state.scene === 'rift';
    const alive = !!p && !p.dead;
    const active = !this._soft;

    // 수호자 출현 — 그 장면이 균열일 때만(마을에서 소리 금지 — 계약 §4.2 GUARDIAN_APPEAR)
    if (this._pendingGuardian) {
      const g = this._pendingGuardian;
      this._pendingGuardian = null;
      if (inRift) this._play('guardianAppear', g.x, g.z);
    }

    // 회오리(player.channel)
    const wantWhirl = active && inRift && alive && !!p.channel;
    if (wantWhirl && !this._loops.whirl) this._startLoop('whirl', 'whirl', 0, MIX.loopFade * 0.5);
    else if (!wantWhirl && this._loops.whirl) this._stopLoop('whirl', MIX.loopFade);

    // 귀환 시전(player.recall)
    const rc = alive ? p.recall : null;
    const wantRecall = active && !!rc;
    if (wantRecall && !this._loops.recall) {
      // 이벤트를 놓쳤거나 일시정지에서 돌아왔다 — 남은 시간만큼, 활강은 진행한 자리에서 이어 간다
      const total = Number.isFinite(rc.end) && Number.isFinite(rc.start) && rc.end > rc.start ? (rc.end - rc.start) / TICK_HZ : PLAYER.recallSec;
      const left = Number.isFinite(rc.end) && Number.isFinite(state.tick) ? (rc.end - state.tick) / TICK_HZ : total;
      const sec = clamp(left, 0.1, Math.max(0.1, total));
      this._startLoop('recall', 'recall', sec, MIX.loopFade * 0.5, clamp(1 - sec / Math.max(0.1, total), 0, 1));
    } else if (!wantRecall && this._loops.recall) this._stopLoop('recall', MIX.loopFade);

    // 낮은 생명 — 심장 박동(한 번 나는 소리를 간격마다)
    if (active && inRift && alive && p.lowLife) {
      if (now >= this._heartAt) {
        this._play('heartbeat');
        this._heartAt = now + MIX.heartPeriod;
      }
    } else this._heartAt = 0;

    // 환경음(장면 · 타일셋 → data/tilesets.js 의 ambience)
    const ambId = ambienceOf(state);
    const cur = this._loops.amb;
    if ((cur ? cur.id : null) !== ambId) {
      if (cur) this._stopLoop('amb', MIX.ambFade);
      if (ambId) this._startLoop('amb', ambId, 0, MIX.ambFade);
      this._ambDuck = 1;
    }
    const duck = active ? 1 : MIX.ambPauseDuck;
    const amb = this._loops.amb;
    if (amb && duck !== this._ambDuck) {
      this._ambDuck = duck;
      rampTo(amb.out.gain, amb.level * duck, now, MIX.ambFade * 0.25);
    }
  }

  /** 탭 숨김(app) — true: 모든 소리를 끊고 suspend · false: resume(지속음은 다음 update 가 다시 켠다) @param {boolean} on */
  setPaused(on) {
    on = !!on;
    if (!on) this._hardByEvent = false;
    if (on === this._hard) return;
    this._hard = on;
    const ctx = this.ctx;
    if (!ctx) return;
    if (on) {
      this._silenceAll();
      quiet(ctx.suspend?.());
    } else {
      this._heartAt = 0;
      quiet(ctx.resume?.());
    }
  }

  /** 볼륨(마스터 · 효과 · 환경 — UI 는 효과 볼륨 × MIX.ui) @param {Settings} settings */
  applySettings(settings) {
    if (settings && typeof settings === 'object') this.settings = settings;
    const o = this._out;
    if (!this.ctx || !o) return;
    const s = /** @type {any} */ (this.settings) ?? {};
    const now = this.ctx.currentTime;
    const sfx = vol(s.volSfx, DEFAULT_SETTINGS.volSfx);
    rampTo(o.master.gain, vol(s.volMaster, DEFAULT_SETTINGS.volMaster) * MIX.master, now, MIX.volSmooth);
    rampTo(o.sfx.gain, sfx, now, MIX.volSmooth);
    rampTo(o.ui.gain, sfx * MIX.ui, now, MIX.volSmooth);
    rampTo(o.amb.gain, vol(s.volAmbient, DEFAULT_SETTINGS.volAmbient) * MIX.amb, now, MIX.volSmooth);
  }

  /** 누수 검사 — 지금 울리는 소리(한 번 나는 소리 + 지속음) · 살아 있는 노드 수(마스터 체인 포함) @returns {{voices:number, nodes:number}} */
  stats() {
    if (!this.ctx) return { voices: 0, nodes: 0 };
    this._prune(this.ctx.currentTime);
    let voices = 0;
    for (const v of this._voices) if (!v.dead) voices += 1;
    for (const k in this._loops) if (this._loops[k]) voices += 1;
    return { voices, nodes: this._baseNodes + this._nodes };
  }

  /** 구독을 풀고 모든 소리를 끊고 컨텍스트를 닫는다 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const off of this._offs) {
      try { off(); } catch { /* 버스가 먼저 비워졌다 */ }
    }
    this._offs.length = 0;
    this._teardown();
  }

  /** 테스트 · 디버그용 세부 수치(계약 밖 — stats()는 그대로 둔다) */
  debugStats() {
    const s = this.stats();
    /** @type {Record<string, number>} */
    const byCat = {};
    /** @type {Record<string, number>} */
    const byId = {};
    for (const v of this._voices) {
      if (v.dead) continue;
      byCat[v.cat] = (byCat[v.cat] ?? 0) + 1;
      byId[v.id] = (byId[v.id] ?? 0) + 1;
    }
    /** @type {Record<string, string|null>} */
    const loops = {};
    for (const k in this._loops) loops[k] = this._loops[k] ? this._loops[k].id : null;
    return {
      ...s, byCat, byId, loops, dying: this._dying.length, soft: this._soft, hard: this._hard,
      unlocked: !!this.ctx, ambDuck: this._ambDuck, ...this._count,
    };
  }

  // ───────────────────────── 이벤트 → 소리(§9.9) ─────────────────────────

  _subscribe() {
    const bus = this.bus;
    if (!bus || typeof bus.on !== 'function') return;
    /** @param {string} ev @param {(e:any) => void} fn */
    const on = (ev, fn) => {
      const h = (e) => fn(e ?? {});
      const off = bus.on(ev, h);
      this._offs.push(typeof off === 'function' ? off : () => bus.off?.(ev, h));
    };
    // 상태 추적(잠금 전에도)
    on(EV.PAUSED, (e) => this._onPaused(e));
    on(EV.SETTINGS_CHANGED, (e) => {
      this.applySettings(e.settings ?? this.settings);
      this._ui('uiClick');
    });
    on(EV.SCENE_CHANGED, () => this._endRun());
    on(EV.CHAR_LOADED, () => this._endRun());
    on(EV.SCREEN_CHANGED, () => this._endRun());
    on(EV.MAP_LOADED, () => this._mon.clear());
    on(EV.RIFT_CLOSED, () => this._mon.clear());
    on(EV.PLAYER_SPAWNED, (e) => {
      if (Number.isFinite(e.x) && Number.isFinite(e.z)) {
        this._lx = e.x;
        this._lz = e.z;
        this._hasListener = true;
      }
    });

    // 플레이어 행동
    on(EV.ACTION_START, (e) => {
      const def = skillDefOf(e.skillId);
      if (!def) return;
      const id = START_BY_BEHAVIOR[def.behavior];
      if (id) this._play(id, NaN, NaN, 1, typePitch(def.type));
    });
    on(EV.ACTION_HIT, (e) => {
      const def = skillDefOf(e.skillId);
      if (!def) return;
      const id = HIT_BY_BEHAVIOR[def.behavior];
      if (id) this._play(id, NaN, NaN, 1, 1);
    });
    on(EV.SKILL_FAIL, (e) => this._play('fail', NaN, NaN, 1, FAIL_PITCH[e.reason] ?? 1));
    on(EV.CHANNEL, (e) => {
      if (!this._live()) return;
      if (e.on) {
        if (!this._soft && !this._loops.whirl) this._startLoop('whirl', 'whirl', 0, MIX.loopFade * 0.5);
      } else if (this._loops.whirl) this._stopLoop('whirl', MIX.loopFade);
    });
    on(EV.POTION, () => this._play('potion'));
    on(EV.POTION_FAIL, () => this._play('fail', NaN, NaN, 1, 0.9));
    on(EV.RECALL, (e) => {
      if (!this._live()) return;
      if (e.phase === 'start') {
        if (this._loops.recall) this._stopLoop('recall', MIX.stealFade);
        if (!this._soft) this._startLoop('recall', 'recall', clamp(Number.isFinite(e.sec) ? e.sec : PLAYER.recallSec, 0.1, 10), MIX.loopFade * 0.5);
      } else {
        if (this._loops.recall) this._stopLoop('recall', MIX.loopFade);
        if (e.phase === 'cancel' && e.reason !== 'scene') this._play('recallFizzle');
        else if (e.phase === 'done') this._play('portal');
      }
    });
    on(EV.BUFF, (e) => { if (e.on === false) this._play('buffEnd'); });
    on(EV.PLAYER_HIT, (e) => {
      const amount = Number(e.amount) || 0;
      if (e.blocked) this._play('block');
      else if (amount <= 0 && Number(e.absorbed) > 0) this._play('shieldAbsorb');
      else if (amount > 0) {
        const frac = Number(e.lifeMax) > 0 ? amount / e.lifeMax : 0;
        this._play('playerHit', NaN, NaN, 0.7 + Math.min(1, frac * 5) * 0.6, 1);
      }
    });
    on(EV.PLAYER_HEAL, (e) => {
      if (e.source === 'globe') this._play('globe');
      else if (e.source !== 'potion') this._play('heal');
    });
    on(EV.PLAYER_STATUS, (e) => {
      if (!e.on) return;
      if (e.kind === 'root') this._play('rooted');
      else if (e.kind === 'slow') this._play('chilled');
    });
    on(EV.SHIELD, (e) => { if (e.broken) this._play('shieldBreak'); });
    on(EV.LOW_LIFE, (e) => { if (e.on) this._heartAt = 0; });
    on(EV.PLAYER_DIED, () => {
      this._stopCombatLoops(MIX.loopFade);
      this._heartAt = 0;
      this._play('death');
    });

    // 전투 — 몬스터
    on(EV.HIT, (e) => this._onHit(e));
    on(EV.MON_SPAWNED, (e) => {
      if (Number.isFinite(e.id) && e.typeId) this._mon.set(e.id, { tpl: templateOf(e.typeId), rank: e.rank ?? 'normal' });
      const id = SPAWN_SOUND[e.reason];
      if (id) this._play(id, e.x, e.z);
    });
    on(EV.MON_WAKE, (e) => {
      if (e.kind === 'champion' || e.kind === 'elite') this._play('eliteAlarm', e.x, e.z);
      else if (e.kind === 'normal') this._play('wakeGrowl', e.x, e.z, 0.8 + Math.min(10, Number(e.count) || 1) * 0.04, 1);
    });
    on(EV.MON_ACT, (e) => this._onMonAct(e));
    on(EV.MON_STRIKE, (e) => {
      const info = this._live() ? this._monInfo(e.id) : null;
      const tone = (info && TEMPLATE_TONE[info.tpl]) || TEMPLATE_TONE.humanoid;
      this._play('monSwing', e.x, e.z, tone.g, tone.p);
    });
    on(EV.MON_STATUS, (e) => {
      if (e.kind === 'freeze') this._play(e.on ? 'freeze' : 'iceBreak', NaN, NaN);
      else if (e.kind === 'stun' && e.on) this._play('stun');
    });
    on(EV.MON_DIED, (e) => this._onMonDied(e));
    on(EV.AFFIX, (e) => {
      const id = AFFIX_SOUND[e.what];
      if (id) this._play(id, e.x, e.z, 1, e.what === 'teleportIn' ? 1.3 : 1);
    });
    on(EV.PROJ_SPAWN, (e) => {
      const id = SHOT_BY_VISUAL[e.visual] ?? SHOT_DEFAULT;
      this._play(id, e.x, e.z, e.owner === 'player' ? MIX.shotPlayerGain : MIX.shotMonGain, 1);
    });
    on(EV.PROJ_END, (e) => { if (e.reason === 'wall') this._play('projWall', e.x, e.z); });
    on(EV.EFFECT_SPAWN, (e) => {
      if (!e.hostile) return;
      const id = e.kind in EFFECT_WARN ? EFFECT_WARN[e.kind] : EFFECT_WARN_DEFAULT;
      if (id) this._play(id, shapeX(e.shape), shapeZ(e.shape));
    });
    on(EV.EFFECT_HIT, (e) => {
      const id = e.kind in EFFECT_BOOM ? EFFECT_BOOM[e.kind] : e.hostile ? EFFECT_BOOM_HOSTILE_DEFAULT : null;
      if (id) this._play(id, shapeX(e.shape), shapeZ(e.shape), e.hostile && e.hitPlayer ? MIX.hazardHitPlayerGain : 1, 1);
    });

    // 균열 · 이동
    on(EV.RIFT_OPENED, () => this._play('riftOpen'));
    on(EV.GAUGE_FULL, () => this._play('gaugeFull'));
    on(EV.GUARDIAN_APPEAR, (e) => {
      // 그 플러시에서 바로 내지 않고 다음 update 에서 장면을 보고 낸다(부활 commit 플러시에서는 마을이다 — 계약 §4.2)
      if (this._live()) this._pendingGuardian = { x: Number(e.x), z: Number(e.z) };
    });
    on(EV.RIFT_COMPLETE, () => this._play('fanfare'));
    on(EV.RIFT_COLLAPSE, () => this._play('collapse'));
    on(EV.PORTAL_OPENED, (e) => this._play('portalOpen', e.x, e.z));
    on(EV.TRAVEL_REQUEST, (e) => {
      if (e.reason === 'respawn') this._play('respawn');
      else if (e.reason !== 'debug') this._play('portal');
    });
    on(EV.INTERACT, (e) => {
      const id = INTERACT_SOUND[e.kind];
      if (id) this._play(id);
    });

    // 전리품 · 진행 · 거래 · UI
    on(EV.DROP_SPAWN, (e) => {
      const id = e.kind === 'item' ? DROP_BY_RARITY[e.rarity] ?? DROP_BY_RARITY.normal : DROP_BY_KIND[e.kind];
      if (id) this._play(id, e.x, e.z);
    });
    on(EV.DROP_PICKED, (e) => {
      const id = PICK_BY_KIND[e.kind];
      if (id) this._play(id);
    });
    on(EV.PICKUP_FAIL, () => this._play('fail'));
    on(EV.EQUIPPED, (e) => this._ui(e.itemId ? 'equip' : 'unequip'));
    on(EV.TRADE, (e) => this._ui(TRADE_SOUND[e.kind] ?? TRADE_DEFAULT));
    on(EV.LEVEL_UP, () => this._play('levelUp'));
    on(EV.UNLOCK, () => this._play('unlock'));
    on(EV.SKILLS, (e) => this._ui(e.reason === 'learn' ? 'skillLearn' : 'uiClick'));
    on(EV.BAG, (e) => { if (BAG_CLICK[e.reason]) this._ui('uiClick'); });
    on(EV.DURABILITY, (e) => { if (Array.isArray(e.broken) && e.broken.length) this._ui('broken'); });
    on(EV.PANEL_OPENED, () => this._ui('uiOpen'));
    on(EV.PANEL_CLOSED, (e) => { if (e.by !== 'code') this._ui('uiClose'); });
  }

  /** @param {any} e */
  _onPaused(e) {
    if (e.on && e.reason === 'hidden') {
      if (!this._hard) {
        this.setPaused(true);
        this._hardByEvent = true;
      }
      return;
    }
    if (this._hardByEvent) this.setPaused(false);
    const soft = !!e.on && !!SOFT_REASONS[e.reason];
    if (soft === this._soft) return;
    this._soft = soft;
    if (soft) {
      this._stopCombatLoops(MIX.loopFade);
      this._heartAt = 0;
    }
    // 환경음 줄이기 · 되돌리기와 전투 지속음 다시 켜기는 다음 update 가 한다
  }

  /** 판 끝 · 장면 전환 · 캐릭터 교체 — 전투 지속음 정리(환경음은 update 가 새 장면 것으로) */
  _endRun() {
    this._stopCombatLoops(MIX.loopFade);
    this._pendingGuardian = null;
    this._heartAt = 0;
  }

  /** @param {any} e */
  _onHit(e) {
    if (!this._live() || e.dot) return;
    if (e.immune) return void this._play('immune', e.x, e.z);
    if (e.blocked) return void this._play('blockMon', e.x, e.z);
    const id = HIT_BY_TYPE[e.type] ?? HIT_BY_TYPE.phys;
    const info = this._monInfo(e.targetId);
    const tone = (info && TEMPLATE_TONE[info.tpl]) || TEMPLATE_TONE.humanoid;
    let g = tone.g, p = tone.p;
    if (e.crit) { g *= MIX.critGain; p *= MIX.critPitch; }
    if (e.big) g *= MIX.bigGain;
    this._play(id, e.x, e.z, g, p);
  }

  /** @param {any} e */
  _onMonAct(e) {
    if (!this._live()) return;
    const id = e.act === 'swell' ? ACT_SWELL : ACT_BY_TELEGRAPH[e.telegraph];
    if (!id) return;
    const tpl = templateOf(e.typeId);
    const tone = TEMPLATE_TONE[tpl] || TEMPLATE_TONE.humanoid;
    let g = tone.g, p = tone.p;
    const info = this._monInfo(e.id, tpl);
    const rank = info ? info.rank : GUARDIANS_BY_ID[e.typeId] ? 'guardian' : 'normal';
    if (rank === 'guardian') { g *= MIX.actGuardianGain; p *= MIX.actGuardianPitch; }
    else if (ELITE_RANKS[rank]) g *= MIX.actEliteGain;
    this._play(id, e.x, e.z, g, p);
  }

  /** @param {any} e */
  _onMonDied(e) {
    if (!this._live()) return;
    if (e.rank === 'guardian') {
      this._play('guardianDie', e.x, e.z);
      return;
    }
    const tpl = templateOf(e.typeId);
    const id = DIE_BY_TEMPLATE[tpl] ?? DIE_BY_TEMPLATE.humanoid;
    const elite = !!e.elite || !!ELITE_RANKS[e.rank];
    const g = elite ? MIX.dieEliteGain : MINOR_RANKS[e.rank] ? MIX.dieMinorGain : 1;
    this._play(id, e.x, e.z, g, 1);
    if (elite) this._play('eliteDie', e.x, e.z);
  }

  /** 몬스터 ID → {tpl, rank}(처음이면 상태에서 찾아 캐시) @param {number} id @param {string|null} [tplHint] */
  _monInfo(id, tplHint) {
    if (!Number.isFinite(id)) return null;
    const hit = this._mon.get(id);
    if (hit) return hit;
    const mons = this._state && this._state.rift ? this._state.rift.mons : null;
    if (!Array.isArray(mons)) return null;
    for (let i = mons.length - 1; i >= 0; i--) {
      const m = mons[i];
      if (!m || m.id !== id) continue;
      const info = { tpl: tplHint ?? templateOf(m.typeId), rank: typeof m.rank === 'string' ? m.rank : 'normal' };
      this._mon.set(id, info);
      return info;
    }
    return null;
  }

  // ───────────────────────── 소리 짓기 ─────────────────────────

  /** 소리를 낼 수 있는가(잠금 · 탭 숨김 · 정리) */
  _live() {
    return !!this.ctx && !this._hard && !this._disposed;
  }

  /** UI 소리(위치 없음) @param {string} id */
  _ui(id) {
    this._play(id, NaN, NaN, 1, 1);
  }

  /**
   * 한 번 나는 소리 — 합치기 · 간격 · 종류별 상한 · 전체 상한 · 거리 감쇠 · 팬
   * (프레임마다 수십 번 불리는 길이라 인자를 객체로 받지 않는다)
   * @param {string} id @param {number} [x] @param {number} [z] @param {number} [gm] 크기 배율 @param {number} [pm] 음높이 배율
   * @returns {Voice|null}
   */
  _play(id, x = NaN, z = NaN, gm = 1, pm = 1) {
    const ctx = this.ctx;
    if (!ctx || this._hard || this._disposed) return null;
    const rec = SOUNDS[id];
    if (!rec) return null;
    // 컨텍스트가 아직 · 다시 멈춰 있으면(활성화 전 · resume 거절 · interrupted) 시계가 서 있다 —
    // 그동안 예약한 소리가 깨어날 때 한꺼번에 터지지 않게 한 번 나는 소리는 버린다(지속음은 상태에서 다시 맞춘다)
    if (ctx.state !== 'running') {
      this._count.dropped += 1;
      return null;
    }
    const cat = CATS[rec.cat];
    const now = ctx.currentTime;
    if (!(gm > 0) || !Number.isFinite(gm)) gm = 1;
    if (!(pm > 0) || !Number.isFinite(pm)) pm = 1;

    // 공간
    let att = 1, pan = 0;
    if (this._hasListener && Number.isFinite(x) && Number.isFinite(z)) {
      const dx = x - this._lx, dz = z - this._lz;
      const dist = Math.hypot(dx, dz);
      if (dist > SPACE.cull && cat.prio < SPACE.cullPrio) {
        this._count.dropped += 1;
        return null;
      }
      if (dist > SPACE.near) att = Math.max(SPACE.farGain, 1 - ((dist - SPACE.near) / (SPACE.far - SPACE.near)) * (1 - SPACE.farGain));
      pan = clamp((dx * PAN_RX + dz * PAN_RZ) / SPACE.panRange, -1, 1) * SPACE.panMax;
    }

    // 몰림 — 짧은 창 안에 시작한 소리 수로 새 소리를 줄인다(고유 예고 · 종소리 · 장면 소리는 빼고)
    if (now - this._burstAt > VOICE.burstWin) {
      this._burstAt = now;
      this._burstN = 0;
    }
    this._burstN += 1;
    const crowd = cat.prio >= VOICE.burstExemptPrio || this._burstN <= VOICE.burstFree
      ? 1 : Math.max(VOICE.burstMin, Math.pow(VOICE.burstFree / this._burstN, VOICE.burstExp));
    const want = rec.g * gm * att * crowd;

    // 같은 소리 30ms 안 → 합친다 · gap 안 → 버린다
    const last = this._last.get(id);
    if (last) {
      const since = now - last.t0;
      if (since < VOICE.mergeSec && !last.dead && !last.released) {
        // 몰려 있으면(crowd < 1) 합쳐도 키우지 않는다
        const lv = Math.min(last.base * VOICE.mergeMax, Math.max(last.level, want) * (crowd < 1 ? 1 : VOICE.mergeBoost));
        if (lv > last.level) {
          last.level = lv;
          last.out.gain.value = lv;
        }
        this._count.merged += 1;
        return last;
      }
      if (since < (rec.gap ?? 0)) {
        this._count.dropped += 1;
        return null;
      }
    }

    this._prune(now);

    // 종류별 상한 → 그 종류의 가장 오래된 것을 밀어낸다
    let nAll = 0, nCat = 0;
    /** @type {Voice|null} */ let oldCat = null;
    for (const v of this._voices) {
      if (v.dead) continue;
      nAll += 1;
      if (v.cat === rec.cat) {
        nCat += 1;
        if (!oldCat || v.t0 < oldCat.t0) oldCat = v;
      }
    }
    if (nCat >= cat.cap && oldCat) {
      this._kill(oldCat, now);
      nAll -= 1;
    }
    // 전체 상한 → 우선순위가 가장 낮은(같으면 오래된) 것 — 새 소리보다 높으면 새 소리를 버린다
    if (nAll >= VOICE.max) {
      /** @type {Voice|null} */ let victim = null;
      for (const v of this._voices) {
        if (v.dead) continue;
        if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.t0 < victim.t0)) victim = v;
      }
      if (!victim || victim.prio > cat.prio) {
        this._count.dropped += 1;
        return null;
      }
      this._kill(victim, now);
    }

    // 짓기 — 브라우저 예외가 나도 게임(sim 플러시)으로 올리지 않는다 · 반쯤 지은 노드는 끊는다
    const o = this._out;
    /** @type {Voice} */
    const v = { id, cat: rec.cat, prio: cat.prio, t0: now, end: now, nodes: [], srcs: [], out: null, level: 0, base: 0, dead: false, released: false };
    try {
      const level = want;
      v.level = level;
      v.base = level;
      const out = this._node(v, ctx.createGain());
      out.gain.value = level;
      v.out = out;
      let tail = out;
      if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const pn = this._node(v, ctx.createStereoPanner());
        pn.pan.value = pan;
        out.connect(pn);
        tail = pn;
      }
      tail.connect(o[rec.bus] ?? o.sfx);
      const pr = pm * (rec.rp ? Math.pow(2, ((this._rand() * 2 - 1) * rec.rp) / 12) : 1);
      let lastSrc = null, lastEnd = -1;
      for (const L of rec.L) {
        const src = this._layer(v, L, out, now, pr);
        const e = now + (L.t ?? 0) + L.d;
        if (e > lastEnd) { lastEnd = e; lastSrc = src; }
      }
      v.end = lastEnd + MIX.stopPad;
      if (lastSrc) lastSrc.onended = () => this._release(v);
    } catch (err) {
      for (const s of v.srcs) halt(s, now);
      this._release(v);
      this._fail(err);
      return null;
    }
    this._voices.push(v);
    this._last.set(id, v);
    this._count.played += 1;
    return v;
  }

  /** 소리를 짓다 난 예외 — 세고 처음 한 번만 알린다(소리가 게임을 멈추지 않는다) @param {any} err */
  _fail(err) {
    this._count.errors += 1;
    if (this._lastError) return;
    this._lastError = String(err && err.message ? err.message : err);
    try { console.warn('[audio] ' + this._lastError); } catch { /* 콘솔 없음 */ }
  }

  /** 층 하나 → 소스(→ 필터) → 엔벌로프 → dest @returns {any} 소스 */
  _layer(v, L, dest, t0, pm) {
    const ctx = this.ctx;
    const t = t0 + (L.t ?? 0);
    const d = L.d;
    const a = Math.min(L.a ?? 0.005, d * 0.9);
    const noise = L.w === 'noise';
    let src;
    if (noise) {
      src = this._node(v, ctx.createBufferSource());
      src.buffer = this._buf.noise;
      src.loop = true;
    } else {
      src = this._node(v, ctx.createOscillator());
      src.type = L.w;
      glide(src.frequency, clampF(L.f[0] * pm), L.f[1] ? clampF(L.f[1] * pm) : 0, t, d);
    }
    let head = src;
    let flt = null;
    if (L.flt) {
      flt = this._node(v, ctx.createBiquadFilter());
      flt.type = L.flt[0];
      flt.Q.value = L.flt[3] ?? 1;
      glide(flt.frequency, clampF(L.flt[1] * pm), L.flt[2] ? clampF(L.flt[2] * pm) : 0, t, d);
      head.connect(flt);
      head = flt;
    }
    const env = this._node(v, ctx.createGain());
    env.gain.setValueAtTime(0, t0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(L.g, t + a);
    env.gain.exponentialRampToValueAtTime(EPS, t + d);
    head.connect(env);
    env.connect(dest);
    const stopAt = t + d + MIX.stopPad;
    if (L.vib) {
      const target = noise ? (flt ? flt.frequency : null) : src.frequency;
      if (target) {
        const lfo = this._node(v, ctx.createOscillator());
        lfo.type = 'sine';
        lfo.frequency.value = L.vib[0];
        const depth = this._node(v, ctx.createGain());
        depth.gain.value = L.vib[1] * pm;
        lfo.connect(depth);
        depth.connect(target);
        lfo.start(t);
        lfo.stop(stopAt);
        v.srcs.push(lfo);
      }
    }
    if (noise) src.start(t, this._rand() * Math.max(0, (src.buffer?.duration ?? 1) - 0.5));
    else src.start(t);
    v.srcs.push(src);
    src.stop(stopAt);
    return src;
  }

  /**
   * 지속음 시작
   * @param {'whirl'|'recall'|'amb'} slot @param {string} id
   * @param {number} glideSec 활강 길이(초 · 0 = 없음) @param {number} fadeIn @param {number} [prog] 활강을 이미 진행한 비율(0..1)
   */
  _startLoop(slot, id, glideSec, fadeIn, prog = 0) {
    const ctx = this.ctx;
    const rec = LOOPS[id];
    if (!ctx || !rec || this._hard || this._disposed) return null;
    if (this._loops[slot]) this._stopLoop(slot, MIX.stealFade);
    const now = ctx.currentTime;
    /** @type {Loop} */
    const lp = { id, nodes: [], srcs: [], out: null, level: rec.g, end: Infinity, released: false };
    try {
      this._buildLoop(lp, rec, now, glideSec, fadeIn, prog);
    } catch (err) {
      for (const s of lp.srcs) halt(s, now);
      this._releaseLoop(lp);
      this._fail(err);
      return null;
    }
    this._loops[slot] = lp;
    return lp;
  }

  /** 루프 노드를 짓는다(_startLoop 안 — 예외는 부른 쪽이 정리) */
  _buildLoop(lp, rec, now, glideSec, fadeIn, prog) {
    const ctx = this.ctx;
    const out = this._node(lp, ctx.createGain());
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(rec.g, now + Math.max(0.01, fadeIn));
    out.connect(this._out[rec.bus] ?? this._out.sfx);
    lp.out = out;
    for (const L of rec.L) {
      let src;
      const buffered = L.w === 'noise' || L.w === 'crackle' || L.w === 'bubble';
      if (buffered) {
        src = this._node(lp, ctx.createBufferSource());
        src.buffer = this._buf[L.w];
        src.loop = true;
      } else {
        src = this._node(lp, ctx.createOscillator());
        src.type = L.w;
        const f1 = L.f[1] && glideSec > 0 ? clampF(L.f[1]) : 0;
        const f0 = f1 > 0 ? clampF(L.f[0] * Math.pow(f1 / L.f[0], prog)) : clampF(L.f[0]);
        glide(src.frequency, f0, f1, now, glideSec);
      }
      let head = src, flt = null;
      if (L.flt) {
        flt = this._node(lp, ctx.createBiquadFilter());
        flt.type = L.flt[0];
        flt.frequency.value = clampF(L.flt[1]);
        flt.Q.value = L.flt[2] ?? 1;
        head.connect(flt);
        head = flt;
      }
      const g = this._node(lp, ctx.createGain());
      g.gain.value = L.g;
      head.connect(g);
      g.connect(out);
      if (L.lfo) {
        const target = buffered ? (flt ? flt.frequency : null) : src.frequency;
        if (target) {
          const lfo = this._node(lp, ctx.createOscillator());
          lfo.type = 'sine';
          lfo.frequency.value = L.lfo[0];
          const depth = this._node(lp, ctx.createGain());
          depth.gain.value = L.lfo[1];
          lfo.connect(depth);
          depth.connect(target);
          lfo.start(now);
          lp.srcs.push(lfo);
        }
      }
      if (buffered) src.start(now, this._rand() * Math.max(0, (src.buffer?.duration ?? 1) - 0.5));
      else src.start(now);
      lp.srcs.push(src);
    }
  }

  /** 지속음 멈춤(페이드 뒤 끊는다) @param {'whirl'|'recall'|'amb'} slot @param {number} fade */
  _stopLoop(slot, fade) {
    const lp = this._loops[slot];
    if (!lp) return;
    this._loops[slot] = null;
    const ctx = this.ctx;
    if (!ctx) return void this._releaseLoop(lp);
    const now = ctx.currentTime;
    const f = Math.max(0.005, fade);
    rampTo(lp.out.gain, 0, now, f / 4);
    for (const s of lp.srcs) halt(s, now + f + MIX.stopPad);
    lp.end = now + f + MIX.stopPad;
    this._dying.push(lp);
  }

  /** 회오리 · 귀환 시전(전투 지속음) @param {number} fade */
  _stopCombatLoops(fade) {
    if (this._loops.whirl) this._stopLoop('whirl', fade);
    if (this._loops.recall) this._stopLoop('recall', fade);
  }

  /** 밀려난 소리 — 짧게 사라진다 @param {Voice} v @param {number} now */
  _kill(v, now) {
    if (v.dead) return;
    v.dead = true;
    const gp = v.out.gain;
    try {
      gp.cancelScheduledValues(now);
      gp.setValueAtTime(v.level, now);
      gp.linearRampToValueAtTime(0, now + MIX.stealFade);
    } catch { /* 이미 끊긴 노드 */ }
    const stopAt = now + MIX.stealFade + 0.01;
    for (const s of v.srcs) halt(s, stopAt);
    v.end = Math.min(v.end, stopAt + 0.01);
    if (this._last.get(v.id) === v) this._last.delete(v.id);
    this._count.stolen += 1;
  }

  /** 끝난 소리 · 사라진 지속음의 노드를 끊는다(배열은 제자리에서 줄인다) @param {number} now */
  _prune(now) {
    const vs = this._voices;
    let w = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.released || v.end <= now) this._release(v);
      else vs[w++] = v;
    }
    vs.length = w;
    const ds = this._dying;
    w = 0;
    for (let i = 0; i < ds.length; i++) {
      const lp = ds[i];
      if (lp.released || lp.end <= now) this._releaseLoop(lp);
      else ds[w++] = lp;
    }
    ds.length = w;
  }

  /** @param {Voice} v */
  _release(v) {
    if (v.released) return;
    v.released = true;
    v.dead = true;
    for (const s of v.srcs) s.onended = null;
    for (const nd of v.nodes) cut(nd);
    this._nodes -= v.nodes.length;
    v.nodes.length = 0;
    v.srcs.length = 0;
  }

  /** @param {Loop} lp */
  _releaseLoop(lp) {
    if (lp.released) return;
    lp.released = true;
    for (const nd of lp.nodes) cut(nd);
    this._nodes -= lp.nodes.length;
    lp.nodes.length = 0;
    lp.srcs.length = 0;
  }

  /** 지금 즉시 모든 소리 · 지속음을 끊는다(탭 숨김 · 정리) */
  _silenceAll() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const v of this._voices) {
      for (const s of v.srcs) halt(s, now);
      this._release(v);
    }
    this._voices.length = 0;
    for (const k in this._loops) {
      const lp = this._loops[k];
      if (!lp) continue;
      this._loops[k] = null;
      for (const s of lp.srcs) halt(s, now);
      this._releaseLoop(lp);
    }
    for (const lp of this._dying) {
      for (const s of lp.srcs) halt(s, now);
      this._releaseLoop(lp);
    }
    this._dying.length = 0;
    this._last.clear();
    this._pendingGuardian = null;
    this._ambDuck = 1;
    this._heartAt = 0;
  }

  /** 컨텍스트까지 닫는다 */
  _teardown() {
    if (this.ctx) this._silenceAll();
    const o = this._out;
    if (o) for (const k in o) cut(o[k]);
    this._out = null;
    this._baseNodes = 0;
    this._nodes = 0;
    this._buf = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && typeof ctx.close === 'function') {
      try { quiet(ctx.close()); } catch { /* 이미 닫힘 */ }
    }
  }

  /** 소리 · 루프의 노드 등록(누수 수 세기) @template T @param {{nodes:any[]}} owner @param {T} node @returns {T} */
  _node(owner, node) {
    owner.nodes.push(node);
    this._nodes += 1;
    return node;
  }

  /** 마스터 체인 — 버스 셋 → 마스터 → 리미터 → 출력 */
  _buildChain() {
    const ctx = this.ctx;
    const L = MIX.limiter;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = L.threshold;
    comp.ratio.value = L.ratio;
    comp.knee.value = L.knee;
    comp.attack.value = L.attack;
    comp.release.value = L.release;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(comp);
    const sfx = ctx.createGain(), ui = ctx.createGain(), amb = ctx.createGain();
    sfx.connect(master);
    ui.connect(master);
    amb.connect(master);
    this._out = { comp, master, sfx, ui, amb };
    this._baseNodes = 5;
  }

  /** 합성 버퍼 — 백색 잡음 · 모닥불 탁탁 · 용암 보글 */
  _makeBuffers() {
    const ctx = this.ctx;
    const sr = ctx.sampleRate > 0 ? ctx.sampleRate : 48000;
    const mk = (sec) => ctx.createBuffer(1, Math.max(1, Math.floor(sec * sr)), sr);
    const noise = mk(BUFFERS.noiseSec);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = this._rand() * 2 - 1;

    const C = BUFFERS.crackle;
    const crackle = mk(C.sec);
    const cd = crackle.getChannelData(0);
    const pops = Math.round(C.sec * C.rate);
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(this._rand() * cd.length);
      const len = Math.floor(((C.minMs + this._rand() * (C.maxMs - C.minMs)) / 1000) * sr);
      const amp = 0.2 + this._rand() * 0.8;
      for (let i = 0; i < len && at + i < cd.length; i++) cd[at + i] += (this._rand() * 2 - 1) * amp * Math.exp((-5 * i) / len);
    }

    const B = BUFFERS.bubble;
    const bubble = mk(B.sec);
    const bd = bubble.getChannelData(0);
    const blips = Math.round(B.sec * B.rate);
    for (let k = 0; k < blips; k++) {
      const at = Math.floor(this._rand() * bd.length);
      const len = Math.floor(((B.minMs + this._rand() * (B.maxMs - B.minMs)) / 1000) * sr);
      const f0 = B.minHz + this._rand() * (B.maxHz - B.minHz);
      const amp = 0.3 + this._rand() * 0.7;
      let ph = 0;
      for (let i = 0; i < len && at + i < bd.length; i++) {
        const u = i / len;
        ph += (2 * Math.PI * f0 * (1 + u * 0.6)) / sr;
        bd[at + i] += Math.sin(ph) * Math.sin(Math.PI * u) * amp;
      }
    }
    for (let i = 0; i < cd.length; i++) cd[i] = clamp(cd[i], -1, 1);
    for (let i = 0; i < bd.length; i++) bd[i] = clamp(bd[i], -1, 1);
    return { noise, crackle, bubble };
  }

  /** 0..1 — xorshift32(소리 흔들기 · 버퍼 합성 — 게임 난수와 무관) */
  _rand() {
    let s = this._rng;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this._rng = s >>> 0;
    return this._rng / 4294967296;
  }
}

// ───────────────────────── 조각 ─────────────────────────

/** 주파수 파라미터: f0 에서 (f1 이 있으면) d 동안 지수 활강 */
function glide(param, f0, f1, t, d) {
  param.setValueAtTime(f0, t);
  if (f1 > 0 && f1 !== f0 && d > 0) param.exponentialRampToValueAtTime(f1, t + d);
}

/** 매끈하게 목표값으로(지금 값에서 시간 상수 tc) */
function rampTo(param, v, now, tc) {
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(v, now, Math.max(0.001, tc));
  } catch {
    param.value = v;
  }
}

/** 스킬 ID → 동작 정의(노드 · 기본 공격 · 그 밖은 null — 'recall' 등) @param {string} id */
function skillDefOf(id) {
  if (typeof id !== 'string') return null;
  const node = SKILL_NODES_BY_ID[id];
  if (node && node.skill) return node.skill;
  return BASIC_SKILLS[id] ?? null;
}

/** @param {string|null|undefined} type */
function typePitch(type) {
  return type ? TYPE_PITCH[type] ?? 1 : TYPE_PITCH.lightning;
}

/** 몬스터 종류 → 템플릿(모르면 null) @param {string} typeId */
function templateOf(typeId) {
  const def = MONSTERS_BY_ID[typeId] ?? GUARDIANS_BY_ID[typeId];
  return def ? def.template : null;
}

/** 장면 · 타일셋 → 환경음 ID(LOOPS 키 · 없으면 null) @param {GameState} state */
function ambienceOf(state) {
  const ts = state.scene === 'rift' ? state.rift && state.rift.tileset : state.scene === 'town' ? TOWN_TILESET : null;
  const row = ts ? TILESETS_BY_ID[ts] : null;
  const id = row ? row.ambience : null;
  return id && LOOPS[id] ? id : null;
}

/** @param {any} shape */
function shapeX(shape) {
  return shape && Number.isFinite(shape.x) ? shape.x : NaN;
}
/** @param {any} shape */
function shapeZ(shape) {
  return shape && Number.isFinite(shape.z) ? shape.z : NaN;
}
