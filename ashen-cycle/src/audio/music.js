// OWNER: P7 — 계약 §9.7
// 분위기 음 4종(마을 패드 + 모닥불 크래클 · 보스 3종 드론 + 타악 펄스) + 2페이즈 층. 전부 합성.
// 드론은 계속 도는 오실레이터 묶음이고, 타악은 update에서 조금 앞(LOOKAHEAD)까지만 예약한다.

/**
 * @typedef {Object} TrackDef
 * @property {number} root              근음(Hz)
 * @property {number[][]} voices        [배율, 디튠(cent), 게인, 파형 번호] — 항상 도는 드론
 * @property {number[][]} voices2       2페이즈에 더해지는 드론
 * @property {[number, number]} cutoff  드론 로우패스 [잔잔할 때, 격할 때] Hz
 * @property {number} wind              바람 잡음 게인(0이면 없음)
 * @property {number} bpm               0이면 타악 없음
 * @property {[number, number, number]} drum  북: [시작 Hz, 끝 Hz, 길이 초]
 * @property {number[]} drumSteps       16분음표 16칸 중 북이 치는 칸(첫 칸과 9번째 칸은 세게)
 * @property {number[]} tickSteps       잔 타악
 * @property {number[]} drumSteps2      2페이즈에 더해지는 칸
 * @property {number[]} tickSteps2
 * @property {number[][]} stabs2        2페이즈의 짧은 저음 찌르기: [칸, 근음 배율]
 * @property {boolean} crackle          모닥불 크래클(마을)
 */

const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
const SINE = 0, TRI = 1, SAW = 2, SQR = 3;

/** @type {Record<string, TrackDef>} */
const TRACKS = {
  // 마을: 낮은 패드(D) + 모닥불
  town: {
    root: 73.42,
    voices: [[1, 0, 0.13, TRI], [1.5, 4, 0.08, SINE], [2, -6, 0.06, SINE], [3, 3, 0.025, SINE], [0.5, 0, 0.04, SINE]],
    voices2: [],
    cutoff: [420, 700], wind: 0.012, bpm: 0,
    drum: [0, 0, 0], drumSteps: [], tickSteps: [], drumSteps2: [], tickSteps2: [], stabs2: [],
    crackle: true,
  },
  // 발더: 묵직한 D 드론 + 전쟁 북
  valder: {
    root: 73.42,
    voices: [[1, 0, 0.1, SAW], [1, 9, 0.085, SAW], [1.5, -4, 0.045, SAW], [0.5, 0, 0.06, SINE]],
    voices2: [[2, -7, 0.08, SAW], [2.378, 5, 0.065, SAW], [1.0595, 0, 0.03, SQR]],
    cutoff: [240, 1150], wind: 0, bpm: 92,
    drum: [98, 42, 0.34], drumSteps: [0, 6, 8, 14], tickSteps: [],
    drumSteps2: [3, 10, 12], tickSteps2: [2, 6, 10, 14], stabs2: [[0, 2], [3, 2], [6, 2.378], [8, 2], [11, 2], [14, 1.782]],
    crackle: false,
  },
  // 펜리르: 차가운 E + 바람 + 빠른 북
  fenrir: {
    root: 82.41,
    voices: [[1, 0, 0.12, TRI], [1, 12, 0.06, SAW], [1.498, 0, 0.065, SINE], [4, 7, 0.02, SINE], [0.5, 0, 0.05, SINE]],
    voices2: [[2, -8, 0.08, SAW], [2.997, 6, 0.05, SAW]],
    cutoff: [320, 1500], wind: 0.05, bpm: 116,
    drum: [142, 60, 0.2], drumSteps: [0, 4, 7, 8, 12, 15], tickSteps: [2, 10],
    drumSteps2: [3, 11], tickSteps2: [0, 4, 6, 8, 12, 14], stabs2: [[0, 2], [2, 2], [4, 2.378], [6, 2], [8, 2], [10, 2], [12, 2.67], [14, 2.378]],
    crackle: false,
  },
  // 니힐: 맥놀이하는 C# + 삼온음 + 심장 박동
  nihil: {
    root: 69.3,
    voices: [[1, 0, 0.12, SINE], [1, -10, 0.065, SAW], [1.414, 0, 0.048, SAW], [2.01, 0, 0.05, SINE], [0.5, 0, 0.06, SINE]],
    voices2: [[2.828, 0, 0.045, SAW], [1.888, 6, 0.03, SQR], [2, 9, 0.065, SAW]],
    cutoff: [210, 1050], wind: 0.02, bpm: 76,
    drum: [62, 31, 0.42], drumSteps: [0, 2, 8, 10], tickSteps: [12],
    drumSteps2: [5, 13], tickSteps2: [4, 7, 15], stabs2: [[0, 2], [6, 2.828], [12, 2.378]],
    crackle: false,
  },
};

