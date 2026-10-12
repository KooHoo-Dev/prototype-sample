// OWNER: P11 — 계약 §10.1 · §10.2 · §10.5-8 · §10.6
// 신비술사(모달 · INTERACT{npc mystic}): 왼쪽 단계 목록 — ① 아이템 고르기(장착 중인 것 · 오른쪽 가방 격자에서도) → ② 옵션 고르기(이미 고정된 옵션이 있으면 그것만) →
// 비용(골드 · 비전 가루 · 망각의 정수 — priceReroll(item) 그대로 · n번째) → 「굴리기」 → ③ 후보 셋(기존 + 새 둘) 중 Enter. Escape = 한 단계 뒤(③이면 취소 — 비용 없음).
// ①의 마지막 행: 스킬 초기화 — 비용(confirm). 전 · 후 표: 골드 · 재료 · (③) 옵션 값.

import { EQUIP_SLOTS } from '../../core/constants.js';
import { KEYBINDS } from '../../data/keybinds.js';
import { pointsFree, pointsSpent, pointsTotal } from '../../sim/progression/progress.js';
import { priceReroll, priceReset } from '../../sim/progression/shops.js';
import { fmtInt } from '../format.js';
import { tName } from '../i18n.js';
import { affixLine, lineText } from '../itemText.js';
import { costRows, isDown } from '../pnlCommon.js';
import { mysticEquipList } from '../pnlLogic.js';
import { createShopFrame } from '../pnlShop.js';

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createMysticPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const char = () => sim?.state?.char ?? null;
  /** 단계: item(아이템 고르기) · affix(옵션 고르기) · offer(후보 고르기) */
  let step = 'item';
  /** 고른 아이템 참조(가방 idx 또는 장착 칸) @type {null|{where:'bag'|'equip', idx?:number, slot?:string}} */
  let sel = null;
  /** 단계 머리 */
  let head = null;

  /** 고른 아이템 */
  function selItem() {
    const ch = char();
    if (!ch || !sel) return null;
    if (sel.where === 'bag') return ch.bag?.[/** @type {number} */ (sel.idx)] ?? null;
    return ch.equip?.[/** @type {string} */ (sel.slot)] ?? null;
  }
  /** 진행 중인 제안(있으면 그 아이템을 고른다) */
  function syncOffer() {
    const ch = char();
    const off = ch?.shop?.reroll ?? null;
    if (!off) return null;
    const ref = off.where === 'bag' ? { where: 'bag', idx: off.idx } : { where: 'equip', slot: EQUIP_SLOTS[off.idx] };
    const it = ref.where === 'bag' ? ch.bag?.[off.idx] : ch.equip?.[/** @type {string} */ (ref.slot)];
    if (!it || it.id !== off.itemId) return null;
    sel = /** @type {any} */ (ref);
    step = 'offer';
    return off;
  }
  const adv = () => true;   // 신비술사는 늘 티어 · 범위를 보인다(분석 — 재굴림으로 무엇이 나올 수 있는가)

  /** 지금 단계의 행 */
  function rowsNow() {
    const ch = char();
    if (!ch) return [];
    if (step === 'item') {
      const list = mysticEquipList(ch).map((e) => ({ kind: 'equip', slot: e.slot, item: e.item }));
      return [...list, { kind: 'reset' }];
    }
    const it = selItem();
    if (!it) return [];
    if (step === 'affix') return it.affixes.map((a, i) => ({ kind: 'affix', i, a, item: it }));
    const off = ch.shop?.reroll;
    if (!off) return [];
    return off.options.map((a, i) => ({ kind: 'option', i, a, item: it }));
  }

  const f = createShopFrame(ctx, {
    id: 'mystic', className: 'pnl-mystic', greet: 'npc.mystic.greet',
    sell: false, salvage: false, repair: false, bulk: false,
    onPick: (i) => pick(i),
    leftItem: (i) => {
      const r = rowsNow()[i];
      if (!r) return null;
      if (r.kind === 'equip') return { item: r.item, where: 'equip' };
      return null;
    },
    leftTrade: (i) => {
      const ch = char();
      const r = rowsNow()[i];
      if (!ch || !r) return null;
      if (r.kind === 'reset') {
        const free = pointsFree(ch);
        return {
          title: t('shop.reset', { n: fmtInt(priceReset(ch)) }),
          rows: [...costRows(t, ch, -priceReset(ch)), { label: '', before: t('skill.points', { n: free }), after: t('skill.points', { n: pointsTotal(ch.level) }), dir: pointsSpent(ch) > 0 ? 1 : 0 }],
        };
      }
      if (r.kind === 'equip') return costPreview(r.item);
      const it = r.item;
      const rows = costPreview(it);
      if (r.kind === 'option') {
        const cur = it.affixes[ch.shop.reroll.affixIdx];
        rows.rows.push({ label: '', before: lineText(affixLine(cur, it.ilvl)), after: lineText(affixLine(r.a, it.ilvl)), dir: r.i === 0 ? 0 : 1 });
      }
      return rows;
    },
    onKey: (e) => {
      if (e.code !== KEYBINDS.pause) return false;
      if (!isDown(e)) return true;
      if (step === 'offer') { f.done(sim.rerollCancel()); step = 'affix'; refresh(); return true; }
      if (step === 'affix') { step = 'item'; sel = null; refresh(); return true; }
      return false;
    },
    onUpdate: () => renderRows(),
    onFocusChange: () => {},
  });
  head = w.el('div', 'reroll-step');
  f.list.el.before(head);

  /** 비용 미리보기(전 · 후) @param {any} item */
  function costPreview(item) {
    const ch = char();
    const c = priceReroll(item);
    return { title: costText(item), rows: costRows(t, ch, -c.gold, { dust: -c.dust, essence: -c.essence }) };
  }
  /** shop.rerollCost + 망각의 정수(있으면) @param {any} item */
  function costText(item) {
    const c = priceReroll(item);
    let s = t('shop.rerollCost', { n: fmtInt(c.gold), d: c.dust, k: (item.rerolls | 0) + 1 });
    if (c.essence > 0) s += ' · ' + t('mat.essence') + ' ' + c.essence;
    return s;
  }

  /** 단계가 바뀌었다 — 목록을 새로 · 포커스는 맨 앞(옵션 단계면 고정된 옵션) */
  function refresh() {
    f.list.invalidate();
    const it = step === 'affix' ? selItem() : null;
    const fixed = it && Number.isInteger(it.rerollIdx) ? it.rerollIdx : 0;
    focusAfter = fixed;
    f.markDirty();
  }
  let focusAfter = 0;

  function renderRows() {
    if (step !== 'offer') { const off = syncOffer(); void off; }
    if (step !== 'item' && !selItem()) { step = 'item'; sel = null; }
    const ch = char();
    const rows = rowsNow();
    const it = selItem();
    head.textContent = step === 'item' ? t('shop.reroll') : step === 'affix' ? `${tName(it?.name)} · ${costText(it)}` : `${tName(it?.name)} · ${t('shop.rerollPick')}`;
    f.list.set(rows.length, (i) => {
      const r = rows[i];
      if (r.kind === 'reset') return `r|${ch?.gold}|${ch?.level}|${pointsSpent(ch)}`;
      if (r.kind === 'equip') return `e|${r.item.id}|${r.item.rerollIdx}|${r.item.rerolls}`;
      return `${r.kind}|${step}|${r.item.id}|${r.i}|${r.a?.id}|${r.a?.value}|${r.item.rerollIdx}|${adv()}`;
    }, (row, i) => {
      const r = rows[i];
      if (r.kind === 'reset') {
        row.classList.add('row-sep');
        row.appendChild(w.el('span', 'row-main', t('shop.reset', { n: fmtInt(priceReset(ch)) })));
        return;
      }
      if (r.kind === 'equip') {
        row.appendChild(w.el('span', 'row-main r-' + r.item.rarity, tName(r.item.name)));
        row.appendChild(w.el('span', 'row-sub', t('slot.' + r.slot)));
        return;
      }
      const line = affixLine(r.a, r.item.ilvl, { advanced: adv() });
      if (r.kind === 'affix') {
        const lockedOther = r.item.rerollIdx !== null && r.item.rerollIdx !== undefined && r.item.rerollIdx !== r.i;
        row.appendChild(w.el('span', 'row-main', lineText(line)));
        if (r.item.rerollIdx === r.i) row.appendChild(w.el('span', 'row-badge is-warn', t('inv.locked')));
        if (lockedOther) row.classList.add('is-off');
        return;
      }
      row.appendChild(w.el('span', 'row-main', lineText(line)));
      if (r.i === 0) row.appendChild(w.el('span', 'row-badge', t('shop.rerollKeep')));
    });
    if (focusAfter >= 0) {
      f.list.nav.focus(Math.min(focusAfter, Math.max(0, rows.length - 1)), true);
      focusAfter = -1;
    }
  }

  /** @param {number} i */
  function pick(i) {
    const ch = char();
    const r = rowsNow()[i];
    if (!ch || !r) return;
    if (r.kind === 'reset') {
      w.confirm('shop.resetConfirm').then((ok) => { if (ok) f.done(sim.resetSkills()); });
      return;
    }
    if (r.kind === 'equip') { sel = { where: 'equip', slot: r.slot }; step = 'affix'; refresh(); return; }
    if (r.kind === 'affix') {
      const res = f.done(sim.rerollOffer(/** @type {any} */ (sel), r.i));
      if (res?.ok) { step = 'offer'; refresh(); }
      return;
    }
    const res = f.done(sim.rerollChoose(r.i));
    if (res?.ok) { step = 'affix'; refresh(); }
  }

  /** 가방 칸을 골랐다(Enter · 클릭) — 그 아이템의 옵션 고르기로 */
  f.bag.opts.onPick = (i) => {
    const it = f.bag.itemAt(i);
    if (!it) return;
    if (!it.affixes?.length) { f.err.show({ ok: false, reason: 'invalid' }); return; }
    if (char()?.shop?.reroll) sim.rerollCancel();
    sel = { where: 'bag', idx: i };
    step = 'affix';
    f.areas.set(0, false);
    refresh();
  };

  return {
    id: 'mystic',
    modal: true,
    el: f.el,
    open(args = {}) {
      step = 'item';
      sel = null;
      f.open(args);
    },
    close() { f.close(); },
    update(state) { f.update(state); },
    handleKey(e) { return f.handleKey(e); },
    keys: f.keys,
    dispose() { f.dispose(); },
  };
}
