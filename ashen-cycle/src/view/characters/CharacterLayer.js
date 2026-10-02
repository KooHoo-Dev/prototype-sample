// OWNER: P5 — 계약 §9.6
// 캐릭터 레이어: 플레이어 뷰(항상) · 보스 뷰(state.boss가 있을 때) · 허수아비 · NPC 2명(마을에서만).
// sim 상태는 읽기만 한다. 뷰 쪽 기억(점멸 타이머 · 보스 뷰 캐시)은 이 객체에 둔다.
//
// 셰이더 프로그램의 수명: three는 그 프로그램을 쓰는 마지막 재질이 dispose되면 프로그램을 버린다. 보스 뷰를 판마다
// 새로 만들고 버리면 매 판 다시 컴파일한다(격파 소멸의 투명 변형 76~147ms · 니힐의 등장 110~140ms — 화면이 멎는다).
// 그래서 (1) 보스마다 **물러난 뷰 하나를 씬 밖에 쥐고 있고**(_kept — 재질이 살아 있어 프로그램이 캐시에 남는다)
// (2) 그 뷰가 쥐게 될 프로그램을 빠짐없이 만들려고, 쥔 것이 없는 보스의 새 뷰는 **첫 프레임에 불투명 재질을
// transparent로 한 번 그린다**(_warm — 전환 막에 가려진 프레임에서 소멸용 변형까지 컴파일된다).
import * as THREE from 'three';
import { EV } from '../../core/events.js';
import { lerp, lerpAngle, angleOf, angleDiff } from '../../core/math2d.js';
import { createBossView } from '../bosses/index.js';
import { createPlayerView } from './playerView.js';
import { createDummyView, createNpcView, LOOK_RANGE } from './npcView.js';

/** @typedef {import('../../types.js').GameState} GameState */
/** @typedef {import('../../types.js').BossView} BossView */
/** @typedef {import('../../types.js').Settings} Settings */

/** 피격 점멸 길이(초) */
const FLASH_DUR = 0.12;
const NPC_IDS = ['blacksmith', 'merchant'];
/** 보스 뷰의 onEvent로 넘기는 이벤트 */
const BOSS_EVENTS = [
  EV.HIT, EV.BOSS_ATTACK_WINDUP, EV.BOSS_ATTACK_ACTIVE, EV.BOSS_ATTACK_END, EV.BOSS_CUE, EV.BOSS_STEP,
  EV.BOSS_PHASE_CHANGED, EV.BOSS_GROGGY, EV.BOSS_TELEPORT, EV.BOSS_DEFEATED,
];

export class CharacterLayer {
  /**
   * @param {{scene:THREE.Scene, bus:import('../../core/events.js').EventBus, settings:Settings}} deps
   */
  constructor({ scene, bus, settings }) {
    this.scene = scene;
    this.bus = bus;
    this.settings = settings;
    /** charRoot — 남의 그룹에 자식을 넣지 않는다(§9.1) */
    this.root = new THREE.Group();
    this.root.name = 'charRoot';
    scene.add(this.root);

    // 전부 숨긴 채 시작한다 — 첫 update가 state를 보고 켠다(§9.1 이벤트 누락에 안전)
    this._player = createPlayerView();
    this._player.root.visible = false;
    this.root.add(this._player.root);

    this._dummy = createDummyView();
    this._dummy.root.visible = false;
    this.root.add(this._dummy.root);

    /** @type {Record<string, import('./npcView.js').NpcView>} */
    this._npcs = {};
    for (const id of NPC_IDS) {
      const v = createNpcView(id);
      v.root.visible = false;
      this.root.add(v.root);
      this._npcs[id] = v;
    }

    /** @type {BossView|null} */
    this._bossView = null;
    /** @type {string|null} */
    this._bossId = null;
    /** @type {Record<string, BossView>} 보스마다 하나 — 물러난 뷰(씬 밖). 셰이더 프로그램을 붙잡아 둔다 */
    this._kept = {};
    /** 지금 보스 뷰의 선컴파일 단계: 0 = 아직 · 1 = 투명 변형을 그리는 프레임 · 2 = 끝(또는 필요 없음) */
    this._warm = 2;
    /** @type {THREE.Material[]} 선컴파일하려고 한 프레임 transparent로 뒤집어 둔 재질 */
    this._warmMats = [];
    /** 점멸 남은 시간(초) */
    this._flash = { player: 0, boss: 0, dummy: 0 };
    this._time = 0;
    this._updated = false;
    /** update가 뷰에 넘기는 정보(매 프레임 같은 객체를 다시 쓴다) */
    this._info = { alpha: 0, dt: 0, time: 0, state: /** @type {any} */ (null) };

    /** @type {(()=>void)[]} */
    this._offs = [];
    this._offs.push(bus.on(EV.MODE_CHANGED, (p) => this._onModeChanged(p)));
    this._offs.push(bus.on(EV.HIT, (p) => this._onHit(p)));
    for (const name of BOSS_EVENTS) {
      this._offs.push(bus.on(name, (p) => {
        const view = this._bossView;
        if (view && view.onEvent) view.onEvent(name, p);
      }));
    }
  }

