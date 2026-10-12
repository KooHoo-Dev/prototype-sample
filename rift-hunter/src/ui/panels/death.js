// OWNER: P10 — 계약 §10.2(death) · §10.5-6(Enter 버퍼) · §10.6(사망) · §5.10
// 「쓰러졌다」 · 처치자(player.killedBy — 정예면 생성된 이름 · 등급색) · 남은 생명(0이면 다음 사망 붕괴 경고) · 수리비 ·
// 「Enter — 마을에서 부활」 · 붕괴면 붕괴 문구 + 그 판 요약 + 「잃은 것」 줄.
// Enter = ui.respawnFromPanel()(app 의 actions.respawn) · Esc = 일시정지(패널은 사망 중에는 닫히지 않는다).
// 열기는 UIRoot 가 한다(PLAYER_DIED + DEATH.panelDelay · 상태를 보고 — 패널이 뜨기 전에 누른 Enter 는 뜨는 틱에 실행).

import { tName } from '../i18n.js';
import { fmtInt } from '../format.js';
import { repairCost } from '../../sim/progression/inventory.js';
import { renderSummary } from './riftComplete.js';

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createDeathPanel(ctx) {
  const { t, widgets: w, sim, ui } = ctx;
  const el = w.panelFrame('panel.death.title');
  el.dataset.panel = 'death';
  el.classList.add('pnl-death');
  const h = /** @type {HTMLElement} */ (el.querySelector('.panel-title'));
  h.textContent = t('death.title');
  const killer = el.appendChild(w.el('div', 'death-killer'));
  const collapse = el.appendChild(w.el('div', 'death-collapse', t('death.collapse')));
  const lives = el.appendChild(w.el('div', 'death-lives'));
  const last = el.appendChild(w.el('div', 'death-last', t('death.lastLife')));
  const repair = el.appendChild(w.el('div', 'death-repair'));
  const sumHead = el.appendChild(w.el('div', 'sum-head', t('death.summary')));
  const table = el.appendChild(w.el('div', 'sum-table'));
  const lost = el.appendChild(w.el('div', 'death-lost'));
  const err = el.appendChild(w.el('div', 'panel-error'));
  const btns = el.appendChild(w.el('div', 'btn-row'));
  const go = btns.appendChild(w.button('death.respawn', () => respawn(), 'Enter'));
  go.classList.add('is-primary');
  let sig = '';

  function respawn() {
    err.textContent = '';
    const res = ui.respawnFromPanel?.();
    if (res && res.ok === false) err.textContent = t('reason.' + res.reason, res.params);
  }
  /** @param {any} state */
  function draw(state) {
    const p = state?.player;
    const r = state?.rift;
    const ch = state?.char;
    const kb = p?.killedBy ?? null;
    const collapsed = !!r && r.phase === 'collapsed';
    const n = r ? Math.max(0, r.lives | 0) : 0;
    const cost = ch ? repairCost(ch) : 0;
    const s = `${kb ? kb.typeId + kb.rank + (kb.name || []).join() : '-'}|${collapsed}|${n}|${cost}|${r?.phase}|${r?.summary ? 1 : 0}`;
    if (s === sig) return;
    sig = s;
    if (kb) {
      const name = kb.name && kb.name.length ? tName(kb.name) : t('mon.' + kb.typeId);
      killer.textContent = t('death.killedBy', { name });
      killer.className = 'death-killer rank-' + kb.rank;
      killer.hidden = false;
    } else killer.hidden = true;
    collapse.hidden = !collapsed;
    lives.hidden = collapsed || !r;
    lives.textContent = t('death.lives', { n });
    last.hidden = collapsed || !r || n > 0 || r.phase === 'complete';
    repair.textContent = t('death.repair', { n: fmtInt(cost) });
    const showSum = collapsed && !!r?.summary;
    sumHead.hidden = !showSum;
    table.hidden = !showSum;
    if (showSum) renderSummary(table, r.summary, t, w);
    else table.textContent = '';
    lost.hidden = !collapsed;
    // 잃은 것: 수호자 보장 드랍 · 해금 — 이번 판을 깼다면 열렸을 단계(사망이 있었으니 +1)
    lost.textContent = t('death.lost', { n: r && r.deaths === 0 ? 2 : 1 });
    go.textContent = t(collapsed ? 'death.toTown' : 'death.respawn');
  }

  return {
    id: 'death',
    modal: true,
    el,
    open() { err.textContent = ''; sig = ''; draw(sim?.state); },
    close() {},
    update(state) { draw(state); },
    handleKey(e) {
      const down = e.type !== 'keyup';
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        if (down && !e.repeat) respawn();
        return true;
      }
      if (e.code === 'Escape') {
        if (down && !e.repeat) ui.openPanel('pause');
        return true;
      }
      return false;
    },
    keys: ['Enter', 'NumpadEnter', 'Space', 'Escape'],
    dispose() { el.remove(); },
  };
}
