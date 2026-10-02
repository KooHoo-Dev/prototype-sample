// OWNER: P8 — 계약 §10.3 상인 패널
// 읽는 것: progression.getShopItems() · profile.relicsEquipped · profile.embers. 부르는 것: buy(itemId) · equipRelic(slot, id|null).
// 산 유물은 빈 칸에 자동 장착된다(Progression). 보유한 유물은 1 · 2 칸 버튼으로 옮기거나 뗀다
// (다른 칸으로 옮기면 그 칸의 유물과 자리를 맞바꾼다 — equipRelic 한 번).
import { RELICS } from '../../data/relics.js';
import { ECONOMY } from '../../data/economy.js';
import { el, add, num, fmtInt, fmtNum } from '../dom.js';
import { t } from '../i18n.js';
import { Panel } from './panelBase.js';

const RELIC_PREFIX = 'relic:';
/** 유물을 산 직후 그 유물의 칸 버튼이 입력을 받지 않는 시간(ms) */
const BUY_GUARD_MS = 700;

/**
 * 유물 설명의 {자리}를 data/relics.js의 값으로 채운다.
 * 값 그대로(`{parryWindow}`)와 퍼센트(`{staminaRegenPct}` — 배율은 1과의 차, 그 밖은 비율 × 100) 두 가지를 준다.
 * @param {string} relicId
 * @returns {Record<string, string>}
 */
function relicParams(relicId) {
  const def = RELICS[relicId];
  /** @type {Record<string, string>} */
  const out = {};
  if (!def) return out;
  const put = (key, v, isMul) => {
    out[key] = fmtNum(v, 2);
    out[`${key}Pct`] = String(Math.round(Math.abs(isMul ? v - 1 : v) * 100));
  };
  for (const [k, v] of Object.entries(def.mods ?? {})) put(k, v, false);
  for (const [k, v] of Object.entries(def.mul ?? {})) put(k, v, true);
  for (const [k, v] of Object.entries(def.set ?? {})) put(k, v, k.endsWith('Mul'));
  return out;
}

/** @param {string|null} relicId */
const relicName = (relicId) => (relicId ? t(`relic.${relicId}.name`) : t('panel.merchant.empty'));

