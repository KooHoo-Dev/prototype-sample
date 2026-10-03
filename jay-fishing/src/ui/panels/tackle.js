// OWNER: P8 — 계약 §10.2
// 채비(Tab) — 탭 3개: 채비 · 도감 · 스킬. Tab · Esc 로 닫는다(UIRoot).
// 채비 탭: 고칠 세트(◀ ▶) · 지금 수치 · 부위마다 후보(◀ ▶ — 가진 것만) 와 「현재 → 바꾸면」 비교 · Enter 로 끼우기(equip — ready/idle 에서만, 그 밖 사유 알림)
//          · 미끼(◀ ▶ 즉시 setBait) · (찌 세트) 수심(◀ ▶ ±0.25m 즉시 setDepth) · 라인(감기는 판매상 · PC).

import { CAST } from '../../data/bite.js';
import { GEAR, GEAR_BY_ID } from '../../data/gear.js';
import { BAIT_IDS, SET_IDS } from '../../core/constants.js';
import { availableCount, isOwned } from '../../sim/progression/modifiers.js';
import { t } from '../i18n.js';
import { PanelBase, el, fmt, rigCompare, rigSummary } from '../widgets.js';
import { buildDex, buildSkills, hidePreview, renderPreview } from './shared.js';

/** 세트별 부위 */
const SLOTS = { float: ['rod', 'reel', 'hook', 'float'], bottom: ['rod', 'reel', 'hook', 'sinker'] };
const SUMMARY_FIELDS = ['castMaxM', 'rodMaxLoadKg', 'reelMaxDragKg', 'reelSpeedMS', 'lineKg', 'spoolCapM', 'signalMul'];

class TacklePanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'tackle', { tabs: ['tackle.tab.rig', 'tackle.tab.dex', 'tackle.tab.skill'], size: 'l' });
    /** @type {string} */
    this.editSet = 'float';
    /** @type {Record<string, string>} 부위 → 후보 GearId */
    this.cand = {};
    /** @type {number|null} */
    this.dexStage = null;
  }

  /** 탭마다 — 도감은 고르기만 · 스킬은 Enter 배우기(리뷰 수정: 세 탭 모두 「Enter 끼우기」였다) */
  footKey() {
    const tab = this.tabs ? this.tabs[this.tab] : '';
    if (tab === 'tackle.tab.dex') return 'tackle.footDex';
    if (tab === 'tackle.tab.skill') return 'tackle.footSkill';
    return 'tackle.foot';
  }

  onOpen() {
    const s = /** @type {any} */ (this.sim).state;
    this.editSet = s.rig.set || 'float';
    this.cand = {};
    this.dexStage = null;
  }

  onTab() { hidePreview(this); }

  onClose() { hidePreview(this); }

  /** @param {string|null} tab */
  build(tab) {
    const s = /** @type {any} */ (this.sim).state;
    hidePreview(this);
    if (tab === 'tackle.tab.dex') buildDex(this, s);
    else if (tab === 'tackle.tab.skill') buildSkills(this, s);
    else this._rig(s);
  }

  /** @param {any} s */
  _rig(s) {
    const sim = /** @type {any} */ (this.sim);
    const p = s.profile;
    const set = this.editSet;
    const cfg = p.sets[set];
    /** @type {any} */
    let rs = null;
    try { rs = sim.getRigStats(set); } catch (e) { void e; }

    const sel = el('div', 'row row-select');
    sel.append(el('span', 'row-main', t('tackle.editSet', { set: t('set.' + set) })),
      el('span', 'row-sub', set === s.rig.set ? t('tackle.inHand') : t('tackle.switchHint', { key: set === 'float' ? '1' : '2' })));
    this.addItem(sel, {
      adjust: (dir) => {
        const i = SET_IDS.indexOf(this.editSet);
        this.editSet = SET_IDS[(i + dir + SET_IDS.length) % SET_IDS.length];
        this.cand = {};
        this.render();
      },
    });
    if (rs) this.addInfo(rigSummary(rs, SUMMARY_FIELDS));
    const busy = s.player.mode === 'fish' && s.rig.phase !== 'ready' && s.rig.phase !== 'idle';
    if (busy) this.addInfo(el('div', 'row-note is-warn', t('tackle.busyNote')));

    for (const slot of SLOTS[set]) this._slotRow(s, set, slot);

    // 미끼(즉시)
    const bait = cfg.bait;
    const brow = el('div', 'row row-slot');
    const bh = el('div', 'row-head');
    bh.append(el('span', 'row-label', t('shop.slot.bait')), el('span', 'row-main', t('tackle.bait', { name: t('bait.' + bait), n: fmt(p.baits[bait] || 0) })));
    brow.append(bh);
    if (!(p.baits[bait] > 0)) brow.append(el('div', 'row-reason', t('reason.noBait')));
    this.addItem(brow, {
      adjust: (dir) => {
        const i = BAIT_IDS.indexOf(cfg.bait);
        const next = BAIT_IDS[(i + dir + BAIT_IDS.length) % BAIT_IDS.length];
        const r = sim.setBait(set, next);
        if (!r || !r.ok) this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
        this.render();
      },
    });

    // 수심(찌 세트)
    if (set === 'float') {
      const drow = el('div', 'row row-slot');
      const dh = el('div', 'row-head');
      dh.append(el('span', 'row-label', t('tackle.depthLabel')), el('span', 'row-main', t('unit.m', { v: fmt(cfg.depthM, 2) })));
      drow.append(dh, el('div', 'row-sub', t('tackle.depthNote')));
      this.addItem(drow, {
        adjust: (dir) => {
          const v = Math.max(CAST.depthMinM, Math.min(CAST.depthMaxM, cfg.depthM + dir * CAST.depthStepM));
          const r = sim.setDepth(v);
          if (!r || !r.ok) this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
          this.render();
        },
      });
    }

    // 라인(정보)
    const lrow = el('div', 'row row-slot');
    const lh = el('div', 'row-head');
    const reel = GEAR_BY_ID[cfg.reel];
    lh.append(el('span', 'row-label', t('shop.slot.line')), el('span', 'row-main', t('tackle.line', { name: t('gear.' + cfg.lineId), m: fmt(cfg.lineM), cap: fmt(reel ? reel.capacityM : 0) })));
    lrow.append(lh, el('div', 'row-sub', t('tackle.lineNote')));
    this.addItem(lrow, {});
  }

  /** @param {any} s @param {string} set @param {string} slot */
  _slotRow(s, set, slot) {
    const sim = /** @type {any} */ (this.sim);
    const p = s.profile;
    const cur = p.sets[set][slot];
    const list = GEAR.filter(g => g.slot === slot && (slot !== 'rod' || g.set === set) && isOwned(p, g.id)).map(g => g.id);
    if (!list.includes(cur) && cur) list.unshift(cur);
    let cand = this.cand[slot];
    if (!cand || !list.includes(cand)) cand = cur;
    const row = el('div', 'row row-slot');
    const head = el('div', 'row-head');
    head.append(el('span', 'row-label', t('shop.slot.' + slot)));
    if (cand === cur) {
      head.append(el('span', 'row-main', t('gear.' + cur)), el('span', 'row-sub', t('tackle.equipped')));
    } else {
      head.append(el('span', 'row-from', t('gear.' + cur)), el('span', 'cmp-arrow', '→'), el('span', 'row-main', t('gear.' + cand)));
    }
    row.append(head);
    if (slot === 'hook') row.append(el('div', 'row-sub', t('tackle.hookNote', { size: t('hookSize.' + (GEAR_BY_ID[cand] ? GEAR_BY_ID[cand].size : 2)) })));
    if (cand !== cur) {
      /** @type {any} */
      let pv = null;
      try { pv = sim.previewEquip(set, slot, cand); } catch (e) { void e; }
      if (pv) row.append(rigCompare(pv.before, pv.after));
      const avail = availableCount(p, cand, /** @type {any} */ (set));
      if (!(avail > 0)) row.append(el('div', 'row-reason', t('reason.inUse')));
      else row.append(el('div', 'row-sub', t('tackle.enterToEquip')));
    } else if (list.length > 1) {
      row.append(el('div', 'row-sub is-dim', t('tackle.cycle', { n: list.length })));
    }
    this.addItem(row, {
      adjust: list.length > 1 ? (dir) => {
        const i = list.indexOf(this.cand[slot] && list.includes(this.cand[slot]) ? this.cand[slot] : cur);
        this.cand[slot] = list[(i + dir + list.length) % list.length];
        this.render();
      } : null,
      activate: () => {
        const c = this.cand[slot];
        if (!c || c === cur) return;
        const r = sim.equip(set, slot, c);
        if (!r || !r.ok) this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
        else this.cand[slot] = '';
        this.render();
      },
    });
  }

  /** @param {Object} state @param {number} dt */
  update(state, dt) {
    void state;
    renderPreview(this, dt);
  }
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {TacklePanel}
 */
export function createTacklePanel(ctx) {
  return new TacklePanel(ctx);
}
