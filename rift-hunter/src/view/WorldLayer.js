// OWNER: P7 — 계약 §6.14 · §9.1 · §9.4 · §9.10
// 월드: 던전(지하 묘지 · 잿빛 동굴) · 마을 · 소품 · 빛 · 가리는 벽 낮추기 · 포털 틀 · 균열석 · 보관함 · 모닥불.
//   setMap(map) — MAP_LOADED 에서 app 이 sim.getMap() 을 넘긴다. 이전 맵의 지오메트리 · 인스턴스 버퍼 · 건물 재질을 해제하고 새로 짓는다.
//   update(state, alpha, dtReal, cameraTarget) — 상태를 읽어 벽 낮추기 · 빛 고르기 · 포털 · 마을 물체를 맞춘다(sim 상태를 고치지 않는다).
// 판정(sim)은 바뀌지 않는다 — 벽 낮추기는 보이는 것만. 프레임 경로는 할당 없이(형식 배열 · 미리 만든 객체).
// 내부 조립은 src/view/world/*(P7 폴더).

import * as THREE from 'three';
import { CAM_AZIMUTH, CAM_ELEVATION, DT, TILE } from '../core/constants.js';
import { EV } from '../core/events.js';
import { QUALITY } from '../data/quality.js';
import { GeoBuilder, seedOf } from './world/build.js';
import { buildEmitters, flameGeometry } from './world/emitters.js';
import { buildFloor } from './world/floor.js';
import { applyAtmosphere, flickerNoise, makeGlowTexture, pickNearest } from './world/lights.js';
import { WALL_FADE, occludesPlayer, propOccludesPlayer, stepFade } from './world/occlusion.js';
import { TALL_PROP_H, propBase, propParts } from './world/props.js';
import { EMIT, LIGHT_SCALE, OBJ, PLAYER_LIGHT, WALL_H } from './world/style.js';
import { buildTown } from './world/town.js';
import { wallPlacement, wallVariants } from './world/walls.js';

/** @typedef {import('../types.js').GameState} GameState */
/** @typedef {import('../types.js').MapData} MapData */

/** 동적 빛 후보(마을 포털 1 + 균열 포털 상한) */
const MAX_RIFT_PORTALS = 4;
const DYN = 1 + MAX_RIFT_PORTALS;
const LIGHT_FADE_SEC = 0.25;        // 빛 풀 배정이 바뀔 때 켜고 끄는 시간
const BUILDING_FADE = { opacity: 0.28, sec: 0.15, margin: 0.45, rayY: [0.3, 1.7] };
const PORTAL_GROW_SEC = 0.4;
const JUMP_SNAP = 2.5;              // m — 한 프레임에 이만큼 넘게 옮기면 낮추기를 바로(순간이동)
const PORTAL_LIGHT = { town: { color: OBJ.portalOpen, intensity: 1.7, radius: 7, y: 1.9, flicker: 0.08 }, recall: { color: OBJ.riftRecall, intensity: 1.5, radius: 6, y: 1.4, flicker: 0.08 }, exit: { color: OBJ.riftExit, intensity: 1.5, radius: 6, y: 1.4, flicker: 0.08 } };
const FIRST_RING = { r0: 1.5, r1: 1.75, y: 0.035, pulseHz: 0.8, min: 0.35, max: 0.85 };

// 카메라 쪽 방향(후광이 카메라를 본다 · 건물 가림 광선) — §0.2
const CAM_DX = Math.sin(CAM_AZIMUTH) * Math.cos(CAM_ELEVATION);
const CAM_DY = Math.sin(CAM_ELEVATION);
const CAM_DZ = Math.cos(CAM_AZIMUTH) * Math.cos(CAM_ELEVATION);
const GLOW_PULL = 0.45;             // 후광을 카메라 쪽으로 당겨 벽에 덜 묻히게(m)

export class WorldLayer {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.group = new THREE.Group();
    this.group.name = 'worldLayer';
    rc.layers.world.add(this.group);
    /** @type {MapData|null} */
    this.map = null;

