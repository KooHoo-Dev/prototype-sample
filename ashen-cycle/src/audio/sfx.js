// OWNER: P7 — 계약 §9.7 「이벤트 → 연출 표」의 audio 열
// WebAudio 합성 효과음. 외부 에셋 0 — 오실레이터 · 잡음 · 필터 · 포락선만 쓴다.
// 소리 하나는 "짧게 살다 스스로 멎는 노드 몇 개"다(start/stop 예약 — 끝나면 엔진이 거둔다).
// 모든 메서드의 vol은 0..1 배율(거리 감쇠 등)이고, 기본 게인은 귀가 아프지 않게 낮게 잡는다.

const NOISE_SECONDS = 2;
/** 금속성 배음비(종 · 칼날) */
const METAL = [1, 2.32, 3.86, 5.21];
const BRIGHT = [1, 1.51, 2.26, 3.41];
const GLASS = [1, 1.37, 1.93, 2.71];
const BELL = [1, 2, 2.76, 5.4];
/** 무기별 휘두르기 음색: 밴드패스 시작 · 끝(Hz) · 길이(초) */
const SWING = {
  longsword: { f0: 520, f1: 1900, dur: 0.16 },
  greatsword: { f0: 260, f1: 950, dur: 0.26 },
  spear: { f0: 820, f1: 2700, dur: 0.12 },
};
/** 보스 스타일별 음높이(시전 · 경고 틱) */
const STYLE_PITCH = { fire: 392, frost: 988, void: 311, danger: 1568 };
const rand = Math.random;
const rr = (a, b) => a + (b - a) * rand();

