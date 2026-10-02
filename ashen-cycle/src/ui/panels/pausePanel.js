// OWNER: P8 — 계약 §10.3 일시정지 · 설정 패널
// 읽는 것: settings · data/keybinds.js(조작 안내 표) · sim.state.fight.
// 부르는 것: applySettings(partial) · resume() · toTown() · quitToTitle(). Esc로는 닫히지 않는다(§10.1).
import { KEYBINDS, GAMEPAD } from '../../data/keybinds.js';
import { SETTINGS_RANGE } from '../../data/settings.js';
import { el, add, num, fmtPct, keyLabel, keysLabel } from '../dom.js';
import { t } from '../i18n.js';
import { Panel } from './panelBase.js';

const QUALITY_IDS = ['low', 'medium', 'high'];

/**
 * 설정 행. kind: slider(범위는 SETTINGS_RANGE) · toggle · quality.
 * @type {{key:string, kind:'slider'|'toggle'|'quality', step?:number, pct?:boolean}[]}
 */
const ROWS = [
  { key: 'mouseSensitivity', kind: 'slider', step: 0.1 },
  { key: 'invertY', kind: 'toggle' },
  { key: 'volumeMaster', kind: 'slider', step: 0.05, pct: true },
  { key: 'volumeSfx', kind: 'slider', step: 0.05, pct: true },
  { key: 'volumeMusic', kind: 'slider', step: 0.05, pct: true },
  { key: 'quality', kind: 'quality' },
  { key: 'cameraShake', kind: 'slider', step: 0.1, pct: true },
  { key: 'damageNumbers', kind: 'toggle' },
];

/** @param {number} index 표준 매핑 버튼 인덱스 */
const pad = (index) => t(`pad.${index}`);

