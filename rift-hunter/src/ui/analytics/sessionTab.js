// OWNER: P12 — 계약 §10.9(세션 기록) · §3.9 RunRecord
// 세션 기록 탭 — char.records(최근 것이 앞 · 최대 ECON.recordsMax)를 판마다 한 줄 · 맨 아래 누적 합 · JSON · CSV 내려받기.
// 내려받기는 exporters.js(순수 — toJson · toCsv)의 문자열을 actions.downloadFile(name, mime, text)로 넘긴다(app 이 Blob · a[download]).

import { KEYBINDS, PANEL_KEYS } from '../../data/keybinds.js';
import { RARITIES } from '../../core/constants.js';
import { fmtInt, fmtSec } from '../format.js';
import { sumRecords, toCsv, toJson } from './exporters.js';
import { keyLabel } from './dropSimTab.js';

/** 단축키(데이터 표에 analytics 가 없으면 이 값 — NOTES-P12) */
const KEY_JSON = /** @type {any} */ (PANEL_KEYS).analytics?.json ?? 'KeyJ';
const KEY_CSV = /** @type {any} */ (PANEL_KEYS).analytics?.csv ?? 'KeyC';
/** 처치 열(RunStats.kills 의 키 — 이름은 rank.<id> · other 는 complete.other) */
const KILL_KEYS = ['normal', 'champion', 'elite', 'minion', 'guardian', 'other'];

/**
 * 내려받을 파일 이름 — rift-hunter-<클래스>-<칸>-records.<확장자>
 * @param {any} char @param {'json'|'csv'} ext
 */
export function recordFileName(char, ext) {
  const cls = char && typeof char.cls === 'string' ? char.cls : 'char';
  const slot = char && Number.isInteger(char.slot) ? char.slot : 0;
  return `rift-hunter-${cls}-${slot}-records.${ext}`;
}

/**
 * 세션 기록 탭.
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:any) => string, ui:any, widgets:any}} ctx
 */
