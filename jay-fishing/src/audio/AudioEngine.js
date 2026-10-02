// OWNER: P7 — 계약 §6.10 · §9.12
// 소리: WebAudio 합성 전부(외부 음원 0). AudioContext 는 unlock()(첫 사용자 제스처)에서만 만든다 — 그 전의 모든 호출은 조용히 무시.
// 그래프: 소스 → 버스(sfx · ambience · ui 게인) → 마스터 게인(volume.master) → 리미터(DynamicsCompressor) → 출력.
// 지속음(텐션 톤 · 라인 삐걱 · 드랙 클리커 · 릴 톱니 · 물살 · 로드 삐걱 · 환경음)은 unlock 때 한 번 만든 고정 노드다 —
//   게인을 움직이거나(30ms 평활) 게인에 짧은 펄스를 미리 예약해(클릭) 소리를 낸다. 판을 반복해도 노드가 늘지 않는다.
// 일회성 소리(이벤트)는 목소리로 만들고 끝나면 끊는다. 동시 목소리 상한 24 — 넘으면 가장 오래된 것을 끊는다.
// 상태는 읽기만 한다. 이벤트를 놓쳐도 update(state) 가 지속음을 상태에서 다시 맞춘다.

import { EV } from '../core/events.js';
import { clamp, clamp01 } from '../core/math.js';

// ── 그래프 · 공통
const LIMITER = { threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 };   // §9.12
const MAX_VOICES = 24;              // §9.12 동시 목소리 상한
const SMOOTH_TC = 0.03;             // s — 지속음 평활(§9.12 「30ms로 평활」)
const VOLUME_TC = 0.02;             // s — 볼륨 바꿈
const AMB_FADE_TC = 0.67;           // s — 환경음 교차(시정수 · 2초에 95%)
const NOISE_SECONDS = 2;            // 노이즈 버퍼 길이
const LOOKAHEAD = 0.12;             // s — 클릭 펄스를 이만큼 앞까지 예약한다
const FROZEN_AFTER = 0.15;          // s — sim 틱이 이만큼 멈춰 있으면(패널 · 일시정지 · 고정 상태) 파이팅 지속음을 낮춘다
const EPS = 1e-4;

// ── 파이팅 지속음
const TENSION = {
  baseHz: 160, spanHz: 540, ratioCap: 1.1,       // §9.12 삼각파 160 + 540 × clamp(sqrt(limitRatio), 0, 1.1) Hz
  gainBase: 0.02, gainSpan: 0.10,                // §9.12 게인 0.02 + 0.10 × limitRatio
  ratioMax: 1.2,                                 // 게인 계산에 쓰는 limitRatio 상한(스파이크 보호)
  creakFrom: 0.85, creakSpan: 0.15,              // §9.12 0.85 부터 (ratio − 0.85) / 0.15 만큼 삐걱
  creakLoHz: 800, creakHiHz: 1500, creakQ: 7,    // §9.12 밴드패스 800–1500Hz
  creakGain: 0.22,
};
const CLICKER = { base: 6, perSlip: 40, maxRate: 90, clickS: 0.003, gain: 0.55, hpHz: 3200 };   // §9.12 초당 6 + 40 × slipSpeed · 3ms 고역 노이즈
const RATCHET = { base: 10, perSpeed: 25, maxRate: 80, clickS: 0.004, gain: 0.16, bpHz: 2300, Q: 3, retrieveMaxSpeed: 4 };   // §9.12 초당 10 + 25 × 속도
const SWISH = { gain: 0.22, slipRef: 2.0, minMix: 0.25, bpHz: 850, Q: 0.7 };
const ROD_CREAK = { period: 0.38, attack: 0.03, dur: 0.18, gain: 0.32, hz: 420, Q: 10 };

// ── 환경음 층(절대 게인) · 씬 × 시간대 표 — 값 0..1 은 층 게인에 곱한다
const AMB_GAIN = { wind: 0.10, waves: 0.34, river: 0.30, dam: 0.30, room: 0.06, tick: 0.10, rain: 0.16, crickets: 0.03, birds: 0.07, gulls: 0.055 };
const BAND5 = (dawn, morning, day, evening, night) => ({ dawn, morning, day, evening, night });
const AMBIENCE = {
  lake:   { wind: BAND5(0.2, 0.45, 0.7, 0.4, 0.12), waves: 0.12, birds: BAND5(1, 0.6, 0.25, 0.2, 0), crickets: BAND5(0, 0, 0, 0.45, 1) },
  waves:  { wind: BAND5(0.3, 0.4, 0.5, 0.45, 0.3), waves: 1, gulls: BAND5(0.3, 0.8, 1, 0.4, 0) },
  river:  { wind: 0.15, river: 1, dam: 1, birds: BAND5(0.5, 0.3, 0.1, 0.1, 0), crickets: BAND5(0, 0, 0, 0.2, 0.4) },
  indoor: { room: 1, tick: 1 },
};
const SCENE_AMBIENCE = { home: 'indoor', lake: 'lake', coast: 'waves', river: 'river' };
const AMB_LAYERS = ['wind', 'waves', 'river', 'dam', 'room', 'tick', 'rain', 'crickets', 'birds', 'gulls'];
const AMB_I = Object.fromEntries(AMB_LAYERS.map((k, i) => [k, i]));
const WIND = { lpHz: 480 };
const WAVES = { lpHz: 420, lfoDepth: 0.45, minPeriod: 1 };
const RIVER = { bpHz: 650, Q: 0.45, damLpHz: 70 };
const ROOM = { lpHz: 170 };
const TICK = { period: 1, bpHz: 3200, Q: 5, dur: 0.012 };
const RAIN = { hpHz: 3600 };
const CRICKET = { hz: 4300, chirpEvery: [0.55, 0.9], pulses: 3, pulseS: 0.022, gapS: 0.035 };
const BIRD = { every: [0.7, 3.2] };
const GULL = { every: [3, 9] };

