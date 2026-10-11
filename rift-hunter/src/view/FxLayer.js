// OWNER: P13 — 계약 §6.14 · §9.7 · §9.8
// STUB — W2 에서 P13 이 채운다(예고 표식 · 지속 효과 · 투사체 · 입자 · 오라 · 상태 표시 · 스킬 연출 · 포털 소용돌이).
// W0: 「자리 표시」 — 효과 = 붉은(적대)/흰 테두리 선(모양 그대로 · 예고 진행만큼 안쪽이 채워진다) · 투사체 = 작은 구(InstancedMesh)

import * as THREE from 'three';

const MAX_FX = 200;
const MAX_PROJ = 256;
const HOSTILE = 0xff3b30;
const FRIENDLY = 0xffffff;
const SEG = 32;
const LIFT = 0.04;

/** 모양 → 테두리 꼭짓점(XZ · y = LIFT) @param {import('../types.js').Shape} s @returns {number[]} */
function outline(s) {
  const pts = [];
  const push = (x, z) => pts.push(x, LIFT, z);
  if (s.type === 'circle' || s.type === 'ring') {
    for (let i = 0; i <= SEG; i++) { const a = (i / SEG) * Math.PI * 2; push(s.x + Math.sin(a) * s.r, s.z + Math.cos(a) * s.r); }
  } else if (s.type === 'cone') {
    const half = (s.angle ?? 0) / 2, f = s.facing ?? 0;
    push(s.x, s.z);
    for (let i = 0; i <= SEG; i++) { const a = f - half + (i / SEG) * 2 * half; push(s.x + Math.sin(a) * s.r, s.z + Math.cos(a) * s.r); }
    push(s.x, s.z);
  } else if (s.type === 'line') {
    const f = s.facing ?? 0, fx = Math.sin(f), fz = Math.cos(f), rx = -Math.cos(f), rz = Math.sin(f);
    const hw = (s.width ?? 0) / 2, L = s.len ?? 0;
    for (const [a, b] of [[0, -hw], [L, -hw], [L, hw], [0, hw], [0, -hw]]) push(s.x + fx * a + rx * b, s.z + fz * a + rz * b);
  } else if (s.type === 'poly') {
    for (const p of s.pts ?? []) push(p.x, p.z);
  }
  return pts;
}

export class FxLayer {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.group = new THREE.Group();
    rc.layers.fx.add(this.group);
    this._matH = new THREE.LineBasicMaterial({ color: HOSTILE });
    this._matF = new THREE.LineBasicMaterial({ color: FRIENDLY });
    this._fillH = new THREE.MeshBasicMaterial({ color: HOSTILE, transparent: true, opacity: 0.25, depthWrite: false });
    /** @type {Array<{line:THREE.Line, key:string}>} */
    this._lines = [];
    /** @type {THREE.Mesh[]} */
    this._fills = [];
    this._fillGeo = new THREE.CircleGeometry(1, SEG);
    this._fillGeo.rotateX(-Math.PI / 2);
    this.projs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd080 }), MAX_PROJ);
    this.projs.count = 0;
    this.projs.frustumCulled = false;
    this.group.add(this.projs);
    this._m4 = new THREE.Matrix4();
  }

  /** @param {import('../types.js').MapData|null} map */
  setMap(map) {}

  /** @param {import('../types.js').GameState} state @param {number} alpha */
  update(state, alpha, dtReal, cameraTarget) {
    const rift = state.scene === 'rift' ? state.rift : null;
    const effects = rift ? rift.effects.slice(0, MAX_FX) : [];
    const tick = state.tick + alpha;
    effects.forEach((e, i) => {
      let slot = this._lines[i];
      const key = JSON.stringify(e.shape) + (e.hostile ? 'h' : 'f');
      if (!slot) {
        slot = { line: new THREE.Line(new THREE.BufferGeometry(), this._matF), key: '' };
        this._lines.push(slot);
        this.group.add(slot.line);
      }
      if (slot.key !== key) {
        slot.line.geometry.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(outline(e.shape), 3));
        slot.line.geometry = g;
        slot.line.material = e.hostile ? this._matH : this._matF;
        slot.key = key;
      }
      slot.line.visible = true;
      // 예고 채움(원 · 고리만 — 진행 = 틱)
      let fill = this._fills[i];
      if (!fill) {
        fill = new THREE.Mesh(this._fillGeo, this._fillH);
        this._fills.push(fill);
        this.group.add(fill);
      }
      const prog = e.hitAt > e.start ? Math.max(0, Math.min(1, (tick - e.start) / (e.hitAt - e.start))) : 1;
      const round = e.shape.type === 'circle' || e.shape.type === 'ring';
      fill.visible = e.hostile && round && tick < e.hitAt;
      if (fill.visible) {
        fill.position.set(e.shape.x, LIFT / 2, e.shape.z);
        fill.scale.setScalar(Math.max(0.01, e.shape.r * prog));
      }
    });
    for (let i = effects.length; i < this._lines.length; i++) this._lines[i].line.visible = false;
    for (let i = effects.length; i < this._fills.length; i++) this._fills[i].visible = false;

    let n = 0;
    if (rift) {
      for (const p of rift.projs) {
        if (n >= MAX_PROJ || p.until <= state.tick) continue;
        const x = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha, z = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
        this._m4.makeScale(p.r, p.r, p.r).setPosition(x, 1.0, z);
        this.projs.setMatrixAt(n++, this._m4);
      }
    }
    this.projs.count = n;
    this.projs.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const s of this._lines) { this.group.remove(s.line); s.line.geometry.dispose(); }
    for (const f of this._fills) this.group.remove(f);
    this._fillGeo.dispose();
    this._matH.dispose();
    this._matF.dispose();
    this._fillH.dispose();
    this.group.remove(this.projs);
    this.projs.geometry.dispose();
    /** @type {THREE.Material} */ (this.projs.material).dispose();
    this.rc.layers.fx.remove(this.group);
  }
}
