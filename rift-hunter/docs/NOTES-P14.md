# NOTES-P14 — audio (W2)

소유: `src/audio/AudioEngine.js` · `src/audio/sounds.js`(폴더 소유 §1.3 — 내부 파일: 소리 표 · 손잡이) · `test/audio.test.js`.
공개 API(`constructor({bus, settings})` · `unlock` · `update(state, dtReal)` · `setPaused(on)` · `applySettings` · `stats() → {voices, nodes}` · `dispose`)는 계약 §6.15 그대로다. 계약 밖으로 더한 것은 테스트 · 디버그용 `debugStats()` 하나(종류별 · 소리별 발음 수 · 루프 · 합침/밀림/버림/예외 수 — `stats()`의 모양은 바꾸지 않았다).

## 계약 해석(내 파일 안에서 정함)

1. **일시정지 둘** — `setPaused(true)`(app — 탭 숨김) = 모든 소리를 바로 끊고 `suspend` · 이벤트 무시. `PAUSED{menu|modal|blur|debug|context}` = 「메뉴 일시정지」: 전투 지속음(회오리 · 귀환 시전 · 심장 박동)은 멎고 환경음은 `MIX.ambPauseDuck`(0.35)배 · **UI · 거래 · 실패음은 그대로 난다**(상점 · 사망 패널도 `modal` — NOTES-P9 [P14]). `PAUSED{hidden}`만 오고 app 이 `setPaused`를 부르지 않아도 멎고, 다음 PAUSED 에서 풀린다(app 이 부른 `setPaused(true)`는 app 의 `setPaused(false)`만 푼다).
2. **지속음은 상태가 정본**(§4.1 이벤트 누락 안전) — 회오리 = `scene==='rift' && player.channel && !player.dead`, 귀환 시전 = `player.recall`(남은 시간 · 진행한 활강 자리에서 이어 감), 환경음 = `scene`(town → 타일셋 `town`) · `rift.tileset` → `data/tilesets.js`의 `ambience`(표에 없는 ID면 소리 없음). `CHANNEL` · `RECALL` 이벤트는 바로 켜고 끄는 지름길이고 `update`가 프레임마다 맞춘다. `SCENE_CHANGED` · `PLAYER_DIED` · `CHAR_LOADED` · `SCREEN_CHANGED`에서 회오리 · 귀환 시전을 바로 끊는다(페이드 0.12초). 환경음은 다음 `update`에서 새 장면 것으로 교차 페이드(0.8초).
3. **수호자 출현음** — `GUARDIAN_APPEAR`는 그 플러시에서 내지 않고 다음 `update`에서 `state.scene==='rift'`일 때만 낸다 · `SCENE_CHANGED`가 미뤄 둔 것을 지운다(부활 commit 플러시에서 마을 소리 금지 — §4.2 W1 수정 4).
4. **합치기** — 「같은 종류 30ms」의 종류 = 소리 ID. 같은 위협을 `AFFIX`와 `EFFECT_SPAWN`이 함께 알리면(감옥 · 몰타르 · 냉기 노바 · 화염 사망) 같은 소리 ID라 한 번만 난다.
5. **몰림 줄이기(계약에 없는 것)** — 0.06초 안에 4개를 넘게 시작하면 그 뒤 소리는 `(4/n)^0.6`배(바닥 0.3) · 몰려 있을 때는 합쳐도 키우지 않는다. 우선순위 5(고유 예고 · 정예 경보 · 전설/세트 종 · 레벨업 · 사망 · 수호자)는 줄이지 않는다 — 떼 속에서도 위협과 보상이 또렷하다.
6. **멈춘 컨텍스트** — `ctx.state !== 'running'`(활성화 전 · resume 거절 · interrupted)이면 한 번 나는 소리를 예약하지 않는다(시계가 서 있어 깨어날 때 한꺼번에 터진다 — 실제 Chromium 에서 확인). 멈춰 있으면 `update`가 실제 시간 1초마다 `resume()`을 다시 부른다(app 의 `unlock`은 첫 제스처 한 번뿐).
7. **예외가 게임을 멈추지 않는다** — 소리 · 루프를 짓다 브라우저 예외가 나면 반쯤 지은 노드를 끊고 세고(`debugStats().errors`) 처음 한 번만 `console.warn('[audio] …')`. 버스는 리스너 예외를 삼키지 않아 sim 플러시가 끊기기 때문이다. 테스트의 가짜 WebAudio 는 브라우저 규칙(유한수 · 지수 램프 양수 · 소스 한 번 시작 · start 전 stop 금지)을 검사하고, 퍼즈 · 실제 sim 테스트가 `errors === 0`을 본다.
8. **UI 볼륨** — 설정에 UI 볼륨이 없다 → UI 버스 = `volSfx × MIX.ui`.
9. **공간** — 듣는 자리 = `player.pos`(update) · `PLAYER_SPAWNED`. 8m 안 크기 1 → 32m 에서 0.3 · 44m 밖의 낮은 우선순위(피격 · 사망 · 발사 · 휘두름 · 드랍)는 내지 않는다 · 화면 좌우(월드 (1,0,−1)/√2)로 팬 ±0.6. 위치 없는 이벤트(플레이어 · UI · 경보 · 빙결)는 가운데.

