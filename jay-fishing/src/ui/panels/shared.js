// OWNER: P8 — 계약 §10.2 (UIRoot 내부)
// PC 와 채비 패널이 같이 쓰는 탭 내용: 도감 카드(§10.2) · 스킬 · 상점 장비 줄.

import { STAGE_IDS } from '../../core/constants.js';
import { SKILLS } from '../../data/skills.js';
import { BAITS } from '../../data/baits.js';
import { getSpecies } from '../../data/species/index.js';
import { t, has } from '../i18n.js';
import { el, fmt, modCompare, reasonText, rigCompare, won } from '../widgets.js';

/** @typedef {import('../widgets.js').PanelBase} PanelBase */

const SNAP_SIZE = 160;       // 도감 카드 정지 이미지 폭(px)
const TIME_BAR = { '0': 0, L: 1, N: 2, H: 3 };
const BAND_ORDER = ['dawn', 'morning', 'day', 'evening', 'night'];

// ── 도감

/**
 * 도감 탭(PC · 채비 공용). panel.dexStage(0..2) 를 스테이지 선택 항목(◀ ▶)으로 바꾼다.
 * 카드 12장은 FishPreview.snapshot 이미지(안 잡음은 실루엣), 포커스된 카드 하나만 오른쪽 상세에서 회전 캔버스(show).
 * @param {any} panel PanelBase @param {any} state
 */
export function buildDex(panel, state) {
  const sim = panel.sim;
  const fp = panel.ctx.fishPreview;
  if (!Number.isInteger(panel.dexStage)) panel.dexStage = Math.max(0, STAGE_IDS.indexOf(state.scene));
  const stageId = STAGE_IDS[panel.dexStage];
  /** @type {any[]} */
  let cards = [];
  try { cards = sim.getDex(stageId) || []; } catch (e) { void e; }
  const caught = cards.filter(c => c.caught).length;

  const sel = el('div', 'row row-select');
  sel.append(el('span', 'row-main', t('dex.stage', { stage: t('stage.' + stageId), n: caught, total: cards.length })));
  panel.addItem(sel, {
    adjust: (dir) => {
      panel.dexStage = (panel.dexStage + dir + STAGE_IDS.length) % STAGE_IDS.length;
      panel.focus = 0;
      panel.render();
    },
  });

  const wrap = el('div', 'dex');
  const grid = el('div', 'dex-grid');
  const detail = el('div', 'dex-detail');
  const view = el('div', 'dex-view');
  const info = el('div', 'dex-info');
  detail.append(view, info);
  wrap.append(grid, detail);
  panel.addInfo(wrap);

  const k = sim.ctx && sim.ctx.mods ? sim.ctx.mods.knowledge : 0;
  const firstCard = panel.items.length;
  for (const c of cards) {
    const card = el('div', 'dex-card' + (c.caught ? ' is-caught' : '') + (c.fantasy ? ' is-fantasy' : ''));
    const url = fp && fp.ok ? fp.snapshot(c.speciesId, 0, { silhouette: !c.caught, size: SNAP_SIZE }) : '';
    if (url) {
      const img = /** @type {HTMLImageElement} */ (el('img', 'dex-img'));
      img.src = url;
      img.alt = '';
      img.draggable = false;
      card.append(img);
    } else {
      card.append(el('div', 'dex-img dex-img-none', '?'));
    }
    const name = el('div', 'dex-name', t('species.' + c.speciesId));
    const best = c.entry ? c.entry.best : null;
    if (best === 'legend') name.append(el('span', 'stars is-legend', '★★'));
    else if (best === 'trophy') name.append(el('span', 'stars is-trophy', '★'));
    card.append(name);
    if (c.fantasy) card.append(el('div', 'dex-tag', t('dex.fantasy')));
    panel.addItem(card, { onFocus: () => showDexDetail(panel, c, view, info, k) }, grid);
  }
  if (!cards.length) grid.append(el('div', 'empty', t('dex.empty')));
  else {
    panel.setGrid(firstCard, panel.items.length - 1);   // 4열 카드 — ←→ 이웃 · ↑↓ 한 줄(widgets)
    showDexDetail(panel, cards[0], view, info, k);   // 포커스가 스테이지 선택에 있어도 상세가 비지 않게
  }   // 포커스가 스테이지 선택에 있어도 상세가 비지 않게
}

