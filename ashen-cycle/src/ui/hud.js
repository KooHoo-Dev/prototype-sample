// OWNER: P8 — 계약 §10.2 HUD
// sim 상태를 읽기만 한다. 값이 바뀔 때만 DOM을 건드린다(프레임마다 도는 경로 — 객체를 만들지 않는다).
// HUD와 그 컨테이너는 pointer-events: none 이다(§10.5 — 캔버스 클릭을 가로채지 않는다).
import { EV } from '../core/events.js';
import { KEYBINDS } from '../data/keybinds.js';
import { getBossDef } from '../data/bosses/index.js';
import { el, add, clear, num, clamp01, fmtInt, keyLabel, keysLabel } from './dom.js';
import { t } from './i18n.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').PanelId} PanelId */

// ── 연출 상수 ──
const GHOST_DELAY = 0.5;          // 피해 뒤 잔상이 줄기 시작할 때까지(초)
const GHOST_RATE = 0.9;           // 잔상이 줄어드는 속도(바 길이/초)
const COMBO_WINDOW = 2.0;         // 누적 피해 수치를 묶는 창(초)
const BOSS_FILL_DELAY = 0.25;     // 보스 바가 차오르기 전 뜸(초)
const BOSS_FILL_DUR = 1.1;        // 보스 바가 차오르는 시간(초)
const ROLL_MIN = 0.45;            // 잔불 카운터가 굴러 올라가는 시간(초)
const ROLL_MAX = 1.4;
const ROLL_PER_EMBER = 1 / 1500;
const ROLL_DOWN = 0.2;            // 쓸 때는 빨리 내려간다
const GAIN_HOLD = 2.2;            // 「+N」 표시 시간(초)
const LOW_HP = 0.3;               // 이 비율 아래면 HP 바가 맥동한다
const DUMMY_SHOW = 3;             // 허수아비 피해 표시 유지(초)
const HINT_FIGHT_TIME = 10;       // 보스전 조작 힌트 표시 시간(초)
const HINT_MAX_ATTEMPTS = 2;      // 이 도전 횟수까지만 보스전에서 힌트를 보인다
const SAVED_HOLD = 1.4;
const DRAG_HINT_HOLD = 6;         // 포인터 락을 얻지 못하는 환경(드래그 모드)의 안내를 보여 주는 시간(초) — 그 뒤로는 화면을 가리지 않는다
const BANNER_DUR = { died: 3.4, victory: 3.8, cycle: 3.2 };
// 바 길이(em) = base + (최대치 − ref) × per, 상한 max — 능력치가 오르면 바가 길어진다
const HP_BAR = { base: 16, ref: 100, per: 0.05, max: 36 };
const ST_BAR = { base: 14, ref: 100, per: 0.08, max: 26 };

/** @param {{base:number, ref:number, per:number, max:number}} spec @param {number} maxValue */
function barWidth(spec, maxValue) {
  return Math.round(Math.min(spec.max, Math.max(spec.base * 0.5, spec.base + (maxValue - spec.ref) * spec.per)) * 10) / 10;
}

/** 한 번 돌고 끝나는 연출 클래스 — 끝나면 뗀다(남아 있으면 같은 요소의 다른 애니메이션을 가린다). */
const TRANSIENT = ['ac-flash', 'ac-heal', 'ac-shake', 'ac-bump', 'ac-gained', 'ac-enter'];

