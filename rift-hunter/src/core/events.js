// OWNER: P0 — 계약 §4 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 이벤트 이름은 이 파일의 EV 상수만 쓴다(문자열 리터럴 금지 — purity.test 가 다른 파일에서 값 리터럴을 찾는다).

export const EV = Object.freeze({
  // §4.2 sim 이벤트(ctx.emit → 플러시)
  CHAR_LOADED: 'char/loaded',
  MAP_LOADED: 'map/loaded',
  SCENE_CHANGED: 'scene/changed',
  TRAVEL_REQUEST: 'scene/travel',
  PLAYER_SPAWNED: 'player/spawned',
  INTERACT: 'world/interact',
  HINT: 'hint/show',
  ACTION_START: 'player/actionStart',
  ACTION_HIT: 'player/actionHit',
  SKILL_FAIL: 'skill/fail',
  CHANNEL: 'skill/channel',
  POTION: 'player/potion',
  POTION_FAIL: 'player/potionFail',
  RECALL: 'player/recall',
  BUFF: 'player/buff',
  PLAYER_HIT: 'player/hit',
  PLAYER_HEAL: 'player/heal',
  PLAYER_STATUS: 'player/status',
  SHIELD: 'player/shield',
  LOW_LIFE: 'player/lowLife',
  PLAYER_DIED: 'player/died',
  HIT: 'combat/hit',
  HITSTOP: 'fx/hitstop',
  SHAKE: 'fx/shake',
  MON_SPAWNED: 'mon/spawned',
  MON_WAKE: 'mon/wake',
  MON_ACT: 'mon/act',
  MON_STRIKE: 'mon/strike',
  MON_STATUS: 'mon/status',
  MON_DIED: 'mon/died',
  AFFIX: 'affix/fx',
  PROJ_SPAWN: 'proj/spawn',
  PROJ_END: 'proj/end',
  EFFECT_SPAWN: 'effect/spawn',
  EFFECT_HIT: 'effect/hit',
  RIFT_OPENED: 'rift/opened',
  GAUGE: 'rift/gauge',
  GAUGE_FULL: 'rift/gaugeFull',
  GUARDIAN_APPEAR: 'rift/guardian',
  RIFT_COMPLETE: 'rift/complete',
  RIFT_COLLAPSE: 'rift/collapse',
  RIFT_CLOSED: 'rift/closed',
  LIVES: 'rift/lives',
  PORTAL_OPENED: 'rift/portalOpen',
  PORTAL_CLOSED: 'rift/portalClose',
  DROP_SPAWN: 'drop/spawn',
  DROP_PICKED: 'drop/picked',
  PICKUP_FAIL: 'drop/pickupFail',
  GOLD: 'econ/gold',
  MATERIALS: 'econ/materials',
  BAG: 'inv/bag',
  EQUIPPED: 'inv/equipped',
  DURABILITY: 'inv/durability',
  TRADE: 'shop/trade',
  XP: 'prog/xp',
  LEVEL_UP: 'prog/levelUp',
  SKILLS: 'prog/skills',
  STATS_CHANGED: 'prog/stats',
  UNLOCK: 'prog/unlock',
  SAVE_REQUEST: 'save/request',
  // §4.3 ui · app 이벤트(즉시)
  PANEL_OPENED: 'ui/opened',
  PANEL_CLOSED: 'ui/closed',
  SCREEN_CHANGED: 'app/screen',
  PAUSED: 'app/paused',
  SETTINGS_CHANGED: 'app/settings',
  AUDIO_UNLOCKED: 'app/audioUnlocked',
  FADE: 'app/fade',
  LABELS: 'app/labels',
  BOT: 'app/bot',
});

/**
 * 동기 이벤트 버스 하나(app 이 만든다). 리스너 예외는 삼키지 않는다.
 * emit 은 시작 시점의 리스너 목록으로 돈다 — 도중에 붙이거나 떼도 그 emit 에는 영향이 없다.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._map = new Map();
    /** @type {Function[]} */
    this._any = [];
  }

  /** @param {string} name @param {(payload:Object) => void} fn @returns {() => void} off */
  on(name, fn) {
    const list = this._map.get(name);
    if (list) list.push(fn);
    else this._map.set(name, [fn]);
    return () => this.off(name, fn);
  }

  /** 한 번만 듣는다 @param {string} name @param {(payload:Object) => void} fn @returns {() => void} off */
  once(name, fn) {
    const wrap = (payload) => {
      this.off(name, wrap);
      fn(payload);
    };
    wrap._orig = fn;
    return this.on(name, wrap);
  }

  /** @param {string} name @param {Function} fn */
  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    const i = list.findIndex(f => f === fn || f._orig === fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this._map.delete(name);
  }

  /** 모든 이벤트 — 이름 리스너보다 먼저 불린다 @param {(name:string, payload:Object) => void} fn @returns {() => void} off */
  onAny(fn) {
    this._any.push(fn);
    return () => {
      const i = this._any.indexOf(fn);
      if (i >= 0) this._any.splice(i, 1);
    };
  }

  /** 등록 순서대로 동기 호출 · 예외 전파 @param {string} name @param {Object} [payload] */
  emit(name, payload = {}) {
    if (this._any.length) for (const fn of this._any.slice()) fn(name, payload);
    const list = this._map.get(name);
    if (list) for (const fn of list.slice()) fn(payload);
  }

  clear() {
    this._map.clear();
    this._any.length = 0;
  }

  /** 등록된 리스너 수(누수 검사용) */
  count() {
    let n = this._any.length;
    for (const list of this._map.values()) n += list.length;
    return n;
  }
}
