# NOTES-P2 — sim-session (W1)

계약과 어긋나야 했던 곳 · 계약이 비어 있어 P2 가 정한 해석 · 다른 패키지가 알아야 할 것. 모두 P2 파일 안에서 해결했다(공개 이름 · 시그니처 · payload 는 계약 그대로).

## 다른 패키지가 맞춰야 할 것 (통합 게이트 확인)

1. **완료 경험치는 P2 가 준다** — `finishRift`가 `grantXp(ctx, round(XP.completeBonus × xpMul(L)), 'complete')`를 부른 뒤 요약 → `completeRun`. P6 `completeRun`은 완료 보너스를 다시 주지 않는다(§6.11 목록에 경험치가 없다).
2. **판 경험치 집계(`rift.stats.xp` · `meter.runXp`)는 P2 가 `grantXp` 결과의 `amount`로 더한다** — P6 `grantXp`는 이 둘을 건드리지 않는다(`addGold`는 계약대로 `rift.stats.gold` · `runGold`를 P6 가 더한다).
3. **`rift.stats.potions`는 P1 이 센다**(포션을 마시는 곳) — P2 는 마시는 순간을 모른다.
4. **apply* 는 데이터 값을 받는다** — `applyStun`(× `rank.stunMul` · 면역 창 · 연장 없음) · `applyKnock`(× `rank.knockMul` · 강인함/구조물/면역 창) · 빙결(× `rank.freezeMul`)은 status.js 가 곱한다. 부르는 쪽(P1 돌진 밀침 · P3 돌진 벽 기절)이 미리 곱하지 않는다 — 정예 짐승의 벽 기절도 `stunMul`을 받는다.
5. **기절 · 빙결 · 경직 · 넉백은 예비 공격을 취소하면서 그 몬스터 몸에 붙은 예고(`cancelOnSrcDeath` · 아직 hitAt 전)도 지운다**(end = tick) — 기절한 역병 덩어리 · 뼈 거인의 표식만 남아 터지는 「판정 주체가 몸과 따로」를 막는다.
6. **`addBuff`는 BUFF 를 내지 않는다**(§4.2 「P1(시전) · P2(끝남)」) — 시전한 P1 이 `BUFF{on:true}`를 낸다. 만료 · `removeBuff`는 P2 가 `BUFF{on:false}`(마력 보호막이면 `shield = 0` · 만료 때 `SHIELD{amount 0}`).
7. **감옥은 `spec.onHit.rootSec`를 실은 적대 효과로 만든다**(raw 0 이어도 된다) — 판정이 `hazardHitPlayer` → `rootPlayer` + `rootLockUntil`. H2 의 「묶는 예고가 진행 중」 판단도 이 필드로 한다.
8. **`canStartHazard(…, {shape})`(선택)** — 플레이어 자리가 아닌 위협(자기 중심 냉기 노바 · 원뿔 · 선)은 그 모양을 넘긴다. 없으면 (x, z) 점과 플레이어의 거리로 본다(nearR 3m · countR 4m).
9. **효과 `spec.shake`(선택 · 0..1)** 가 있으면 hitAt 판정에 `SHAKE{amp, sec: COMBAT.shakeSec}`를 낸다(§4.2 「P2(효과 판정)」의 진폭 자리).
10. **`PlayerHitSpec.tickHit`(선택)** — 참이면 적중 회복 상한을 `lohTargetsTick`(2)으로 센다(태그 `channel`도 같다). 비적대 효과의 지속 틱은 P2 가 틱마다 새 actionId 와 `tickHit`을 붙인다.
11. **`unloadCharacter`는 균열 기록(abandon)을 캐릭터에 넣은 뒤 떼어 낸다** — P9 `quitToTitle`은 부르기 전에 캐릭터 참조를 잡아 두었다가 뒤에 한 번 더 저장해야 기록이 남는다.
12. **`PICKUP_FAIL{reason:'full'}`** — 포션 상한에서 포션을 클릭해 주우면(`pickupDrop` 결과 `full`) 조용한 실패 대신 이 이벤트를 낸다(계약 payload 는 `bagFull`만 적었다).

## P2 가 정한 해석

- **위협 간격(§5.9)**: 진행 중 예고 = `start ≤ tick ≤ hitAt` 이고 판정 전(hitAt 틱 포함 — 몬스터 단계가 효과 판정보다 먼저라 이번 틱에 묶을 감옥이 아직 resolved 가 아니다). H2 에 「묶는 예고가 플레이어 발밑에서 진행 중이면 발밑 새 위협 금지」를 더했다 — 다른 팩의 표식이 감옥 예고 위에 겹쳐 묶인 채 맞는 것을 막는다(effects.test 의 대조 실험이 규칙을 끄면 생기는 것을 확인).
- **효과 끝 판정**: `end ≤ tick` 이고 (resolved 또는 `end ≤ hitAt`)면 끝/취소 — 정리 단계에 만든 delay 0 효과는 다음 틱에 판정하고, 판정 전에 `end = tick`으로 지운 예고는 판정하지 않는다. EFFECT_HIT 는 hitAt 에 한 번(spec · tickSpec 중 하나라도 있으면) — 지속 틱마다 내지 않는다.
- **투사체**: 한 틱 선분 전체로 겹침 · 수명 L틱이면 L번 움직이고 마지막 이동 틱에 expire. explode 가 있으면 관통이 남지 않은 접촉에서 폭발만(접촉한 몬스터도 원 안에서 한 번) · 벽 · 사거리 끝에서도 폭발 · EFFECT_HIT{kind: explode.visual}. 몬스터 투사체는 무시된 적중(도착 보호 · 도약 무적)이면 지나간다.
- **처치로 세는 것**: `lastHit.by === 'player'` 이고 noXp · noDrops · noGauge 를 다 세운 「스스로 사라짐」(역병 덩어리 폭발 · 완료 정리 — revived 는 예외)이 아니다. 전설 처치 훅도 같은 조건. 완료 정리로 사라지는 몬스터는 사망 훅(화염 강화 폭발 · 분열 사본)을 돌리지 않는다.
- **수호자**: `spawnGuardian`(P3)의 반환 값이 없으면 이번에 생긴 수호자 등급 몬스터를 찾고, 그래도 없으면 `spawnMonster`로 직접 세운다(판이 멈추지 않게). 완료 때 남은 적대 투사체 · 예고를 지운다.
- **안내 카드**: `char.hints[id]`가 없고 이 세션(캐릭터 객체)에 아직 내지 않았을 때만 HINT — 봇처럼 markHint 를 부르지 않아도 되풀이하지 않는다.
- 데이터에 「P2 W1」 값을 더했다(계약 값은 그대로): `COMBAT.shakeSec` · `PICKUP.dropPickR/dropPickH` · `COND` · `PROJ` · `SESSION` · `RIFT.guardianSpawnR/exitPortalTries/exploreEvery/checkpoint*/hintEvery`.
