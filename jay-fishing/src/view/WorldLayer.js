// OWNER: P5 — 계약 §6.9 · §9.1 · §9.3
// 월드: 하늘(돔 · 해/달/별 · 구름) · 조명(방향광 1 + 반구광 + 헤드랜턴 스포트 + 공용 점광원) · 안개 · 지형(heightAt = 메시 함수) · 물
//   · 비 · 물안개 · 자리 표식 · 장애물 띠 · NPC · 캠프 · 집 실내 셸 · 스테이지 소품(STAGE_PROPS).
// 네 씬을 부팅 때 전부 만들고 state.scene 에 맞춰 visible 만 바꾼다(로딩 · 멈칫 없음). 빛의 개수 · 안개 종류는 씬과 무관하게 고정
//   — 씬을 바꿔도 셰이더가 다시 컴파일되지 않는다. 첫 update 에서 네 씬을 한꺼번에 미리 컴파일한다.
// 상태는 읽기만 한다(§9.1). 이벤트를 놓쳐도 update 가 state.scene · player.mode 를 보고 스스로 맞춘다.

import * as THREE from 'three';
import { clamp, clamp01, damp, smoothstep } from '../core/math.js';
import { EV } from '../core/events.js';
import { STAGES } from '../data/stages/index.js';
import { WEATHER } from '../data/weather.js';
import { QUALITY } from '../data/settings.js';
import { STAGE_PROPS } from './stages/index.js';
import { buildTerrainGeometry, buildDepthTexture, createTerrainField } from './world/terrain.js';
import { computeSky, createSky, makeSkyOut, sunMoonDirs } from './world/sky.js';
import { createWater, PlanarReflection } from './world/water.js';
import { createRain, createMist } from './world/atmos.js';
import { createRidge } from './world/ridge.js';
import { buildSpotMarker, createMarkerKit } from './world/markers.js';
import { buildNpc } from './world/npc.js';
import { buildCamp } from './world/camp.js';
import { buildRoomShell } from './world/room.js';
import { makeDetailTexture } from './world/textures.js';

// ── 연출 상수
const SUN_INTENSITY = 3.1;
const MOON_INTENSITY = 0.42;     // 해의 약 0.13 — §9.3 「달빛 0.12 수준」
const SUN_LOW = new THREE.Color('#ff8a48');
const SUN_HIGH = new THREE.Color('#fff3df');
const MOON_COLOR = new THREE.Color('#9db4e6');
const HEMI_MIN = 0.3;
const HEMI_DAY = 1.05;
const INDOOR_HEMI_SKY = new THREE.Color('#fff1dc');
const INDOOR_HEMI_GROUND = new THREE.Color('#6a5444');
const INDOOR_BG = new THREE.Color('#141110');
const HEADLAMP = { color: '#fff1d6', intensity: 34, distance: 25, angle: 0.5, penumbra: 0.4, decay: 1.4 };
const FIRE_LIGHT = { color: '#ff9a4a', intensity: 5.5, distance: 14, decay: 1.6 };
const ROOM_LAMP = { color: '#ffe2b8', intensity: 4.2, distance: 12, decay: 1.5 };
const WINDOW_SUN = { intensity: 26, sky: 6, angle: 0.42, distance: 16 };   // 집: 창으로 드는 햇살(스포트)
const HEADLAMP_COLOR = new THREE.Color(HEADLAMP.color);
const FIRE_COLOR = new THREE.Color(FIRE_LIGHT.color);
const ROOM_LAMP_COLOR = new THREE.Color(ROOM_LAMP.color);
const SHADOW_HALF = 34;           // m — 그림자 상자 반폭(카메라 둘레)
const RING_OPACITY = 0.5;
const RING_OPACITY_NEAR = 0.95;
const RING_COLOR = new THREE.Color('#ffffff');
const RING_COLOR_NEAR = new THREE.Color('#fff2b0');
const RAIN_ALPHA = 0.32;
const MIST_ALPHA = 0.14;
const WEATHER_FADE = 0.6;         // 1/s — 비 · 구름이 서서히 바뀐다(씬 전환 · 시각 점프 · 상태 교체에서는 바로 붙는다)
const HAZE_K = 0.09;
const NPC_BODY_R = 0.32;          // m — 판매상 몸이 판매 구조물 원 안에 들도록 중심 쪽으로 당기는 여유
const TERRAIN_FOG_CAP = 0.74;
const TERRAIN_FOG = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( fogFactor, ${TERRAIN_FOG_CAP.toFixed(2)} ) );
#endif`;

