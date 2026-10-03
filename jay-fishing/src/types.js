// OWNER: P0 — 계약 §3 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// 타입 카탈로그 — 계약 §3 의 typedef 를 그대로 옮겼다. 필드 주석의 단위 · 범위가 계약이다.
// 쓰는 쪽: /** @typedef {import('../types.js').RigState} RigState */ (상대 경로는 파일 위치에 맞춘다)

// ── 3.1 기초 ID · 열거

/** @typedef {{x:number, z:number}} Vec2 */
/** @typedef {'home'|'lake'|'coast'|'river'} SceneId */
/** @typedef {'lake'|'coast'|'river'} StageId              낚시가 되는 스테이지 */
/** @typedef {string} SpotId                                'lake_gravel' 등 — 부록 A */
/** @typedef {string} SpeciesId                             'crucian' 등 36종 — 부록 A */
/** @typedef {string} GearId                                'rod_float_2' 등 — §7.6 */
/** @typedef {'worm'|'paste'|'corn'|'shrimp'|'krill'|'live'} BaitId */
/** @typedef {'casting'|'hookset'|'dragSense'|'lineCare'|'pumping'|'knowledge'|'baitCraft'|'netting'|'haggling'|'mastery'} SkillId */
/** @typedef {'dawn'|'morning'|'day'|'evening'|'night'} BandId      새벽 04–07 · 아침 07–11 · 낮 11–17 · 저녁 17–20 · 밤 20–04 */
/** @typedef {'clear'|'cloudy'|'rain'} WeatherId */
/** @typedef {'surface'|'mid'|'bottom'} LayerId                     표층 · 중층 · 바닥 */
/** @typedef {'float'|'bottom'} SetId                               찌 채비 · 바닥 채비 */
/** @typedef {'rod'|'reel'|'line'|'hook'|'float'|'sinker'} GearSlot  float 슬롯은 찌 세트만, sinker 슬롯은 바닥 세트만 */
/** @typedef {'normal'|'trophy'|'legend'} Tier                      퍼센타일 <0.90 · ≥0.90 · ≥0.99 */
/** @typedef {'lineBreak'|'spoolEmpty'|'rodBreak'|'hookOff'|'early'|'late'} FailReason
 *  early = 헛챔질(본신 전 챔질) · late = 챔질 창을 놓쳐 미끼만 뺏김 */
/** @typedef {'idle'|'ready'|'charging'|'casting'|'waiting'|'retrieving'|'bite'|'fighting'|'landing'|'result'|'failed'} RigPhase */
/** @typedef {'run'|'rest'|'turn'|'jump'|'dive'|'shake'|'hold'|'charge'} BehaviorKind
 *  run 질주 · rest 휴식 · turn 방향 전환 · jump 점프 · dive 잠수(바닥/바위로) · shake 머리 흔들기/비틀기 · hold 버팀(꾸준한 당김) · charge 이쪽으로 돌진(슬랙을 만든다) */
/** @typedef {'heavy'|'runner'|'thrasher'|'jumper'|'diver'|'small'} StyleId   重 · 走 · 暴 · 跳 · 潛 · 小 */
/** @typedef {'fusiform'|'compressed'|'eel'|'shark'|'benthic'} BodyTemplate  방추형 · 측편형 · 장형 · 상어형 · 저서형 */
/** @typedef {'spot'|'npc'|'camp'|'pc'|'bed'|'door'} InteractKind */
/** @typedef {'title'|'pause'|'tackle'|'result'|'sell'|'pc'|'camp'|'map'|'bed'|'confirm'} PanelId */
/** @typedef {'start'|'stage'|'controls'|'cast'|'bite'|'fight'|'net'|'drift'|'bottomRig'|'holdFull'|'riverDrag'} HintId   §10.3 안내 문구 */
/** @typedef {'slack'|'jump'|'shake'|'active'|'abrasion'|null} LossCause   바늘 빠짐의 원인 · 라인 끊김의 쓸림 원인('abrasion' — 밸런스 게이트)(그 밖의 실패는 null) — 실패 알림이 한 줄로 보인다 */

// ── 3.2 입력 — `InputFrame`

/** @typedef {Object} InputFrame
 * @property {number} moveX          −1..1  오른쪽 +(KeyD) · 왼쪽 −(KeyA)
 * @property {number} moveZ          −1..1  앞 +(KeyW) · 뒤 −(KeyS)
 * @property {number} yaw            rad    보는 수평 방향(절대값 — app이 마우스로 관리). sim은 그대로 복사한다
 * @property {number} pitch          rad    [−1.40, 1.40]
 * @property {boolean} primary       좌클릭 눌림(캐스팅 충전 · 릴링 · 회수)
 * @property {boolean} primaryPressed   이번 틱에 눌렀다
 * @property {boolean} primaryReleased  이번 틱에 뗐다
 * @property {boolean} secondary     우클릭 눌림(펌핑 — 로드 세우기)
 * @property {boolean} hook          Space 에지(챔질 · 뜰채)
 * @property {boolean} interact      KeyE 에지
 * @property {number} dragSteps      정수. 이번 틱 드랙 눈금 변화 합(+ 조이기 = 휠↑ · KeyZ / − 풀기 = 휠↓ · KeyC)
 * @property {boolean} bail          KeyR 에지(베일 열기/닫기 토글)
 * @property {number} depthSteps     정수. 찌 수심 눈금 변화(+ 깊게 = ArrowUp / − 얕게 = ArrowDown)
 * @property {SetId|null} selectSet  Digit1 → 'float' · Digit2 → 'bottom' (에지)
 */