export function createSessionTab(ctx) {
  const { widgets: W, t } = ctx;
  const el = W.el('div', 'an-tab an-session');
  el.dataset.tab = 'session';
  const top = el.appendChild(W.el('div', 'an-shead'));
  const summary = top.appendChild(W.el('div', 'an-ssum'));
  const btns = top.appendChild(W.el('div', 'btn-row an-sbtns'));
  const msg = el.appendChild(W.el('div', 'an-smsg'));
  const scroller = el.appendChild(W.el('div', 'an-tscroll an-sscroll'));
  el.appendChild(W.el('div', 'an-foot panel-hint', t('analytics.hint.session')));

  /** @type {any} */
  let char = null;
  /** @type {any[]} */
  let records = [];
  /** 다시 그릴지 판단(같은 배열을 앞에 넣어 고친다 — 캐릭터 · 배열 · 길이 · 맨 앞 기록을 참조로 비교 · 프레임마다 할당 없음) */
  /** @type {any} */
  let seenChar = undefined;
  /** @type {any} */
  let seenRecs = undefined;
  let seenLen = -1;
  /** @type {any} */
  let seenFirst = undefined;

  /** @param {'json'|'csv'} kind */
  const download = (kind) => {
    if (!records.length) { msg.textContent = t('analytics.ses.empty'); msg.className = 'an-smsg'; return; }
    const name = recordFileName(char, kind);
    const text = kind === 'json' ? toJson(records) : toCsv(records);
    const mime = kind === 'json' ? 'application/json' : 'text/csv';
    const res = ctx.actions && typeof ctx.actions.downloadFile === 'function' ? ctx.actions.downloadFile(name, mime, text) : { ok: false, reason: 'invalid' };
    if (res && res.ok === false) {
      msg.textContent = t('reason.' + (res.reason ?? 'invalid'), res.params);
      msg.className = 'an-smsg bad';
    } else {
      msg.textContent = t('analytics.ses.saved', { name });
      msg.className = 'an-smsg good';
    }
  };
  const bJson = W.button('analytics.json', () => download('json'));
  bJson.textContent = t('analytics.json') + ' ' + keyLabel(KEY_JSON);
  const bCsv = W.button('analytics.csv', () => download('csv'));
  bCsv.textContent = t('analytics.csv') + ' ' + keyLabel(KEY_CSV);
  btns.append(bJson, bCsv);

  /** 머리줄 둘(묶음 · 칸) */
  const header = () => {
    const thead = W.el('thead');
    const g = thead.appendChild(W.el('tr', 'an-group'));
    const sub = thead.appendChild(W.el('tr'));
    /** @param {string} text @param {number} span */
    const grp = (text, span) => {
      const th = g.appendChild(W.el('th', span > 1 ? 'an-gcell' : '', text));
      if (span > 1) th.colSpan = span;
    };
    /** @param {string} text @param {string} [cls] */
    const col = (text, cls = '') => sub.appendChild(W.el('th', cls, text));
    grp('', 1); col('#', 'an-num');
    grp('', 1); col(t('analytics.ses.result'));
    grp('', 1); col(t('analytics.f.level'), 'an-num');
    grp('', 1); col(t('complete.time'), 'an-num');
    grp(t('complete.kills'), KILL_KEYS.length);
    for (const k of KILL_KEYS) col(k === 'other' ? t('complete.other') : t('rank.' + k), 'an-num rank-' + k);
    grp('', 1); col(t('complete.deaths'), 'an-num');
    grp(t('complete.drops'), RARITIES.length);
    for (const r of RARITIES) col(t('rarity.' + r), 'an-num r-' + r);
    grp('', 1); col(t('complete.gold'), 'an-num');
    grp('', 1); col(t('complete.xp'), 'an-num');
    grp('', 1); col(t('complete.upgrades'), 'an-num');
    grp('', 1); col(t('analytics.ses.charLevel'), 'an-num');
    return thead;
  };

  /** @param {HTMLElement} tr @param {string} text @param {string} [cls] */
  const cell = (tr, text, cls = 'an-num') => tr.appendChild(W.el('td', cls, text));
  /** @param {unknown} v */
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const draw = () => {
    scroller.textContent = '';
    if (!char) {
      summary.textContent = '';
      scroller.appendChild(W.el('div', 'an-empty', t('analytics.ses.noChar')));
      bJson.disabled = bCsv.disabled = true;
      return;
    }
    bJson.disabled = bCsv.disabled = records.length === 0;
    const sum = sumRecords(records);
    summary.textContent = t('analytics.ses.total', {
      n: fmtInt(sum.runs), complete: fmtInt(sum.results.complete), collapse: fmtInt(sum.results.collapse), abandon: fmtInt(sum.results.abandon),
      time: fmtSec(sum.timeSec),
    });
    if (!records.length) {
      scroller.appendChild(W.el('div', 'an-empty', t('analytics.ses.empty')));
      return;
    }
    const table = W.el('table', 'an-data an-runs');
    table.appendChild(header());
    const body = table.appendChild(W.el('tbody'));
    records.forEach((r, i) => {
      const tr = body.appendChild(W.el('tr', 'res-' + String(r?.result ?? '')));
      cell(tr, String(records.length - i));
      cell(tr, t('analytics.result.' + String(r?.result ?? 'abandon')), 'an-res');
      cell(tr, t('riftStone.level', { n: num(r?.level) }));
      cell(tr, fmtSec(num(r?.timeSec)));
      for (const k of KILL_KEYS) cell(tr, fmtInt(num(r?.kills?.[k])));
      cell(tr, fmtInt(num(r?.deaths)), num(r?.deaths) > 0 ? 'an-num bad' : 'an-num');
      for (const rr of RARITIES) cell(tr, fmtInt(num(r?.drops?.[rr])), 'an-num r-' + rr);
      cell(tr, fmtInt(num(r?.gold)));
      cell(tr, fmtInt(num(r?.xp)));
      cell(tr, fmtInt(num(r?.upgrades)));
      cell(tr, fmtInt(num(r?.charLevel)));
    });
    // 누적 합(계약 §10.9)
    const foot = table.appendChild(W.el('tfoot'));
    const tr = foot.appendChild(W.el('tr', 'an-total'));
    cell(tr, '');
    cell(tr, t('analytics.ses.sum'), 'an-res');
    cell(tr, '');
    cell(tr, fmtSec(sum.timeSec));
    for (const k of KILL_KEYS) cell(tr, fmtInt(sum.kills[/** @type {keyof typeof sum.kills} */ (k)]));
    cell(tr, fmtInt(sum.deaths));
    for (const rr of RARITIES) cell(tr, fmtInt(sum.drops[/** @type {keyof typeof sum.drops} */ (rr)]), 'an-num r-' + rr);
    cell(tr, fmtInt(sum.gold));
    cell(tr, fmtInt(sum.xp));
    cell(tr, fmtInt(sum.upgrades));
    cell(tr, '');
    scroller.appendChild(table);
  };

  /** @param {any} state */
  const sync = (state) => {
    const ch = state?.char ?? null;
    const recs = ch && Array.isArray(ch.records) ? ch.records : null;
    const len = recs ? recs.length : 0;
    const first = recs && len ? recs[0] : null;
    if (ch === seenChar && recs === seenRecs && len === seenLen && first === seenFirst) return;
    seenChar = ch;
    seenRecs = recs;
    seenLen = len;
    seenFirst = first;
    char = ch;
    records = recs ?? [];
    draw();
  };

  return {
    el,
    /** @param {any} state */
    show(state) {
      msg.textContent = '';
      seenChar = undefined;
      sync(state);
    },
    hide() {},
    stop() {},
    /** @param {any} state */
    update(state) { sync(state); },
    /** @param {KeyboardEvent} e @returns {boolean} */
    handleKey(e) {
      if (e.type === 'keyup') return false;
      const code = e.code;
      if (code === KEY_JSON) { if (!e.repeat) download('json'); return true; }
      if (code === KEY_CSV) { if (!e.repeat) download('csv'); return true; }
      if (code === KEYBINDS.down || code === KEYBINDS.up) { scroller.scrollTop += (code === KEYBINDS.down ? 1 : -1) * 24; return true; }
      if (code === 'PageDown' || code === 'PageUp') {
        scroller.scrollTop += (code === 'PageDown' ? 1 : -1) * Math.max(40, scroller.clientHeight * 0.85);
        return true;
      }
      if (code === KEYBINDS.left || code === KEYBINDS.right) { scroller.scrollLeft += (code === KEYBINDS.right ? 1 : -1) * 80; return true; }
      return false;
    },
    dispose() { el.remove(); },
  };
}
