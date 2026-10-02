// OWNER: P7 — 계약 §9.7 「상태를 읽어 매 프레임 그리는 것」
// 바닥 표식. 인스턴스 쿼드 한 장 + 월드 좌표 SDF 셰이더로 네 모양(원 · 부채 · 띠 · 캡슐)을 그린다.
//   예고(warn): 외곽선은 항상 보이고 안쪽 채움이 progress에 따라 차오른다. 사라지는 순간(판정 시작) 번쩍인다.
//   활성(active): 장판 · 브레스 · 광선이 실제로 때리는 구역 — 전체가 일렁이며 빛난다.
// 좌표는 §0.2 그대로: dir 방향의 점 = (x + r sin dir, z + r cos dir).
import * as THREE from 'three';

const CAPACITY = 48;
/** 바닥에서 띄우는 높이(m) — 바닥 장식(y ≤ 0.02) 위 */
const Y = 0.03;
/** 쿼드를 모양보다 넓히는 여유(m) — 바깥 테두리 그림자까지 */
const PAD = 0.5;
const FLASH_DUR = 0.2;
const FADE_DUR = 0.14;
/** 이 진행도 이상에서 사라지면 "판정이 시작됐다"로 보고 번쩍인다(그 아래는 중단된 예고) */
const FLASH_MIN_PROGRESS = 0.55;

const LIVE = 1;
const OUT = 2;

