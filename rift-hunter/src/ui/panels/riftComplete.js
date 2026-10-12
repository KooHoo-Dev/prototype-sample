// OWNER: P10 — 계약 §10.2(riftComplete) · §10.6(균열 완료) · 브리프 §2
// 균열 완료: 시간 · 처치(등급별) · 사망 · 획득(등급별 장비 수) · 골드 · 경험치 · 업그레이드 · 다음 레벨 해금(무사망이면 +2 강조) · 최고 기록.
// Enter(또는 Esc) = 닫고 계속 줍기 · T = 마을로(sim.leaveRift — 나가는 포털과 같다).
// renderSummary 는 사망 패널(붕괴 — 그 판 요약)도 같이 쓴다.

import { RARITIES } from '../../core/constants.js';
import { fmtInt, fmtSec } from '../format.js';
import { completeBadges, upgradeCountGain } from '../pnlLogic.js';

/** @typedef {import('../../types.js').Panel} Panel */

const KILL_KEYS = ['normal', 'champion', 'elite', 'minion', 'guardian', 'other'];
/** 문턱 비율 → 「3」 · 「0.5」(소수 한 자리까지 · 끝의 0 은 뺀다) @param {number} g */
const fmtPct = (g) => String(Math.round(g * 1000) / 10);

/**
 * 판 요약 표(RunSummary) — host 를 비우고 다시 그린다.
 * @param {HTMLElement} host @param {any} s RunSummary @param {(k:string, p?:Object) => string} t @param {any} w widgets
 */
export function renderSummary(host, s, t, w) {
  host.textContent = '';
  if (!s) return;
  const row = (labelKey, value, cls = '') => {
    const r = host.appendChild(w.el('div', 'sum-row ' + cls));
    r.appendChild(w.el('div', 'sum-label', t(labelKey)));
    const v = r.appendChild(w.el('div', 'sum-value'));
    if (typeof value === 'string') v.textContent = value;
    else v.appendChild(value);
    return r;
  };
  row('complete.time', fmtSec(s.timeSec));
  const kills = s.kills ?? {};
  let total = 0;
  for (const k of KILL_KEYS) total += Number(kills[k]) || 0;
  const kv = w.el('span', 'sum-parts');
  kv.appendChild(w.el('b', '', fmtInt(total)));
  for (const k of KILL_KEYS) {
    const n = Number(kills[k]) || 0;
    if (!n) continue;
    kv.appendChild(w.el('span', 'sum-part rank-' + k, `${k === 'other' ? t('complete.other') : t('rank.' + k)} ${fmtInt(n)}`));
  }
  row('complete.kills', kv);
  row('complete.deaths', fmtInt(s.deaths ?? 0), s.deaths ? 'is-bad' : '');
  const dv = w.el('span', 'sum-parts');
  let dropTotal = 0;
  for (const r of RARITIES) dropTotal += Number(s.drops?.[r]) || 0;
  dv.appendChild(w.el('b', '', fmtInt(dropTotal)));
  for (const r of RARITIES) {
    const n = Number(s.drops?.[r]) || 0;
    if (!n) continue;
    dv.appendChild(w.el('span', 'sum-part r-' + r, `${t('rarity.' + r)} ${fmtInt(n)}`));
  }
  row('complete.drops', dv);
  row('complete.gold', fmtInt(s.gold ?? 0));
  row('complete.xp', fmtInt(s.xp ?? 0));
  // 피드백 2 D5 — 측정(업그레이드 판 비율)과 같은 문턱을 문면에(세는 것은 sim 의 rift.stats.upgrades — 같은 data 값을 읽는다)
  const uv = w.el('span', 'sum-parts');
  uv.appendChild(w.el('b', '', fmtInt(s.upgrades ?? 0)));
  uv.appendChild(w.el('span', 'sum-part sum-note', t('complete.upgradesNote', { pct: fmtPct(upgradeCountGain()) })));
  row('complete.upgrades', uv);
}

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createRiftCompletePanel(ctx) {
  const { t, widgets: w, sim, ui } = ctx;
  const el = w.panelFrame('panel.riftComplete.title');
  el.dataset.panel = 'riftComplete';
  el.classList.add('pnl-complete');
  const h = /** @type {HTMLElement} */ (el.querySelector('.panel-title'));
  const badges = el.appendChild(w.el('div', 'complete-badges'));
  const unlock = badges.appendChild(w.el('div', 'complete-unlock'));
  const bonus = badges.appendChild(w.el('div', 'complete-bonus', t('complete.noDeathBonus')));
  const record = badges.appendChild(w.el('div', 'complete-record', t('complete.record')));
  const table = el.appendChild(w.el('div', 'sum-table'));
  const err = el.appendChild(w.el('div', 'panel-error'));
  const btns = el.appendChild(w.el('div', 'btn-row'));
  const okBtn = btns.appendChild(w.button('complete.ok', () => ok(), 'Enter'));
  okBtn.classList.add('is-primary');
  btns.appendChild(w.button('complete.toTown', () => toTown(), 'KeyT'));
  /** @type {any} */
  let shown = null;

  function ok() { ui.closePanel('riftComplete', 'confirm'); }
  function toTown() {
    err.textContent = '';
    const res = sim?.leaveRift?.();
    if (res && res.ok === false) { err.textContent = t('reason.' + res.reason, res.params); return; }
    ui.closePanel('riftComplete', 'key');
  }
  /** @param {any} state */
  function draw(state) {
    const s = state?.rift?.summary ?? null;
    shown = s;
    if (!s) { table.textContent = ''; return; }
    h.textContent = t('complete.title', { n: s.level });
    // 이번 판이 해금을 실제로 올렸을 때만 — 균열을 열 때의 해금(UIRoot 가 RIFT_OPENED 에 적는다)과 비교(pnlLogic.completeBadges)
    const b = completeBadges(s, Number.isFinite(ui?.unlockAtOpen) ? ui.unlockAtOpen : null);
    unlock.textContent = t('complete.unlock', { n: s.unlockedTo });
    unlock.hidden = !b.raised;
    bonus.hidden = !b.bonus;
    record.hidden = !s.record;
    renderSummary(table, s, t, w);
  }

  return {
    id: 'riftComplete',
    modal: true,
    el,
    open() { err.textContent = ''; draw(sim?.state); },
    close() {},
    update(state) { if ((state?.rift?.summary ?? null) !== shown) draw(state); },
    handleKey(e) {
      const down = e.type !== 'keyup';
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'Escape') {
        if (down && !e.repeat) ok();
        return true;
      }
      if (e.code === 'KeyT') {
        if (down && !e.repeat) toTown();
        return true;
      }
      return false;
    },
    keys: ['Enter', 'NumpadEnter', 'Space', 'Escape', 'KeyT'],
    dispose() { el.remove(); },
  };
}
