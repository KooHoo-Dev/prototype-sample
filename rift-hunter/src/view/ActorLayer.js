// OWNER: P8 — 계약 §6.14 · §9.1 · §9.5 · §9.6
// 플레이어 리그(전사 · 마법사 · 장비 외형) · 몬스터(템플릿 5 · 변형 10 + 수호자 2 — 부위마다 InstancedMesh) · NPC 4 · 바닥 아이템 · 빛기둥 · 시체 · 가림 외곽선.
// 매 프레임 상태를 읽어 그린다(§9.1) — 이벤트는 순간에만(MON_SPAWNED 솟아오름 · PLAYER_SPAWNED 보간 끊기). sim 상태를 고치지 않는다.
// 위치 = lerp(prevPos, pos, alpha) · 시각 진행 = state.tick + alpha(틱) · 실제 시간(dtReal)은 숨쉬기 · 맥동 · 흔들림 같은 장식에만.
// 내부 파일: view/actors/ — rig(FK · IK) · poses(포즈 순수 함수) · variants(변형 표) · parts(부위 지오메트리) · monsters(인스턴싱) · player(리그) · gear(장비 외형) · drops · materials

import * as THREE from 'three';
import { EV } from '../core/events.js';
import { QUALITY } from '../data/quality.js';
import { DropInstancer } from './actors/drops.js';
import { disposeMaterials, makeCharMaterials, makeInstanceMaterials } from './actors/materials.js';
import { MonsterInstancer } from './actors/monsters.js';
import { CHAR_DIMS } from './actors/gear.js';
import { CharRig, NPC_LOOKS, PlayerPoser, leftHandToGrip, npcIdle, npcLook, playerLook, styleOf } from './actors/player.js';
import { bipedBase } from './actors/poses.js';
import { BP, fkBiped, makeJoints } from './actors/rig.js';

