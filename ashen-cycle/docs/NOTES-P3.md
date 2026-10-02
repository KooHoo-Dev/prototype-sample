# NOTES-P3 (sim-boss)

공개 시그니처 · 이벤트 이름 · payload · 상태 필드는 계약 그대로다. 아래는 계약과 달라진 한 곳, 계약의 빈 곳을 P3가 메운 것, 다른 패키지가 알아야 할 것.

## 계약과 다르게 한 것 (1건)

1. **연속기 확률이 0인 항목에는 `scaling.chainBonus`를 더하지 않는다.** §8.6의 식(`chance + chainBonus`) 그대로면 순환 1부터(보너스 0.15~0.30) 「2페이즈 전용 연속기」(`chance 0 / chanceP2 0.5` — 펜리르 `claw_swipe → bite`, 니힐 `void_orbs → beam_sweep`)가 1페이즈에 새어 나온다. §8.11의 "2페이즈의 차이"를 지키려고 0은 "그 페이즈에는 없다"로 읽었다(`bossAI.js` `pickChain`). 확률이 0보다 큰 항목은 식 그대로다.

## 계약의 빈 곳을 메운 것

- **내부 필드 `boss.fw` · `boss.attack.fw`**(§3.5에 없다 · 순수 값 · `structuredClone` 가능). 프레임워크 전용 기억(onCreate 호출 여부 · seq 카운터 · 고정 방향 L · 이동 진행 · 창별 반복 번호 · 이벤트 실행 횟수 · 연속기 횟수)이다. 다른 패키지는 읽지 않는다. `makeTestBoss`나 손수 만든 `attack` 리터럴처럼 `fw`가 없는 상태도 받는다(그 자리에서 만든다). `attack.fired`에는 **실제로 실행한** 이벤트 인덱스만 들어간다(`phase` 조건으로 건너뛴 것은 없다).
- **`BOSS_AI`에 이름 추가**(`data/bossCommon.js`): `teleportTries` · `validate.{windupMin, recoveryMin, hitEndEps, minDamagingP1, rangeMax, preferredBand}` — §8.5 · §8.9 본문의 숫자다. 기존 키와 값은 그대로.
- **텔레그래프 `style`** = 공격의 `glow`(`'none'`이면 `def.style`). `danger` 공격의 바닥 표식은 붉다.
- **`BOSS_STEP.heavy`** = `moveIntent`가 `approach` · `retreat`면 true, `strafe`면 false.
- **`select()` 0단계**: `player.hp <= 0`도 사망으로 본다(P2의 승패 판정이 HP 기준). `state.fight`가 null이면 교전 중으로 본다(손수 만든 상태).
- **쿨다운 · `lastAttacks`** 는 공격이 시작되는 모든 경로(AI 선택 · `forceAttack` · fallback · 연속기)에서 갱신한다(`sel`이 있을 때 쿨다운). "쿨다운 무시"는 시작 조건만이다.
- **`chain[].at`** 은 배속을 받지 않는 초다. 후딜이 `at`에 닿은 항목을 배열 순서대로 한 번씩 본다(거리 조건에 걸린 항목은 난수를 쓰지 않는다). 연속기 판정은 플레이어가 살아 있고 `fight.phase === 'fight'`일 때만 한다.
- **방향 · 조준점 고정은 틱 경계**에서 일어난다: `tA ≥ −lockLead`가 되는 첫 틱에 그 틱의 회전까지 하고 고정한다(조준점도 같다 — leap은 `aimLock`).
- **`leap`** 은 매 틱 "남은 거리의 `(u1 − u0)/(1 − u0)`"만큼 간다(방해가 없으면 선형 보간과 같다 · 조준점이 `aimLock` 전에 움직여도 `t1`에 정확히 닿는다). 고정 전의 조준점에도 `dist` 상한을 건다(표식이 실제 착지 자리를 따라간다). 공격이 끊기거나 끝나면 `height`가 있는 이동은 `boss.y = 0`으로 돌린다(부유 보스는 훅의 `onTick`이 다시 올린다).
- **배속으로 예고가 줄어 `move.t0`가 공격 시작보다 앞서면** 남은 구간에 전체 이동을 눌러 담는다(거리는 줄지 않는다). 타임라인 이벤트는 첫 틱에 실행된다.
- **이벤트 `count`** 는 `projectile` · `hazard`에만 뜻이 있다. `place`가 없으면 `'self'`. `scatter` · `chase` · `target` · `aim` · `ringAround`의 위치는 `world.radius` 안으로 당긴다. `ringAround`는 `boss.facing`에서 시작해 균등, 장판의 facing은 바깥쪽. 그 밖의 장판 facing은 `boss.facing`.
- **순간이동**은 `prevFacing`도 덮어쓴다(회전 보간이 튀지 않게). 목적지를 끝내 못 찾으면(`teleportTries`번) 제자리에 남고 `BOSS_TELEPORT`는 from = to로 나간다.
- **훅**: `onTick`은 `dead`를 포함한 모든 상태에서 매 틱 불린다. `forceAttack`은 선택 시점(idle 끝 · chase의 0.3초마다)에만 불린다 — 없는 id를 주면 무시하고 평소대로 고른다. `adjustWeights`는 후보가 비어 있어도 불리고, 후보를 추가해도 된다. `onAttackEnd(ctx, atk)`가 불릴 때 `boss.attack`은 이미 null이다(연속기면 다음 공격이 시작되기 직전).
- **`dmgMul` · `speedMul`** 은 `createBossState`와 페이즈 전환 때만 쓴다(매 틱 다시 계산하지 않는다). 테스트가 `boss.phase = 2`를 직접 쓰면 배율은 따로 넣어야 한다.
- **`validateBossDef`는 §3.5 · §3.6의 필수 필드를 전부 본다**: `BossHitDef`의 `interval` · `guardable` · `parryable` · `knockdown` · `telegraph`, `HazardSpec`의 `interval` · `guardable` · `knockdown`, `ProjectileSpec` 전 필드. 표에 안 적힌 값(`interval: 0` · `telegraph: false`)도 데이터에는 써야 한다. §8.11 · §8.12의 표를 그대로 옮긴 정의는 통과한다(임시 파일로 확인 — 두 보스 모두 프레임워크 수정 없이 120초 돈다).

## W3에서 볼 것

- **돌진(`charge`)과 몸통 밀어내기**: 방향 고정 뒤에도 정확히 일직선에 서 있는(= 가드로 받는) 플레이어는 보스가 "지나치지" 못하고 돌진이 끝날 때까지 앞으로 밀고 간다(§5.1 G3의 밀어내기가 중심선 방향이라서). 피해는 한 번뿐이고 옆으로 한 걸음만 벗어나도 지나친다. 어색하면 P2의 G3에서 돌진 중 옆으로 밀게 하는 편이 맞다(P3 쪽에서 고칠 수 없다).
- **발더 1페이즈의 5~6m 공백**(§8.10 표 그대로): 그 거리를 유지하며 뒤로 걷는 플레이어(걷기 5.0 > 보스 3.2 m/s)에게는 3초마다 fallback `thrust_charge`만 나온다. 플레이어에게 이득이 없는 자리라 값을 건드리지 않았다.
- **옆구리 각 1.2~1.4 rad**: `slash_r`(≤ 1.2)와 `spin_slash`(≥ 1.4) 사이는 후보가 없다. idle · chase의 회전(3.5 rad/s)이 곧바로 풀어 주므로 그대로 뒀다.

## 수치

`data/bosses/valder.js`는 §8.10의 표 그대로다(조정 없음). `BOSS_AI`의 계약 값도 그대로다.
