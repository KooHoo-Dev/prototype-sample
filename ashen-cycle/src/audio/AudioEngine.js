// OWNER: P7 — 계약 §9.7
// WebAudio 합성 오디오. 이벤트를 스스로 구독해 효과음을 내고, update에서 분위기 음의 세기를 맞춘다.
// AudioContext는 unlock() 안에서만 만든다 — 그 전에는 모든 경로가 완전한 no-op이다.
//
// 신호 흐름:
//   효과음(sim) → world ─┐
//   효과음(UI)  → ui ────┴→ sfx ──┬──────────────→ master → 컴프레서 → 리미터(소프트 클립) → 출력
//                                 └→ 잔향(약하게) ─┘
//   분위기 음 → duck(일시정지 때 먹먹하게) → music ─┘
import { EV } from '../core/events.js';
import { clamp01 } from '../core/math2d.js';
import { getBossDef } from '../data/bosses/index.js';
import { Sfx } from './sfx.js';
import { Music } from './music.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').Settings} Settings */

// ── 믹스 상수 ──
const SFX_TRIM = 0.9;
const MUSIC_TRIM = 0.6;
const REVERB_SEND = 0.16;
const REVERB_SECONDS = 1.5;
const REVERB_DECAY = 3.4;
/** 브라우저의 컴프레서는 작은 소리에 메이크업 게인(이 설정에서 약 1.9배)을 건다 — 그만큼 되돌린다 */
const COMP_TRIM = 0.62;
/** 리미터: 이 크기까지는 그대로, 그 위는 CLIP_CEIL로 눕는다 */
const CLIP_KNEE = 0.55;
const CLIP_CEIL = 0.92;
/** 일시정지: 분위기 음을 줄이고 먹먹하게 */
const DUCK_GAIN = 0.35;
const DUCK_CUTOFF = 500;
const OPEN_CUTOFF = 18000;
/** 거리 감쇠: 이 거리(m)까지는 그대로, 그 뒤로 서서히 줄어 FAR_VOL까지 */
const NEAR_DIST = 5;
const FAR_DIST = 30;
const FAR_VOL = 0.4;
/** 같은 소리가 겹쳐 쌓이지 않게 하는 최소 간격(초) */
const GAP = { hit: 0.03, hurt: 0.06, guard: 0.05, step: 0.07, bossStep: 0.1, hazardWarn: 0.08, hazardBurst: 0.06,
  projEnd: 0.05, deny: 0.09, ui: 0.02, cue: 0.04, swing: 0.04 };
/** 지속음(브레스 · 광선)이 끝 이벤트 없이 남았을 때 스스로 끄는 시간(초) */
const LOOP_TIMEOUT = 6;
/** 분위기 음 세기: 기본 + 보스 HP가 줄수록 + 가까울수록 */
const INTENSITY_BASE = 0.25;
const INTENSITY_HP = 0.45;
const INTENSITY_NEAR = 0.3;
const NEAR_BOSS = 3;
const FAR_BOSS = 15;
/** 교전이 끝난 뒤(결과 화면)에 남기는 드론 크기 */
const AFTER_FIGHT_LEVEL = 0.2;
/** 화톳불 소리가 들리는 범위(m) */
const BONFIRE_NEAR = 2;
const BONFIRE_FAR = 16;

