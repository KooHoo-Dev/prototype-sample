// OWNER: P8 — 계약 §9.5 (내부 — 재질: 인스턴스 테두리 발광 · 가림 외곽선)
// 테두리 발광: InstancedMesh 의 인스턴스 속성 aGlow(rgb = 테두리 색 × 세기 · a = 자체 발광 비율)를 MeshStandardMaterial 셰이더에 덧댄다
//   — 등급(챔피언 파랑 · 정예 노랑) · 마우스 대상(흰 맥동) · 부풀기(붉음)를 재질 하나로(드로콜이 늘지 않는다).
// 가림 외곽선(§9.5): 깊이 비교를 뒤집은 패스(GreaterDepth) — 무언가가 앞에 있을 때만 그린다. 정점을 카메라 쪽으로 PULL m 당겨서
//   자기 몸끼리의 겹침(팔이 몸통 앞)은 외곽선이 되지 않고, 벽 · 기둥(그보다 훨씬 앞)에 가린 부분만 보인다. 가산 혼합 — 검정은 안 보인다.

import { AdditiveBlending, GreaterDepth, MeshBasicMaterial, MeshStandardMaterial } from 'three';

/** 가림 외곽선의 카메라 쪽 당김(m) — 몸 두께보다 크고 벽 두께보다 작게 */
export const SIL_PULL = 0.6;

/** @param {MeshStandardMaterial} mat */
function patchGlow(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec4 aGlow;\nvarying vec4 vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = aGlow;');
    sh.fragmentShader = 'varying vec4 vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', [
      '#include <emissivemap_fragment>',
      '\tfloat rimF = 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 );',
      '\ttotalEmissiveRadiance += vGlow.rgb * ( rimF * rimF * rimF * 1.5 ) + diffuseColor.rgb * vGlow.a;',
    ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'actorGlow';
  return mat;
}

/** @param {MeshBasicMaterial} mat */
function patchPull(mat, pull) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPull = { value: pull };
    sh.vertexShader = 'uniform float uPull;\n' + sh.vertexShader.replace('#include <project_vertex>', [
      '#include <project_vertex>',
      '\tmvPosition.z += uPull;',
      '\tgl_Position = projectionMatrix * mvPosition;',
    ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'actorSil' + pull;
  return mat;
}

/** 몬스터 · 바닥 아이템 인스턴스 재질 셋 */
export function makeInstanceMaterials() {
  return {
    std: patchGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.04, flatShading: true })),
    metal: patchGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.3, flatShading: true })),
    glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    sil: patchPull(new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthFunc: GreaterDepth, blending: AdditiveBlending, fog: false }), SIL_PULL),
    pillar: new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false, toneMapped: false }),
  };
}

/** 플레이어 · NPC 재질 셋(투명도 — 순간이동의 0.1초 투명 · §9.5) @param {{transparent:boolean, sil?:number}} o */
export function makeCharMaterials({ transparent, sil = 0 }) {
  return {
    std: new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.04, flatShading: true, transparent }),
    metal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.32, flatShading: true, transparent }),
    glow: new MeshBasicMaterial({ vertexColors: true, transparent, toneMapped: false }),
    sil: sil ? patchPull(new MeshBasicMaterial({ color: sil, transparent: true, depthWrite: false, depthFunc: GreaterDepth, blending: AdditiveBlending, fog: false }), SIL_PULL) : null,
  };
}

/** 재질 묶음 해제 @param {Record<string, any>} set */
export function disposeMaterials(set) {
  for (const k of Object.keys(set)) if (set[k] && typeof set[k].dispose === 'function') set[k].dispose();
}
