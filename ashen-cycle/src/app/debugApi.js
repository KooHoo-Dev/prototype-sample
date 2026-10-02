// OWNER: P9 — 계약 §11.5
// 디버그 API → window.__ashen. 브라우저 자동화 · 콘솔용이다.
// 숨은 탭 · 자동화 pane에서는 requestAnimationFrame이 돌지 않는다 — step(n)이 틱을 밀고 레이어 update + 렌더까지 한다.
import { GAME_VERSION, BOSS_IDS, PANEL_IDS } from '../core/constants.js';

/** 최근 이벤트 로그의 길이(링 버퍼) */
const EVENT_LOG_MAX = 200;
/** 수집하는 오류 목록의 상한 */
const ERROR_LOG_MAX = 100;
const TIME_SCALE_MIN = 0.1;
const TIME_SCALE_MAX = 8;

const ERRORS_KEY = '__ashenErrors';

/** @param {unknown} e @returns {string} */
function describe(e) {
  if (e && typeof e === 'object' && 'stack' in e && typeof e.stack === 'string') return e.stack;
  if (e && typeof e === 'object' && 'message' in e) return String(e.message);
  return String(e);
}

/**
 * window.onerror · unhandledrejection을 모으기 시작한다(여러 번 불러도 한 번만 건다).
 * Game이 생성자의 첫 줄에서 부른다 — 레이어를 만들다 난 오류도 errors()에 남는다.
 * @param {Window} win
 * @returns {string[]} 수집 목록(같은 배열에 계속 쌓인다)
 */
export function captureErrors(win) {
  /** @type {any} */
  const w = win;
  if (Array.isArray(w[ERRORS_KEY])) return w[ERRORS_KEY];
  /** @type {string[]} */
  const list = [];
  w[ERRORS_KEY] = list;
  const push = (/** @type {string} */ text) => {
    if (list.length < ERROR_LOG_MAX) list.push(text);
  };
  win.addEventListener('error', (e) => push(`error: ${describe(e.error ?? e.message)}`));
  win.addEventListener('unhandledrejection', (e) => push(`unhandledrejection: ${describe(e.reason)}`));
  return list;
}

/**
 * §11.5 표의 전 메서드를 win.__ashen에 건다.
 * @param {Window} win
 * @param {import('./Game.js').Game} game
 * @returns {Object} win.__ashen
 */
export function install(win, game) {
  const { sim, bus, progression } = game;
  const errors = captureErrors(win);

  /** @type {{t:number, tick:number, name:string, payload:Object}[]} */
  const log = [];
  bus.onAny((name, payload) => {
    if (log.length >= EVENT_LOG_MAX) log.shift();
    log.push({ t: sim.state.time, tick: sim.state.tick, name, payload });
  });

  /** 명령을 times번 — 처음 실패한 결과(또는 마지막 성공)를 돌려준다. */
  const repeat = (times, fn) => {
    let res = { ok: false, reason: 'invalid' };
    const n = Math.max(1, Math.floor(Number(times) || 1));
    for (let i = 0; i < n; i++) {
      res = fn();
      if (!res || !res.ok) break;
    }
    return res;
  };

  const api = {
    version: GAME_VERSION,

    // ── 조회
    getState: () => structuredClone(sim.state),
    getProfile: () => structuredClone(game.profile),
    getScreen: () => ({
      screen: game.screens.screen,
      paused: game.screens.paused,
      panel: game.ui ? game.ui.activePanel : null,
      pointerLocked: game.input ? game.input.locked : false,
    }),

    // ── 화면
    newGame: () => game.newGame(),
    continueGame: () => game.continueGame(),
    toTown: () => game.screens.toTown(),
    /** 해금을 무시하고 보스전을 시작한다(페이드 포함). @param {string} bossId @returns {Promise<boolean>} */
    startBoss: (bossId) => (BOSS_IDS.includes(bossId) ? game.screens.toBoss(bossId) : Promise.resolve(false)),
    openPanel: (id, params) => {
      if (!PANEL_IDS.includes(id) || !game.ui) return false;
      if (id === 'pause') return game.screens.openPause();
      game.ui.openPanel(id, params);
      return true;
    },
    closePanel: () => game.ui?.closePanel(),

    // ── 진행
    giveEmbers: (n) => progression.grant(Math.max(0, Math.floor(Number(n) || 0)), 0),
    giveShards: (n) => progression.grant(0, Math.max(0, Math.floor(Number(n) || 0))),
    levelUp: (statId, times = 1) => repeat(times, () => progression.levelUp(statId)),
    upgradeWeapon: (weaponId, times = 1) => repeat(times, () => progression.upgradeWeapon(weaponId)),
    equipWeapon: (weaponId) => progression.equipWeapon(weaponId),

    // ── 조종 · 시간
    /** 봇 조종 on/off. opts는 createBot으로 간다({seed, dodgeChance, reaction, aggression}). */
    setBot: (on, opts) => game.setBot(!!on, opts),
    setTimeScale: (x) => {
      const v = Number(x);
      game.timeScale = Number.isFinite(v) ? Math.min(TIME_SCALE_MAX, Math.max(TIME_SCALE_MIN, v)) : 1;
      return game.timeScale;
    },
    setGodMode: (on) => sim.setDebug({ godMode: !!on }),
    setNoStamina: (on) => sim.setDebug({ noStamina: !!on }),
    damageBoss: (amount) => sim.debugDamageBoss(Number(amount) || 0),
    setBossHp: (frac) => sim.debugSetBossHpFraction(Number(frac) || 0),
    killBoss: () => sim.debugDamageBoss(1e9),
    forfeit: () => sim.forfeitFight(),
    /**
     * n틱 수동 진행 뒤 레이어 update + 렌더를 한 번 한다(일시정지 여부와 무관). input을 주면 그 n틱의 입력이 된다
     * (에지 *Pressed는 첫 틱에만). 안 주면 setInput → 봇 → 실제 입력 순으로 쓴다.
     * @param {number} [n] @param {Object} [input] Partial<InputFrame>
     * @returns {number} sim.state.tick
     */
    step: (n = 1, input) => game.debugStep(n, input),
    /** 다음 틱들의 입력을 덮어쓴다. 홀드(move · sprint · guard · heavyHeld)는 clearInput까지, 에지(*Pressed)는 다음 한 틱만. */
    setInput: (partial) => game.setInputOverride(partial),
    clearInput: () => game.setInputOverride(null),
    /** 패널 없는 일시정지(자동화용). pause(false)는 열려 있는 pause 패널도 닫는다. */
    pause: (on) => game.debugPause(!!on),

    // ── 기록
    events: (n = 50) => {
      const count = Math.max(0, Math.floor(Number(n) || 0));
      return count > 0 ? log.slice(-count) : [];
    },
    errors: () => errors.slice(),

    // ── 원본 참조(콘솔용)
    sim,
    bus,
    progression,
    game,
  };
  /** @type {any} */ (win).__ashen = api;
  return api;
}