// ── 3.3 데이터 정의

/** @typedef {Object} SpeciesRow      data/species/<stage>.js 의 한 행(§7.3) — 사람이 쓰는 값만
 * @property {SpeciesId} id
 * @property {StageId} stage
 * @property {LayerId[]} layers                서식층(1~2개)
 * @property {string} time                     5글자 — 새벽·아침·낮·저녁·밤 순서의 활동 계수 '0'|'L'|'N'|'H'
 * @property {'float'|'bottom'|'both'} method  주로 잡히는 방식(도감 표시 · 봇 계획 — 입질 규칙은 층으로만 갈린다)
 * @property {BaitId[]} baits                  선호 미끼(선호 순 1~3개)
 * @property {StyleId} style
 * @property {string[]} traits                 TRAITS의 키(0~2개)
 * @property {[number, number]} lenCm          5 퍼센타일 · 99.9 퍼센타일 길이(cm)
 * @property {[number, number]} kg             같은 두 점의 무게(kg)
 * @property {1|2|3} mouth                     입 크기(소·중·대) — 바늘 적합도
 * @property {{force?:number, speed?:number, stamina?:number}} [fight]   성격 기본값에 곱하는 배율(없으면 1)
 * @property {{nibbles?:[number,number], take?:'sink'|'lift'}} [bite]    예신 횟수 범위(기본 [1,3]) · 본신 모양(기본 'sink' — 찌가 잠긴다 / 'lift' — 찌가 솟는다)
 * @property {number} pricePerKg               원/kg
 * @property {number} trophyBonus              트로피 배율 = 2 + trophyBonus
 * @property {number} xp                       경험치 계수
 * @property {{bands:BandId[], weather:WeatherId[]}|null} fantasy   판타지 어종의 출현 조건(아니면 null)
 * @property {SpeciesLook} look
 */

/** @typedef {Object} SpeciesLook      fishModel(P6)이 읽는다(§9.6)
 * @property {BodyTemplate} body
 * @property {number} depth            몸 높이 / 몸길이 (0.08..0.55)
 * @property {[string,string,string,string]} colors   등 · 옆 · 배 · 지느러미 '#rrggbb'
 * @property {'none'|'bars'|'spots'|'stripe'|'mottled'|'scales'|'mirror'|'scutes'|'gold'|'zombie'|'ghost'} pattern
 * @property {string|null} patternColor
 * @property {number} [barbels]        수염 개수(0 기본)
 * @property {string|null} [glow]      판타지 어종의 발광색(아니면 없음)
 * @property {string|null} [accent]    작은 강조색(컷스로트의 목 줄 등)
 */

/** @typedef {SpeciesRow & SpeciesDerived} SpeciesDef   data/species/index.js 가 내보내는 것 */
/** @typedef {Object} SpeciesDerived    derive.js 가 붙인다(§7.3.4)
 * @property {{mu:number, sigma:number, a:number, b:number}} size   ln L(cm) ~ N(mu, sigma²) · W(kg) = a·L^b
 * @property {number} medianCm
 * @property {number} medianKg
 * @property {number} trophyKg         90 퍼센타일 무게
 * @property {number} legendKg         99 퍼센타일 무게
 * @property {number} trophyCm
 * @property {number} legendCm
 * @property {{normal:number, trophy:number, legend:number}} priceMul
 */

/** @typedef {Object} StageDef        data/stages/<id>.js (§7.4)
 * @property {SceneId} id
 * @property {'interior'|'outdoor'} kind
 * @property {number} unlockLevel      들어갈 수 있는 최소 레벨(집 · 호수 1 · 갯바위 5 · 강 10)
 * @property {{x:number, z:number, yaw:number}} spawn      도착 위치
 * @property {Vec2[]} walk             걸을 수 있는 영역 — **볼록 다각형** · 꼭짓점 순서 Σ(xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ) > 0 (§7.4) · m
 * @property {Vec2[]} shore            해안선 꺾은선(x 오름차순). 물은 그 −Z 쪽. 실내는 []
 * @property {InteractPoint[]} points  npc · camp · pc · bed · door
 * @property {Array<{x:number, z:number, r:number}>} obstacles   걷기 충돌 원(m) — 판매 구조물 · 캠프 · 가구 · walk 안의 큰 소품. spawn · 자리 stand는 원 밖
 * @property {SpotDef[]} spots         낚시 자리(집은 [])
 * @property {'lake'|'waves'|'river'|'indoor'} ambience
 * @property {{amp:number, period:number}} waves           파도 진폭(m) · 주기(s) — 찌 흔들림(연출) · 물 셰이더
 * @property {Record<WeatherId, number>} weatherWeights    날씨 뽑기 가중치
 * @property {Object} look             view 전용 파라미터(§9.3) — sim은 읽지 않는다
 */
/** @typedef {{kind:InteractKind, id:string, x:number, z:number, yaw:number, radius:number, approach:Vec2}} InteractPoint
 *  kind 'npc'의 id는 'vendor', 'camp'는 'camp', 집의 'pc' · 'bed' · 'door'는 같은 이름. radius = 상호작용 반경(m)
 *  approach = 서서 E를 누르는 자리(obstacles 밖 · radius 안 — 봇이 걸어가는 목표 · 테스트가 검사) */