// ── 일회성 소리 손잡이
const SFX = {
  castGain: 0.32, castLoHz: 380, castHiHz: 2400, castS: 0.25, perfectMul: 1.122,   // 완벽 = 한 음(온음) 높게
  splashGain: 0.4, splashDistRef: 100, splashMinAtt: 0.35,
  nibbleGain: [0.05, 0.22], takeGain: 0.32,
  bellHz: 2100, bellPartials: [1, 2.76, 5.4], bellAmps: [1, 0.45, 0.22], bellStrikeGap: 0.16,
  hookGain: 0.42, missGain: 0.22,
  teleGain: 0.22, gulpGain: 0.3, whistleGain: 0.05,
  jumpGain: 0.38, jumpLenRef: 0.5, jumpScale: [0.6, 2.0],
  shakeGain: [0.15, 0.45],
  snapGain: 0.4, crackGain: 0.45, tukGain: 0.2,
  netGain: 0.32, releaseGain: 0.2,
  dragGain: 0.1, bailGain: 0.12,
};
const UI_SND = { clickGain: 0.07, denyGain: 0.08, coinGain: 0.09, chimeGain: 0.08, chordGain: 0.09, fanfareGain: 0.1, arpGain: 0.09, keepGain: 0.1 };
const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, G4: 392, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, B4: 493.88 };

const rnd = (a, b) => a + Math.random() * (b - a);
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 매 프레임 바꾸는 파라미터의 마지막 목표 — 같은 값을 다시 예약하지 않는다 */
const P = { tensionHz: 0, tensionGain: 1, creakGain: 2, creakHz: 3, swishGain: 4, swishPan: 5 };

