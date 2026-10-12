// OWNER: P15 — 계약 §7.13 (시드 — P0 이 W0 에 계약 값으로 채웠다)
// 프리셋 빌드 — PRESETS[cls] = [A, B]. order 는 레벨 2 → 30 에 한 점씩(29개 · 단계 · req · 최대 랭크를 지키는 순서 — data.schema.test).
// bar 는 스킬 바 5칸(0 = 우클릭). 이름 문면은 strings.ko.js 의 preset.<cls>.<0|1>.

export const PRESETS = {
  warrior: [
    { id: 'warriorA', nameKey: 'preset.warrior.0',
      order: ['groundStomp', 'warCry', 'groundStomp', 'weaponMastery', 'groundStomp', 'earthquake', 'leap', 'earthquake', 'weaponMastery', 'ironSkin',
        'aftershock', 'groundStomp', 'earthquake', 'weaponMastery', 'quakeLanding', 'crusher', 'groundStomp', 'earthquake', 'crusher', 'earthquake',
        'crusher', 'weaponMastery', 'leap', 'ironSkin', 'undying', 'leap', 'ironSkin', 'warCry', 'charge'],
      bar: ['groundStomp', 'earthquake', 'warCry', 'leap', 'charge'] },
    { id: 'warriorB', nameKey: 'preset.warrior.1',
      order: ['charge', 'bloodthirst', 'charge', 'warCry', 'bloodthirst', 'whirlwind', 'whirlwind', 'whirlwind', 'bloodthirst', 'groundStomp',
        'bloodWhirl', 'whirlwind', 'whirlwind', 'bloodthirst', 'charge', 'berserker', 'berserker', 'berserker', 'charge', 'charge',
        'leap', 'ironSkin', 'ironSkin', 'undying', 'warCry', 'leap', 'weaponMastery', 'weaponMastery', 'undying'],
      bar: ['whirlwind', 'charge', 'warCry', 'groundStomp', 'leap'] },
  ],
  mage: [
    { id: 'mageA', nameKey: 'preset.mage.0',
      order: ['fireball', 'frostNova', 'fireball', 'combustion', 'fireball', 'meteor', 'teleport', 'meteor', 'combustion', 'fireball',
        'splitFireball', 'meteor', 'combustion', 'fireball', 'energyShield', 'heartOfFire', 'heartOfFire', 'heartOfFire', 'meteor', 'meteor',
        'combustion', 'combustion', 'frostNova', 'teleport', 'manaFlow', 'manaFlow', 'energyShield', 'coldCore', 'manaFlow'],
      bar: ['fireball', 'frostNova', 'meteor', 'teleport', 'energyShield'] },
    { id: 'mageB', nameKey: 'preset.mage.1',
      order: ['chainLightning', 'frostNova', 'chainLightning', 'coldCore', 'frostNova', 'teleport', 'energyShield', 'chainLightning', 'coldCore', 'frostNova',
        'iceShards', 'lightningAfterimage', 'chainLightning', 'coldCore', 'frostNova', 'shatter', 'shatter', 'shatter', 'chainLightning', 'frostNova',
        'coldCore', 'coldCore', 'manaFlow', 'manaFlow', 'teleport', 'energyShield', 'arcaneLore', 'arcaneLore', 'fireball'],
      bar: ['chainLightning', 'frostNova', 'teleport', 'energyShield', 'fireball'] },
  ],
};