/** 플레이어 가림 외곽선 색(흰 하늘색 · §9.5) */
const PLAYER_SIL = 0x2f6a88;
const EQUIP_KEYS = ['mainHand', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt'];
const TELEPORT_SNAP = 2.5;
/** 양손 무기의 왼손 자리(무기 틀 y — 오른손 아래) */
const GRIP_LEFT = -0.2;

export class ActorLayer {
  /** @param {{rc:import('../types.js').RenderContext, bus:any, settings:any}} deps */
  constructor({ rc, bus, settings }) {
    this.rc = rc;
    this.bus = bus;
    this.settings = settings ?? {};
    this.group = new THREE.Group();
    this.group.name = 'actors';
    rc.layers.actors.add(this.group);
    this.instMats = makeInstanceMaterials();
    this.playerMats = makeCharMaterials({ transparent: true, sil: PLAYER_SIL });
    this.npcMats = makeCharMaterials({ transparent: false });
    this.monsters = new MonsterInstancer(this.group, this.instMats);
    this.drops = new DropInstancer(this.group, this.instMats);
    this.playerGroup = new THREE.Group();
    this.playerGroup.name = 'player';
    this.group.add(this.playerGroup);
    this.player = new CharRig(this.playerGroup, this.playerMats);
    this.poser = new PlayerPoser();
    this.pose = new Float32Array(BP.N);
    /** 지금 리그를 지은 장비(아이템 ID) · 클래스 */
    this._lookKey = new Array(EQUIP_KEYS.length + 1).fill(undefined);
    this._lookDirty = true;
    this._style = 'fist';
    this._cls = 'warrior';
    this._opacity = 1;
    /** @type {{rig:CharRig, x:number, z:number, facing:number, base:Float32Array, idle:string, dims:any, id:string, J:THREE.Matrix4[]}[]} */
    this.npcs = [];
    this.npcGroup = new THREE.Group();
    this.npcGroup.name = 'npcs';
    this.group.add(this.npcGroup);
    this.time = 0;
    this.map = null;
    /** @type {number[]} 다음 update 에서 솟아오름을 시작할 몬스터 */
    this._spawned = [];
    this._offs = [
      bus.on(EV.MON_SPAWNED, (e) => { this._spawned.push(e.id); }),
      bus.on(EV.PLAYER_SPAWNED, () => { this.poser.reset(); }),
      bus.on(EV.CHAR_LOADED, () => { this._lookDirty = true; this.poser.reset(); }),
      bus.on(EV.EQUIPPED, () => { this._lookDirty = true; }),
      bus.on(EV.RIFT_CLOSED, () => { this.monsters.reset(); this.drops.reset(); }),
      bus.on(EV.SETTINGS_CHANGED, (e) => { if (e && e.settings) this.settings = e.settings; }),
    ];
  }

  /** 마을 NPC · 맵이 바뀌면 몬스터 기록을 비운다 @param {import('../types.js').MapData|null} map */
  setMap(map) {
    this.map = map;
    this.monsters.reset();
    this.drops.reset();
    this.poser.reset();
    for (const n of this.npcs) n.rig.dispose();
    this.npcs = [];
    if (!map || map.kind !== 'town' || !Array.isArray(map.objects)) return;
    for (const o of map.objects) {
      if (o.kind !== 'npc') continue;
      const lk = Object.prototype.hasOwnProperty.call(NPC_LOOKS, o.look) ? NPC_LOOKS[o.look] : NPC_LOOKS.npcGrocer;
      const dims = CHAR_DIMS[lk.dims] ?? CHAR_DIMS.warrior;
      const rig = new CharRig(this.npcGroup, this.npcMats);
      rig.build(npcLook(o.look), dims);
      this.npcs.push({ rig, x: o.x, z: o.z, facing: o.facing, base: bipedBase(dims, null), idle: lk.idle, dims, id: o.id, J: makeJoints(18) });
    }
  }

  /**
   * @param {import('../types.js').GameState} state @param {number} alpha 0..1 @param {number} dtReal 초 @param {{x:number, z:number}|null} cameraTarget
   */
  update(state, alpha, dtReal, cameraTarget) {
    if (!state) return;
    this.time += Number.isFinite(dtReal) && dtReal > 0 ? Math.min(dtReal, 0.25) : 0;
    const t = this.time;
    const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const now = state.tick + a;
    const p = state.player;
    // ── 플레이어 ──
    this._syncLook(state.char);
    const jump = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z) > TELEPORT_SNAP;
    const px = jump ? p.pos.x : p.prevPos.x + (p.pos.x - p.prevPos.x) * a;
    const pz = jump ? p.pos.z : p.prevPos.z + (p.pos.z - p.prevPos.z) * a;
    const op = this.poser.pose(this.pose, p, this._cls, this._style, now, t, px, pz);
    const d = CHAR_DIMS[this._cls];
    fkBiped(d, this.pose, px, pz, p.facing, this.player.J, 1);
    if (this._style === 'twoHand' && !p.dead) leftHandToGrip(this.player.J, d, GRIP_LEFT);
    this.player.apply();
    this._setOpacity(op);
    const ct = cameraTarget ?? { x: px, z: pz };
    // ── NPC(마을) ──
    const town = state.scene === 'town';
    this.npcGroup.visible = town;
    if (town) {
      for (const n of this.npcs) {
        npcIdle(this.pose, n.base, n.idle, t + n.x * 0.37);
        fkBiped(n.dims, this.pose, n.x, n.z, n.facing, n.J, 1);
        n.rig.apply(n.J);
      }
    }
    // ── 몬스터 · 드랍(균열) ──
    const rift = state.scene === 'rift' ? state.rift : null;
    if (this._spawned.length) {
      for (const id of this._spawned) this.monsters.noteSpawn(id, state.tick);
      this._spawned.length = 0;
    }
    const hv = p.hover;
    const hoverMon = hv && hv.kind === 'monster' ? hv.id : null;
    const hoverDrop = hv && hv.kind === 'drop' ? hv.id : null;
    const q = QUALITY[this.settings?.quality] ?? QUALITY.medium;
    this.monsters.update(rift, state.tick, a, t, ct, hoverMon, q.outlines !== false);
    this.drops.update(rift ? rift.drops : null, now, t, ct, hoverDrop);
  }

  /** 장착이 바뀌었으면 리그를 다시 짓는다(아이템 ID 비교 — 할당 없이) */
  _syncLook(char) {
    const keys = this._lookKey;
    let changed = this._lookDirty;
    const cls = char?.cls ?? 'warrior';
    if (keys[0] !== cls) changed = true;
    for (let i = 0; i < EQUIP_KEYS.length && !changed; i++) {
      const it = char?.equip?.[EQUIP_KEYS[i]] ?? null;
      if (keys[i + 1] !== (it ? it.id : null)) changed = true;
    }
    if (!changed) return;
    keys[0] = cls;
    for (let i = 0; i < EQUIP_KEYS.length; i++) {
      const it = char?.equip?.[EQUIP_KEYS[i]] ?? null;
      keys[i + 1] = it ? it.id : null;
    }
    this._lookDirty = false;
    const look = playerLook(char ?? null);
    this._cls = look.cls;
    this._style = styleOf(look);
    this.player.build(look, CHAR_DIMS[look.cls]);
    this._opacity = -1;
  }

  /** 순간이동 전후 투명(§9.5 — 섬광 없음) */
  _setOpacity(op) {
    if (op === this._opacity) return;
    this._opacity = op;
    const m = this.playerMats;
    m.std.opacity = op; m.metal.opacity = op; m.glow.opacity = op;
    const show = op > 0.01;
    for (const e of this.player.meshes) {
      e.mesh.visible = show;
      if (e.twin) e.twin.visible = op >= 0.999;
    }
  }

  /** 진단(테스트 · __game) — 인스턴스 메시 수 · 그린 수 */
  info() {
    return {
      instancedMeshes: this.monsters.meshCount() + this.drops.meshCount(),
      monstersDrawn: this.monsters.drawn,
      dropsDrawn: this.drops.drawn,
      pillars: this.drops.pillars ?? 0,
      playerMeshes: this.player.meshes.length,
      npcs: this.npcs.length,
    };
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const n of this.npcs) n.rig.dispose();
    this.npcs = [];
    this.player.dispose();
    this.monsters.dispose();
    this.drops.dispose();
    disposeMaterials(this.instMats);
    disposeMaterials(this.playerMats);
    disposeMaterials(this.npcMats);
    this.group.remove(this.playerGroup, this.npcGroup);
    this.rc.layers.actors.remove(this.group);
  }
}
