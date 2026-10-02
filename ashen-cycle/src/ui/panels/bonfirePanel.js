// OWNER: P8 — 계약 §10.3 화톳불 패널
// 읽는 것: progression.getStatBlock() · previewLevelUp(stat) × 4 · profile.embers. 부르는 것: levelUp(stat). 열릴 때 sim.restAtBonfire().
// 올리기 전/후 비교는 preview.changes를 그대로 그린다 — UI가 StatBlock을 직접 비교하지 않는다.
import { STAT_IDS } from '../../core/constants.js';
import { STATS } from '../../data/stats.js';
import { el, add, clear, num, fmtInt, fmtNum, fmtMul, fmtPct } from '../dom.js';
import { t, hasStr } from '../i18n.js';
import { Panel } from './panelBase.js';

/** 능력치 표에 늘 보이는 StatBlock 필드(표시 순서). changes에만 있는 필드는 뒤에 붙는다. */
const SHEET_KEYS = [
  'hpMax', 'staminaMax', 'staminaRegen', 'weaponDamage', 'damageMul', 'postureMul',
  'critMul', 'executeMul', 'parryPosture', 'flaskCharges', 'flaskHeal',
];

/** 필드별 표기. 없는 필드는 소수 둘째 자리까지. @type {Record<string, (v:number)=>string>} */
const FORMAT = {
  hpMax: fmtInt,
  staminaMax: (v) => fmtNum(v, 1),
  staminaRegen: (v) => t('unit.perSec', { v: fmtNum(v, 1) }),
  weaponDamage: (v) => fmtNum(v, 1),
  damageMul: fmtMul,
  postureMul: fmtMul,
  critMul: fmtMul,
  executeMul: fmtMul,
  parryPosture: (v) => fmtNum(v, 1),
  parryWindow: (v) => t('unit.sec', { v: fmtNum(v, 2) }),
  guardReduction: fmtPct,
  flaskCharges: fmtInt,
  flaskHeal: fmtInt,
};

/** @param {string} key @param {number} v */
const fmtValue = (key, v) => (FORMAT[key] ?? ((x) => fmtNum(x, 2)))(num(v));
/** 증가분 표기(+14 · +0.06). @param {number} d */
const fmtDelta = (d) => `${d >= 0 ? '+' : '−'}${fmtNum(Math.abs(d), 2)}`;
/** @param {string} key */
const statLabel = (key) => (hasStr(`statblock.${key}`) ? t(`statblock.${key}`) : key);

