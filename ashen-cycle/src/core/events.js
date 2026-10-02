// OWNER: P0 — 계약 §4 · §6.1 (완전 구현)

/**
 * 이벤트 이름 상수. 코드에서는 문자열 리터럴 대신 이 키만 쓴다(§4.1).
 * payload 형태는 계약 §4.2~§4.4의 표가 정본이다.
 */
export const EV = Object.freeze({
  // §4.2 sim 이벤트 (틱 끝 플러시)
  MODE_CHANGED: 'mode/changed',
  FIGHT_STARTED: 'fight/started',
  FIGHT_PHASE: 'fight/phase',
  FIGHT_ENDED: 'fight/ended',
  REWARD_GRANTED: 'reward/granted',
  CYCLE_ADVANCED: 'cycle/advanced',
  PLAYER_ATTACK_START: 'player/attackStart',
  PLAYER_SWING: 'player/swing',
  PLAYER_CHARGE_FULL: 'player/chargeFull',
  PLAYER_ROLL: 'player/roll',
  PLAYER_STEP: 'player/step',
  PLAYER_GUARD: 'player/guard',
  PLAYER_FLASK: 'player/flask',
  PLAYER_STAMINA_OUT: 'player/staminaOut',
  PLAYER_DODGED: 'player/dodged',
  LOCKON_CHANGED: 'player/lockOn',
  EXECUTE_STARTED: 'player/execute',
  PLAYER_RESTED: 'player/rested',
  PLAYER_DIED: 'player/died',
  HIT: 'combat/hit',
  HITSTOP: 'combat/hitstop',
  CAMERA_SHAKE: 'camera/shake',
  BOSS_ATTACK_WINDUP: 'boss/windup',
  BOSS_ATTACK_ACTIVE: 'boss/active',
  BOSS_ATTACK_END: 'boss/attackEnd',
  BOSS_CUE: 'boss/cue',
  BOSS_STEP: 'boss/step',
  BOSS_PHASE_CHANGED: 'boss/phase',
  BOSS_GROGGY: 'boss/groggy',
  BOSS_TELEPORT: 'boss/teleport',
  BOSS_DEFEATED: 'boss/defeated',
  PROJECTILE_SPAWNED: 'proj/spawned',
  PROJECTILE_ENDED: 'proj/ended',
  HAZARD_SPAWNED: 'hazard/spawned',
  HAZARD_ACTIVATED: 'hazard/activated',
  HAZARD_ENDED: 'hazard/ended',
  NEAR_FACILITY_CHANGED: 'town/near',
  INTERACT: 'town/interact',
  // §4.3 progression 이벤트 (즉시)
  PROFILE_CHANGED: 'profile/changed',
  LEVEL_UP: 'profile/levelUp',
  WEAPON_UPGRADED: 'profile/weaponUp',
  WEAPON_EQUIPPED: 'profile/weaponEquip',
  ITEM_PURCHASED: 'profile/buy',
  RELIC_EQUIPPED: 'profile/relic',
  PURCHASE_FAILED: 'profile/fail',
  // §4.4 ui · app 이벤트 (즉시)
  UI_OPENED: 'ui/opened',
  UI_CLOSED: 'ui/closed',
  UI_SOUND: 'ui/sound',
  SCREEN_CHANGED: 'app/screen',
  PAUSED: 'app/paused',
  SETTINGS_CHANGED: 'app/settings',
  SAVED: 'app/saved',
});

/**
 * 동기 이벤트 버스. app이 하나 만들어 모든 계층에 넘긴다.
 * - 리스너는 등록 순서대로 동기 호출된다. onAny 리스너가 이름 리스너보다 먼저 불린다(로그가 발행 순서와 같게).
 * - 리스너 예외는 삼키지 않는다(그대로 전파).
 * - emit 도중에 on/off 해도 안전하다(그 emit은 시작 시점의 목록으로 돈다. 도중에 off 된 리스너는 건너뛴다).
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();
    /** @type {Function[]} */
    this._any = [];
  }

  /**
   * @param {string} name
   * @param {(payload:Object)=>void} fn
   * @returns {()=>void} off 함수
   */
  on(name, fn) {
    let list = this._listeners.get(name);
    if (!list) {
      list = [];
      this._listeners.set(name, list);
    }
    list.push(fn);
    return () => this.off(name, fn);
  }

  /**
   * 한 번만 불리고 스스로 해제된다. off(name, fn)에 원래 fn을 넘겨도 해제된다.
   * @param {string} name
   * @param {(payload:Object)=>void} fn
   * @returns {()=>void} off 함수
   */
  once(name, fn) {
    const wrapped = (payload) => {
      this.off(name, wrapped);
      fn(payload);
    };
    wrapped._orig = fn;
    return this.on(name, wrapped);
  }

  /**
   * @param {string} name
   * @param {Function} fn
   */
  off(name, fn) {
    const list = this._listeners.get(name);
    if (!list) return;
    const i = list.findIndex((f) => f === fn || f._orig === fn);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this._listeners.delete(name);
  }

  /**
   * 모든 이벤트를 받는다(디버그 로그 · 테스트).
   * @param {(name:string, payload:Object)=>void} fn
   * @returns {()=>void} off 함수
   */
  onAny(fn) {
    this._any.push(fn);
    return () => {
      const i = this._any.indexOf(fn);
      if (i >= 0) this._any.splice(i, 1);
    };
  }

  /**
   * @param {string} name
   * @param {Object} [payload]
   */
  emit(name, payload = {}) {
    if (this._any.length) {
      const any = this._any.slice();
      for (const fn of any) {
        if (this._any.includes(fn)) fn(name, payload);
      }
    }
    const list = this._listeners.get(name);
    if (!list || list.length === 0) return;
    const snapshot = list.slice();
    for (const fn of snapshot) {
      // 도중에 off 된 리스너는 부르지 않는다.
      const cur = this._listeners.get(name);
      if (cur && cur.includes(fn)) fn(payload);
    }
  }

  /** 모든 리스너를 지운다. */
  clear() {
    this._listeners.clear();
    this._any.length = 0;
  }
}
