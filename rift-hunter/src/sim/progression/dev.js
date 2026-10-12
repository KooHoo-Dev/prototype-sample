// OWNER: P6 — 계약 §6.11 · §11.7
// 개발용 캐릭터(?class · ?level · ?preset · ?rift) — 그 레벨 · 프리셋 빌드대로 스킬 · 해금 = rift · 장비 칸 전부 rollGear(마법 60% · 희귀 40% · ilvl = rift).
// 순수(시드 파생 난수 · 상태 rng 를 쓰지 않는다) — 같은 인자면 같은 캐릭터(아이템 ID 는 newId 가 준다).

import { EQUIP_SLOTS, LEVEL_CAP } from '../../core/constants.js';
import { hash32 } from '../../core/hash.js';
import { makeRng, seedRng } from '../../core/rng.js';
import { BASES_BY_ID, SKILL_NODES_BY_ID } from '../../data/index.js';
import { DEV, SEED_SALT } from '../../data/economy.js';
import { PRESETS } from '../../data/presets.js';
import { RIFT } from '../../data/rift.js';
import { rollGear } from '../loot/rollDrops.js';
import { emptyEquip } from '../state.js';
import { createCharacter } from './character.js';
import { applyLearn, canLearn, xpReq } from './progress.js';

/** @typedef {import('../../types.js').CharacterState} CharacterState */
/** @typedef {import('../../types.js').EquipSlot} EquipSlot */

/**
 * 개발용 캐릭터 — level(1..30) · xpTotal = 그 레벨까지의 누적 · 프리셋(PRESETS[cls][preset] · 없으면 0번) order 를 앞에서부터 포인트만큼 찍고(canLearn 규칙 그대로) ·
 * bar = 프리셋 bar 중 배운 액티브 + 남은 빈 칸에 배운 액티브 · riftUnlocked = lastRiftLevel = rift(1..RIFT.maxLevel) ·
 * 장비 10칸을 rollGear({rarity: DEV.gearRarity, level: rift, slot, ownClassOnly:true})로(양손 무기면 보조 칸은 비운다 · 시작 장비는 버린다).
 * 요구 레벨보다 낮은 레벨이어도 그대로 끼운 채다(개발용 — 장착 명령을 거치지 않는다).
 * @param {{slot?:number, cls:import('../../types.js').ClassId, name:string, level?:number, rift?:number, preset?:number, seed?:number, newId:() => string}} opts
 * @returns {CharacterState}
 */
export function makeDevCharacter({ slot = 0, cls, name, level = 1, rift = 1, preset = 0, seed = 1, newId }) {
  const char = createCharacter({ slot, cls, name, newId, seed });
  const L = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(level)) || 1));
  char.level = L;
  char.xp = 0;
  let total = 0;
  for (let n = 1; n < L; n++) total += xpReq(n);
  char.xpTotal = total;

  // 스킬 — 프리셋 순서대로(단계 · req · 최대 랭크를 지키는 순서 — data.schema 가 확인한다 · 못 찍는 것은 건너뛴다)
  const list = PRESETS[cls] ?? [];
  const P = list[Math.max(0, Math.min(list.length - 1, Math.floor(Number(preset)) || 0))] ?? list[0];
  if (P) {
    for (const id of P.order) {
      if (canLearn(char, id).reason === 'points') break;
      if (canLearn(char, id).ok) applyLearn(char, id);
    }
    const bar = char.skills.bar;
    for (let i = 0; i < bar.length; i++) bar[i] = null;
    for (let i = 0; i < bar.length && i < P.bar.length; i++) {
      const id = P.bar[i];
      if (id && char.skills.ranks[id] >= 1 && SKILL_NODES_BY_ID[id]?.kind === 'active' && !bar.includes(id)) bar[i] = id;
    }
    for (const id of P.order) {
      if (!(char.skills.ranks[id] >= 1) || SKILL_NODES_BY_ID[id]?.kind !== 'active' || bar.includes(id)) continue;
      const e = bar.indexOf(null);
      if (e < 0) break;
      bar[e] = id;
    }
  }

  // 해금 · 장비
  const R = Math.max(1, Math.min(RIFT.maxLevel, Math.floor(Number(rift)) || 1));
  char.riftUnlocked = R;
  char.lastRiftLevel = R;
  const rng = makeRng(seedRng(hash32(seed, slot, L, R, SEED_SALT.dev)));
  const equip = emptyEquip();
  for (const s of EQUIP_SLOTS) {
    const mh = equip.mainHand;
    if (s === 'offhand' && mh && (BASES_BY_ID[mh.baseId]?.hands ?? 1) === 2) continue;
    const rarity = /** @type {import('../../types.js').Rarity} */ (rng.pick(DEV.gearRarity) ?? 'magic');
    const itemSlot = s === 'ring1' || s === 'ring2' ? 'ring' : s;
    /** @type {any} */ (equip)[s] = rollGear(rng, { rarity, level: R, cls, newId, slot: itemSlot, ownClassOnly: true });
  }
  char.equip = equip;
  return char;
}
