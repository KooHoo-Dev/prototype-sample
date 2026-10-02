// OWNER: P5 — 계약 §6.9 · §9.1 · §9.3
// STUB — W0 스텁(§6.14) · 자리 표시: 하늘색 배경(clock.light 로 밝기) · 방향광 · 야외는 땅(+Z) · 물(−Z, y 0) · 해안선 띠 · 자리 표식 고리
//   · 장애물 띠 부채꼴 · NPC/캠프 자리의 기둥 · 집은 방 상자 · STAGE_PROPS 의 소품 그룹. heightAt → 0.
//   W0 최소 부트 확인용으로 찌(구) · 물고기(상자) 표식도 그린다 — 진짜는 P6(TackleLayer · FishLayer). P5 가 전부 다시 쓴다.

import * as THREE from 'three';
import { fwd, lerp, lerpAngle } from '../core/math.js';
import { STAGES } from '../data/stages/index.js';
import { WEATHER } from '../data/weather.js';
import { STAGE_PROPS } from './stages/index.js';

const NIGHT_SKY = new THREE.Color('#0b1222');
const INDOOR_BG = new THREE.Color('#1a1714');
const RING_COLOR = '#ffffff';
const NPC_COLOR = '#d8783a';
const CAMP_COLOR = '#8a5a2e';
const BOBBER_COLOR = '#ff6a1a';
const FISH_COLOR = '#c02828';
const SNAG_COLORS = { mud: '#3d6a2a', rock: '#5a5a5a', gravel: '#6a5030', sand: '#a89a70' };
const SPOT_RING = { inner: 1.1, outer: 1.3 };
const POLE_H = 1.1;
const SNAG_DEPTH = 8;