/** @typedef {import('../types.js').GameState} GameState */

export class WorldLayer {
  /** @param {{rc:import('./renderer.js').RenderContext, bus:import('../core/events.js').EventBus, settings:Object}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings;
    this.root = new THREE.Group();
    this.root.name = 'worldRoot';
    rc.scene.add(this.root);
    this.time = 0;
    /** @type {string|null} 지금 보이는 씬 */
    this.sceneId = null;
    /** PLAYER_PLACED · SCENE_CHANGED 를 받을 때마다 +1 — CameraRig 가 순간이동(보간 끊기)에 쓴다 */
    this.placeSerial = 0;
    this.quality = rc.quality in QUALITY ? rc.quality : 'medium';
    this._lastState = null;
    this._warm = false;
    this._snapFx = true;
    this._rain = 0;
    this._cloud = -1;
    this._lamp = 0;
    this._windowSun = 0;

    // 배경 · 안개(종류는 고정 — 실내에서는 밀도 0)
    this.bg = new THREE.Color();
    rc.scene.background = this.bg;
    this.fog = new THREE.FogExp2(0xb8c8d0, 0);
    rc.scene.fog = this.fog;

    // 공유 자원
    this.detailTex = makeDetailTexture();
    this.markerKit = createMarkerKit();
    this.skyOut = makeSkyOut();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this._v2 = new THREE.Vector2();
    this._camPos = new THREE.Vector3();
    this._camFwd = new THREE.Vector3();
    this._ambient = new THREE.Color();
    this._lightCol = new THREE.Color();
    this._ridgeIn = { horizon: this.skyOut.horizon, hazeAmt: 0.5, lightDir: this.lightDir, lightColor: this._lightCol, lightAmt: 1, ambient: this._ambient };
    /** @type {import('./stages/lakeProps.js').PropsEnv} */
    this.env = { hour: 12, light: 1, night: false, sunDir: this.sunDir, weather: 'clear', waveAmp: 0, wavePeriod: 3, time: 0, camPos: this._camPos };

    this.sky = createSky();
    this.root.add(this.sky.group);
    this.rain = createRain();
    this.mist = createMist();
    this.root.add(this.rain.object, this.mist.object);

    // 빛(개수 고정)
    this.hemi = new THREE.HemisphereLight('#dfefff', '#404830', 0.8);
    this.sun = new THREE.DirectionalLight('#ffffff', 2);
    this.sun.shadow.camera.left = -SHADOW_HALF;
    this.sun.shadow.camera.right = SHADOW_HALF;
    this.sun.shadow.camera.top = SHADOW_HALF;
    this.sun.shadow.camera.bottom = -SHADOW_HALF;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 520;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.headlamp = new THREE.SpotLight(HEADLAMP.color, 0, HEADLAMP.distance, HEADLAMP.angle, HEADLAMP.penumbra, HEADLAMP.decay);
    this.headlamp.castShadow = false;
    this.point = new THREE.PointLight(FIRE_LIGHT.color, 0, FIRE_LIGHT.distance, FIRE_LIGHT.decay);
    this.point.castShadow = false;
    this.root.add(this.hemi, this.sun, this.sun.target, this.headlamp, this.headlamp.target, this.point);

    this.reflection = new PlanarReflection();

    /** @type {Record<string, ReturnType<WorldLayer['_buildScene']>>} */
    this.scenes = {};
    /** @type {Record<string, ReturnType<typeof createTerrainField>>} */
    this.fields = {};
    for (const stage of STAGES) {
      this.fields[stage.id] = createTerrainField(stage);
      this.scenes[stage.id] = this._buildScene(stage);
    }
    this._applyQuality(this.quality, true);

