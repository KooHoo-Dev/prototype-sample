// OWNER: P8 — 계약 §6.11 · §10.3
// HUD — UIRoot 내부(다른 패키지는 import 하지 않는다). 상태를 읽어 바뀐 것만 DOM 에 쓴다(프레임마다 할당을 줄인다).
//   좌상단: 시계 · 시간대 · 일출/일몰 띠 · 날씨 · 돈 · 레벨 + 경험치 바(MAX) · 스킬 포인트 배지
//   우상단: 어창 n/12 · 스테이지(· 자리)
//   하단 중앙(낚시 모드): 채비 요약 · 화면 중앙 아래: 상호작용 · 단계 안내 · 시점 안내
//   캐스팅 게이지 · 파이팅(우하단): limitRatio 텐션 게이지(로드/라인 아이콘) · 드랙 눈금(라인 유효 강도 · 로드 상한) · 거리 · 잔량 · 예고 · 경고 · 체력 · 뜰채

import { BAIT_IDS, LAYER_IDS, TICKS_PER_MINUTE } from '../core/constants.js';
import { CAST } from '../data/bite.js';
import { HOLD } from '../data/economy.js';
import { TIME } from '../data/time.js';
import { formatClock } from '../sim/clock.js';
import { xpToNext } from '../sim/progression/progress.js';
import { t } from './i18n.js';
import { el, fmt, setClass, setHidden, setStyle, setText } from './widgets.js';

/** 연출 상수 */
const RIGSTATS_REFRESH_S = 0.25;   // 채비 요약 · 드랙 눈금의 RigStats 다시 읽기 주기
const TENSION_WARN = 0.6;          // limitRatio 황색 문턱(§10.3)
const TENSION_DANGER = 0.85;       // 적색 문턱
const LINE_LOW_M = CAST.minLineM + CAST.lineReserveM;   // 파이팅 잔량 주황(30m — §10.3)
const COVER_SHOW = 0.5;            // 「박힘」 문턱(§3.4 inCover)
const ABRASION_SHOW = 0.05;        // 라인 손상 표시 문턱
const DELTA_LIFE = 1.8;            // 돈 · 경험치 ± 표시 수명(ui dt)
const PROMPT_CASTS = 5;            // 단계 안내(캐스팅 · 대기)를 보이는 첫 캐스팅 수
const GAUGE_SCALE_MAX = 1.0;       // 텐션 게이지는 100% 에서 가득

/** 아이콘(외부 에셋 없음 — 인라인 SVG) */
const SVG = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>',
  dawn: '<svg viewBox="0 0 24 24"><path d="M5 17a7 7 0 0 1 14 0z" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 20h20M12 4v3M4.5 9.5l2 1.5M19.5 9.5l-2 1.5"/></g></svg>',
  evening: '<svg viewBox="0 0 24 24"><path d="M6 18a6 6 0 0 1 12 0z" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 20h20M12 7v3M5 12l2 1M19 12l-2 1"/></g></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="currentColor"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 18z" fill="currentColor"/></svg>',
  rain: '<svg viewBox="0 0 24 24"><path d="M7 14h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6 1.5A3.3 3.3 0 0 0 7 14z" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/></g></svg>',
  rod: '<svg viewBox="0 0 24 24"><path d="M3 21L20 4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="6.5" cy="17.5" r="2.2" fill="currentColor"/></svg>',
  line: '<svg viewBox="0 0 24 24"><path d="M4 20c4-4 4-12 8-12s4 8 8 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  run: '<svg viewBox="0 0 24 24"><path d="M3 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M4 18c3-10 13-10 16 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M12 3v6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  dive: '<svg viewBox="0 0 24 24"><path d="M12 3v14M6 12l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 21h18" stroke="currentColor" stroke-width="2"/></svg>',
  charge: '<svg viewBox="0 0 24 24"><path d="M21 12H8M12 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const BAND_ICON = { dawn: 'dawn', morning: 'sun', day: 'sun', evening: 'evening', night: 'moon' };
const WEATHER_ICON = { clear: 'sun', cloudy: 'cloud', rain: 'rain' };

/** @param {string} cls @param {string} [svgName] */
function icon(cls, svgName) {
  const n = el('span', 'ico ' + cls);
  if (svgName) n.innerHTML = SVG[svgName];
  return n;
}