  /** @param {{mode:string, worldId:string, bossId:string|null}} p */
  _onModeChanged(p) {
    // 같은 보스에 재도전해도 뷰를 새로 만든다(사망 연출로 사라진 뷰를 되살리지 않는다)
    this._swapBossView(p && p.bossId ? p.bossId : null);
    this._flash.player = 0;
    this._flash.boss = 0;
    this._flash.dummy = 0;
    this._player.rig.setFlash(0);
    this._dummy.rig.setFlash(0);
  }

  /** @param {import('../../types.js').DamageResult} p */
  _onHit(p) {
    if (!p || p.outcome !== 'hit') return;
    if (p.target === 'player') this._flash.player = FLASH_DUR;
    else if (p.target === 'boss') this._flash.boss = FLASH_DUR;
    else if (p.target === 'dummy') {
      this._flash.dummy = FLASH_DUR;
      this._dummy.hit(p.dir, !!p.heavy);
    }
  }

  /**
   * 매 프레임: 보간 위치 · facing(· 보스 y)을 root에 넣은 뒤 각 뷰의 update를 부른다.
   * 끝에서 charRoot.updateMatrixWorld(true)를 부른다 — getSocketWorld가 같은 프레임의 위치를 주게.
   * @param {GameState} state
   * @param {number} alpha
   * @param {number} dt
   */
  update(state, alpha, dt) {
    const info = this._info;
    info.alpha = alpha;
    info.dt = dt;
    info.time = state.time;
    info.state = state;
    this._time += dt;

    // ── 플레이어 ──
    const p = state.player;
    const px = lerp(p.prevPos.x, p.pos.x, alpha);
    const pz = lerp(p.prevPos.z, p.pos.z, alpha);
    const pv = this._player;
    pv.root.visible = true;
    pv.root.position.set(px, 0, pz);
    pv.root.rotation.y = lerpAngle(p.prevFacing, p.facing, alpha);
    pv.update(p, info);
    pv.rig.setFlash(this._tickFlash('player', dt));

    // ── 마을: 허수아비 · NPC ──
    const d = state.dummy;
    this._dummy.root.visible = !!d;
    if (d) {
      this._dummy.root.position.set(d.x, 0, d.z);
      this._dummy.update(dt);
      this._dummy.rig.setFlash(this._tickFlash('dummy', dt));
    }
    const npcs = state.world && state.world.npcs ? state.world.npcs : [];
    for (let i = 0; i < NPC_IDS.length; i++) this._npcs[NPC_IDS[i]].root.visible = false;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      const view = this._npcs[n.id];
      if (!view) continue;
      view.root.visible = true;
      view.root.position.set(n.x, 0, n.z);
      view.root.rotation.y = n.facing;
      const dx = px - n.x;
      const dz = pz - n.z;
      const near = dx * dx + dz * dz < LOOK_RANGE * LOOK_RANGE;
      view.update(dt, this._time, near ? angleDiff(n.facing, angleOf(dx, dz)) : null);
    }