/** @typedef {Object} SpotDef
 * @property {SpotId} id
 * @property {Vec2} stand              설 자리 — 표식 중심 · 거리의 원점
 * @property {number} facing           물 쪽 정면 yaw
 * @property {number} arc              조준 허용 반각(rad) — 캐스팅 yaw는 facing ± arc로 자른다
 * @property {number} edgeM            stand에서 facing 방향으로 물가(해안선)까지의 거리(m). 물고기 최소 거리 · 뜰채 범위의 기준(§5.3.1) — 데이터 테스트가 shore로 검산(±0.15m)
 * @property {Array<[number,number]>} depth   수심 프로필 [[distM, depthM], …] — 거리 오름차순 · 끝점 너머는 끝값
 * @property {number} minCastM         가장 짧은 캐스팅 거리
 * @property {number} maxDriftM        흘림 최대 거리
 * @property {number|null} farFromM    이 거리 이상에서 풀의 farMul이 붙는다(먼 곳에 사는 어종 — 흘림 · 원투의 보상). 없으면 null
 * @property {Vec2} flow               흐름(m/s, 월드 XZ). 호수는 거의 0
 * @property {{fromM:number, rate:number}} snag   장애물 띠: 물고기 거리 ≥ fromM 이고 |angleDiff(facing, bearing)| ≤ arc + FIGHT.snagArcPad 이면 라인 쓸림 rate(/s) — fight.js inSnagAt
 * @property {number} abrasion         0..1 바닥 암반 정도 — 잠수(dive)형 쓸림 배율
 * @property {'mud'|'gravel'|'rock'|'sand'} bottom    연출 · 도감
 * @property {Array<{id:SpeciesId, w:number, farMul?:number}>} pool   어종 풀과 풍부도(판타지 어종은 w를 쓰지 않는다 — 1로 적는다). farMul: dist ≥ farFromM일 때 w에 곱한다(없으면 1)
 */

/** @typedef {Object} GearDef      data/gear.js (§7.6) — slot 별로 쓰는 필드가 다르다
 * @property {GearId} id
 * @property {GearSlot} slot
 * @property {1|2|3} tier
 * @property {SetId|null} set          로드만 세트 전용('float'|'bottom'), 나머지 null(어느 세트에나)
 * @property {number} price            상점 가격(원). 1단계는 0(지급)
 * @property {number} lossCost         잃을 때 자동 차감(바늘 · 찌 · 봉돌). 그 밖 0
 * @property {number} [castM]          로드: 기본 비거리(m)
 * @property {number} [maxLoadKg]      로드: 세운 상태 상한 하중
 * @property {number} [sensitivity]    로드 · 찌: 입질 신호 크기 배율
 * @property {number} [lengthM]        로드: 길이(연출)
 * @property {number} [maxDragKg]      릴: 최대 드랙(= 감는 힘의 상한)
 * @property {number} [speedMS]        릴: 회수 속도(m/s)
 * @property {number} [capacityM]      릴: 라인 수용량(m)
 * @property {number} [castBonus]      릴: 비거리 배율 가산(0.05 = +5%)
 * @property {number} [strengthKg]     라인: 인장 강도
 * @property {number} [biteMul]        라인: 입질 가중치 배율(굵을수록 작다)
 * @property {number} [abrasionMul]    라인: 쓸림 배율(굵을수록 작다)
 * @property {number} [pricePerM]      라인: 감기 단가(원/m)
 * @property {1|2|3} [size]            바늘: 크기
 * @property {number} [stability]      찌: 파도 · 흐름 안정(연출 노이즈 감쇠 0..1)
 * @property {number} [driftMul]       찌: 흘림 속도 배율
 * @property {number} [castBonusM]     봉돌: 비거리 가산(m)
 * @property {number} [holdMS]         봉돌: 이 흐름(m/s)까지 바닥을 잡는다
 */

/** @typedef {{id:BaitId, packSize:number, packPrice:number}} BaitDef */
/** @typedef {{id:SkillId, effects:Record<string, Array<number|boolean>>}} SkillDef   effects: Modifiers 필드 → [0단계, 1, 2, 3] 값(§7.7 · §8.4) */

/** @typedef {Object} BehaviorStateDef   fightStyles.js 의 한 행동 상태
 * @property {BehaviorKind} kind
 * @property {number} f          힘 배율(Fmax 대비)
 * @property {number} along      라인 방향 성분(+1 멀어짐 · 0 옆 · −1 다가옴)
 * @property {number} sp         속도 배율(vmax 대비)
 * @property {[number,number]} dur   지속 시간 범위(s)
 * @property {number} [tele]     들어가기 전 예고 시간(s) — 있으면 예고를 거친다
 * @property {number} [lateral]  방향(bearing) 변화 속도 배율(기본: turn 0.8 · run 0.3 · 그 밖 0.1)
 * @property {boolean} [abrades] 이 상태가 바닥/구멍을 비빈다(잠수와 같은 쓸림 규칙)
 * @property {Record<string, number>} next   다음 상태 이름 → 가중치
 */
/** @typedef {{force:number, speed:number, endurance:number, start:string, states:Record<string, BehaviorStateDef>}} StyleDef */
/** @typedef {Object} TraitDef      특성 = 성격 표에 대한 데이터 수정(§8.2)
 * @property {Record<string, BehaviorStateDef>} [addStates]
 * @property {Record<string, Record<string, number>>} [addNext]   상태 이름 → {다음 이름: 더할 가중치}
 * @property {Record<string, {f?:number, sp?:number, durMul?:number, lateral?:number}>} [scaleByKind]   BehaviorKind → 배율
 * @property {Record<string, number>} [nextMulByKind]             다음 상태 kind → 가중치 배율
 * @property {string} [start]          시작 상태 이름 바꾸기
 * @property {number} [abrasionMul]
 * @property {'tremble'|'spin'|null} [visual]   view용 표식(로드 잔떨림 · 그림자 회전)
 */
