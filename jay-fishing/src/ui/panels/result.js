// OWNER: P8 — 계약 §10.2 · §5.5
// 결과 — 어종 · 회전 모델(FishPreview) · 길이 · 무게 · 등급(트로피 ★ · 레전드 ★★) · 첫 포획/신기록 · 추정가(흥정 반영) · 경험치(어창 / 방생) · 어창 n/12.
// Space = 어창(차 있으면 「어창의 가장 싼 것과 바꾸기」 — keepCatch({swapUid}) · 새 것이 그보다 싸면 비활성 · 안내) · KeyX = 방생.
// 열린 뒤 PANEL_INPUT_GRACE 동안 확인 키를 버리고 · 키 반복(e.repeat)도 버린다(뜰채 Space 를 누른 채여도 결과를 고르지 않는다).
// Esc 로 닫히지 않는다(고를 때까지 — UIRoot).

import { HOLD } from '../../data/economy.js';
import { computeModifiers } from '../../sim/progression/modifiers.js';
import { sellPrice } from '../../sim/progression/economy.js';
import { t } from '../i18n.js';
import { PanelBase, el, fmt, won } from '../widgets.js';
import { hidePreview, renderPreview } from './shared.js';

class ResultPanel extends PanelBase {
  /** @param {import('../widgets.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, 'result', { closable: false, size: 'm' });
    this.view = el('div', 'result-view');
    this._swap = /** @type {{uid:number, price:number, name:string}|null} */ (null);
    this._keepDisabled = false;
  }

  footKey() { return 'result.foot'; }

  onOpen() { this.focus = 0; }

  onClose() { hidePreview(this); }

  build() {
    const s = /** @type {any} */ (this.sim).state;
    const rec = s.pendingCatch;
    const p = s.profile;
    this._swap = null;
    this._keepDisabled = false;
    if (!rec) {
      this.addInfo(el('div', 'empty', t('result.none')));
      return;
    }
    const mods = computeModifiers(p);
    const price = sellPrice(rec, mods);
    const full = p.hold.length >= HOLD.capacity;

    const top = el('div', 'result-top');
    const fp = this.ctx.fishPreview;
    if (fp && fp.ok && fp.canvas) {
      if (fp.canvas.parentElement !== this.view) this.view.replaceChildren(fp.canvas);
      fp.show(rec.speciesId, rec.lengthCm, { silhouette: false, spin: true });
      this._previewOn = true;
    } else {
      this.view.replaceChildren(el('div', 'result-noview', t('species.' + rec.speciesId)));
    }
    const info = el('div', 'result-info');
    const name = el('div', 'result-name', t('species.' + rec.speciesId));
    if (rec.tier === 'legend') name.append(el('span', 'badge is-legend', t('result.legend')));
    else if (rec.tier === 'trophy') name.append(el('span', 'badge is-trophy', t('result.trophy')));
    info.append(name);
    const badges = el('div', 'result-badges');
    if (rec.firstCatch) badges.append(el('span', 'badge is-first', t('result.first')));
    if (rec.recordWeight) badges.append(el('span', 'badge is-record', t('result.record')));
    if (badges.childElementCount) info.append(badges);
    const stats = el('div', 'result-stats');
    stats.append(
      stat('result.length', t('unit.cm', { v: fmt(rec.lengthCm, 1) })),
      stat('result.weight', t('unit.kg', { v: fmt(rec.weightKg, 3) })),
      stat('result.price', won(price)),
      stat('result.xp', t('result.xpBoth', { keep: fmt(rec.xpKeep), release: fmt(rec.xpRelease) })),
      stat('result.hold', t('hud.hold', { n: p.hold.length, cap: HOLD.capacity }), full ? 'is-warn' : ''),
      stat('result.fight', t('unit.s', { v: fmt(rec.fightSec, 0) })),
    );
    info.append(stats);
    top.append(this.view, info);
    this.addInfo(top);

    // 어창이 차 있으면 가장 싼 것과 바꾸기
    if (full) {
      /** @type {any} */
      let quote = null;
      try { quote = /** @type {any} */ (this.sim).getSellQuote(); } catch (e) { void e; }
      let cheapest = null;
      for (const it of (quote && quote.items) || []) if (!cheapest || it.price < cheapest.price) cheapest = it;
      if (cheapest) {
        const fish = p.hold.find(h => h.uid === cheapest.uid);
        this._swap = { uid: cheapest.uid, price: cheapest.price, name: fish ? t('species.' + fish.speciesId) : '' };
        this._keepDisabled = price < cheapest.price;
      } else {
        this._keepDisabled = true;
      }
    }
    const keep = el('div', 'row row-big row-keep');
    const keyHint = el('span', 'kbd', t('result.keyKeep'));
    if (full && this._swap) {
      keep.append(keyHint, el('span', 'row-main', t('result.swap', { name: this._swap.name, price: fmt(this._swap.price) })));
      if (this._keepDisabled) keep.append(el('div', 'row-reason', t('result.swapWorse', { price: fmt(price) })));
    } else if (full) {
      keep.append(keyHint, el('span', 'row-main', t('result.keep')), el('div', 'row-reason', t('reason.holdFull')));
    } else {
      keep.append(keyHint, el('span', 'row-main', t('result.keep')), el('span', 'row-sub', t('result.xpGain', { n: fmt(rec.xpKeep) })));
    }
    this.addItem(keep, { disabled: this._keepDisabled, activate: () => this._keep() });
    const rel = el('div', 'row row-big');
    rel.append(el('span', 'kbd', t('result.keyRelease')), el('span', 'row-main', t('result.release')), el('span', 'row-sub', t('result.xpGain', { n: fmt(rec.xpRelease) })));
    this.addItem(rel, { activate: () => this._release() });
    if (full) this.addInfo(el('div', 'row-note', t('result.fullNote')));
  }

  _keep() {
    if (this.ui.inGrace()) return;
    const sim = /** @type {any} */ (this.sim);
    if (!sim.state.pendingCatch) return;
    if (this._keepDisabled) {
      this.ui.toast(this._swap ? 'result.swapWorseShort' : 'reason.holdFull');
      return;
    }
    const r = this._swap ? sim.keepCatch({ swapUid: this._swap.uid }) : sim.keepCatch();
    this._after(r);
  }

  _release() {
    if (this.ui.inGrace()) return;
    const sim = /** @type {any} */ (this.sim);
    if (!sim.state.pendingCatch) return;
    this._after(sim.releaseCatch());
  }

  /** @param {any} r */
  _after(r) {
    if (r && r.ok) {
      const top = this.ui.stack.top;
      if (top && top.id === 'result') this.ui.closePanel('confirm');
    } else {
      this.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
      this.render();
    }
  }

  /** Space = 어창 · KeyX = 방생(포커스와 무관) @param {KeyboardEvent} e @param {boolean} grace */
  onKey(e, grace) {
    if (e.code === 'Space' || e.code === 'KeyX') {
      if (grace || e.repeat) return true;
      if (e.code === 'Space') this._keep();
      else this._release();
      return true;
    }
    return false;
  }

  /** @param {Object} state @param {number} dt */
  update(state, dt) {
    void state;
    renderPreview(this, dt);
  }
}

/** @param {string} key @param {string} value @param {string} [cls] */
function stat(key, value, cls = '') {
  const r = el('div', 'stat ' + cls);
  r.append(el('span', 'k', t(key)), el('span', 'v', value));
  return r;
}

/**
 * @param {import('../widgets.js').PanelCtx} ctx
 * @returns {ResultPanel}
 */
export function createResultPanel(ctx) {
  return new ResultPanel(ctx);
}