/** @param {any} panel @param {any} c DexCard @param {HTMLElement} view @param {HTMLElement} info @param {number} k */
function showDexDetail(panel, c, view, info, k) {
  const fp = panel.ctx.fishPreview;
  const sp = getSpecies(c.speciesId);
  if (fp && fp.ok && fp.canvas) {
    if (fp.canvas.parentElement !== view) view.replaceChildren(fp.canvas);
    fp.show(c.speciesId, c.entry ? c.entry.maxCm : sp.medianCm, { silhouette: !c.caught, spin: true });
    panel._previewOn = true;
  }
  info.replaceChildren();
  const head = el('div', 'dex-title', t('species.' + c.speciesId));
  if (c.fantasy) head.append(el('span', 'dex-tag', t('dex.fantasy')));
  info.append(head);
  // 전설 어종의 출현 조건(시간대 + 날씨) — 처음부터 보인다(리뷰 수정: 게임 안 어디에도 없었고 PC 날씨 문면은 반대로 일렀다)
  const fz = /** @type {any} */ (sp).fantasy;
  if (fz && Array.isArray(fz.bands) && Array.isArray(fz.weather)) {
    info.append(line('dex.appear', t('dex.appearWhen', {
      bands: fz.bands.map((b) => t('band.' + b)).join(t('list.sep')),
      weather: fz.weather.map((w) => t('weather.' + w)).join(t('list.sep')),
    }), 'is-fantasy'));
  }
  info.append(line('dex.style', t('style.' + sp.style)));
  info.append(line('dex.layers', c.layers.map(l => t('layer.' + l)).join(t('list.sep'))));
  info.append(line('dex.method', t('method.' + sp.method)));
  if (c.time) {
    const bars = el('div', 'timebars');
    for (let i = 0; i < BAND_ORDER.length; i++) {
      const lv = TIME_BAR[c.time[i]] ?? 0;
      const b = el('span', 'tb lv' + lv);
      b.title = t('band.' + BAND_ORDER[i]);
      const lab = el('span', 'tb-label', t('band.' + BAND_ORDER[i]));
      const col = el('span', 'tb-col');
      col.append(b, lab);
      bars.append(col);
    }
    const r = el('div', 'dex-line');
    r.append(el('span', 'k', t('dex.time')), bars);
    info.append(r);
  } else {
    info.append(line('dex.time', t('dex.needKnowledge', { n: 1 }), 'is-dim'));
  }
  if (c.baits) info.append(line('dex.baits', c.baits.map(b => t('bait.' + b)).join(t('list.sep'))));
  else info.append(line('dex.baits', t('dex.needKnowledge', { n: 2 }), 'is-dim'));
  info.append(line('dex.trophyAt', t('unit.kg', { v: fmt(c.trophyKg, 2) })));
  info.append(line('dex.unitPrice', t('unit.wonPerKg', { v: fmt(unitPrice(panel.sim, c.speciesId)) })));
  if (c.caught && c.entry) {
    const e = c.entry;
    info.append(line('dex.count', fmt(e.count)));
    info.append(line('dex.maxCm', t('unit.cm', { v: fmt(e.maxCm, 1) })));
    info.append(line('dex.maxKg', t('unit.kg', { v: fmt(e.maxKg, 3) })));
    info.append(line('dex.firstDay', t('dex.day', { n: e.firstDay })));
    if (e.trophies > 0) info.append(line('dex.trophies', t('dex.trophyCount', { n: e.trophies })));
    if (e.legends > 0) info.append(line('dex.legends', t('dex.legendCount', { n: e.legends })));
  } else {
    info.append(el('div', 'dex-line is-dim', t('dex.notCaught')));
  }
}

/**
 * 어종 단가(원/kg — 흥정 반영). 판매가는 무게 × 단가 × 등급 보너스 × 흥정(§7.9) — 브리프 §3.1 「어종 단가」.
 * @param {any} sim GameSim @param {string} speciesId @returns {number}
 */
export function unitPrice(sim, speciesId) {
  let per = 0;
  try { per = getSpecies(speciesId).pricePerKg; } catch (e) { void e; }
  const mul = sim && sim.ctx && sim.ctx.mods && Number.isFinite(sim.ctx.mods.sellMul) ? sim.ctx.mods.sellMul : 1;
  return Math.round((Number.isFinite(per) ? per : 0) * mul);
}

