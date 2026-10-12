// OWNER: P0 — 계약 §8.2 · §2.2 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 정예 속성 훅 레지스트리 — ID → 훅 모듈을 잇기만 한다(MON_AFFIXES 의 hook = 키).
// monsters.js 만 이 파일을 import 한다 — spawn.js · 훅 파일은 import 하지 않는다(순환 · TDZ).

import { hook as fast } from './fast.js';
import { hook as tough } from './tough.js';
import { hook as fireEnchanted } from './fireEnchanted.js';
import { hook as coldEnchanted } from './coldEnchanted.js';
import { hook as vampiric } from './vampiric.js';
import { hook as shielding } from './shielding.js';
import { hook as lightningEnchanted } from './lightningEnchanted.js';
import { hook as teleporter } from './teleporter.js';
import { hook as jailer } from './jailer.js';
import { hook as splitter } from './splitter.js';
import { hook as plague } from './plague.js';
import { hook as mortar } from './mortar.js';

export const AFFIX_HOOKS = Object.freeze({
  fast, tough, fireEnchanted, coldEnchanted, vampiric, shielding,
  lightningEnchanted, teleporter, jailer, splitter, plague, mortar,
});