/** 숫자가 (자리수까지) 바뀐 때만 서식을 만든다 @param {HTMLElement} node @param {number} v @param {number} digits @param {string} key @param {Object} [extra] */
function numText(node, v, digits, key, extra) {
  const n = /** @type {any} */ (node);
  const k = Math.round((Number.isFinite(v) ? v : 0) * Math.pow(10, digits));
  if (n._n === k && n._k === key) return;
  n._n = k;
  n._k = key;
  setText(node, extra ? t(key, { ...extra, v: fmt(v, digits) }) : t(key, { v: fmt(v, digits) }));
}

/** 서명(원시값)이 바뀐 때만 문면을 만든다 — 프레임마다 t() · 문자열 조립을 피한다 @param {HTMLElement} node @param {string|number|null} sig @param {() => string} make */
function once(node, sig, make) {
  const n = /** @type {any} */ (node);
  if (n._sig === sig) return;
  n._sig = sig;
  setText(node, make());
}

/** @param {HTMLElement} node @param {string} name */
function setIcon(node, name) {
  const n = /** @type {any} */ (node);
  if (n._ico === name) return;
  n._ico = name;
  node.innerHTML = SVG[name] || '';
}

export class Hud {
  /** @param {HTMLElement} root @param {{sim:Object, ui:Object}} deps */
  constructor(root, deps) {
    this.sim = deps.sim;
    this.ui = deps.ui;
    this.root = el('div', 'hud');
    root.append(this.root);
    /** @type {Object|null} */
    this.rs = null;
    this._rsT = 0;
    this._rsDirty = true;
    this._pointer = { known: false, locked: true, available: true };
    this._moneyT = 0;
    this._xpT = 0;

    // 좌상단
    const tl = el('div', 'hud-tl hud-box');
    const row1 = el('div', 'hud-row');
    this.bandIco = icon('band');
    this.clock = el('span', 'hud-clock');
    this.bandName = el('span', 'hud-band');
    this.weatherIco = icon('weather');
    this.weatherName = el('span', 'hud-weather');
    row1.append(this.bandIco, this.clock, this.bandName, this.weatherIco, this.weatherName);
    const sunRow = el('div', 'hud-row hud-sunrow');
    this.sunTrack = el('div', 'hud-sun');
    this.sunMark = el('span', 'hud-sun-mark');
    this.sunTrack.append(this.sunMark);
    sunRow.append(el('span', 'hud-sun-t', t('hud.sunrise')), this.sunTrack, el('span', 'hud-sun-t', t('hud.sunset')));
    const row3 = el('div', 'hud-row');
    this.money = el('span', 'hud-money');
    this.moneyDelta = el('span', 'hud-delta');
    row3.append(this.money, this.moneyDelta);
    const row4 = el('div', 'hud-row');
    this.level = el('span', 'hud-level');
    this.xpBar = el('span', 'bar hud-xp');
    this.xpFill = el('span', 'bar-fill');
    this.xpBar.append(this.xpFill);
    this.xpText = el('span', 'hud-xptext');
    this.xpDelta = el('span', 'hud-delta');
    row4.append(this.level, this.xpBar, this.xpText, this.xpDelta);
    this.skillBadge = el('div', 'hud-badge');
    tl.append(row1, sunRow, row3, row4, this.skillBadge);

    // 우상단
    const tr = el('div', 'hud-tr hud-box');
    this.hold = el('div', 'hud-hold');
    this.place = el('div', 'hud-place');
    tr.append(this.hold, this.place);

    // 하단 중앙 — 채비 요약
    this.rig = el('div', 'hud-rig hud-box');
    this.rigSet = el('span', 'chip chip-set');
    this.rigRod = el('span', 'chip');
    this.rigLine = el('span', 'chip');
    this.rigLeft = el('span', 'chip');
    this.rigBait = el('span', 'chip');
    this.rigDepth = el('span', 'chip');
    this.rigDrag = el('span', 'chip');
    this.rigLayer = el('span', 'chip');
    this.rigBail = el('span', 'chip is-info', t('hud.bailOpen'));
    this.rig.append(this.rigSet, this.rigRod, this.rigLine, this.rigLeft, this.rigBait, this.rigDepth, this.rigDrag, this.rigLayer, this.rigBail);

    // 중앙 아래 — 안내
    this.promptBox = el('div', 'hud-prompts');
    this.prompt = el('div', 'hud-prompt');
    this.look = el('div', 'hud-look');
    this.promptBox.append(this.prompt, this.look);

    // 캐스팅 게이지
    this.cast = el('div', 'hud-cast');
    this.castBar = el('div', 'cast-bar');
    this.castPerfect = el('span', 'cast-perfect');
    this.castFill = el('span', 'cast-fill');
    this.castMark = el('span', 'cast-mark');
    this.castBar.append(this.castPerfect, this.castFill, this.castMark);
    this.castText = el('div', 'cast-text');
    this.cast.append(el('div', 'cast-label', t('hud.castPower')), this.castBar, this.castText);

    // 뜰채 프롬프트(크게 · 중앙 아래)
    this.net = el('div', 'hud-net', t('hud.net'));

    // 파이팅(우하단)
    this.fight = el('div', 'hud-fight hud-box');
    const tHead = el('div', 'fight-head');
    this.limitIco = icon('limit');
    this.tensionLabel = el('span', 'fight-label', t('hud.tension'));
    this.tensionPct = el('span', 'fight-pct');
    tHead.append(this.limitIco, this.tensionLabel, this.tensionPct);
    this.tension = el('div', 'gauge tension');
    this.tensionFill = el('span', 'gauge-fill');
    this.tension.append(this.tensionFill);
    this.limitText = el('div', 'fight-sub');
    const dHead = el('div', 'fight-head');
    this.dragText = el('span', 'fight-label');
    dHead.append(this.dragText);
    this.drag = el('div', 'gauge drag');
    this.dragFill = el('span', 'gauge-fill');
    this.dragLineTick = el('span', 'tick tick-line');
    this.dragRodTick = el('span', 'tick tick-rod');
    this.drag.append(this.dragFill, this.dragLineTick, this.dragRodTick);
    const legend = el('div', 'fight-legend');
    legend.append(el('span', 'lg lg-line', t('hud.tickLine')), el('span', 'lg lg-rod', t('hud.tickRod')));
    const nums = el('div', 'fight-nums');
    this.fDist = el('span', 'fight-num');
    this.fLeft = el('span', 'fight-num');
    nums.append(this.fDist, this.fLeft);
    this.tele = el('div', 'fight-tele');
    this.teleIco = icon('tele');
    this.teleText = el('span', '');
    this.tele.append(this.teleIco, this.teleText);
    this.warns = el('div', 'fight-warns');
    this.wSnag = el('span', 'warn', t('hud.snag'));
    this.wCover = el('span', 'warn', t('hud.cover'));
    this.wRod = el('span', 'warn warn-hot', t('hud.rodStress'));
    this.wSlip = el('span', 'warn warn-info', t('hud.slipping'));
    this.wBail = el('span', 'warn warn-info', t('hud.bailOpen'));
    this.wAbr = el('span', 'warn');
    this.warns.append(this.wSnag, this.wCover, this.wRod, this.wSlip, this.wBail, this.wAbr);
    this.stamina = el('div', 'fight-stamina');
    this.staminaFill = el('span', 'bar-fill');
    const stBar = el('span', 'bar');
    stBar.append(this.staminaFill);
    this.stamina.append(el('span', 'fight-label', t('hud.stamina')), stBar);
    this.fight.append(tHead, this.tension, this.limitText, dHead, this.drag, legend, nums, this.tele, this.warns, this.stamina);

    this.root.append(tl, tr, this.rig, this.promptBox, this.cast, this.net, this.fight);
  }