/** @param {string} key @param {string} value @param {string} [cls] */
function line(key, value, cls = '') {
  const r = el('div', 'dex-line ' + cls);
  r.append(el('span', 'k', t(key)), el('span', 'v', value));
  return r;
}

// ── 스킬

/** 스킬 탭(PC · 채비 공용) @param {any} panel @param {any} state */
export function buildSkills(panel, state) {
  const sim = panel.sim;
  const p = state.profile;
  panel.addInfo(el('div', 'row-note', t('skills.points', { n: p.skillPoints })));
  for (const sk of SKILLS) {
    /** @type {any} */
    let pv = null;
    try { pv = sim.previewSkill(sk.id); } catch (e) { void e; }
    if (!pv) continue;
    const maxRank = sk.effects[Object.keys(sk.effects)[0]].length - 1;
    const row = el('div', 'row row-skill' + (pv.ok ? '' : ' is-locked'));
    const head = el('div', 'row-head');
    const pips = el('span', 'pips');
    for (let i = 1; i <= maxRank; i++) pips.append(el('span', 'pip' + (i <= pv.rank ? ' is-on' : '')));
    head.append(el('span', 'row-main', t('skill.' + sk.id)), pips);
    row.append(head);
    if (pv.rank < maxRank) {
      const descKey = 'skillDesc.' + sk.id + '.' + (pv.rank + 1);
      row.append(el('div', 'row-sub', t('skills.next', { desc: has(descKey) ? t(descKey) : '' })));
      row.append(modCompare(pv.before, pv.after));
    } else {
      row.append(el('div', 'row-sub', t('reason.maxRank')));
    }
    if (!pv.ok && pv.reason && pv.reason !== 'maxRank') row.append(el('div', 'row-reason', reasonText(pv.reason, pv.reasonParams)));
    panel.addItem(row, {
      disabled: !pv.ok,
      activate: () => {
        const r = sim.learnSkill(sk.id);
        if (!r || !r.ok) panel.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
        panel.render();
      },
    });
  }
}

// ── 상점 줄

/**
 * 장비 상점 줄 — 이름 · 단계 · 가격 · 보유 · 잠김 사유 · 세트별 전/후 비교(◀ ▶ 로 세트를 바꾼다).
 * Enter = 사고 바로 끼우기(그 세트).
 * @param {any} panel @param {any} item ShopItem @param {{targetSet:Record<string,string>}} memo
 */
export function addGearRow(panel, item, memo) {
  const sim = panel.sim;
  const sets = ['float', 'bottom'].filter(s => item.previews && item.previews[s]);
  if (!memo.targetSet[item.id] || !sets.includes(memo.targetSet[item.id])) memo.targetSet[item.id] = sets.includes(sim.state.rig.set) ? sim.state.rig.set : (sets[0] || 'float');
  const target = memo.targetSet[item.id];
  const row = el('div', 'row row-shop' + (item.ok ? '' : ' is-locked'));
  const head = el('div', 'row-head');
  head.append(el('span', 'row-main', t('gear.' + item.id)), el('span', 'row-tier', t('shop.tier', { n: item.tier })), el('span', 'row-price', won(item.price)));
  row.append(head);
  const sub = el('div', 'row-sub');
  sub.append(el('span', '', t('shop.slot.' + item.slot)));
  if (item.owned > 0) sub.append(el('span', 'row-owned', t('shop.owned', { n: item.owned })));
  // 「(◀▶)」는 세트를 바꿀 수 있을 때만(리뷰 수정 — 한 세트뿐인 줄에서 ◀▶ 는 탭을 바꿨다)
  if (sets.length) sub.append(el('span', 'row-set', t(sets.length > 1 ? 'shop.forSet' : 'shop.forSetOne', { set: t('set.' + target) })));
  row.append(sub);
  const pv = item.previews && item.previews[target];
  if (pv) row.append(rigCompare(pv.before, pv.after));
  if (!item.ok) row.append(el('div', 'row-reason', reasonText(item.reason, item.reasonParams)));
  panel.addItem(row, {
    disabled: !item.ok,
    adjust: sets.length > 1 ? (dir) => {
      const i = sets.indexOf(memo.targetSet[item.id]);
      memo.targetSet[item.id] = sets[(i + dir + sets.length) % sets.length];
      panel.render();
    } : null,
    activate: () => {
      if (!item.ok) {
        panel.ui.toast('reason.' + (item.reason || 'invalid'), item.reasonParams || {});
        return;
      }
      const r = sim.buy(item.id, 1);
      if (!r || !r.ok) {
        panel.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
      } else {
        const eq = sim.equip(memo.targetSet[item.id], item.slot, item.id);
        if (eq && eq.ok) panel.ui.toast('shop.boughtEquipped', { name: t('gear.' + item.id), set: t('set.' + memo.targetSet[item.id]) });
        else panel.ui.toast('shop.boughtOnly', { name: t('gear.' + item.id), reason: reasonText((eq && eq.reason) || 'invalid', eq && eq.params) });
      }
      panel.render();
    },
  });
}

