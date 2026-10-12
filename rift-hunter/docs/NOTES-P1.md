# NOTES-P1 — sim-player (W1)

계약과 어긋나거나 계약이 비어 있어 P1 파일 안에서 정한 것 · 통합 때 볼 것. 공개 API · 이벤트 · 상태 필드 이름은 계약 그대로다.

## 통합 때 정할 것(남의 파일)

1. **꿰뚫는 화염(`piercingFlame`)** — 전설 문면(§7.9)은 「관통하며 맞힐 때마다 폭발」인데, P2 `projectiles.js`(W1)는 관통이 남은 접촉에는 `spec` 적중만 하고 폭발은 관통이 다 떨어진 접촉 · 벽 · 사거리 끝에서 한 번이다. P1은 `pierce: 3` · `spec`(= `explode.spec`과 같은 정의) · `explode {r 2.5}`를 넣는다. 「매 접촉 폭발」이 맞다면 P2가 `explode && pierce > 0`인 접촉에서도 `explodeProj`를 부르면 된다(접촉 대상은 폭발 원 안이라 `spec`을 따로 쓰지 않는다).
2. **경로 탐색 스텁** — P4 `findPath`가 아직 직선 스텁이면 기둥 정면을 사이에 둔 대상에게 다가가다 멈춘다(마법사가 기둥 너머로 쏘지 않게 시야를 소품까지 보도록 바꿨기 때문 — 아래 5). P4의 A*가 들어오면 돌아간다 — 통합 게이트에서 `?fixture` 기둥 방 · 마법사로 한 번 본다.
3. **`stomp`(여진) 효과의 예고 구간** — §5.4는 「예고 없이 판정만」이지만 상태로 남기려고 `delay 0.5`의 효과로 만든다(`[start, hitAt)`가 생긴다). P13은 `kind 'stomp'`의 예고 고리를 그리지 않는다(판정 순간만).

## P1 파일 안에서 정한 해석

4. **소모** — 포션 · 두루마리를 쓰면 P1이 `char.potions` · `char.scrolls`를 직접 −1 한다(§5.5). §6.11은 그 필드를 P6 파일만 고친다고 하지만 `addConsumable`은 n ≥ 0만 받는다(더하는 곳은 P6 그대로). 포션을 마시면 균열에서 `rift.stats.potions += 1`(RunStats 에 주인이 없다).
5. **원거리 사거리 · 연쇄 번개 대상의 시야는 막는 소품까지**(`losClear(…, {props:true})`) — §5.2-5는 `nav.losClear`라고만 한다. P2 투사체는 내비 막힘(소품 포함)에서 끝나므로 벽만 보면 마법사가 기둥에 화살을 계속 쏜다(e2e 스모크: 846발 중 587발이 'wall' → 고친 뒤 0).
6. **돌진의 옆 밀침** — 넉백 방향은 `(srcX, srcZ) → 몬스터`라서 몬스터마다 선의 반대편 1m를 `srcX/srcZ`로 둔다(§5.4 「각 몬스터가 선의 어느 쪽인지로 부호」). 같은 필드를 P2가 방패 정면 판정에도 쓰므로, 방패 해골은 돌진 선과 직각으로 서 있을 때만 막는다.
7. **잠긴 동안의 드랍 · 물체 클릭은 의도(intent)로** — `Buffered.kind`에 줍기 · 상호작용이 없다. 의도가 남아 행동이 끝난 틱부터 걸어간다(같은 효과 · 새 입력이 버퍼를 지운다).
8. **기본 공격 클릭** — 탭(누르고 곧 뗌)은 걸어가서 한 번만 휘두른다 · 누르고 있으면 반복 · 휘두르는 중에 떼면 그 휘두름으로 끝(§5.2-4). 대상이 휘두름 판정 전에 사거리를 벗어나면 제자리 원뿔(70°) 안의 가장 가까운 몬스터를 친다(떼 속 헛스윙을 줄인다).
9. **처치 사건 효과(얼음 폭발 · 시체 폭발)의 판정은 다음 틱**(`delay` 한 틱) — `resolveDeaths`(§5.1-7)가 `updateEffects`(6) 뒤라서.
10. **`player/skills.js` → `sim/conds.js`** import(광전사 공격 속도는 행동 시작 때 `CONDS[cond](ctx, null)` — §5.3) — §2.2의 player/* 목록에 없지만 순환은 없다(purity 통과).
11. 마을 상호작용 도착 때 `town.lastInteract = 물체 ID`(TownState 는 P2 소유 — 덮어쓰기만).
12. 채널 틱 적중 정의에 `tickHit: true`를 더한다(태그 `channel`과 같은 뜻 — P2가 적중 회복 상한 `lohTargetsTick`에 쓴다).

## 데이터(내 파일)에 더한 것 — 🔒 값은 건드리지 않았다

- `data/classes.js`: `PLAYER.recallSec 1.5 · noCursorDist 3 · failGapSec 0.5 · shakeSec 0.25 · combatSec 3 · shoveSide 0.6` · `SHOVE {ranks: normal minion split spawn, blockTags: structure}`.
- `data/skills.js` params(패치 키 아님): 연출 ID `fx · fxAftershock · fxShockwave · fxVortex · fxBlast · visual · visualSplit · visualShard` · 메테오 `fallDist 6` · 연쇄 번개 `arcSec 0.2` · 얼음 파편 patch `pierce 20`(「관통」).
