// OWNER: P11 — 계약 §10.1 · §10.2 · §10.5 · §10.6
// 스킬 트리(겹쳐 보는 패널 · KeyS): 3갈래 × 4단계 격자(열 = 갈래 · 위에서 아래로 단계) · 노드(이름 · 랭크/최대 · 잠김 사유) · 변형은 대상 액티브에 붙은 작은 노드.
// 고른 노드의 찍기 전 · 후 수치(피해 범위 · 비용 · 쿨다운 · 시트 DPS · 패시브 수치 — describeSkill 두 번 + previewLearn) · 남은 포인트 · 스킬 바 미리보기.
// Enter(또는 클릭) = 찍기 · R = 우클릭 칸 · 1~4 = 바 칸 배정(배운 액티브만). 실패는 패널 안에 reason 문면.

import { EV } from '../../core/events.js';
import { SKILL_BAR } from '../../core/constants.js';
import { SKILL_NODES_BY_ID } from '../../data/index.js';
import { KEYBINDS, PANEL_KEYS } from '../../data/keybinds.js';
import { describeSkill } from '../../sim/player/skills.js';
import { canLearn, pointsFree, previewLearn } from '../../sim/progression/progress.js';
import { fmtDps, fmtInt, fmtNum } from '../format.js';
import { createErrorLine, createTradeBox, hintLine, isDown } from '../pnlCommon.js';
import { nodeStatRows, skillExtraRows, skillLayout } from '../pnlLogic.js';

/** @typedef {import('../../types.js').Panel} Panel */

