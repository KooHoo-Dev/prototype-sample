// OWNER: P0 — 계약 §4 · §6.1 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 이벤트 이름(EV)과 버스 하나. sim 은 bus.emit 을 직접 부르지 않고 ctx.emit 으로 큐에 쌓는다(§4.1).

export const EV = Object.freeze({
  // §4.2 sim 이벤트(ctx.emit → 플러시)
  SCENE_CHANGED: 'scene/changed',
  PLAYER_PLACED: 'player/placed',
  CLOCK_BAND: 'clock/band',
  CLOCK_DAY: 'clock/day',
  CLOCK_SKIP: 'clock/skip',
  WEATHER_CHANGED: 'weather/changed',
  INTERACT: 'world/interact',
  FISHING_ENTER: 'fishing/enter',
  FISHING_EXIT: 'fishing/exit',
  SET_CHANGED: 'rig/set',
  DEPTH_CHANGED: 'rig/depth',
  DRAG_CHANGED: 'rig/drag',
  BAIL_CHANGED: 'rig/bail',
  CAST_START: 'cast/start',
  CAST_RELEASE: 'cast/release',
  CAST_SPLASH: 'cast/splash',
  CAST_BLOCKED: 'cast/blocked',
  RIG_BUSY: 'rig/busy',
  RETRIEVE_DONE: 'rig/retrieved',
  BITE_NIBBLE: 'bite/nibble',
  BITE_TAKE: 'bite/take',
  HOOK_SET: 'hook/set',
  HOOK_MISS: 'hook/miss',
  FIGHT_TELEGRAPH: 'fight/telegraph',
  FIGHT_BEHAVIOR: 'fight/behavior',
  FIGHT_JUMP: 'fight/jump',
  FIGHT_SHAKE: 'fight/shake',
  FIGHT_SLIP: 'fight/slip',
  ROD_STRESS: 'fight/rodStress',
  LINE_DANGER: 'fight/lineDanger',
  SNAG: 'fight/snag',
  NET_READY: 'fight/netReady',
  NET_START: 'fight/net',
  FIGHT_END: 'fight/end',
  CATCH_RESULT: 'catch/result',
  CATCH_KEPT: 'catch/kept',
  CATCH_RELEASED: 'catch/released',
  FAIL: 'rig/fail',
  RIG_RESTORED: 'rig/restored',
  BAIT_GRANTED: 'bait/granted',
  XP_GAINED: 'progress/xp',
  LEVEL_UP: 'progress/levelUp',
  RECORD: 'progress/record',
  MONEY_CHANGED: 'money/changed',
  SOLD: 'shop/sold',
  BOUGHT: 'shop/bought',
  LINE_REFILLED: 'shop/refill',
  EQUIPPED: 'gear/equipped',
  SKILL_LEARNED: 'skill/learned',
  SAVE_REQUEST: 'save/request',
  // §4.3 ui · app 이벤트(즉시)
  PANEL_OPENED: 'ui/opened',
  PANEL_CLOSED: 'ui/closed',
  SCREEN_CHANGED: 'app/screen',
  PAUSED: 'app/paused',
  SETTINGS_CHANGED: 'app/settings',
  POINTER_LOCK: 'app/pointerLock',
  AUDIO_UNLOCKED: 'app/audioUnlocked',
});

/** 동기 이벤트 버스. 리스너 예외는 삼키지 않는다(§4.1). */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._map = new Map();
    /** @type {Function[]} */
    this._any = [];
  }

  /** @param {string} name @param {(payload:any) => void} fn @returns {() => void} off 함수 */
  on(name, fn) {
    const list = this._map.get(name);
    if (list) list.push(fn); else this._map.set(name, [fn]);
    return () => this.off(name, fn);
  }

  /** 한 번 받고 스스로 끊는다. @returns {() => void} */
  once(name, fn) {
    const wrap = (payload) => { this.off(name, wrap); fn(payload); };
    wrap._orig = fn;
    return this.on(name, wrap);
  }

  /** @param {string} name @param {Function} fn — once 로 단 원래 함수로도 끊을 수 있다 */
  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    const i = list.findIndex(f => f === fn || f._orig === fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) this._map.delete(name);
  }

  /** fn(name, payload) — 이름 리스너보다 먼저 불린다. @returns {() => void} */
  onAny(fn) {
    this._any.push(fn);
    return () => {
      const i = this._any.indexOf(fn);
      if (i >= 0) this._any.splice(i, 1);
    };
  }

  /** 등록 순서대로 동기 호출. 시작 시점의 리스너 목록으로 돈다 · 예외는 전파한다. */
  emit(name, payload = {}) {
    const any = this._any.slice();
    const list = (this._map.get(name) || []).slice();
    for (const fn of any) fn(name, payload);
    for (const fn of list) fn(payload);
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