  /** RigStats 를 다음 update 에서 다시 읽는다(장착 · 세트 · 스킬 · 복구 이벤트) */
  markDirty() { this._rsDirty = true; }

  /** @param {boolean} locked @param {boolean} available */
  setPointer(locked, available) {
    this._pointer.known = true;
    this._pointer.locked = !!locked;
    this._pointer.available = available !== false;
  }

  /** @param {number} delta */
  moneyPop(delta) {
    if (!delta) return;
    setText(this.moneyDelta, (delta > 0 ? '+' : '−') + t('hud.won', { n: fmt(Math.abs(delta)) }));
    setClass(this.moneyDelta, 'is-neg', delta < 0);
    this._moneyT = DELTA_LIFE;
  }

  /** @param {number} amount */
  xpPop(amount) {
    if (!amount) return;
    setText(this.xpDelta, t('hud.xpGain', { n: fmt(amount) }));
    this._xpT = DELTA_LIFE;
  }

  /**
   * @param {Object} state GameState
   * @param {number} dt ui dt
   * @param {{frozen:boolean, blocking:boolean, hideAll:boolean}} f frozen: 알림 수명을 멈춘다 · hideAll: 타이틀 등 HUD 숨김
   */
  update(state, dt, f) {
    const s = /** @type {any} */ (state);
    setHidden(this.root, f.hideAll);
    if (f.hideAll) return;
    const p = s.profile;
    const rig = s.rig;
    const fight = s.fight;
    const fishing = s.player.mode === 'fish';

    if (!f.frozen) {
      this._rsT -= dt;
      if (this._moneyT > 0) this._moneyT -= dt;
      if (this._xpT > 0) this._xpT -= dt;
    }
    if (this._rsDirty || this._rsT <= 0 || !this.rs) {
      this._rsDirty = false;
      this._rsT = RIGSTATS_REFRESH_S;
      try { this.rs = this.sim.getRigStats(); } catch (e) { void e; }
    }
    const rs = /** @type {any} */ (this.rs);

    // ── 좌상단
    const c = s.clock;
    once(this.clock, Math.floor(c.tickInDay / TICKS_PER_MINUTE), () => formatClock(c));
    setIcon(this.bandIco, BAND_ICON[c.band] || 'sun');
    once(this.bandName, c.band, () => t('band.' + c.band));
    const w = s.weather.current;
    setIcon(this.weatherIco, w === 'clear' && c.night ? 'moon' : (WEATHER_ICON[w] || 'sun'));
    once(this.weatherName, w, () => t('weather.' + w));
    const span = TIME.sunset - TIME.sunrise;
    const sunPos = (c.hour - TIME.sunrise) / span;
    const up = sunPos >= 0 && sunPos <= 1;
    setClass(this.sunTrack, 'is-night', !up);
    setStyle(this.sunMark, 'left', (Math.max(0, Math.min(1, up ? sunPos : (c.hour < TIME.sunrise ? 0 : 1))) * 100).toFixed(1) + '%');
    const mn = /** @type {any} */ (this.money);
    if (mn._m !== p.money) {
      mn._m = p.money;
      setText(this.money, t('hud.won', { n: fmt(p.money) }));
    }
    setClass(this.moneyDelta, 'is-on', this._moneyT > 0);
    numText(this.level, p.level, 0, 'hud.level');
    const need = xpToNext(p.level);
    const capped = !Number.isFinite(need);
    setStyle(this.xpFill, 'width', capped ? '100%' : (Math.max(0, Math.min(1, p.xp / need)) * 100).toFixed(1) + '%');
    setClass(this.xpBar, 'is-max', capped);
    once(this.xpText, capped ? -1 : p.level * 1e9 + p.xp, () => (capped ? t('hud.levelMax') : t('hud.xp', { n: fmt(p.xp), max: fmt(need) })));
    setClass(this.xpDelta, 'is-on', this._xpT > 0);
    setHidden(this.skillBadge, !(p.skillPoints > 0));
    if (p.skillPoints > 0) once(this.skillBadge, p.skillPoints, () => t('hud.skillPoints', { n: p.skillPoints }));

    // ── 우상단
    const n = p.hold.length;
    once(this.hold, n, () => t('hud.hold', { n, cap: HOLD.capacity }));
    setClass(this.hold, 'is-full', n >= HOLD.capacity);
    const spotId = fishing ? s.player.spotId : null;
    once(this.place, spotId || s.scene, () => (spotId ? t('hud.placeSpot', { stage: t('stage.' + s.scene), spot: t('spot.' + spotId) }) : t('stage.' + s.scene)));

    // ── 채비 요약
    setHidden(this.rig, !fishing || !rs);
    if (fishing && rs) this._rigSummary(s, rs);

    // ── 캐스팅 게이지
    const charging = fishing && rig.phase === 'charging';
    setHidden(this.cast, !charging);
    if (charging) {
      const from = Math.max(0, Math.min(1, rig.perfectFrom));
      setStyle(this.castPerfect, 'left', (from * 100).toFixed(1) + '%');
      setStyle(this.castPerfect, 'width', ((1 - from) * 100).toFixed(1) + '%');
      const pw = Math.max(0, Math.min(1, rig.power));
      setStyle(this.castFill, 'width', (pw * 100).toFixed(1) + '%');
      setStyle(this.castMark, 'left', (pw * 100).toFixed(1) + '%');
      setClass(this.castBar, 'is-perfect', pw >= from);
      if (rig.aimPreview) numText(this.castText, rig.aimPreview.distM, 1, 'hud.castDist');
      else setText(this.castText, '');
    }

    // ── 파이팅
    const inFight = fishing && !!fight && (rig.phase === 'fighting' || rig.phase === 'landing');
    setHidden(this.fight, !inFight);
    const netOn = inFight && rig.phase === 'fighting' && !!fight.canNet;
    setHidden(this.net, !netOn);
    if (inFight) this._fight(s, fight, rs);

    // ── 안내
    this._prompts(s, fishing, netOn);
  }