/** @typedef {{id:WeatherId, biteMul:number, dayBandStep:number, light:number, fog:number, waveMul:number, rain:number}} WeatherDef */
/** @typedef {{id:BandId, from:number, to:number}} BandDef     시(0..24). night는 from 20 · to 4(자정을 넘는다) */

// ── 3.4 게임 상태 — `GameState`

/** @typedef {Object} GameState
 * @property {number} version          STATE_VERSION
 * @property {number} seed             월드 시드(uint32) — 날씨 해시 · 난수 초기값
 * @property {{s:number}} rng          sim 난수 상태(core/rng.js). sim만 쓴다
 * @property {number} tick             세션 누적 틱
 * @property {SceneId} scene
 * @property {ClockState} clock
 * @property {WeatherState} weather
 * @property {EnvState} env
 * @property {PlayerState} player
 * @property {RigState} rig
 * @property {FightState|null} fight   파이팅 중에만
 * @property {CatchRecord|null} pendingCatch   결과 패널이 기다리는 물고기(rig.phase === 'result'일 때만)
 * @property {Profile} profile         저장되는 진행(§3.6)
 * @property {{ignoreGates:boolean, devSession:boolean}} session   ?scene · ?level 등 일회용 세션(§11.6)
 * @property {DebugState} debug
 * @property {Array<{name:string, payload:Object}>} events   이번 틱/명령의 이벤트 큐(플러시 뒤 비어 있다)
 */

/** @typedef {Object} ClockState     P3 clock.js 가 매 틱 · 건너뛰기 뒤 갱신(파생 필드 포함)
 * @property {number} day              1부터
 * @property {number} tickInDay        0..215999
 * @property {number} hour             0 ≤ h < 24 (tickInDay / 9000)
 * @property {number} minute           0..59 정수(표시용)
 * @property {BandId} band
 * @property {number} sunElev          rad. 일출 05:30 · 일몰 19:30에 0, 12:30에 최대 TIME.maxSunElev. 밤에는 음수
 * @property {number} sunAzim          rad, yaw 규약. 해는 +X(동)에서 떠 −X(서)로 진다(§7.1)
 * @property {number} light            0..1 하늘 밝기(낮 1 · 한밤 0.06 · 박명 보간 · 날씨 light 곱)
 * @property {boolean} night           light < TIME.nightLight
 */

/** @typedef {Object} WeatherState
 * @property {Record<StageId, WeatherId>} today
 * @property {Record<StageId, WeatherId>} tomorrow
 * @property {WeatherId} current       지금 씬의 날씨(집은 lake의 날씨 — 창밖 연출용)
 */

/** @typedef {Object} EnvState       view · audio용 파생 값 — P3가 매 틱 갱신
 * @property {number} waveAmp          m — stage.waves.amp × weather.waveMul (집 0)
 * @property {number} wavePeriod       s
 * @property {boolean} headlamp        야외 && clock.night
 * @property {number} rain             0..1 빗줄기 세기(weather.rain, 집 0)
 * @property {string} ambience         stage.ambience
 */

/** @typedef {Object} PlayerState
 * @property {Vec2} pos
 * @property {Vec2} prevPos
 * @property {number} yaw
 * @property {number} pitch
 * @property {'walk'|'fish'} mode
 * @property {SpotId|null} spotId      mode === 'fish'일 때 선 자리
 * @property {number} speed            m/s 실제 이동 속도(걸음 흔들림 연출)
 * @property {InteractTarget|null} nearby   지금 E를 누르면 상호작용할 대상(프롬프트)
 * @property {Vec2} [vel]              (W1 확정) sim 내부 — 걷기 가속(WORLD.accel)용 속도. 없으면 updateWalk 가 0 으로 만든다 · placePlayer 가 0 으로. view · ui 는 읽지 않는다
 */
/** @typedef {{kind:InteractKind, id:string, dist:number}} InteractTarget   id: 자리면 SpotId, 그 밖은 InteractPoint.id */

