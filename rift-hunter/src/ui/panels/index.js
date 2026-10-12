// OWNER: P0 — 계약 §10.1 · §10.2 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 패널 레지스트리 — PanelId → createXPanel(ctx). 함수 이름 = 'create' + PanelId 첫 글자 대문자 + 'Panel'.

import { createTitlePanel } from './title.js';
import { createCharSelectPanel } from './charSelect.js';
import { createNewCharPanel } from './newChar.js';
import { createPausePanel } from './pause.js';
import { createSettingsPanel } from './settings.js';
import { createHelpPanel } from './help.js';
import { createDeathPanel } from './death.js';
import { createRiftCompletePanel } from './riftComplete.js';
import { createConfirmPanel } from './confirm.js';
import { createHintPanel } from './hint.js';
import { createMapPanel } from './map.js';
import { createInventoryPanel } from './inventory.js';
import { createSkillsPanel } from './skills.js';
import { createCharacterPanel } from './character.js';
import { createBlacksmithPanel } from './blacksmith.js';
import { createGeneralPanel } from './general.js';
import { createGamblerPanel } from './gambler.js';
import { createMysticPanel } from './mystic.js';
import { createStashPanel } from './stash.js';
import { createRiftStonePanel } from './riftStone.js';
import { createAnalyticsPanel } from '../analytics/AnalyticsPanel.js';

export const PANELS = Object.freeze({
  title: createTitlePanel,
  charSelect: createCharSelectPanel,
  newChar: createNewCharPanel,
  pause: createPausePanel,
  settings: createSettingsPanel,
  help: createHelpPanel,
  death: createDeathPanel,
  riftComplete: createRiftCompletePanel,
  confirm: createConfirmPanel,
  hint: createHintPanel,
  map: createMapPanel,
  inventory: createInventoryPanel,
  skills: createSkillsPanel,
  character: createCharacterPanel,
  blacksmith: createBlacksmithPanel,
  general: createGeneralPanel,
  gambler: createGamblerPanel,
  mystic: createMysticPanel,
  stash: createStashPanel,
  riftStone: createRiftStonePanel,
  analytics: createAnalyticsPanel,
});
