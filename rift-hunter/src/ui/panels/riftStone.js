// OWNER: P11 — 계약 §10.1 · §10.2 · §10.6
// 균열석(모달 · INTERACT{riftStone}): 레벨 목록(1 ~ 해금 + 3 · 잠긴 것 회색) · 고른 레벨의 몬스터 레벨 · 생명/피해 배율 · 보상 배율(아이템 레벨 · 등급 · 골드 · 경험치) ·
// 챔피언/정예 속성 수 · 최고 기록 · 「Enter — 균열 열기」 · 「클리어 +1 · 무사망 +2」.
// 기본 포커스 = 다음 판(defaultRiftLevel — 「추천」 표시) → Enter 한 번. 열린 균열이 진행 중(active · guardian)일 때만 확인 · 완료면 조용히 닫는다(남은 희귀 이상이 있으면 한 줄).

import { RARITIES } from '../../core/constants.js';
import { EV } from '../../core/events.js';
import { KEYBINDS } from '../../data/keybinds.js';
import { previewRift } from '../../sim/progression/progress.js';
import { fmtMul, fmtSec } from '../format.js';
import { createItemList } from '../pnlBagGrid.js';
import { createErrorLine, isDown } from '../pnlCommon.js';
import { defaultRiftLevel, leftLootCount, needsCloseConfirm, riftListMax } from '../pnlLogic.js';

/** @typedef {import('../../types.js').Panel} Panel */