const VERT = /* glsl */ `
attribute vec4 iRect;   // 중심 x, z · 반폭 x, z
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iState;  // 모양 · 진행도(2 = 활성 · 3 = 옅은 활성) · 섬광 · 불투명도
attribute vec3 iGlow;
attribute vec3 iCore;
varying vec2 vP;
varying vec4 vA;
varying vec4 vB;
varying vec4 vState;
varying vec3 vGlow;
varying vec3 vCore;
void main() {
  vec2 w = iRect.xy + position.xy * 2.0 * iRect.zw;
  vP = w; vA = iA; vB = iB; vState = iState; vGlow = iGlow; vCore = iCore;
  gl_Position = projectionMatrix * viewMatrix * vec4(w.x, ${Y.toFixed(3)}, w.y, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vP;
varying vec4 vA;
varying vec4 vB;
varying vec4 vState;
varying vec3 vGlow;
varying vec3 vCore;
void main() {
  float type = vState.x;
  float sd;   // 경계까지 부호 거리(m, 안쪽이 음수)
  float fc;   // 채움 좌표 0..1 (이 값이 진행도보다 작은 곳이 찼다)
  if (type < 0.5) {            // 원: A = (x, z, r)
    float d = length(vP - vA.xy);
    sd = d - vA.z;
    fc = d / max(vA.z, 1e-3);
  } else if (type < 1.5) {     // 부채: A = (x, z, r, rInner) · B = (sin dir, cos dir, halfAngle)
    vec2 q = vP - vA.xy;
    float d = length(q);
    float sr = max(d - vA.z, vA.w - d);
    float sa = -1000.0;
    if (vB.z < 3.1415) {
      float over = acos(clamp(dot(q, vB.xy) / max(d, 1e-4), -1.0, 1.0)) - vB.z;
      sa = over > 1.5708 ? d : (over < -1.5708 ? -d : d * sin(over));
    }
    sd = max(sr, sa);
    fc = (d - vA.w) / max(vA.z - vA.w, 1e-3);
  } else if (type < 2.5) {     // 띠: A = (x, z, rOuter, rInner)
    float d = length(vP - vA.xy);
    sd = max(d - vA.z, vA.w - d);
    fc = (d - vA.w) / max(vA.z - vA.w, 1e-3);
  } else {                     // 캡슐: A = (ax, az, bx, bz) · B = (r)
    vec2 pa = vP - vA.xy;
    vec2 ba = vA.zw - vA.xy;
    float len2 = max(dot(ba, ba), 1e-6);
    float h = clamp(dot(pa, ba) / len2, 0.0, 1.0);
    sd = length(pa - ba * h) - vB.x;
    float L = sqrt(len2);
    fc = (dot(pa, ba) / L + vB.x) / (L + 2.0 * vB.x);
  }
  float aa = max(fwidth(sd), 0.004);
  float lineW = max(0.05, aa * 1.2);
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  float outline = 1.0 - smoothstep(lineW, lineW + aa * 1.5, abs(sd));
  float live = step(1.5, vState.y);
  float soft = step(2.5, vState.y);   // 브레스처럼 입자가 주인공인 구역은 바닥을 옅게 깐다
  float p = min(vState.y, 1.0);
  float fw = max(fwidth(fc), 0.003);
  float filled = inside * (1.0 - smoothstep(p - fw, p + fw, fc));
  float front = inside * (1.0 - live) * smoothstep(0.07, 0.0, abs(fc - p)) * step(0.004, p);
  float urgency = smoothstep(0.65, 1.0, p) * (1.0 - live);
  float pulse = 0.5 + 0.5 * sin(uTime * (9.0 + 20.0 * urgency));
  float flick = 0.78 + 0.22 * sin(uTime * 43.0 + vP.x * 3.1 + vP.y * 2.3);
  float flash = vState.z;

  float aFill = inside * 0.15 + filled * (0.34 + 0.14 * urgency * pulse) + front * 0.45;
  aFill = mix(aFill, inside * (0.32 + 0.16 * flick) * mix(1.0, 0.4, soft), live);
  // 판정 시작의 번쩍임: 큰 원(도약 착지 · 노바)이 화면의 절반을 덮기 때문에 불투명도 · 밝기를 눌러 둔다 —
  // 위에 선 캐릭터와 HUD가 하얗게 날아가지 않는다(번쩍임 자체는 외곽선과 심지 색으로 읽힌다)
  float a = clamp(max(outline * 0.95, aFill) + flash * inside * 0.38, 0.0, 1.0);
  // 채움은 대표 색, 차오르는 앞선과 섬광은 밝은 심지 색. 외곽선은 대표 색을 밝게(블룸이 색을 실어 나른다)
  vec3 col = mix(vGlow, vCore, clamp(front * 0.7 + flash * 0.45, 0.0, 1.0));
  col = mix(col, mix(vGlow, vCore, 0.3), outline);
  // 활성 구역(불길 · 광선 · 브레스)의 바닥은 블룸 임계 근처까지만 — 그 위의 입자가 가산으로 더해지므로 바닥까지 HDR이면 구역 전체가 하얗게 뜬다
  col *= 1.0 + outline * 1.6 + front * 0.8 + flash * 0.9 + live * 0.35 * flick * mix(1.0, 0.3, soft) + urgency * 0.5 * pulse;

  // 밝은 바닥(설원)에서도 외곽선이 읽히게 바깥쪽에 어두운 테를 깐다
  float rim = (1.0 - smoothstep(lineW, lineW * 3.0 + 0.16, sd)) * step(0.0, sd) * 0.42 * (1.0 - flash);
  a *= vState.w;
  rim *= vState.w;
  float outA = a + rim * (1.0 - a);
  if (outA < 0.004) discard;
  gl_FragColor = vec4(col * a / outA, outA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Telegraphs {
  /** @param {THREE.Object3D} parent fxRoot */
  constructor(parent) {
    this.parent = parent;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this._rect = mk(4);
    this._a = mk(4);
    this._b = mk(4);
    this._state = mk(4);
    this._glow = mk(3);
    this._core = mk(3);
    geo.setAttribute('iRect', this._rect);
    geo.setAttribute('iA', this._a);
    geo.setAttribute('iB', this._b);
    geo.setAttribute('iState', this._state);
    geo.setAttribute('iGlow', this._glow);
    geo.setAttribute('iCore', this._core);
    geo.instanceCount = CAPACITY;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    parent.add(this.mesh);

    /** @type {Map<string|number, number>} 표식 키 → 칸 */
    this._slots = new Map();
    this._mode = new Uint8Array(CAPACITY);   // 0 빈 칸 · LIVE · OUT
    this._seen = new Uint8Array(CAPACITY);
    this._outT = new Float32Array(CAPACITY);
    this._outDur = new Float32Array(CAPACITY);
    this._outFlash = new Uint8Array(CAPACITY);
    /** @type {(string|number|null)[]} */
    this._keys = new Array(CAPACITY).fill(null);
    this._time = 0;
  }

  /** 프레임 시작: 이번 프레임에 다시 불리지 않은 표식은 endFrame에서 사라진다. */
  beginFrame() {
    this._seen.fill(0);
  }

  /**
   * 표식 하나를 만들거나 갱신한다.
   * @param {string|number} key  텔레그래프 id(문자열) 또는 장판 · 지속 연출의 숫자 키
   * @param {import('../../types.js').HitShape} shape 월드 공간
   * @param {number} progress 0..1(예고) — active면 무시
   * @param {THREE.Color} glow
   * @param {THREE.Color} core
   * @param {number} mode 0 예고 · 1 실제 판정 구역 · 2 옅은 판정 구역(입자 연출 밑에 까는 것)
   */
  put(key, shape, progress, glow, core, mode) {
    let i = this._slots.get(key);
    if (i === undefined) {
      i = this._mode.indexOf(0);
      if (i < 0) return;   // 칸이 없으면 이 표식은 건너뛴다(48개를 넘는 일은 없다)
      this._slots.set(key, i);
      this._keys[i] = key;
      this._mode[i] = LIVE;
      const g = this._glow.array;
      const c = this._core.array;
      g[i * 3] = glow.r; g[i * 3 + 1] = glow.g; g[i * 3 + 2] = glow.b;
      c[i * 3] = core.r; c[i * 3 + 1] = core.g; c[i * 3 + 2] = core.b;
      this._glow.needsUpdate = true;
      this._core.needsUpdate = true;
    }
    this._seen[i] = 1;
    const r = this._rect.array;
    const a = this._a.array;
    const b = this._b.array;
    const i4 = i * 4;
    let type = 0;
    switch (shape.type) {
      case 'circle':
        r[i4] = shape.x; r[i4 + 1] = shape.z; r[i4 + 2] = shape.r + PAD; r[i4 + 3] = shape.r + PAD;
        a[i4] = shape.x; a[i4 + 1] = shape.z; a[i4 + 2] = shape.r; a[i4 + 3] = 0;
        break;
      case 'arc':
        type = 1;
        r[i4] = shape.x; r[i4 + 1] = shape.z; r[i4 + 2] = shape.r + PAD; r[i4 + 3] = shape.r + PAD;
        a[i4] = shape.x; a[i4 + 1] = shape.z; a[i4 + 2] = shape.r; a[i4 + 3] = shape.rInner;
        b[i4] = Math.sin(shape.dir); b[i4 + 1] = Math.cos(shape.dir); b[i4 + 2] = shape.halfAngle;
        break;
      case 'ring':
        type = 2;
        r[i4] = shape.x; r[i4 + 1] = shape.z; r[i4 + 2] = shape.rOuter + PAD; r[i4 + 3] = shape.rOuter + PAD;
        a[i4] = shape.x; a[i4 + 1] = shape.z; a[i4 + 2] = shape.rOuter; a[i4 + 3] = shape.rInner;
        break;
      default:   // capsule
        type = 3;
        r[i4] = (shape.ax + shape.bx) / 2; r[i4 + 1] = (shape.az + shape.bz) / 2;
        r[i4 + 2] = Math.abs(shape.bx - shape.ax) / 2 + shape.r + PAD;
        r[i4 + 3] = Math.abs(shape.bz - shape.az) / 2 + shape.r + PAD;
        a[i4] = shape.ax; a[i4 + 1] = shape.az; a[i4 + 2] = shape.bx; a[i4 + 3] = shape.bz;
        b[i4] = shape.r;
        break;
    }
    const s = this._state.array;
    s[i4] = type;
    s[i4 + 1] = mode > 0 ? mode + 1 : Math.min(1, Math.max(0, progress));
    s[i4 + 2] = 0;
    s[i4 + 3] = 1;
  }

  /**
   * 프레임 끝: 사라진 표식을 섬광/페이드로 넘기고, 넘긴 것들을 진행시킨다.
   * @param {number} dt
   */
  endFrame(dt) {
    this._time += dt;
    this.material.uniforms.uTime.value = this._time % 1000;
    const s = this._state.array;
    let any = false;
    for (let i = 0; i < CAPACITY; i++) {
      const mode = this._mode[i];
      if (mode === 0) continue;
      const i4 = i * 4;
      if (mode === LIVE && !this._seen[i]) {
        this._slots.delete(this._keys[i]);
        this._keys[i] = null;
        this._mode[i] = OUT;
        this._outT[i] = 0;
        const wasWarn = s[i4 + 1] < 1.5;
        this._outFlash[i] = wasWarn && s[i4 + 1] >= FLASH_MIN_PROGRESS ? 1 : 0;
        this._outDur[i] = this._outFlash[i] ? FLASH_DUR : FADE_DUR;
        if (this._outFlash[i]) s[i4 + 1] = 1;
      }
      if (this._mode[i] === OUT) {
        this._outT[i] += dt;
        const u = this._outT[i] / this._outDur[i];
        if (u >= 1) {
          this._mode[i] = 0;
          this._rect.array[i4 + 2] = 0;
          this._rect.array[i4 + 3] = 0;
          s[i4 + 3] = 0;
          continue;
        }
        s[i4 + 2] = this._outFlash[i] ? (1 - u) * (1 - u) : 0;
        s[i4 + 3] = 1 - u;
      }
      any = true;
    }
    this._rect.needsUpdate = true;
    this._a.needsUpdate = true;
    this._b.needsUpdate = true;
    this._state.needsUpdate = true;
    this.mesh.visible = any;
  }

  /** 살아 있는 표식 수(검사용). */
  get liveCount() {
    return this._slots.size;
  }

  clear() {
    this._slots.clear();
    this._mode.fill(0);
    this._keys.fill(null);
    this._rect.array.fill(0);
    this._rect.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
