// OWNER: P10 — 계약 §10.3 (P10 내부 파일 — UIRoot 만 import 한다)
// HUD(HTML/CSS): 생명 · 자원 구슬 · 포션/두루마리 · 스킬 바(쿨다운 부채 = skillReady.cooldownTotal) · 경험치 바 · 스킬 포인트 · 버프/상태 아이콘 ·
// 대상 프레임(이름 · 등급 · 속성 · 생명) · 균열 게이지 · 생명 3 · 수호자 바 · 귀환 시전 바 · 복귀 안내 · 배지.
// 매 프레임 상태에서 다시 그린다(이벤트를 놓쳐도 맞다) — DOM 쓰기는 값이 바뀐 때만(setText · setVar 캐시).

import { LEVEL_CAP, SKILL_BAR } from '../core/constants.js';
import { ticks } from '../core/time.js';
import { POTION } from '../data/combat.js';
import { CLASSES_BY_ID, SKILL_NODES_BY_ID } from '../data/index.js';
import { BASIC_SKILLS } from '../data/skills.js';
import { skillReady } from '../sim/player/skills.js';
import { pointsFree, xpReq } from '../sim/progression/progress.js';
import { fmtCd, fmtInt, skillGlyph } from './format.js';
import { has, t, tName } from './i18n.js';

/** 몸 흔들림 · 깜빡임 길이(초) */
const HIT_SHAKE_SEC = 0.2;
const BLINK_SEC = 0.45;
/** 버프 · 상태 아이콘 칸 수 */
const ICON_SLOTS = 6;
/** 스킬 포인트 · 경험치를 다시 계산하는 간격(프레임) */
const SLOW_EVERY = 10;
const own = Object.prototype.hasOwnProperty;

/** @param {HTMLElement} parent @param {string} cls @param {string} [tag] */
function add(parent, cls, tag = 'div') {
  const e = parent.appendChild(document.createElement(tag));
  if (cls) e.className = cls;
  return e;
}
/** 값이 바뀐 때만 문면을 쓴다 @param {any} node @param {string} s */
function setText(node, s) {
  if (node.__t !== s) {
    node.__t = s;
    node.textContent = s;
  }
}
/** @param {any} node @param {boolean} hidden */
function setHidden(node, hidden) {
  if (node.__h !== hidden) {
    node.__h = hidden;
    node.hidden = hidden;
  }
}
/** CSS 변수(값 반올림 캐시) @param {any} node @param {string} name @param {number} v @param {number} [q] */
function setVar(node, name, v, q = 1000) {
  const r = Math.round((Number.isFinite(v) ? v : 0) * q) / q;
  const k = '__v' + name;
  if (node[k] !== r) {
    node[k] = r;
    node.style.setProperty(name, String(r));
  }
}
/** @param {any} node @param {string} cls */
function setClass(node, cls) {
  if (node.__c !== cls) {
    node.__c = cls;
    node.className = cls;
  }
}
/** @param {number} v */
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** 몬스터 이름 문면 @param {any} mon */
export function monName(mon) {
  if (!mon) return '';
  return mon.name && mon.name.length ? tName(mon.name) : t('mon.' + mon.typeId);
}
/** 스킬 이름 문면(노드 또는 기본 공격) @param {string} id */
export function skillName(id) {
  if (own.call(BASIC_SKILLS, id)) return t('skill.' + id + '.name');
  return t('node.' + id + '.name');
}

/**
 * @param {{root:HTMLElement, sim:any, t?:Function}} deps
 */