export class BonfirePanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, { closable: true });
    this.hints('panel.hint.select', 'panel.hint.confirm', 'panel.hint.close');
  }

  onOpen() {
    // 화톳불에 앉는 순간 HP · 스태미나 · 플라스크가 찬다(마을에서만 동작한다 — sim이 판단)
    this.ctx.deps.sim?.restAtBonfire?.();
    this.say(t('panel.bonfire.rested'));
  }

  build() {
    const { progression } = this.ctx.deps;
    const profile = progression.profile ?? {};
    const block = progression.getStatBlock() ?? {};
    const affordable = num(progression.getAffordableLevelUps());
    this.wallet(false);

    // 머리줄: 잔불 · 레벨업 가능 횟수 · 레벨
    const header = el('div', 'ac-bonfire-header');
    add(header,
      el('span', affordable > 0 ? 'ac-good' : '', t('panel.bonfire.header', { embers: fmtInt(profile.embers), n: affordable })),
      el('span', 'ac-bonfire-level', t('panel.bonfire.level', { level: fmtInt(block.level ?? 1) })));
    add(this.body, header);

    const cols = el('div', 'ac-bonfire-cols');
    const list = el('div', 'ac-stat-list');
    /** @type {Record<string, Object>} */
    this._previews = {};
    for (const stat of STAT_IDS) {
      const pv = progression.previewLevelUp(stat) ?? {};
      this._previews[stat] = pv;
      const points = num(profile.stats?.[stat]);
      const rowEl = el('div', 'ac-stat-row');
      const plus = el('span', 'ac-stat-plus');
      if (pv.maxed) {
        plus.textContent = t('panel.bonfire.max');
        plus.classList.add('ac-muted');
      } else {
        add(plus, el('b', '', '+'), el('span', pv.canAfford ? '' : 'ac-bad', fmtInt(pv.cost)));
      }
      add(rowEl,
        add(el('div', 'ac-stat-main'),
          el('span', 'ac-stat-name', t(`stat.${stat}.name`)),
          el('span', 'ac-stat-points', t('panel.bonfire.points', { n: points, max: STATS.maxPoints }))),
        el('div', 'ac-stat-desc', t(`stat.${stat}.desc`)),
        plus);
      if (!pv.maxed && !pv.canAfford) rowEl.classList.add('ac-poor');
      add(list, rowEl);
      this.row(this.item(rowEl, stat, {
        activate: () => {
          const res = progression.levelUp(stat);
          if (res?.ok) this.ctx.memory.lastStat = stat;
          return res;
        },
      }));
    }
    this._sheet = el('div', 'ac-sheet');
    add(cols, list, this._sheet);
    add(this.body, cols);
    this._block = block;
  }

  render() {
    super.render();
    this._paintSheet(this.focusKey);
  }

  defaultFocus() {
    const last = this.ctx.memory.lastStat;
    return STAT_IDS.includes(last) ? last : STAT_IDS[0];
  }

  onFocusChange(item) {
    this._paintSheet(item.key);
  }

  /** 오른쪽 능력치 표: 포커스된 능력치를 한 점 올리면 바뀌는 줄을 「현재 → 다음 (+증가분)」으로. @param {string|null} stat */
  _paintSheet(stat) {
    const sheet = this._sheet;
    if (!sheet) return;
    clear(sheet);
    const pv = (stat && this._previews[stat]) || {};
    const changes = Array.isArray(pv.changes) ? pv.changes : [];
    /** @type {Record<string, {before:number, after:number}>} */
    const byKey = {};
    for (const ch of changes) byKey[ch.key] = ch;

    const head = el('div', 'ac-sheet-head');
    add(head, el('h3', 'ac-section', t('panel.bonfire.sheet')));
    if (stat && hasStr(`stat.${stat}.name`)) {
      add(head, el('span', 'ac-sheet-preview', t('panel.bonfire.preview', { stat: t(`stat.${stat}.name`) })));
    }
    add(sheet, head);

    const keys = SHEET_KEYS.slice();
    for (const ch of changes) if (!keys.includes(ch.key)) keys.push(ch.key);
    const table = el('div', 'ac-sheet-table');
    for (const key of keys) {
      const ch = byKey[key];
      const line = el('div', ch ? 'ac-sheet-row ac-changed' : 'ac-sheet-row');
      add(line, el('span', 'ac-sheet-label', statLabel(key)));
      if (ch) {
        add(line, add(el('span', 'ac-sheet-value'),
          el('span', 'ac-from', fmtValue(key, ch.before)),
          el('span', 'ac-arrow', '→'),
          el('span', 'ac-to', fmtValue(key, ch.after)),
          el('span', 'ac-delta', `(${fmtDelta(num(ch.after) - num(ch.before))})`)));
      } else {
        add(line, el('span', 'ac-sheet-value', fmtValue(key, this._block?.[key])));
      }
      add(table, line);
    }
    add(sheet, table);

    // 비용 · 다음 비용 · 효율 감소 표식
    const foot = el('div', 'ac-sheet-foot');
    if (pv.maxed) {
      add(foot, el('span', 'ac-muted', t('panel.bonfire.max')));
    } else if (stat) {
      add(foot, el('span', pv.canAfford ? 'ac-cost' : 'ac-cost ac-bad', t('panel.bonfire.cost', { cost: fmtInt(pv.cost) })));
      if (pv.nextCost !== null && pv.nextCost !== undefined) {
        add(foot, el('span', 'ac-muted', t('panel.bonfire.nextCost', { cost: fmtInt(pv.nextCost) })));
      }
    }
    add(sheet, foot);
    if (pv.diminished) add(sheet, el('div', 'ac-diminish', t('panel.bonfire.diminish')));
  }
}