export class AudioEngine {
  /** @param {{bus:import('../core/events.js').EventBus, settings:import('../types.js').Settings}} deps — AudioContext 를 만들지 않는다 */
  constructor({ bus, settings }) {
    this.bus = bus;
    this.settings = settings;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.unavailable = false;
    this.disposed = false;
    this.paused = false;
    this.hidden = false;
    this.nodeCount = 0;
    /** @type {{tag:string, end:number, nodes:AudioNode[], sources:AudioScheduledSourceNode[], done:boolean}[]} */
    this.voices = [];
    this.g = null;                 // 고정 그래프(unlock 에서)
    this.last = new Float64Array(8).fill(NaN);
    this.ambLast = new Float64Array(AMB_LAYERS.length).fill(NaN);
    this.ambTarget = new Float64Array(AMB_LAYERS.length);
    this.lastTick = -1;
    this.frozenT = 0;
    /** @type {Object|null} FIGHT_END · FISHING_EXIT · SCENE_CHANGED 로 끝낸 파이팅 — 같은 객체면 지속음을 다시 켜지 않는다 */
    this.endedFight = null;
    this.lastFight = null;
    this.clickNext = 0;
    this.ratchetNext = 0;
    this.rodNext = 0;
    this.tickNext = 0;
    this.cricketNext = 0;
    this.birdNext = 0;
    this.gullNext = 0;
    this.dragNotch = null;
    this.wavePeriod = 0;

    this._onVis = () => {
      this.hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      this._applySuspend();
    };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', this._onVis);
      this.hidden = document.visibilityState === 'hidden';
    }
    this._offs = this._subscribe(bus);
  }

  // ───────────────────────── 공개 API

  /** 첫 사용자 제스처(키 · 클릭)에서 app 이 부른다 — 여기서만 AudioContext 를 만든다 */
  unlock() {
    if (this.disposed || this.unavailable) return;
    if (this.ctx) {
      this._applySuspend();
      return;
    }
    const AC = globalThis.AudioContext || /** @type {any} */ (globalThis).webkitAudioContext;
    if (!AC) {
      this.unavailable = true;
      console.warn('[audio] WebAudio unavailable');
      return;
    }
    let ctx = null;
    try {
      ctx = new AC();
      this.ctx = ctx;
      this._build();
    } catch (e) {
      // 소리 없이 계속 돈다(게임을 막지 않는다) — 사유는 경고로 남긴다
      console.warn('[audio] init failed', e);
      this.unavailable = true;
      this.ctx = null;
      this.g = null;
      this.nodeCount = 0;
      if (ctx && ctx.close) ctx.close().catch(() => {});
      return;
    }
    this.applySettings();
    this._applySuspend();
  }

  /** 지속음(텐션 톤 · 클리커 · 릴 · 물살 · 환경음) @param {import('../types.js').GameState} state @param {number} dt */
  update(state, dt) {
    const ctx = this.ctx;
    if (!ctx || !this.g || !state) return;
    const now = ctx.currentTime;
    this._prune(now);

    // sim 이 멈춰 있는가(패널 · 일시정지 · 고정 상태) — 움직임 소리를 그대로 두지 않는다
    if (state.tick !== this.lastTick) {
      this.lastTick = state.tick;
      this.frozenT = 0;
    } else {
      this.frozenT += clamp(fin(dt, 0), 0, 1);
    }
    const frozen = this.frozenT >= FROZEN_AFTER;
    this._updateFight(state, now, frozen);
    this._updateAmbience(state, now);
  }

  /** 탭 숨김 · 일시정지 — suspend/resume @param {boolean} on */
  setPaused(on) {
    this.paused = !!on;
    this._applySuspend();
  }

  /** settings.volume 다시 읽기(마스터 · sfx · 환경음 · ui · ?mute) */
  applySettings() {
    const g = this.g;
    if (!this.ctx || !g) return;
    const s = this.settings || {};
    const v = s.volume || {};
    const mute = s.mute === true;
    const now = this.ctx.currentTime;
    g.master.gain.setTargetAtTime(mute ? 0 : clamp01(fin(v.master, 0.8)), now, VOLUME_TC);
    g.sfx.gain.setTargetAtTime(clamp01(fin(v.sfx, 1)), now, VOLUME_TC);
    g.amb.gain.setTargetAtTime(clamp01(fin(v.ambience, 0.7)), now, VOLUME_TC);
    g.ui.gain.setTargetAtTime(clamp01(fin(v.ui, 0.8)), now, VOLUME_TC);
  }

  /** @returns {{nodes:number, voices:number}} nodes = 지금 살아 있는 오디오 노드(고정 + 목소리) · voices = 일회성 목소리 수 */
  stats() {
    return { nodes: this.nodeCount, voices: this.voices.length };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this._offs) off();
    this._offs = [];
    if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', this._onVis);
    while (this.voices.length) this._release(this.voices[0]);
    if (this.g) {
      for (const s of this.g.sources) {
        try { s.stop(); } catch { /* 이미 멈춤 */ }
      }
      for (const n of this.g.nodes) n.disconnect();
    }
    this.g = null;
    this.nodeCount = 0;
    if (this.ctx) {
      const c = this.ctx;
      this.ctx = null;
      if (c.close) c.close().catch(() => {});
    }
  }

  // ───────────────────────── 그래프

  _build() {
    const ctx = /** @type {AudioContext} */ (this.ctx);
    /** @type {AudioNode[]} */
    const nodes = [];
    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];
    const add = (n) => { nodes.push(n); return n; };
    const gain = (v) => { const n = add(ctx.createGain()); n.gain.value = v; return n; };
    const filter = (type, hz, q) => {
      const f = add(ctx.createBiquadFilter());
      f.type = type;
      f.frequency.value = hz;
      if (q !== undefined) f.Q.value = q;
      return f;
    };

    // 출력: 버스 → 마스터 → 리미터 → destination
    const limiter = add(ctx.createDynamicsCompressor());
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    limiter.connect(ctx.destination);
    const master = gain(0);
    master.connect(limiter);
    const sfx = gain(1);
    const amb = gain(1);
    const ui = gain(1);
    sfx.connect(master);
    amb.connect(master);
    ui.connect(master);

    // 노이즈 버퍼 하나 · 루프 소스 셋(서로 다른 위치에서 시작 — 층끼리 같은 소리가 겹치지 않게)
    const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = (offset) => {
      const s = add(ctx.createBufferSource());
      s.buffer = buf;
      s.loop = true;
      s.start(0, offset * NOISE_SECONDS);
      sources.push(/** @type {any} */ (s));
      return s;
    };
    const nA = loop(0);
    const nB = loop(0.37);
    const nC = loop(0.71);

    // 파이팅: 텐션 톤 · 라인 삐걱 · 드랙 클리커 · 릴 톱니 · 물살 · 로드 삐걱
    const tensionOsc = add(ctx.createOscillator());
    tensionOsc.type = 'triangle';
    tensionOsc.frequency.value = TENSION.baseHz;
    const tensionGain = gain(0);
    tensionOsc.connect(tensionGain).connect(sfx);
    tensionOsc.start();
    sources.push(tensionOsc);

    const creakBP = filter('bandpass', TENSION.creakLoHz, TENSION.creakQ);
    const creakGain = gain(0);
    nA.connect(creakBP).connect(creakGain).connect(sfx);

    const clickHP = filter('highpass', CLICKER.hpHz);
    const clickGain = gain(0);
    nB.connect(clickHP).connect(clickGain).connect(sfx);

    const ratchetBP = filter('bandpass', RATCHET.bpHz, RATCHET.Q);
    const ratchetGain = gain(0);
    nC.connect(ratchetBP).connect(ratchetGain).connect(sfx);

    const swishBP = filter('bandpass', SWISH.bpHz, SWISH.Q);
    const swishGain = gain(0);
    nB.connect(swishBP);
    let swishPan = null;
    if (typeof ctx.createStereoPanner === 'function') {
      swishPan = add(ctx.createStereoPanner());
      swishBP.connect(swishPan).connect(swishGain);
    } else {
      swishBP.connect(swishGain);
    }
    swishGain.connect(sfx);

    const rodBP = filter('bandpass', ROD_CREAK.hz, ROD_CREAK.Q);
    const rodGain = gain(0);
    nA.connect(rodBP).connect(rodGain).connect(sfx);

    // 환경음 층
    const layer = (src, f) => { const g = gain(0); src.connect(f).connect(g).connect(amb); return g; };
    const wind = layer(nC, filter('lowpass', WIND.lpHz));
    const wavesLp = filter('lowpass', WAVES.lpHz);
    const wavesMod = gain(1 - WAVES.lfoDepth);         // 기본 + LFO(wavePeriod) — 파도가 밀려왔다 빠진다
    const wavesLfo = add(ctx.createOscillator());
    wavesLfo.type = 'sine';
    wavesLfo.frequency.value = 1 / 6;
    const wavesLfoDepth = gain(WAVES.lfoDepth);
    wavesLfo.connect(wavesLfoDepth).connect(wavesMod.gain);
    wavesLfo.start();
    sources.push(wavesLfo);
    const waves = gain(0);
    nA.connect(wavesLp).connect(wavesMod).connect(waves).connect(amb);
    const river = layer(nB, filter('bandpass', RIVER.bpHz, RIVER.Q));
    const dam = layer(nC, filter('lowpass', RIVER.damLpHz));
    const room = layer(nA, filter('lowpass', ROOM.lpHz));
    const tickGate = gain(0);                            // 시계 째깍 — 펄스
    const tick = gain(0);
    nB.connect(filter('bandpass', TICK.bpHz, TICK.Q)).connect(tickGate).connect(tick).connect(amb);
    const rain = layer(nC, filter('highpass', RAIN.hpHz));
    const cricketOsc = add(ctx.createOscillator());
    cricketOsc.type = 'sine';
    cricketOsc.frequency.value = CRICKET.hz;
    const cricketGate = gain(0);
    const crickets = gain(0);
    cricketOsc.connect(cricketGate).connect(crickets).connect(amb);
    cricketOsc.start();
    sources.push(cricketOsc);
    const birds = gain(0);                               // 일회성 새소리 · 갈매기가 지나가는 층 게인
    const gulls = gain(0);
    birds.connect(amb);
    gulls.connect(amb);

    this.g = {
      nodes, sources, master, sfx, amb, ui, limiter,
      tensionOsc, tensionGain, creakBP, creakGain, clickGain, ratchetGain, swishGain, swishPan, rodBP, rodGain,
      wavesLfo, tickGate, cricketGate,
      layers: { wind, waves, river, dam, room, tick, rain, crickets, birds, gulls },
    };
    this.layerParams = AMB_LAYERS.map(k => this.g.layers[k].gain);
    this.nodeCount = nodes.length;
  }

  _applySuspend() {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = this.paused || this.hidden;
    if (want && ctx.state === 'running') ctx.suspend().catch(() => {});
    else if (!want && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
  }

  /** 같은 목표면 다시 예약하지 않는다 */
  _target(idx, param, value, now, tc) {
    if (Math.abs(this.last[idx] - value) < EPS) return;
    this.last[idx] = value;
    param.setTargetAtTime(value, now, tc);
  }

  /** 게인에 짧은 펄스(클릭) 하나를 예약 */
  _pulse(param, t, amp, attack, dur) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(amp, t + attack);
    param.linearRampToValueAtTime(0, t + attack + dur);
  }

  /** 예약한 펄스까지 지우고 바로 0 */
  _cut(param, now) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(0, now);
  }

  // ───────────────────────── 파이팅 지속음

  _updateFight(state, now, frozen) {
    const g = this.g;
    const fight = state.fight;
    const rig = state.rig;
    if (fight !== this.lastFight) {
      this.lastFight = fight;
      if (!fight) this.endedFight = null;
    }
    const active = !!fight && !!rig && rig.phase === 'fighting' && fight !== this.endedFight && !frozen;

    // 텐션 톤 · 라인 삐걱(게이지와 같은 limitRatio)
    if (active) {
      const ratio = clamp(fin(fight.limitRatio, 0), 0, TENSION.ratioMax);
      const hz = TENSION.baseHz + TENSION.spanHz * clamp(Math.sqrt(ratio), 0, TENSION.ratioCap);
      this._target(P.tensionHz, g.tensionOsc.frequency, hz, now, SMOOTH_TC);
      this._target(P.tensionGain, g.tensionGain.gain, TENSION.gainBase + TENSION.gainSpan * ratio, now, SMOOTH_TC);
      const mix = clamp01((ratio - TENSION.creakFrom) / TENSION.creakSpan);
      this._target(P.creakGain, g.creakGain.gain, TENSION.creakGain * mix, now, SMOOTH_TC);
      if (mix > 0) {
        // 삐걱: 밴드패스 중심이 800–1500Hz 안에서 떨린다
        const hzc = TENSION.creakLoHz + (TENSION.creakHiHz - TENSION.creakLoHz) * Math.random();
        this.last[P.creakHz] = hzc;
        g.creakBP.frequency.setTargetAtTime(hzc, now, SMOOTH_TC);
      }
    } else {
      this._target(P.tensionGain, g.tensionGain.gain, 0, now, SMOOTH_TC);
      this._target(P.creakGain, g.creakGain.gain, 0, now, SMOOTH_TC);
    }

    // 드랙 클리커 — 미끄러지는 동안 초당 6 + 40 × slipSpeed
    if (active && fight.slipping) {
      const rate = Math.min(CLICKER.maxRate, CLICKER.base + CLICKER.perSlip * Math.max(0, fin(fight.slipSpeed, 0)));
      if (this.clickNext < now) this.clickNext = now + 0.005;
      while (this.clickNext < now + LOOKAHEAD) {
        this._pulse(g.clickGain.gain, this.clickNext, CLICKER.gain * rnd(0.75, 1), 0.0004, CLICKER.clickS);
        this.clickNext += (1 / rate) * rnd(0.85, 1.15);
      }
    } else {
      this.clickNext = 0;
    }

    // 릴 톱니 — 감기는 동안(파이팅의 gainSpeed · 빈 채비 회수)
    let speed = 0;
    if (active) speed = Math.max(0, fin(fight.gainSpeed, 0));
    else if (rig && rig.phase === 'retrieving' && !frozen && rig.bobber && rig.prevBobber) {
      speed = Math.min(RATCHET.retrieveMaxSpeed, Math.hypot(rig.bobber.x - rig.prevBobber.x, rig.bobber.z - rig.prevBobber.z) * 60);
      if (!(speed > 0)) speed = 1;      // 고정 틱 사이에 같은 자리여도 회수 중이면 돈다
    }
    if (speed > 0.01) {
      const rate = Math.min(RATCHET.maxRate, RATCHET.base + RATCHET.perSpeed * speed);
      if (this.ratchetNext < now) this.ratchetNext = now + 0.005;
      while (this.ratchetNext < now + LOOKAHEAD) {
        this._pulse(g.ratchetGain.gain, this.ratchetNext, RATCHET.gain * rnd(0.8, 1), 0.0005, RATCHET.clickS);
        this.ratchetNext += 1 / rate;
      }
    } else {
      this.ratchetNext = 0;
    }

    // 물살 — 질주 · 잠수 중 미끄러질 때. 팬 = 카메라 오른쪽 성분(왼쪽 물고기는 왼쪽에서 들린다)
    if (active && fight.slipping && (fight.behavior === 'run' || fight.behavior === 'dive')) {
      const mix = clamp(fin(fight.slipSpeed, 0) / SWISH.slipRef, SWISH.minMix, 1);
      this._target(P.swishGain, g.swishGain.gain, SWISH.gain * mix, now, SMOOTH_TC);
      if (g.swishPan && state.player) {
        const pan = -Math.sin(fin(fight.bearing, 0) - fin(state.player.yaw, 0));
        this._target(P.swishPan, g.swishPan.pan, clamp(pan, -1, 1), now, SMOOTH_TC);
      }
    } else {
      this._target(P.swishGain, g.swishGain.gain, 0, now, SMOOTH_TC);
    }

    // 로드 삐걱 — rodStress 동안 반복
    if (active && fight.rodStress) {
      if (this.rodNext < now) this.rodNext = now + 0.01;
      while (this.rodNext < now + LOOKAHEAD) {
        g.rodBP.frequency.setValueAtTime(ROD_CREAK.hz * rnd(0.85, 1.2), this.rodNext);
        this._pulse(g.rodGain.gain, this.rodNext, ROD_CREAK.gain * rnd(0.7, 1), ROD_CREAK.attack, ROD_CREAK.dur);
        this.rodNext += ROD_CREAK.period * rnd(0.8, 1.25);
      }
    } else {
      this.rodNext = 0;
    }
  }

  /** 파이팅 지속음을 바로 끈다(FIGHT_END · FISHING_EXIT · SCENE_CHANGED) */
  _stopFight(fightRef) {
    if (fightRef) this.endedFight = fightRef;
    const g = this.g;
    if (!this.ctx || !g) return;
    const now = this.ctx.currentTime;
    for (const p of [g.tensionGain.gain, g.creakGain.gain, g.clickGain.gain, g.ratchetGain.gain, g.swishGain.gain, g.rodGain.gain]) this._cut(p, now);
    this.last[P.tensionGain] = 0;
    this.last[P.creakGain] = 0;
    this.last[P.swishGain] = 0;
    this.clickNext = 0;
    this.ratchetNext = 0;
    this.rodNext = 0;
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].tag === 'fight') this._release(this.voices[i]);
  }

  // ───────────────────────── 환경음

  _updateAmbience(state, now) {
    const g = this.g;
    const env = state.env || null;
    const key = (env && AMBIENCE[env.ambience] ? env.ambience : SCENE_AMBIENCE[state.scene]) || 'indoor';
    const def = AMBIENCE[key];
    const band = state.clock ? state.clock.band : 'day';
    const rain = env ? clamp01(fin(env.rain, 0)) : 0;
    for (let i = 0; i < AMB_LAYERS.length; i++) {
      const name = AMB_LAYERS[i];
      let v = name === 'rain' ? rain : def[name];
      if (v && typeof v === 'object') v = fin(v[band], 0);
      v = fin(v, 0);
      if (rain > 0 && (name === 'birds' || name === 'gulls' || name === 'crickets')) v *= 1 - 0.7 * rain;   // 비가 오면 새 · 벌레가 줄어든다
      const target = v * AMB_GAIN[name];
      this.ambTarget[i] = target;
      if (Math.abs(this.ambLast[i] - target) > EPS || Number.isNaN(this.ambLast[i])) {
        this.ambLast[i] = target;
        this.layerParams[i].setTargetAtTime(target, now, AMB_FADE_TC);
      }
    }
    // 파도 LFO = wavePeriod
    const period = env ? Math.max(WAVES.minPeriod, fin(env.wavePeriod, 6)) : 6;
    if (Math.abs(period - this.wavePeriod) > EPS) {
      this.wavePeriod = period;
      g.wavesLfo.frequency.setTargetAtTime(1 / period, now, AMB_FADE_TC);
    }

    // 시계 째깍(집)
    if (this.ambTarget[AMB_I.tick] > 0) {
      if (this.tickNext < now) this.tickNext = now + 0.02;
      while (this.tickNext < now + LOOKAHEAD) {
        this._pulse(g.tickGate.gain, this.tickNext, 1, 0.0005, TICK.dur);
        this.tickNext += TICK.period;
      }
    } else {
      this.tickNext = 0;
    }
    // 귀뚜라미 — 짧은 펄스 셋이 한 번의 울음
    if (this.ambTarget[AMB_I.crickets] > 0) {
      if (this.cricketNext < now) this.cricketNext = now + 0.05;
      while (this.cricketNext < now + LOOKAHEAD) {
        for (let k = 0; k < CRICKET.pulses; k++) {
          this._pulse(g.cricketGate.gain, this.cricketNext + k * CRICKET.gapS, 1, 0.003, CRICKET.pulseS);
        }
        this.cricketNext += rnd(CRICKET.chirpEvery[0], CRICKET.chirpEvery[1]);
      }
    } else {
      this.cricketNext = 0;
    }
    // 새 · 갈매기 — 가끔 지나가는 일회성 소리(층 게인을 따른다)
    if (this.ambTarget[AMB_I.birds] > 0) {
      if (this.birdNext === 0) this.birdNext = now + rnd(BIRD.every[0], BIRD.every[1]);
      if (now >= this.birdNext) {
        this._bird(g.layers.birds);
        this.birdNext = now + rnd(BIRD.every[0], BIRD.every[1]);
      }
    } else {
      this.birdNext = 0;
    }
    if (this.ambTarget[AMB_I.gulls] > 0) {
      if (this.gullNext === 0) this.gullNext = now + rnd(GULL.every[0], GULL.every[1]);
      if (now >= this.gullNext) {
        this._gull(g.layers.gulls);
        this.gullNext = now + rnd(GULL.every[0], GULL.every[1]);
      }
    } else {
      this.gullNext = 0;
    }
  }

  // ───────────────────────── 목소리(일회성)

  /** 목소리를 등록 — 상한을 넘으면 가장 오래된 것을 끊는다 */
  _voice(tag, end, nodes, sources) {
    while (this.voices.length >= MAX_VOICES) this._release(this.voices[0]);
    const v = { tag, end, nodes, sources, done: false };
    this.voices.push(v);
    this.nodeCount += nodes.length;
    if (sources.length) sources[sources.length - 1].onended = () => this._release(v);
    return v;
  }

  _release(v) {
    if (v.done) return;
    v.done = true;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    for (const s of v.sources) {
      s.onended = null;
      try { s.stop(); } catch { /* 이미 멈춤 */ }
    }
    for (const n of v.nodes) n.disconnect();
    this.nodeCount -= v.nodes.length;
  }

  _prune(now) {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.end < now) this._release(v);
    }
  }

  /** 엔벌로프 게인 — 0 → peak(attack) → 지수 감쇠(dur) */
  _env(t, peak, attack, dur) {
    const g = /** @type {AudioContext} */ (this.ctx).createGain();
    const p = Math.max(EPS, fin(peak, 0));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(p, t + attack);
    g.gain.exponentialRampToValueAtTime(EPS, t + attack + dur);
    return g;
  }

  /** 오실레이터 블립(주파수 지수 미끄럼) */
  _blip(bus, { hz0, hz1 = hz0, dur, gain, type = 'sine', delay = 0, attack = 0.004, tag = 'sfx' }) {
    const ctx = this.ctx;
    if (!ctx || !this.g) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, fin(hz0, 440)), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, fin(hz1, 440)), t + attack + dur);
    const e = this._env(t, gain, attack, dur);
    o.connect(e).connect(bus);
    o.start(t);
    o.stop(t + attack + dur + 0.02);
    this._voice(tag, t + attack + dur + 0.05, [o, e], [o]);
  }

  /** 필터 노이즈(필터 주파수 미끄럼) — swell 이면 attack 동안 부푼다 */
  _noise(bus, { type = 'bandpass', hz0, hz1 = hz0, q = 1, dur, gain, delay = 0, attack = 0.004, tag = 'sfx' }) {
    const ctx = this.ctx;
    if (!ctx || !this.g || !this.noise) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;                       // 버퍼보다 긴 소리(예고 물살)도 끊기지 않게
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(10, fin(hz0, 1000)), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(10, fin(hz1, 1000)), t + attack + dur);
    const e = this._env(t, gain, attack, dur);
    s.connect(f).connect(e).connect(bus);
    const total = attack + dur + 0.02;
    s.start(t, Math.random() * NOISE_SECONDS);
    s.stop(t + total);
    this._voice(tag, t + total + 0.03, [s, f, e], [s]);
  }

  /** 종(배음 셋) 한 번 */
  _bell(bus, hz, gain, delay = 0, dur = 0.5) {
    const ctx = this.ctx;
    if (!ctx || !this.g) return;
    const t = ctx.currentTime + delay;
    const e = this._env(t, gain, 0.002, dur);
    const nodes = [e];
    const srcs = [];
    for (let i = 0; i < SFX.bellPartials.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz * SFX.bellPartials[i];
      const a = ctx.createGain();
      a.gain.value = SFX.bellAmps[i];
      o.connect(a).connect(e);
      o.start(t);
      o.stop(t + dur + 0.03);
      nodes.push(o, a);
      srcs.push(o);
    }
    e.connect(bus);
    this._voice('sfx', t + dur + 0.06, nodes, srcs);
  }

  /** 화음(같은 엔벌로프의 오실레이터 여럿) */
  _chord(bus, freqs, { dur, gain, type = 'triangle', delay = 0, attack = 0.01 }) {
    const ctx = this.ctx;
    if (!ctx || !this.g) return;
    const t = ctx.currentTime + delay;
    const e = this._env(t, gain, attack, dur);
    const nodes = [e];
    const srcs = [];
    for (const hz of freqs) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.connect(e);
      o.start(t);
      o.stop(t + attack + dur + 0.03);
      nodes.push(o);
      srcs.push(o);
    }
    e.connect(bus);
    this._voice('ui', t + attack + dur + 0.06, nodes, srcs);
  }

  _bird(bus) {
    const base = rnd(2600, 4200);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this._blip(bus, { hz0: base * rnd(0.95, 1.1), hz1: base * rnd(1.15, 1.45), dur: rnd(0.05, 0.11), gain: rnd(0.5, 1), delay: i * rnd(0.09, 0.16), attack: 0.008, tag: 'amb' });
    }
  }

  _gull(bus) {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this._noise(bus, { type: 'bandpass', hz0: rnd(1500, 1800), hz1: rnd(900, 1100), q: 9, dur: rnd(0.18, 0.3), gain: rnd(1.5, 2.5), delay: i * rnd(0.22, 0.32), attack: 0.03, tag: 'amb' });
    }
  }

  // ───────────────────────── 이벤트 → 소리

  _subscribe(bus) {
    const on = (name, fn) => bus.on(name, (p) => { if (this.ctx && this.g) fn(p || {}); });
    const sfx = () => this.g.sfx;
    const ui = () => this.g.ui;
    return [
      on(EV.CAST_RELEASE, (p) => {
        const m = p.perfect ? SFX.perfectMul : 1;
        this._noise(sfx(), { type: 'bandpass', hz0: SFX.castLoHz * m, hz1: SFX.castHiHz * m, q: 1.3, dur: SFX.castS, gain: SFX.castGain, attack: 0.06 });
      }),
      on(EV.CAST_SPLASH, (p) => {
        const att = clamp(1 - fin(p.distM, 0) / SFX.splashDistRef, SFX.splashMinAtt, 1);
        const heavy = p.set === 'bottom' ? 0.8 : 1;
        this._noise(sfx(), { type: 'lowpass', hz0: 2600 * heavy, hz1: 450, q: 0.8, dur: 0.35, gain: SFX.splashGain * att });
        this._blip(sfx(), { hz0: 240 * heavy, hz1: 90, dur: 0.22, gain: SFX.splashGain * 0.8 * att });
      }),
      on(EV.BITE_NIBBLE, (p) => {
        const s = clamp01(fin(p.strength, 0.5));
        const gain = SFX.nibbleGain[0] + (SFX.nibbleGain[1] - SFX.nibbleGain[0]) * s;
        if (p.set === 'bottom') this._bell(sfx(), SFX.bellHz, gain * 0.5, 0, 0.25);
        else this._blip(sfx(), { hz0: 900, hz1: 600, dur: 0.07, gain });      // 물방울 톡
      }),
      on(EV.BITE_TAKE, (p) => {
        if (p.set === 'bottom' || p.style === 'pull') {
          for (let i = 0; i < 3; i++) this._bell(sfx(), SFX.bellHz * rnd(0.98, 1.03), SFX.takeGain * 0.45, i * SFX.bellStrikeGap, 0.45);   // 딸랑딸랑
        } else {
          this._blip(sfx(), { hz0: 320, hz1: 130, dur: 0.2, gain: SFX.takeGain });     // 퐁
          this._noise(sfx(), { type: 'lowpass', hz0: 1200, hz1: 300, dur: 0.15, gain: SFX.takeGain * 0.4 });
        }
      }),
      on(EV.HOOK_SET, () => {
        this._noise(sfx(), { type: 'bandpass', hz0: 600, hz1: 2800, q: 1.2, dur: 0.16, gain: SFX.hookGain, attack: 0.03 });   // 챔질 휙
        this._blip(sfx(), { hz0: 120, hz1: 55, dur: 0.22, gain: SFX.hookGain * 1.1, type: 'sine', delay: 0.08 });              // 로드 퉁
      }),
      on(EV.HOOK_MISS, (p) => {
        if (p.reason === 'late') this._blip(sfx(), { hz0: 280, hz1: 170, dur: 0.14, gain: SFX.missGain * 0.6 });
        else this._noise(sfx(), { type: 'bandpass', hz0: 500, hz1: 1500, q: 0.8, dur: 0.3, gain: SFX.missGain, attack: 0.05 });   // 헛 바람
      }),
      on(EV.FIGHT_TELEGRAPH, (p) => {
        const lead = clamp(fin(p.lead, 0.5), 0.1, 3);
        if (p.kind === 'run' || p.kind === 'dive') {
          this._noise(sfx(), { type: 'lowpass', hz0: 250, hz1: 1300, q: 0.7, dur: 0.25, gain: SFX.teleGain, attack: lead, tag: 'fight' });   // 물살이 부푼다
        } else if (p.kind === 'jump') {
          this._blip(sfx(), { hz0: 150, hz1: 60, dur: 0.32, gain: SFX.gulpGain, tag: 'fight' });     // 물속 꿀렁
          this._noise(sfx(), { type: 'lowpass', hz0: 500, hz1: 150, dur: 0.3, gain: SFX.gulpGain * 0.5, tag: 'fight' });
        } else if (p.kind === 'charge') {
          this._blip(sfx(), { hz0: 520, hz1: 300, dur: lead, gain: SFX.whistleGain, attack: 0.05, tag: 'fight' });   // 라인이 늘어지는 낮은 휘파람
        }
      }),
      on(EV.FIGHT_JUMP, (p) => {
        const k = clamp(fin(p.lengthM, SFX.jumpLenRef) / SFX.jumpLenRef, SFX.jumpScale[0], SFX.jumpScale[1]);
        const land = p.phase === 'land' ? 1 : 0.7;
        this._noise(sfx(), { type: 'lowpass', hz0: 3200, hz1: 500, q: 0.7, dur: 0.3 + 0.2 * k, gain: SFX.jumpGain * Math.sqrt(k) * land });   // 철썩
        this._blip(sfx(), { hz0: 170 / Math.sqrt(k), hz1: 60, dur: 0.2 + 0.1 * k, gain: SFX.jumpGain * 0.7 * land });
      }),
      on(EV.FIGHT_SHAKE, (p) => {
        const s = clamp01(fin(p.strength, 0.3) / 0.6);
        const gain = SFX.shakeGain[0] + (SFX.shakeGain[1] - SFX.shakeGain[0]) * s;
        this._blip(sfx(), { hz0: 95, hz1: 50, dur: 0.12, gain, type: 'triangle', tag: 'fight' });   // 로드 덜컹
        this._noise(sfx(), { type: 'bandpass', hz0: 320, hz1: 220, q: 2, dur: 0.08, gain: gain * 0.6, tag: 'fight' });
      }),
      on(EV.FIGHT_END, (p) => {
        this._stopFight(this.lastFight);
        if (p.outcome === 'lineBreak' || p.outcome === 'spoolEmpty') {
          this._blip(sfx(), { hz0: 1900, hz1: 1100, dur: 0.025, gain: SFX.snapGain, type: 'square', attack: 0.001 });    // 탁
          this._noise(sfx(), { type: 'highpass', hz0: 5000, hz1: 3000, dur: 0.16, gain: SFX.snapGain * 0.7, attack: 0.001 });
        } else if (p.outcome === 'rodBreak') {
          this._noise(sfx(), { type: 'bandpass', hz0: 1800, hz1: 900, q: 2, dur: 0.06, gain: SFX.crackGain, attack: 0.001 });   // 우지끈
          for (let i = 0; i < 3; i++) this._noise(sfx(), { type: 'lowpass', hz0: 2200, hz1: 300, dur: 0.12, gain: SFX.crackGain * 0.6, delay: 0.04 + i * rnd(0.04, 0.07), attack: 0.002 });
          this._blip(sfx(), { hz0: 90, hz1: 40, dur: 0.3, gain: SFX.crackGain * 0.7 });
        } else if (p.outcome === 'hookOff') {
          this._blip(sfx(), { hz0: 420, hz1: 240, dur: 0.06, gain: SFX.tukGain, attack: 0.001 });   // 툭
        }
      }),
      on(EV.FISHING_EXIT, () => this._stopFight(this.lastFight)),
      on(EV.SCENE_CHANGED, () => this._stopFight(this.lastFight)),
      on(EV.NET_START, () => {
        this._noise(sfx(), { type: 'lowpass', hz0: 1900, hz1: 380, dur: 0.5, gain: SFX.netGain, attack: 0.02 });     // 뜰채 첨벙
        this._blip(sfx(), { hz0: 190, hz1: 80, dur: 0.25, gain: SFX.netGain * 0.6 });
      }),
      on(EV.CATCH_RELEASED, () => {
        this._noise(sfx(), { type: 'lowpass', hz0: 1500, hz1: 400, dur: 0.3, gain: SFX.releaseGain, attack: 0.01 });   // 작은 첨벙
      }),
      on(EV.CATCH_RESULT, () => {
        this._chord(ui(), [NOTE.C5, NOTE.E5, NOTE.G5], { dur: 0.6, gain: UI_SND.chordGain });
      }),
      on(EV.CATCH_KEPT, () => {
        this._blip(ui(), { hz0: 210, hz1: 120, dur: 0.1, gain: UI_SND.keepGain });
      }),
      on(EV.RECORD, (p) => {
        if (p.tier === 'trophy' || p.tier === 'legend') {
          const notes = [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5];
          for (let i = 0; i < notes.length; i++) this._blip(ui(), { hz0: notes[i], dur: 0.12, gain: UI_SND.fanfareGain, type: 'triangle', delay: i * 0.1, attack: 0.008 });
          const top = p.tier === 'legend' ? [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6] : [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
          this._chord(ui(), top, { dur: p.tier === 'legend' ? 1.4 : 0.9, gain: UI_SND.fanfareGain, delay: notes.length * 0.1 });
        } else {
          this._blip(ui(), { hz0: NOTE.E5, dur: 0.1, gain: UI_SND.chimeGain, type: 'triangle' });
          this._blip(ui(), { hz0: NOTE.A5, dur: 0.18, gain: UI_SND.chimeGain, type: 'triangle', delay: 0.09 });
        }
      }),
      on(EV.LEVEL_UP, () => {
        const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6];
        for (let i = 0; i < notes.length; i++) this._blip(ui(), { hz0: notes[i], dur: 0.16, gain: UI_SND.arpGain, type: 'triangle', delay: i * 0.075, attack: 0.006 });
      }),
      on(EV.SOLD, () => this._coin()),
      on(EV.BOUGHT, () => this._coin()),
      on(EV.SKILL_LEARNED, () => {
        this._bell(ui(), NOTE.A5, UI_SND.chimeGain, 0, 0.5);
        this._bell(ui(), NOTE.E6, UI_SND.chimeGain * 0.8, 0.1, 0.6);
      }),
      on(EV.DRAG_CHANGED, (p) => {
        const notch = fin(p.notch, 0);
        const ratio = clamp01(notch / Math.max(1, fin(p.notches, 20)));
        const tighter = this.dragNotch === null ? true : notch >= this.dragNotch;
        this.dragNotch = notch;
        const hz = tighter ? 1500 + 900 * ratio : 800 + 500 * ratio;     // 조이면 높게 · 풀면 낮게
        this._blip(sfx(), { hz0: hz, hz1: hz * 0.8, dur: 0.012, gain: SFX.dragGain, type: 'square', attack: 0.001 });
      }),
      on(EV.BAIL_CHANGED, (p) => {
        this._noise(sfx(), { type: 'bandpass', hz0: 2600, hz1: 2000, q: 3, dur: 0.03, gain: SFX.bailGain, attack: 0.001 });
        this._blip(sfx(), { hz0: p.open ? 700 : 520, dur: 0.03, gain: SFX.bailGain * 0.7, type: 'square', attack: 0.001 });
      }),
      on(EV.FISHING_ENTER, () => {
        this._noise(sfx(), { type: 'bandpass', hz0: 1800, hz1: 1400, q: 2, dur: 0.05, gain: SFX.bailGain * 0.6, attack: 0.002 });
      }),
      on(EV.CAST_BLOCKED, () => this._deny()),
      on(EV.RIG_BUSY, () => this._deny()),
      on(EV.PANEL_OPENED, () => this._blip(ui(), { hz0: 1250, hz1: 1050, dur: 0.03, gain: UI_SND.clickGain })),
      on(EV.PANEL_CLOSED, () => this._blip(ui(), { hz0: 950, hz1: 820, dur: 0.03, gain: UI_SND.clickGain })),
      on(EV.SETTINGS_CHANGED, () => this.applySettings()),
      bus.on(EV.PAUSED, (p) => this.setPaused(!!(p && p.on))),
    ];
  }

  _coin() {
    const ui = this.g.ui;
    this._blip(ui, { hz0: 1320, dur: 0.07, gain: UI_SND.coinGain, type: 'square', attack: 0.002 });
    this._blip(ui, { hz0: 1760, dur: 0.16, gain: UI_SND.coinGain, type: 'square', delay: 0.07, attack: 0.002 });
  }

  /** UI 부정음(두 음 내림) */
  _deny() {
    const ui = this.g.ui;
    this._blip(ui, { hz0: 330, dur: 0.08, gain: UI_SND.denyGain, type: 'square', attack: 0.003 });
    this._blip(ui, { hz0: 247, dur: 0.12, gain: UI_SND.denyGain, type: 'square', delay: 0.09, attack: 0.003 });
  }
}