export function createHud({ root, sim }) {
  const hud = add(root, 'hud');
  hud.hidden = true;

  // ── 왼쪽 위 배지 ──
  const tl = add(hud, 'hud-tl');
  const devBadge = add(tl, 'badge badge-dev');
  devBadge.textContent = t('hud.devBadge');
  const botBadge = add(tl, 'badge badge-bot');
  botBadge.textContent = t('hud.botBadge');
  setHidden(devBadge, true);
  setHidden(botBadge, true);

  // ── 왼쪽 — 계측 HUD 자리(P12) ──
  const left = add(hud, 'hud-left');

  // ── 위 가운데 — 대상 프레임 · 게이지 · 생명 · 수호자 ──
  const top = add(hud, 'hud-top');
  const target = add(top, 'target');
  const tName_ = add(target, 'target-name');
  const tRank = add(target, 'target-rank');
  const tAff = add(target, 'target-affixes');
  const tBar = add(target, 'target-bar');
  const tFill = add(tBar, 'target-fill');
  const tHp = add(tBar, 'target-hp');
  const riftRow = add(top, 'rift-row');
  const gauge = add(riftRow, 'gauge');
  const gFill = add(gauge, 'gauge-fill');
  const gText = add(gauge, 'gauge-text');
  const lives = add(riftRow, 'lives');
  lives.title = t('hud.lives');
  /** @type {HTMLElement[]} */
  const lifeIcons = [add(lives, 'life-icon'), add(lives, 'life-icon'), add(lives, 'life-icon')];
  const guard = add(top, 'guardian');
  const gdName = add(guard, 'guardian-name');
  const gdAff = add(guard, 'guardian-affixes');
  const gdBar = add(guard, 'guardian-bar');
  const gdFill = add(gdBar, 'guardian-fill');
  const gdHp = add(gdBar, 'guardian-hp');

  // ── 오른쪽 위 — 미니맵 자리(minimap.js 가 붙인다) ──
  const mapHost = add(hud, 'hud-minimap');

  // ── 아래 가운데 ──
  const bottom = add(hud, 'hud-bottom ui-block');
  const above = add(bottom, 'hud-above');
  const icons = add(above, 'hud-icons');
  /** @type {Array<{el:HTMLElement, glyph:HTMLElement, sec:HTMLElement}>} */
  const iconSlots = [];
  for (let i = 0; i < ICON_SLOTS; i++) {
    const e = add(icons, 'hud-icon');
    iconSlots.push({ el: e, glyph: add(e, 'hud-icon-glyph'), sec: add(e, 'hud-icon-sec') });
    setHidden(e, true);
  }
  const mid = add(above, 'hud-mid');
  const cast = add(mid, 'cast');
  const castFill = add(cast, 'cast-fill');
  const castText = add(cast, 'cast-text');
  castText.textContent = t('hud.recall');
  const ret = add(mid, 'return-prompt');
  ret.textContent = t('hud.returnPrompt');
  const pts = add(above, 'hud-points');
  setHidden(cast, true);
  setHidden(ret, true);
  setHidden(pts, true);

  const cluster = add(bottom, 'cluster');
  // 생명 구슬
  const lifeWrap = add(cluster, 'orb-wrap orb-life-wrap');
  const lifeOrb = add(lifeWrap, 'orb orb-life');
  const lifeFill = add(lifeOrb, 'orb-fill');
  const shieldFill = add(lifeOrb, 'orb-shield');
  add(lifeOrb, 'orb-gloss');
  const lifeText = add(lifeOrb, 'orb-text');
  lifeOrb.title = t('hud.life');
  const potion = add(lifeWrap, 'consum consum-potion');
  const potionCd = add(potion, 'consum-cd');
  const potionKey = add(potion, 'consum-key');
  potionKey.textContent = 'Q';
  const potionN = add(potion, 'consum-n');
  potion.title = t('hud.potion');
  // 스킬 바 6칸
  const barEl = add(cluster, 'skillbar');
  /** @type {Array<{el:HTMLElement, icon:HTMLElement, cd:HTMLElement, cdText:HTMLElement, key:HTMLElement, id:string|null}>} */
  const slots = [];
  const keyLabels = [t('hud.key.lmb'), t('hud.key.rmb'), '1', '2', '3', '4'];
  for (let i = 0; i < SKILL_BAR + 1; i++) {
    const e = add(barEl, 'slot is-empty');
    const icon = add(e, 'slot-icon');
    const cd = add(e, 'slot-cd');
    const cdText = add(e, 'slot-cdtext');
    const key = add(e, 'slot-key');
    key.textContent = keyLabels[i];
    slots.push({ el: e, icon, cd, cdText, key, id: null });
  }
  // 자원 구슬
  const resWrap = add(cluster, 'orb-wrap orb-res-wrap');
  const resOrb = add(resWrap, 'orb orb-res res-rage');
  const resFill = add(resOrb, 'orb-fill');
  add(resOrb, 'orb-gloss');
  const resText = add(resOrb, 'orb-text');
  const scroll = add(resWrap, 'consum consum-scroll');
  const scrollKey = add(scroll, 'consum-key');
  scrollKey.textContent = 'T';
  const scrollN = add(scroll, 'consum-n');
  scroll.title = t('hud.scroll');
  // 경험치 바
  const xp = add(bottom, 'xpbar');
  const xpFill = add(xp, 'xp-fill');
  const xpLevel = add(xp, 'xp-level');
  const xpText = add(xp, 'xp-text');
  xp.title = t('hud.xp');

  let lifeShake = 0;
  let resBlink = 0;
  let frame = 0;
  let lastLife = NaN, lastLifeMax = NaN, lastRes = NaN, lastResMax = NaN;
  let lastPts = -1;
  let lastXp = NaN, lastLevel = -1;
  let lastTargetId = -1;
  let lastTargetAff = -1;
  let lastGuardId = -1;
  let lastGuardAff = -1;
  /** @type {any} */
  let targetMon = null;
  /** @type {any} */
  let guardMon = null;
  let resKind = '';

  /** 균열 몬스터 찾기(지난 프레임의 것을 먼저 본다 — 선형 탐색 최소화) @param {any} rift @param {number} id @param {any} prev */
  function findMon(rift, id, prev) {
    if (prev && prev.id === id) return prev;
    const mons = rift.mons;
    for (let i = 0; i < mons.length; i++) if (mons[i].id === id) return mons[i];
    return null;
  }

  /** 속성 이름 칩 @param {HTMLElement} host @param {string[]} affixes */
  function drawAffixes(host, affixes) {
    host.textContent = '';
    for (const a of affixes) {
      const c = add(host, 'affix-chip', 'span');
      c.textContent = t('affix.' + a + '.name');
    }
  }

  /** @param {any} state @param {any} stats */
  function drawSkills(state, stats) {
    const ch = state.char;
    const basic = CLASSES_BY_ID[ch.cls]?.basic ?? null;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const id = i === 0 ? basic : ch.skills?.bar?.[i - 1] ?? null;
      if (id !== s.id) {
        s.id = id;
        if (!id) {
          setClass(s.el, 'slot is-empty');
          setText(s.icon, '');
          s.el.title = '';
        } else {
          const node = SKILL_NODES_BY_ID[id];
          const br = node ? `br-${node.cls}-${node.branch}` : 'br-basic';
          setClass(s.el, 'slot ' + br);
          const nm = skillName(id);
          setText(s.icon, has('glyph.' + id) ? t('glyph.' + id) : skillGlyph(nm));   // 규칙대로 줄이면 다른 낱말로 읽히는 것은 예외(strings glyph.<id>)
          s.el.title = nm;
        }
      }
      if (!id) {
        setVar(s.cd, '--cd', 0);
        setText(s.cdText, '');
        continue;
      }
      const r = skillReady(state, stats, id);
      const frac = r.cooldownTotal > 0 && r.cooldownLeft > 0 ? clamp01(r.cooldownLeft / r.cooldownTotal) : 0;
      setVar(s.cd, '--cd', frac);
      const cdTxt = r.cooldownLeft >= 0.05 && r.cooldownTotal >= 1 ? fmtCd(r.cooldownLeft) : '';
      setText(s.cdText, cdTxt);
      s.el.classList.toggle('is-cd', cdTxt !== '');   // 쿨다운 숫자가 아이콘 글자 위에 겹쳐 둘 다 안 읽혔다 — 숫자 동안 글자를 흐리게(화면 패스)
      s.el.classList.toggle('is-poor', !r.canAfford);
    }
  }

  /** @param {any} state */
  function drawIcons(state, stats) {
    const p = state.player;
    const tick = state.tick;
    let n = 0;
    const put = (glyph, name, sec, cls) => {
      if (n >= ICON_SLOTS) return;
      const s = iconSlots[n++];
      setHidden(s.el, false);
      setClass(s.el, 'hud-icon ' + cls);
      setText(s.glyph, glyph);
      setText(s.sec, sec > 0 ? fmtCd(sec) : '');
      if (s.el.title !== name) s.el.title = name;
    };
    const buffs = p.buffs || [];
    for (let i = 0; i < buffs.length; i++) {
      const b = buffs[i];
      if (!(b.until > tick)) continue;
      const nm = skillName(b.id);
      put(nm.charAt(0), nm, (b.until - tick) / 30, 'is-buff');
    }
    if (p.shield > 0 && !buffs.some(b => b.id === 'energyShield')) {
      const nm = skillName('energyShield');
      put(nm.charAt(0), nm, 0, 'is-buff');
    }
    const st = p.st;
    if (st && st.slowUntil > tick && st.slowPct > 0) {
      const nm = t('hud.status.slow');
      put(nm.charAt(0), nm, (st.slowUntil - tick) / 30, 'is-debuff');
    }
    if (st && st.rootUntil > tick) {
      const nm = t('hud.status.root');
      put(nm.charAt(0), nm, (st.rootUntil - tick) / 30, 'is-debuff');
    }
    if (stats && stats.broken && stats.broken.length) put('!', t('hud.broken'), 0, 'is-warn');
    for (let i = n; i < ICON_SLOTS; i++) setHidden(iconSlots[i].el, true);
  }

  /** @param {any} state */
  function drawTarget(state) {
    const p = state.player;
    const rift = state.rift;
    let mon = null;
    /** @type {any} */
    let obj = null;
    if (rift && state.scene === 'rift') {
      const hv = p.hover;
      if (hv && hv.kind === 'monster') mon = findMon(rift, hv.id, targetMon);
      if ((!mon || mon.dead) && p.targetId !== null && p.targetId !== undefined) mon = findMon(rift, p.targetId, targetMon);
      if (mon && (mon.dead || mon.gone)) mon = null;
      if (mon && mon.id === rift.guardianId) mon = null;      // 수호자는 위의 대형 체력 바가 보인다(겹쳐 두 번 그리지 않는다)
      if (!mon && hv && hv.kind === 'object' && typeof hv.id === 'string') obj = rift.portals?.find(pt => pt.id === hv.id) ?? null;
    } else if (state.scene === 'town') {
      // 마을: 마우스 아래 NPC · 시설의 이름만(대장장이 · 잡화상 · 도박꾼 · 신비술사 · 보관함 · 균열석 · 마을 포털 — 리뷰 수정 · 장식은 이름이 없다)
      const hv = p.hover;
      if (hv && hv.kind === 'object' && typeof hv.id === 'string' && has('npc.' + hv.id)) obj = { townId: hv.id };
    }
    targetMon = mon;
    if (!mon && !obj) {
      setHidden(target, true);
      lastTargetId = -1;
      return;
    }
    setHidden(target, false);
    if (obj) {
      lastTargetId = -1;
      setClass(target, 'target is-object');
      setText(tName_, obj.townId ? t('npc.' + obj.townId) : t(obj.kind === 'exit' ? 'hud.portal.exit' : 'hud.portal.recall'));
      setText(tRank, '');
      if (tAff.childElementCount) tAff.textContent = '';
      setHidden(tBar, true);
      return;
    }
    setHidden(tBar, false);
    if (mon.id !== lastTargetId || mon.affixes.length !== lastTargetAff) {
      lastTargetId = mon.id;
      lastTargetAff = mon.affixes.length;
      setClass(target, 'target rank-' + mon.rank);
      setText(tName_, monName(mon));
      setText(tRank, mon.rank === 'normal' ? '' : t('rank.' + mon.rank));
      drawAffixes(tAff, mon.affixes);
    }
    const f = mon.hpMax > 0 ? clamp01(mon.hp / mon.hpMax) : 0;
    setVar(tFill, '--f', f);
    setText(tHp, fmtInt(Math.max(0, mon.hp)) + ' / ' + fmtInt(mon.hpMax));
  }

  /** @param {any} state */
  function drawRift(state) {
    const rift = state.rift;
    const inRift = !!rift && state.scene === 'rift';
    setHidden(riftRow, !inRift);
    if (!inRift) {
      setHidden(guard, true);
      guardMon = null;
      lastGuardId = -1;
      return;
    }
    const g = clamp01(rift.gauge / 100);
    setVar(gFill, '--f', g);
    let label;
    if (rift.phase === 'complete') label = t('hud.gaugeDone');
    else if (rift.phase === 'collapsed') label = t('hud.collapsed');
    else if (rift.phase === 'guardian') label = t('hud.guardian');
    else label = t('hud.gauge') + ' ' + Math.floor(rift.gauge) + '%';
    setText(gText, label);
    setClass(riftRow, 'rift-row phase-' + rift.phase);
    const n = Math.max(0, rift.lives | 0);
    for (let i = 0; i < 3; i++) lifeIcons[i].classList.toggle('is-on', i < n);
    // 수호자
    let gm = null;
    if (rift.guardianId !== null && rift.guardianId !== undefined) gm = findMon(rift, rift.guardianId, guardMon);
    if (gm && (gm.dead || gm.gone || !(gm.hp > 0))) gm = null;
    guardMon = gm;
    setHidden(guard, !gm);
    if (!gm) { lastGuardId = -1; return; }
    if (gm.id !== lastGuardId || gm.affixes.length !== lastGuardAff) {
      lastGuardId = gm.id;
      lastGuardAff = gm.affixes.length;
      setText(gdName, monName(gm));
      drawAffixes(gdAff, gm.affixes);
    }
    const f = gm.hpMax > 0 ? clamp01(gm.hp / gm.hpMax) : 0;
    setVar(gdFill, '--f', f);
    setText(gdHp, Math.ceil(f * 100) + '%');
  }

  const api = {
    el: hud,
    /** 계측 HUD(P12)를 붙일 자리 */
    leftHost: left,
    /** 미니맵을 붙일 자리 */
    mapHost,
    /** PLAYER_HIT — 구슬 흔들림 */
    hit() { lifeShake = HIT_SHAKE_SEC; },
    /** SKILL_FAIL resource — 자원 구슬 깜빡(섬광 아님) */
    blinkResource() { resBlink = BLINK_SEC; },
    /** 스킬 바 칸 다시 그리기(캐릭터가 바뀌었다) */
    reset() {
      for (const s of slots) s.id = '\u0000';
      lastTargetId = -1;
      lastGuardId = -1;
      targetMon = null;
      guardMon = null;
      lastLevel = -1;
      lastPts = -1;
      resKind = '';
    },
    /**
     * @param {any} state @param {number} dt 실제 초
     * @param {{visible:boolean, bot:boolean}} view
     */
    update(state, dt, view) {
      const ch = state.char;
      const visible = !!(view.visible && ch);
      setHidden(hud, !visible);
      setHidden(botBadge, !view.bot);
      setHidden(devBadge, !state.flags?.devSession);
      if (!visible) return;
      frame++;
      const p = state.player;
      const stats = sim?.getStats?.() ?? null;
      setClass(hud, 'hud scene-' + state.scene);

      // 생명 구슬
      const lf = p.lifeMax > 0 ? clamp01(p.life / p.lifeMax) : 0;
      setVar(lifeFill, '--f', lf);
      setVar(shieldFill, '--f', p.lifeMax > 0 ? clamp01(p.shield / p.lifeMax) : 0);
      // 생명은 올림(0.2 가 0 으로 보이지 않게) · 최대도 같은 올림 — 「402 / 401」이 나오지 않는다
      const lm = Math.ceil(Math.max(0, p.lifeMax) - 1e-6);
      const lr = Math.min(lm, Math.ceil(Math.max(0, p.life) - 1e-6));
      if (lr !== lastLife || lm !== lastLifeMax) {
        lastLife = lr;
        lastLifeMax = lm;
        setText(lifeText, fmtInt(lr) + ' / ' + fmtInt(lm));
      }
      lifeOrb.classList.toggle('is-low', !!p.lowLife && !p.dead);
      if (lifeShake > 0) lifeShake -= dt;
      lifeOrb.classList.toggle('is-hit', lifeShake > 0);
      // 포션
      setText(potionN, String(ch.potions ?? 0));
      const cdT = ticks(POTION.cd);
      const pl = p.potionReadyAt - state.tick;
      setVar(potionCd, '--cd', pl > 0 && cdT > 0 ? clamp01(pl / cdT) : 0);
      potion.classList.toggle('is-empty', !(ch.potions > 0));
      // 자원 구슬
      const kind = CLASSES_BY_ID[ch.cls]?.resource ?? 'mana';
      if (kind !== resKind) {
        resKind = kind;
        setClass(resOrb, 'orb orb-res res-' + kind);
        resOrb.title = t('res.' + kind);
      }
      setVar(resFill, '--f', p.resourceMax > 0 ? clamp01(p.resource / p.resourceMax) : 0);
      const rm = Math.floor(Math.max(0, p.resourceMax) + 1e-6);
      const rr = Math.min(rm, Math.floor(Math.max(0, p.resource) + 1e-6));
      if (rr !== lastRes || rm !== lastResMax) {
        lastRes = rr;
        lastResMax = rm;
        setText(resText, fmtInt(rr) + ' / ' + fmtInt(rm));
      }
      if (resBlink > 0) resBlink -= dt;
      resOrb.classList.toggle('is-blink', resBlink > 0);
      // 최종 게이트: 완료된 균열(요약 · 나가는 포털)에서 T 는 두루마리가 아니라 무료 · 즉시 「마을로」다(controller.handleEdges 와 같은 조건)
      const freeExit = state.scene === 'rift' && state.rift?.phase === 'complete' && !!state.rift.summary && !p.dead;
      setText(scrollN, freeExit ? t('hud.scroll.exit') : String(ch.scrolls ?? 0));
      scroll.classList.toggle('is-empty', !freeExit && !(ch.scrolls > 0));
      scroll.classList.toggle('is-free', freeExit);
      if (scroll.title !== (freeExit ? t('hud.scroll.exitTip') : t('hud.scroll'))) scroll.title = freeExit ? t('hud.scroll.exitTip') : t('hud.scroll');

      drawSkills(state, stats);
      drawIcons(state, stats);

      // 경험치 · 스킬 포인트(느리게)
      if (ch.level !== lastLevel || ch.xp !== lastXp || frame % SLOW_EVERY === 0) {
        lastLevel = ch.level;
        lastXp = ch.xp;
        if (ch.level >= LEVEL_CAP) {
          setVar(xpFill, '--f', 1);
          setText(xpLevel, t('hud.level', { n: ch.level }));
          setText(xpText, t('hud.levelMax'));
        } else {
          const req = xpReq(ch.level);
          setVar(xpFill, '--f', Number.isFinite(req) && req > 0 ? clamp01(ch.xp / req) : 0);
          setText(xpLevel, t('hud.level', { n: ch.level }));
          setText(xpText, fmtInt(ch.xp) + ' / ' + fmtInt(req));
        }
        const pf = pointsFree(ch);
        if (pf !== lastPts) {
          lastPts = pf;
          setHidden(pts, !(pf > 0));
          if (pf > 0) setText(pts, t('hud.points', { n: pf }));
        }
      }

      // 귀환 시전 · 복귀 안내
      const rc = p.recall;
      if (rc && rc.end > rc.start && !p.dead) {
        setHidden(cast, false);
        setVar(castFill, '--f', clamp01((state.tick - rc.start) / (rc.end - rc.start)));
      } else setHidden(cast, true);
      setHidden(ret, !(state.scene === 'town' && state.town?.returnPrompt && !p.dead));

      drawTarget(state);
      drawRift(state);
    },
    dispose() { hud.remove(); },
  };
  return api;
}