/** 미끼 팩 줄 @param {any} panel @param {any} item ShopItem */
export function addBaitRow(panel, item) {
  const sim = panel.sim;
  const baitId = item.id.replace(/^bait_/, '');
  const def = BAITS.find(b => b.id === baitId);
  const row = el('div', 'row row-shop' + (item.ok ? '' : ' is-locked'));
  const head = el('div', 'row-head');
  head.append(el('span', 'row-main', t('shop.baitPack', { name: t('bait.' + baitId), n: def ? def.packSize : 0 })), el('span', 'row-price', won(item.price)));
  row.append(head);
  row.append(el('div', 'row-sub', t('shop.have', { n: fmt(item.owned) })));
  if (!item.ok) row.append(el('div', 'row-reason', reasonText(item.reason, item.reasonParams)));
  panel.addItem(row, {
    disabled: !item.ok,
    activate: () => {
      const r = sim.buy(item.id, 1);
      if (!r || !r.ok) panel.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
      else panel.ui.toast('shop.bought', { name: t('bait.' + baitId), money: won(r.cost ?? item.price) });
      panel.render();
    },
  });
}

/**
 * 라인 감기 줄(세트 × 라인) — 그 세트 기준 비용 · 집의 line_1 은 무료(NOTES-P4 #2) · 가득이면 「이미 가득」.
 * @param {any} panel @param {any} item ShopItem @param {boolean} atHome
 */
export function addLineRow(panel, item, atHome) {
  const sim = panel.sim;
  const free = atHome && item.lineId === 'line_1';
  const full = item.reason === 'full';
  const ok = item.ok || (free && !full);
  const row = el('div', 'row row-shop' + (ok ? '' : ' is-locked'));
  const head = el('div', 'row-head');
  head.append(el('span', 'row-main', t('shop.refill', { set: t('set.' + item.set), name: t('gear.' + item.lineId) })),
    el('span', 'row-price', free ? t('shop.free') : won(item.price)));
  row.append(head);
  const cfg = sim.state.profile.sets[item.set];
  row.append(el('div', 'row-sub', t('shop.spool', { name: t('gear.' + cfg.lineId), m: fmt(cfg.lineM) })));
  const pv = item.previews && item.previews[item.set];
  if (pv && cfg.lineId !== item.lineId) row.append(rigCompare(pv.before, pv.after));
  if (!ok) row.append(el('div', 'row-reason', full ? t('reason.full') : reasonText(item.reason, item.reasonParams)));
  panel.addItem(row, {
    disabled: !ok,
    activate: () => {
      if (full) { panel.ui.toast('reason.full'); return; }
      const r = sim.refillLine(item.set, item.lineId);
      if (!r || !r.ok) panel.ui.toast('reason.' + ((r && r.reason) || 'invalid'), (r && r.params) || {});
      panel.render();
    },
  });
}

/** 정보 줄 하나 @param {string} text @param {string} [cls] */
export function note(text, cls = 'row-note') {
  return el('div', cls, text);
}

/** 미리보기 캔버스를 패널이 닫힐 때 내린다 @param {any} panel */
export function hidePreview(panel) {
  const fp = panel.ctx.fishPreview;
  if (panel._previewOn && fp) fp.hide();
  panel._previewOn = false;
}

/** 패널 update 에서 회전 캔버스 그리기 @param {any} panel @param {number} dt */
export function renderPreview(panel, dt) {
  const fp = panel.ctx.fishPreview;
  if (panel._previewOn && fp && fp.ok) fp.render(dt);
}

