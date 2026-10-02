# NOTES-P4 (progression) — W1

소유: `data/baits.js` · `data/gear.js` · `data/skills.js` · `data/economy.js` · `sim/progression/{profile,modifiers,economy,progress,save}.js` · `test/{progression,economy,save}.test.js`.

## 데이터에 더한 것(`data/economy.js` — 계약 값은 그대로)

- `LOSS.rodBreakDragFrac 0.9` — §5.6 「드랙이 0.9 × 새 rodMaxLoadKg 를 넘으면」의 0.9.
- `SHOP.maxQty 99` — §6.7 `buy` qty 1..99.
- `LIMITS {ownedMax 99, baitMax 9999, moneyMax 1e12, xpMax 1e9, statMax 1e9}` — sanitize · 구매 상한(세이브 손상 · 오버플로).
- `SETTINGS_RANGE` — §3.7 설정 범위(mouseSens 0.2..3 · fov 60..90 · quality · volume 키). `data/settings.js`는 P5 소유라 여기 두었다.

## 더한 export(계약에 없는 것 — 이름은 바꾸지 않았다)

- `modifiers.js`: `SKILL_MAX_RANK`(= 3, SKILLS 의 효과 배열에서 센다) · `skillRank(profile, id)`(0..3 로 자른 정수).
- `progress.js`: `cumulativeXp(level)`(누적 L5 657 · L10 3,863 · L20 21,116).
- `profile.js`: `tier1Gear(slot, set)`(그 슬롯 · 세트의 1단계 장비 ID — 데이터에서 찾는다).

## 계약 해석(내 파일 안에서 정한 것)

1. **무료 미끼는 두 세트의 미끼를 지렁이로 바꾼다.** 조건이 「미끼가 하나도 없다」라서, 세트의 미끼가 떡밥이면 지렁이를 줘도 rig 의 `canCast`(세트 미끼 재고)가 계속 `noBait` 다 — 「돈이 없어도 막히지 않는다」(§5.6)를 지키려고 바꿨다.
2. **`stats.lost`** 는 `applyLoss` 가 물고기를 놓친 실패(lineBreak · spoolEmpty · rodBreak · hookOff)에서만 +1(헛챔질 · 늦음은 세지 않는다). 계약에 누가 올리는지 없었다.
3. **`DexEntry.trophies` · `legends`** 는 배타적으로 센다(레전드는 trophies 에 넣지 않는다). `best` 는 normal < trophy < legend.
4. **`SkillPreview.rank`** = 지금 랭크 · `after` = 한 단계 위(최고 단계면 before 와 같은 값) · `ok/reason` = `learnSkill` 판정(invalid · maxRank · noPoints).
5. **빈 어창 `sellAll`** → `{ok:true, count:0, total:0}` · 이벤트 없음(집 도착 자동 판매에서 빈 SOLD 가 뜨지 않게).
6. **이미 끼운 장비 `equip` · 같은 미끼 `setBait` · 가득인 같은 라인 `refillLine`** → `{ok:true}`(감기는 `cost 0 · meters 0`) · 이벤트 · 저장 요청 없음.
7. **작은 릴로 바꾸면** `lineM = min(lineM, 새 capacityM)`(SetConfig 의 `lineM ≤ 릴 capacityM` 유지 — 넘치는 라인은 버린다). 드랙 kg 보존 눈금은 §7.7 그대로.
8. **`buy('refill_<set>_<lineId>')`** 는 `refillLine` 에 넘긴다(결과 `{cost, meters}` · 이벤트는 `LINE_REFILLED` — `BOUGHT` 아님). 상점 항목 id 를 그대로 `buy` 에 넘겨도 되게.
9. **`refillLine` 의 `free`** 는 1단계 라인(`line_1`)에만 적용한다(다른 라인에 free 를 넘겨도 값을 받는다).
10. **로드 파손**: 1단계 로드가 부러져도 `rodLost` = 그 로드 ID(예비 1단계로 바뀐다 — 알림이 「예비 로드」를 보이게). 드랙 낮추기는 상한 이하의 가장 큰 눈금(부동소수 경계 보정).
11. **`applyLoss` 의 `baitId`** 가 없거나 모르는 ID 면 미끼 손실 없음(`baitLost false`) · 보고의 `baitId` 는 세트의 미끼. 환불 굴림은 확률 > 0 일 때만 `ctx.rng` 를 쓴다.
12. **`tackleCost`** 는 실제로 깎인 액수(돈이 모자라면 0 까지만 — `-0` 아님). `MONEY_CHANGED` 는 돈이 실제로 바뀌었을 때만.
13. **`parseSave`**: version 이 수가 아니거나 없으면 `'fields'`. 모르는 씬 · 레벨이 모자란 스테이지는 `'home'`으로(불러오면 그 씬 spawn 에서 걷기 — 잠긴 스테이지에 서지 않게). seed 는 `>>> 0`, day ≥ 1, tickInDay 0..215999 로 자른다. `migrateSave` 는 `MIGRATIONS` 표(지금 비어 있다)를 차례로 — v0 은 올릴 길이 없어 null → `'fields'`.
14. **`createSaveData`** 는 result 단계에서 pendingCatch 를 프로필 **사본**에 반영한다(어창에 같은 uid 가 이미 있으면 다시 넣지 않는다).
15. **`sanitizeProfile`**: 스킬 포인트 ≤ (시작 1 + (레벨 − 1)) − 쓴 포인트 · xpTotal ≥ 그 레벨까지의 누적 + xp · 보유 수보다 많이 끼운 2·3단계 장비는 1단계로(같은 릴 하나를 두 세트가 끼운 세이브 → 바닥 세트는 reel_1) · 어창은 모양이 맞는 기록만 uid 중복 없이 12개까지 · nextUid > 어창 uid.