    // ── 보스 ── (MODE_CHANGED를 못 받아도 state를 보고 따라간다)
    const b = state.boss;
    const bossId = b ? b.id : null;
    if (bossId !== this._bossId) this._swapBossView(bossId);
    const bv = this._bossView;
    if (b && bv) {
      bv.root.position.set(lerp(b.prevPos.x, b.pos.x, alpha), lerp(b.prevY, b.y, alpha), lerp(b.prevPos.z, b.pos.z, alpha));
      bv.root.rotation.y = lerpAngle(b.prevFacing, b.facing, alpha);
      bv.update(b, info);
      if (bv.rig && bv.rig.setFlash) bv.rig.setFlash(this._tickFlash('boss', dt));
      if (this._warm < 2) this._warmBoss(bv);
    }

    this.root.updateMatrixWorld(true);
    this._updated = true;
  }

  /** 점멸 타이머를 줄이고 0..1 세기를 돌려준다. @param {'player'|'boss'|'dummy'} who @param {number} dt */
  _tickFlash(who, dt) {
    const left = this._flash[who];
    if (left <= 0) return 0;
    this._flash[who] = Math.max(0, left - dt);
    return left / FLASH_DUR;
  }

  /** @param {string|null} bossId */
  _swapBossView(bossId) {
    const old = this._bossView;
    if (old) {
      this.root.remove(old.root);
      this._bossView = null;
      // 선컴파일을 마친 첫 뷰를 그 보스의 「프로그램 지킴이」로 남긴다(씬 밖 — 그려지지도 갱신되지도 않는다).
      // 이미 쥔 것이 있으면 그쪽이 변형을 다 갖고 있다 — 새로 물러난 쪽을 버린다.
      const id = /** @type {string} */ (this._bossId);
      if (this._warm === 2 && id && !this._kept[id]) this._kept[id] = old;
      else old.dispose();
    }
    this._warmMats.length = 0;
    this._bossId = bossId;
    this._warm = 2;
    if (bossId) {
      this._bossView = createBossView(/** @type {any} */ (bossId));
      if (this._bossView) {
        this.root.add(this._bossView.root);
        if (!this._kept[bossId]) this._warm = 0;
      }
    }
  }

  /**
   * 새 보스 뷰의 셰이더 선컴파일(쥔 뷰가 없는 보스의 첫 두 프레임 — 전환 막 아래).
   * 첫 프레임: 불투명 재질을 transparent로 뒤집어 그린다 → 사망 소멸 · 등장에 쓰는 투명 변형이 지금 컴파일된다.
   * 둘째 프레임: 되돌린다(불투명 변형). 두 변형 모두 재질에 붙어 남으므로 뒤의 전환은 컴파일 없이 바뀐다.
   * 뷰의 update 뒤에 부른다 — 뷰가 스스로 투명하게 만든 재질(opacity < 1)은 건드리지 않는다.
   * @param {BossView} bv
   */
  _warmBoss(bv) {
    const mats = this._warmMats;
    if (this._warm === 0) {
      bv.root.traverse((o) => {
        const m = /** @type {any} */ (o).isMesh ? /** @type {any} */ (o).material : null;
        if (!m || Array.isArray(m) || m.transparent !== false || mats.includes(m)) return;
        m.transparent = true;
        m.needsUpdate = true;
        mats.push(m);
      });
      this._warm = 1;
      return;
    }
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!(m.opacity < 1)) {
        m.transparent = false;
        m.needsUpdate = true;
      }
    }
    mats.length = 0;
    this._warm = 2;
  }

  /**
   * 소켓의 월드 좌표를 out(THREE.Vector3)에 쓴다. 대상/소켓이 없으면 false.
   * update 끝에서 갱신한 월드 행렬을 읽는다(호출 측은 행렬을 갱신하지 않는다).
   * @param {'player'|'boss'} who
   * @param {string} socket
   * @param {THREE.Vector3} out
   * @returns {boolean}
   */
  getSocketWorld(who, socket, out) {
    if (!this._updated || !out) return false;
    const rig = who === 'player' ? this._player.rig : who === 'boss' && this._bossView ? this._bossView.rig : null;
    const s = rig && rig.sockets ? rig.sockets[socket] : null;
    if (!s || !s.matrixWorld) return false;
    out.setFromMatrixPosition(s.matrixWorld);
    return true;
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._swapBossView(null);
    for (const id of Object.keys(this._kept)) {
      this._kept[id].dispose();
      delete this._kept[id];
    }
    this._player.dispose();
    this._dummy.dispose();
    for (const id of NPC_IDS) this._npcs[id].dispose();
    this.scene.remove(this.root);
  }
}
