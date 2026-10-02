// OWNER: P7 — 계약 §9.7 「피해 숫자」
// 떠오르는 피해 숫자. 스프라이트 16개 풀 · 스프라이트마다 캔버스 텍스처 하나(뜰 때만 다시 그린다).
import * as THREE from 'three';

const POOL = 16;
const TEX_W = 192;
const TEX_H = 96;
const LIFE = 0.85;
const POP_DUR = 0.1;
const FADE_FROM = 0.55;       // 수명의 이 지점부터 사라진다
const RISE_SPEED = 1.5;       // m/s (감속)
/** 화면 높이 대비 글자 높이(sizeAttenuation 끔) */
const SCALE_H = 0.06;
const CRIT_SCALE = 1.4;
const BIG_SCALE = 1.75;
/** 블룸 임계값(약 0.9) 아래로 눌러 글자가 번지지 않게 한다 */
const TINT = 0.85;
const COLOR_NORMAL = '#f2efe6';
const COLOR_CRIT = '#ffd24a';
const COLOR_BIG = '#ff9a4a';
const FONT = '800 58px "Segoe UI", "Malgun Gothic", system-ui, sans-serif';

export class DamageNumbers {
  /** @param {THREE.Object3D} parent fxRoot */
  constructor(parent) {
    this.parent = parent;
    /** @type {{sprite:THREE.Sprite, ctx:CanvasRenderingContext2D, tex:THREE.CanvasTexture, t:number, scale:number, vx:number}[]} */
    this._items = [];
    this._next = 0;
    // Node(검사) 등 캔버스가 없는 환경에서는 조용히 꺼 둔다
    if (typeof document === 'undefined') return;
    for (let i = 0; i < POOL; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false,
      });
      mat.color.setScalar(TINT);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 20;
      parent.add(sprite);
      this._items.push({ sprite, ctx, tex, t: -1, scale: 1, vx: 0 });
    }
  }

  /**
   * @param {number} x @param {number} y @param {number} z 월드 위치
   * @param {number} amount 피해(정수)
   * @param {boolean} crit 치명 — 크게 · 노랗게
   * @param {boolean} big 처형 — 더 크게
   */
  spawn(x, y, z, amount, crit, big) {
    if (this._items.length === 0) return;
    const it = this._items[this._next];
    this._next = (this._next + 1) % this._items.length;
    const ctx = it.ctx;
    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(8, 6, 6, 0.92)';
    const text = String(Math.round(amount));
    ctx.strokeText(text, TEX_W / 2, TEX_H / 2 + 2);
    ctx.fillStyle = big ? COLOR_BIG : crit ? COLOR_CRIT : COLOR_NORMAL;
    ctx.fillText(text, TEX_W / 2, TEX_H / 2 + 2);
    it.tex.needsUpdate = true;
    it.t = 0;
    it.scale = big ? BIG_SCALE : crit ? CRIT_SCALE : 1;
    it.vx = (Math.random() - 0.5) * 0.8;
    it.sprite.position.set(x + (Math.random() - 0.5) * 0.5, y + 0.5 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.5);
    it.sprite.material.opacity = 1;
    it.sprite.visible = true;
  }

  /** @param {number} dt */
  update(dt) {
    for (const it of this._items) {
      if (it.t < 0) continue;
      it.t += dt;
      const u = it.t / LIFE;
      if (u >= 1) {
        it.t = -1;
        it.sprite.visible = false;
        continue;
      }
      const s = it.sprite;
      s.position.y += RISE_SPEED * (1 - u) * (1 - u) * dt;
      s.position.x += it.vx * (1 - u) * dt;
      const pop = it.t < POP_DUR ? 1.6 - 0.6 * (it.t / POP_DUR) : 1;
      const h = SCALE_H * it.scale * pop;
      s.scale.set(h * (TEX_W / TEX_H), h, 1);
      s.material.opacity = u < FADE_FROM ? 1 : 1 - (u - FADE_FROM) / (1 - FADE_FROM);
    }
  }

  clear() {
    for (const it of this._items) {
      it.t = -1;
      it.sprite.visible = false;
    }
  }

  dispose() {
    for (const it of this._items) {
      this.parent.remove(it.sprite);
      it.tex.dispose();
      it.sprite.material.dispose();
    }
    this._items.length = 0;
  }
}
