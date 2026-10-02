// OWNER: P7 — fx 내부 파일
// 화면 전체 덮개: 피격 시 가장자리 붉은 번쩍 + 큰 사건(페이즈 전환 · 격파)의 화면 섬광.
// 카메라 행렬을 쓰지 않는 쿼드 한 장 — 쉴 때는 visible = false라 덧그리기 비용이 없다.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy + 0.5;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uVigColor;
uniform float uVig;
uniform vec3 uFlashColor;
uniform float uFlash;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  // 가장자리 띠만 물들인다 — 화면 중심의 58% 안쪽(캐릭터 · 보스 · 바닥 표식)은 건드리지 않는다
  float edge = smoothstep(0.66, 1.08, length(c * vec2(1.0, 0.85)) * 1.45);
  float aV = edge * uVig;
  float a = aV + uFlash * (1.0 - aV);
  if (a < 0.003) discard;
  vec3 col = (uVigColor * aV + uFlashColor * uFlash * (1.0 - aV)) / a;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const EPS_VISIBLE = 0.004;

export class ScreenOverlay {
  /** @param {THREE.Object3D} parent fxRoot */
  constructor(parent) {
    this.parent = parent;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVigColor: { value: new THREE.Color(1, 0, 0) },
        uVig: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uFlash: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this._vigDecay = 3;
    this._flashDecay = 4;
  }

  /**
   * 가장자리 번쩍.
   * @param {THREE.Color} color
   * @param {number} amount 0..1
   * @param {number} decay 초당 감쇠율(클수록 빨리 사라진다)
   */
  vignette(color, amount, decay) {
    const u = this.material.uniforms;
    if (amount < u.uVig.value) return;
    u.uVigColor.value.copy(color);
    u.uVig.value = amount;
    this._vigDecay = decay;
    this.mesh.visible = true;
  }

  /**
   * 화면 전체 섬광.
   * @param {THREE.Color} color
   * @param {number} amount 0..1
   * @param {number} decay
   */
  flash(color, amount, decay) {
    const u = this.material.uniforms;
    if (amount < u.uFlash.value) return;
    u.uFlashColor.value.copy(color);
    u.uFlash.value = amount;
    this._flashDecay = decay;
    this.mesh.visible = true;
  }

  /** @param {number} dt */
  update(dt) {
    if (!this.mesh.visible) return;
    const u = this.material.uniforms;
    u.uVig.value *= Math.exp(-this._vigDecay * dt);
    u.uFlash.value *= Math.exp(-this._flashDecay * dt);
    if (u.uVig.value < EPS_VISIBLE && u.uFlash.value < EPS_VISIBLE) this.clear();
  }

  clear() {
    this.material.uniforms.uVig.value = 0;
    this.material.uniforms.uFlash.value = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