/** 소프트 클립 곡선(입력 −1..1). 무릎 아래는 직선이라 평소 소리를 물들이지 않는다. */
function softClipCurve() {
  const n = 1025;
  const curve = new Float32Array(n);
  const span = CLIP_CEIL - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + span * Math.tanh((a - CLIP_KNEE) / span);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export class AudioEngine {
  /** @param {{bus:import('../core/events.js').EventBus, settings:Settings}} deps */
  constructor({ bus, settings }) {
    this.bus = bus;
    this.settings = settings;
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {Sfx|null} */
    this.sfx = null;
    /** @type {Music|null} */
    this.music = null;
    this._paused = false;
    /** 마지막으로 본 플레이어 위치(거리 감쇠의 기준) */
    this._px = 0;
    this._pz = 0;
    /** @type {Map<string, number>} 소리 종류 → 마지막으로 낸 시각(ctx.currentTime) */
    this._last = new Map();
    /** @type {Map<string, number>} 지속음 키 → 남은 수명(초) */
    this._loopLife = new Map();
    this._musicParams = { level: 1, intensity: 0.3, phase2: false, drums: false, crackle: 0 };
    this._offs = [];
    this._subscribe();
  }

  /** 첫 사용자 제스처에서 app이 부른다(AudioContext 생성 · resume). 그 전에는 전부 무음 no-op. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;   // WebAudio가 없는 환경에서는 계속 no-op
    let ctx;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    this.ctx = ctx;

    // 출력단: 컴프레서(큰 소리를 눌러 붙임) → 보정 게인 → 리미터(소프트 클립 — 돌발 피크를 지연 없이 눕힌다)
    const limiter = ctx.createWaveShaper();
    limiter.curve = softClipCurve();
    limiter.oversample = '2x';
    limiter.connect(ctx.destination);
    const trim = ctx.createGain();
    trim.gain.value = COMP_TRIM;
    trim.connect(limiter);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    comp.connect(trim);
    this._master = ctx.createGain();
    this._master.connect(comp);

    this._sfxBus = ctx.createGain();
    this._sfxBus.connect(this._master);
    this._worldBus = ctx.createGain();
    this._worldBus.connect(this._sfxBus);
    this._uiBus = ctx.createGain();
    this._uiBus.connect(this._sfxBus);

    // 잔향: 지수 감쇠 잡음 임펄스 — 쇳소리와 포효에 공간을 준다
    const len = Math.floor(ctx.sampleRate * REVERB_SECONDS);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-REVERB_DECAY * i) / ctx.sampleRate);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    const send = ctx.createGain();
    send.gain.value = REVERB_SEND;
    this._sfxBus.connect(send).connect(reverb).connect(this._master);

    this._musicBus = ctx.createGain();
    this._musicBus.connect(this._master);
    this._musicBus.connect(send);
    this._duck = ctx.createBiquadFilter();
    this._duck.type = 'lowpass';
    this._duck.frequency.value = OPEN_CUTOFF;
    this._duckGain = ctx.createGain();
    this._duck.connect(this._duckGain).connect(this._musicBus);

    this.sfx = new Sfx(ctx, this._worldBus, this._uiBus);
    this.music = new Music(ctx, this._duck, this.sfx.noiseBuf);
    this._applyVolumes();
    this._applyPause();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  /**
   * 분위기 음 강도(보스 HP · 페이즈 · 거리).
   * @param {GameState} state
   * @param {number} dt
   */
  update(state, dt) {
    if (!this.ctx || !this.music || !this.sfx) return;
    const p = state.player;
    this._px = p.pos.x;
    this._pz = p.pos.z;
    const m = this._musicParams;
    // 이벤트를 놓쳐도(잠금 해제 전의 MODE_CHANGED) 상태를 보고 분위기 음을 맞춘다
    if (state.mode === 'boss') {
      const boss = state.boss;
      const fight = state.fight;
      this.music.setTrack(boss ? boss.id : fight ? fight.bossId : null);
      const live = !!fight && fight.outcome == null && fight.phase !== 'done';
      m.level = live ? 1 : AFTER_FIGHT_LEVEL;
      m.drums = live && fight.phase === 'fight';
      m.phase2 = !!boss && boss.phase === 2;
      m.crackle = 0;
      if (boss) {
        const d = Math.hypot(boss.pos.x - p.pos.x, boss.pos.z - p.pos.z);
        const near = clamp01(1 - (d - NEAR_BOSS) / (FAR_BOSS - NEAR_BOSS));
        const hpLost = boss.hpMax > 0 ? clamp01(1 - boss.hp / boss.hpMax) : 0;
        m.intensity = clamp01(INTENSITY_BASE + INTENSITY_HP * hpLost + INTENSITY_NEAR * near);
      }
    } else {
      this.music.setTrack('town');
      m.level = 1;
      m.drums = false;
      m.phase2 = false;
      m.intensity = 0.3;
      let bonfire = null;
      const fac = state.world ? state.world.facilities : [];
      for (let i = 0; i < fac.length; i++) if (fac[i].id === 'bonfire') bonfire = fac[i];
      m.crackle = bonfire
        ? clamp01(1 - (Math.hypot(bonfire.x - p.pos.x, bonfire.z - p.pos.z) - BONFIRE_NEAR) / (BONFIRE_FAR - BONFIRE_NEAR))
        : 0;
    }
    this.music.update(dt, m);

    // 교전이 끝나면(결과 화면) sim이 멈춰 breath_end · BOSS_ATTACK_END가 오지 않는다 — 이벤트를 놓쳐도 상태를 보고 끈다
    if (this._loopLife.size && state.fight && state.fight.phase === 'done') this._silenceLoops();
    if (this._loopLife.size && dt > 0) {
      for (const [key, left] of this._loopLife) {
        if (left - dt <= 0) this._loopStop(key);
        else this._loopLife.set(key, left - dt);
      }
    }
  }

  /** @param {boolean} paused */
  setPaused(paused) {
    this._paused = !!paused;
    this._applyPause();
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._loopLife.clear();
    if (this.sfx) this.sfx.loopStopAll();
    if (this.music) this.music.dispose();
    if (this.ctx && typeof this.ctx.close === 'function') this.ctx.close().catch(() => {});
    this.ctx = null;
    this.sfx = null;
    this.music = null;
  }

  // ───────────────────────── 내부 ─────────────────────────

  _applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this._master.gain.setTargetAtTime(clamp01(s.volumeMaster), t, 0.03);
    this._sfxBus.gain.setTargetAtTime(clamp01(s.volumeSfx) * SFX_TRIM, t, 0.03);
    this._musicBus.gain.setTargetAtTime(clamp01(s.volumeMusic) * MUSIC_TRIM, t, 0.03);
  }

  /** 일시정지 덕킹: sim 소리는 닫고(UI 소리는 그대로) 분위기 음은 작고 먹먹하게. */
  _applyPause() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._worldBus.gain.setTargetAtTime(this._paused ? 0.0001 : 1, t, 0.04);
    this._duckGain.gain.setTargetAtTime(this._paused ? DUCK_GAIN : 1, t, 0.12);
    this._duck.frequency.setTargetAtTime(this._paused ? DUCK_CUTOFF : OPEN_CUTOFF, t, 0.12);
  }

  /** 플레이어에서 먼 소리는 작게. @returns {number} 0..1 */
  _distVol(x, z) {
    if (typeof x !== 'number' || typeof z !== 'number') return 1;
    const d = Math.hypot(x - this._px, z - this._pz);
    return 1 - (1 - FAR_VOL) * clamp01((d - NEAR_DIST) / (FAR_DIST - NEAR_DIST));
  }

  /** 같은 종류의 소리를 gap초 안에 다시 내지 않는다. @returns {boolean} 내도 되는가 */
  _gate(key, gap) {
    const now = this.ctx.currentTime;
    const last = this._last.get(key);
    if (last !== undefined && now - last < gap) return false;
    this._last.set(key, now);
    return true;
  }

  _loopStart(key, type, style, vol) {
    this.sfx.loopStart(key, type, style, vol);
    this._loopLife.set(key, LOOP_TIMEOUT);
  }

  _loopStop(key) {
    this._loopLife.delete(key);
    if (this.sfx) this.sfx.loopStop(key);
  }

  /** 모드 전환 · 교전 종료: 지속음을 전부 끈다. */
  _silenceLoops() {
    this._loopLife.clear();
    if (this.sfx) this.sfx.loopStopAll();
  }

  _subscribe() {
    /** 잠금 해제 전에는 부르지 않는다. */
    const on = (name, fn) => {
      this._offs.push(this.bus.on(name, (p) => {
        if (this.sfx) fn(p, this.sfx);
      }));
    };

    // ── 플레이어 ──
    on(EV.PLAYER_SWING, (p, s) => { if (this._gate('swing', GAP.swing)) s.swing(p.weaponId, !!p.heavy, p.charge); });
    on(EV.PLAYER_ATTACK_START, (p, s) => s.rustle());
    on(EV.PLAYER_CHARGE_FULL, (p, s) => s.chargeFull());
    on(EV.PLAYER_DODGED, (p, s) => s.dodged());
    on(EV.PLAYER_ROLL, (p, s) => s.roll(!!p.backstep));
    on(EV.PLAYER_STEP, (p, s) => { if (this._gate('step', GAP.step)) s.step(!!p.sprint); });
    on(EV.PLAYER_GUARD, (p, s) => { if (p.on) s.guardUp(); });
    on(EV.PLAYER_FLASK, (p, s) => s.flask(p.phase));
    on(EV.PLAYER_STAMINA_OUT, (p, s) => s.gasp());
    on(EV.EXECUTE_STARTED, (p, s) => s.executeStart());
    on(EV.LOCKON_CHANGED, (p, s) => s.lockOn(!!p.on));
    on(EV.PLAYER_RESTED, (p, s) => s.rested());
    on(EV.PLAYER_DIED, (p, s) => { this._silenceLoops(); s.died(); });

    // ── 타격 ──
    on(EV.HIT, (p, s) => {
      const vol = this._distVol(p.x, p.z);
      switch (p.outcome) {
        case 'hit':
          if (p.target === 'player') { if (this._gate('hurt', GAP.hurt)) s.hurt(!!p.knockdown, vol); }
          else if (this._gate('hit', GAP.hit)) s.hit(!!p.heavy, !!p.crit, !!p.execute, vol);
          break;
        case 'guard':
          if (this._gate('guard', GAP.guard)) s.guard(!!p.guardBreak, vol);
          break;
        case 'parry':
          s.parry(vol);
          break;
        case 'immune':
          if (this._gate('hit', GAP.hit)) s.immune(vol);
          break;
        default:
          break;
      }
    });

    // ── 보스 ──
    on(EV.BOSS_ATTACK_WINDUP, (p, s) => s.windup(p.glow, this._distVol(p.x, p.z)));
    on(EV.BOSS_ATTACK_ACTIVE, (p, s) => {
      // 직접 타격이 있는 공격만 "큰 휘두르기"가 난다(시전 · 순간이동은 큐가 소리를 낸다)
      const def = getBossDef(p.bossId);
      const atk = def ? def.attacks[p.attackId] : null;
      if (!atk || atk.hits.length > 0) s.bossSwing(this._distVol(p.x, p.z));
    });
    on(EV.BOSS_ATTACK_END, (p) => {
      this._loopStop(`breath:${p.seq}`);
      this._loopStop(`beam:${p.seq}`);
    });
    on(EV.BOSS_CUE, (p, s) => {
      const vol = this._distVol(p.x, p.z);
      switch (p.cue) {
        case 'breath_start':
          this._loopStart(`breath:${p.seq}`, 'breath', p.style, vol);
          break;
        case 'beam_start':
          this._loopStart(`beam:${p.seq}`, 'beam', p.style, vol);
          break;
        case 'breath_end':
          this._loopStop(`breath:${p.seq}`);
          break;
        case 'beam_end':
          this._loopStop(`beam:${p.seq}`);
          break;
        default:
          if (this._gate(`cue:${p.cue}`, GAP.cue)) s.cue(p.cue, p.style, vol);
      }
    });
    on(EV.BOSS_STEP, (p, s) => { if (this._gate('bossStep', GAP.bossStep)) s.bossStep(!!p.heavy, this._distVol(p.x, p.z)); });
    on(EV.BOSS_PHASE_CHANGED, (p, s) => s.phaseChange());
    on(EV.BOSS_GROGGY, (p, s) => { if (p.on) s.groggy(this._distVol(p.x, p.z)); });
    on(EV.BOSS_TELEPORT, (p, s) => s.teleport(this._distVol(p.toX, p.toZ)));
    on(EV.BOSS_DEFEATED, (p, s) => { this._silenceLoops(); s.defeated(); });

    // ── 투사체 · 장판 ('clear'는 무음) ──
    on(EV.PROJECTILE_SPAWNED, (p, s) => s.projectileSpawn(p.style, this._distVol(p.x, p.z)));
    on(EV.PROJECTILE_ENDED, (p, s) => {
      if (p.reason !== 'clear' && this._gate('projEnd', GAP.projEnd)) s.projectileEnd(p.reason, this._distVol(p.x, p.z));
    });
    on(EV.HAZARD_SPAWNED, (p, s) => {
      if (p.warn > 0 && this._gate('hazardWarn', GAP.hazardWarn)) s.hazardWarn(p.style, this._distVol(p.x, p.z));
    });
    on(EV.HAZARD_ACTIVATED, (p, s) => {
      if (!this._gate(`hz:${p.kind}`, GAP.hazardBurst)) return;
      const sh = p.shape;
      const x = sh ? (sh.type === 'capsule' ? (sh.ax + sh.bx) / 2 : sh.x) : undefined;
      const z = sh ? (sh.type === 'capsule' ? (sh.az + sh.bz) / 2 : sh.z) : undefined;
      s.hazardBurst(p.kind, this._distVol(x, z));
    });

    // ── 흐름 ──
    on(EV.MODE_CHANGED, () => this._silenceLoops());
    // 사망 뒤 아웃트로(1.8초) 동안에도 보스는 움직인다 — 그때 시작된 브레스 · 광선은 끝 이벤트 없이 sim이 멈춘다.
    // 교전이 끝나는 순간(done — 포기는 FIGHT_ENDED 없이 여기로만 온다) 지속음을 전부 끈다.
    on(EV.FIGHT_PHASE, (p) => { if (p && p.phase === 'done') this._silenceLoops(); });
    on(EV.FIGHT_ENDED, () => this._silenceLoops());
    on(EV.CYCLE_ADVANCED, (p, s) => s.cycleAdvanced());

    // ── 성장 · UI ──
    on(EV.LEVEL_UP, (p, s) => s.levelUp());
    on(EV.WEAPON_UPGRADED, (p, s) => s.weaponUpgraded());
    on(EV.ITEM_PURCHASED, (p, s) => s.purchased());
    on(EV.WEAPON_EQUIPPED, (p, s) => s.weaponEquipped());
    on(EV.RELIC_EQUIPPED, (p, s) => s.relicEquipped());
    on(EV.PURCHASE_FAILED, (p, s) => { if (this._gate('deny', GAP.deny)) s.uiSound('deny'); });
    on(EV.UI_SOUND, (p, s) => {
      if (p.kind === 'deny') { if (this._gate('deny', GAP.deny)) s.uiSound('deny'); }
      else if (this._gate(`ui:${p.kind}`, GAP.ui)) s.uiSound(p.kind);
    });
    on(EV.UI_OPENED, (p, s) => s.uiPanel(true));
    on(EV.UI_CLOSED, (p, s) => s.uiPanel(false));

    // ── 설정 · 일시정지(잠금 해제 전에도 상태는 기억한다) ──
    this._offs.push(this.bus.on(EV.PAUSED, (p) => this.setPaused(!!p.paused)));
    this._offs.push(this.bus.on(EV.SETTINGS_CHANGED, () => this._applyVolumes()));
  }
}