## 계약 문제 · 다른 패키지가 볼 것

- **[계약 §6.12 · P3] 상태 읽기 범위** — §6.12는 audio 가 `state.scene` · `rift.tileset` · `player.channel`만 읽는다고 하지만 §9.11 이 `player.recall`을, §9.9 가 「템플릿별 피격」 · 「정예 예고음은 크게」를 요구한다. `MON_ACT` · `HIT` · `MON_STRIKE` payload 에 등급 · 템플릿이 없어서, audio 는 **처음 보는 몬스터 ID 마다 한 번** `state.rift.mons`에서 `{typeId, rank}`를 읽어 캐시한다(읽기만 · `MAP_LOADED` · `RIFT_CLOSED`에서 비움). 그 밖에 `player.pos` · `player.lowLife` · `player.dead`를 읽는다. 통합 때 §6.12 문장을 넓히거나, P3 가 `MON_ACT`에 `rank`를 실으면 그 읽기를 뺄 수 있다.
- **[P10 · P11] 일반 UI 클릭 소리** — 버튼 클릭 이벤트가 계약에 없다. 지금 딸깍은 `PANEL_OPENED/CLOSED`(by ≠ code) · `BAG{move|sort|stash}` · `SKILLS` · `SETTINGS_CHANGED` · `TRADE` · 실패음으로만 난다(균열석 레벨 고르기 같은 단순 버튼은 조용하다). 원하면 계약에 `EV.UI_CLICK` 같은 즉시 이벤트를 더하는 것이 깔끔하다.
- **[P16]** 감옥 · 몰타르 · 역병 · 순간이동 · 분열 · 번개 불꽃 예고음은 `AFFIX.what`(`jailWarn` · `mortarFire` · `plagueWarn` · `teleportOut/In` · `split` · `sparks`)이나 적대 효과 `EFFECT_SPAWN{kind: jail|mortar|plague}` 중 하나만 와도 난다(같은 ID — 둘 다 와도 한 번).
- **[P9]** `audio.update`는 지금처럼 렌더 프레임마다(일시정지 · 히트스톱 중에도) 부르면 된다. `applySettings` 직접 호출과 `SETTINGS_CHANGED` 둘 다 와도 된다(멱등).

## 실측 — 실제 헤드리스 Chromium WebAudio(자동 재생 허용 · 기본 볼륨 · 리미터 뒤 AudioWorklet 계량 · 50ms RMS 최대, dBFS)

| 무엇 | RMS | 피크 |
|---|---|---|
| 환경음(마을 모닥불 · 묘지 바람 · 동굴 용암) | −28.3 · −30.1 · −29.3 | ≤ −8 |
| 회오리 루프 · 귀환 시전 | −20.1 · −17.6 | −8.8 |
| 몬스터 피격 넷(물리 · 화염 · 냉기 · 번개) | −21.0 · −21.7 · −21.9 · −21.9 | ≤ −4 |
| 몬스터 사망(템플릿 다섯) | −19.5 ~ −22.7 | |
| 고유 예고(몰타르 · 냉기 노바 · 감옥 · 보호막) | −14.8 · −15.2 · −16.5 · −17.1 | |
| 몬스터 공격 예고(자세 · 조준선 · 돌진 선 · 바닥 원) | −29.1 · −29.7 · −21.7 · −21.6 | |
| 전설 · 세트 종 | −12.4 · −13.4 | |
| 단일 피격 / **40마리 동시 피격** / 40마리 피격 × 50ms 마다(초당 800) | −19.2 / **−19.4** / −16.8 | −6.0 / −3.2 / −3.0 |
| 지면 강타 하나 / 떼 한가운데 회오리(예고 · 휘두름 · 피격 · 플레이어 피격 · 감옥) | −15.6 / −16.3 | −5.6 / −3.1 |
| 극단: 40마리 처치 + 드랍 40(전설 8 · 세트 8) 한꺼번에 | −11.9 | −2.9 |

- 위 시나리오 뒤 소리가 끝나면 노드가 환경음 루프만큼(16)으로 돌아왔다 · 예외 0 · 경고 0. 실제 게임 페이지(dev 서버 · 정예 팩 · 무적 · 처치 · 전설/세트 드랍 · 완료 · 마을)에서도 예외 0 · 경고 0.
- 브라우저 측정 스크립트는 `docs/_scratch/p14/`(지웠다).

## 사람이 확인할 것(이 환경에서 들을 수 없다)

한 판: `npm.cmd --prefix rift-hunter run dev` → 아래 주소 → 아무 키나 눌러 소리를 켠다(첫 제스처) → 콘솔의 `__game`으로 상황을 만든다. 헤드폰과 노트북 스피커 둘 다.

