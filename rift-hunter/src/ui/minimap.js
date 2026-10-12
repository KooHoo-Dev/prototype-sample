// OWNER: P10 — 계약 §10.3(미니맵) · §10.2(map — 큰 지도) (P10 내부 파일)
// 미니맵 200×200: 탐색한 타일 · 플레이어 화살표 · 포털 · 희귀 이상 드랍 점 · 챔피언/정예 점 · 30m 안 깨어 있는 몬스터 붉은 점 ·
//   마을에서 char.runs === 0 이면 균열석 점(맥동). 화면과 같은 방향으로 돌려 그린다(카메라 방위 π/4 — 화면 위 = 월드 (−1, 0, −1)).
// 큰 지도(map 패널)는 같은 그리기 함수로 맵 전체를 맞춰 그린다.
// 타일 그림은 맵마다 한 번 만든 1타일 = 1px 이미지에, 탐색이 바뀐 칸만 다시 칠한다(프레임마다 전체를 다시 만들지 않는다).

import { TILE, TILE_FLOOR, TILE_WALL } from '../core/constants.js';

export const MINIMAP_PX = 200;
/** 미니맵 축척(px/m) — 반지름 100px ≈ 31m(30m 안 깬 몬스터가 들어온다) */
const MINI_SCALE = 3.2;
/** 깨어 있는 일반 몬스터를 붉은 점으로 보이는 거리(m) */
const AWAKE_R = 30;
const COS = Math.SQRT1_2;
const SIN = Math.SQRT1_2;

const COL = {
  floor: [62, 58, 70, 255],
  wall: [128, 118, 104, 255],
  townFloor: [78, 70, 60, 255],
  townWall: [140, 124, 100, 255],
  bg: 'rgba(8, 7, 10, 0.72)',
  bgBig: 'rgba(8, 7, 10, 0.4)',
  player: '#ffffff',
  portal: '#b48cff',
  exit: '#7fe0ff',
  awake: '#ff4a3a',
  champion: '#6f9bff',
  elite: '#ffd84a',
  guardian: '#ff9a2e',
  object: 'rgba(230, 220, 200, 0.75)',
  riftStone: '#ff9a2e',
  rarity: { rare: '#ffd84a', legendary: '#ff9a2e', set: '#4fe07a' },
};

/**
 * 탐색 이미지 캐시 — 맵 하나에 하나. sync(state)가 바뀐 칸만 칠한다.
 */
function makeTileImage() {
  /** @type {any} */
  let map = null;
  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  /** @type {CanvasRenderingContext2D|null} */
  let g = null;
  /** @type {ImageData|null} */
  let img = null;
  /** @type {Uint8Array|null} */
  let seen = null;
  let dirty = false;
  let full = false;

  return {
    get canvas() { return canvas; },
    get map() { return map; },
    /** @param {any} m */
    setMap(m) {
      map = m && m.tiles && m.w > 0 && m.h > 0 ? m : null;
      if (!map) { canvas = null; g = null; img = null; seen = null; return; }
      canvas = document.createElement('canvas');
      canvas.width = map.w;
      canvas.height = map.h;
      g = canvas.getContext('2d');
      img = g ? g.createImageData(map.w, map.h) : null;
      seen = new Uint8Array(map.w * map.h);
      full = map.kind === 'town';
      dirty = true;
      if (full) for (let i = 0; i < seen.length; i++) paint(i, true);
    },
    /** @param {any} state */
    sync(state) {
      if (!map || !img || !seen) return;
      if (!full) {
        const ex = state.rift && state.rift.mapId === map.id ? state.rift.explored : null;
        if (ex && ex.length === seen.length) {
          for (let i = 0; i < ex.length; i++) {
            const v = ex[i] ? 1 : 0;
            if (v !== seen[i]) paint(i, v === 1);
          }
        }
      }
      if (dirty && g) {
        g.putImageData(img, 0, 0);
        dirty = false;
      }
    },
  };

  /** @param {number} i @param {boolean} on */
  function paint(i, on) {
    if (!seen || !img || !map) return;
    seen[i] = on ? 1 : 0;
    const tile = map.tiles[i];
    const town = map.kind === 'town';
    const c = !on ? null : tile === TILE_FLOOR ? (town ? COL.townFloor : COL.floor) : tile === TILE_WALL ? (town ? COL.townWall : COL.wall) : null;
    const o = i * 4;
    const d = img.data;
    if (c) { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3]; } else { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; }
    dirty = true;
  }
}

