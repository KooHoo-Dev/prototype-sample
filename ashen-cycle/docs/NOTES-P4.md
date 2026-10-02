# NOTES-P4 (progression)

계약에 없어서 P4가 정한 것 · 계약과 다르게 읽은 것 · 남의 파일 때문에 본 것. 공개 시그니처는 전부 계약 그대로다.

## 계약 해석

- **`equipRelic` — 「같은 유물 두 칸 불가」(§12.2)**: 실패로 돌리지 않고 **두 칸의 내용을 맞바꾼다**(다른 칸에 있던 유물을 고르면 자리 교환 · `RELIC_EQUIPPED` 두 번 → `PROFILE_CHANGED` 한 번). 같은 유물이 두 칸에 드는 상태는 생기지 않는다. `CmdResult.reason`에 이 경우에 맞는 값이 없고, 칸을 옮기려는 조작에 거절음이 나는 것보다 낫다고 봤다. 미보유는 `'locked'`, 모르는 id · 칸 번호는 `'invalid'`.
- **아무것도 바뀌지 않는 명령**(`equipWeapon(이미 든 무기)` · `equipRelic(칸, 이미 그 칸의 값)`)은 `{ok: true}`를 돌려주고 **이벤트를 내지 않는다**.
- **`previewLevelUp`**: `canAfford`는 상한이면 false(= 「지금 올릴 수 있는가」). 그 능력치가 상한이면 `after = before` · `changes = []` · `nextCost`는 지금 비용 그대로(전 능력치 상한일 때만 null). 모르는 `statId`는 던지지 않고 `maxed: false · canAfford: false · changes: []`.
- **`getShopItems`**: 품절 플라스크는 `price 0` · `valueNext = valueNow`(계약이 flask의 value를 수로 적어 null을 쓰지 않았다). 유물은 `level` 보유 1 / 미보유 0 · `maxLevel 1` · `soldOut = owned`. 플라스크의 `owned`는 항상 false.
- **`getWeaponInfo`의 `damageNow/Next`** = 무기 피해(`baseDamage × 강화 배율` = `StatBlock.weaponDamage`). 근력 배율은 넣지 않았다(무기끼리 비교하는 값). 최대 단계면 `damageNext = damageNow`.
- **`computeReward`의 `damageFraction`**은 받은 값을 0..1로 자른 그대로다(승리여도 1로 덮지 않는다). 승리를 f = 1로 보는 것은 구간 파편과 `bestFraction`뿐이다. 모르는 `bossId`는 던지지 않고 잔불 0 · 파편 0, `applyReward` · `noteAttempt`도 프로필에 새 보스를 만들지 않는다.
- **`sanitizeProfile`**은 계약의 목록만 한다(해금 상태를 추론해 메우지 않는다 — `makeTestProfile({cycle: 1})` 같은 프로필도 왕복 후 그대로다). 입력을 고치지 않고 새 객체를 준다.
- **v0 세이브**(§12.2 「임의의 옛 형태 하나」)는 P4가 정했다: 래퍼 없이 펼친 형태 + 옛 이름(`weapon` · `weaponLevels` · `flask{charges, heal}` · `relics` · `relicSlots` · `bosses[id].kills/.best`). `version`이 없으면 v0으로 본다. 정의는 `save.js`의 `migrateV0`.

## 추가한 것

- `data/stats.js`에 **`STATS.precision: 1e6`** 한 줄. StatBlock · 순환 배율 · 무기 피해를 1/precision 단위로 맞춰 부동소수 잡음(`1.1800000000000002`)이 UI에 그대로 찍히지 않게 한다. 표의 값은 소수 5자리 안이라 손실이 없다.
- 내부 파일 `sim/progression/num.js`(숫자 도우미). 추가 export: `stats.js`의 `weaponDamageAt(weaponId, level)` · `economy.js`의 `shardsLeftFor(bossProgress)` — `Progression`이 쓴다.

## 남의 파일

- W1 진행 중 `npm run build`가 `src/ui/UIRoot.js`(P8 작업 중 — `GatePanel` · `ResultPanel` export 없음)에서 멈춘다. P4 파일만 따로 번들하면 오류 · 경고 0이다.
- P4 테스트는 P1 소유 데이터(`PLAYER.base` · 무기 머리 필드)의 ±20% 조정에 깨지지 않게 기대값을 데이터에서 계산한다. 예외는 계약이 리터럴을 요구하는 「기본 StatBlock = `makeTestStats()`」 한 항목이다 — P1이 `PLAYER.base`나 장검 머리 필드를 바꾸면 이 항목과 `test/helpers.js`의 리터럴이 함께 어긋난다.