const NAV = [KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right, 'Enter', 'NumpadEnter', 'Space'];

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createRiftStonePanel(ctx) {
  const { t, widgets: w, sim, actions, ui } = ctx;
  const el = w.panelFrame('panel.riftStone.title');
  el.dataset.panel = 'riftStone';
  el.classList.add('pnl-rift');
  el.appendChild(w.el('div', 'shop-greet', t('npc.riftStone.greet')));
  const body = el.appendChild(w.el('div', 'two-col'));
  const leftBox = body.appendChild(w.el('div', 'area is-area shop-left'));
  const list = createItemList(ctx, {
    onPick: () => open(),
    onFocus: () => { err.clear(); renderDetail(); },
  });
  leftBox.appendChild(list.el);
  const detail = body.appendChild(w.el('div', 'area area-grow rift-detail'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const err = createErrorLine(ctx);
  foot.appendChild(err.el);

  let dirty = true;
  let recommended = 1;
  let busy = false;
  /** @type {Array<() => void>} */
  const offs = [];
  if (ctx.bus) {
    const mark = () => { dirty = true; };
    for (const name of [EV.UNLOCK, EV.CHAR_LOADED, EV.RIFT_CLOSED, EV.RIFT_OPENED]) offs.push(ctx.bus.on(name, mark));
  }

  const levelAt = (i) => i + 1;

  function renderList() {
    const ch = sim?.state?.char ?? null;
    const max = ch ? riftListMax(ch) : 1;
    recommended = defaultRiftLevel(ch);
    list.set(max, (i) => {
      const L = levelAt(i);
      const b = ch?.best?.[String(L)];
      return `${L}|${L <= (ch?.riftUnlocked ?? 1) ? 1 : 0}|${L === recommended ? 1 : 0}|${b ? b.timeSec + ':' + b.deaths : ''}`;
    }, (row, i) => {
      const L = levelAt(i);
      const pv = previewRift(ch, L);
      row.classList.add('rift-row');
      row.appendChild(w.el('span', 'row-main rift-row-lv', t('riftStone.level', { n: L })));
      row.appendChild(w.el('span', 'row-sub', t('riftStone.monLevel', { n: pv.monLevel })));
      if (L === recommended) row.appendChild(w.el('span', 'row-badge', t('riftStone.recommended')));
      if (!pv.unlocked) { row.classList.add('is-off'); row.appendChild(w.el('span', 'row-side', t('riftStone.locked'))); }
      else row.appendChild(w.el('span', 'row-side row-sub', pv.best ? fmtSec(pv.best.timeSec) : ''));
    });
  }

  function renderDetail() {
    detail.textContent = '';
    const ch = sim?.state?.char ?? null;
    if (!ch) return;
    const i = list.index >= 0 ? list.index : recommended - 1;
    const L = levelAt(i);
    const pv = previewRift(ch, L);
    detail.appendChild(w.el('h3', '', t('riftStone.level', { n: L })));
    /** @param {string} a @param {string} [b] */
    const kv = (a, b = '') => {
      const r = detail.appendChild(w.el('div', 'rift-kv'));
      r.appendChild(w.el('span', '', a));
      r.appendChild(w.el('span', '', b));
      return r;
    };
    kv(t('riftStone.monLevel', { n: pv.monLevel }));
    // 최종 게이트: 균열 1~4 는 첫 판 경사로 피해 ×0.03~×0.10 이라 소수 둘째 자리로는 단계 차이가 안 보였다 — 0.1 아래는 셋째 자리까지 ·
    //   앞 레벨보다 몇 % 오르는지 한 줄(previewRift 의 배율은 몬스터에 실제로 곱하는 값 — 첫 판 경사 포함)
    const mulDigits = (v) => (v < 0.1 ? 3 : 2);
    kv(t('riftStone.hp', { v: fmtMul(pv.hpMul, mulDigits(pv.hpMul)).slice(1) }));
    kv(t('riftStone.dmg', { v: fmtMul(pv.dmgMul, mulDigits(pv.dmgMul)).slice(1) }));
    if (L > 1) {
      const prev = previewRift(ch, L - 1);
      const pct = (a, b) => (b > 0 ? Math.round((a / b - 1) * 100) : 0);
      const sign = (n) => (n >= 0 ? '+' : '−') + Math.abs(n) + '%';
      kv(t('riftStone.step', { n: L - 1, h: sign(pct(pv.hpMul, prev.hpMul)), d: sign(pct(pv.dmgMul, prev.dmgMul)) }));
    }
    kv(t('riftStone.affixes', { a: pv.champAffixes, b: pv.eliteAffixes }));
    kv(t('riftStone.ilvl', { n: pv.ilvl }));
    const rr = kv(t('riftStone.rarity'));
    rr.lastChild.textContent = RARITIES.filter((r) => r !== 'normal').map((r) => `${t('rarity.' + r)} ${fmtMul(Number(pv.rarityMul?.[r]) || 1)}`).join(' · ');
    kv(t('riftStone.gold', { v: fmtMul(pv.goldMul).slice(1) }));
    kv(t('riftStone.xp', { v: fmtMul(pv.xpMul).slice(1) }));
    kv(pv.best ? t('riftStone.best', { t: fmtSec(pv.best.timeSec) }) : t('riftStone.none'), pv.best ? t('complete.deaths') + ' ' + pv.best.deaths : '');
    detail.appendChild(w.el('div', 'rift-note', t('riftStone.unlockRule')));
    const state = sim?.state ?? null;
    if (state?.rift && needsCloseConfirm(state)) detail.appendChild(w.el('div', 'rift-warn', t('riftStone.closeOpen')));
    const left = leftLootCount(state);
    if (state?.rift && left > 0) detail.appendChild(w.el('div', 'rift-warn', t('riftStone.leftLoot', { n: left })));
    const btn = w.button('riftStone.open', () => open());
    btn.classList.add('is-primary', 'rift-open');
    btn.disabled = !pv.unlocked;
    if (!pv.unlocked) btn.textContent = t('riftStone.locked');
    detail.appendChild(btn);
  }

  /** 균열 열기 — 진행 중인 균열이 있을 때만 확인 */
  function open() {
    if (busy) return;
    const ch = sim?.state?.char ?? null;
    if (!ch) return;
    const L = levelAt(list.index >= 0 ? list.index : recommended - 1);
    if (L > (ch.riftUnlocked ?? 1)) { err.show({ ok: false, reason: 'locked' }); return; }
    const go = () => {
      const res = actions?.openRift ? actions.openRift(L) : sim.openRift(L);
      if (err.show(res)) ui?.closePanel?.('riftStone', 'confirm');
    };
    if (needsCloseConfirm(sim.state)) {
      busy = true;
      w.confirm('riftStone.closeOpen').then((ok) => { busy = false; if (ok) go(); });
    } else go();
  }

  return {
    id: 'riftStone',
    modal: true,
    el,
    open() {
      err.clear();
      busy = false;
      list.invalidate();
      renderList();
      list.focus(recommended - 1);
      renderDetail();
      dirty = false;
    },
    close() {},
    update() {
      if (!dirty) return;
      dirty = false;
      const keep = list.index;
      renderList();
      if (keep < 0) list.focus(recommended - 1);
      renderDetail();
    },
    handleKey(e) {
      const code = e.code;
      if (code === KEYBINDS.pause) return false;
      if (!isDown(e)) return NAV.includes(code);
      if (NAV.includes(code)) {
        if ((code === 'Enter' || code === 'NumpadEnter' || code === 'Space') && e.repeat) return true;
        return list.handleKey(e);
      }
      return false;
    },
    keys: [...NAV, KEYBINDS.pause],
    dispose() {
      for (const off of offs) off();
      list.dispose();
      el.remove();
    },
  };
}