const TIER_MARK = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];
const NAV_KEYS = [KEYBINDS.up, KEYBINDS.down, KEYBINDS.left, KEYBINDS.right, 'Enter', 'NumpadEnter'];
const BIND_RMB = PANEL_KEYS.skills.bindRmb;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createSkillsPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const el = w.panelFrame('panel.skills.title');
  el.dataset.panel = 'skills';
  el.classList.add('pnl-skills');
  const top = el.appendChild(w.el('div', 'skill-top'));
  const pointsEl = top.appendChild(w.el('div', 'skill-points'));
  const barEl = top.appendChild(w.el('div', 'skill-bar'));
  const body = el.appendChild(w.el('div', 'skill-body'));
  const treeWrap = body.appendChild(w.el('div', 'skill-tree-wrap'));
  const branchesEl = treeWrap.appendChild(w.el('div', 'skill-branches'));
  const gridEl = treeWrap.appendChild(w.el('div', 'skill-grid'));
  const detail = body.appendChild(w.el('div', 'skill-detail'));
  const foot = el.appendChild(w.el('div', 'panel-foot'));
  const err = createErrorLine(ctx);
  foot.appendChild(err.el);
  foot.appendChild(hintLine(ctx, ['skill.learn', 'skill.bindRmb']));
  const trade = createTradeBox(ctx, { before: 'skill.before', after: 'skill.after' });

  /** @type {string|null} */
  let cls = null;
  /** @type {{cols:number, rows:number, cells:Array<string|null>}} */
  let layout = { cols: 3, rows: 1, cells: [] };
  let dirty = true;
  /** @type {any} */
  let lastChar = null;
  /** @type {Array<() => void>} */
  const offs = [];
  if (ctx.bus) {
    const mark = () => { dirty = true; };
    for (const name of [EV.SKILLS, EV.LEVEL_UP, EV.STATS_CHANGED, EV.CHAR_LOADED]) offs.push(ctx.bus.on(name, mark));
  }

  const nav = w.gridNav(gridEl, 3, 1, (i) => learnAt(i), {
    onFocus: () => { err.clear(); renderDetail(); },
  });

  /** 클래스가 바뀌면 격자를 새로 짓는다 @param {string} c */
  function build(c) {
    cls = c;
    layout = skillLayout(c);
    gridEl.style.setProperty('--cols', String(layout.cols));
    branchesEl.style.setProperty('--cols', String(layout.cols));
    branchesEl.textContent = '';
    for (let b = 0; b < layout.cols; b++) branchesEl.appendChild(w.el('div', 'skill-branch', t('branch.' + c + '.' + b)));
    gridEl.textContent = '';
    for (let i = 0; i < layout.cells.length; i++) {
      const id = layout.cells[i];
      const n = w.el('div', id ? 'node' : 'node is-blank');
      if (id) {
        const node = SKILL_NODES_BY_ID[id];
        n.classList.add('k-' + node.kind);
        n.dataset.node = id;
      }
      gridEl.appendChild(n);
    }
    nav.setSize(layout.cols, layout.rows);
    const first = layout.cells.findIndex(Boolean);
    nav.focus(first >= 0 ? first : 0, true);
  }

  /** 노드 칸을 그린다 @param {any} char */
  function renderNodes(char) {
    const bar = char?.skills?.bar ?? [];
    for (let i = 0; i < layout.cells.length; i++) {
      const id = layout.cells[i];
      if (!id) continue;
      const node = SKILL_NODES_BY_ID[id];
      const cell = /** @type {HTMLElement} */ (gridEl.children[i]);
      const rank = Math.max(0, Number(char?.skills?.ranks?.[id]) || 0);
      const can = canLearn(char, id);
      cell.textContent = '';
      cell.appendChild(w.el('div', 'node-name', t('node.' + id + '.name')));
      const sub = node.kind === 'transform' ? t('skill.transform') + ' · ' + t('node.' + node.transforms + '.name') : TIER_MARK[(node.tier | 0) - 1] ?? '';
      cell.appendChild(w.el('div', 'node-kind', sub));
      cell.appendChild(w.el('div', 'node-rank', t('skill.rank', { r: rank, m: node.maxRank })));
      const why = lockText(can);
      if (why && rank === 0) cell.appendChild(w.el('div', 'node-why', why));
      cell.classList.toggle('is-learned', rank > 0);
      cell.classList.toggle('is-max', rank >= node.maxRank);
      cell.classList.toggle('is-locked', !can.ok && rank === 0 && (can.reason === 'tier' || can.reason === 'req'));
      cell.classList.toggle('is-can', !!can.ok);
      cell.classList.toggle('is-bar', bar.includes(id));
    }
    nav.refresh();
  }

  /** 잠김 사유 문면(점수 · 선행) @param {any} can */
  function lockText(can) {
    if (!can || can.ok) return '';
    if (can.reason === 'tier') return t('skill.locked.tier', { n: can.params?.n ?? 0 });
    if (can.reason === 'req') return t('skill.locked.req', { name: t('node.' + (can.params?.nodeId ?? '') + '.name') });
    return '';
  }

  /** @param {any} char */
  function renderTop(char) {
    const free = char ? pointsFree(char) : 0;
    pointsEl.textContent = t('skill.points', { n: free });
    pointsEl.classList.toggle('is-zero', free <= 0);
    barEl.textContent = '';
    const bar = char?.skills?.bar ?? [];
    const sel = currentId();
    for (let i = 0; i < SKILL_BAR; i++) {
      const id = bar[i] ?? null;
      const s = barEl.appendChild(w.el('div', 'skill-bar-slot' + (id ? '' : ' is-empty') + (id && id === sel ? ' is-sel' : '')));
      s.appendChild(w.el('b', '', i === 0 ? t('hud.key.rmb') : String(i)));
      s.appendChild(document.createTextNode(id ? t('node.' + id + '.name') : '—'));
    }
  }

  function currentId() {
    const i = nav.index;
    return i >= 0 ? layout.cells[i] ?? null : null;
  }

  /** 스킬 수치 → 표 행(피해 · 비용 · 쿨다운) @param {any} a @param {any} b */
  function skillRows(a, b) {
    const rows = [];
    const dash = '—';
    if ((a?.dmgMax ?? 0) > 0 || (b?.dmgMax ?? 0) > 0) {
      const fa = a ? t('skill.dmg', { a: fmtInt(a.dmgMin), b: fmtInt(a.dmgMax) }) : dash;
      const fb = b ? t('skill.dmg', { a: fmtInt(b.dmgMin), b: fmtInt(b.dmgMax) }) : dash;
      rows.push({ label: '', before: fa, after: fb, dir: dirOf(a?.dmgMax, b?.dmgMax, true) });
    }
    // 피드백 1 — 범위 스킬의 반경(회전 베기 2.5m 「둘레 모두」가 숫자로 보이게 · 화염구 · 서리 노바 …)
    if ((a?.radius ?? 0) > 0 || (b?.radius ?? 0) > 0) {
      rows.push({ label: '', before: a ? t('skill.radius', { n: fmtNum(a.radius, 1) }) : dash, after: b ? t('skill.radius', { n: fmtNum(b.radius, 1) }) : dash, dir: dirOf(a?.radius, b?.radius, true) });
    }
    if ((a?.cost ?? 0) > 0 || (b?.cost ?? 0) > 0) {
      rows.push({ label: '', before: a ? t('skill.cost', { n: fmtNum(a.cost, 1) }) : dash, after: b ? t('skill.cost', { n: fmtNum(b.cost, 1) }) : dash, dir: dirOf(a?.cost, b?.cost, false) });
    }
    if ((a?.cd ?? 0) > 0 || (b?.cd ?? 0) > 0) {
      rows.push({ label: '', before: a ? t('skill.cd', { n: fmtNum(a.cd, 1) }) : dash, after: b ? t('skill.cd', { n: fmtNum(b.cd, 1) }) : dash, dir: dirOf(a?.cd, b?.cd, false) });
    }
    return rows;
  }

  /** @param {number|undefined} a @param {number|undefined} b @param {boolean} moreIsGood */
  function dirOf(a, b, moreIsGood) {
    if (a === undefined || b === undefined) return 0;
    const d = Math.round((b - a) * 10);
    if (!d) return 0;
    return (d > 0) === moreIsGood ? 1 : -1;
  }

  function renderDetail() {
    const char = sim?.state?.char ?? null;
    const id = currentId();
    detail.textContent = '';
    renderTop(char);
    if (!char || !id) return;
    const node = SKILL_NODES_BY_ID[id];
    detail.appendChild(w.el('h3', '', t('node.' + id + '.name')));
    const sub = [t('branch.' + node.cls + '.' + node.branch)];
    if (node.kind === 'transform') sub.push(t('skill.transform') + ' · ' + t('node.' + node.transforms + '.name'));
    const pv = previewLearn(char, id);
    sub.push(t('skill.rank', { r: pv.rankBefore, m: node.maxRank }));
    detail.appendChild(w.el('div', 'row-sub', sub.join(' · ')));
    detail.appendChild(w.el('div', 'skill-desc', t('node.' + id + '.desc')));
    const can = canLearn(char, id);
    if (!can.ok) detail.appendChild(w.el('div', 'skill-why', lockText(can) || t('reason.' + can.reason, can.params)));
    // 전 · 후
    const rows = [];
    const target = node.kind === 'transform' ? node.transforms : node.skill ? id : null;
    if (target) {
      const tRank = target === id ? null : Math.max(1, Number(char.skills?.ranks?.[target]) || 1);
      const a = target === id ? (pv.rankBefore > 0 ? describeSkill(pv.statsBefore, id, pv.rankBefore) : null) : describeSkill(pv.statsBefore, target, /** @type {number} */ (tRank));
      const b = pv.ok ? (target === id ? describeSkill(pv.statsAfter, id, pv.rankAfter) : describeSkill(pv.statsAfter, target, /** @type {number} */ (tRank))) : null;
      for (const r of skillRows(a, b)) rows.push(r);
      // 동작 수치(버프 · 흡수 · 화상 · 튕김 · 상태 · 변형 patch) — 피해 · 비용 · 재사용이 그대로인 노드도 랭크 효과가 숫자로 보이게
      const dash = '—';
      for (const r of skillExtraRows(a, b)) {
        rows.push({ label: t(r.key), before: r.before ? t(r.key + '.v', r.before) : dash, after: pv.ok ? (r.after ? t(r.key + '.v', r.after) : dash) : dash, dir: pv.ok ? r.dir : 0 });
      }
    }
    for (const r of nodeStatRows(id, pv.rankBefore, pv.ok ? pv.rankAfter : pv.rankBefore)) {
      if (r.key) rows.push({ label: '', before: t(r.key, { v: r.before }), after: pv.ok ? t(r.key, { v: r.after }) : '—', dir: pv.ok && Number(r.after) > Number(r.before) ? 1 : 0 });
      else rows.push({ label: (r.label ?? []).map((k) => t(k)).join(' '), before: r.before, after: pv.ok ? r.after : '—', dir: pv.ok && parseFloat(r.after) > parseFloat(r.before) ? 1 : 0 });
    }
    const da = pv.statsBefore?.sheetDps ?? 0;
    const db = pv.ok ? pv.statsAfter?.sheetDps ?? 0 : da;
    rows.push({ label: t('stat.sheetDps'), before: fmtDps(da), after: pv.ok ? fmtDps(db) : '—', dir: pv.ok ? dirOf(da, db, true) : 0 });
    trade.set(rows, '');
    detail.appendChild(trade.el);
    const act = detail.appendChild(w.el('div', 'skill-actions'));
    const hints = [t('skill.learn')];
    if (node.kind === 'active') hints.push(t('skill.bindRmb'), t('skill.bind', { n: '1–4' }));
    act.textContent = hints.join(' · ');
  }

  /** @param {number} i */
  function learnAt(i) {
    const id = layout.cells[i];
    if (!id) return;
    const res = sim.learnSkill(id);
    err.show(res);
    dirty = true;
  }

  /** @param {number} idx 바 칸(0 = 우클릭) */
  function bind(idx) {
    const id = currentId();
    if (!id) return;
    const res = sim.setSkillBar(idx, id);
    err.show(res);
    dirty = true;
  }

  const KEYS = [...NAV_KEYS, BIND_RMB, ...KEYBINDS.skill, KEYBINDS.pause, KEYBINDS.skills];

  return {
    id: 'skills',
    modal: false,
    el,
    open() {
      err.clear();
      dirty = true;
    },
    close() {},
    update(state) {
      const char = state?.char ?? null;
      if (char !== lastChar) { lastChar = char; dirty = true; }
      if (!dirty) return;
      dirty = false;
      if (char && char.cls !== cls) build(char.cls);
      renderNodes(char);
      renderDetail();
    },
    handleKey(e) {
      const code = e.code;
      if (code === KEYBINDS.pause || code === KEYBINDS.skills) return false;
      if (!isDown(e)) return KEYS.includes(code);
      if (e.repeat && (code === 'Enter' || code === 'NumpadEnter')) return true;   // 누르고 있어도 한 점씩
      if (NAV_KEYS.includes(code)) {
        // 빈 자리는 건너뛴다
        const before = nav.index;
        const r = nav.handleKey(e);
        if (code !== 'Enter' && code !== 'NumpadEnter' && nav.index >= 0 && !layout.cells[nav.index]) {
          let guard = layout.cells.length;
          while (guard-- > 0 && !layout.cells[nav.index]) {
            const prev = nav.index;
            nav.handleKey(e);
            if (nav.index === prev) break;
          }
          if (!layout.cells[nav.index]) nav.focus(before >= 0 ? before : 0);
        }
        return r;
      }
      if (e.repeat) return true;
      if (code === BIND_RMB) { bind(0); return true; }
      const k = KEYBINDS.skill.indexOf(code);
      if (k >= 0) { bind(k + 1); return true; }
      return false;
    },
    keys: KEYS,
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      nav.destroy();
      el.remove();
    },
  };
}
