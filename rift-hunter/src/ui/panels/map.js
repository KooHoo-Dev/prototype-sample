// OWNER: P10 — 계약 §10.2(map — Tab 토글 · 겹쳐 보는 패널) · §10.3(미니맵과 같은 그림)
// 큰 지도: 맵 전체(탐색한 타일 · 포털 · 플레이어 · 희귀 이상 드랍 · 챔피언/정예 · 30m 안 깬 몬스터)를 화면 가운데에 반투명으로 겹친다.
// 마우스를 막지 않는다(겹쳐 보며 계속 움직인다) · 먹는 키는 Tab · Escape 뿐(나머지는 게임으로 — §10.5-3).

import { createMapView } from '../minimap.js';

/** @typedef {import('../../types.js').Panel} Panel */

const MAX_W = 820;
const MAX_H = 600;
/** 미니맵(오른쪽 위 200px) · 아래 HUD 묶음(약 130px)을 비켜 선다 */
const MARGIN_W = 680;   // 화면 패스: 460 이면 1280 폭에서 지도가 오른쪽 큰 안내 열(오른쪽 16px + 300px)과 겹쳤다 — 양쪽 2 × (316 + 8) + 테두리
const MARGIN_H = 270;

/**
 * @param {{root:HTMLElement, sim:any, bus:any, settings:any, actions:any, t:(key:string, params?:Object) => string, ui:any, widgets:any}} ctx
 * @returns {Panel}
 */
export function createMapPanel(ctx) {
  const { t, widgets: w, ui } = ctx;
  const el = w.el('section', 'panel-map');
  el.dataset.panel = 'map';
  const canvas = /** @type {HTMLCanvasElement} */ (el.appendChild(w.el('canvas', 'map-canvas')));
  el.appendChild(w.el('div', 'map-hint', t('map.hint')));
  /** @type {ReturnType<typeof createMapView>|null} */
  let view = null;
  let last = 0;

  return {
    id: 'map',
    modal: false,
    el,
    open() {
      view = createMapView(canvas, ui?.minimap?.tiles ?? null);
      last = typeof performance !== 'undefined' ? performance.now() : 0;
    },
    close() {},
    update(state) {
      if (!view || !state) return;
      const now = typeof performance !== 'undefined' ? performance.now() : last;
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const W = Math.max(240, Math.min(MAX_W, (window.innerWidth || 1280) - MARGIN_W));
      const H = Math.max(200, Math.min(MAX_H, (window.innerHeight || 720) - MARGIN_H));
      view.draw(state, W, H, dt);
    },
    handleKey(e) {
      if (e.code === 'Tab' || e.code === 'Escape') {
        if (e.type !== 'keyup' && !e.repeat) ui.closePanel('map', e.code === 'Escape' ? 'esc' : 'key');
        return true;
      }
      return false;
    },
    keys: ['Tab', 'Escape'],
    dispose() { el.remove(); },
  };
}