export class WorldLayer {
  /** @param {{rc:import('./renderer.js').RenderContext, bus:Object, settings:Object}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.root = new THREE.Group();
    this.root.name = 'worldRoot';
    rc.scene.add(this.root);
    this.bg = new THREE.Color();
    rc.scene.background = this.bg;
    this.time = 0;

    this.hemi = new THREE.HemisphereLight('#dfefff', '#404830', 0.6);
    this.sun = new THREE.DirectionalLight('#ffffff', 1.5);
    this.root.add(this.hemi, this.sun, this.sun.target);

    /** @type {Record<string, {group:THREE.Group, stage:Object, rings:Record<string, THREE.Mesh>, props:Object}>} */
    this.scenes = {};
    for (const stage of STAGES) this.scenes[stage.id] = this._buildScene(stage);

    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: BOBBER_COLOR }));
    const fish = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 1), new THREE.MeshLambertMaterial({ color: FISH_COLOR }));
    bob.visible = false;
    fish.visible = false;
    this.bobber = bob;
    this.fish = fish;
    this.root.add(bob, fish);
    this.sunDir = new THREE.Vector3();
  }

  _buildScene(stage) {
    const group = new THREE.Group();
    group.name = `scene:${stage.id}`;
    group.visible = false;
    const rings = {};
    const look = stage.look;
    if (stage.kind === 'interior') {
      const { w, d, h } = look.room;
      const room = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: look.wall, side: THREE.BackSide }));
      room.position.y = h / 2;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: look.floor }));
      floor.position.y = 0.01;
      group.add(room, floor);
      for (const p of stage.points) {
        const size = p.kind === 'door' ? [1.0, 2.1, 0.08] : p.kind === 'bed' ? [1.0, 0.5, 2.0] : [1.2, 0.75, 0.6];
        const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshLambertMaterial({ color: p.kind === 'pc' ? '#3a3f4a' : p.kind === 'bed' ? '#6a7fa0' : '#7a5a3a' }));
        m.position.set(p.x, size[1] / 2, p.z);
        m.rotation.y = p.yaw;
        group.add(m);
      }
    } else {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 3000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: look.water.shallow }));
      water.position.set(0, 0, -1490);
      const shape = new THREE.Shape();
      const sh = stage.shore;
      shape.moveTo(sh[0].x, sh[0].z);
      for (let i = 1; i < sh.length; i++) shape.lineTo(sh[i].x, sh[i].z);
      shape.lineTo(sh[sh.length - 1].x, 400);
      shape.lineTo(sh[0].x, 400);
      shape.closePath();
      const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: look.terrain.ground, side: THREE.DoubleSide }));
      ground.position.y = 0.03;
      const shoreLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(sh.map(p => new THREE.Vector3(p.x, 0.06, p.z))),
        new THREE.LineBasicMaterial({ color: look.terrain.shore }),
      );
      const ridgeH = look.ridge.height * 0.3;
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(4000, ridgeH, 60), new THREE.MeshLambertMaterial({ color: look.ridge.color }));
      ridge.position.set(0, ridgeH / 2 - 5, -look.ridge.dist);
      group.add(water, ground, shoreLine, ridge);

      for (const spot of stage.spots) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(SPOT_RING.inner, SPOT_RING.outer, 40).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0.55 }),
        );
        ring.position.set(spot.stand.x, 0.08, spot.stand.z);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, POLE_H, 6), new THREE.MeshLambertMaterial({ color: RING_COLOR }));
        pole.position.set(spot.stand.x + 1.2, POLE_H / 2, spot.stand.z);
        const snag = new THREE.Mesh(
          new THREE.RingGeometry(spot.snag.fromM, spot.snag.fromM + SNAG_DEPTH, 32, 1, spot.facing + Math.PI / 2 - spot.arc, 2 * spot.arc).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: SNAG_COLORS[spot.bottom] || SNAG_COLORS.mud, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
        );
        snag.position.set(spot.stand.x, 0.04, spot.stand.z);
        group.add(ring, pole, snag);
        rings[spot.id] = ring;
      }
      for (const p of stage.points) {
        const geo = p.kind === 'camp' ? new THREE.ConeGeometry(0.9, 1.6, 6) : new THREE.CylinderGeometry(0.35, 0.35, 1.8, 10);
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: p.kind === 'camp' ? CAMP_COLOR : NPC_COLOR }));
        m.position.set(p.x, p.kind === 'camp' ? 0.8 : 0.9, p.z);
        group.add(m);
      }
    }
    const build = STAGE_PROPS[stage.id];
    const props = build({ stage, quality: this.rc.quality, heightAt: (x, z) => this.heightAt(x, z) });
    group.add(props.group);
    this.root.add(group);
    return { group, stage, rings, props };
  }

  /** @param {Object} state GameState @param {number} alpha @param {number} dt */
  update(state, alpha, dt) {
    this.time += dt;
    const cur = this.scenes[state.scene];
    for (const id of Object.keys(this.scenes)) this.scenes[id].group.visible = id === state.scene;
    if (!cur) return;
    const look = cur.stage.look;
    const c = state.clock;
    const L = c.light;
    const outdoor = cur.stage.kind === 'outdoor';

    if (outdoor) {
      this.bg.copy(NIGHT_SKY).lerp(new THREE.Color(look.sky.horizon), L);
      const fogMul = (WEATHER[state.weather.current] || WEATHER.clear).fog;
      if (!(this.rc.scene.fog instanceof THREE.FogExp2)) this.rc.scene.fog = new THREE.FogExp2(0xffffff, 0.004);
      this.rc.scene.fog.color.copy(this.bg);
      this.rc.scene.fog.density = look.fog.density * fogMul;
    } else {
      this.bg.copy(INDOOR_BG);
      this.rc.scene.fog = null;
    }
    const el = c.sunElev;
    const az = c.sunAzim;
    const sign = el >= 0 ? 1 : -1;   // 밤에는 반대편(달)
    this.sunDir.set(-Math.sin(az) * Math.cos(el) * sign, Math.abs(Math.sin(el)) + 0.05, -Math.cos(az) * Math.cos(el) * sign).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    this.sun.intensity = outdoor ? 0.15 + 1.6 * L : 0.6;
    this.hemi.intensity = outdoor ? 0.2 + 0.7 * L : 0.9;

    const p = state.player;
    for (const [id, ring] of Object.entries(cur.rings)) {
      ring.visible = !(p.mode === 'fish' && p.spotId === id);
      /** @type {THREE.MeshBasicMaterial} */ (ring.material).opacity = p.nearby && p.nearby.kind === 'spot' && p.nearby.id === id ? 1 : 0.55;
    }

    const r = state.rig;
    const wet = r.phase === 'waiting' || r.phase === 'retrieving' || r.phase === 'bite';
    this.bobber.visible = wet;
    if (wet) {
      const sink = r.signal.kind === 'take' ? -0.12 : r.signal.kind === 'nibble' ? -0.05 : 0;
      this.bobber.position.set(lerp(r.prevBobber.x, r.bobber.x, alpha), 0.05 + sink, lerp(r.prevBobber.z, r.bobber.z, alpha));
      const s = Math.max(1, r.dist / 7);
      this.bobber.scale.setScalar(s);
    }
    const f = state.fight;
    this.fish.visible = !!f;
    if (f) {
      const d = lerp(f.prevDist, f.dist, alpha);
      const b = lerpAngle(f.prevBearing, f.bearing, alpha);
      const off = fwd(b, d);
      const lenM = Math.max(0.2, f.roll.lengthCm / 100);
      // 자리 표시: 물이 불투명하니 수면에 그림자처럼 띄운다(점프면 그만큼 솟는다)
      this.fish.position.set(r.origin.x + off.x, 0.08 + f.airborne * (0.3 + 0.5 * lenM), r.origin.z + off.z);
      this.fish.rotation.y = b;
      this.fish.scale.set(Math.max(1, lenM * 1.5), 0.3, lenM);
    }

    cur.props.update({
      hour: c.hour, light: L, night: c.night, sunDir: this.sunDir, weather: state.weather.current,
      waveAmp: state.env.waveAmp, wavePeriod: state.env.wavePeriod, time: this.time, camPos: this.rc.camera.position,
    }, dt);
  }

  /** @param {number} x @param {number} z @returns {number} 지면 y(m) — 스텁은 0 */
  heightAt(x, z) {
    void x; void z;
    return 0;
  }

  dispose() {
    for (const s of Object.values(this.scenes)) s.props.dispose();
    this.root.traverse(o => {
      const m = /** @type {any} */ (o);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
    this.rc.scene.remove(this.root);
  }
}