/**
 * 순수 — 월드(x, z) → 그림 좌표(화면과 같은 방향 · 가운데 (cx, cz)가 (ox, oy)). out 에 쓴다(할당 없음).
 * 화면 위 = 월드 (−1, −1)/√2 · 화면 오른쪽 = 월드 (1, −1)/√2 (§0.2 카메라 방위 π/4).
 * @param {number} x @param {number} z @param {number} cx @param {number} cz @param {number} s px/m @param {number} ox @param {number} oy
 * @param {{x:number, y:number}} out
 */
export function worldToMap(x, z, cx, cz, s, ox, oy, out) {
  const dx = (x - cx) * s;
  const dy = (z - cz) * s;
  out.x = ox + dx * COS - dy * SIN;
  out.y = oy + dx * SIN + dy * COS;
  return out;
}

/**
 * 한 장 그리기 — 미니맵(플레이어 가운데)과 큰 지도(맵 가운데 · 맞춤) 공용.
 * @param {CanvasRenderingContext2D} g @param {number} W @param {number} H 그림 크기(CSS px)
 * @param {ReturnType<typeof makeTileImage>} tiles @param {any} state
 * @param {{cx:number, cz:number, scale:number, big:boolean, time:number}} o
 */
function drawScene(g, W, H, tiles, state, o) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = o.big ? COL.bgBig : COL.bg;
  g.fillRect(0, 0, W, H);
  const map = tiles.map;
  const ox = W / 2, oy = H / 2;
  const s = o.scale;
  if (map && tiles.canvas) {
    g.save();
    g.translate(ox, oy);
    g.rotate(Math.PI / 4);
    g.scale(s, s);
    g.translate(-o.cx, -o.cz);
    g.imageSmoothingEnabled = false;
    g.drawImage(tiles.canvas, 0, 0, map.w * TILE, map.h * TILE);
    g.restore();
  }
  const pt = { x: 0, y: 0 };
  const dot = (x, z, r, color) => {
    worldToMap(x, z, o.cx, o.cz, s, ox, oy, pt);
    if (pt.x < -r || pt.y < -r || pt.x > W + r || pt.y > H + r) return;
    g.fillStyle = color;
    g.beginPath();
    g.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    g.fill();
  };
  const ring = (x, z, r, color) => {
    worldToMap(x, z, o.cx, o.cz, s, ox, oy, pt);
    if (pt.x < -r || pt.y < -r || pt.x > W + r || pt.y > H + r) return;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    g.stroke();
  };
  const p = state.player;
  const k = o.big ? 1.4 : 1;
  if (state.scene === 'town' && map) {
    for (const ob of map.objects || []) {
      if (ob.kind === 'deco') continue;
      if (ob.kind === 'townPortal') {
        if (state.town?.portalOpen) ring(ob.x, ob.z, 4 * k, COL.portal);
        continue;
      }
      if (ob.kind === 'riftStone' && state.char && state.char.runs === 0) {
        const pulse = 4 + 2 * (0.5 + 0.5 * Math.sin(o.time * 5));
        ring(ob.x, ob.z, pulse * k, COL.riftStone);
        dot(ob.x, ob.z, 2.5 * k, COL.riftStone);
        continue;
      }
      dot(ob.x, ob.z, 2.2 * k, COL.object);
    }
  }
  const rift = state.rift;
  if (state.scene === 'rift' && rift && map && rift.mapId === map.id) {
    const ex = rift.explored;
    const seenAt = (x, z) => {
      const i = Math.floor(x / TILE), j = Math.floor(z / TILE);
      return i >= 0 && j >= 0 && i < map.w && j < map.h && !!ex[j * map.w + i];
    };
    for (const d of rift.drops) {
      if (d.gone || d.kind !== 'item') continue;
      const c = COL.rarity[d.rarity ?? ''];
      if (c) dot(d.pos.x, d.pos.z, 2.2 * k, c);
    }
    const r2 = AWAKE_R * AWAKE_R;
    for (const m of rift.mons) {
      if (m.dead || m.gone) continue;
      const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
      const near = dx * dx + dz * dz <= r2;
      if (m.rank === 'champion' || m.rank === 'elite' || m.rank === 'guardian') {
        if (!(m.awake && near) && !seenAt(m.pos.x, m.pos.z)) continue;
        dot(m.pos.x, m.pos.z, (m.rank === 'guardian' ? 3.4 : 2.6) * k, COL[m.rank]);
      } else if (m.awake && near) {
        dot(m.pos.x, m.pos.z, 1.7 * k, COL.awake);
      }
    }
    for (const po of rift.portals) ring(po.pos.x, po.pos.z, 4 * k, po.kind === 'exit' ? COL.exit : COL.portal);
  }
  // 플레이어 화살표(facing — 앞 = (sin, cos))
  worldToMap(p.pos.x, p.pos.z, o.cx, o.cz, s, ox, oy, pt);
  const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
  const ax = fx * COS - fz * SIN, ay = fx * SIN + fz * COS;
  const L = 7 * k, Wd = 4.2 * k;
  g.fillStyle = COL.player;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(pt.x + ax * L, pt.y + ay * L);
  g.lineTo(pt.x - ax * L * 0.6 - ay * Wd, pt.y - ay * L * 0.6 + ax * Wd);
  g.lineTo(pt.x - ax * L * 0.6 + ay * Wd, pt.y - ay * L * 0.6 - ax * Wd);
  g.closePath();
  g.fill();
  g.stroke();
}

