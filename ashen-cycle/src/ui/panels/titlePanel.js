// OWNER: P8 — 계약 §10.3 타이틀 패널
// 읽는 것: actions.hasSave() · params.saveBroken · memory.titleNotes(환경 안내 — UIRoot.setTitleNotes).
// 부르는 것: newGame() · continueGame().
// 새 게임이 저장을 덮을 때는 한 번 더 눌러야 한다 — 무장 뒤 0.7초 안의 입력(더블클릭 · E 연타의 둘째)은 확정으로 치지 않는다.
import { GAME_VERSION } from '../../core/constants.js';
import { el, add } from '../dom.js';
import { t, hasStr } from '../i18n.js';
import { Panel } from './panelBase.js';

export class TitlePanel extends Panel {
  /** @param {import('./panelBase.js').PanelCtx} ctx */
  constructor(ctx) {
    super(ctx);
    this.hints('panel.hint.select', 'panel.hint.confirm');
    add(this.foot, el('span', 'ac-title-version', t('panel.title.version', { v: GAME_VERSION })));
  }

  build() {
    const { actions } = this.ctx.deps;
    this._hasSave = !!actions.hasSave?.();

    add(this.body,
      el('div', 'ac-title-sub', t('panel.title.subtitle')),
      el('div', 'ac-title-rule'),
      el('div', 'ac-title-tagline', t('panel.title.tagline')));

    const menu = el('div', 'ac-menu');
    if (this._hasSave) {
      const cont = this.button(t('panel.title.continue'), 'continue', () => actions.continueGame());
      add(menu, cont.el);
      this.row(cont);
    } else {
      add(menu, this.deadButton(t('panel.title.continue')));
    }
    this._newBtn = this.button(t('panel.title.newGame'), 'new', () => this._newGame());
    add(menu, this._newBtn.el);
    this.row(this._newBtn);
    add(this.body, menu);

    this._note = el('div', 'ac-title-note');
    add(this.body, this._note);
    this._paintNote();

    // 환경 안내(저장할 수 없는 브라우저 · 터치만 있는 기기) — app이 부팅 때 알려 준다
    const notes = Array.isArray(this.ctx.memory.titleNotes) ? this.ctx.memory.titleNotes : [];
    for (const key of notes) {
      if (hasStr(key)) add(this.body, el('div', 'ac-title-env', t(key)));
    }
  }

  defaultFocus() {
    return this._hasSave ? 'continue' : 'new';
  }

  /** title: cancel은 아무것도 하지 않는다(무장한 확인만 푼다). */
  cancel() {
    this._disarm();
  }

  onFocusChange(item) {
    if (item.key !== 'new') this._disarm();
  }

  _newGame() {
    // 덮을 저장이 있으면 확인 한 번 — 첫 입력은 무장만, 문구를 읽을 시간(0.7초)이 지난 뒤의 입력이 확정
    if (this._hasSave && !this.confirmTwice(this._newBtn)) {
      this._paintNote();
      return;
    }
    this.ctx.deps.actions.newGame();
  }

  _disarm() {
    if (this.disarm()) this._paintNote();
  }

  /** 버튼 아래 한 줄: 덮어쓰기 확인 > 읽지 못한 세이브 안내 > 저장 없음. */
  _paintNote() {
    let text = '';
    let warn = false;
    if (this.armed) {
      text = t('panel.title.confirmNew');
      warn = true;
    } else if (this.ctx.params.saveBroken) {
      text = t('panel.title.saveBroken');
      warn = true;
    } else if (!this._hasSave) {
      text = t('panel.title.noSave');
    }
    this._note.textContent = text;
    this._note.classList.toggle('ac-warn', warn);
  }
}
