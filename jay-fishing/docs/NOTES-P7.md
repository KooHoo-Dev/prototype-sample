# NOTES-P7 (fx-audio) — W1

소유: `src/view/fx/FxLayer.js` · `src/audio/AudioEngine.js` (+ 자기 폴더의 검사 `src/view/fx/FxLayer.test.js` · `src/audio/AudioEngine.test.js`).

## 계약 해석 · 모순(내 파일 안에서 처리)

1. **물살 팬의 부호(§9.12)**: `pan = sin(bearing − 카메라 yaw)`는 yaw 규약(+ = 왼쪽)에서 왼쪽 물고기를 오른쪽 스피커(StereoPanner +1)로 보낸다. 카메라 오른쪽 벡터와의 내적인 `−sin(bearing − yaw)`를 썼다(테스트가 본다). 계약 문구를 `−sin`으로 고치면 맞는다.
2. **P7 테스트 파일이 §12.2 표에 없다**: 자기 폴더에 `*.test.js` 두 개를 두었다(`node --test src/audio/AudioEngine.test.js src/view/fx/FxLayer.test.js`). `npm test`의 글롭(`test/**`)에는 안 잡힌다 — 통합 때 `test/fxAudio.test.js`로 옮기거나 글롭을 넓힌다. purity 규칙 때문에 `debug/fixtures.js` 대신 `test/helpers.js`의 `makeTestState`를 쓴다.
3. **탭 숨김**: 최소 부트(`main.js`)는 `setPaused`를 부르지 않는다. 그래서 AudioEngine 이 `document.visibilitychange`와 `PAUSED{on}`도 스스로 구독한다(앱의 `setPaused`와 겹쳐도 같은 결과 — 멈춤 = app 멈춤 ∨ 탭 숨김).
4. **`BITE_TAKE`의 파문**: 바닥 세트는 수면에 찌가 없어 파문을 내지 않는다(예신과 같은 규칙). 소리는 바닥 = 방울 3번 · 찌 = 퐁.
5. **이중 소리 방지**: `FAIL`은 소리를 내지 않는다(`FIGHT_END` · `HOOK_MISS`가 이미 낸다). `MONEY_CHANGED{sell}` 동전은 `SOLD`가 낸다.
6. **sim 이 멈춘 동안**(패널 · 일시정지 · `?fixture`): `state.tick`이 0.15초 넘게 그대로면 파이팅 지속음을 낮춘다 — 결과 · 채비 패널이 열린 채 클리커가 돌지 않게. 그래서 `?fixture=fightRun`은 조용하다(화면용).
7. 텐션 톤 게인 계산의 `limitRatio`를 1.2에서 자른다(스파이크 보호 — 음높이는 계약대로 sqrt 1.1 상한).

## 공개 동작(계약에 없던 것)

- `FxLayer.stats()` → `{particles: 살아 있는 입자, meshes: 보이는 고리 + 1(입자 Points)}`. 풀은 입자 400 · 고리 24 고정(`fxRoot` 자식 25개가 늘지 않는다).
- `AudioEngine.stats()` → `{nodes: 고정 노드(44) + 살아 있는 목소리의 노드, voices: 일회성 목소리 수 ≤ 24}`. unlock 전 `{0, 0}`.
- `settings.mute === true`(쿼리 `?mute=1` 의 overrides)면 마스터 0.
- WebAudio 가 없거나 만들기에 실패하면 `console.warn` 한 줄 · 소리 없이 계속(던지지 않는다).

## 관찰(남의 파일 — 고치지 않음)

- `?fixture=take` · `waiting` 정지 화면에서 `#ui-root`의 큰 흰 아이콘(해 모양)이 화면 대부분을 덮었다(P8 작업 중일 수 있음 — 통합 화면 패스에서 확인).

## 사람이 확인할 것 — 소리 조정 손잡이(`src/audio/AudioEngine.js` 상단)

| 무엇을 들어 보나 | 상수 | 지금 | 권장 범위 |
|---|---|---|---|
| 텐션 톤이 게이지와 같이 오르는가 · 너무 거슬리지 않는가 | `TENSION.gainBase` · `gainSpan` (계약 값) | 0.02 · 0.10 | 0.01–0.04 · 0.06–0.14 |
| 85%부터 라인 삐걱이 들리는가 | `TENSION.creakGain` · `creakQ` | 0.22 · 7 | 0.12–0.35 · 4–12 |
| 드랙 클리커 「지이익」(빠른 질주에서 이어지는 소리) | `CLICKER.gain` · `hpHz` · `maxRate` | 0.55 · 3200Hz · 90/s | 0.3–0.8 · 2500–5000 · 60–120 |
| 릴 톱니(감을 때) | `RATCHET.gain` · `bpHz` | 0.16 · 2300Hz | 0.08–0.3 · 1500–3500 |
| 질주 물살 · 좌우 방향 | `SWISH.gain` · `slipRef` | 0.22 · 2 m/s | 0.1–0.35 · 1–3 |
| 로드 삐걱(로드 한계 근처 · 펌핑) | `ROD_CREAK.gain` · `period` · `hz` | 0.32 · 0.38s · 420Hz | 0.2–0.5 · 0.25–0.6 · 300–700 |
| 찌 예신 톡 / 본신 퐁 / 바닥 방울 | `SFX.nibbleGain` · `takeGain` · `bellHz` | [0.05, 0.22] · 0.32 · 2100Hz | 상한 0.15–0.3 · 0.2–0.45 · 1600–2800 |
| 챔질 · 점프 철썩 · 끊김 탁 | `SFX.hookGain` · `jumpGain` · `snapGain` | 0.42 · 0.38 · 0.4 | 0.3–0.6 각각 |
| 환경음 크기(호수 바람 · 파도 · 강 · 집) | `AMB_GAIN.*` | wind 0.10 · waves 0.34 · river 0.30 · dam 0.30 · room 0.06 | 각 ±50% |
| 환경음 교차 시간 | `AMB_FADE_TC` | 0.67s(2초에 95%) | 0.4–1.0 |
| 시간대별 층(새벽 새 · 밤 귀뚜라미 · 낮 갈매기) | `AMBIENCE` 표 · `BIRD.every` · `GULL.every` | — | — |
| UI 소리 | `UI_SND.*` | 0.07–0.1 | 0.04–0.15 |
| 리미터 | `LIMITER` (계약 값) | −6dB · 20:1 | 바꾸지 않는다 |

확인 방법: 로컬 `npm.cmd --prefix jay-fishing run dev` → `?spot=lake_gravel&time=18` 에서 한 판(키 하나를 눌러 소리를 켠다). 드랙을 풀고 잉어 질주를 받으면 클리커가 빨라지고, 드랙을 조여 게이지가 85%를 넘으면 톤이 오르며 삐걱이 섞여야 한다. 끊김 · 랜딩 뒤 지속음이 남지 않는지, 탭을 바꾸면 소리가 멎는지, 판을 여러 번 해도 `__game.memory()`의 audioNodes 가 늘지 않는지(P9 통합 후).

연출 손잡이(`src/view/fx/FxLayer.js` 상단): `SPLASH.*`(개수 · 속도 · 크기) · `RIPPLE.*`(반경 · 수명 · 불투명도 ≤ 0.8) · `STREAM_*`(질주 물보라 줄기) · `RAIN_RATE` · `VIS_REF_M` · `VIS_MAX`(먼 물보라를 키우는 정도).