/** 캔버스를 CSS 크기 × 픽셀 비율(상한 2)로 맞춘다 @param {HTMLCanvasElement} c @param {number} w @param {number} h */
function fitCanvas(c, w, h) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  return dpr;
}

/**
 * 미니맵(오른쪽 위 200×200) — HUD 의 mapHost 에 붙는다.
 * @param {{root:HTMLElement}} deps
 */
export function createMinimap({ root }) {
  const wrap = root.appendChild(document.createElement('div'));
  wrap.className = 'minimap';
  const canvas = wrap.appendChild(document.createElement('canvas'));
  const g = canvas.getContext('2d');
  const tiles = makeTileImage();
  let time = 0;
  return {
    el: wrap,
    tiles,
    /** @param {any} map */
    setMap(map) { tiles.setMap(map); },
    /** @param {any} state @param {number} dt */
    update(state, dt) {
      time += dt > 0 ? dt : 0;
      if (!g || !state.char) return;
      tiles.sync(state);
      const dpr = fitCanvas(canvas, MINIMAP_PX, MINIMAP_PX);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(g, MINIMAP_PX, MINIMAP_PX, tiles, state, { cx: state.player.pos.x, cz: state.player.pos.z, scale: MINI_SCALE, big: false, time });
    },
    dispose() { wrap.remove(); },
  };
}

/**
 * 큰 지도 — 맵 전체를 그림 안에 맞춘다(돌린 바닥 영역의 경계 상자 기준). tiles 는 미니맵의 것을 같이 쓴다.
 * @param {HTMLCanvasElement} canvas @param {ReturnType<typeof makeTileImage>|null} tiles
 */
export function createMapView(canvas, tiles) {
  const g = canvas.getContext('2d');
  let time = 0;
  return {
    /** @param {any} state @param {number} w @param {number} h @param {number} [dt] */
    draw(state, w, h, dt = 0) {
      time += dt > 0 ? dt : 0;
      if (!g || !tiles || !state.char) return;
      tiles.sync(state);
      const map = tiles.map;
      const dpr = fitCanvas(canvas, w, h);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      let cx = state.player.pos.x, cz = state.player.pos.z, scale = MINI_SCALE;
      if (map) {
        const b = map.bounds ?? { x0: 0, z0: 0, x1: map.w * TILE, z1: map.h * TILE };
        cx = (b.x0 + b.x1) / 2;
        cz = (b.z0 + b.z1) / 2;
        const ext = ((b.x1 - b.x0) + (b.z1 - b.z0)) * COS;   // 45° 돌린 상자의 너비 = 높이
        scale = Math.max(1, Math.min(8, (Math.min(w, h) - 24) / Math.max(1, ext)));
      }
      drawScene(g, w, h, tiles, state, { cx, cz, scale, big: true, time });
    },
  };
}
