// OWNER: P6 — 계약 §9.2 · §9.9
// 렌더 컨텍스트: ACES 톤매핑 · sRGB 출력 · 그림자 · FogExp2 · 후처리(RenderPass → UnrealBloomPass → 비네트 → OutputPass).
// 캔버스 크기의 주인은 렌더러다: 생성 시 canvas.clientWidth/Height로 잡고 window resize를 스스로 구독한다(app은 resize를 부르지 않는다).
// 화질(§9.9): low = 후처리 없이 직접 렌더(그림자 · 블룸 끔) / medium · high = 컴포저(MSAA 렌더 타깃 + 블룸 해상도 배율).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CAMERA } from '../data/camera.js';
import { PALETTE } from '../data/palette.js';
import { QUALITY } from '../data/settings.js';

/** @typedef {import('../types.js').RenderContext} RenderContext */
/** @typedef {import('../types.js').Settings} Settings */

const EXPOSURE = 1.08;
const FOG_DENSITY = 0.03;          // 시작값 — 테마별 값은 WorldLayer가 넣는다
const BLOOM_STRENGTH = 0.34;       // 과하지 않게: 불 · 룬 · 달만 번진다
const BLOOM_RADIUS = 0.62;
const BLOOM_THRESHOLD = 0.9;       // §9.1 — 발광 재질(HDR)만 넘는다
const MSAA = { low: 0, medium: 2, high: 4 };   // 컴포저 렌더 타깃의 샘플 수(low는 컴포저를 안 쓴다 — 캔버스 AA)
const VIGNETTE = { strength: 0.42, inner: 0.42, outer: 1.08 };

/** 화면 가장자리를 어둡게(톤매핑 전 선형 공간에서 곱한다). */
const VignetteShader = {
  name: 'AshenVignette',
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: VIGNETTE.strength },
    uInner: { value: VIGNETTE.inner },
    uOuter: { value: VIGNETTE.outer },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uInner;
    uniform float uOuter;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = length((vUv - 0.5) * vec2(1.0, 0.82)) * 1.7;
      float v = smoothstep(uOuter, uInner, d);
      gl_FragColor = vec4(c.rgb * mix(1.0 - uStrength, 1.0, v), c.a);
    }`,
};

/**
 * createRenderContext는 bus를 받지 않는다 — 화질 변경은 app이 SETTINGS_CHANGED에서 rc.setQuality(settings.quality)를 부른다.
 * 계약 필드 외에 P6 내부용 `quality`(현재 단계 이름) · `prewarm()`(현재 파이프라인 기준 셰이더 선컴파일)을 더 갖는다.
 * @param {HTMLCanvasElement} canvas
 * @param {Settings} settings
 * @returns {RenderContext}
 */
export function createRenderContext(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // three r186: PCFSoftShadowMap은 제거되어 PCFShadowMap이 부드러운 PCF다(docs/NOTES-P6.md).
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.FogExp2(PALETTE.fog.town, FOG_DENSITY);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);

  /** @type {EffectComposer|null} */
  let composer = null;
  /** @type {UnrealBloomPass|null} */
  let bloom = null;
  let cfg = QUALITY.medium;
  let pixelRatio = 1;
  let width = 0;
  let height = 0;
  const bufSize = new THREE.Vector2();

  const disposeComposer = () => {
    if (!composer) return;
    for (const pass of composer.passes) pass.dispose?.();
    composer.dispose();
    composer = null;
    bloom = null;
  };

  /** @param {number} samples */
  const buildComposer = (samples) => {
    disposeComposer();
    renderer.getDrawingBufferSize(bufSize);
    const rt = new THREE.WebGLRenderTarget(Math.max(1, bufSize.x), Math.max(1, bufSize.y), { type: THREE.HalfFloatType, samples });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    composer.addPass(bloom);
    composer.addPass(new ShaderPass(VignetteShader));
    composer.addPass(new OutputPass());
  };

  const applySize = () => {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      // 블룸만 해상도 배율을 따로 건다(medium 절반 · high 전체)
      bloom.setSize(Math.max(2, width * pixelRatio * cfg.bloomScale), Math.max(2, height * pixelRatio * cfg.bloomScale));
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  /** @param {number} w @param {number} h */
  const resize = (w, h) => {
    if (!(w > 0 && h > 0)) return;
    width = Math.floor(w);
    height = Math.floor(h);
    pixelRatio = Math.min(window.devicePixelRatio || 1, cfg.pixelRatio);   // 모니터를 옮기면 DPR이 바뀐다
    applySize();
  };

  const rc = {
    renderer,
    scene,
    camera,
    /** 현재 화질 단계 이름(WorldLayer가 그림자 광원을 맞추려고 읽는다). */
    quality: 'medium',
    /** @param {'low'|'medium'|'high'} q */
    setQuality(q) {
      const id = QUALITY[q] ? q : 'medium';
      cfg = QUALITY[id];
      rc.quality = id;
      pixelRatio = Math.min(window.devicePixelRatio || 1, cfg.pixelRatio);
      renderer.setPixelRatio(pixelRatio);
      renderer.shadowMap.enabled = cfg.shadows;
      if (cfg.bloom) buildComposer(MSAA[id] ?? 0);
      else disposeComposer();
      if (width > 0 && height > 0) applySize();
      else resize(canvas.clientWidth, canvas.clientHeight);
    },
    resize,
    /** @param {number} dt */
    render(dt) {
      if (composer) composer.render(dt);
      else renderer.render(scene, camera);
    },
    /**
     * 지금 보이는 것들의 셰이더를 현재 파이프라인(컴포저면 HDR 렌더 타깃) 기준으로 미리 컴파일한다.
     * WorldLayer가 부팅 때 네 월드를 전부 켠 채 한 번 부른다 → 첫 전환에서 컴파일 멈칫이 없다.
     */
    prewarm() {
      const prev = renderer.getRenderTarget();
      if (composer) renderer.setRenderTarget(composer.readBuffer);
      try {
        renderer.compile(scene, camera);
      } finally {
        renderer.setRenderTarget(prev);
      }
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      disposeComposer();
      renderer.dispose();
    },
  };
  const onResize = () => resize(canvas.clientWidth, canvas.clientHeight);

  resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  rc.setQuality(settings?.quality ?? 'medium');
  window.addEventListener('resize', onResize);
  return rc;
}
