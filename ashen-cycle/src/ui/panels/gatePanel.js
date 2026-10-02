// OWNER: P8 — 계약 §10.3 안개문 패널
// 읽는 것: progression.getBossList() · profile.cycle. 부르는 것: actions.startBoss(id).
// 기본 포커스가 아직 못 잡은 첫 보스라 안개문에서 E, E 두 번에 출발한다.
import { BOSS_IDS } from '../../core/constants.js';
import { getBossDef } from '../../data/bosses/index.js';
import { el, add, clear, num, fmtInt, fmtPct } from '../dom.js';
import { t, hasStr } from '../i18n.js';
import { Panel } from './panelBase.js';

export class GatePanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx, { closable: true });
    this.hints('panel.hint.select', 'panel.hint.confirm', 'panel.hint.close');
  }

  build() {
    const { progression, actions } = this.ctx.deps;
    const profile = progression.profile ?? {};
    clear(this.headRight);
    add(this.headRight, el('span', 'ac-wallet-chip', t('panel.gate.cycle', { n: num(profile.cycle) })));

    const list = progression.getBossList() ?? [];
    /** @type {Record<string, Object>} */
    this._info = {};
    for (const id of BOSS_IDS) {
      // 목록에 없으면(진행 모듈이 아직 값을 주지 않는다) 프로필의 진행 기록만으로 그린다 — 보상 칸은 비운다
      const bp = profile.bosses?.[id] ?? {};
      this._info[id] = list.find((b) => b.id === id) ?? {
        id, unlocked: !!bp.unlocked, attempts: num(bp.attempts), killsThisCycle: num(bp.killsThisCycle),
        totalKills: num(bp.totalKills), bestFraction: num(bp.bestFraction),
        victoryEmbers: null, victoryShards: null, repeatMul: 1, shardsLeft: null,
      };
    }

    const cols = el('div', 'ac-gate-cols');
    const rows = el('div', 'ac-gate-list');
    for (const id of BOSS_IDS) {
      const info = this._info[id];
      const rowEl = el('div', 'ac-gate-row');
      const state = el('span', 'ac-gate-state');
      if (!info.unlocked) {
        rowEl.classList.add('ac-locked');
        state.textContent = t('panel.gate.locked');
      } else if (num(info.killsThisCycle) > 0) {
        rowEl.classList.add('ac-defeated');
        state.textContent = t('panel.gate.defeated');
      } else {
        state.textContent = t('panel.gate.enter');
        state.classList.add('ac-go');
      }
      add(rowEl,
        el('i', `ac-sigil ac-sigil-${getBossDef(id)?.style ?? 'fire'}`),
        add(el('div', 'ac-gate-names'),
          el('span', 'ac-gate-name', t(`boss.${id}.name`)),
          el('span', 'ac-gate-title', t(`boss.${id}.title`))),
        state);
      add(rows, rowEl);
      this.row(this.item(rowEl, id, {
        activate: () => actions.startBoss(id),
        denied: info.unlocked ? null : 'locked',
      }));
    }
    this._detail = el('div', 'ac-gate-detail');
    add(cols, rows, this._detail);
    add(this.body, cols);
  }

  render() {
    super.render();
    this._paintDetail(this.focusKey);
  }

  defaultFocus() {
    for (const id of BOSS_IDS) {
      const info = this._info[id];
      if (info.unlocked && num(info.killsThisCycle) === 0) return id;
    }
    return BOSS_IDS[0];
  }

  onFocusChange(item) {
    this._paintDetail(item.key);
  }

  /** 오른쪽: 포커스된 보스의 기록과 예상 보상. @param {string|null} id */
  _paintDetail(id) {
    const box = this._detail;
    if (!box) return;
    clear(box);
    const info = id ? this._info[id] : null;
    if (!info) return;
    const def = getBossDef(id);
    const arenaKey = `world.${def?.arenaId}.name`;
    const title = t(`boss.${id}.title`);

    add(box,
      el('div', 'ac-gate-dname', t(`boss.${id}.name`)),
      el('div', 'ac-gate-dtitle', hasStr(arenaKey) ? `${title} · ${t(arenaKey)}` : title));

    if (!info.unlocked) {
      // 해금 조건: 해금 순서(BOSS_IDS)의 바로 앞 보스를 격파
      const prev = BOSS_IDS[Math.max(0, BOSS_IDS.indexOf(id) - 1)];
      add(box, el('div', 'ac-gate-lockhint', t('panel.gate.lockedHint', { boss: t(`boss.${prev}.name`) })));
      return;
    }
    add(box, el('div', 'ac-gate-hint', t(`boss.${id}.hint`)));

    const kv = el('div', 'ac-kv');
    const line = (label, value, cls) => add(kv, add(el('div', 'ac-kv-row'), el('span', 'ac-kv-label', label), el('span', cls ? `ac-kv-value ${cls}` : 'ac-kv-value', value)));
    line(t('panel.gate.attempts'), t('panel.gate.attemptsValue', { n: fmtInt(info.attempts) }));
    line(t('panel.gate.best'), fmtPct(info.bestFraction));
    line(t('panel.gate.kills'), t('panel.gate.attemptsValue', { n: fmtInt(info.killsThisCycle) }));
    const known = info.victoryEmbers !== null && info.victoryEmbers !== undefined;
    line(t('panel.gate.reward'), known
      ? t('panel.gate.rewardValue', { embers: fmtInt(info.victoryEmbers), shards: fmtInt(info.victoryShards) })
      : t('panel.none'), 'ac-cost');
    if (info.shardsLeft !== null && info.shardsLeft !== undefined) line(t('panel.gate.shardsLeft'), fmtInt(info.shardsLeft));
    add(box, kv);
    if (num(info.repeatMul) > 0 && num(info.repeatMul) < 1) {
      add(box, el('div', 'ac-gate-repeat', t('panel.gate.repeat', { mul: num(info.repeatMul) })));
    }
  }
}