    /** @type {Array<() => void>} */
    this._offs = [];
    if (bus && typeof bus.on === 'function') {
      this._offs.push(bus.on(EV.SCENE_CHANGED, (p) => {
        this.placeSerial++;
        this._snapFx = true;
        if (p && this.scenes[p.to]) this._show(p.to);
      }));
      this._offs.push(bus.on(EV.PLAYER_PLACED, () => { this.placeSerial++; }));
      this._offs.push(bus.on(EV.CLOCK_SKIP, () => { this._snapFx = true; }));
      this._offs.push(bus.on(EV.SETTINGS_CHANGED, (p) => {
        if (p && p.settings) this.settings = p.settings;
        const q = this.settings && this.settings.quality;
        if (q in QUALITY && rc.quality !== q) rc.setQuality(q);
      }));
    }
  }

  // ── 만들기

  _buildScene(stage) {
    const group = new THREE.Group();
    group.name = `scene:${stage.id}`;
    group.visible = false;
    const field = this.fields[stage.id];
    const heightAt = field.heightAt;
    const out = { stage, group, field, rings: [], water: null, ridge: null, npcs: [], camp: null, room: null, terrain: null, props: null, disposers: [] };
    if (stage.kind === 'interior') {
      const room = buildRoomShell(stage.look);
      group.add(room.group);
      out.room = room;
      out.disposers.push(() => room.dispose());
    } else {
      // 지형
      const tGeo = buildTerrainGeometry(field, QUALITY[this.quality].terrainSeg);
      const tMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.detailTex, roughness: 0.96, metalness: 0 });
      // 먼 언덕 · 건너편 절벽이 안개에 완전히 묻혀 종이처럼 납작해지지 않게 안개를 상한까지만
      tMat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', TERRAIN_FOG);
      };
      tMat.customProgramCacheKey = () => 'terrainFogCap';
      const terrain = new THREE.Mesh(tGeo, tMat);
      terrain.name = `terrain:${stage.id}`;
      terrain.receiveShadow = true;
      group.add(terrain);
      out.terrain = terrain;
      out.disposers.push(() => { tGeo.dispose(); tMat.dispose(); });
      // 물
      const depthTex = buildDepthTexture(field);
      const water = createWater({ stage, depthTex, reflTex: this.reflection.rt.texture });
      water.mesh.onBeforeRender = (renderer, scene, camera) => {
        if (this.reflection.enabled) {
          this.reflection.render(renderer, scene, camera, water.mesh);
          water.uniforms.uTexMatrix.value.copy(this.reflection.texMatrix);
        }
      };
      group.add(water.mesh);
      out.water = water;
      out.disposers.push(() => { water.geo.dispose(); water.mat.dispose(); depthTex.texture.dispose(); });
      // 먼 능선
      const ridge = createRidge(stage);
      group.add(ridge.group);
      out.ridge = ridge;
      out.disposers.push(() => ridge.dispose());
      // 자리 표식 · 장애물 띠
      stage.spots.forEach((spot, i) => {
        const mk = buildSpotMarker(spot, heightAt, this.markerKit, (field.seed * 131 + i * 17) | 0);
        group.add(mk.group);
        out.rings.push({ id: spot.id, ring: mk.ring, mat: mk.ringMat, near: 0 });
        out.disposers.push(() => mk.dispose());
      });
      // NPC · 캠프(일반형)
      for (const pt of stage.points) {
        const circle = nearestObstacle(stage, pt.x, pt.z);
        if (pt.kind === 'npc') {
          let nx = pt.x;
          let nz = pt.z;
          if (circle) {
            const dx = pt.x - circle.x;
            const dz = pt.z - circle.z;
            const d = Math.hypot(dx, dz);
            const maxD = Math.max(0, circle.r - NPC_BODY_R);
            if (d > maxD && d > 1e-6) { nx = circle.x + dx / d * maxD; nz = circle.z + dz / d * maxD; }
          }
          const npc = buildNpc({ x: nx, z: nz, yaw: pt.yaw, radius: pt.radius }, stage.look.vendor, heightAt(nx, nz));
          group.add(npc.group);
          out.npcs.push(npc);
          out.disposers.push(() => npc.dispose());
        } else if (pt.kind === 'camp') {
          const camp = buildCamp(circle || { x: pt.x, z: pt.z, r: 1.4 }, pt.yaw, heightAt);
          group.add(camp.group);
          out.camp = camp;
          out.disposers.push(() => camp.dispose());
        }
      }
    }
    const build = STAGE_PROPS[stage.id];
    if (build) {
      const props = build({ stage, quality: this.quality, heightAt });
      group.add(props.group);
      out.props = props;
      out.disposers.push(() => props.dispose());
    }
    this.root.add(group);
    return out;
  }

  _show(id) {
    if (this.sceneId === id) return;
    for (const k of Object.keys(this.scenes)) this.scenes[k].group.visible = k === id;
    this.sceneId = id;
    this._snapFx = true;
  }

  _applyQuality(q, initial = false) {
    const Q = QUALITY[q] || QUALITY.medium;
    this.quality = q in QUALITY ? q : 'medium';
    const shadowChanged = this.sun.castShadow !== Q.shadows;
    this.sun.castShadow = Q.shadows;
    if (Q.shadows && this.sun.shadow.mapSize.x !== Q.shadowMap) {
      this.sun.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.rain.setCount(Q.rainDrops);
    this.mist.setCount(Q.fogParticles);
    this.reflection.enabled = Q.waterReflect === 'planar' && !!(this.rc.renderer);
    const mode = Q.waterReflect === 'planar' ? (this.reflection.enabled ? 2 : 1) : Q.waterReflect === 'sky' ? 1 : 0;
    for (const id of Object.keys(this.scenes)) {
      const s = this.scenes[id];
      if (s.water) {
        s.water.uniforms.uReflectMode.value = mode;
        s.water.uniforms.uDisplace.value = q === 'high' ? 1 : 0;
        s.water.uniforms.uRipples.value = q === 'low' ? 0 : 1;
      }
      if (s.props && !initial) s.props.setQuality(this.quality);
    }
    if (shadowChanged && !initial) {
      this.root.traverse((o) => {
        const m = /** @type {any} */ (o).material;
        if (m) m.needsUpdate = true;
      });
    }
  }

  /** 첫 update 에서 네 씬을 한꺼번에 컴파일하고 텍스처를 올린다(전환 때 멈칫이 없게) */
  _prewarmAll() {
    const r = this.rc.renderer;
    if (!r || typeof r.compile !== 'function') return;
    const vis = {};
    for (const k of Object.keys(this.scenes)) { vis[k] = this.scenes[k].group.visible; this.scenes[k].group.visible = true; }
    const rainVis = this.rain.object.visible;
    const mistVis = this.mist.object.visible;
    this.rain.object.visible = true;
    this.mist.object.visible = true;
    r.compile(this.rc.scene, this.rc.camera);
    if (typeof r.initTexture === 'function') {
      this.root.traverse((o) => {
        const m = /** @type {any} */ (o).material;
        if (!m) return;
        for (const key of ['map', 'emissiveMap']) if (m[key]) r.initTexture(m[key]);
        if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture && !u.value.isRenderTargetTexture) r.initTexture(u.value);
      });
    }
    for (const k of Object.keys(this.scenes)) this.scenes[k].group.visible = vis[k];
    this.rain.object.visible = rainVis;
    this.mist.object.visible = mistVis;
  }

  // ── 매 프레임

  /** @param {GameState} state @param {number} alpha @param {number} dt */
  update(state, alpha, dt) {
    void alpha;
    const step = Math.max(0, Math.min(dt || 0, 0.25));
    this.time += step;
    if (state !== this._lastState) { this._lastState = state; this._snapFx = true; }
    if (state.scene !== this.sceneId && this.scenes[state.scene]) this._show(state.scene);
    if (this.rc.quality !== this.quality && this.rc.quality in QUALITY) this._applyQuality(this.rc.quality);
    if (!this._warm) { this._warm = true; this._prewarmAll(); }
    const cur = this.scenes[state.scene];
    if (!cur) return;
    const stage = cur.stage;
    const outdoor = stage.kind === 'outdoor';
    const c = state.clock;
    const wId = state.weather && state.weather.current in WEATHER ? state.weather.current : 'clear';
    const W = WEATHER[wId];
    const env = state.env || {};
    const cam = this.rc.camera;
    cam.updateMatrixWorld();
    this._camPos.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(this._camFwd);

    // 하늘(집은 호수 하늘 — 창밖)
    const skyLook = outdoor ? stage.look.sky : (this.scenes.lake ? this.scenes.lake.stage.look.sky : { zenith: '#5e8fd0', horizon: '#c9dbe8' });
    const sky = computeSky(skyLook, c, wId, this.skyOut);
    const snap = this._snapFx;
    this._snapFx = false;
    const k = snap ? 1 : 1 - Math.exp(-WEATHER_FADE * step);
    const rainTarget = outdoor ? clamp01(env.rain ?? W.rain) : 0;
    this._rain += (rainTarget - this._rain) * k;
    this._cloud = this._cloud < 0 || snap ? sky.cloud : this._cloud + (sky.cloud - this._cloud) * k;
    sky.cloud = this._cloud;
    sunMoonDirs(c, this.sunDir, this.moonDir);
    this.sky.update(sky, this.sunDir, this.moonDir, this._camPos, this.time);
    this.sky.group.visible = outdoor;

    // 방향광: 해가 떠 있으면 해, 아니면 달
    const sunUp = c.sunElev > -0.03;
    if (sunUp) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.06) { this.lightDir.y = 0.06; this.lightDir.normalize(); }
      this._lightCol.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.02, 0.5, c.sunElev));
      this.sun.intensity = SUN_INTENSITY * smoothstep(-0.03, 0.22, c.sunElev) * sky.sunDirect;
    } else {
      this.lightDir.copy(this.moonDir);
      if (this.lightDir.y < 0.1) { this.lightDir.y = 0.1; this.lightDir.normalize(); }
      this._lightCol.copy(MOON_COLOR);
      this.sun.intensity = MOON_INTENSITY * smoothstep(0.0, 0.25, -c.sunElev) * (0.35 + 0.65 * sky.sunDirect);
    }
    this.sun.color.copy(this._lightCol);
    // 그림자 상자: 카메라를 따라(텍셀 단위로 맞춰 흔들림을 줄인다)
    const texel = (SHADOW_HALF * 2) / Math.max(256, this.sun.shadow.mapSize.x);
    const tx = Math.round(this._camPos.x / texel) * texel;
    const tz = Math.round(this._camPos.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.lightDir.x * 240, this.lightDir.y * 240, tz + this.lightDir.z * 240);
    this.sun.target.updateMatrixWorld();

    // 반구광 · 배경 · 안개
    if (outdoor) {
      this.hemi.color.copy(sky.zenith).lerp(sky.horizon, 0.35);
      this.hemi.groundColor.set(stage.look.terrain.ground).multiplyScalar(0.25 + 0.6 * sky.day);
      this.hemi.intensity = HEMI_MIN + HEMI_DAY * sky.day * (0.75 + 0.25 * W.light);
      this.bg.copy(sky.horizon);
      this.fog.color.copy(sky.horizon);
      this.fog.density = stage.look.fog.density * W.fog;
    } else {
      this.hemi.color.copy(INDOOR_HEMI_SKY);
      this.hemi.groundColor.copy(INDOOR_HEMI_GROUND);
      this.hemi.intensity = 0.55 + 0.35 * sky.day;
      this.bg.copy(INDOOR_BG);
      this.fog.density = 0;
      // 집: 방향광은 끄고(실내 그림자 줄무늬 방지) 창으로 드는 햇살은 아래 스포트(헤드랜턴 겸용)가 맡는다
      this._windowSun = this.sun.intensity / SUN_INTENSITY;
      this.sun.intensity = 0;
    }
    this._ambient.copy(this.hemi.color).multiplyScalar(this.hemi.intensity * 0.55);

    // 헤드랜턴(야외 밤) — 카메라에 붙는다. 집에서는 같은 스포트가 창으로 드는 햇살(빛 개수 고정 — 재컴파일 없음)
    const lampTarget = outdoor && env.headlamp ? 1 : 0;
    this._lamp = snap ? lampTarget : damp(this._lamp, lampTarget, 4, step);
    if (outdoor || !cur.room) {
      this.headlamp.color.copy(HEADLAMP_COLOR);
      this.headlamp.angle = HEADLAMP.angle;
      this.headlamp.distance = HEADLAMP.distance;
      this.headlamp.intensity = HEADLAMP.intensity * this._lamp;
      this.headlamp.position.copy(this._camPos);
      this.headlamp.position.y -= 0.05;
      this.headlamp.target.position.copy(this._camPos).addScaledVector(this._camFwd, 10);
    } else {
      const ws = cur.room.windowSun;
      this.headlamp.color.copy(this._lightCol);
      this.headlamp.angle = WINDOW_SUN.angle;
      this.headlamp.distance = WINDOW_SUN.distance;
      this.headlamp.intensity = WINDOW_SUN.intensity * (this._windowSun || 0) + WINDOW_SUN.sky * sky.day;
      this.headlamp.position.copy(ws.from);
      this.headlamp.target.position.copy(ws.to);
    }
    this.headlamp.target.updateMatrixWorld();

    // 공용 점광원: 야외 = 모닥불(어두울수록) · 집 = 천장등
    const nightK = 1 - smoothstep(0.12, 0.5, c.light);
    if (outdoor) {
      if (cur.camp) {
        this.point.position.copy(cur.camp.fireWorld());
        const flick = 0.85 + 0.1 * Math.sin(this.time * 11.3) + 0.05 * Math.sin(this.time * 23.7);
        this.point.color.copy(FIRE_COLOR);
        this.point.distance = FIRE_LIGHT.distance;
        this.point.decay = FIRE_LIGHT.decay;
        this.point.intensity = FIRE_LIGHT.intensity * (0.25 + 0.75 * nightK) * flick * (sky.day > 0.9 ? 0.3 : 1);
        cur.camp.update(this.time, nightK);
      } else this.point.intensity = 0;
    } else if (cur.room) {
      this.point.position.copy(cur.room.lampPos);
      this.point.color.copy(ROOM_LAMP_COLOR);
      this.point.distance = ROOM_LAMP.distance;
      this.point.decay = ROOM_LAMP.decay;
      this.point.intensity = ROOM_LAMP.intensity * (0.55 + 0.45 * nightK);
      cur.room.lampMat.emissiveIntensity = 0.6 + 0.9 * nightK;
      cur.room.update(sky.zenith, sky.horizon, c.light, sky.starVis);
    }

    // 물
    if (cur.water) {
      const u = cur.water.uniforms;
      u.uTime.value = this.time;
      u.uWaveAmp.value = Math.max(0.01, env.waveAmp ?? stage.waves.amp);
      const T = Math.max(0.5, env.wavePeriod ?? stage.waves.period);
      u.uWaveLen.value = clamp(1.56 * T * T, 3, 60);
      u.uZenith.value.copy(sky.zenith);
      u.uHorizon.value.copy(sky.horizon);
      u.uGlow.value = sky.glow;
      u.uLightDir.value.copy(this.lightDir);
      u.uLightColor.value.copy(this._lightCol);
      u.uLightAmt.value = this.sun.intensity / SUN_INTENSITY;
      u.uAmbient.value.copy(this._ambient);
      u.uRain.value = this._rain;
      u.uNight.value = sunUp ? 0 : 1;
      u.uLampPos.value.copy(this._camPos);
      u.uLampDir.value.copy(this._camFwd);
      u.uLamp.value = this._lamp;
    }
    if (cur.ridge) {
      const ridge = stage.look.ridge;
      const dens = stage.look.fog.density * W.fog;
      this._ridgeIn.hazeAmt = clamp(1 - Math.exp(-ridge.dist * dens * HAZE_K), 0.2, 0.97);
      this._ridgeIn.lightAmt = this.sun.intensity / SUN_INTENSITY;
      cur.ridge.update(this._ridgeIn);
    }

    // 비 · 물안개
    const rainOn = outdoor && this._rain > 0.01;
    this.rain.object.visible = rainOn;
    if (rainOn) {
      const ru = this.rain.uniforms;
      ru.uCam.value.copy(this._camPos);
      ru.uTime.value = this.time;
      ru.uAlpha.value = RAIN_ALPHA * this._rain * (0.5 + 0.5 * sky.day) + 0.08 * this._rain * this._lamp;
      ru.uColor.value.copy(sky.horizon).lerp(this._lightCol, 0.2).multiplyScalar(1.2);
    }
    const hour = c.hour;
    const dawn = smoothstep(3.6, 5.2, hour) * (1 - smoothstep(6.8, 8.6, hour));
    const mistAmt = outdoor ? clamp01(dawn * 0.9 + this._rain * 0.45 + (sky.cloud - 0.22) * 0.25 + nightK * 0.15) : 0;
    this.mist.object.visible = mistAmt > 0.02 && QUALITY[this.quality].fogParticles > 0;
    if (this.mist.object.visible) {
      const mu = this.mist.uniforms;
      mu.uCam.value.copy(this._camPos);
      mu.uTime.value = this.time;
      mu.uAlpha.value = MIST_ALPHA * mistAmt;
      mu.uColor.value.copy(sky.horizon).lerp(this._lightCol, 0.15);
      const r = this.rc.renderer;
      const h = r && typeof r.getDrawingBufferSize === 'function' ? r.getDrawingBufferSize(this._v2).y : 720;
      mu.uScale.value = h * 0.5 * cam.projectionMatrix.elements[5];
    }

    // 자리 표식
    const p = state.player;
    for (let i = 0; i < cur.rings.length; i++) {
      const rg = cur.rings[i];
      rg.ring.visible = !(p.mode === 'fish' && p.spotId === rg.id);
      const isNear = !!(p.nearby && p.nearby.kind === 'spot' && p.nearby.id === rg.id);
      rg.near = snap ? (isNear ? 1 : 0) : damp(rg.near, isNear ? 1 : 0, 10, step);
      rg.mat.opacity = RING_OPACITY + (RING_OPACITY_NEAR - RING_OPACITY) * rg.near;
      rg.mat.color.copy(RING_COLOR).lerp(RING_COLOR_NEAR, rg.near);
    }
    for (let i = 0; i < cur.npcs.length; i++) cur.npcs[i].update(this.time, step, this._camPos);

    // 소품
    if (cur.props) {
      const e = this.env;
      e.hour = c.hour;
      e.light = c.light;
      e.night = !!c.night;
      e.weather = wId;
      e.waveAmp = env.waveAmp ?? 0;
      e.wavePeriod = env.wavePeriod ?? stage.waves.period;
      e.time = this.time;
      cur.props.update(e, step);
    }
  }

  /** @param {number} x @param {number} z @returns {number} 지면 y(m) — 지금 씬의 지형 메시를 만든 같은 함수. 물 위면 수면 아래 바닥(음수). 집은 0 */
  heightAt(x, z) {
    const f = this.sceneId ? this.fields[this.sceneId] : null;
    return f ? f.heightAt(x, z) : 0;
  }

  /** 씬을 지정한 heightAt(같은 함수) — CameraRig 가 이벤트 없이 씬이 바뀐 첫 프레임에도 맞는 땅을 쓰게 */
  heightAtScene(sceneId, x, z) {
    const f = this.fields[sceneId];
    return f ? f.heightAt(x, z) : 0;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const id of Object.keys(this.scenes)) for (const d of this.scenes[id].disposers) d();
    this.sky.dispose();
    this.rain.dispose();
    this.mist.dispose();
    this.markerKit.dispose();
    this.detailTex.dispose();
    this.reflection.dispose();
    if (this.sun.shadow.map) this.sun.shadow.map.dispose();
    this.headlamp.dispose();
    this.point.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.rc.scene.remove(this.root);
    if (this.rc.scene.fog === this.fog) this.rc.scene.fog = null;
    if (this.rc.scene.background === this.bg) this.rc.scene.background = null;
  }
}

function nearestObstacle(stage, x, z) {
  let best = null;
  let bd = Infinity;
  for (const o of stage.obstacles) {
    const d = Math.hypot(o.x - x, o.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best && bd < best.r + 2.5 ? best : null;
}
