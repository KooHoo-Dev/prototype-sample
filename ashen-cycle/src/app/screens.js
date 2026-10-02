// OWNER: P9 — 계약 §11.2
// 화면 상태 기계: boot → title → town ⇄ boss → result. pause는 town · boss 위의 오버레이(화면은 그대로, paused 플래그).
// Game.js만 import 하는 패키지 내부 파일이다. DOM을 모른다 — 받은 ui · sim · cameraRig의 메서드만 부른다(Node에서 가짜로 돌릴 수 있다).
//
// 전이의 뼈대: await ui.fade(true, 0.3) → ui.closePanel() → screen = 새 화면 → sim 명령 → snapBehind
//              → await settle()(새 화면 두 프레임 — 막 아래에서 셰이더 컴파일) → ui.fade(false, 0.4)
//   - 합 0.7초 + 두 프레임(1초 이내). fade · settle을 기다리는 동안에는 추가 전이 · pause 요청을 무시한다.
//   - screen을 먼저 바꾼 뒤 sim 명령을 부른다 — 그 명령이 내는 MODE_CHANGED의 저장 판정이 새 화면 기준이 된다.
import { EV } from '../core/events.js';
import { BOSS_IDS } from '../core/constants.js';

/** @typedef {'boot'|'title'|'town'|'boss'|'result'} ScreenId */

/** 전환 페이드(초). 합이 1초를 넘지 않는다(브리프 §2). */
export const FADE_OUT = 0.3;
export const FADE_IN = 0.4;

export class ScreenMachine {
  /**
   * @param {Object} deps
   * @param {import('../core/events.js').EventBus} deps.bus
   * @param {import('../sim/GameSim.js').GameSim} deps.sim
   * @param {{openPanel:Function, closePanel:Function, fade:Function, isBlocking:()=>boolean, canClose:()=>boolean,
   *          activePanel:string|null}} deps.ui
   * @param {{snapBehind:(facing:number)=>void}|null} [deps.cameraRig]
   * @param {()=>void} [deps.flushSave] 지금 저장한다(quitToTitle — 타이틀에서는 저장하지 않으므로 그 전에)
   * @param {()=>Promise<void>} [deps.settle] 새 화면이 몇 프레임 그려질 때까지 기다린다(막을 걷기 전 — 시한 포함). 없으면 기다리지 않는다
   * @param {(where:string, error:unknown)=>void} [deps.onError]
   */
  constructor(deps) {
    this.bus = deps.bus;
    this.sim = deps.sim;
    this.ui = deps.ui;
    this.cameraRig = deps.cameraRig ?? null;
    this._flushSave = deps.flushSave ?? (() => {});
    this._settle = deps.settle ?? null;
    this._onError = deps.onError ?? ((where, e) => console.error(`[screens] ${where}`, e));
    /** @type {ScreenId} */
    this.screen = 'boot';
    this.paused = false;
    /** 전이의 fade를 기다리는 중인가 */
    this.busy = false;
    /** 「즉시 재도전」이 다시 싸울 보스 */
    this.lastBossId = BOSS_IDS[0];
    /** 창이 포커스를 잃은 채인가(focusLost ~ focusBack). 전이가 끝난 뒤에 다시 본다 — 페이드 중의 blur를 놓치지 않게 */
    this.unfocused = false;
  }

  // ───────────────────────── 조회 ─────────────────────────

  /** 프로필을 저장해도 되는 화면인가(§11.4 — boot · title에서는 쓰지 않는다). @returns {boolean} */
  canSave() {
    return this.screen === 'town' || this.screen === 'boss' || this.screen === 'result';
  }

  /** sim을 돌리는 화면인가(title은 배경으로 마을을 그리기만 한다 — §10.4). @returns {boolean} */
  isLive() {
    return this.canSave();
  }

  /** 보스전 교전 중인가(포기 보상 · 이탈 확인의 조건). @returns {boolean} */
  isFighting() {
    const fight = this.sim.state.fight;
    return this.screen === 'boss' && !!fight && fight.phase === 'fight';
  }

  // ───────────────────────── 전이 ─────────────────────────

  /** boot → title(페이드 없음 — 부팅의 마지막). @param {{saveBroken?:boolean}} [params] */
  showTitle(params = {}) {
    this._setScreen('title');
    this.ui.openPanel('title', { saveBroken: !!params.saveBroken });
  }

  /**
   * 마을로. 교전 중이면 먼저 포기한다(지금까지 준 피해만큼 사망 보상 — §6.4 forfeitFight).
   * @param {{instant?:boolean, forfeit?:boolean}} [opts] forfeit:false = 포기 보상 없이(새 게임이 프로필을 갈아 끼운 뒤)
   * @returns {Promise<boolean>} 전이했으면 true
   */
  toTown(opts = {}) {
    if (this.busy) return Promise.resolve(false);
    if (opts.forfeit !== false && this.isFighting()) this._call('forfeitFight', () => this.sim.forfeitFight());
    return this._transition(() => {
      this.ui.closePanel();
      this._setScreen('town');
      this.sim.enterTown();
    }, !!opts.instant);
  }

  /**
   * 보스전으로(해금은 검사하지 않는다 — 안개문 UI와 디버그 API의 책임).
   * @param {string} bossId
   * @param {{instant?:boolean}} [opts]
   * @returns {Promise<boolean>}
   */
  toBoss(bossId, opts = {}) {
    if (this.busy || !BOSS_IDS.includes(bossId)) return Promise.resolve(false);
    this.lastBossId = bossId;
    return this._transition(() => {
      this.ui.closePanel();
      this._setScreen('boss');
      this.sim.startBossFight(/** @type {any} */ (bossId));
    }, !!opts.instant);
  }