/** 애니메이션 클래스를 처음부터 다시 건다. @param {HTMLElement} node @param {string} cls */
function retrigger(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/** 채움 + 지연 감소 잔상을 가진 바. */
class Bar {
  /** @param {string} cls */
  constructor(cls) {
    this.el = el('div', `ac-bar ${cls}`);
    this.ghost = el('div', 'ac-bar-ghost');
    this.fill = el('div', 'ac-bar-fill');
    add(this.el, this.ghost, this.fill);
    this._g = 0;
    this._prev = 0;
    this._delay = 0;
    this._wroteF = -1;
    this._wroteG = -1;
    this._fresh = true;
  }

  /** 다음 set에서 잔상 없이 값을 바로 잡는다(모드 전환 · 새 보스전). */
  reset() {
    this._fresh = true;
  }

  /** @param {number} f 0..1 @param {number} dt */
  set(f, dt) {
    f = clamp01(f);
    if (this._fresh) {
      this._fresh = false;
      this._g = f;
      this._delay = 0;
    } else if (f >= this._g) {
      this._g = f;
      this._delay = 0;
    } else {
      if (f < this._prev) this._delay = GHOST_DELAY; // 새 피해마다 뜸을 다시 들인다
      if (this._delay > 0) this._delay -= dt;
      else this._g = Math.max(f, this._g - GHOST_RATE * dt);
    }
    this._prev = f;
    const qf = Math.round(f * 1000);
    if (qf !== this._wroteF) {
      this._wroteF = qf;
      this.fill.style.transform = `scaleX(${qf / 1000})`;
    }
    const qg = Math.round(this._g * 1000);
    if (qg !== this._wroteG) {
      this._wroteG = qg;
      this.ghost.style.transform = `scaleX(${qg / 1000})`;
    }
  }
}

/** 굴러 올라가는 숫자. */
class Roller {
  /** @param {HTMLElement} node */
  constructor(node) {
    this.node = node;
    this._from = 0;
    this._to = 0;
    this._shown = 0;
    this._t = 0;
    this._dur = 0;
    this._wrote = NaN;
    this._fresh = true;
  }

  reset() {
    this._fresh = true;
  }

  /**
   * @param {number} target
   * @param {number} dt
   * @returns {number} 이번 호출에서 목표가 늘어난 양(없으면 0)
   */
  set(target, dt) {
    target = Math.round(num(target));
    let gained = 0;
    if (this._fresh) {
      this._fresh = false;
      this._from = this._to = this._shown = target;
    } else if (target !== this._to) {
      if (target > this._to) gained = target - this._to;
      const up = target > this._shown;
      this._from = this._shown;
      this._to = target;
      this._t = 0;
      this._dur = up ? Math.min(ROLL_MAX, ROLL_MIN + (target - this._shown) * ROLL_PER_EMBER) : ROLL_DOWN;
    }
    if (this._shown !== this._to) {
      this._t += dt;
      const k = this._dur > 0 ? Math.min(1, this._t / this._dur) : 1;
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      this._shown = k >= 1 ? this._to : this._from + (this._to - this._from) * e;
    }
    const iv = Math.round(this._shown);
    if (iv !== this._wrote) {
      this._wrote = iv;
      this.node.textContent = fmtInt(iv);
    }
    return gained;
  }
}

export class Hud {
  /**
   * @param {{parent:HTMLElement, bus:import('../core/events.js').EventBus}} deps
   */
  constructor(deps) {
    this.bus = deps.bus;
    this.el = el('div', 'ac-hud');
    this._visible = true;
    this._shown = true;
    this._snap = true;

    // ── 좌상단: HP · 스태미나 · 플라스크 ──
    this.vitals = el('div', 'ac-vitals');
    this.hp = new Bar('ac-bar-hp');
    this.hpNum = el('span', 'ac-bar-num');
    this.st = new Bar('ac-bar-st');
    this.stNum = el('span', 'ac-bar-num');
    this.flasks = el('div', 'ac-flasks');
    this.flaskPips = el('span', 'ac-flask-pips');
    this.flaskNum = el('span', 'ac-flask-num');
    add(this.flasks, this.flaskPips, this.flaskNum);
    add(this.vitals,
      add(el('div', 'ac-vital-row'), this.hp.el, this.hpNum),
      add(el('div', 'ac-vital-row'), this.st.el, this.stNum),
      this.flasks);

    // ── 우상단: 잔불 · 파편 ──
    this.wallet = el('div', 'ac-wallet');
    this.emberNum = el('span', 'ac-wallet-num');
    this.emberGain = el('span', 'ac-wallet-gain');
    this.shardNum = el('span', 'ac-wallet-num');
    this.emberRow = add(el('div', 'ac-wallet-row ac-ember'),
      this.emberGain, el('span', 'ac-wallet-label', t('hud.embers')), el('i', 'ac-ico ac-ico-ember'), this.emberNum);
    this.shardRow = add(el('div', 'ac-wallet-row ac-shard'),
      el('span', 'ac-wallet-label', t('hud.shards')), el('i', 'ac-ico ac-ico-shard'), this.shardNum);
    add(this.wallet, this.emberRow, this.shardRow);
    this.embers = new Roller(this.emberNum);
    this.shards = new Roller(this.shardNum);

    // ── 상단 중앙: 락 안내 ──
    this.lockHint = el('div', 'ac-lockhint', t('hud.clickToLock'));

    // ── 하단 중앙: 보스 ──
    this.boss = el('div', 'ac-boss');
    this.bossName = el('span', 'ac-boss-name');
    this.bossPhase = el('span', 'ac-boss-phase', t('hud.phase2'));
    this.bossLock = el('span', 'ac-boss-lock', t('hud.lockOn'));
    this.combo = el('span', 'ac-boss-combo');
    this.bossHp = new Bar('ac-bar-boss');
    this.bossTick = el('div', 'ac-bar-tick');
    add(this.bossHp.el, this.bossTick);
    this.bossPosture = new Bar('ac-bar-posture');
    this.bossGroggy = el('span', 'ac-boss-groggy', t('hud.groggy'));
    this.bossHpNum = el('span', 'ac-boss-hpnum');
    add(this.boss,
      add(el('div', 'ac-boss-head'), add(el('div', 'ac-boss-title'), this.bossName, this.bossPhase, this.bossLock), this.combo),
      this.bossHp.el,
      add(el('div', 'ac-boss-sub'), this.bossGroggy, this.bossPosture.el, this.bossHpNum));

    // ── 하단 중앙(마을): 허수아비 ──
    this.dummy = el('div', 'ac-dummy');
    this.dummyLast = el('span', 'ac-dummy-last');
    this.dummyTotal = el('span', 'ac-dummy-total');
    add(this.dummy, el('span', 'ac-dummy-label', t('hud.dummy')), this.dummyLast, this.dummyTotal);

    // ── 프롬프트 ──
    this.prompt = el('div', 'ac-prompt');
    this.exec = el('div', 'ac-exec');

    // ── 우하단: 조작 힌트 ──
    this.hints = el('div', 'ac-hints');
    this._buildHints();

    // ── 배너 · 저장 표시 ──
    this.banner = el('div', 'ac-banner');
    this.bannerMain = el('div', 'ac-banner-main');
    this.bannerSub = el('div', 'ac-banner-sub');
    add(this.banner, el('div', 'ac-banner-band'), this.bannerMain, this.bannerSub);
    this.saved = el('div', 'ac-saved', t('hud.saved'));

    add(this.el, this.vitals, this.wallet, this.lockHint, this.boss, this.dummy, this.prompt, this.exec,
      this.hints, this.banner, this.saved);
    this.el.addEventListener('animationend', (e) => e.target.classList.remove(...TRANSIENT));
    deps.parent.appendChild(this.el);

    // 캐시(바뀔 때만 DOM을 쓴다)
    this._c = {
      hpW: -1, stW: -1, hpInt: -1, hpMaxInt: -1, stInt: -1, lowHp: false, exhausted: false,
      flaskMax: -1, flaskNow: -1,
      boss: false, bossId: '', bossHp: -1, bossHpMax: -1, phase2: false, groggy: false, postureGuard: false,
      lockOn: false, tick: -1,
      dummy: false, dummyLast: -1, dummyTotal: -1,
      prompt: null, execKind: '',
      hints: false, lockHint: false, lockDrag: false, gain: false, combo: false, saved: false,
    };
    this._dragHintT = 0;
    /** @type {Object|null} 현재 보스전의 fight 객체(새 판이면 참조가 바뀐다) */
    this._fightRef = null;
    this._introT = 0;
    this._comboSum = 0;
    this._comboT = 0;
    this._comboDirty = false;
    this._gainSum = 0;
    this._gainT = 0;
    this._savedT = 0;
    /** @type {''|'died'|'victory'|'cycle'} */
    this._bannerKind = '';
    this._bannerT = 0;

    const on = (name, fn) => this.bus.on(name, fn);
    this._offs = [
      on(EV.HIT, (p) => this._onHit(p)),
      on(EV.PLAYER_DIED, () => this._showBanner('died')),
      on(EV.BOSS_DEFEATED, () => this._showBanner('victory')),
      on(EV.CYCLE_ADVANCED, () => this._showBanner('cycle')),
      on(EV.MODE_CHANGED, () => this._onModeChanged()),
      on(EV.BOSS_PHASE_CHANGED, () => retrigger(this.bossHp.el, 'ac-flash')),
      on(EV.PLAYER_STAMINA_OUT, () => retrigger(this.st.el, 'ac-flash')),
      on(EV.PLAYER_FLASK, (p) => this._onFlask(p)),
      on(EV.SAVED, () => { this._savedT = SAVED_HOLD; }),
    ];
  }

  /** @param {boolean} visible */
  setVisible(visible) {
    this._visible = !!visible;
  }

  /**
   * @param {GameState} state
   * @param {number} dt 렌더 프레임 간격(초)
   * @param {PanelId|null} panel 열린 패널
   * @param {boolean} pointerLocked
   * @param {boolean} [dragMode] 포인터 락을 얻지 못해 드래그로 시점을 돌리는 중인가
   */
  update(state, dt, panel, pointerLocked, dragMode = false) {
    const show = this._visible && panel !== 'title' && !!state && !!state.player;
    if (show !== this._shown) {
      this._shown = show;
      this.el.classList.toggle('ac-hidden', !show);
    }
    if (!show) {
      this._snap = true; // 다시 보일 때 바 · 카운터를 연출 없이 현재 값으로
      return;
    }
    if (this._snap) {
      this._snap = false;
      this.hp.reset();
      this.st.reset();
      this.embers.reset();
      this.shards.reset();
    }
    dt = dt > 0 ? dt : 0;
    const c = this._c;
    const player = state.player;
    const stats = player.stats ?? {};
    const profile = state.profile ?? {};

    // ── HP · 스태미나 ──
    const hpMax = Math.max(1, num(stats.hpMax));
    const stMax = Math.max(1, num(stats.staminaMax));
    const hpW = barWidth(HP_BAR, hpMax);
    if (hpW !== c.hpW) { c.hpW = hpW; this.hp.el.style.width = `${hpW}em`; }
    const stW = barWidth(ST_BAR, stMax);
    if (stW !== c.stW) { c.stW = stW; this.st.el.style.width = `${stW}em`; }
    const hpNow = Math.max(0, num(player.hp));
    const hpF = hpNow / hpMax;
    this.hp.set(hpF, dt);
    this.st.set(num(player.stamina) / stMax, dt);
    const hpInt = Math.round(hpNow);
    const hpMaxInt = Math.round(hpMax);
    if (hpInt !== c.hpInt || hpMaxInt !== c.hpMaxInt) {
      c.hpInt = hpInt;
      c.hpMaxInt = hpMaxInt;
      this.hpNum.textContent = `${hpInt} / ${hpMaxInt}`;
    }
    const stInt = Math.round(Math.max(0, num(player.stamina)));
    if (stInt !== c.stInt) { c.stInt = stInt; this.stNum.textContent = String(stInt); }
    const lowHp = hpF <= LOW_HP && hpNow > 0;
    if (lowHp !== c.lowHp) { c.lowHp = lowHp; this.hp.el.classList.toggle('ac-low', lowHp); }
    const exhausted = !!player.exhausted;
    if (exhausted !== c.exhausted) { c.exhausted = exhausted; this.st.el.classList.toggle('ac-exhausted', exhausted); }

    // ── 플라스크 ──
    const flaskMax = Math.max(0, Math.round(num(stats.flaskCharges)));
    const flaskNow = Math.max(0, Math.round(num(player.flasks)));
    if (flaskMax !== c.flaskMax) {
      c.flaskMax = flaskMax;
      c.flaskNow = -1;
      clear(this.flaskPips);
      for (let i = 0; i < flaskMax; i++) add(this.flaskPips, el('i', 'ac-flask'));
    }
    if (flaskNow !== c.flaskNow) {
      c.flaskNow = flaskNow;
      const pips = this.flaskPips.children;
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('ac-empty', i >= flaskNow);
      this.flaskNum.textContent = `${flaskNow} / ${flaskMax}`;
      this.flasks.classList.toggle('ac-none', flaskNow === 0);
    }

    // ── 잔불 · 파편 ──
    const gained = this.embers.set(profile.embers, dt);
    this.shards.set(profile.shards, dt);
    if (gained > 0) {
      this._gainSum += gained;
      this._gainT = GAIN_HOLD;
      this.emberGain.textContent = `+${fmtInt(this._gainSum)}`;
      retrigger(this.emberNum, 'ac-gained');
    }
    if (this._gainT > 0) {
      this._gainT -= dt;
      if (this._gainT <= 0) this._gainSum = 0;
    }
    const gain = this._gainT > 0;
    if (gain !== c.gain) { c.gain = gain; this.emberGain.classList.toggle('ac-show', gain); }

    // ── 보스 ──
    const boss = state.boss;
    const fight = state.fight;
    const showBoss = state.mode === 'boss' && !!boss && !!fight;
    if (showBoss !== c.boss) { c.boss = showBoss; this.boss.classList.toggle('ac-show', showBoss); }
    if (showBoss) this._updateBoss(boss, fight, player, dt);
    else this._fightRef = null;

    // ── 허수아비(마을) ──
    const d = state.dummy;
    const showDummy = state.mode === 'town' && !!d && num(d.sinceHit) < DUMMY_SHOW && (num(d.total) > 0 || num(d.lastDamage) > 0);
    if (showDummy !== c.dummy) { c.dummy = showDummy; this.dummy.classList.toggle('ac-show', showDummy); }
    if (showDummy) {
      const last = Math.round(num(d.lastDamage));
      const total = Math.round(num(d.total));
      if (last !== c.dummyLast) { c.dummyLast = last; this.dummyLast.textContent = t('hud.dummy.last', { n: fmtInt(last) }); }
      if (total !== c.dummyTotal) { c.dummyTotal = total; this.dummyTotal.textContent = t('hud.dummy.total', { n: fmtInt(total) }); }
    }

    // ── 상호작용 프롬프트 ──
    const facility = !panel && state.mode === 'town' && state.nearFacility ? state.nearFacility : null;
    if (facility !== c.prompt) {
      c.prompt = facility;
      if (facility) this.prompt.textContent = t(`prompt.${facility}`);
      this.prompt.classList.toggle('ac-show', facility !== null);
    }

    // ── 처형 프롬프트 — 조건식은 sim(player.canExecute)이 정한다 ──
    let execKind = '';
    if (!panel && !this._bannerKind && showBoss && fight.phase === 'fight') {
      if (player.canExecute) execKind = 'execute';
      else if (boss.state === 'groggy') execKind = 'executeFront';
    }
    if (execKind !== c.execKind) {
      c.execKind = execKind;
      if (execKind) this.exec.textContent = t(`prompt.${execKind}`);
      this.exec.classList.toggle('ac-show', execKind !== '');
      this.exec.classList.toggle('ac-ready', execKind === 'execute');
    }

    // ── 조작 힌트 ──
    let hints = false;
    if (!panel && num(profile.totals?.kills) === 0) {
      if (state.mode === 'town') hints = true;
      else if (fight) hints = num(profile.bosses?.valder?.attempts) <= HINT_MAX_ATTEMPTS && num(fight.time) < HINT_FIGHT_TIME;
    }
    if (hints !== c.hints) { c.hints = hints; this.hints.classList.toggle('ac-show', hints); }

    // ── 락 안내 ──
    // 락을 얻을 수 없는 환경(자동화 · 일부 브라우저)에서는 「클릭하면 고정된다」가 거짓말이다 —
    // 드래그 안내로 바꿔 잠깐만 보여 준다(락 안내가 내내 화면 위에 떠 있지 않게).
    const drag = !!dragMode && !pointerLocked;
    if (drag !== c.lockDrag) {
      c.lockDrag = drag;
      this._dragHintT = drag ? DRAG_HINT_HOLD : 0;
      this.lockHint.textContent = t(drag ? 'hud.dragToLook' : 'hud.clickToLock');
    }
    if (drag && !panel && this._dragHintT > 0) this._dragHintT -= dt;
    const lockHint = !panel && !pointerLocked && (!drag || this._dragHintT > 0);
    if (lockHint !== c.lockHint) { c.lockHint = lockHint; this.lockHint.classList.toggle('ac-show', lockHint); }

    // ── 배너 · 저장 표시 ──
    if (this._bannerKind) {
      this._bannerT -= dt;
      if (this._bannerT <= 0 || panel) this._hideBanner();
    }
    if (this._savedT > 0) this._savedT -= dt;
    const saved = this._savedT > 0;
    if (saved !== c.saved) { c.saved = saved; this.saved.classList.toggle('ac-show', saved); }
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.el.remove();
  }

  // ── 내부 ──

  _updateBoss(boss, fight, player, dt) {
    const c = this._c;
    if (fight !== this._fightRef) {
      // 새 판 — 연출 상태를 처음으로
      this._fightRef = fight;
      this._introT = 0;
      this._comboSum = 0;
      this._comboT = 0;
      this._comboDirty = true;
      this.bossHp.reset();
      this.bossPosture.reset();
      this._hideBanner();
      retrigger(this.boss, 'ac-enter');
    }
    if (boss.id !== c.bossId) {
      c.bossId = boss.id;
      this.bossName.textContent = t(`boss.${boss.id}.name`);
      const frac = num(getBossDef(boss.id)?.phase2?.hpFrac);
      const tick = Math.round(frac * 1000);
      if (tick !== c.tick) {
        c.tick = tick;
        this.bossTick.style.left = `${tick / 10}%`;
        this.bossTick.classList.toggle('ac-show', tick > 0 && tick < 1000);
      }
    }
    // 등장 연출: 인트로 동안 바가 차오른다(스텁 sim은 phaseTime을 올리지 않으므로 렌더 시간으로 잰다)
    this._introT += dt;
    const k = clamp01((this._introT - BOSS_FILL_DELAY) / BOSS_FILL_DUR);
    const fill = 1 - (1 - k) * (1 - k);
    const hpMax = Math.max(1, num(boss.hpMax));
    const hp = Math.max(0, num(boss.hp));
    this.bossHp.set((hp / hpMax) * fill, dt);
    // 쓰러진 보스의 체간은 뜻이 없다 — 격파 결과 화면에 남은 값이 그대로 보이지 않게 비운다
    this.bossPosture.set(hp > 0 ? num(boss.posture) / Math.max(1, num(boss.postureMax)) : 0, dt);
    if (hp !== c.bossHp || hpMax !== c.bossHpMax) {
      c.bossHp = hp;
      c.bossHpMax = hpMax;
      this.bossHpNum.textContent = `${fmtInt(hp)} / ${fmtInt(hpMax)}`;
    }
    const phase2 = boss.phase === 2;
    if (phase2 !== c.phase2) { c.phase2 = phase2; this.boss.classList.toggle('ac-phase2', phase2); }
    const groggy = boss.state === 'groggy';
    if (groggy !== c.groggy) { c.groggy = groggy; this.boss.classList.toggle('ac-groggy', groggy); }
    // 체간 잠금(§8.7): 일어난 보스는 다음 공격을 낼 때까지 체간이 쌓이지 않는다 — 바가 0에서 움직이지 않는 이유를 보여 준다
    const guard = !groggy && !!boss.postureGuard;
    if (guard !== c.postureGuard) {
      c.postureGuard = guard;
      this.boss.classList.toggle('ac-posture-guard', guard);
      // 같은 자리(체간 바 왼쪽)의 글자를 상태에 맞춘다 — 잠금이 풀리면 「체간 붕괴」로 돌려놓는다(다음 그로기에서 쓴다)
      this.bossGroggy.textContent = t(guard ? 'hud.postureGuard' : 'hud.groggy');
    }
    const lockOn = !!player.lockOn;
    if (lockOn !== c.lockOn) { c.lockOn = lockOn; this.bossLock.classList.toggle('ac-show', lockOn); }

    // 누적 피해 수치(2초 창)
    if (this._comboT > 0) {
      this._comboT -= dt;
      if (this._comboT <= 0) this._comboSum = 0;
    }
    if (this._comboDirty) {
      this._comboDirty = false;
      if (this._comboSum > 0) {
        this.combo.textContent = fmtInt(this._comboSum);
        retrigger(this.combo, 'ac-bump');
      }
    }
    const combo = this._comboT > 0 && this._comboSum > 0;
    if (combo !== c.combo) { c.combo = combo; this.combo.classList.toggle('ac-show', combo); }
  }

  /** @param {{target:string, damage:number}} p */
  _onHit(p) {
    if (p.target !== 'boss' || !(p.damage > 0)) return;
    this._comboSum += p.damage;
    this._comboT = COMBO_WINDOW;
    this._comboDirty = true;
  }

  /** @param {{phase:string}} p */
  _onFlask(p) {
    if (p.phase === 'empty') retrigger(this.flasks, 'ac-shake');
    else if (p.phase === 'heal') retrigger(this.hp.el, 'ac-heal');
  }

  _onModeChanged() {
    this._hideBanner();
    this._fightRef = null;
    this.hp.reset();
    this.st.reset();
  }

  /** @param {'died'|'victory'|'cycle'} kind */
  _showBanner(kind) {
    // 격파와 순환 상승은 같은 틱에 온다 — 순서와 무관하게 「보스 격파」 아래에 「순환 +1」을 단다
    const cur = this._bannerKind;
    if ((kind === 'cycle' && cur === 'victory') || (kind === 'victory' && cur === 'cycle')) {
      this._bannerKind = 'victory';
      this.bannerMain.textContent = t('banner.victory');
      this.bannerSub.textContent = t('banner.cycle');
      this.banner.className = 'ac-banner ac-victory ac-show';
      this._bannerT = BANNER_DUR.victory;
      return;
    }
    this._bannerKind = kind;
    this._bannerT = BANNER_DUR[kind];
    this.bannerMain.textContent = t(`banner.${kind}`);
    this.bannerSub.textContent = '';
    this.banner.className = `ac-banner ac-${kind}`;
    void this.banner.offsetWidth; // 글자가 벌어지는 연출을 처음부터
    this.banner.classList.add('ac-show');
  }

  _hideBanner() {
    if (!this._bannerKind) return;
    this._bannerKind = '';
    this._bannerT = 0;
    this.banner.classList.remove('ac-show');
  }

  /** KEYBINDS에서 10줄을 만든다(이동 · 카메라 · 약공격 · 강공격 · 가드/패링 · 구르기/달리기 · 록온 · 플라스크 · 상호작용 · 일시정지/설정). */
  _buildHints() {
    const K = KEYBINDS;
    const move = [K.moveForward, K.moveLeft, K.moveBack, K.moveRight].map((codes) => keyLabel(codes[0])).join(' ');
    /** @type {[string, string][]} */
    const lines = [
      [t('action.move'), move],
      [t('action.camera'), t('key.mouse')],
      [t('action.light'), keysLabel(K.light)],
      [t('action.heavy'), keysLabel(K.heavy)],
      [t('action.guard'), keysLabel(K.guard)],
      [`${t('action.roll')} / ${t('action.sprint')}`, `${keysLabel(K.roll)} / ${keysLabel(K.sprint)}`],
      [t('action.lockOn'), keysLabel(K.lockOn)],
      [t('action.flask'), keysLabel(K.flask)],
      [t('action.interact'), keysLabel(K.interact)],
      // 조작 표 · 설정 · 전투 요령(붉은 공격은 패링 불가 등)이 일시정지 패널에 있다 — 그 문을 알려 준다
      [`${t('action.pause')} · ${t('panel.pause.settings')}`, keysLabel(K.pause)],
    ];
    add(this.hints, el('div', 'ac-hints-title', t('hud.hints')));
    for (const [label, keys] of lines) {
      add(this.hints, add(el('div', 'ac-hints-row'), el('span', 'ac-hints-label', label), el('span', 'ac-hints-key', keys)));
    }
  }
}