export class Sfx {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} world sim 소리 버스(일시정지 때 닫힌다)
   * @param {AudioNode} ui UI 소리 버스
   */
  constructor(ctx, world, ui) {
    this.ctx = ctx;
    this.world = world;
    this.ui = ui;
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
    /** @type {Map<string, {gain:GainNode, nodes:AudioScheduledSourceNode[]}>} 지속음(브레스 · 광선) */
    this._loops = new Map();
  }

  // ───────────────────────── 기본 부품 ─────────────────────────

  /** 빠르게 올라 지수로 꺼지는 포락선. */
  _env(g, t, attack, peak, dur) {
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
  }

  /**
   * 음높이가 f0 → f1로 미끄러지는 오실레이터 한 음.
   * @param {AudioNode} dest @param {OscillatorType} type
   * @returns {OscillatorNode}
   */
  tone(dest, type, f0, f1, dur, peak, attack = 0.004, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
    return o;
  }

  /**
   * 필터를 거친 잡음 한 덩어리(필터 주파수가 f0 → f1로 쓸린다).
   * @param {AudioNode} dest @param {BiquadFilterType} ftype
   */
  noise(dest, dur, peak, ftype, f0, f1, q = 1, attack = 0.004, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, rand() * (NOISE_SECONDS - 0.1));
    s.stop(t + dur + 0.03);
  }

  /** 비정수 배음 사인 묶음 = 쇳소리. 높은 배음일수록 빨리 꺼진다. */
  clang(dest, base, ratios, dur, peak, delay = 0) {
    for (let i = 0; i < ratios.length; i++) {
      this.tone(dest, 'sine', base * ratios[i], base * ratios[i] * 0.995, dur / (1 + i * 0.6), peak / (1 + i * 0.7), 0.002, delay);
    }
  }

  // ───────────────────────── 플레이어 ─────────────────────────

  /** 휘두르기: 잡음 + 밴드패스 스윕. 무기별 음높이 · heavy면 낮고 길게. */
  swing(weaponId, heavy, charge, vol = 1) {
    const w = SWING[weaponId] ?? SWING.longsword;
    const k = heavy ? 0.72 : 1;
    const dur = w.dur * (heavy ? 1.45 : 1) * rr(0.95, 1.05);
    const peak = (heavy ? 0.36 : 0.28) * (1 + 0.3 * (charge || 0)) * vol;
    this.noise(this.world, dur, peak, 'bandpass', w.f0 * k, w.f1 * k * rr(0.9, 1.1), 1.4, dur * 0.35);
    this.noise(this.world, dur * 0.7, peak * 0.35, 'highpass', 3500, 6000, 0.7, dur * 0.3);
  }

  /** 옷 스침(작게). */
  rustle(vol = 1) {
    this.noise(this.world, 0.11, 0.05 * vol, 'bandpass', 900, 500, 0.8, 0.03);
  }

  chargeFull(vol = 1) {
    this.tone(this.world, 'sine', 1320, 1320, 0.35, 0.1 * vol, 0.003);
    this.tone(this.world, 'sine', 1980, 1980, 0.25, 0.06 * vol, 0.003, 0.02);
  }

  /** 타격: 짧은 저음 + 금속성 고음. heavy/crit/execute 변주. */
  hit(heavy, crit, execute, vol = 1) {
    const w = this.world;
    const p = rr(0.94, 1.06);
    this.tone(w, 'sine', (heavy ? 130 : 165) * p, 48, heavy ? 0.2 : 0.13, (heavy ? 0.5 : 0.38) * vol, 0.002);
    this.noise(w, heavy ? 0.12 : 0.07, (heavy ? 0.34 : 0.26) * vol, 'bandpass', 2600 * p, 1100, 0.8, 0.002);
    this.clang(w, (heavy ? 780 : 1150) * p, METAL, 0.12, 0.07 * vol);
    if (crit) {
      this.clang(w, 1760, BRIGHT, 0.45, 0.1 * vol, 0.01);
      this.noise(w, 0.05, 0.18 * vol, 'highpass', 5000, 5000, 0.7, 0.002);
    }
    if (execute) {
      this.tone(w, 'sine', 92, 28, 0.6, 0.6 * vol, 0.004);
      this.noise(w, 0.45, 0.32 * vol, 'lowpass', 1800, 180, 0.7, 0.004);
      this.clang(w, 660, METAL, 0.7, 0.12 * vol, 0.03);
    }
  }

  /** 둔탁한 피격음. */
  hurt(knockdown, vol = 1) {
    const w = this.world;
    this.tone(w, 'sine', 118, 42, knockdown ? 0.32 : 0.2, 0.5 * vol, 0.003);
    this.noise(w, 0.13, 0.26 * vol, 'lowpass', 700, 220, 0.8, 0.003);
    this.tone(w, 'triangle', 240, 110, 0.1, 0.12 * vol, 0.002);
  }

  /** 금속으로 막는 소리. guardBreak면 깨지는 소리를 겹친다. */
  guard(guardBreak, vol = 1) {
    const w = this.world;
    const p = rr(0.93, 1.07);
    this.clang(w, 540 * p, METAL, 0.2, 0.16 * vol);
    this.noise(w, 0.06, 0.22 * vol, 'bandpass', 1900, 900, 0.9, 0.002);
    this.tone(w, 'sine', 140, 70, 0.1, 0.25 * vol, 0.002);
    if (guardBreak) {
      this.noise(w, 0.4, 0.3 * vol, 'highpass', 1800, 900, 0.7, 0.003);
      this.tone(w, 'sawtooth', 420, 110, 0.35, 0.1 * vol, 0.003);
      this.clang(w, 310, GLASS, 0.5, 0.14 * vol, 0.02);
    }
  }

  /** 패링: 맑고 높은 쇳소리 + 긴 여운. */
  parry(vol = 1) {
    const w = this.world;
    this.clang(w, 1975, BRIGHT, 1.0, 0.17 * vol);
    this.clang(w, 2637, BRIGHT, 0.7, 0.07 * vol, 0.012);
    this.noise(w, 0.035, 0.26 * vol, 'highpass', 5200, 5200, 0.7, 0.001);
    this.tone(w, 'sine', 190, 80, 0.09, 0.3 * vol, 0.002);
  }

  /** 무적에 튕김. */
  immune(vol = 1) {
    this.tone(this.world, 'triangle', 270, 170, 0.07, 0.16 * vol, 0.002);
    this.noise(this.world, 0.05, 0.1 * vol, 'bandpass', 950, 700, 1.2, 0.002);
  }

  dodged(vol = 1) {
    this.noise(this.world, 0.13, 0.22 * vol, 'bandpass', 900, 2600, 1.6, 0.05);
  }

  roll(backstep, vol = 1) {
    const w = this.world;
    this.noise(w, backstep ? 0.18 : 0.3, 0.2 * vol, 'lowpass', 620, 240, 0.7, 0.05);
    this.tone(w, 'sine', 84, 48, 0.1, 0.2 * vol, 0.004, backstep ? 0.1 : 0.16);
    this.noise(w, 0.08, 0.06 * vol, 'bandpass', 1500, 900, 0.8, 0.02, 0.05);
  }

  step(sprint, vol = 1) {
    const w = this.world;
    const p = rr(0.85, 1.15);
    this.noise(w, 0.05, (sprint ? 0.1 : 0.075) * vol, 'lowpass', (sprint ? 1300 : 950) * p, 400, 0.8, 0.003);
    this.tone(w, 'sine', 96 * p, 58, 0.05, 0.08 * vol, 0.002);
  }

  /** 보스 발소리(쿵). */
  bossStep(heavy, vol = 1) {
    const w = this.world;
    const p = rr(0.9, 1.1);
    this.tone(w, 'sine', 64 * p, 33, heavy ? 0.3 : 0.2, (heavy ? 0.36 : 0.2) * vol, 0.004);
    this.noise(w, 0.14, (heavy ? 0.16 : 0.09) * vol, 'lowpass', 340, 120, 0.7, 0.004);
  }

  guardUp(vol = 1) {
    this.clang(this.world, 720, METAL, 0.06, 0.045 * vol);
    this.noise(this.world, 0.05, 0.04 * vol, 'bandpass', 1400, 900, 0.9, 0.01);
  }

  /** 플라스크: start 꿀꺽 · heal 회복음 · empty 빈 병. */
  flask(phase, vol = 1) {
    const w = this.world;
    if (phase === 'start') {
      for (let i = 0; i < 3; i++) this.tone(w, 'sine', 330 - i * 20, 175, 0.09, 0.13 * vol, 0.01, i * 0.17);
    } else if (phase === 'heal') {
      const notes = [659, 880, 1319];
      for (let i = 0; i < notes.length; i++) this.tone(w, 'sine', notes[i], notes[i], 0.6, 0.085 * vol, 0.04, i * 0.06);
      this.noise(w, 0.5, 0.04 * vol, 'highpass', 4000, 7000, 0.7, 0.15);
    } else {
      this.clang(w, 1240, GLASS, 0.12, 0.07 * vol);
      this.tone(w, 'triangle', 200, 150, 0.08, 0.08 * vol, 0.003, 0.05);
    }
  }

  /** 스태미나 바닥 — 헉. */
  gasp(vol = 1) {
    this.noise(this.world, 0.24, 0.22 * vol, 'bandpass', 1300, 800, 2.2, 0.09);
  }

  /** 처형 시작 — 낮은 예고음. */
  executeStart(vol = 1) {
    this.tone(this.world, 'sine', 55, 62, 0.65, 0.3 * vol, 0.3);
    this.noise(this.world, 0.6, 0.11 * vol, 'bandpass', 300, 1500, 1.2, 0.5);
  }

  lockOn(on) {
    this.tone(this.ui, 'sine', on ? 1250 : 820, on ? 1250 : 700, 0.05, 0.05, 0.002);
  }

  rested() {
    const notes = [220, 277.2, 329.6];
    for (let i = 0; i < notes.length; i++) this.tone(this.world, 'sine', notes[i], notes[i], 1.5, 0.07, 0.4, i * 0.12);
    this.noise(this.world, 1.2, 0.05, 'lowpass', 500, 900, 0.7, 0.5);
  }

  /** 사망 스팅어 — 낮게 가라앉는 종. */
  died() {
    const w = this.world;
    this.clang(w, 196, BELL, 2.8, 0.2);
    this.clang(w, 155.6, BELL, 2.6, 0.13, 0.35);
    this.tone(w, 'sine', 58, 41, 2.4, 0.3, 0.2);
    this.noise(w, 1.8, 0.07, 'lowpass', 900, 150, 0.7, 0.4);
  }

  // ───────────────────────── 보스 ─────────────────────────

  /** 예고음: 0.25초 이하의 짧은 준비음. danger면 날카로운 경고음을 겹친다(패링 불가 신호). */
  windup(glow, vol = 1) {
    const w = this.world;
    if (glow === 'fire') {
      this.noise(w, 0.24, 0.13 * vol, 'bandpass', 380, 1300, 1.2, 0.16);
      this.tone(w, 'sine', 150, 200, 0.22, 0.09 * vol, 0.1);
    } else if (glow === 'frost') {
      this.tone(w, 'sine', 880, 1320, 0.22, 0.05 * vol, 0.1);
      this.noise(w, 0.2, 0.07 * vol, 'highpass', 2500, 4500, 0.7, 0.12);
    } else if (glow === 'void') {
      const o = this._lowpassed(w, 900, 0.24, 0.1 * vol, 0.1);
      this._saw(o, 220, 0.24);
      this._saw(o, 233.1, 0.24);
    } else {
      // none · danger 공통: 낮은 숨 고르기
      this.tone(w, 'sine', 145, 112, 0.2, 0.11 * vol, 0.04);
      this.noise(w, 0.16, 0.07 * vol, 'lowpass', 420, 260, 0.8, 0.05);
    }
    if (glow === 'danger') {
      this.tone(w, 'square', 1568, 1568, 0.09, 0.11 * vol, 0.002);
      this.tone(w, 'square', 2093, 2093, 0.16, 0.13 * vol, 0.002, 0.09);
      this.clang(w, 2093, BRIGHT, 0.3, 0.05 * vol, 0.09);
    }
  }

  /** 보스의 큰 휘두르기(판정 시작). */
  bossSwing(vol = 1) {
    this.noise(this.world, 0.32, 0.4 * vol, 'bandpass', 190, 900, 1.0, 0.1);
    this.tone(this.world, 'sine', 74, 50, 0.16, 0.16 * vol, 0.02);
  }

  /**
   * 큐 어휘 16종 중 한 번 울리고 끝나는 것들(브레스 · 광선의 시작은 loopStart).
   * @param {string} cue @param {string} style
   */
  cue(cue, style, vol = 1) {
    const w = this.world;
    switch (cue) {
      case 'roar':
        this._roar(1, 1.25, vol);
        break;
      case 'howl':
        this._howl(vol);
        break;
      case 'slam':
        this._impact(1, vol);
        break;
      case 'stomp':
        this._impact(0.6, vol);
        break;
      case 'land':
        this._impact(1.2, vol);
        this.noise(w, 0.7, 0.2 * vol, 'lowpass', 160, 70, 0.7, 0.02);
        break;
      case 'whoosh':
        // 무기가 출발한다 — 타격 박자를 알리는 소리라 또렷하게
        this.noise(w, 0.2, 0.42 * vol, 'bandpass', 320, 1500, 1.5, 0.12);
        this.noise(w, 0.14, 0.12 * vol, 'highpass', 3000, 5000, 0.7, 0.09);
        break;
      case 'charge_start':
        this.noise(w, 0.6, 0.28 * vol, 'bandpass', 150, 760, 1.0, 0.25);
        this._saw(this._lowpassed(w, 500, 0.55, 0.16 * vol, 0.2), 58, 0.55, 112);
        break;
      case 'cast':
        if (style === 'frost') {
          for (const f of [1175, 1760, 2349]) this.tone(w, 'sine', f, f * 1.01, 0.45, 0.05 * vol, 0.05);
        } else if (style === 'void') {
          const o = this._lowpassed(w, 850, 0.5, 0.12 * vol, 0.08);
          this._saw(o, 110, 0.5);
          this._saw(o, 116.5, 0.5);
          this.tone(w, 'sine', 660, 330, 0.4, 0.06 * vol, 0.03);
        } else {
          this.noise(w, 0.4, 0.24 * vol, 'bandpass', 800, 2500, 1.4, 0.2);
          this.tone(w, 'sine', 440, 660, 0.35, 0.11 * vol, 0.08);
        }
        break;
      case 'blink_out':
        this.tone(w, 'sine', 920, 140, 0.2, 0.13 * vol, 0.004);
        this.noise(w, 0.2, 0.11 * vol, 'bandpass', 2200, 380, 1.5, 0.01);
        break;
      case 'blink_in':
        this.tone(w, 'sine', 150, 940, 0.14, 0.12 * vol, 0.02);
        this.tone(w, 'sine', 210, 76, 0.1, 0.22 * vol, 0.003, 0.12);
        this.noise(w, 0.12, 0.12 * vol, 'bandpass', 500, 2400, 1.4, 0.03, 0.04);
        break;
      case 'enchant':
        this.noise(w, 0.7, 0.34 * vol, 'lowpass', 280, 3200, 0.8, 0.3);
        this.tone(w, 'sine', 110, 220, 0.6, 0.16 * vol, 0.2);
        for (let i = 0; i < 6; i++) this.noise(w, 0.02, rr(0.05, 0.14) * vol, 'highpass', rr(1800, 4200), 3000, 0.7, 0.002, 0.25 + rand() * 0.6);
        break;
      case 'shatter':
        this.noise(w, 0.28, 0.26 * vol, 'highpass', 3200, 1800, 0.7, 0.002);
        this.clang(w, 2400, GLASS, 0.45, 0.1 * vol);
        for (let i = 0; i < 5; i++) this.clang(w, rr(1800, 4200), GLASS, 0.12, 0.04 * vol, 0.04 + rand() * 0.3);
        break;
      default:
        break;
    }
  }

  /** 2페이즈 전환 스팅어. */
  phaseChange(vol = 1) {
    const w = this.world;
    this.tone(w, 'sine', 52, 24, 1.4, 0.55 * vol, 0.01);
    this.noise(w, 1.2, 0.2 * vol, 'lowpass', 2400, 160, 0.7, 0.01);
    const o = this._lowpassed(w, 1200, 1.6, 0.14 * vol, 0.25);
    this._saw(o, 110, 1.6);
    this._saw(o, 116.5, 1.6);
    this._saw(o, 164.8, 1.6);
  }

  /** 체간 붕괴 — 무너지는 소리. */
  groggy(vol = 1) {
    const w = this.world;
    this.tone(w, 'sawtooth', 300, 68, 0.5, 0.08 * vol, 0.01);
    this.clang(w, 415, METAL, 0.5, 0.14 * vol);
    this.tone(w, 'sine', 90, 36, 0.3, 0.42 * vol, 0.004, 0.32);
    this.noise(w, 0.25, 0.16 * vol, 'lowpass', 500, 160, 0.7, 0.004, 0.32);
  }

  teleport(vol = 1) {
    this.tone(this.world, 'sine', 600, 1300, 0.09, 0.05 * vol, 0.01);
  }

  /** 격파 스팅어 — 밝게 열리는 화음. */
  defeated() {
    const w = this.world;
    this.tone(w, 'sine', 60, 30, 1.2, 0.45, 0.01);
    this.noise(w, 0.8, 0.16, 'lowpass', 2000, 200, 0.7, 0.01);
    this.clang(w, 392, [1, 2, 3, 4.2], 2.8, 0.16, 0.15);
    const chord = [293.7, 440, 587.3, 740];
    for (let i = 0; i < chord.length; i++) this.tone(w, 'triangle', chord[i], chord[i], 2.6, 0.07, 0.25, 0.3 + i * 0.13);
  }

  // ───────────────────────── 투사체 · 장판 ─────────────────────────

  projectileSpawn(style, vol = 1) {
    const f = (STYLE_PITCH[style] ?? 311) * 2;
    this.tone(this.world, 'sine', f, f * 0.4, 0.2, 0.11 * vol, 0.005);
    this.noise(this.world, 0.12, 0.07 * vol, 'bandpass', 1600, 700, 1.4, 0.01);
  }

  /** @param {string} reason hit · guard · parry · wall · expire ('clear'는 부르지 않는다) */
  projectileEnd(reason, vol = 1) {
    const w = this.world;
    if (reason === 'expire') {
      this.noise(w, 0.16, 0.06 * vol, 'bandpass', 1300, 600, 1.2, 0.02);
      return;
    }
    this.tone(w, 'sine', 210, 58, 0.22, 0.3 * vol, 0.003);
    this.noise(w, 0.26, 0.2 * vol, 'lowpass', 1700, 280, 0.7, 0.003);
    if (reason === 'parry') this.clang(w, 1568, BRIGHT, 0.5, 0.1 * vol);
    else if (reason === 'guard') this.clang(w, 520, METAL, 0.16, 0.1 * vol);
  }

  /** 장판 생성의 작은 경고음. */
  hazardWarn(style, vol = 1) {
    const f = STYLE_PITCH[style] ?? 392;
    this.tone(this.world, style === 'void' ? 'triangle' : 'sine', f * 2, f * 1.9, 0.07, 0.045 * vol, 0.004);
  }

  /** 장판 분출(kind별). */
  hazardBurst(kind, vol = 1) {
    const w = this.world;
    switch (kind) {
      case 'shockwave':
        this.noise(w, 0.7, 0.26 * vol, 'lowpass', 220, 1000, 0.8, 0.08);
        this.tone(w, 'sine', 62, 38, 0.5, 0.28 * vol, 0.01);
        break;
      case 'fire_trail':
        this.noise(w, 0.5, 0.42 * vol, 'bandpass', 480, 1600, 1.0, 0.1);
        this.noise(w, 0.5, 0.2 * vol, 'lowpass', 300, 200, 0.7, 0.1);
        break;
      case 'fire_pillar':
        this.tone(w, 'sine', 88, 34, 0.45, 0.42 * vol, 0.004);
        this.noise(w, 0.55, 0.28 * vol, 'bandpass', 400, 2200, 0.9, 0.05);
        break;
      case 'ice_spike':
        this.noise(w, 0.13, 0.17 * vol, 'highpass', 2600, 1800, 0.7, 0.002);
        this.clang(w, 1850, GLASS, 0.3, 0.09 * vol);
        this.tone(w, 'sine', 130, 55, 0.14, 0.26 * vol, 0.003);
        break;
      case 'void_burst': {
        this.tone(w, 'sine', 94, 28, 0.55, 0.45 * vol, 0.004);
        this.noise(w, 0.45, 0.24 * vol, 'lowpass', 1500, 180, 0.7, 0.004);
        const o = this._lowpassed(w, 700, 0.45, 0.1 * vol, 0.01);
        this._saw(o, 138.6, 0.45, 69.3);
        this._saw(o, 146.8, 0.45, 73.4);
        break;
      }
      case 'void_sword':
        this.tone(w, 'sine', 185, 68, 0.11, 0.14 * vol, 0.002);
        this.clang(w, 930, METAL, 0.22, 0.06 * vol);
        this.noise(w, 0.05, 0.07 * vol, 'highpass', 3500, 3500, 0.7, 0.002);
        break;
      default:
        this.tone(w, 'sine', 120, 50, 0.25, 0.25 * vol, 0.004);
    }
  }

  // ───────────────────────── 성장 · UI ─────────────────────────

  levelUp() {
    const notes = [523.3, 659.3, 784, 1046.5];
    for (let i = 0; i < notes.length; i++) this.tone(this.ui, 'triangle', notes[i], notes[i], 0.4, 0.15, 0.008, i * 0.075);
    this.tone(this.ui, 'sine', 1568, 1568, 0.7, 0.075, 0.02, 0.3);
  }

  weaponUpgraded() {
    this.clang(this.ui, 880, [1, 2.4, 3.9], 0.55, 0.16);
    this.noise(this.ui, 0.04, 0.14, 'highpass', 3000, 3000, 0.7, 0.002);
    this.tone(this.ui, 'triangle', 659.3, 659.3, 0.3, 0.07, 0.01, 0.16);
    this.tone(this.ui, 'triangle', 987.8, 987.8, 0.45, 0.07, 0.01, 0.26);
  }

  purchased() {
    this.tone(this.ui, 'triangle', 660, 660, 0.12, 0.13, 0.004);
    this.tone(this.ui, 'triangle', 990, 990, 0.25, 0.13, 0.004, 0.08);
  }

  weaponEquipped() {
    this.noise(this.ui, 0.11, 0.1, 'bandpass', 2600, 1200, 1.4, 0.02);
    this.clang(this.ui, 1040, METAL, 0.14, 0.06, 0.07);
  }

  relicEquipped() {
    this.tone(this.ui, 'sine', 1319, 1319, 0.4, 0.09, 0.005);
    this.tone(this.ui, 'sine', 1760, 1760, 0.5, 0.075, 0.005, 0.07);
  }

  cycleAdvanced() {
    this.clang(this.ui, 261.6, BELL, 3, 0.16);
    this.clang(this.ui, 392, BELL, 2.4, 0.08, 0.2);
  }

  /** @param {'hover'|'click'|'confirm'|'deny'} kind */
  uiSound(kind) {
    const u = this.ui;
    if (kind === 'hover') {
      this.tone(u, 'sine', 700, 700, 0.035, 0.03, 0.003);
    } else if (kind === 'click') {
      this.tone(u, 'sine', 540, 430, 0.06, 0.08, 0.002);
      this.noise(u, 0.02, 0.04, 'highpass', 3000, 3000, 0.7, 0.001);
    } else if (kind === 'confirm') {
      this.tone(u, 'triangle', 660, 660, 0.09, 0.08, 0.003);
      this.tone(u, 'triangle', 990, 990, 0.16, 0.08, 0.003, 0.07);
    } else {
      this._saw(this._lowpassed(u, 600, 0.16, 0.1, 0.004), 185, 0.16, 140);
    }
  }

  /** 패널 여닫이. @param {boolean} open */
  uiPanel(open) {
    this.noise(this.ui, 0.13, 0.1, 'bandpass', open ? 600 : 1400, open ? 1500 : 560, 1.2, 0.04);
  }

  // ───────────────────────── 지속음(seq로 시작과 끝을 짝짓는다) ─────────────────────────

  /**
   * 브레스 · 광선의 지속음을 켠다. 같은 키가 이미 있으면 무시한다.
   * @param {string} key @param {'breath'|'beam'} type @param {string} style
   */
  loopStart(key, type, style, vol = 1) {
    if (this._loops.has(key)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.connect(this.world);
    /** @type {AudioScheduledSourceNode[]} */
    const nodes = [];
    const noiseSrc = (ftype, freq, q, level) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = ftype;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      s.connect(f).connect(g).connect(gain);
      s.start(t, rand());
      nodes.push(s);
    };
    if (type === 'breath') {
      noiseSrc('bandpass', style === 'frost' ? 1500 : 650, 0.7, 0.9);
      noiseSrc('highpass', 4200, 0.7, 0.22);
      noiseSrc('lowpass', 220, 0.7, 0.5);
      gain.gain.linearRampToValueAtTime(0.22 * vol, t + 0.14);
    } else {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const trem = ctx.createGain();
      trem.gain.value = 0.75;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.25;
      lfo.connect(lfoGain).connect(trem.gain);
      lp.connect(trem).connect(gain);
      for (const f of [98, 98.7, 196.4]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start(t);
        nodes.push(o);
      }
      lfo.start(t);
      nodes.push(lfo);
      noiseSrc('bandpass', 3000, 1.2, 0.35);
      gain.gain.linearRampToValueAtTime(0.12 * vol, t + 0.08);
      // 발사 순간의 찢는 소리
      this.noise(this.world, 0.3, 0.22 * vol, 'bandpass', 2400, 500, 1.2, 0.01);
      this.tone(this.world, 'sine', 180, 60, 0.3, 0.3 * vol, 0.004);
    }
    this._loops.set(key, { gain, nodes });
  }

  /** @param {string} key */
  loopStop(key) {
    const l = this._loops.get(key);
    if (!l) return;
    this._loops.delete(key);
    const t = this.ctx.currentTime;
    // 올라가는 도중에 끊겨도 튀지 않게 지금 값에서 내려간다
    if (typeof l.gain.gain.cancelAndHoldAtTime === 'function') l.gain.gain.cancelAndHoldAtTime(t);
    else l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setTargetAtTime(0.0001, t, 0.07);
    for (const n of l.nodes) n.stop(t + 0.45);
  }

  loopStopAll() {
    for (const key of [...this._loops.keys()]) this.loopStop(key);
  }

  // ───────────────────────── 내부 합성 ─────────────────────────

  /** 로우패스 + 포락선 묶음을 만들어 입력 노드를 돌려준다(톱니파 여럿을 한 필터로). */
  _lowpassed(dest, cutoff, dur, peak, attack) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    this._env(g, t, attack, peak, dur);
    f.connect(g).connect(dest);
    return f;
  }

  /** 포락선 없는 톱니파(받는 쪽 묶음이 포락선을 가진다). */
  _saw(dest, f0, dur, f1 = f0) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** 포효: 저역 FM(거친 떨림) + 잡음. */
  _roar(pitch, dur, vol) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._lowpassed(this.world, 1100, dur, 0.34 * vol, 0.1);
    out.frequency.setValueAtTime(500, t);
    out.frequency.linearRampToValueAtTime(1300, t + dur * 0.25);
    out.frequency.linearRampToValueAtTime(420, t + dur);
    for (const f of [72 * pitch, 108.6 * pitch]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.linearRampToValueAtTime(f * 1.15, t + dur * 0.2);
      o.frequency.linearRampToValueAtTime(f * 0.72, t + dur);
      // 거친 떨림: 낮은 주파수로 음높이를 흔든다
      const m = ctx.createOscillator();
      m.frequency.value = 29;
      const mg = ctx.createGain();
      mg.gain.value = f * 0.22;
      m.connect(mg).connect(o.frequency);
      o.connect(out);
      o.start(t); m.start(t);
      o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
    }
    this.noise(this.world, dur, 0.2 * vol, 'bandpass', 420, 900, 0.6, 0.12);
    this.tone(this.world, 'sine', 48, 34, dur, 0.3 * vol, 0.1);
  }

  /** 늑대 울음: 떨리며 올랐다 내려오는 음 + 숨소리. */
  _howl(vol) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.5;
    const out = this._lowpassed(this.world, 1800, dur, 0.2 * vol, 0.25);
    for (const [mul, type] of [[1, 'triangle'], [2, 'sine'], [0.5, 'sawtooth']]) {
      const o = ctx.createOscillator();
      o.type = /** @type {OscillatorType} */ (type);
      o.frequency.setValueAtTime(300 * mul, t);
      o.frequency.exponentialRampToValueAtTime(545 * mul, t + 0.4);
      o.frequency.setValueAtTime(545 * mul, t + 0.9);
      o.frequency.exponentialRampToValueAtTime(380 * mul, t + dur);
      const v = ctx.createOscillator();
      v.frequency.value = 5.6;
      const vg = ctx.createGain();
      vg.gain.value = 7 * mul;
      v.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = mul === 1 ? 1 : 0.35;
      o.connect(g).connect(out);
      o.start(t); v.start(t);
      o.stop(t + dur + 0.05); v.stop(t + dur + 0.05);
    }
    this.noise(this.world, dur, 0.09 * vol, 'bandpass', 700, 1100, 1.5, 0.3);
  }

  /** 바닥 충격: 낮은 쿵 + 잡음 + 부스러기. */
  _impact(power, vol) {
    const w = this.world;
    this.tone(w, 'sine', 82, 27, 0.5 * power, 0.6 * Math.min(1, power) * vol, 0.003);
    this.noise(w, 0.4 * power, 0.36 * Math.min(1, power) * vol, 'lowpass', 1300, 180, 0.7, 0.003);
    for (let i = 0; i < 3; i++) this.noise(w, 0.03, rr(0.04, 0.1) * vol, 'highpass', rr(1500, 3000), 2000, 0.7, 0.002, 0.07 + rand() * 0.22);
  }
}
