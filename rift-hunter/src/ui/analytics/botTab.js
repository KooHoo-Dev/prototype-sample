// OWNER: P12 — 계약 §10.9(봇) · §11.13
// 봇 탭 — 「봇 자동 사냥」 켬/끔(actions.setBot = __game.setBot) · 전략(basic · noDodge · challenge) · 프리셋(PRESETS[cls] 둘) · 지금 상태 · 기록 마지막 10줄.
// 켜면 app 이 이 패널을 닫고 관전이 시작된다(§11.13 — Game._setBot 이 분석 패널을 닫는다).
// 기록: ui 는 봇 인스턴스(bot.log)를 읽을 통로가 없다(§2.1 ui → bot ✕ · actions 에 없음 — NOTES-P12) → 봇이 켜져 있는 동안의 공개 이벤트
//   (BOT · 균열 열림 · 완료 · 붕괴 · 사망 · 레벨업 · 해금 · 마을 정비 거래 · 장착)로 관전 기록을 쓴다. 탭이 처음 만들어진 뒤부터 센다.

import { CLASS_IDS, TICK_HZ } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { PRESETS } from '../../data/presets.js';
import { fmtInt, fmtNum, fmtSec } from '../format.js';
import { stepperForm } from './dropSimTab.js';

/** 전략(§6.16) */
export const BOT_STRATEGIES = Object.freeze(['basic', 'noDodge', 'challenge']);
/** 보이는 기록 줄 수(계약 §10.9) · 들고 있는 줄 수 */
const LOG_SHOW = 10;
const LOG_KEEP = 50;

/**
 * 봇 탭.
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:any) => string, ui:any, widgets:any}} ctx
 */