/** 타악을 미리 예약하는 시간(초) */
const LOOKAHEAD = 0.18;
const FADE_TC = 0.45;          // 트랙 전환 · 레벨 변화의 시상수(초)
const STOP_AFTER = 2.5;        // 페이드아웃 뒤 노드를 멈추기까지(초)
const CRACKLE_RATE = 10;       // 초당 크래클 수(가장 가까울 때)

/** 재생 중인 트랙 하나의 노드 묶음. */
class Track {
  /**
   * @param {AudioContext} ctx @param {AudioNode} out @param {TrackDef} def @param {AudioBuffer} noiseBuf
   */
  constructor(ctx, out, def, noiseBuf) {
    this.ctx = ctx;
    this.def = def;
    const t = ctx.currentTime;
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.connect(out);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = def.cutoff[0];
    this.filter.Q.value = 0.8;
    this.filter.connect(this.gain);
    this.layer2 = ctx.createGain();
    this.layer2.gain.value = 0.0001;
    this.layer2.connect(this.filter);
    this.drumGain = ctx.createGain();
    this.drumGain.gain.value = 0.0001;
    this.drumGain.connect(this.gain);
    /** @type {AudioScheduledSourceNode[]} */
    this.sources = [];
    const voice = (v, dest) => {
      const o = ctx.createOscillator();
      o.type = /** @type {OscillatorType} */ (WAVES[v[3]]);
      o.frequency.value = def.root * v[0];
      o.detune.value = v[1];
      const g = ctx.createGain();
      g.gain.value = v[2];
      o.connect(g).connect(dest);
      o.start(t);
      this.sources.push(o);
    };
    for (const v of def.voices) voice(v, this.filter);
    for (const v of def.voices2) voice(v, this.layer2);
    // 필터를 천천히 흔들어 드론이 숨 쉬게 한다
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = def.cutoff[0] * 0.25;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start(t);
    this.sources.push(lfo);
    if (def.wind > 0 || def.crackle) {
      // 바람 · 불의 낮은 숨: 밴드패스 잡음을 느리게 흔든다
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      s.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = def.crackle ? 320 : 520;
      f.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = def.wind;
      const wl = ctx.createOscillator();
      wl.frequency.value = 0.17;
      const wlg = ctx.createGain();
      wlg.gain.value = 180;
      wl.connect(wlg).connect(f.frequency);
      s.connect(f).connect(this.windGain).connect(this.gain);
      s.start(t);
      wl.start(t);
      this.sources.push(s, wl);
    }
    this.step = 0;
    this.nextStepTime = t + 0.1;
  }

  /** 페이드아웃 뒤 멈춘다. */
  release() {
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(0.0001, t, FADE_TC);
    for (const s of this.sources) s.stop(t + STOP_AFTER);
  }
}

