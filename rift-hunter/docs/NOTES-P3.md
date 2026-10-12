# NOTES-P3 — sim-monsters (W1)

계약이 비어 있거나 어긋나 P3 파일 안에서 정한 것 · 다른 패키지(특히 P16 · P15 · 통합 게이트)가 알아야 할 것. 공개 이름 · 시그니처 · 이벤트 payload · 상태 필드는 계약 그대로다.

## 계약에 더한 공개 동작(호환 — 기존 시그니처는 그대로)

1. **속성 훅 `onHitPlayer(ctx, mon, row, st, res, spec)` — 여섯째 인자 `spec`(그 공격의 MonAttackSpec)**. §6.9 인터페이스에는 spec 이 없는데 화염 강화의 「같은 공격 피해의 30%」는 감소 전 raw 가 있어야 한다. `onDamaged`는 계약대로 `(…, hit, spec)`.
2. **`startAttack(ctx, mon, atkId, opts?)` → 예비 길이(초)** — 선택 `opts {act, facing, aim, lockAim}`(주술사 부활 act `channel` · 돌진 방향/끝점 고정 · 둥지 facing 유지). 반환 값을 그 틱 `spawnEffect`의 `delay`로 쓰면 `hitAt === actHit`(빠름 · 냉기 반영). 쿨다운(readyAt)은 모든 공격에서 ÷ 속성 atkSpeedMul.
3. **깰 때 훅 상태를 새로 만든다** — `wakeMonster`가 `ax.b = {move:'chase', spd:1, wokeAt}` · `ax[속성] = {}`(수호자 `ax.g`는 남긴다). 속성 훅의 「깬 뒤 first」는 첫 onAwakeTick 에서 `st.nextAt`이 없으면 잡는다(고정 상태처럼 미리 채운 st 는 그대로 쓴다).
4. **사라짐(act vanish)**: 프레임워크가 `actEnd` 틱에 `idle`로 돌리고 **그 틱의 생각 · 이동도 건너뛴다** — 훅(7단계)이 같은 틱에 자리를 옮긴다. act 가 이미 idle 이므로 훅은 자기 st(예: `st.vanishing`)로 「사라지는 중이었다」를 안다. 잠든 몬스터도 actEnd 가 지나면 idle(진정이 사라짐 도중에 와도 영원히 사라져 있지 않다).
5. **BEHAVIORS 행의 선택 `tickAttack(ctx, mon, def, atk) → boolean`** — 공격 중 매 틱 프레임워크 진행보다 먼저(돌진의 달리기). 수호자 impl 도 선택 `onDamaged(ctx, mon, def, hit)` · `tickAttack`을 두면 `guardian` 행동이 위임한다(마녀 시전 끊기 자리).
6. **spawn.js 도우미(훅 · 수호자 파일이 import 해도 되는 것)**: `attackOf · firstMelee · attackReady · isAttackAct · isPreHitAct · isDisabled · affixAtkMul · isGroundAttack · meleeStartOk · meleeHitOk · monSpec · strikeDefault · wakeMonster · sleepMonster · packOf · aliveMon · packRep · playerDist · seesPlayer(ctx, mon, props) · mcd`. packs.js 는 `minionAffixes · slotKinds`, monsters.js 는 `moveMul · chaseStop`도 낸다.
7. 이동 목표 `mon.ax.b.move`: `'chase' · 'flee' · 'kite' · 'hold' · {x, z}` — `kite`는 프레임워크가 행의 `params.keepMin/keepMax/backoff/backoffMul`로 푼다(시야(막는 소품 포함)가 없거나 멀면 chase · 가까우면 플레이어를 보며 뒷걸음). 잿빛 마녀(params keepMin 7 · keepMax 10)도 `b.move = 'kite'`면 된다.

## P3 가 정한 해석

