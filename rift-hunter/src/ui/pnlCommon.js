// OWNER: P11 — 계약 §10.2 · §10.6 (P11 내부 — 상점 · 보관함 · 균열석 · 스킬 · 캐릭터 패널이 같이 쓰는 조각)
// 전 · 후 표(모든 거래가 전 · 후를 나란히 — §10.2) · 실패 사유 줄(reason.* — 패널 안) · 골드 · 재료 줄 · 키 안내 줄.

import { MATERIAL_IDS } from '../core/constants.js';
import { fmtInt } from './format.js';

/**
 * 전 · 후 표 — 행 = {label, before, after, dir?(1 녹 · −1 적 · 0)} · 같은 내용이면 다시 그리지 않는다
 * @param {{t:(k:string, p?:Object) => string, widgets:any}} ctx @param {{before?:string, after?:string}} [heads] 머리 문자열 키
 */
export function createTradeBox(ctx, heads = {}) {
  const { t, widgets: w } = ctx;
  const el = w.el('div', 'trade');
  el.hidden = true;
  let stamp = '';
  return {
    el,
    /** @param {Array<{label:string, before:string, after:string, dir?:number}>} rows @param {string} [title] */
    set(rows, title = '') {
      const s = title + '\u0001' + rows.map((r) => `${r.label}|${r.before}|${r.after}|${r.dir ?? 0}`).join('\u0002');
      if (s === stamp) return;
      stamp = s;
      el.textContent = '';
      el.hidden = !rows.length;
      if (!rows.length) return;
      const head = el.appendChild(w.el('div', 'trade-row trade-head'));
      head.appendChild(w.el('span', 'trade-label', title));
      head.appendChild(w.el('span', 'trade-v', t(heads.before ?? 'shop.before')));
      head.appendChild(w.el('span', 'trade-arrow', ''));
      head.appendChild(w.el('span', 'trade-v', t(heads.after ?? 'shop.after')));
      for (const r of rows) {
        const dir = r.dir ?? 0;
        const row = el.appendChild(w.el('div', 'trade-row' + (dir > 0 ? ' good' : dir < 0 ? ' bad' : '')));
        row.appendChild(w.el('span', 'trade-label', r.label));
        row.appendChild(w.el('span', 'trade-v', r.before));
        row.appendChild(w.el('span', 'trade-arrow', '→'));
        row.appendChild(w.el('span', 'trade-v trade-after', r.after));
      }
    },
    clear() { this.set([]); },
  };
}

/** 수 하나의 전 · 후 행(정수) @param {string} label @param {number} before @param {number} after @param {boolean} [moreIsGood] */
export function numRow(label, before, after, moreIsGood = true) {
  const d = Math.round(after) - Math.round(before);
  const dir = d === 0 ? 0 : (d > 0) === moreIsGood ? 1 : -1;
  return { label, before: fmtInt(before), after: fmtInt(after), dir };
}

/**
 * 골드 · 재료 전 · 후 행(바뀌는 것만 — 골드는 늘) @param {(k:string) => string} t @param {any} char
 * @param {number} goldDelta @param {Record<string, number>} [matDelta]
 */
export function costRows(t, char, goldDelta, matDelta = {}) {
  const gold = Math.max(0, Number(char?.gold) || 0);
  const rows = [numRow(t('inv.gold'), gold, gold + goldDelta)];
  for (const m of MATERIAL_IDS) {
    const d = Number(matDelta[m]) || 0;
    if (!d) continue;
    const have = Math.max(0, Number(char?.materials?.[m]) || 0);
    rows.push(numRow(t('mat.' + m), have, have + d));
  }
  return rows;
}

/**
 * 실패 사유 줄(패널 안 — 조용한 실패 금지 §0.6) — show(res): ok 면 지운다
 * @param {{t:(k:string, p?:Object) => string, widgets:any}} ctx
 */
export function createErrorLine(ctx) {
  const { t, widgets: w } = ctx;
  const el = w.el('div', 'panel-error');
  return {
    el,
    /** @param {any} res @returns {boolean} 성공했나 */
    show(res) {
      if (!res || res.ok !== false) { el.textContent = ''; return !!res; }
      el.textContent = t('reason.' + (res.reason ?? 'invalid'), res.params);
      return false;
    },
    clear() { el.textContent = ''; },
  };
}

/**
 * 골드 · 재료 줄(패널 머리) — 같은 값이면 다시 그리지 않는다
 * @param {{t:(k:string, p?:Object) => string, widgets:any}} ctx @param {{mats?:boolean}} [opts]
 */
export function createWallet(ctx, opts = {}) {
  const { t, widgets: w } = ctx;
  const el = w.el('div', 'wallet');
  /** 지난 값(골드 · 재료 셋) — 매 프레임 할당 없이 비교 */
  const last = [-1, -1, -1, -1];
  return {
    el,
    /** @param {any} char */
    update(char) {
      const gold = Math.max(0, Number(char?.gold) || 0);
      const mats = char?.materials ?? {};
      let same = last[0] === gold;
      if (opts.mats !== false) for (let i = 0; i < MATERIAL_IDS.length; i++) same = same && last[i + 1] === (Number(mats[MATERIAL_IDS[i]]) || 0);
      if (same) return;
      last[0] = gold;
      for (let i = 0; i < MATERIAL_IDS.length; i++) last[i + 1] = Number(mats[MATERIAL_IDS[i]]) || 0;
      el.textContent = '';
      const g = el.appendChild(w.el('span', 'wallet-gold'));
      g.appendChild(w.el('span', 'wallet-k', t('inv.gold')));
      g.appendChild(w.el('b', 'wallet-v', fmtInt(gold)));
      if (opts.mats === false) return;
      for (const m of MATERIAL_IDS) {
        const it = el.appendChild(w.el('span', 'wallet-mat m-' + m));
        it.appendChild(w.el('span', 'wallet-k', t('mat.' + m)));
        it.appendChild(w.el('b', 'wallet-v', fmtInt(Number(mats[m]) || 0)));
      }
    },
  };
}

/** 키 안내 줄 — 문면 키 목록을 ' · '로 @param {any} ctx @param {string[]} keys */
export function hintLine(ctx, keys) {
  return ctx.widgets.el('div', 'panel-hint', keys.map((k) => ctx.t(k)).join(' · '));
}

/** 키다운인가(keyup 은 패널이 먹기만 한다) @param {KeyboardEvent} e */
export function isDown(e) { return !e.type || e.type === 'keydown'; }
