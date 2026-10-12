// OWNER: P11 — 계약 §10.1 · §10.2 · §10.6
// 캐릭터 시트(겹쳐 보는 패널 · KeyC — 읽기만): 주 능력치 · 활력 · 생명 · 자원 · 시트 DPS · 무기 · 공격 속도 · 치명타 · 방어도(그 레벨 감소율) ·
// 저항 넷(감소율) · 피해 보너스(종류 · 스킬 · 범위 · 정예) · 쿨다운 · 비용 감소 · 이동 속도 · 적중 회복 · 재생 · 가시 · 골드/아이템 발견(유효 MF) · 경험치 % ·
// 경험치 · 플레이 시간 · 해금 균열. 시트(ctx.stats)가 바뀔 때만 다시 그린다(플레이 시간은 초가 바뀔 때).

import { DMG_TYPES } from '../../core/constants.js';
import { KEYBINDS } from '../../data/keybinds.js';
import { DRa, DRr } from '../../sim/loot/stats.js';
import { effectiveMF } from '../../sim/loot/theory.js';
import { xpReq } from '../../sim/progression/progress.js';
import { fmtDps, fmtInt, fmtNum, fmtPct, fmtSec } from '../format.js';

/** @typedef {import('../../types.js').Panel} Panel */

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createCharacterPanel(ctx) {
  const { t, widgets: w, sim } = ctx;
  const el = w.panelFrame('panel.character.title');
  el.dataset.panel = 'character';
  el.classList.add('pnl-char');
  const head = el.appendChild(w.el('div', 'char-head'));
  const cols = el.appendChild(w.el('div', 'char-cols'));
  /** @type {any} */
  let lastStats = null;
  /** @type {any} */
  let lastChar = null;
  let lastSec = -1;
  let lastXp = -1;
  /** @type {HTMLElement|null} */
  let playEl = null;
  /** @type {HTMLElement|null} */
  let xpEl = null;

  /** @param {string} label @param {string} value @param {string} [small] */
  function row(label, value, small) {
    const r = cols.appendChild(w.el('div', 'char-row'));
    r.appendChild(w.el('span', 'char-k', label));
    const v = r.appendChild(w.el('span', 'char-v', value));
    if (small) v.appendChild(w.el('small', '', small));
    return v;
  }
  /** @param {string} text */
  function sec(text) { cols.appendChild(w.el('div', 'char-sec', text)); }

  /** @param {any} char */
  function xpText(char) {
    const req = xpReq(char.level);
    return Number.isFinite(req) ? `${fmtInt(char.xp)} / ${fmtInt(req)}` : t('hud.levelMax');
  }

  /** @param {any} char @param {any} s */
  function render(char, s) {
    head.textContent = '';
    cols.textContent = '';
    playEl = null;
    xpEl = null;
    if (!char || !s) return;
    head.appendChild(w.el('b', '', char.name ?? ''));
    head.appendChild(w.el('span', '', t('class.' + char.cls)));
    head.appendChild(w.el('span', '', t('hud.level', { n: char.level })));
    const L = Math.max(1, Math.floor(Number(char.riftUnlocked)) || 1);

    // 기본 · 생존
    sec(t('stat.lifeMax') + ' · ' + t('stat.armor') + ' · ' + t('stat.res'));
    row(t('stat.main.' + char.cls), fmtInt(s.main));             // 「힘(주 능력치)」 · 「지능(주 능력치)」 — 아이템의 힘 · 지능 줄과 같은 낱말
    row(t('stat.vit'), fmtInt(s.vit));
    row(t('stat.lifeMax'), fmtInt(s.lifeMax));
    row(t('res.' + (s.cls === 'mage' ? 'mana' : 'rage')), fmtInt(s.resourceMax));
    if (s.resourceRegen > 0) row(t('stat.resourceRegen'), fmtNum(s.resourceRegen, 1));
    row(t('stat.armor'), fmtInt(s.armor), t('char.drArmor', { p: fmtNum(DRa(s.armor, L) * 100, 1) }));
    row(t('stat.ehp'), fmtInt(s.ehp));
    for (const ty of DMG_TYPES) {
      const v = Number(s.res?.[ty]) || 0;
      row(t('dmg.' + ty) + ' ' + t('stat.res'), fmtInt(v), t('char.drRes', { type: '', p: fmtNum(DRr(v, L) * 100, 1) }).trim());
    }
    if (s.block > 0) row(t('stat.block'), fmtPct(s.block, 0));
    if (s.dmgTakenReduce > 0) row(t('stat.dmgTakenReduce'), fmtPct(s.dmgTakenReduce, 0));
    row(t('stat.lifeRegen'), fmtNum(s.lifeRegen, 1));
    row(t('stat.lifeOnHit'), fmtNum(s.lifeOnHit, 1));
    if (s.lifePctOnHit > 0) row(t('stat.lifePctOnHit'), fmtPct(s.lifePctOnHit, 1));
    if (s.thorns > 0) row(t('stat.thorns'), fmtInt(s.thorns));

    // 공격
    sec(t('stat.sheetDps'));
    row(t('stat.sheetDps'), fmtDps(s.sheetDps));
    row(t('stat.weapon'), `${fmtInt(s.weapon?.min)}–${fmtInt(s.weapon?.max)}`, t('dmg.' + (s.weapon?.type ?? 'phys')));
    row(t('stat.aps'), fmtNum(s.aps, 2));
    row(t('stat.critChance'), fmtPct(s.critChance, 1));
    row(t('stat.critDamage'), '+' + fmtPct(s.critDamage, 0));
    const dmgParts = DMG_TYPES.filter((ty) => (s.dmgPct?.[ty] ?? 0) > 0).map((ty) => `${t('dmg.' + ty)} +${fmtPct(s.dmgPct[ty], 0)}`);
    row(t('stat.dmgPct'), dmgParts.length ? dmgParts.join(' · ') : '0%');
    const sk = Object.keys(s.skillPct ?? {}).filter((k) => s.skillPct[k] > 0);
    if (sk.length) row(t('stat.skillPct'), sk.map((k) => `${t('node.' + k + '.name')} +${fmtPct(s.skillPct[k], 0)}`).join(' · '));
    row(t('stat.aoePct'), '+' + fmtPct(s.aoePct, 0));
    row(t('stat.elitePct'), '+' + fmtPct(s.elitePct, 0));
    row(t('stat.cdr'), fmtPct(s.cdr, 1));
    row(t('stat.costReduce'), fmtPct(s.costReduce, 0));
    if (s.rageOnHit > 0) row(t('stat.rageOnHit'), fmtNum(s.rageOnHit, 1));

    // 탐험 · 진행
    sec(t('stat.magicFind') + ' · ' + t('hud.xp'));
    row(t('stat.moveSpeed'), fmtNum(s.moveSpeed, 2));
    row(t('stat.goldFind'), '+' + fmtPct(s.goldFind, 0));
    row(t('stat.magicFind'), '+' + fmtPct(s.magicFind, 0), t('char.effMf', { p: fmtNum(effectiveMF(s.magicFind) * 100, 0) }));
    row(t('stat.xpPct'), '+' + fmtPct(s.xpPct, 0));
    row(t('stat.potionPct'), '+' + fmtPct(s.potionPct, 0));
    row(t('stat.globePct'), '+' + fmtPct(s.globePct, 0));
    xpEl = row(t('hud.xp'), xpText(char));
    playEl = row(t('char.playTime'), fmtSec(char.playSec));
    row(t('char.riftUnlocked'), t('riftStone.level', { n: L }));
  }

  return {
    id: 'character',
    modal: false,
    el,
    open() { lastStats = null; },
    close() {},
    update(state) {
      const char = state?.char ?? null;
      const s = sim?.getStats?.() ?? null;
      if (s !== lastStats || char !== lastChar) {
        lastStats = s;
        lastChar = char;
        lastSec = -1;
        lastXp = -1;
        render(char, s);
      }
      if (!char) return;
      const sec = Math.floor(Number(char.playSec) || 0);
      if (playEl && sec !== lastSec) { lastSec = sec; playEl.textContent = fmtSec(sec); }
      const xpKey = (char.level | 0) * 1e9 + (char.xp | 0);
      if (xpEl && xpKey !== lastXp) { lastXp = xpKey; xpEl.textContent = xpText(char); }
    },
    handleKey(e) {
      const code = e.code;
      if (code === KEYBINDS.pause || code === KEYBINDS.character) return false;
      return false;
    },
    keys: [KEYBINDS.pause, KEYBINDS.character],
    dispose() { el.remove(); },
  };
}