  /** 결과 → 같은 보스로 다시. @returns {Promise<boolean>} */
  retry() {
    return this.toBoss(this.lastBossId);
  }

  /**
   * 타이틀로. 교전 중이면 포기 → 저장 → 페이드 → title(배경은 마을).
   * @returns {Promise<boolean>}
   */
  quitToTitle() {
    if (this.busy) return Promise.resolve(false);
    if (this.isFighting()) this._call('forfeitFight', () => this.sim.forfeitFight());
    this._call('flushSave', this._flushSave);
    return this._transition(() => {
      this._setScreen('title');
      this.sim.enterTown();
      this.ui.openPanel('title', { saveBroken: false }); // 열려 있던 pause는 이 호출이 닫는다
    }, false);
  }

  /** FIGHT_ENDED 수신: boss → result. @param {{reward:Object, outcome:string, duration:number}} p */
  onFightEnded(p) {
    if (this.screen !== 'boss') return;
    this._setScreen('result');
    this.ui.openPanel('result', { reward: p.reward, outcome: p.outcome, duration: p.duration });
  }

  // ───────────────────────── 일시정지 ─────────────────────────

  /** pause를 열 수 있는가: 패널 없음 · town/boss · 전이 중 아님. @returns {boolean} */
  canPause() {
    return !this.busy && !this.ui.isBlocking() && (this.screen === 'town' || this.screen === 'boss');
  }

  /** @returns {boolean} 열었으면 true */
  openPause() {
    if (!this.canPause()) return false;
    this.ui.openPanel('pause');
    this.setPaused(true);
    return true;
  }

  /** paused 플래그(패널과 무관 — 디버그 API의 pause(on)도 이 길로 온다). @param {boolean} on */
  setPaused(on) {
    const v = !!on;
    if (this.paused === v) return;
    this.paused = v;
    this.bus.emit(EV.PAUSED, { paused: v });
  }

  /** UI_CLOSED 수신: pause가 닫히면 누가 닫았든 재개한다(패널 없이 멈춘 상태가 생기지 않는다). @param {string} panel */
  onUiClosed(panel) {
    if (panel === 'pause') this.setPaused(false);
  }

  /**
   * Esc(게임패드 Start도 같다).
   *   pause가 열려 있으면 무시(Esc로는 닫히지 않는다 — §10.1). 단 resume이 참이면 재개한다(게임패드 Start는 활성화 제스처다).
   *   시설 패널이면 닫는다. 패널이 없으면 pause를 연다.
   * @param {boolean} [resume]
   */
  escape(resume = false) {
    if (this.busy) return;
    const panel = this.ui.activePanel;
    if (panel === 'pause') {
      if (resume) this.ui.closePanel();
      return;
    }
    if (panel) {
      if (this.ui.canClose()) this.ui.closePanel();
      return;
    }
    this.openPause();
  }

  /**
   * 창 포커스를 잃었다: 보스전의 intro · fight 중이고 패널이 없을 때만 pause를 연다(§11.2).
   * 전이 중(페이드 0.3초)이면 열 수 없다 — 「포커스 없음」을 기억해 두고 전이가 끝난 직후에 다시 본다(_transition).
   */
  focusLost() {
    this.unfocused = true;
    this.pauseIfFighting();
  }

  /** 창 포커스가 돌아왔다. */
  focusBack() {
    this.unfocused = false;
  }

  /** 보스전의 intro · fight 중이면 pause를 연다(포커스 잃음 · 게임패드 끊김). @returns {boolean} 열었으면 true */
  pauseIfFighting() {
    const fight = this.sim.state.fight;
    if (this.screen === 'boss' && fight && (fight.phase === 'intro' || fight.phase === 'fight')) return this.openPause();
    return false;
  }

  // ───────────────────────── 내부 ─────────────────────────

  /** @param {ScreenId} to */
  _setScreen(to) {
    const from = this.screen;
    if (from === to) return;
    this.screen = to;
    this.bus.emit(EV.SCREEN_CHANGED, { from, to });
  }

  /** 예외를 삼키지 않고 보고만 한다(전이가 검은 화면에서 멈추지 않게). @param {string} where @param {()=>void} fn */
  _call(where, fn) {
    try {
      fn();
    } catch (e) {
      this._onError(where, e);
    }
  }

  /**
   * @param {()=>void} run 막이 덮인 뒤에 할 일(패널 닫기 → screen → sim 명령)
   * @param {boolean} instant 페이드 없이(디버그 쿼리 부팅)
   * @returns {Promise<boolean>}
   */
  async _transition(run, instant) {
    this.busy = true;
    try {
      if (!instant) await this.ui.fade(true, FADE_OUT);
      this._call('transition', run);
      this._call('snapBehind', () => this.cameraRig?.snapBehind(this.sim.state.player.facing));
      // 새 화면의 첫 프레임들(보스 뷰 생성 · 셰이더 컴파일 — 세션 첫 진입에 0.1~0.3초)을 불투명한 막 아래에서 그린다.
      // 기다리지 않으면 그 멈칫이 걷히는 막의 앞부분을 먹는다. 프레임이 돌지 않는 환경(숨은 탭)은 settle이 스스로 시한을 둔다.
      if (!instant && this._settle) await this._settle();
    } catch (e) {
      this._onError('fade', e);
    } finally {
      this.busy = false;
      // 페이드 중에 창이 포커스를 잃었으면 그때는 pause를 열 수 없었다 — 도착한 화면이 보스전이면 지금 연다
      if (this.unfocused) this._call('focusLost', () => this.pauseIfFighting());
      // 걷히는 막은 기다리지 않는다 — 시작하는 순간 클릭이 통과한다(§10.1)
      this._call('fade', () => {
        const p = this.ui.fade(false, instant ? 0 : FADE_IN);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      });
    }
    return true;
  }
}