export function createBotTab(ctx) {
  const { widgets: W, t } = ctx;
  const el = W.el('div', 'an-tab an-bot');
  el.dataset.tab = 'bot';
  const left = el.appendChild(W.el('div', 'an-col an-bot-left'));
  const right = el.appendChild(W.el('div', 'an-col an-bot-right'));

  let botOn = !!ctx.ui?.botOn;
  let strategy = 'basic';
  let preset = 0;
  /** @type {string[]} */
  const log = [];
  /** 마을 정비 집계(마을에 있는 동안 — 떠날 때 한 줄) */
  const town = { trades: 0, equips: 0, gold: 0 };
  let lastState = /** @type {any} */ (null);

  const clsNow = () => {
    const c = ctx.sim?.state?.char?.cls;
    return CLASS_IDS.includes(c) ? c : CLASS_IDS[0];
  };
  const presetName = () => {
    const list = /** @type {any} */ (PRESETS)[clsNow()] ?? [];
    const pr = list[preset];
    return pr && pr.nameKey ? t(pr.nameKey) : String(preset + 1);
  };
  const presetCount = () => Math.max(1, (/** @type {any} */ (PRESETS)[clsNow()] ?? []).length);

  const status = left.appendChild(W.el('div', 'an-bstatus'));
  const lines = left.appendChild(W.el('div', 'an-blines'));
  const form = stepperForm(W, t, [
    { key: 'strategy', labelKey: 'analytics.bot.strategy', text: () => t('analytics.strategy.' + strategy),
      step: (d) => { strategy = BOT_STRATEGIES[Math.max(0, Math.min(BOT_STRATEGIES.length - 1, BOT_STRATEGIES.indexOf(strategy) + d))]; },
      can: (d) => !botOn && (d < 0 ? BOT_STRATEGIES.indexOf(strategy) > 0 : BOT_STRATEGIES.indexOf(strategy) < BOT_STRATEGIES.length - 1) },
    { key: 'preset', labelKey: 'analytics.bot.preset', text: presetName,
      step: (d) => { preset = Math.max(0, Math.min(presetCount() - 1, preset + d)); },
      can: (d) => !botOn && (d < 0 ? preset > 0 : preset < presetCount() - 1) },
    { key: 'toggle', action: true, actionText: () => (botOn ? t('analytics.botOff') : t('analytics.botOn')) + ' Enter',
      disabled: () => !ctx.sim?.state?.char, onPick: () => toggle() },
  ], { onEnter: () => toggle() });
  left.appendChild(form.el);
  const err = left.appendChild(W.el('div', 'panel-error'));
  left.appendChild(W.el('p', 'panel-note', t('analytics.bot.note')));

  right.appendChild(W.el('h3', 'an-h', t('analytics.bot.log')));
  const logEl = right.appendChild(W.el('div', 'an-blog'));
  /** @type {HTMLElement[]} */
  const logRows = [];
  for (let i = 0; i < LOG_SHOW; i++) logRows.push(logEl.appendChild(W.el('div', 'an-bline')));
  el.appendChild(W.el('div', 'an-foot panel-hint', t('analytics.hint.bot')));

  function toggle() {
    err.textContent = '';
    if (!ctx.sim?.state?.char) { err.textContent = t('analytics.bot.noChar'); return; }
    const want = !botOn;
    const res = ctx.actions && typeof ctx.actions.setBot === 'function' ? ctx.actions.setBot(want, { strategy, preset }) : { ok: false, reason: 'invalid' };
    if (res && res.ok === false) { err.textContent = t('reason.' + (res.reason ?? 'invalid'), res.params); return; }
    // BOT 이벤트가 botOn 을 맞춘다 — 이벤트가 오지 않는 app(스텁)이어도 화면이 따라오게
    botOn = want;
    form.refresh();
    drawStatus(lastState);
    // 켜면 패널을 닫고 관전(§10.9 · §11.13 — app 이 이미 닫았으면 아무것도 하지 않는다)
    if (want && ctx.ui && typeof ctx.ui.topPanel === 'function' && ctx.ui.topPanel() === 'analytics') ctx.ui.closePanel('analytics', 'code');
  }

  // ── 관전 기록(공개 이벤트) ──
  /** @param {string} text */
  const push = (text) => {
    const tick = ctx.sim?.state?.tick;
    const stamp = Number.isFinite(tick) ? fmtSec(tick / TICK_HZ) : '';
    log.push(stamp ? `[${stamp}] ${text}` : text);
    if (log.length > LOG_KEEP) log.splice(0, log.length - LOG_KEEP);
    drawLog();
  };
  /** @type {Array<() => void>} */
  const offs = [];
  /** @param {string} name @param {(e:any) => void} fn */
  const on = (name, fn) => { if (ctx.bus && typeof ctx.bus.on === 'function') offs.push(ctx.bus.on(name, fn)); };
  on(EV.BOT, (e) => {
    const was = botOn;
    botOn = !!e.on;
    if (botOn !== was || botOn) push(t(botOn ? 'analytics.log.botOn' : 'analytics.log.botOff'));
    town.trades = town.equips = town.gold = 0;
    form.refresh();
  });
  on(EV.RIFT_OPENED, (e) => { if (botOn) push(t('banner.riftOpened', { n: e.level, tileset: t('tileset.' + e.tileset) })); });
  on(EV.RIFT_COMPLETE, (e) => {
    const s = e.summary ?? {};
    if (botOn) push(t('analytics.log.complete', { n: s.level ?? '?', t: fmtSec(s.timeSec ?? 0), d: s.deaths ?? 0 }));
  });
  on(EV.RIFT_COLLAPSE, (e) => { if (botOn) push(t('analytics.log.collapse', { n: e.summary?.level ?? '?' })); });
  on(EV.PLAYER_DIED, (e) => { if (botOn) push(t('death.title') + ' · ' + t('death.lives', { n: e.lives ?? 0 })); });
  on(EV.LEVEL_UP, (e) => { if (botOn) push(t('banner.levelUp', { n: e.level })); });
  on(EV.UNLOCK, (e) => { if (botOn) push(t('notice.unlock', { n: e.riftUnlocked })); });
  on(EV.TRADE, () => { if (botOn) town.trades++; });
  on(EV.EQUIPPED, (e) => { if (botOn && e.itemId) town.equips++; });
  on(EV.GOLD, (e) => { if (botOn && ctx.sim?.state?.scene === 'town' && Number.isFinite(e.delta)) town.gold += e.delta; });
  on(EV.SCENE_CHANGED, (e) => {
    if (!botOn) return;
    if (e.from === 'town' && e.to !== 'town' && (town.trades || town.equips || town.gold)) {
      push(t('analytics.log.town', { trades: fmtInt(town.trades), equips: fmtInt(town.equips), gold: (town.gold >= 0 ? '+' : '') + fmtInt(town.gold) }));
    }
    if (e.to === 'town' || e.from === 'town') town.trades = town.equips = town.gold = 0;
  });

  function drawLog() {
    const start = Math.max(0, log.length - LOG_SHOW);
    for (let i = 0; i < LOG_SHOW; i++) {
      const line = log[start + i] ?? '';
      if (logRows[i].textContent !== line) logRows[i].textContent = line;
    }
    logEl.classList.toggle('is-empty', log.length === 0);
    if (!log.length) logRows[0].textContent = t('analytics.bot.logEmpty');
  }

  /** 지금 상태 줄의 마지막 값(바뀔 때만 문면을 다시 만든다 — 프레임마다 할당 없음) */
  const seen = { on: /** @type {boolean|null} */ (null), ch: /** @type {any} */ (undefined), lv: -1, unl: -1, scene: '', rl: -1, gauge: -1, lives: -1 };

  /** 지금 상태 줄(값이 바뀔 때만 DOM) @param {any} state */
  function drawStatus(state) {
    const ch = state?.char ?? null;
    const r = state?.scene === 'rift' ? state.rift : null;
    const gauge = r ? Math.round(r.gauge ?? 0) : -1;
    if (seen.on === botOn && seen.ch === ch && seen.lv === (ch?.level ?? -1) && seen.unl === (ch?.riftUnlocked ?? -1) && seen.scene === (state?.scene ?? '')
      && seen.rl === (r ? r.level : -1) && seen.gauge === gauge && seen.lives === (r ? r.lives ?? 0 : -1)) return;
    seen.on = botOn; seen.ch = ch; seen.lv = ch?.level ?? -1; seen.unl = ch?.riftUnlocked ?? -1; seen.scene = state?.scene ?? '';
    seen.rl = r ? r.level : -1; seen.gauge = gauge; seen.lives = r ? r.lives ?? 0 : -1;
    status.textContent = t(botOn ? 'analytics.bot.on' : 'analytics.bot.off');
    status.className = 'an-bstatus ' + (botOn ? 'is-on' : 'is-off');
    /** @type {string[]} */
    const out = [];
    if (!ch) out.push(t('analytics.bot.noChar'));
    else {
      out.push(`${t('class.' + ch.cls)} · ${t('hud.level', { n: ch.level })} · ${t('notice.unlock', { n: ch.riftUnlocked })}`);
      if (r) out.push(`${t('riftStone.level', { n: r.level })} · ${t('hud.gauge')} ${fmtNum(gauge, 0)}% · ${t('hud.lives')} ${fmtInt(r.lives ?? 0)}`);
      else out.push(t('tileset.town'));
    }
    lines.textContent = out.join('\n');
  }

  return {
    el,
    /** @param {any} state */
    show(state) {
      if (typeof ctx.ui?.botOn === 'boolean') botOn = ctx.ui.botOn;
      const n = presetCount();
      if (preset >= n) preset = 0;
      err.textContent = '';
      form.nav.active = true;
      if (form.nav.index < 0) form.nav.focus(botOn ? 2 : 0, true);
      form.refresh();
      lastState = state;
      drawStatus(state);
      drawLog();
    },
    hide() { form.nav.active = false; },
    stop() {},
    /** @param {any} state */
    update(state) {
      lastState = state;
      drawStatus(state);
    },
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) { return form.handleKey(e); },
    /** 테스트 · 화면 확인용 */
    get log() { return log.slice(); },
    get on() { return botOn; },
    dispose() {
      for (const off of offs) { try { off(); } catch { /* 이미 떨어졌다 */ } }
      offs.length = 0;
      form.destroy();
      el.remove();
    },
  };
}