/** @typedef {Object} RigState       P1 rig.js 소유. 낚시 모드가 아닐 때 phase 'idle'
 * @property {SetId} set               들고 있는 세트
 * @property {RigPhase} phase
 * @property {number} phaseTime        현 단계에 들어온 뒤 경과(s)
 * @property {Vec2} origin             = spot.stand (낚시 모드가 아니면 player.pos)
 * @property {number} aimYaw           마지막 캐스팅의 yaw(facing ± arc로 잘린 값)
 * @property {number} power            0..1 캐스팅 게이지(charging 중 왕복)
 * @property {number} perfectFrom      0..1 이 값 이상이면 「완벽」(게이지에 띠로 그린다)
 * @property {{x:number, z:number, distM:number}|null} aimPreview   charging 중 지금 놓으면 떨어질 점
 * @property {Vec2} bobber             찌/봉돌의 수면 위치(waiting · bite · retrieving). 캐스팅 비행 중에는 착수 예정점
 * @property {Vec2} prevBobber
 * @property {number} castT            casting 단계의 비행 진행 0..1 (view가 포물선을 그린다)
 * @property {number} dist             origin → bobber 수평 거리(m)
 * @property {number} bearing          origin → bobber yaw
 * @property {number} waterDepth       bobber 지점 수심(m)
 * @property {number} baitDepth        미끼 수심(m) — 찌: min(floatDepth, waterDepth) · 바닥: waterDepth
 * @property {LayerId} layer
 * @property {number} floatDepth       찌 세트의 수심 설정(m) — profile.sets.float.depthM 의 사본(syncRig가 맞춘다)
 * @property {boolean} bailOpen
 * @property {boolean} drifting        찌가 흐름을 타고 움직이는 중(흘림)
 * @property {boolean} bottomSlip      봉돌이 흐름에 밀리는 중(입질 ×0.5)
 * @property {number} dragNotch        정수 0..dragNotches — profile.sets[set].dragNotch 의 사본(syncRig)
 * @property {number} dragNotches      = rigStats.dragNotches (syncRig)
 * @property {number} dragKg           = dragNotch × rigStats.dragNotchKg (syncRig)
 * @property {BaitId|null} castBaitId  물속에 있는 미끼 — charging → casting 에서 정하고 ready 에서 null. 입질 가중치 · 회수 환불 · 실패 손실은 이것을 쓴다(profile 의 bait 가 아니다)
 * @property {SetId|null} pendingSet   지금은 바꿀 수 없어 다음 ready 첫 틱에 적용할 세트 전환(failed · landing 중의 Digit1/2 — §5.2)
 * @property {SignalState} signal
 * @property {{open:boolean, remaining:number, total:number}} hookWindow
 * @property {boolean} canCast         ready에서 지금 캐스팅할 수 있는가 — profile 의 재고(미끼 · 라인)를 직접 읽는다(§5.2)
 * @property {'noBait'|'noLine'|null} castBlock
 * @property {FailReason|null} failReason   failed 단계의 사유
 * @property {LossReport|null} lastLoss
 * @property {boolean} castBuffered    failed 중 눌린 좌클릭(ready 첫 틱에 눌려 있으면 충전 시작)
 * @property {Object|null} bite        sim 내부 — 무는 물고기 {speciesId, roll, nibblesLeft, nextNibbleT, touched}. **ui는 읽지 않는다**(랜딩 전에는 어종을 숨긴다)
 */
/** @typedef {Object} SignalState     view(찌 · 초리) · audio가 읽는다
 * @property {'none'|'nibble'|'take'} kind
 * @property {number} t                이 신호가 시작된 뒤 경과(s)
 * @property {number} strength         0..1 신호 크기 = 기본 × 로드/찌 감도 × 숙련 배율(클램프)
 * @property {'sink'|'lift'|'pull'} takeStyle   찌: sink · lift / 바닥: pull
 * @property {number} count            이번 입질의 예신 횟수(지금까지)
 */

/** @typedef {Object} FightState     P2 fight.js 소유
 * @property {SpeciesId} speciesId     ui는 랜딩 전 표시하지 않는다
 * @property {FishRoll} roll
 * @property {number} t                파이팅 경과(s)
 * @property {number} dist             물고기까지 수평 거리(m) = 나가 있는 라인
 * @property {number} prevDist
 * @property {number} minDist          = spot.edgeM + FIGHT.minDistPad — 물고기가 다가올 수 있는 가장 가까운 거리(땅 위에 그려지지 않는다)
 * @property {number} bearing          origin → 물고기 yaw
 * @property {number} prevBearing
 * @property {number} halfArc          파이팅 방위 허용 반각(rad) — createFight 에서 한 번 정한다(§5.3.4)
 * @property {number} depth            물고기 수심(m, ≥0)
 * @property {number} airborne         0..1 점프 높이(공중일 때만 >0)
 * @property {number} stamina          0..1
 * @property {BehaviorKind} behavior
 * @property {string} behaviorName
 * @property {number} behaviorT
 * @property {number} behaviorDur      이 상태의 지속 시간(s) — airborne 계산 · 연출
 * @property {{kind:'run'|'jump'|'charge'|'dive', remaining:number, total:number}|null} telegraph   예고(그림자 · 아이콘 · 소리)
 * @property {number} tension          kg — 화면에 보이는 값이자 판정 값(평활)
 * @property {number} tensionRatio     tension / lineEffKg
 * @property {number} limitKg          지금 묶여 있는 한계 = rodUp ? min(lineEffKg, rodMaxLoadKg) : lineEffKg
 * @property {'line'|'rod'} limitBy    limitKg 가 어느 쪽인가(HUD 게이지 머리의 아이콘)
 * @property {number} limitRatio       tension / limitKg — HUD 텐션 게이지 · 라인 톤이 쓰는 값(§10.3 · §9.12)
 * @property {number} lineKg           세트의 라인 강도(스킬 배율 포함)
 * @property {number} lineEffKg        lineKg × (1 − abrasion)
 * @property {number} abrasion         0..FIGHT.maxAbrasion
 * @property {boolean} inSnag          inSnagAt(spot, dist, bearing) = dist ≥ spot.snag.fromM && |angleDiff(spot.facing, bearing)| ≤ spot.arc + FIGHT.snagArcPad(리뷰 수정)
 * @property {number} inCover          0..1 잠수형이 바닥/바위에 박힌 정도(≥ 0.5 이면 HUD 「박힘」)
 * @property {number} rodLift          0..1 (0 숙임 · 1 세움)
 * @property {boolean} rodUp           rodLift ≥ 0.5
 * @property {number} rodLoadRatio     tension / rodMaxLoadKg
 * @property {boolean} rodStress       rodUp && rodLoadRatio ≥ FIGHT.rodStressAt
 * @property {number} rodOverT         s — rodUp && tension > rodMaxLoadKg 가 이어진 시간(FIGHT.rodBreakHold 에 닿으면 파손). 끊기면 0
 * @property {boolean} lineDanger      tensionRatio ≥ FIGHT.lineDangerAt
 * @property {boolean} slipping        드랙이 미끄러지는 중
 * @property {number} slipSpeed        m/s 풀려 나가는 속도(클리커 소리)
 * @property {boolean} reeling         이번 틱 릴링 입력
 * @property {number} gainSpeed        m/s 실제로 감기는 속도
 * @property {boolean} slack           tension < 슬랙 문턱 && 라인을 거두는 중이 아님(밸런스 게이트 — §5.3.2 10e)
 * @property {number} slackTime        s 누적(긴장되면 줄어든다)
 * @property {number} spoolLeftM       lineM − dist
 * @property {boolean} canNet          dist ≤ netRangeM && stamina ≤ landStamina
 * @property {number} netRangeM        = spot.edgeM + rigStats.netReachM (뜰채가 닿는 수평 거리)
 * @property {number} netBuffer        s — canNet 전에 누른 Space 의 남은 선입력 시간(FIGHT.netBufferS)
 * @property {number} landStamina
 * @property {boolean} showStamina     어종 지식 3단계
 * @property {string[]} traits         어종 특성(연출 — tremble · spin)
 * @property {{Fmax:number, vmax:number, endurance:number}} k   이 물고기의 상수(테스트 · 디버그)
 * @property {FightStats} stats
 * @property {Object} brain            sim 내부(행동 상태 기계 변수). view · ui는 읽지 않는다
 */