| 들을 것 | 어떻게 | 맞으면 | 손잡이(파일 · 상수 · 권장 범위) |
|---|---|---|---|
| 40마리 떼가 귀를 때리지 않는다 | `?class=warrior&rift=5` → `__game.setInvincible(true)` → `__game.spawnPack('ghoul')` 서너 번 → 회오리 · 지면 강타 | 타격이 「촤르륵」 한 덩어리로 들리고 단일 타격보다 크게 커지지 않는다 · 펌핑(전체가 숨 쉬듯 줄었다 커짐)이 거슬리지 않는다 | `sounds.js` `VOICE.burstFree`(3~6) · `burstExp`(0.4~0.8) · `burstMin`(0.2~0.5) · `mergeMax`(1.2~1.6) · `MIX.limiter.release`(0.1~0.3) · `CATS.*.cap` |
| 고유 예고 넷이 서로 다르고 떼 속에서 들린다 | `__game.spawnPack('ghoul','elite',['jailer'])` · `['mortar']` · `['shielding']` · `['coldEnchanted']` 각각 | 감옥 = 쇠사슬 딸깍 연타 · 몰타르 = 발사 쿵 + 내려가는 휘파람(1.2초 — 휘파람이 끝날 때 떨어진다) · 보호막 = 올라가는 금빛 아르페지오 · 냉기 노바 = 부풀어 오르는 얼음 쉬익 · 떼 소리 위로 또렷하다 | `SOUNDS.jailWarn` · `mortarFire` · `shieldWarn` · `novaWarn`의 `g`(0.3~1.0) · `CATS.alarm.prio` |
| 피해 종류마다 질감 | 전사(물리) · 마법사 화염구(화염) · 서리 노바(냉기) · 연쇄 번개 · 마력 화살(번개) | 둔탁 · 타닥 · 쨍 · 지직이 구분된다 | `SOUNDS.hitPhys/hitFire/hitCold/hitLightning` · `MIX.critGain`(1.2~1.5) · `TEMPLATE_TONE`(음높이 0.6~1.4) |
| 전설 · 세트 드랍 | `__game.dropItem({rarity:'legendary'})` · `({rarity:'set'})` · `({rarity:'rare'})` | 전설 = 맑게 울리는 종 두 번 + 낮은 징(3초) · 세트 = 올라가는 화음 종 · 희귀 = 두 음 딩 | `SOUNDS.dropLegendary/dropSet/dropRare.g` |
| 골드 짤랑 | 골드 근처로 걷기 | 동전 부딪는 짤랑 · 연달아 주워도 시끄럽지 않다 | `SOUNDS.coins.g` · `gap`(0.03~0.08) |
| 회오리 지속음 · 정리 | 회오리를 누르고 있다 떼기 · 누른 채 `T`(귀환) · 누른 채 `Escape` | 누르는 동안만 바람 기둥 · 떼면 0.12초 안에 멎는다 · 마을 도착 · 일시정지에서 남지 않는다 | `LOOPS.whirl.g`(0.3~0.8) · `MIX.loopFade`(0.05~0.3) |
| 환경음 | 마을 · 지하 묘지 · 잿빛 동굴 | 모닥불 탁탁 · 바람 · 낮은 용암 울림이 바탕에 깔리되 전투를 덮지 않는다 · 장면 전환에 0.8초 교차 | `LOOPS.townFire/cryptWind/cavernLava.g` · `MIX.amb`(0.5~1) · `MIX.ambFade` |
| 메뉴 · 상점에서 | `Escape` · 대장장이 열기 · 사고팔기 | 환경음이 줄고(35%) 전투음은 멎는다 · 거래 · UI 음은 난다 | `MIX.ambPauseDuck`(0.2~0.6) |
| 탭 숨김 | 다른 탭으로 갔다 오기 | 숨는 즉시 조용 · 돌아오면 환경음이 다시 | (없음 — `setPaused`) |
| 낮은 생명 박동 | `__game.setInvincible(false)` 뒤 맞아서 35% 아래 | 낮은 쿵쿵이 0.85초마다 · 거슬리면 | `MIX.heartPeriod`(0.7~1.2) · `SOUNDS.heartbeat.g` |
| 거리 · 좌우 | 멀리서 싸우는 팩 · 화면 오른쪽 팩 | 멀수록 작고 오른쪽 소리는 오른쪽 귀 | `SPACE.near/far/farGain/panMax` |
| 볼륨 슬라이더 | 설정 → 마스터 · 효과 · 환경 | 슬라이더를 놓을 때 딸깍이 새 볼륨으로 · 0이면 그 버스가 조용 | `MIX.master` · `MIX.ui` |

## 확인하지 못한 것

- 실제 스피커 · 헤드폰으로 들은 음색 · 크기 · 피로감(위 표는 계량값뿐 — 저역 소리는 RMS 가 크게 나오지만 노트북 스피커에서는 작게 들릴 수 있다).
- 사람이 실제로 누른 첫 제스처에서의 unlock(헤드리스는 자동 재생 허용 플래그 · CDP userGesture 로만 돌렸다) · Safari(`webkitAudioContext` · interrupted).
- P16 속성 훅이 실제로 내는 `AFFIX.what` 값(계약 목록으로 맞췄다) · P15 봇 관전 중의 소리 밀도.