    // ── 오래 사는 자원(맵과 무관 — dispose 에서만 해제) ──
    this._glowTex = makeGlowTexture();
    this.mats = {
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.5 }),
      emit: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
      flame: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
      glow: new THREE.MeshBasicMaterial({ map: this._glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      ring: new THREE.MeshBasicMaterial({ color: OBJ.firstRing, transparent: true, opacity: FIRST_RING.max, depthWrite: false, fog: false }),
      portalInner: new THREE.MeshBasicMaterial({ color: OBJ.portalOpenCore, map: this._glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      portalSurface: new THREE.MeshBasicMaterial({ color: OBJ.portalOpen, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    };
    this.mats.portalInner.color.multiplyScalar(2.2);
    this._geo = {
      flame: flameGeometry(),
      quad: new THREE.PlaneGeometry(1, 1),
      groundQuad: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      disk: new THREE.CircleGeometry(1, 40),
      portalFrame: new THREE.TorusGeometry(1, 0.075, 6, 40),
      portalGround: new THREE.RingGeometry(0.85, 1.12, 40).rotateX(-Math.PI / 2),
      firstRing: new THREE.RingGeometry(FIRST_RING.r0, FIRST_RING.r1, 56).rotateX(-Math.PI / 2),
    };
    // 마을 포털 안쪽 · 첫 판 흰 고리(마을 맵에서만 보인다)
    this._townPortalInner = new THREE.Group();
    this._townPortalInner.add(new THREE.Mesh(this._geo.disk, this.mats.portalSurface), new THREE.Mesh(this._geo.disk, this.mats.portalInner));
    this._townPortalInner.children[1].position.z = 0.02;
    this._townPortalInner.children[1].scale.setScalar(1.25);
    this._townPortalInner.visible = false;
    this._firstRing = new THREE.Mesh(this._geo.firstRing, this.mats.ring);
    this._firstRing.visible = false;
    this.group.add(this._townPortalInner, this._firstRing);
    /** 균열 포털 풀 @type {Array<{root:THREE.Group, frame:THREE.Mesh, disk:THREE.Mesh, ground:THREE.Mesh, mats:THREE.MeshBasicMaterial[], kind:string}>} */
    this._rportals = [];

    // 후광 방향(카메라를 본다 — 카메라 방위 · 앙각이 고정이라 한 번만)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(CAM_DX, CAM_DY, CAM_DZ));
    this._glowRot = new THREE.Matrix4().makeRotationFromQuaternion(q).elements.slice();

    /** 맵마다 짓는 것(setMap 이 해제) @type {THREE.Object3D[]} */
    this._mapObjs = [];
    /** @type {Array<THREE.BufferGeometry>} */
    this._mapGeos = [];
    /** @type {Array<THREE.Material>} */
    this._mapMats = [];
    this._resetRuntime();

    this._time = 0;
    this._lastSimT = -1;
    this._lastPX = 0; this._lastPZ = 0; this._hasLastP = false;
    this._snap = true;
    this._offs = [];
    if (bus && typeof bus.on === 'function') {
      this._offs.push(bus.on(EV.PLAYER_SPAWNED, () => { this._snap = true; }));
    }
  }

  /** 맵에 묶인 실행 상태(벽 낮추기 · 빛 후보 · 불꽃 · 후광) 비우기 */
  _resetRuntime() {
    // 낮추는 것(벽 · 키 큰 소품)
    this._fN = 0;
    this._fX = new Float32Array(0); this._fZ = new Float32Array(0); this._fYaw = new Float32Array(0);
    this._fSX = new Float32Array(0); this._fSY = new Float32Array(0); this._fSZ = new Float32Array(0);
    this._fLow = new Float32Array(0); this._fCur = new Float32Array(0);
    this._fR = new Float32Array(0); this._fH = new Float32Array(0);
    this._fStamp = new Int32Array(0); this._fGroup = new Int32Array(0); this._fLocal = new Int32Array(0);
    /** @type {THREE.InstancedMesh[][]} */
    this._fGroups = [];
    this._active = new Int32Array(0); this._activeN = 0; this._inActive = new Uint8Array(0);
    this._cellStart = new Int32Array(1); this._cellItems = new Int32Array(0);
    this._stamp = 0;
    // 빛 후보
    this._cN = 0; this._cMapN = 0;
    this._cX = new Float64Array(0); this._cY = new Float64Array(0); this._cZ = new Float64Array(0);
    this._cI = new Float32Array(0); this._cR = new Float32Array(0); this._cF = new Float32Array(0); this._cPh = new Float32Array(0);
    this._cOn = new Uint8Array(0);
    /** @type {THREE.Color[]} */
    this._cCol = [];
    this._cSel = new Int32Array(0); this._cAsg = new Int32Array(0);
    this._selIdx = new Int32Array(16); this._selD = new Float64Array(16);
    this._lightStamp = 0;
    // 불꽃 · 후광
    /** @type {THREE.InstancedMesh|null} */ this._flames = null;
    this._flX = new Float32Array(0); this._flY = new Float32Array(0); this._flZ = new Float32Array(0); this._flS = new Float32Array(0);
    /** @type {THREE.InstancedMesh|null} */ this._glows = null;
    /** @type {THREE.InstancedMesh|null} */ this._gglows = null;
    /** @type {Array<{mesh:THREE.InstancedMesh, idx:number, x:number, y:number, z:number, size:number, cand:number, ground:boolean, tag:string}>} */
    this._glowSpots = [];
    // 마을
    /** @type {Array<{x0:number, x1:number, z0:number, z1:number, h:number, mats:THREE.Material[], cur:number}>} */
    this._buildings = [];
    this._townPortal = null;
    this._riftStone = null;
    this._riftStoneGlow = -1;
    this._dynTown = -1;
    this._dynRift = -1;
  }

  _own(obj) {
    this.group.add(obj);
    this._mapObjs.push(obj);
    return obj;
  }

  _geoOwn(g) {
    this._mapGeos.push(g);
    return g;
  }

  /** 이전 맵 자원 해제 */
  _clearMap() {
    for (const o of this._mapObjs) {
      this.group.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
    }
    for (const g of this._mapGeos) g.dispose();
    for (const m of this._mapMats) m.dispose();
    this._mapObjs = [];
    this._mapGeos = [];
    this._mapMats = [];
    const L = this.rc.lights;
    if (L) for (const l of L.pool) { l.userData.cand = -1; l.userData.w = 0; l.intensity = 0; }
    this._resetRuntime();
  }

  /**
   * 이전 맵 지오메트리 해제 → 새 맵
   * @param {MapData|null} map
   */
  setMap(map) {
    this._clearMap();
    this.map = map ?? null;
    this._snap = true;
    this._hasLastP = false;
    this._lastSimT = -1;
    this._townPortalInner.visible = false;
    this._firstRing.visible = false;
    for (const p of this._rportals) p.root.visible = false;
    if (!map) return;
    applyAtmosphere(this.rc, map.tileset);
    const seed = seedOf(map.id ?? 'map');
    const M = this.mats;

    // 바닥
    const floor = new THREE.Mesh(this._geoOwn(buildFloor(map, seed)), M.matte);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this._own(floor);

    // 낮추는 것 목록(벽 + 키 큰 소품) — 크기를 먼저 센다
    const walls = wallPlacement(map, seed);
    const tall = map.props.filter(p => p.block && p.h >= TALL_PROP_H);
    const nF = walls.length + tall.length;
    this._allocFade(nF);

    // 벽 — 변형마다 InstancedMesh 하나
    const variants = wallVariants(map.tileset);
    const perVar = variants.map(() => 0);
    for (const w of walls) perVar[w.variant]++;
    const wallMeshes = variants.map((g, v) => {
      this._geoOwn(g);
      if (!perVar[v]) return null;
      const mesh = new THREE.InstancedMesh(g, M.matte, perVar[v]);
      mesh.name = 'walls';
      // 벽은 그림자를 드리우지 않는다(high 의 점광원 그림자는 큐브 6면 — 벽 수만큼 드는 비용에 비해 방 안에서 보이는 차이가 없다) · 받기는 한다
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      return this._own(mesh);
    });
    const wallGroupOf = wallMeshes.map(m => (m ? this._fGroups.push([m]) - 1 : -1));
    const used = variants.map(() => 0);
    const tint = new THREE.Color();
    for (const w of walls) {
      const mesh = /** @type {THREE.InstancedMesh} */ (wallMeshes[w.variant]);
      const local = used[w.variant]++;
      this._addFade(w.x, w.z, w.yaw, 1, 1, 1, WALL_FADE.lowH / WALL_H, wallGroupOf[w.variant], local);
      mesh.setColorAt(local, tint.setScalar(w.tint));
    }

    // 소품 — kind 마다 부품별 InstancedMesh
    /** @type {Map<string, import('../types.js').Prop[]>} */
    const byKind = new Map();
    for (const p of map.props) {
      if (!byKind.has(p.kind)) byKind.set(p.kind, []);
      /** @type {import('../types.js').Prop[]} */ (byKind.get(p.kind)).push(p);
    }
    for (const [kind, list] of byKind) {
      const parts = propParts(kind);
      const base = propBase(kind);
      const meshes = parts.map(part => {
        this._geoOwn(part.geo);
        const mesh = new THREE.InstancedMesh(part.geo, M[part.mat] ?? M.matte, list.length);
        mesh.name = 'prop:' + kind;
        mesh.castShadow = part.mat !== 'emit';
        mesh.receiveShadow = part.mat !== 'emit';
        return this._own(mesh);
      });
      const gi = this._fGroups.push(meshes) - 1;
      list.forEach((p, k) => {
        const sx = p.r / base.r, sy = p.h / base.h;
        const isTall = p.block && p.h >= TALL_PROP_H;
        if (isTall) this._addFade(p.x, p.z, p.facing, sx, sy, sx, Math.min(1, WALL_FADE.lowH / p.h), gi, k, p.r, p.h);
        else this._writeInstance(meshes, k, p.x, p.z, p.facing, sx, sy, sx);
      });
    }

    // 정적 장식(발광체 받침 · 마을 물체) — 재질별 병합 메시 하나씩
    const SM = new GeoBuilder(), ST = new GeoBuilder(), SE = new GeoBuilder();
    /** @type {Array<{x:number, y:number, z:number, s:number}>} */
    const flames = [];
    /** @type {Array<{x:number, y:number, z:number, size:number, color:number, k:number, ground?:boolean, cand?:number, tag?:string}>} */
    const glows = [];
    buildEmitters(map, SM, ST, SE, flames, glows);
    this._buildLightCandidates(map);
    if (map.kind === 'town') this._buildTown(map, seed, flames, glows);
    for (const [b, mat, name] of [[SM, M.matte, 'deco'], [ST, M.metal, 'decoMetal'], [SE, M.emit, 'decoEmit']]) {
      if (!b.vertexCount) continue;
      const mesh = new THREE.Mesh(this._geoOwn(b.build()), mat);
      mesh.name = name;
      mesh.castShadow = mat !== M.emit;
      mesh.receiveShadow = mat !== M.emit;
      this._own(mesh);
    }
    this._buildFlames(flames);
    this._buildGlows(glows);
    this._buildFadeGrid(map);
    for (const g of this._fGroups) for (const m of g) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
  }

  // ───────────────────────── 낮추기(벽 · 키 큰 소품) ─────────────────────────

  _allocFade(n) {
    this._fX = new Float32Array(n); this._fZ = new Float32Array(n); this._fYaw = new Float32Array(n);
    this._fSX = new Float32Array(n); this._fSY = new Float32Array(n); this._fSZ = new Float32Array(n);
    this._fLow = new Float32Array(n); this._fCur = new Float32Array(n).fill(1);
    this._fR = new Float32Array(n); this._fH = new Float32Array(n);
    this._fStamp = new Int32Array(n); this._fGroup = new Int32Array(n); this._fLocal = new Int32Array(n);
    this._active = new Int32Array(n); this._activeN = 0; this._inActive = new Uint8Array(n);
    this._fN = 0;
  }

  /** r · h 가 0 이면 벽(계약 판정) · 아니면 키 큰 소품(좁은 판정) */
  _addFade(x, z, yaw, sx, sy, sz, low, group, local, r = 0, h = 0) {
    const k = this._fN++;
    this._fR[k] = r; this._fH[k] = h;
    this._fX[k] = x; this._fZ[k] = z; this._fYaw[k] = yaw;
    this._fSX[k] = sx; this._fSY[k] = sy; this._fSZ[k] = sz;
    this._fLow[k] = low; this._fCur[k] = 1;
    this._fGroup[k] = group; this._fLocal[k] = local;
    this._writeInstance(this._fGroups[group], local, x, z, yaw, sx, sy, sz);
  }

  /** 인스턴스 행렬 = 이동(x, 0, z) · yaw · 배율 — 할당 없이 배열에 직접 */
  _writeInstance(meshes, local, x, z, yaw, sx, sy, sz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const a = mesh.instanceMatrix.array, o = local * 16;
      a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -s * sx; a[o + 3] = 0;
      a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
      a[o + 8] = s * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
      a[o + 12] = x; a[o + 13] = 0; a[o + 14] = z; a[o + 15] = 1;
      const u = mesh.userData;
      if (u.dmin === undefined || local < u.dmin) u.dmin = local;
      if (u.dmax === undefined || local > u.dmax) u.dmax = local;
    }
  }

  /** 낮추는 것을 타일 칸으로 나눠 둔다(CSR) — 프레임마다 플레이어 둘레 칸만 본다 */
  _buildFadeGrid(map) {
    const nCell = map.w * map.h;
    const start = new Int32Array(nCell + 1);
    const cellOf = new Int32Array(this._fN);
    for (let k = 0; k < this._fN; k++) {
      const i = Math.min(map.w - 1, Math.max(0, Math.floor(this._fX[k] / TILE)));
      const j = Math.min(map.h - 1, Math.max(0, Math.floor(this._fZ[k] / TILE)));
      cellOf[k] = j * map.w + i;
      start[cellOf[k] + 1]++;
    }
    for (let c = 0; c < nCell; c++) start[c + 1] += start[c];
    const fill = start.slice(0, nCell);
    const items = new Int32Array(this._fN);
    for (let k = 0; k < this._fN; k++) items[fill[cellOf[k]]++] = k;
    this._cellStart = start;
    this._cellItems = items;
    for (const g of this._fGroups) for (const m of g) { m.userData.dmin = undefined; m.userData.dmax = undefined; }
  }

  /** 플레이어(px, pz) 둘레의 가리는 것을 낮추고, 벗어난 것은 돌려놓는다 */
  _updateFade(px, pz, hasPlayer, dt, smooth, snap) {
    const map = /** @type {MapData} */ (this.map);
    const stamp = ++this._stamp;
    if (hasPlayer) {
      const R = Math.ceil(WALL_FADE.range / TILE) + 1;
      const pi = Math.floor(px / TILE), pj = Math.floor(pz / TILE);
      const i0 = Math.max(0, pi - R), i1 = Math.min(map.w - 1, pi + R);
      const j0 = Math.max(0, pj - R), j1 = Math.min(map.h - 1, pj + R);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = j * map.w + i;
          for (let q = this._cellStart[c], e = this._cellStart[c + 1]; q < e; q++) {
            const k = this._cellItems[q];
            const dx = this._fX[k] - px, dz = this._fZ[k] - pz;
            if (!(this._fR[k] > 0 ? propOccludesPlayer(dx, dz, this._fR[k], this._fH[k]) : occludesPlayer(dx, dz))) continue;
            this._fStamp[k] = stamp;
            if (!this._inActive[k]) { this._inActive[k] = 1; this._active[this._activeN++] = k; }
          }
        }
      }
    }
    for (let a = this._activeN - 1; a >= 0; a--) {
      const k = this._active[a];
      const low = this._fLow[k];
      const target = this._fStamp[k] === stamp ? low : 1;
      const cur = this._fCur[k];
      const next = snap ? target : stepFade(cur, target, dt, smooth, low);
      if (next !== cur) {
        this._fCur[k] = next;
        this._writeInstance(this._fGroups[this._fGroup[k]], this._fLocal[k], this._fX[k], this._fZ[k], this._fYaw[k], this._fSX[k], this._fSY[k] * next, this._fSZ[k]);
      }
      if (next === 1 && target === 1) {
        this._inActive[k] = 0;
        this._active[a] = this._active[--this._activeN];
      }
    }
    for (const g of this._fGroups) for (const m of g) {
      const u = m.userData;
      if (u.dmin === undefined) continue;
      const attr = m.instanceMatrix;
      attr.clearUpdateRanges();
      attr.addUpdateRange(u.dmin * 16, (u.dmax - u.dmin + 1) * 16);
      attr.needsUpdate = true;
      u.dmin = undefined; u.dmax = undefined;
    }
  }

  /** 지금 낮춰져 있는(배율 < 1) 것의 수 · 목록(테스트 · 디버그) @returns {number[]} 인스턴스 자리(벽은 타일 순) */
  loweredIndices() {
    const out = [];
    for (let k = 0; k < this._fN; k++) if (this._fCur[k] < 1) out.push(k);
    return out;
  }

  // ───────────────────────── 빛 ─────────────────────────

  _buildLightCandidates(map) {
    const nMap = map.lights.length, n = nMap + DYN;
    this._cN = n; this._cMapN = nMap;
    this._cX = new Float64Array(n); this._cY = new Float64Array(n); this._cZ = new Float64Array(n);
    this._cI = new Float32Array(n); this._cR = new Float32Array(n); this._cF = new Float32Array(n); this._cPh = new Float32Array(n);
    this._cOn = new Uint8Array(n);
    this._cCol = [];
    this._cSel = new Int32Array(n); this._cAsg = new Int32Array(n);
    map.lights.forEach((l, i) => {
      // 종류별 보정(EMIT.lightY · lightColor — 바닥 가까운 빛이 바닥에 진한 원반을 만들지 않게 · 화면 패스)
      const spec = EMIT[l.kind];
      this._cX[i] = l.x; this._cY[i] = spec?.lightY != null ? Math.max(l.y, spec.lightY) : l.y; this._cZ[i] = l.z;
      this._cI[i] = l.intensity; this._cR[i] = l.radius; this._cF[i] = l.flicker;
      this._cPh[i] = (i * 2.399) % (Math.PI * 2);
      this._cOn[i] = 1;
      this._cCol.push(new THREE.Color(spec?.lightColor ?? l.color));
    });
    for (let d = 0; d < DYN; d++) {
      const i = nMap + d;
      this._cCol.push(new THREE.Color(0xffffff));
      this._cPh[i] = (i * 2.399) % (Math.PI * 2);
    }
    this._dynTown = nMap;
    this._dynRift = nMap + 1;
  }

  _setDyn(i, x, y, z, spec, on) {
    this._cOn[i] = on ? 1 : 0;
    if (!on) return;
    this._cX[i] = x; this._cY[i] = y; this._cZ[i] = z;
    this._cI[i] = spec.intensity; this._cR[i] = spec.radius; this._cF[i] = spec.flicker;
    this._cCol[i].setHex(spec.color);
  }

  /** 가까운 maxLights − 1 개를 풀에 배정(배정이 바뀌면 0.25초에 켜고 끈다) · 깜빡임 */
  _updateLights(tx, tz, dt, snap) {
    const L = this.rc.lights;
    if (!L) return;
    const pool = L.pool;
    const K = pool.length;
    if (!K) return;
    if (this._selIdx.length < K) { this._selIdx = new Int32Array(K); this._selD = new Float64Array(K); }
    const m = pickNearest(this._cX, this._cZ, this._cOn, this._cN, tx, tz, K, this._selIdx, this._selD);
    const stamp = ++this._lightStamp;
    for (let s = 0; s < m; s++) this._cSel[this._selIdx[s]] = stamp;
    const rate = dt / LIGHT_FADE_SEC;
    for (let p = 0; p < K; p++) {
      const l = pool[p], u = l.userData;
      if (u.cand < 0) continue;
      const keep = u.cand < this._cN && this._cSel[u.cand] === stamp;
      if (keep) this._cAsg[u.cand] = stamp;
      const target = keep ? 1 : 0;
      u.w = snap ? target : (u.w < target ? Math.min(target, u.w + rate) : Math.max(target, u.w - rate));
      if (!keep && u.w <= 0) { u.cand = -1; u.w = 0; }
    }
    for (let s = 0; s < m; s++) {
      const c = this._selIdx[s];
      if (this._cAsg[c] === stamp) continue;
      for (let p = 0; p < K; p++) {
        const u = pool[p].userData;
        if (u.cand >= 0) continue;
        u.cand = c; u.w = snap ? 1 : 0;
        this._cAsg[c] = stamp;
        break;
      }
    }
    const t = this._time;
    for (let p = 0; p < K; p++) {
      const l = pool[p], u = l.userData;
      if (u.cand < 0) { l.intensity = 0; continue; }
      const c = u.cand;
      l.position.set(this._cX[c], this._cY[c], this._cZ[c]);
      l.color.copy(this._cCol[c]);
      l.distance = this._cR[c];
      const f = 1 + this._cF[c] * flickerNoise(t, this._cPh[c]);
      l.intensity = this._cI[c] * LIGHT_SCALE * u.w * f;
    }
  }

  // ───────────────────────── 불꽃 · 후광 ─────────────────────────

  _buildFlames(flames) {
    if (!flames.length) return;
    const mesh = new THREE.InstancedMesh(this._geo.flame, this.mats.flame, flames.length);
    mesh.name = 'flames';
    this._flX = new Float32Array(flames.length); this._flY = new Float32Array(flames.length);
    this._flZ = new Float32Array(flames.length); this._flS = new Float32Array(flames.length);
    flames.forEach((f, i) => {
      this._flX[i] = f.x; this._flY[i] = f.y; this._flZ[i] = f.z; this._flS[i] = f.s;
      writeTRS(mesh.instanceMatrix.array, i, f.x, f.y, f.z, f.s, f.s, f.s);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this._flames = this._own(mesh);
  }

  _buildGlows(glows) {
    const bill = glows.filter(g => !g.ground), ground = glows.filter(g => g.ground);
    const col = new THREE.Color();
    const make = (list, geo, name) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(geo, this.mats.glow, list.length);
      mesh.name = name;
      list.forEach((g, i) => {
        mesh.setColorAt(i, col.setHex(g.color).multiplyScalar(g.k));
        this._glowSpots.push({ mesh, idx: i, x: g.x, y: g.y, z: g.z, size: g.size, cand: g.cand ?? -1, ground: !!g.ground, tag: g.tag ?? '' });
      });
      return this._own(mesh);
    };
    this._glows = make(bill, this._geo.quad, 'glows');
    this._gglows = make(ground, this._geo.groundQuad, 'groundGlows');
    this._riftStoneGlow = this._glowSpots.findIndex(s => s.tag === 'riftStone');
    this._writeGlows(1);
    for (const m of [this._glows, this._gglows]) if (m) { if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
  }

  /** 후광 크기(깜빡임 — 실제 시간) @param {number} pulse 균열석 후광 배율 */
  _writeGlows(pulse) {
    const R = this._glowRot, t = this._time;
    for (let i = 0; i < this._glowSpots.length; i++) {
      const g = this._glowSpots[i];
      const f = g.cand >= 0 && g.cand < this._cMapN ? 1 + 0.6 * this._cF[g.cand] * flickerNoise(t, this._cPh[g.cand]) : 1;
      const s = g.size * f * (i === this._riftStoneGlow ? pulse : 1);
      const a = g.mesh.instanceMatrix.array, o = g.idx * 16;
      if (g.ground) writeTRS(a, g.idx, g.x, g.y, g.z, s, 1, s);
      else {
        a[o] = R[0] * s; a[o + 1] = R[1] * s; a[o + 2] = R[2] * s; a[o + 3] = 0;
        a[o + 4] = R[4] * s; a[o + 5] = R[5] * s; a[o + 6] = R[6] * s; a[o + 7] = 0;
        a[o + 8] = R[8] * s; a[o + 9] = R[9] * s; a[o + 10] = R[10] * s; a[o + 11] = 0;
        a[o + 12] = g.x + CAM_DX * GLOW_PULL; a[o + 13] = g.y + CAM_DY * GLOW_PULL; a[o + 14] = g.z + CAM_DZ * GLOW_PULL; a[o + 15] = 1;
      }
    }
    if (this._glows) this._glows.instanceMatrix.needsUpdate = true;
    if (this._gglows) this._gglows.instanceMatrix.needsUpdate = true;
  }

  _updateFlames() {
    const mesh = this._flames;
    if (!mesh) return;
    const a = mesh.instanceMatrix.array, t = this._time;
    for (let i = 0; i < this._flS.length; i++) {
      const s = this._flS[i];
      const n1 = flickerNoise(t * 1.3, i * 1.7), n2 = flickerNoise(t * 1.9, i * 2.9 + 1);
      writeTRS(a, i, this._flX[i], this._flY[i], this._flZ[i], s * (1 + 0.1 * n1), s * (1 + 0.22 * n2), s * (1 + 0.1 * n1));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ───────────────────────── 마을 ─────────────────────────

  _buildTown(map, seed, flames, glows) {
    const T = buildTown(map, seed);
    for (const [g, mat, name] of [[T.matte, this.mats.matte, 'town'], [T.metal, this.mats.metal, 'townMetal'], [T.emit, this.mats.emit, 'townEmit']]) {
      this._geoOwn(g);
      if (!g.getAttribute('position').count) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.castShadow = mat !== this.mats.emit;
      mesh.receiveShadow = mat !== this.mats.emit;
      this._own(mesh);
    }
    for (const b of T.buildings) {
      const mm = this.mats.matte.clone(); mm.transparent = true;
      const me = this.mats.emit.clone(); me.transparent = true;
      this._mapMats.push(mm, me);
      const gm = new THREE.Mesh(this._geoOwn(b.matte), mm);
      gm.name = 'building:' + b.id;
      gm.castShadow = true; gm.receiveShadow = true;
      this._own(gm);
      this._geoOwn(b.emit);
      if (b.emit.getAttribute('position').count) { const ge = new THREE.Mesh(b.emit, me); ge.name = 'buildingEmit:' + b.id; this._own(ge); }
      this._buildings.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, h: b.h, mats: [mm, me], cur: 1 });
    }
    flames.push(...T.flames);
    glows.push(...T.glows);
    if (T.portal) {
      const p = T.portal;
      this._townPortal = p;
      const m = this._townPortalInner;
      m.position.set(p.x, 2.15, p.z);
      m.rotation.set(0, p.facing, 0);
      m.scale.set(1.18, 1.9, 1);
    }
    if (T.riftStone) {
      this._riftStone = T.riftStone;
      this._firstRing.position.set(T.riftStone.x, FIRST_RING.y, T.riftStone.z);
    }
  }

  /** 건물이 플레이어를 가리면 반투명(0.15초) */
  _updateBuildings(px, pz, hasPlayer, dt, snap) {
    for (const b of this._buildings) {
      let hit = false;
      if (hasPlayer) for (const y of BUILDING_FADE.rayY) if (rayHitsBox(px, y, pz, b.x0 - BUILDING_FADE.margin, b.x1 + BUILDING_FADE.margin, b.h + 0.6, b.z0 - BUILDING_FADE.margin, b.z1 + BUILDING_FADE.margin)) { hit = true; break; }
      const target = hit ? BUILDING_FADE.opacity : 1;
      const rate = (1 - BUILDING_FADE.opacity) / BUILDING_FADE.sec * dt;
      const next = snap ? target : (b.cur < target ? Math.min(target, b.cur + rate) : Math.max(target, b.cur - rate));
      if (next === b.cur) continue;
      b.cur = next;
      for (const m of b.mats) { m.opacity = next; m.depthWrite = next > 0.99; }
    }
  }

  // ───────────────────────── 포털 ─────────────────────────

  _riftPortal(i) {
    while (this._rportals.length <= i) {
      const frameM = new THREE.MeshBasicMaterial({ color: OBJ.riftRecall, fog: false });
      const diskM = new THREE.MeshBasicMaterial({ color: OBJ.riftRecall, map: this._glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const groundM = new THREE.MeshBasicMaterial({ color: OBJ.riftRecall, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const root = new THREE.Group();
      root.name = 'riftPortal';
      const frame = new THREE.Mesh(this._geo.portalFrame, frameM);
      const disk = new THREE.Mesh(this._geo.disk, diskM);
      const ground = new THREE.Mesh(this._geo.portalGround, groundM);
      root.add(frame, disk, ground);
      root.visible = false;
      this.group.add(root);
      this._rportals.push({ root, frame, disk, ground, mats: [frameM, diskM, groundM], kind: '' });
    }
    return this._rportals[i];
  }

  /** @param {GameState} state @param {number} alpha */
  _updatePortals(state, alpha) {
    const map = /** @type {MapData} */ (this.map);
    const t = this._time;
    // 마을 포털 — 열린 균열이 있으면 안쪽 발광 + 빛
    const town = map.kind === 'town';
    const open = town && !!state.town?.portalOpen && !!this._townPortal;
    this._townPortalInner.visible = open;
    if (open) { this.mats.portalInner.opacity = 0.8 + 0.2 * Math.sin(t * 2.2); this.mats.portalSurface.opacity = 0.5 + 0.1 * Math.sin(t * 1.7); }
    if (this._dynTown >= 0) {
      const p = this._townPortal;
      if (p) this._setDyn(this._dynTown, p.x + Math.sin(p.facing) * 0.8, PORTAL_LIGHT.town.y, p.z + Math.cos(p.facing) * 0.8, PORTAL_LIGHT.town, open);
      else this._cOn[this._dynTown] = 0;
    }
    // 첫 판 전 균열석 발밑 흰 고리
    const first = town && !!this._riftStone && !!state.char && state.char.runs === 0;
    this._firstRing.visible = first;
    if (first) this.mats.ring.opacity = FIRST_RING.min + (FIRST_RING.max - FIRST_RING.min) * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * FIRST_RING.pulseHz));
    // 균열 포털(빛 고리)
    const portals = map.kind === 'rift' && state.rift && state.scene === 'rift' ? state.rift.portals : null;
    const n = portals ? Math.min(portals.length, MAX_RIFT_PORTALS) : 0;
    for (let i = 0; i < n; i++) {
      const p = /** @type {any[]} */ (portals)[i];
      const e = this._riftPortal(i);
      const spec = p.kind === 'exit' ? PORTAL_LIGHT.exit : PORTAL_LIGHT.recall;
      if (e.kind !== p.kind) {
        e.kind = p.kind;
        for (const m of e.mats) m.color.setHex(spec.color);
      }
      const grow = Math.min(1, Math.max(0, (state.tick + alpha - p.born) * DT / PORTAL_GROW_SEC));
      const r = (p.r || 1) * (0.2 + 0.8 * grow);
      e.root.visible = true;
      e.root.position.set(p.pos.x, 0, p.pos.z);
      e.root.rotation.set(0, CAM_AZIMUTH, 0);
      e.frame.position.set(0, 1.45, 0); e.frame.scale.set(r * 0.92, r * 1.38, r);
      e.disk.position.set(0, 1.45, 0); e.disk.scale.set(r * 0.9, r * 1.36, 1);
      e.ground.position.set(0, 0.04, 0); e.ground.scale.set(r, 1, r);
      e.mats[1].opacity = 0.8 + 0.15 * Math.sin(t * 3 + i);
      e.mats[2].opacity = 0.5 + 0.25 * Math.sin(t * 2.4 + i);
      this._setDyn(this._dynRift + i, p.pos.x, spec.y, p.pos.z, spec, true);
    }
    for (let i = n; i < this._rportals.length; i++) this._rportals[i].root.visible = false;
    for (let i = n; i < MAX_RIFT_PORTALS; i++) if (this._dynRift >= 0) this._cOn[this._dynRift + i] = 0;
  }

  // ───────────────────────── 프레임 ─────────────────────────

  /**
   * 벽 낮추기 · 빛 고르기 · 포털 · 마을 물체 · 불꽃
   * @param {GameState} state @param {number} alpha @param {number} dtReal @param {{x:number, z:number}|null} [cameraTarget]
   */
  update(state, alpha, dtReal, cameraTarget) {
    if (!this.map || !state) return;
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    // 시간: 실제 시간이 흐르면 그것, 정지 화면(step — dtReal 0)이면 민 틱만큼
    const simT = (state.tick ?? 0) + a;
    const simDt = this._lastSimT >= 0 ? Math.min(1, Math.max(0, (simT - this._lastSimT) * DT)) : 0;
    this._lastSimT = simT;
    const dt = dtReal > 0 ? Math.min(dtReal, 1) : simDt;
    this._time += dt;
    let snap = this._snap;
    this._snap = false;

    const q = this.rc.quality ?? this.settings?.quality ?? 'medium';
    const Q = QUALITY[q] ?? QUALITY.medium;

    const p = state.player;
    const hasPlayer = !!p && !!p.pos;
    let px = 0, pz = 0;
    if (hasPlayer) {
      const pp = p.prevPos ?? p.pos;
      px = pp.x + (p.pos.x - pp.x) * a;
      pz = pp.z + (p.pos.z - pp.z) * a;
      if (!Number.isFinite(px) || !Number.isFinite(pz)) { px = p.pos.x; pz = p.pos.z; }
      // 한 프레임에 크게 옮겼으면(순간이동 · 돌진 끝 · 상태 교체) 가리는 것을 바로 맞춘다 — 새 자리에서 벽 뒤에 숨는 프레임이 없게
      if (this._hasLastP && (px - this._lastPX) ** 2 + (pz - this._lastPZ) ** 2 > JUMP_SNAP * JUMP_SNAP) snap = true;
      this._lastPX = px; this._lastPZ = pz; this._hasLastP = true;
    }
    const L = this.rc.lights;
    if (L) {
      L.player.position.set(px, PLAYER_LIGHT.y, pz);
      L.player.intensity = hasPlayer ? PLAYER_LIGHT.intensity * LIGHT_SCALE : 0;
    }

    this._updateFade(px, pz, hasPlayer, dt, Q.wallFadeSmooth, snap);
    this._updateBuildings(px, pz, hasPlayer, dt, snap || !Q.wallFadeSmooth);
    this._updatePortals(state, a);
    const tx = cameraTarget && Number.isFinite(cameraTarget.x) ? cameraTarget.x : px;
    const tz = cameraTarget && Number.isFinite(cameraTarget.z) ? cameraTarget.z : pz;
    this._updateLights(tx, tz, dt, snap);
    this._updateFlames();
    const pulse = 1 + 0.12 * Math.sin(this._time * 1.6);
    this._writeGlows(pulse);
  }

  dispose() {
    this._clearMap();
    for (const off of this._offs) if (typeof off === 'function') off();
    this._offs = [];
    for (const p of this._rportals) { this.group.remove(p.root); for (const m of p.mats) m.dispose(); }
    this._rportals = [];
    this.group.remove(this._townPortalInner, this._firstRing);
    for (const g of Object.values(this._geo)) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this._glowTex.dispose();
    this.rc.layers.world.remove(this.group);
    this.map = null;
  }
}

/** 위치 · 축 배율 행렬(회전 없음)을 배열에 직접 */
function writeTRS(a, i, x, y, z, sx, sy, sz) {
  const o = i * 16;
  a[o] = sx; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
  a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
  a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = sz; a[o + 11] = 0;
  a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
}

/** 플레이어(px, py, pz)에서 카메라 쪽으로 쏜 광선이 상자 [x0,x1]×[0,h]×[z0,z1] 를 지나는가(slab · 할당 없음) */
export function rayHitsBox(px, py, pz, x0, x1, h, z0, z1) {
  // 카메라 쪽 방향의 세 성분은 모두 양수(§0.2 — +X+Z 위)
  let tmin = 0, tmax = Infinity;
  let t0 = (x0 - px) / CAM_DX, t1 = (x1 - px) / CAM_DX;
  if (t0 > tmin) tmin = t0;
  if (t1 < tmax) tmax = t1;
  t0 = (0 - py) / CAM_DY; t1 = (h - py) / CAM_DY;
  if (t0 > tmin) tmin = t0;
  if (t1 < tmax) tmax = t1;
  t0 = (z0 - pz) / CAM_DZ; t1 = (z1 - pz) / CAM_DZ;
  if (t0 > tmin) tmin = t0;
  if (t1 < tmax) tmax = t1;
  return tmin <= tmax && tmax > 0;
}