/** @typedef {{maxTension:number, sumTension:number, sumTension2:number, ticks:number, runs:number, jumps:number, slackTicks:number, slipTicks:number}} FightStats */

/** @typedef {{forceBite:{speciesId:SpeciesId, pct:number}|null, noBites:boolean}} DebugState */

// ── 3.5 판정 · 결과 값

/** @typedef {Object} FishRoll        P1 catch.js rollFish 가 만든다(물기 시점에 정해진다)
 * @property {SpeciesId} speciesId
 * @property {number} z                표준정규 값(클램프 [−2.5, 3.3])
 * @property {number} pct              0..1 퍼센타일 = Φ(z)
 * @property {number} lengthCm         소수 1자리
 * @property {number} weightKg         소수 3자리
 * @property {Tier} tier
 */

/** @typedef {Object} FightOutcome    P2 updateFight 의 반환(끝난 틱에만, 나머지 null)
 * @property {'net'|'lineBreak'|'spoolEmpty'|'rodBreak'|'hookOff'} type   'net' ↔ 이벤트 FIGHT_END.outcome 'landed'
 * @property {number} lineLostM        끊긴 지점 바깥 라인(m) — lineBreak: dist · spoolEmpty: lineM 전부 · 그 밖 0
 * @property {number} durationSec
 * @property {LossCause} cause         hookOff 의 원인(§5.3.2 5 · 10e · 10f), 그 밖 null
 * @property {boolean} hookSmall       hookOffMul > 1 이었다(바늘이 입보다 작다)
 */

/** @typedef {Object} CatchRecord     P4 evaluateCatch 가 만든다
 * @property {number} uid              profile.nextUid
 * @property {SpeciesId} speciesId
 * @property {number} lengthCm
 * @property {number} weightKg
 * @property {number} pct
 * @property {Tier} tier
 * @property {number} price            기본 판매가(원, 흥정 전) = round(pricePerKg × weightKg × priceMul[tier])
 * @property {number} xpKeep           어창에 넣으면 받을 경험치(첫 포획 · 신기록 보너스 포함)
 * @property {number} xpRelease        방생하면 받을 경험치(= round(xpKeep × XP.releaseMul))
 * @property {boolean} firstCatch
 * @property {boolean} recordWeight    그 어종 최대 무게 경신(첫 포획 제외)
 * @property {StageId} stageId
 * @property {SpotId} spotId
 * @property {number} day
 * @property {number} hour
 * @property {SetId} set
 * @property {number} fightSec
 */

/** @typedef {Object} LossReport      P4 applyLoss 반환 — 실패 알림이 그대로 보인다
 * @property {FailReason} reason
 * @property {SetId} set
 * @property {BaitId} baitId           물속에 있던 미끼(rig.castBaitId — applyLoss 의 인자)
 * @property {boolean} baitLost        미끼를 잃었는가(보존 스킬로 false일 수 있다)
 * @property {number} tackleCost       자동 차감한 채비 값(원 — 바늘 + 찌/봉돌)
 * @property {number} lineLostM
 * @property {GearId|null} rodLost     부러져 사라진 로드(예비 1단계로 바뀌었다)
 * @property {boolean} spareSpool      남은 라인이 CAST.minLineM + CAST.lineReserveM 아래라 예비 스풀(line_1 가득 · 무료)로 바꿨다(§5.6)
 * @property {number|null} dragKgAfter 로드 파손으로 드랙을 낮췄으면 그 kg(§5.6), 아니면 null
 * @property {LossCause} cause         바늘 빠짐의 원인
 * @property {boolean} hookSmall       바늘이 입보다 작았다(알림 「바늘이 작다」)
 * @property {number} moneyBefore
 * @property {number} moneyAfter
 */

/** @typedef {{ok:true} & Object | {ok:false, reason:string, params?:Record<string, number|string>}} Result   §0.5 */

