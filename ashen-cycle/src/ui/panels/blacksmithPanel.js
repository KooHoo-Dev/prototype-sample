// OWNER: P8 — 계약 §10.3 대장장이 패널
// 읽는 것: progression.getWeaponInfo(id) × 3 · profile.embers/shards. 부르는 것: upgradeWeapon(id) · equipWeapon(id).
import { WEAPON_IDS } from '../../core/constants.js';
import { getWeaponDef } from '../../data/weapons.js';
import { el, add, num, fmtInt, fmtNum, fmtPct } from '../dom.js';
import { t } from '../i18n.js';
import { Panel } from './panelBase.js';

export class BlacksmithPanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, { closable: true });
    this.hints('panel.hint.select', 'panel.hint.switch', 'panel.hint.confirm', 'panel.hint.close');
  }

  build() {
    const { progression } = this.ctx.deps;
    const profile = progression.profile ?? {};
    this.wallet(true);
    this._equipped = profile.equippedWeapon ?? WEAPON_IDS[0];

    const cards = el('div', 'ac-cards');
    const upgrades = [];
    const equips = [];
    for (const id of WEAPON_IDS) {
      const info = progression.getWeaponInfo(id) ?? {};
      const def = getWeaponDef(id) ?? {};
      const equipped = !!info.equipped;
      if (equipped) this._equipped = id;
      const card = el('div', equipped ? 'ac-card ac-equipped' : 'ac-card');

      add(card, add(el('div', 'ac-card-head'),
        el('span', 'ac-card-name', t(`weapon.${id}.name`)),
        el('span', 'ac-card-level', t('panel.blacksmith.level', { n: num(info.level) })),
        equipped ? el('span', 'ac-tag', t('panel.blacksmith.equipped')) : null));
      add(card, el('div', 'ac-card-desc', t(`weapon.${id}.desc`)));

      // 피해: 현재 → 다음 단계
      const dmg = el('span', 'ac-kv-value');
      add(dmg, el('span', '', fmtNum(info.damageNow, 1)));
      if (!info.maxed && num(info.damageNext) > num(info.damageNow)) {
        add(dmg, el('span', 'ac-arrow', '→'), el('span', 'ac-to', fmtNum(info.damageNext, 1)));
      }
      add(card, add(el('div', 'ac-kv'),
        add(el('div', 'ac-kv-row'), el('span', 'ac-kv-label', t('panel.blacksmith.damage')), dmg),
        add(el('div', 'ac-kv-row'), el('span', 'ac-kv-label', t('panel.blacksmith.reach')), el('span', 'ac-kv-value', t('unit.meter', { v: fmtNum(def.reach, 1) }))),
        add(el('div', 'ac-kv-row'), el('span', 'ac-kv-label', t('panel.blacksmith.guard')), el('span', 'ac-kv-value', fmtPct(def.guardReduction)))));

      // 강화 비용(잔불 · 파편) · 따라잡기
      const cost = el('div', 'ac-card-cost');
      if (info.maxed) {
        add(cost, el('span', 'ac-muted', t('panel.blacksmith.maxed')));
      } else if (info.cost) {
        add(cost,
          el('span', 'ac-kv-label', t('panel.blacksmith.cost')),
          el('span', info.canAfford ? 'ac-cost' : 'ac-cost ac-bad',
            t('panel.blacksmith.costValue', { embers: fmtInt(info.cost.embers), shards: fmtInt(info.cost.shards) })));
      } else {
        add(cost, el('span', 'ac-kv-label', t('panel.blacksmith.cost')), el('span', 'ac-muted', t('panel.none')));
      }
      add(card, cost);
      add(card, el('div', 'ac-card-note', info.catchUp && !info.maxed ? t('panel.blacksmith.catchUp') : ''));

      const up = this.button(t('panel.blacksmith.upgrade'), `up:${id}`, () => progression.upgradeWeapon(id), {
        cls: info.maxed || !info.canAfford ? 'ac-poor' : 'ac-primary',
      });
      const eq = equipped
        ? this.button(t('panel.blacksmith.equipped'), `eq:${id}`, () => undefined, { cls: 'ac-on' })
        : this.button(t('panel.blacksmith.equip'), `eq:${id}`, () => progression.equipWeapon(id));
      add(card, add(el('div', 'ac-card-actions'), up.el, eq.el));
      upgrades.push(up);
      equips.push(eq);
      add(cards, card);
    }
    add(this.body, cards);
    this.row(...upgrades);
    this.row(...equips);
  }

  defaultFocus() {
    return `up:${this._equipped}`;
  }
}