export class PausePanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx);
    /** @type {(()=>void)[]} 설정 값을 화면에 다시 쓰는 함수들 */
    this._syncs = [];
    this.hints('panel.hint.select', 'panel.hint.adjust', 'panel.hint.confirm', 'panel.hint.resume');
  }

  build() {
    this._syncs = [];
    const cols = el('div', 'ac-pause-cols');

    // ── 왼쪽: 설정 ──
    const left = el('div', 'ac-pause-col');
    add(left, el('h3', 'ac-section', t('panel.pause.settings')));
    for (const spec of ROWS) add(left, this._settingRow(spec));
    add(cols, left);

    // ── 오른쪽: 조작 안내 표 ──
    const right = el('div', 'ac-pause-col');
    add(right, el('h3', 'ac-section', t('panel.pause.controls')), this._controlsTable());
    const tips = el('ul', 'ac-tips');
    for (const k of ['charge', 'backstep', 'parry', 'danger', 'posture']) add(tips, el('li', '', t(`panel.pause.tip.${k}`)));
    add(right, tips);
    add(cols, right);
    add(this.body, cols);

    // ── 아래: 계속 · 마을로 · 타이틀로 ──
    const { actions, sim } = this.ctx.deps;
    this._warn = el('div', 'ac-pause-warn');
    add(this.body, this._warn);
    const bar = el('div', 'ac-btn-bar');
    const resume = this.button(t('panel.pause.resume'), 'resume', () => actions.resume(), { cls: 'ac-primary' });
    const items = [resume];
    // 마을에서는 [마을로]가 뜻이 없다 — 보스전에서만 보인다
    if (sim?.state?.mode === 'boss') {
      this._townBtn = this.button(t('panel.pause.toTown'), 'town', () => this._leave(this._townBtn, 'panel.pause.forfeit', () => actions.toTown()));
      items.push(this._townBtn);
    } else {
      this._townBtn = null;
    }
    this._titleBtn = this.button(t('panel.pause.toTitle'), 'title', () => this._leave(this._titleBtn, 'panel.pause.forfeitTitle', () => actions.quitToTitle()));
    items.push(this._titleBtn);
    for (const it of items) add(bar, it.el);
    add(this.body, bar);
    this.row(...items);
    this._sync();
  }

  defaultFocus() {
    return 'resume';
  }

  /** pause: cancel = 재개(Q · 게임패드 B — 활성화 제스처라 포인터 락을 되찾는다). */
  cancel() {
    this.ctx.sound('click');
    this.ctx.deps.actions.resume();
  }

  onSettings() {
    this._sync();
  }

  onFocusChange(item) {
    if (item !== this.armed) this._disarm();
  }

  // ── 내부 ──

  /**
   * 교전 중의 [마을로] · [타이틀로]는 확인 한 번(그 판을 포기한다 — 지금까지 준 피해만큼 보상을 받는다. 죽는 것과 같다).
   * 첫 입력은 무장만 하고, 문구를 읽을 시간이 지난 뒤의 입력이 확정이다(panelBase.confirmTwice).
   * @param {import('./panelBase.js').FocusItem} item
   * @param {string} warnKey 확인 문구의 문자열 키
   * @param {()=>void} go
   */
  _leave(item, warnKey, go) {
    const fight = this.ctx.deps.sim?.state?.fight;
    if (fight?.phase === 'fight' && !this.confirmTwice(item)) {
      this._warn.textContent = `${t(warnKey)} — ${t('panel.confirmAgain')}`;
      this._warn.classList.add('ac-show');
      return;
    }
    go();
  }

  _disarm() {
    if (this.disarm()) this._warn.classList.remove('ac-show');
  }

  _sync() {
    for (const fn of this._syncs) fn();
  }

  /** @param {Object} partial */
  _apply(partial) {
    this.ctx.deps.actions.applySettings(partial);
    this._sync(); // app이 같은 settings 객체를 고친다(§11.1) — 그 값을 그대로 다시 읽는다
  }

  /** @param {{key:string, kind:string, step?:number, pct?:boolean}} spec @returns {HTMLElement} */
  _settingRow(spec) {
    const { settings } = this.ctx.deps;
    const key = spec.key;
    const rowEl = el('div', `ac-set-row ac-set-${spec.kind}`);
    const control = el('div', 'ac-set-control');
    const value = el('span', 'ac-set-value');
    add(rowEl, el('span', 'ac-set-label', t(`settings.${key}`)), control, value);

    if (spec.kind === 'slider') {
      const [lo, hi] = SETTINGS_RANGE[key] ?? [0, 1];
      const step = spec.step ?? 0.1;
      const snap = (v) => Math.min(hi, Math.max(lo, Number((Math.round(v / step) * step).toFixed(4))));
      const track = el('div', 'ac-slider');
      const fill = el('div', 'ac-slider-fill');
      const knob = el('div', 'ac-slider-knob');
      add(control, add(track, fill, knob));
      const setFromX = (clientX) => {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return;
        const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        const v = snap(lo + f * (hi - lo));
        if (v !== snap(num(settings[key]))) this._apply({ [key]: v });
      };
      track.addEventListener('pointerdown', (e) => {
        if (!this.ctx.ready()) return;
        e.preventDefault();
        try {
          track.setPointerCapture(e.pointerId); // 트랙 밖으로 끌어도 따라오게
        } catch {
          // 잡을 수 없는 포인터(합성 이벤트 등)면 클릭 지점만 반영한다
        }
        setFromX(e.clientX);
      });
      track.addEventListener('pointermove', (e) => {
        if (e.buttons !== 0 && track.hasPointerCapture?.(e.pointerId)) setFromX(e.clientX);
      });
      this._syncs.push(() => {
        const v = Math.min(hi, Math.max(lo, num(settings[key])));
        const f = hi > lo ? (v - lo) / (hi - lo) : 0;
        fill.style.transform = `scaleX(${f})`;
        knob.style.left = `${f * 100}%`;
        value.textContent = spec.pct ? fmtPct(v) : v.toFixed(1);
      });
      this.row(this.item(rowEl, key, {
        adjust: (dx) => {
          const cur = snap(num(settings[key]));
          const next = snap(cur + dx * step);
          if (next !== cur) this._apply({ [key]: next });
        },
      }));
    } else if (spec.kind === 'toggle') {
      const box = el('div', 'ac-toggle');
      add(control, add(box, el('i', 'ac-toggle-dot')));
      const flip = () => this._apply({ [key]: !settings[key] });
      this._syncs.push(() => {
        box.classList.toggle('ac-on', !!settings[key]);
        value.textContent = t(settings[key] ? 'toggle.on' : 'toggle.off');
      });
      this.row(this.item(rowEl, key, { activate: flip, adjust: flip }));
    } else {
      const seg = el('div', 'ac-seg');
      /** @type {HTMLElement[]} */
      const cells = [];
      for (const q of QUALITY_IDS) {
        const cell = el('span', 'ac-seg-cell', t(`quality.${q}`));
        cell.addEventListener('click', (e) => {
          if (!this.ctx.ready()) return;
          e.stopPropagation(); // 행의 클릭(다음 단계로 넘기기)과 겹치지 않게
          this.ctx.sound('click');
          this._apply({ [key]: q });
        });
        cells.push(cell);
        add(seg, cell);
      }
      add(control, seg);
      const shift = (dx) => {
        const i = Math.max(0, QUALITY_IDS.indexOf(settings[key]));
        const j = Math.max(0, Math.min(QUALITY_IDS.length - 1, i + dx));
        if (j !== i) this._apply({ [key]: QUALITY_IDS[j] });
      };
      const cycle = () => {
        const i = Math.max(0, QUALITY_IDS.indexOf(settings[key]));
        this._apply({ [key]: QUALITY_IDS[(i + 1) % QUALITY_IDS.length] });
      };
      this._syncs.push(() => {
        cells.forEach((cell, i) => cell.classList.toggle('ac-on', QUALITY_IDS[i] === settings[key]));
        value.textContent = '';
      });
      this.row(this.item(rowEl, key, { activate: cycle, adjust: shift }));
    }
    return rowEl;
  }

  /** KEYBINDS · GAMEPAD에서 만든 조작 안내 표. @returns {HTMLElement} */
  _controlsTable() {
    const K = KEYBINDS;
    const G = GAMEPAD;
    const move = [K.moveForward, K.moveLeft, K.moveBack, K.moveRight].map((codes) => keyLabel(codes[0])).join(' ');
    const hold = (label) => t('key.hold', { key: label });
    /** @type {[string, string, string][]} [행동, 키보드 · 마우스, 게임패드] */
    const rows = [
      [t('action.move'), move, t('pad.stickL')],
      [t('action.camera'), t('key.mouse'), t('pad.stickR')],
      [t('action.light'), keysLabel(K.light), pad(G.light)],
      [t('action.heavy'), keysLabel(K.heavy), pad(G.heavy)],
      [t('action.guard'), hold(keysLabel(K.guard)), hold(pad(G.guard))],
      [t('action.roll'), keysLabel(K.roll), pad(G.roll)],
      [t('action.sprint'), hold(keysLabel(K.sprint)), hold(pad(G.sprint))],
      [t('action.lockOn'), keysLabel(K.lockOn), pad(G.lockOn)],
      [t('action.flask'), keysLabel(K.flask), pad(G.flask)],
      [t('action.interact'), keysLabel(K.interact), pad(G.interact)],
      [t('action.pause'), keysLabel(K.pause), pad(G.pause)],
    ];
    const table = el('div', 'ac-keys');
    add(table, add(el('div', 'ac-keys-row ac-keys-head'),
      el('span', '', t('panel.pause.colAction')), el('span', '', t('panel.pause.colKeyboard')), el('span', '', t('panel.pause.colGamepad'))));
    for (const [action, keys, padKeys] of rows) {
      add(table, add(el('div', 'ac-keys-row'), el('span', 'ac-keys-action', action), el('span', 'ac-keys-key', keys), el('span', 'ac-keys-key', padKeys)));
    }
    return table;
  }
}