// ── 3.6 진행 · 보상

/** @typedef {Object} Profile         저장되는 것 전부. sim(P4 함수)만 고친다
 * @property {number} money
 * @property {number} level            1..XP.levelCap
 * @property {number} xp               현재 레벨 안에서 쌓인 경험치(0 ≤ xp < xpToNext(level), 캡이면 0)
 * @property {number} xpTotal
 * @property {number} skillPoints      남은 포인트
 * @property {Record<SkillId, 0|1|2|3>} skills
 * @property {Record<GearId, number>} owned    2·3단계 장비 보유 수(1단계는 무한 — 키가 없다)
 * @property {Record<BaitId, number>} baits    보유 미끼 수
 * @property {{float:SetConfig, bottom:SetConfig}} sets
 * @property {CatchRecord[]} hold              어창(≤ HOLD.capacity)
 * @property {Record<SpeciesId, DexEntry>} dex 잡은 어종만 키가 있다
 * @property {{hints:Record<string, true>, freeBaitDay:number}} flags
 * @property {{landed:number, lost:number, released:number, sold:number, earned:number, casts:number}} stats
 * @property {number} nextUid
 */
/** @typedef {Object} SetConfig
 * @property {GearId} rod
 * @property {GearId} reel
 * @property {GearId} hook
 * @property {GearId|null} float       찌 세트만
 * @property {GearId|null} sinker      바닥 세트만
 * @property {BaitId} bait             끼울 미끼
 * @property {GearId} lineId           스풀에 감긴 라인 종류
 * @property {number} lineM            스풀 잔량(m, ≤ 릴 capacityM)
 * @property {number} depthM           찌 수심 설정(바닥 세트는 무시)
 * @property {number} dragNotch
 */
/** @typedef {{count:number, maxKg:number, maxCm:number, firstDay:number, trophies:number, legends:number, best:Tier}} DexEntry */

/** @typedef {Object} Modifiers       P4 computeModifiers — 스킬 효과의 합(§7.7)
 * @property {number} castMul
 * @property {number} perfectWindow
 * @property {number} hookWindowAdd
 * @property {number} earlyBaitKeep
 * @property {number} dragNotches
 * @property {number} lineStrMul
 * @property {number} slackRateMul
 * @property {number} abrasionMul
 * @property {number} pumpDrainMul
 * @property {number} jumpPumpMul
 * @property {0|1|2|3} knowledge
 * @property {number} biteRateMul
 * @property {number} baitKeepOnFail
 * @property {number} netRangeAdd
 * @property {number} landStaminaAdd
 * @property {number} sellMul
 * @property {number} signalMul
 * @property {boolean} tier3Unlocked
 */

/** @typedef {Object} RigStats        P4 rigStats(profile, set, mods) — rig · fight · ui 미리보기가 같은 값을 본다
 * @property {SetId} set
 * @property {GearId} rodId
 * @property {GearId} reelId
 * @property {GearId} lineId
 * @property {GearId} hookId
 * @property {GearId|null} floatId
 * @property {GearId|null} sinkerId
 * @property {BaitId} baitId
 * @property {number} baitCount        표시용 스냅샷(rig 판정은 profile 을 직접 읽는다 — §5.2)
 * @property {number} castMaxM         (rod.castM + sinker.castBonusM) × (1 + reel.castBonus) × mods.castMul
 * @property {number} rodMaxLoadKg
 * @property {number} rodSensitivity
 * @property {number} rodLengthM
 * @property {number} reelMaxDragKg
 * @property {number} reelSpeedMS
 * @property {number} spoolCapM
 * @property {number} lineM            표시용 스냅샷(rig · fight 는 profile.sets[set].lineM 을 직접 읽는다)
 * @property {number} lineKg (= strengthKg × mods.lineStrMul)
 * @property {number} lineBiteMul
 * @property {number} lineAbrasionMul (= line.abrasionMul × mods.abrasionMul)
 * @property {1|2|3} hookSize
 * @property {number} floatSensitivity
 * @property {number} floatStability
 * @property {number} floatDriftMul
 * @property {number} sinkerHoldMS
 * @property {number} sinkerCastBonusM
 * @property {number} dragNotches
 * @property {number} dragNotchKg
 * @property {number} signalMul        rod.sensitivity × (찌 세트면 float.sensitivity, 바닥이면 1) × mods.signalMul
 * @property {number} hookWindowS      SIGNAL.<set>.takeWindow + mods.hookWindowAdd (찌올림 본신이면 rig 가 SIGNAL.float.liftWindowAdd 를 더한다 — §5.4.4)
 * @property {number} perfectWindow
 * @property {number} biteRateMul
 * @property {number} netReachM        FIGHT.netReachM + mods.netRangeAdd — 물가 너머로 뜰채가 닿는 거리(파이팅의 netRangeM = spot.edgeM + 이것)
 * @property {number} landStamina      FIGHT.landStamina + mods.landStaminaAdd
 * @property {number} slackRateMul
 * @property {number} pumpDrainMul
 * @property {number} jumpPumpMul
 * @property {number} earlyBaitKeep
 * @property {number} baitKeepOnFail
 * @property {boolean} showStamina
 */

/** @typedef {Object} DexCard        P4 dexView — 도감 카드 하나
 * @property {SpeciesId} speciesId
 * @property {boolean} caught
 * @property {boolean} fantasy
 * @property {LayerId[]} layers
 * @property {string|null} time        knowledge ≥ 1 이면 SpeciesRow.time, 아니면 null
 * @property {BaitId[]|null} baits     knowledge ≥ 2
 * @property {DexEntry|null} entry
 * @property {number} trophyKg
 * @property {number} legendKg
 */