## 계약의 모순 · 통합 때 볼 것

1. **`test/rig.test.js`(P1)의 `createAngler … keep 을 50번`이 실제 `applyCatch` 위에서 실패한다**(`bottom: 50판을 다 돌지 못했다(46)`). 테스트는 W0 스텁(`applyCatch` = 상태 변화 없음 → 어창이 차지 않음)에 기대고 있다. 실제로는 12마리 뒤 어창이 차고, 봇은 계약대로 「가장 싼 것보다 비쌀 때만 swap, 아니면 release」 → keepCatch 횟수가 50에 못 미친다. P4 는 계약대로다 → P1(통합 수정): keep + release 를 세거나, 테스트의 fixture 에서 어창을 비운다.
2. **집의 라인 감기 가격**: `shopList(profile, mods)`는 씬을 모른다 → `refill_*_line_1` 항목 가격이 집에서도 판매상 단가(m × 5원)로 나온다. 실제 `GameSim.refillLine` 은 집에서 무료다. → P3 `getShop()`(집이면 그 항목 `price 0`) 또는 P8(PC 패널에서 line_1 은 「무료」)로 맞출 것. 집에 오면 line_1 은 자동으로 가득 감기므로 실제로 눌릴 일은 드물다.
3. **가득인 같은 라인의 상점 항목 사유**: 부록 B 에 「이미 가득」 키가 없어 `reason 'same'`(「이미 여기다」)을 썼다. → P8 이 `reason.full`(예: 「이미 가득 감겨 있다」)을 더하면 economy.js 의 `'same'` 한 곳을 바꾼다.
4. `test/fixtures.test.js` 「helpers: 리터럴이 실제 함수 · 계약 모양과 같다」의 실패는 시계 `light`(P3) — 이 패키지와 무관(내 몫인 makeTestProfile · makeTestMods · makeTestRigStats 비교는 그 앞에서 통과한다).

## 확인하지 못한 것

- 실제 GameSim(P3) · rig(P1) 위에서 손실 → `RIG_RESTORED` → 1.7초 재캐스팅이 예비 스풀과 함께 도는지(내 테스트는 §5.2 의 재고 판정 식으로만 본다) — 통합 · 헤드리스에서.
- 진행 봇 기준의 경제 측정(M9 · M16 — 하루 수입 · 3단계 완비 일수)은 P10 measure.
