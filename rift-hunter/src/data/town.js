// OWNER: P4 — 계약 §7.12 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 마을 배치 — 24 × 24 타일(48m) · 가장자리 1타일 벽 · 좌표 m · facing 은 yaw(rad).
// objects: 상호작용 물체 7 + 모닥불(deco · 막음). buildings: 장식 건물 상자(x0..x1 · z0..z1 m · h 높이 · 막음).
// NPC 의 이름 · 인사는 strings.ko.js 의 npc.<id> · npc.<id>.greet.

const PI = Math.PI;

export const TOWN = {
  w: 24, h: 24,
  objects: [
    { id: 'townPortal', kind: 'townPortal', x: 24, z: 16, facing: 0, r: 1.2, look: 'portal' },
    { id: 'riftStone', kind: 'riftStone', x: 31, z: 22, facing: -PI / 2, r: 1.2, look: 'riftStone' },
    { id: 'stash', kind: 'stash', x: 17, z: 22, facing: PI / 2, r: 1.0, look: 'stash' },
    { id: 'blacksmith', kind: 'npc', npc: 'blacksmith', x: 14, z: 31, facing: (3 * PI) / 4, r: 1.0, look: 'npcSmith' },
    { id: 'general', kind: 'npc', npc: 'general', x: 34, z: 31, facing: (-3 * PI) / 4, r: 1.0, look: 'npcGrocer' },
    { id: 'gambler', kind: 'npc', npc: 'gambler', x: 14, z: 13, facing: PI / 4, r: 1.0, look: 'npcGambler' },
    { id: 'mystic', kind: 'npc', npc: 'mystic', x: 34, z: 13, facing: -PI / 4, r: 1.0, look: 'npcMystic' },
    { id: 'bonfire', kind: 'deco', x: 24, z: 25, facing: 0, r: 1.0, h: 1.2, look: 'bonfire', block: true },
  ],
  /** 장식 건물 — look: smithy · grocery · tent · tower */
  buildings: [
    { id: 'smithy', x0: 8, x1: 16, z0: 33, z1: 40, h: 5, look: 'smithy' },
    { id: 'grocery', x0: 32, x1: 40, z0: 33, z1: 40, h: 5, look: 'grocery' },
    { id: 'tent', x0: 8, x1: 14, z0: 8, z1: 13, h: 3.5, look: 'tent' },
    { id: 'tower', x0: 35, x1: 40, z0: 8, z1: 13, h: 9, look: 'tower' },
  ],
  /** 도착(−Z 쪽 · 포털을 본다) · 부활(포털 앞 1.5m) */
  arrive: { x: 24, z: 20, facing: PI },
  respawn: { x: 24, z: 18.5, facing: PI },
  /** 빛: 모닥불 1 · 횃불 6(건물 앞) — kind 는 TILESETS town 의 lights.kinds */
  lights: [
    { kind: 'bonfire', x: 24, z: 25 },
    { kind: 'torch', x: 11, z: 31.5 }, { kind: 'torch', x: 17, z: 31.5 },
    { kind: 'torch', x: 31, z: 31.5 }, { kind: 'torch', x: 37, z: 31.5 },
    { kind: 'torch', x: 15.5, z: 11 }, { kind: 'torch', x: 33, z: 11 },
  ],
};