/** @typedef {Object} ShopItem       P4 shopList 의 한 항목
 * @property {string} id               목록 키 — 장비 GearId · 미끼 'bait_<id>' · 라인 감기 'refill_<set>_<lineId>'
 * @property {'gear'|'bait'|'line'} kind
 * @property {SetId|null} set          라인 감기는 그 세트(세트마다 비용이 다르다 — 항목도 세트 × 라인마다 하나), 그 밖 null
 * @property {GearId|null} lineId      kind 'line'만 — refillLine(set, lineId)
 * @property {number} price            kind 'line'은 그 세트 기준 감기 비용(같은 라인이면 모자란 m × 단가, 다른 라인이면 capacityM × 단가)
 * @property {boolean} ok
 * @property {string|null} reason
 * @property {Record<string, number|string>|null} reasonParams   §0.5
 * @property {number} owned
 * @property {GearSlot|null} slot
 * @property {number} tier
 * @property {{float:{before:RigStats, after:RigStats}|null, bottom:{before:RigStats, after:RigStats}|null}|null} previews
 *  그 장비를 각 세트에 끼웠을 때의 RigStats(사기 전 · 후 비교 — QUALITY §3). 세트 전용 로드 · 찌 · 봉돌은 해당 세트만, 공용(릴 · 바늘 · 라인)은 둘 다 */
/** @typedef {{skillId:SkillId, rank:number, ok:boolean, reason:string|null, before:Modifiers, after:Modifiers}} SkillPreview */

// ── 3.7 저장 · 설정

/** @typedef {Object} SaveData       localStorage 'jay-fishing:save' 의 JSON
 * @property {'jay-fishing'} game
 * @property {number} version          SAVE_VERSION = 1
 * @property {number} savedAt          ms(app이 넣는다)
 * @property {number} seed
 * @property {number} rng              state.rng.s(uint32) — 불러오면 난수열을 잇는다(리뷰 수정). 없거나 깨진 옛 세이브는 parseSave 가 hash32(seed, day, tickInDay, 0x5a7e)로 채운다
 * @property {{day:number, tickInDay:number}} clock
 * @property {SceneId} scene           불러오면 이 씬의 spawn에서 걷기 모드로 시작
 * @property {Profile} profile
 */

/** @typedef {Object} Settings       localStorage 'jay-fishing:settings'
 * @property {number} version          1
 * @property {number} mouseSens        0.2..3 (기본 1)
 * @property {boolean} invertY
 * @property {'low'|'medium'|'high'} quality
 * @property {number} fov              60..90 (기본 70)
 * @property {{master:number, sfx:number, ambience:number, ui:number}} volume   0..1
 * @property {boolean} hints           첫 안내 문구 켜기
 */

// ── 3.8 sim 문맥 · 봇

/** @typedef {Object} SimCtx         GameSim이 하나 만들어 매 틱 필드를 갱신해 넘긴다(P3 소유)
 * @property {GameState} state
 * @property {import('./core/rng.js').Rng} rng   state.rng 위의 난수
 * @property {(name:string, payload?:Object) => void} emit   state.events 에 쌓는다(즉시 발행하지 않는다)
 * @property {Modifiers} mods          스킬이 바뀌면 GameSim이 다시 계산
 * @property {StageDef} stage          지금 씬 = getStage(state.scene) — 씬을 바꾸는 그 자리(travel · newGame · debugGotoScene · 불러오기)에서 대입한다
 * @property {SpotDef|null} spot       낚시 중인 자리 = player.spotId ? getSpot(player.spotId) : null — enterSpot · exitSpot · travel 이 바꾼 그 자리에서 대입한다
 * @property {RigStats} rigStats       지금 세트의 RigStats
 * @property {() => void} refresh      mods = computeModifiers(profile) · rigStats = rigStats(profile, rig.set, mods) → syncRig(ctx)(P1 — rig 의 파생 필드). profile 을 바꾸는 sim 함수는 끝에서 반드시 부른다(§5.2 · §6.7)
 */

/** @typedef {{name:string, args:Array}} BotCommand    GameSim 명령 메서드 이름과 인자 — UI가 부르는 것과 같은 것만(§6.8) */
/** @typedef {{input:InputFrame, command:BotCommand|null}} BotAction */

// ── 계약 밖에서 쓰는 이름 하나(§11.6 · §6.12 의 DevQuery — 소유 P9 · 모양은 P9 재량)

/** @typedef {Object} DevQuery   app/query.js parseQuery 의 결과(§11.6)
 * @property {boolean} devSession       quality · mute · nopause 를 뺀 쿼리가 하나라도 있으면 true
 * @property {boolean} fresh
 * @property {SceneId|null} scene
 * @property {SpotId|null} spot
 * @property {number|null} level
 * @property {number|null} money
 * @property {1|2|3|null} gear          장비 단계(밸런스 게이트 — 두 세트를 그 단계로)
 * @property {number|null} time
 * @property {WeatherId|null} weather
 * @property {number|null} seed
 * @property {'basic'|'controlled'|'mindless'|'locked'|null} bot
 * @property {PanelId|null} panel
 * @property {string|null} fixture
 * @property {boolean} nopause
 * @property {{quality?:'low'|'medium'|'high', mute?:boolean}} overrides
 */

export {};
