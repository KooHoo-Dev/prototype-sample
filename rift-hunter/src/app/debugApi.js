// OWNER: P9 — 계약 §11.8
// window.__game — 디버그 API. 화면 확인 · 고정 상태 실험 · 측정용. 상태를 바꾸는 것은 sim 의 debug* 명령과 app 의 화면 · 봇 동작뿐이다.
// 비동기 메서드(pause · step)는 Promise — step 은 그 프레임을 그린 뒤 푼다. 목록은 README 「디버그 API」에 있다.

import { hashState } from '../core/hash.js';
import { createDropSim } from '../sim/loot/simulate.js';

/**
 * 드랍 표본 — createDropSim(opts).run(opts.n ?? 1000) 뒤의 집계(result())
 * @param {{rank?:import('../types.js').MonRank, level?:number, cls?:import('../types.js').ClassId, mf?:number, blpOn?:boolean, seed?:number, n?:number}} [opts]
 */
export function rollDropsSample(opts = {}) {
  const o = opts ?? {};
  const sim = createDropSim({ rank: o.rank ?? 'normal', level: o.level ?? 1, cls: o.cls ?? 'warrior', mf: o.mf ?? 0, blpOn: o.blpOn ?? true, seed: o.seed ?? 1 });
  sim.run(Math.max(0, Math.floor(Number(o.n ?? 1000)) || 0));
  return sim.result();
}

/**
 * @param {any} win window(또는 그 자리의 객체 — 테스트)
 * @param {any} game app/Game.js 의 Game(sim · ui · screens · actions · debug* 메서드)
 * @returns {Record<string, any>} 단 객체
 */
export function installDebugApi(win, game) {
  const api = {
    /** 지금 GameSim(실험용 — 명령은 sim 의 공개 메서드로) */
    get sim() { return game.sim; },
    /** ui 가 부르는 actions 와 같은 것(§11.2 — 화면 확인 스크립트가 타이틀 · 새 캐릭터 · 타이틀로를 밟는다) */
    get actions() { return game.actions; },
    /** 살아 있는 상태 참조(읽기 · 고정 상태 실험용 — 고치면 책임은 부른 쪽) */
    getState: () => game.sim.state,
    /** 일시정지(패널 없이 — 화면 확인) @param {boolean} [on] */
    pause: (on = true) => Promise.resolve(game.debugPause(on)),
    /** n 틱 step(멈춘 상태에서도 · 전환 막이 있으면 그 시간만큼 막이 진행) → 렌더 → Promise(그 프레임이 그려진 뒤 · 값은 state.tick) @param {number} [n] */
    step: (n = 1) => Promise.resolve(game.debugStep(n)),
    /** 봇 켬/끔(opts = {strategy, preset}) */
    setBot: (on, opts = {}) => game.actions.setBot(on, opts),
    /** 수집한 오류(문자열) */
    errors: () => game.errors.slice(),
    screen: () => game.screens.current,
    panel: () => (game.ui ? game.ui.topPanel() : null),
    openPanel: (id, args = {}) => (game.ui ? game.ui.openPanel(id, args) : false),
    closePanel: () => { if (game.ui) game.ui.closePanel(); },
    /** 고정 상태(§11.9) — 이 세션은 개발 세션이 된다(세이브를 쓰지 않는다) @param {string} id */
    loadFixture: (id) => game.loadFixture(id),
    /** 전환까지(막 없이 바로) */
    gotoTown: () => game.debugTravel(() => game.sim.debugGotoTown()),
    openRift: (level, seed) => game.debugTravel(() => game.sim.debugOpenRift(level, seed)),
    completeRift: () => game.sim.debugCompleteRift(),
    /** 플레이어 앞 6m */
    spawnPack: (monsterId, rank = 'normal', affixIds = null) => game.sim.debugSpawnPack(monsterId, rank, affixIds),
    killAll: () => game.sim.debugKillAll(),
    revealMap: () => game.sim.debugRevealMap(),
    setInvincible: (on) => game.sim.debugSetInvincible(!!on),
    /** items = 등급 이름 배열(['legendary', 'set']) 또는 Item */
    grant: (g = {}) => game.sim.debugGrant(g ?? {}),
    /** 플레이어 앞 바닥에 */
    dropItem: (o = {}) => game.sim.debugDropItem(o ?? {}),
    setLevel: (n) => game.sim.debugSetLevel(n),
    setRiftUnlocked: (n) => game.sim.debugSetRiftUnlocked(n),
    /** 무료 스킬 초기화 */
    resetSkills: () => game.sim.debugResetSkills(),
    rollDropsSample: (opts = {}) => rollDropsSample(opts),
    hash: () => hashState(game.sim.state),
    memory: () => game.memory(),
    stats: () => game.sim.getStats(),
  };
  if (win) win.__game = api;
  return api;
}
