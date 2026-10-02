// OWNER: P8 — 계약 §10.3 결과 패널
// 읽는 것: params.reward(RewardResult) · params.outcome · params.duration · sim.state.fight · progression.getAffordableLevelUps().
// 부르는 것: retry() · toTown(). 사망이면 [R] 즉시 재도전(기본 포커스) · [Q] 마을로, 승리면 [마을로](기본 포커스)이고 R 단축키는 끈다.
import { el, add, num, clamp01, fmtInt, fmtPct, fmtTime } from '../dom.js';
import { t } from '../i18n.js';
import { Panel } from './panelBase.js';

export class ResultPanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    const fight = ctx.deps.sim?.state?.fight ?? null;
    const reward = ctx.params.reward ?? fight?.reward ?? null;
    const outcome = ctx.params.outcome ?? fight?.outcome ?? (reward?.victory ? 'victory' : 'death');
    const victory = outcome === 'victory';
    super(ctx, { title: t(victory ? 'panel.result.titleVictory' : 'panel.result.titleDeath') });
    this._victory = victory;
    this._reward = reward;
    this.el.classList.add(victory ? 'ac-victory' : 'ac-death');
    if (victory) {
      this.hints('panel.hint.select', 'panel.hint.confirm', 'panel.hint.town');
    } else {
      this.hints('panel.hint.select', 'panel.hint.confirm'); // R · Q는 버튼에 적혀 있다
      // R은 사망 결과에서만(순환이 오른 직후 실수로 다시 들어가지 않게)
      this.hotkeys.KeyR = () => {
        this.ctx.sound('click');
        this.ctx.deps.actions.retry();
      };
    }
  }

  build() {
    const { sim, progression, actions } = this.ctx.deps;
    const params = this.ctx.params;
    const state = sim?.state ?? {};
    const fight = state.fight ?? {};
    const reward = this._reward ?? {};
    const victory = this._victory;
    const bossId = reward.bossId ?? fight.bossId ?? state.boss?.id ?? null;
    const fraction = clamp01(num(reward.damageFraction ?? (state.boss ? num(fight.damageDealt) / Math.max(1, num(state.boss.hpMax)) : 0)));
    const duration = num(params.duration ?? reward.duration ?? fight.time);

    if (bossId) add(this.body, el('div', 'ac-result-boss', t(`boss.${bossId}.name`)));

    // ── 준 피해 % ──
    const dmg = el('div', 'ac-result-damage');
    const meter = el('div', 'ac-meter');
    const fill = el('div', 'ac-meter-fill');
    fill.style.transform = `scaleX(${fraction})`;
    add(meter, fill);
    add(dmg, el('span', 'ac-result-label', t('panel.result.damage')), meter, el('span', 'ac-result-pct', fmtPct(fraction)));
    add(this.body, dmg);

    // ── 획득 잔불 · 파편 ──
    const gains = el('div', 'ac-result-gains');
    add(gains, add(el('div', 'ac-gain ac-ember'),
      el('span', 'ac-result-label', t('panel.result.embers')),
      add(el('span', 'ac-gain-num'), el('i', 'ac-ico ac-ico-ember'), el('span', '', `+${fmtInt(reward.embers)}`))));
    add(gains, add(el('div', num(reward.shards) > 0 ? 'ac-gain ac-shard' : 'ac-gain ac-shard ac-zero'),
      el('span', 'ac-result-label', t('panel.result.shards')),
      add(el('span', 'ac-gain-num'), el('i', 'ac-ico ac-ico-shard'), el('span', '', `+${fmtInt(reward.shards)}`))));
    add(this.body, gains);

    // ── 전투 기록 ──
    const stats = el('div', 'ac-result-stats');
    const stat = (label, value) => add(stats, add(el('span', 'ac-result-stat'), el('span', 'ac-result-label', label), el('b', '', value)));
    stat(t('panel.result.time'), fmtTime(duration));
    stat(t('panel.result.taken'), fmtInt(fight.damageTaken));
    stat(t('panel.result.parries'), fmtInt(fight.parries));
    stat(t('panel.result.executions'), fmtInt(fight.executions));
    add(this.body, stats);

    // ── 새 구간 · 해금 · 순환 ──
    const notes = el('ul', 'ac-result-notes');
    for (const m of reward.milestones ?? []) add(notes, el('li', '', t('panel.result.milestone', { pct: Math.round(num(m) * 100) })));
    if (reward.firstKill) add(notes, el('li', '', t('panel.result.firstKill')));
    if (reward.unlocked) add(notes, el('li', 'ac-good', t('panel.result.unlocked', { boss: t(`boss.${reward.unlocked}.name`) })));
    if (reward.cycleAdvanced) add(notes, el('li', 'ac-good', t('panel.result.cycle', { n: num(progression.profile?.cycle) })));
    if (notes.childNodes.length) add(this.body, notes);

    const embersNow = reward.embersAfter ?? progression.profile?.embers;
    const affordable = num(progression.getAffordableLevelUps());
    const totals = el('div', 'ac-result-total');
    add(totals, el('span', '', t('panel.result.total', { n: fmtInt(embersNow) })));
    if (!victory || affordable > 0) {
      add(totals, el('span', affordable > 0 ? 'ac-afford ac-good' : 'ac-afford ac-muted', t('panel.result.afford', { n: affordable })));
    }
    add(this.body, totals);

    // ── 버튼 ──
    const menu = el('div', 'ac-menu');
    if (victory) {
      const town = this.button(t('panel.result.toTown'), 'town', () => actions.toTown(), { cls: 'ac-primary' });
      const mul = num(progression.getBossList()?.find((b) => b.id === bossId)?.repeatMul ?? 1);
      const again = this.button(t('panel.result.rematch', { mul }), 'retry', () => actions.retry());
      add(menu, town.el, again.el);
      this.row(town);
      this.row(again);
    } else {
      const retry = this.button(t('panel.hint.retry'), 'retry', () => actions.retry(), { cls: 'ac-primary' });
      // 살 수 있는 레벨업이 있으면 [마을로]를 강조한다
      const town = this.button(t('panel.hint.town'), 'town', () => actions.toTown(), { cls: affordable > 0 ? 'ac-recommend' : '' });
      add(menu, retry.el, town.el);
      this.row(retry);
      this.row(town);
    }
    add(this.body, menu);
  }

  defaultFocus() {
    return this._victory ? 'town' : 'retry';
  }

  /** result: cancel = 마을로. */
  cancel() {
    this.ctx.sound('click');
    this.ctx.deps.actions.toTown();
  }
}