  /** @param {any} s @param {any} rs */
  _rigSummary(s, rs) {
    const rig = s.rig;
    const p = s.profile;
    const set = rig.set;
    const cfg = p.sets[set];
    once(this.rigSet, set, () => t('set.' + set));
    once(this.rigRod, cfg.rod, () => t('gear.' + cfg.rod));
    numText(this.rigLine, rs.lineKg, 1, 'hud.rigLine');
    const inWater = rig.phase === 'waiting' || rig.phase === 'bite' || rig.phase === 'retrieving' || rig.phase === 'fighting';
    const out = rig.phase === 'fighting' && s.fight ? s.fight.dist : rig.dist;
    numText(this.rigLeft, cfg.lineM, 0, 'hud.rigLeft');
    setClass(this.rigLeft, 'is-warn', inWater && cfg.lineM - out < CAST.driftReserveM);
    const bait = cfg.bait;
    once(this.rigBait, BAIT_IDS.indexOf(bait) * 1e7 + (p.baits[bait] || 0), () => t('hud.rigBait', { name: t('bait.' + bait), n: fmt(p.baits[bait] || 0) }));
    setClass(this.rigBait, 'is-warn', !(p.baits[bait] > 0));
    setHidden(this.rigDepth, set !== 'float');
    if (set === 'float') numText(this.rigDepth, rig.floatDepth, 2, 'hud.rigDepth');
    const dk = /** @type {any} */ (this.rigDrag);
    const dragKey = rig.dragNotch * 1000 + rig.dragNotches;
    if (dk._dk !== dragKey) {
      dk._dk = dragKey;
      setText(this.rigDrag, t('hud.rigDrag', { n: rig.dragNotch, max: rig.dragNotches, kg: fmt(rig.dragKg, 2) }));
    }
    setHidden(this.rigBail, !rig.bailOpen);
    const showLayer = inWater || rig.phase === 'bite';
    setHidden(this.rigLayer, !showLayer);
    if (showLayer) once(this.rigLayer, LAYER_IDS.indexOf(rig.layer) * 1e6 + Math.round(rig.baitDepth * 10), () => t('hud.rigLayer', { layer: t('layer.' + rig.layer), m: fmt(rig.baitDepth, 1) }));
  }

