// OWNER: P9 — 계약 §6.12 · §11.7
// window.__game — 정지 화면 확인 · 헤드리스 검사 · 누수 검사용. 실제 동작은 Game 의 메서드에 있고 여기는 이름만 잇는다.
// 개발용이다: 실제 세이브는 sim 을 바꾸는 디버그 메서드(goto · grant · setGear …)를 부르는 순간부터 쓰지 않는다(Game.markDev).

/**
 * @param {Window|Object} win
 * @param {Object} game app/Game.js 의 Game
 * @returns {Object} window.__game
 */
export function installDebugApi(win, game) {
  const g = /** @type {any} */ (game);
  /** sim 을 직접 바꾸는 디버그 호출 — 개발 세션으로 돌리고(세이브를 더럽히지 않는다) fixture 모드를 끈다 */
  const simDebug = (fn) => (...args) => {
    g.markDev();
    g.leaveFixture();
    g.enterPlay();
    return fn(...args);
  };
  const api = {
    /** sim.state(읽기 전용으로 쓴다) */
    getState: () => g.sim.state,
    /** 루프의 sim 진행을 멈춘다(렌더는 계속) → 지금 값 */
    pause: (on) => g.setDebugPause(on),
    /** n 틱을 동기로 밀고 렌더까지 → Promise<void> (fixture 모드면 레이어 · ui 만 n 번) */
    step: (n = 1) => g.debugStep(n),
    /** 'basic'|'controlled'|'mindless'|'locked'|true|false → 켠 전략 또는 false */
    setBot: (on) => g.setBot(on),
    loadFixture: (name) => g.loadFixture(name),
    errors: () => g.errors.slice(),
    screen: () => g.screens.screen,
    startGame: () => g.startGame(),
    openPanel: (id, args) => g.openPanel(id, args),
    closePanel: () => g.ui.closePanel('code'),
    setTime: simDebug((h) => g.sim.debugSetTime(h)),
    setWeather: simDebug((id) => g.sim.debugSetWeather(id)),
    gotoScene: simDebug((id) => g.sim.debugGotoScene(id)),
    gotoSpot: simDebug((id) => g.sim.debugGotoSpot(id)),
    forceBite: simDebug((id, pct) => g.sim.debugForceBite(id, pct)),
    forceFight: simDebug((id, pct) => g.sim.debugForceFight(id, pct)),
    grant: simDebug((obj) => g.sim.debugGrant(obj || {})),
    setGear: simDebug((slot, id, set) => (set === undefined ? g.sim.debugSetGear(slot, id) : g.sim.debugSetGear(slot, id, set))),
    skipToResult: simDebug((id, pct) => (id === undefined ? g.sim.debugSkipToResult() : g.sim.debugSkipToResult(id, pct))),
    hash: () => g.sim.hash(),
    fps: () => g.fps(),
    memory: () => g.memory(),
  };
  /** @type {any} */ (win).__game = api;
  return api;
}
