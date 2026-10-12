// OWNER: P12 — 계약 §10.9 · §10.1 · §10.2(analytics — modal · Backquote · ?analytics=1)
// 분석 패널 — 탭 넷: 드랍 시뮬레이터 · 표 보기 · 세션 기록 · 봇. `[` `]`로 탭을 바꾼다(위젯 tabs).
// 패널은 UIRoot 가 한 번 만들어 두고(캐시) 열 때마다 open(args)를 부른다. open args.tab = 'sim'|'tables'|'session'|'bot'(또는 0..3)이면 그 탭으로.
// 닫으면 굴리던 시뮬레이터를 멈춘다(닫힌 뒤 게임과 메인 스레드를 다투지 않게 — 결과는 남는다).
// 키: 맨 위 패널이라 모든 키가 온다(modal). 탭 전환 → 보이는 탭의 handleKey → 먹지 않은 키(Escape · Backquote)는 UIRoot 가 닫는다.

import { KEYBINDS } from '../../data/keybinds.js';
import { createBotTab } from './botTab.js';
import { createDropSimTab } from './dropSimTab.js';
import { createSessionTab } from './sessionTab.js';
import { createTablesTab } from './tablesTab.js';

/** @typedef {import('../../types.js').Panel} Panel */

/** 탭 ID(순서 = 탭 줄 순서) */
export const ANALYTICS_TABS = Object.freeze(['sim', 'tables', 'session', 'bot']);

/** @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:Function, ui:any, widgets:any}} ctx @returns {Panel} */
export function createAnalyticsPanel(ctx) {
  const W = ctx.widgets;
  const el = W.panelFrame('panel.analytics.title');
  el.dataset.panel = 'analytics';
  el.classList.add('an-panel');
  const tabBar = el.appendChild(W.el('div', 'an-tabs'));
  const body = el.appendChild(W.el('div', 'an-body'));
  const tabs = [createDropSimTab(ctx), createTablesTab(ctx), createSessionTab(ctx), createBotTab(ctx)];
  for (const tb of tabs) {
    tb.el.hidden = true;
    body.appendChild(tb.el);
  }
  let cur = 0;
  let isOpen = false;
  /** @type {any} */
  let lastState = null;

  /** @param {number} i */
  const show = (i) => {
    const j = Math.max(0, Math.min(tabs.length - 1, i | 0));
    if (j !== cur) {
      tabs[cur].hide();
      tabs[cur].el.hidden = true;
    }
    cur = j;
    tabs[cur].el.hidden = false;
    tabs[cur].show(lastState ?? ctx.sim?.state ?? null);
    el.dataset.tab = ANALYTICS_TABS[cur];
  };
  const tabCtl = W.tabs(tabBar, ANALYTICS_TABS.map((id) => 'analytics.tab.' + id), (i) => { if (isOpen) show(i); });

  /** 탭 하나만 보이고 나머지는 키 대체 경로에서 빠진다 */
  const syncHidden = () => {
    tabs.forEach((tb, i) => {
      tb.el.hidden = i !== cur;
      if (i !== cur) tb.hide();
    });
  };

  return {
    id: 'analytics',
    modal: true,
    el,
    /** @param {{tab?:string|number}} [args] */
    open(args = {}) {
      isOpen = true;
      lastState = ctx.sim?.state ?? lastState;
      const a = args ?? {};
      let want = cur;
      if (typeof a.tab === 'number' && Number.isFinite(a.tab)) want = a.tab;
      else if (typeof a.tab === 'string' && ANALYTICS_TABS.includes(a.tab)) want = ANALYTICS_TABS.indexOf(a.tab);
      cur = Math.max(0, Math.min(tabs.length - 1, want | 0));
      tabCtl.select(cur, true);
      syncHidden();
      show(cur);
    },
    close() {
      isOpen = false;
      for (const tb of tabs) tb.stop();
      tabs[cur].hide();
    },
    /** @param {any} state */
    update(state) {
      lastState = state;
      tabs[cur].update(state);
    },
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      if (e.code === KEYBINDS.tabPrev || e.code === KEYBINDS.tabNext) {
        if (e.type !== 'keyup' && !e.repeat) tabCtl.handleKey(e);
        return true;
      }
      return tabs[cur].handleKey(e);
    },
    keys: [KEYBINDS.tabPrev, KEYBINDS.tabNext, KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right, ...KEYBINDS.confirm, 'PageUp', 'PageDown', 'KeyX', 'KeyJ', 'KeyC'],
    /** 테스트 · 화면 확인용 — 탭 객체(dropSim.run() 등) */
    get tabs() { return tabs; },
    get tab() { return ANALYTICS_TABS[cur]; },
    dispose() {
      for (const tb of tabs) tb.dispose();
      tabCtl.destroy();
      el.remove();
    },
  };
}