export class Music {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} out 음악 버스
   * @param {AudioBuffer} noiseBuf 공용 잡음 버퍼
   */
  constructor(ctx, out, noiseBuf) {
    this.ctx = ctx;
    this.out = out;
    this.noiseBuf = noiseBuf;
    /** @type {Track|null} */
    this.track = null;
    /** @type {string|null} */
    this.trackId = null;
    this._drums = false;
  }

  /**
   * 분위기 음을 바꾼다(교차 페이드). 같은 id면 아무것도 하지 않는다.
   * @param {string|null} id 'town' | 'valder' | 'fenrir' | 'nihil' | null(무음)
   */
  setTrack(id) {
    if (id === this.trackId) return;
    if (this.track) this.track.release();
    this.track = null;
    this.trackId = id;
    this._drums = false;
    const def = id ? TRACKS[id] : null;
    if (def) this.track = new Track(this.ctx, this.out, def, this.noiseBuf);
  }

  /**
   * 매 프레임: 세기를 반영하고 타악 · 크래클을 조금 앞까지 예약한다.
   * @param {number} dt
   * @param {{level:number, intensity:number, phase2:boolean, drums:boolean, crackle:number}} p
   *   level 트랙 전체 크기 0..1 · intensity 격함 0..1(필터 · 북 세기) · phase2 2페이즈 층 · drums 타악 켬 · crackle 모닥불 가까움 0..1
   */
  update(dt, p) {
    const tr = this.track;
    if (!tr) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const def = tr.def;
    const k = Math.min(1, Math.max(0, p.intensity));
    tr.gain.gain.setTargetAtTime(Math.max(0.0001, p.level), now, FADE_TC);
    tr.filter.frequency.setTargetAtTime(def.cutoff[0] + (def.cutoff[1] - def.cutoff[0]) * k * (p.phase2 ? 1 : 0.75), now, 0.6);
    tr.layer2.gain.setTargetAtTime(p.phase2 ? 1 : 0.0001, now, 0.8);
    tr.drumGain.gain.setTargetAtTime(p.drums ? 0.55 + 0.45 * k : 0.0001, now, 0.25);

    if (def.bpm > 0) {
      const stepDur = 60 / def.bpm / 4;
      // 탭이 숨었다 돌아오면 밀린 박을 몰아 치지 않고 지금부터 다시 센다
      if (tr.nextStepTime < now - 0.25) tr.nextStepTime = now + 0.05;
      if (p.drums && !this._drums) { tr.step = 0; tr.nextStepTime = now + 0.08; }
      this._drums = p.drums;
      while (tr.nextStepTime < now + LOOKAHEAD) {
        if (p.drums) this._scheduleStep(tr, tr.step, tr.nextStepTime, p.phase2);
        tr.step = (tr.step + 1) % 16;
        tr.nextStepTime += stepDur;
      }
    }
    if (def.crackle && dt > 0) {
      const c = Math.min(1, Math.max(0, p.crackle));
      if (tr.windGain) tr.windGain.gain.setTargetAtTime(def.wind + 0.03 * c, now, 0.5);
      let n = CRACKLE_RATE * c * dt;
      n = Math.floor(n + Math.random());
      for (let i = 0; i < n; i++) this._crackle(tr, now + Math.random() * 0.1, c);
    }
  }

  /** @param {Track} tr @param {number} step @param {number} t @param {boolean} phase2 */
  _scheduleStep(tr, step, t, phase2) {
    const def = tr.def;
    const accent = step === 0 || step === 8;
    if (def.drumSteps.includes(step) || (phase2 && def.drumSteps2.includes(step))) {
      this._drum(tr, t, accent ? 0.62 : 0.4, def.drum);
    }
    if (def.tickSteps.includes(step) || (phase2 && def.tickSteps2.includes(step))) this._tick(tr, t, 0.07);
    if (phase2) {
      for (const s of def.stabs2) if (s[0] === step) this._stab(tr, t, def.root * s[1]);
    }
  }

  /** 북: 음높이가 떨어지는 사인 + 가죽 치는 잡음. */
  _drum(tr, t, peak, drum) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(drum[0], t);
    o.frequency.exponentialRampToValueAtTime(drum[1], t + drum[2]);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + drum[2]);
    o.connect(g).connect(tr.drumGain);
    o.start(t);
    o.stop(t + drum[2] + 0.03);
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = drum[0] * 6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(peak * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    s.connect(f).connect(ng).connect(tr.drumGain);
    s.start(t, Math.random());
    s.stop(t + 0.08);
  }

  /** 잔 타악: 짧은 고역 잡음. */
  _tick(tr, t, peak) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 3200;
    f.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f).connect(g).connect(tr.drumGain);
    s.start(t, Math.random());
    s.stop(t + 0.07);
  }

  /** 2페이즈의 짧은 저음 찌르기(톱니파 · 로우패스). */
  _stab(tr, t, freq) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(f).connect(g).connect(tr.drumGain);
    o.start(t);
    o.stop(t + 0.19);
  }

  /** 모닥불 크래클 한 알. */
  _crackle(tr, t, level) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1500 + Math.random() * 3000;
    const g = ctx.createGain();
    const dur = 0.006 + Math.random() * 0.022;
    g.gain.setValueAtTime((0.06 + Math.random() * 0.2) * level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(tr.gain);
    s.start(t, Math.random());
    s.stop(t + dur + 0.01);
  }

  dispose() {
    if (this.track) this.track.release();
    this.track = null;
    this.trackId = null;
  }
}