- **흔들림(대지 분쇄)**: P2 NOTES 9 의 효과 `spec.shake`에 싣는다 → 판정 틱에 P2 가 `SHAKE`(기절로 취소된 예고는 흔들지 않는다). P3 는 SHAKE 를 따로 내지 않는다 — P2 가 이 필드를 없애면 boneGiant `strike`에서 내야 한다.
- **돌진 선 · 역병 덩어리 폭발도 `canStartHazard(ctx, -1, …, {srcId, shape})`를 거친다** — 속성 위협이 아니라 H1(팩 간격)은 없지만, H2(속박 중 발밑) · H4(겹침 상한) · 기절 출처를 지킨다(감옥에 묶인 채 돌진 · 폭발을 맞는 연쇄 금지).
- **냉기 노바는 플레이어가 `params.range`(8m — P3 W1 데이터) 안일 때만** — 화면 밖 표식 금지. 그 사이 타이머는 기다린다(다가오면 바로).
- **이동 배율은 monsters.js `moveMul`**(§5.8 규칙 그대로 — 기절/빙결 0 · 냉기 × 0.7 · 감속). status.js `monSpeedMul`과 같은 식을 P3 안에 둔 것(같은 웨이브 의존 없이 테스트). 규칙이 바뀌면 둘 다.
- **돌진**: 표식 길이는 `raycastWalk`로 벽 앞에서 자르고(보이는 위험 = 실제), 달리기 계획 길이는 자르지 않는다 → 벽에 박으면 `applyStun(wallStun)`(등급 배율은 status.js). 선분 겹침으로 한 번만 `monsterHitPlayer{via:'charge'}`.
- **둥지 새끼 자리**: 둥지 몸 가장자리에서 `params.rMin..rMax`(1.0~1.5m — §8.1 「둥지에서 1.0~1.5m」를 가장자리 기준으로 읽었다).
- **소인 도망 비율**: 각 소인이 처음 생각할 때 센 같은 팩 · 같은 종류 수(`ax.b.n0`)를 분모로 — 시체가 정리(6초)돼도 비율이 내려가지 않게.
- **주술사 부활 대상**: `revive.params.target`(데이터 'fallen') · 같은 팩이 아니어도 range 안 · 되살린 것은 그 시체의 팩(없으면 주술사 팩)에 든다.
- **궁수**: backoff(4m) 안 → 쏘지 않고 backoffMul 로 뒷걸음, 뒤가 막혔으면(계획의 MON.stuckFrac 미만) 쏜다 · 4~7m 는 준비되면 쏘고 아니면 물러난다.
- **populateRift**: 지도의 자리 종류를 따르되 riftRow 의 챔피언 · 정예 팩 수에 맞춘다(`slotKinds` — 남으면 normal · 모자라면 depth ≥ eliteMinDepth 인 깊은 normal 을 올린다).
- **수호자 속성**은 출현 때 `rng.ai`로 굴린다(채울 때 정할 상태 필드가 없다 — `rift.guardianType`만).

## 통합 · 밸런스 게이트가 볼 것(확인한 사실 — 값은 바꾸지 않았다)

- 실제 구현(P1 · P2 · P4 W1)으로 `scriptedClear`(봇 아님)를 돌리면 균열 1(시드 5 · 7 · 11)에서 전사 · 마법사 모두 **약 30~40초 안에 4번 죽어 붕괴**한다 — 방에 들어서면 시야(aggro 12~16m) + 팩 연결(8m)로 **40~50마리가 한꺼번에 깬다**(떼 순간 목표의 위쪽). 시작 전사 7.9 DPS 대 구울 할퀴기 3.0/1.15초 × 둘러싼 10여 마리. gameSim.test 의 W1 통합 검사는 `phase !== 'active'`도 통과로 보므로 막히지 않는다. 손잡이: `MonsterDef.aggro` · `MON.linkRadius` · `PACKS` 팩 크기 · 근접 `recover` — §7.14 산수(🔒 dmgBase · hp)와 함께 밸런스 게이트에서.
- 서 있는 플레이어에게 다가온 근접 몬스터의 휘두름은 헛치지 않는다(실제 GameSim · 393/393). 방패 해골 밀치기(push 1.2)가 섞이면 밀려난 플레이어에게 다른 몬스터의 예비 중인 휘두름이 빗나간다(정상 — 2%).
- 성능: 생성 맵(균열 5) · 깨어 있는 ~110 + 잠든 ~280 → `updateMonsters` 평균 0.9ms · `GameSim.step` 1.3ms(Node).
- 잿빛 마녀 impl 은 P16 자리(스텁 think) — W1 에서는 마녀가 쫓아오기만 하고 공격하지 않는다.