  /** @param {any} s @param {any} f @param {any} rs */
  _fight(s, f, rs) {
    const ratio = Number.isFinite(f.limitRatio) ? f.limitRatio : 0;
    const shown = Math.max(0, Math.min(GAUGE_SCALE_MAX, ratio));
    setStyle(this.tensionFill, 'width', (shown * 100).toFixed(1) + '%');
    const level = ratio >= TENSION_DANGER ? 'is-danger' : ratio >= TENSION_WARN ? 'is-warn' : 'is-ok';
    setClass(this.tension, 'is-ok', level === 'is-ok');
    setClass(this.tension, 'is-warn', level === 'is-warn');
    setClass(this.tension, 'is-danger', level === 'is-danger');
    setClass(this.tension, 'is-blink', level === 'is-danger' || !!f.lineDanger);
    numText(this.tensionPct, ratio * 100, 0, 'hud.pct');
    const byRod = f.limitBy === 'rod';
    setIcon(this.limitIco, byRod ? 'rod' : 'line');
    setClass(this.limitIco, 'is-rod', byRod);
    numText(this.limitText, f.limitKg, 1, byRod ? 'hud.limitRod' : 'hud.limitLine', { t: fmt(f.tension, 1) });

    const rig = s.rig;
    const maxDrag = rs && rs.reelMaxDragKg > 0 ? rs.reelMaxDragKg : Math.max(1e-6, rig.dragNotches * (rs ? rs.dragNotchKg : 0.25));
    setStyle(this.dragFill, 'width', (Math.max(0, Math.min(1, rig.dragKg / maxDrag)) * 100).toFixed(1) + '%');
    const lineAt = f.lineEffKg / maxDrag;
    setStyle(this.dragLineTick, 'left', (Math.max(0, Math.min(1, lineAt)) * 100).toFixed(1) + '%');
    setClass(this.dragLineTick, 'is-over', lineAt > 1);
    const rodKg = rs ? rs.rodMaxLoadKg : 0;
    const rodAt = rodKg / maxDrag;
    setHidden(this.dragRodTick, !(rodKg > 0));
    setStyle(this.dragRodTick, 'left', (Math.max(0, Math.min(1, rodAt)) * 100).toFixed(1) + '%');
    setClass(this.dragRodTick, 'is-over', rodAt > 1);
    setClass(this.drag, 'is-slip', !!f.slipping);
    const dk = /** @type {any} */ (this.dragText);
    const dragKey = rig.dragNotch * 1000 + rig.dragNotches;
    if (dk._dk !== dragKey) {
      dk._dk = dragKey;
      setText(this.dragText, t('hud.drag', { kg: fmt(rig.dragKg, 2), n: rig.dragNotch, max: rig.dragNotches }));
    }

    numText(this.fDist, f.dist, 1, 'hud.dist');
    numText(this.fLeft, f.spoolLeftM, 0, 'hud.left');
    setClass(this.fLeft, 'is-warn', f.spoolLeftM < LINE_LOW_M);

    const tg = f.telegraph;
    setHidden(this.tele, !tg);
    if (tg) {
      setIcon(this.teleIco, tg.kind);
      once(this.teleText, tg.kind, () => t('hud.tele.' + tg.kind));
    }
    setHidden(this.wSnag, !f.inSnag);
    setHidden(this.wCover, !(f.inCover >= COVER_SHOW));
    setHidden(this.wRod, !f.rodStress);
    setHidden(this.wSlip, !f.slipping);
    setHidden(this.wBail, !rig.bailOpen);
    const abr = f.abrasion > ABRASION_SHOW;
    setHidden(this.wAbr, !abr);
    if (abr) numText(this.wAbr, f.abrasion * 100, 0, 'hud.abrasion');
    setHidden(this.stamina, !f.showStamina);
    if (f.showStamina) setStyle(this.staminaFill, 'width', (Math.max(0, Math.min(1, f.stamina)) * 100).toFixed(1) + '%');
  }

