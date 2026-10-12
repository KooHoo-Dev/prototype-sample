# NOTES-P6 — progression (W1)

공개 이름 · 시그니처 · 이벤트 payload 는 계약 그대로다. 아래는 계약이 비었거나 어긋나 P6 파일 안에서 정한 것과, 다른 패키지가 알아야 할 것.

## 계약과 다르게(보수적으로) 정한 것

1. **재굴림 후보는 파생 난수**(`hash32(char.seed, 아이템 번호, rerolls, affixIdx, SEED_SALT.reroll)`)로 굴린다 — §5.14 표의 `rng.shop`이 아니다. 「취소 무료」와 `rng.shop`을 같이 쓰면 제안 → 취소 → 제안으로 새 후보를 공짜로 계속 볼 수 있고(재굴림이 사냥을 앞지른다), 새로 고침(세션 시드가 바뀜)으로도 같은 일이 된다. 지금은 같은 아이템 · 횟수 · 옵션 칸이면 같은 후보다(테스트 고정). 결제 · 고정 · 횟수 증가는 계약 그대로.
2. **망각의 정수 시점** — 식(`rerolls ≥ essenceFrom(3)` = 그 아이템의 **4번째** 재굴림부터)을 따랐다. §10.6 문장 「3번째부터 망각의 정수」와 한 번 어긋난다 — P11 패널은 `priceReroll(item).essence`를 그대로 보이면 된다(문면만 맞추면 됨).
3. **`DURABILITY.broken`** = 사망 대가 뒤 내구도 0 인 장착 칸 **전부**(이번에 새로 부서진 것만이 아니다) · `fraction` = 이번에 깎인 비율(`deathDurLoss / durMax` = 0.1).
4. **레벨업의 「자원 가득」** — 계약 문자 그대로 `resource = resourceMax`(분노도 100). 쓰러져 있으면 생명 · 자원을 채우지 않는다.

## 다른 패키지가 알아야 할 것

- **P2**: `grantXp` 결과의 `amount`는 **실제로 쌓인 양**(캡 30에서 버린 것은 빠진다) — 판 집계(`rift.stats.xp` · `runXp`)는 계약대로 P2가 이 값으로 더한다(P6은 건드리지 않는다). `addGold`는 `scene === 'rift'`일 때만 `rift.stats.gold` · `meter.runGold`에 더한다. `completeRun`도 `SAVE_REQUEST{char,'complete'}`를 낸다(P2의 것과 겹쳐도 app이 한 프레임에 한 번 쓴다). `LEVEL_UP`은 grantXp 한 번에 한 번(마지막 레벨) · `HINT skills`는 `char.hints.skills`가 없으면 레벨업마다.
- **P9(app · storage)**: `loadAccount` · `loadChar`는 계약 필드에 `future:boolean`을 더 준다(미래 버전 — 읽기만 · 덮어쓰지 않는다 · `reason 'future'`). broken 사유는 `json · shape · game · version · class`. `rebuildAccount`가 돌려준 `chars`는 ID 정리로 바뀌었을 수 있다 — 계정과 함께 **다시 써야** 한다. `serializeAccount`는 지금 캐릭터의 칸 요약을 지금 값으로 쓰고 `nextItemId`를 가진 번호의 최대 + 1 이상으로 쓴다(계정이 캐릭터보다 낡아도 다시 읽은 뒤 ID 충돌 0 — 테스트).
- **P10 · P11(ui)**: 실패 사유는 부록 A 그대로(`reason.level`은 `params.n` · `canLearn`의 `tier`는 `params.n` = 더 써야 할 점수 · `req`는 `params.nodeId`). `TRADE.kind` = `buy sell sellMany buyback repair salvage salvageMany craft gamble reroll potion scroll free reset` · 판 곳(`shop`)은 팔기 · 되사기면 `town.lastInteract`(잡화상이면 general · 그 밖 blacksmith). `GOLD` · `MATERIALS`는 바뀐 양이 있을 때만 낸다(쓸 때 delta 음수). `buyPotions` · `buyScrolls`는 골드가 되는 만큼만 산다(`{bought, cost, partial}`) · `rerollOffer`는 비용이 모자라면 미리 `'gold'` · `'materials'` · 제안이 없을 때 `rerollCancel`은 `'noOffer'` · `repairAll` 성공은 늘 `{partial, repaired, cost}` · `sellMany`/`salvageMany`는 `{sold|salvaged, skipped, gold|materials}` · 하나도 못 하면 `'nothing'`. 장착은 가방에서만(`ref.where 'bag'` — 보관함은 `moveItem`으로 먼저). `moveItem`의 `to.idx`가 없으면(또는 -1) 그쪽의 빈 첫 칸. `sortStash`는 마을에서만.
- **P15(bot)**: 상점 명령은 전부 `scene !== 'town'`이면 `'notInTown'`. 재고는 `char.runs`가 바뀐 뒤 처음 마을에 올 때 한 번(`restockShops` — P2가 부른다).
- **P5**: `gambleOdds`의 후보 규칙(그 부위의 자기 클래스 · 공용 전설 / 자기 클래스 세트 조각)은 `specialCandidates(r, {slot, cls})`와 지금 데이터에서 18칸 모두 같다(직접 대조 — 테스트는 P5 구현에 기대지 않으려고 P6 쪽 규칙만 본다). 도박은 등급을 P6이 정해서 넘기므로 `rollGear`의 「후보 없음 → 희귀」가 돌 일이 없다 — 통합에서 규칙이 갈라지면 `specialCandidates`를 쓰게 바꾸면 된다.

## 더한 export(계약에 없음 · 다른 패키지가 써도 된다)

`inventory.js`: `spendGold` · `spendMaterials` · `hasMaterials`(빼기 — 모자라면 아무것도 바꾸지 않고 false) · `itemIdNum` · `eachCharItem` · `compareItems`(정렬 순서) · `slotKeyOf` · `itemRepairRaw` / `shops.js`: `gambleRarity(rng, char, slot)` / `progress.js`: `applyLearn(char, nodeId)`(검사 없이 한 랭크 + 자동 배치) / `character.js`: `syncSummary(state)` / `data/economy.js`: `REPAIR_ORDER` · `DEV` · `SEED_SALT`.

## 정화(save) 규칙 요약

모르는 기본형 → 아이템 버림 · 모르는 옵션 · 범위 밖 티어 · 숫자 아닌 값 · `param` 없는 skillPct는 그 옵션만 뺀다 · 부위 · 클래스 · 요구 레벨 · 가치는 `makeItem`으로 다시 계산(고쳐 쓴 판매가로 이득을 못 본다) · 되사기 값 = `priceSell` · 전설/세트 ID가 기본형과 안 맞으면 희귀 · 스킬 배분이 레벨 포인트 · 단계 · req를 어기면 전부 돌려준다 · 부위 · 클래스가 안 맞는 장착과 양손 + 보조의 보조는 가방으로(빈칸이 없으면 버린다).