export class MerchantPanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, { closable: true });
    this.hints('panel.hint.select', 'panel.hint.switch', 'panel.hint.confirm', 'panel.hint.close');
  }

  build() {
    const { progression } = this.ctx.deps;
    const profile = progression.profile ?? {};
    const items = progression.getShopItems() ?? [];
    this.wallet(false);
    this._firstAffordable = null;

    // ── 장착한 유물 2칸 ──
    const slots = el('div', 'ac-slots');
    add(slots, el('span', 'ac-slots-label', t('panel.merchant.slots')));
    const equipped = profile.relicsEquipped ?? [];
    for (let s = 0; s < ECONOMY.relicSlots; s++) {
      const id = equipped[s] ?? null;
      add(slots, add(el('span', id ? 'ac-slot ac-filled' : 'ac-slot'),
        el('b', '', t('panel.merchant.slot', { n: s + 1 })), el('span', '', relicName(id))));
    }
    add(this.body, slots);

    const list = el('div', 'ac-shop');
    const flasks = items.filter((it) => it.kind !== 'relic');
    const relics = items.filter((it) => it.kind === 'relic');
    if (flasks.length) {
      add(list, el('h3', 'ac-section', t('panel.merchant.flasks')));
      for (const it of flasks) add(list, this._flaskRow(it));
    }
    if (relics.length) {
      add(list, el('h3', 'ac-section', t('panel.merchant.relics')));
      for (const it of relics) add(list, this._relicRow(it));
      add(list, el('div', 'ac-shop-note', t('panel.merchant.slotHint')));
    }
    if (!items.length) add(list, el('div', 'ac-muted ac-shop-empty', t('panel.none')));
    add(this.body, list);
  }

  defaultFocus() {
    return this._firstAffordable;
  }

  // ── 내부 ──

  /** 살 수 있는 첫 품목을 기본 포커스로 기억한다. @param {Object} it @param {string} key */
  _noteAffordable(it, key) {
    if (this._firstAffordable === null && it.canAfford && !it.soldOut && !it.owned) this._firstAffordable = key;
  }

  /** 플라스크 품목: 단계 · 지금 값 → 다음 값 · 가격. @param {Object} it @returns {HTMLElement} */
  _flaskRow(it) {
    const { progression } = this.ctx.deps;
    const rowEl = el('div', 'ac-shop-row');
    const value = el('span', 'ac-shop-value');
    if (it.valueNow !== null && it.valueNow !== undefined) add(value, el('span', '', fmtInt(it.valueNow)));
    if (!it.soldOut && it.valueNext !== null && it.valueNext !== undefined) {
      add(value, el('span', 'ac-arrow', '→'), el('span', 'ac-to', fmtInt(it.valueNext)));
    }
    add(rowEl,
      add(el('div', 'ac-shop-main'),
        el('span', 'ac-shop-name', t(`item.${it.id}.name`)),
        el('span', 'ac-shop-level', t('panel.merchant.level', { level: num(it.level), max: num(it.maxLevel) }))),
      add(el('div', 'ac-shop-desc'), el('span', '', t(`item.${it.id}.desc`)), value),
      this._priceTag(it));
    if (it.soldOut) rowEl.classList.add('ac-sold');
    else if (!it.canAfford) rowEl.classList.add('ac-poor');
    this._noteAffordable(it, it.id);
    this.row(this.item(rowEl, it.id, { activate: () => progression.buy(it.id), denied: it.soldOut ? 'max' : null }));
    return rowEl;
  }

  /** 유물: 미보유면 구매, 보유면 칸 버튼 둘. @param {Object} it @returns {HTMLElement} */
  _relicRow(it) {
    const { progression } = this.ctx.deps;
    const relicId = String(it.id).slice(RELIC_PREFIX.length);
    const rowEl = el('div', 'ac-shop-row');
    add(rowEl,
      add(el('div', 'ac-shop-main'), el('span', 'ac-shop-name', t(`relic.${relicId}.name`))),
      el('div', 'ac-shop-desc', t(`relic.${relicId}.desc`, relicParams(relicId))));

    if (!it.owned) {
      add(rowEl, this._priceTag(it));
      if (!it.canAfford) rowEl.classList.add('ac-poor');
      this._noteAffordable(it, it.id);
      this.row(this.item(rowEl, it.id, {
        activate: () => {
          const res = progression.buy(it.id);
          // 사고 나면 이 행이 칸 버튼으로 바뀌고 포커스가 켜진 [1]에 놓인다 — 구매를 두 번 누른 E가 곧바로 해제가 되지 않게
          if (res?.ok) this._bought = { id: it.id, at: performance.now() };
          return res;
        },
      }));
      return rowEl;
    }

    rowEl.classList.add('ac-owned');
    const actions = el('div', 'ac-shop-slots');
    add(actions, el('span', 'ac-muted', t('panel.merchant.owned')));
    const buttons = [];
    for (let s = 0; s < ECONOMY.relicSlots; s++) {
      const on = it.equippedSlot === s;
      const btn = this.button(String(s + 1), `${it.id}#${s}`, () => {
        // 방금 산 유물의 칸 버튼은 잠깐 받지 않는다(구매의 연타가 해제 · 교체로 이어지지 않게)
        const b = this._bought;
        if (b && b.id === it.id && performance.now() - b.at < BUY_GUARD_MS) return undefined;
        if (on) return progression.equipRelic(s, null);
        // 다른 칸에 끼워져 있으면 Progression이 두 칸을 맞바꾼다(§6.6) — 그 칸에 있던 유물이 조용히 빠지지 않는다
        return progression.equipRelic(s, relicId);
      }, { cls: on ? 'ac-slot-btn ac-on' : 'ac-slot-btn' });
      buttons.push(btn);
      add(actions, btn.el);
    }
    add(rowEl, actions);
    this.row(...buttons);
    return rowEl;
  }

  /** @param {Object} it @returns {HTMLElement} */
  _priceTag(it) {
    if (it.soldOut) return el('span', 'ac-price ac-muted', t('panel.merchant.soldOut'));
    return add(el('span', it.canAfford ? 'ac-price' : 'ac-price ac-bad'),
      el('span', 'ac-price-label', t('panel.merchant.buy')), el('i', 'ac-ico ac-ico-ember'), el('span', '', fmtInt(it.price)));
  }
}