  /** @param {any} s @param {boolean} fishing @param {boolean} netOn */
  _prompts(s, fishing, netOn) {
    let key = '';
    /** @type {Object} */
    let params = {};
    const rig = s.rig;
    const early = s.profile.stats.casts < PROMPT_CASTS;
    if (!fishing) {
      const nb = s.player.nearby;
      if (nb) {
        key = 'prompt.' + nb.kind;
        if (nb.kind === 'spot') params = { name: t('spot.' + nb.id) };
      }
    } else if (!netOn) {
      switch (rig.phase) {
        case 'ready':
          if (!rig.canCast && rig.castBlock) key = 'reason.' + rig.castBlock;
          else if (early) key = 'prompt.cast';
          break;
        case 'charging': key = 'prompt.release'; break;
        case 'waiting': if (early) key = rig.set === 'float' ? 'prompt.waitFloat' : 'prompt.waitBottom'; break;
        case 'retrieving': key = 'prompt.retrieving'; break;
        case 'fighting': if (early) key = 'prompt.fight'; break;
        case 'landing': key = 'prompt.landing'; break;
        default: break;
      }
    }
    const pk = /** @type {any} */ (this.prompt);
    const sig = key + '|' + (params.name || '');
    if (pk._sig !== sig) {
      pk._sig = sig;
      setText(this.prompt, key ? t(key, params) : '');
    }
    setHidden(this.prompt, !key);
    const lp = this._pointer;
    let look = '';
    if (lp.known && !lp.locked) look = lp.available ? 'prompt.clickToLook' : 'prompt.dragLook';
    setHidden(this.look, !look);
    if (look) once(this.look, look, () => t(look));
  }

  dispose() { this.root.remove(); }
}

/**
 * @param {HTMLElement} root @param {{sim:Object, ui:Object}} deps
 * @returns {Hud}
 */
export function createHud(root, deps) {
  return new Hud(root, deps);
}
