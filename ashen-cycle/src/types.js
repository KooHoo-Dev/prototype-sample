// OWNER: P0 — 계약 §3 (+ §9의 Pose · BossView · RenderContext, §10의 UiActions)
// JSDoc typedef 전부. 런타임 export는 없다(파일 끝의 export {}).
// 끌어 쓰기: /** @typedef {import('../types.js').PlayerState} PlayerState */
// 주석의 단위 · 범위가 계약이다 — 이 파일은 docs/CONTRACT.md §3을 그대로 옮긴 것이다.

// ───────────────────────── §3.1 기초 · 입력 ─────────────────────────

/** @typedef {{x:number, z:number}} Vec2  XZ 평면 벡터(m) */

/** @typedef {'valder'|'fenrir'|'nihil'} BossId */
/** @typedef {'longsword'|'greatsword'|'spear'} WeaponId */
/** @typedef {'vit'|'end'|'str'|'dex'} StatId */
/** @typedef {'bonfire'|'blacksmith'|'merchant'|'gate'} FacilityId */
/** @typedef {'fire'|'frost'|'void'|'danger'} FxStyle */

/**
 * 한 틱의 입력. app(또는 봇)이 만든다. sim은 읽기만 한다.
 * @typedef {Object} InputFrame
 * @property {number} moveX  월드 공간 이동 의도 x (−1..1). 카메라 기준 → 월드 변환은 app이 끝낸다
 * @property {number} moveZ  월드 공간 이동 의도 z (−1..1). (moveX, moveZ)의 길이 ≤ 1
 * @property {boolean} sprint        달리기 홀드
 * @property {boolean} guard         가드 홀드
 * @property {boolean} heavyHeld     강공격 홀드(차지 유지 판정)
 * @property {boolean} lightPressed  이번 틱에 눌림(에지). 한 번 누르면 정확히 한 틱만 true
 * @property {boolean} heavyPressed  에지
 * @property {boolean} rollPressed   에지
 * @property {boolean} flaskPressed  에지
 * @property {boolean} lockOnPressed 에지
 * @property {boolean} interactPressed 에지
 */

// ───────────────────────── §3.2 히트 셰이프 ─────────────────────────

/**
 * 데이터에 적는 상대 셰이프. 원점 = 소유자 pos, 기준 방향 = 소유자 facing.
 * fwd = 앞(+) 거리 m, side = 오른쪽(+) 거리 m.
 * @typedef {(
 *   {type:'circle', r:number, fwd?:number, side?:number} |
 *   {type:'arc', r:number, rInner?:number, halfAngle:number, dirOffset?:number} |
 *   {type:'ring', rInner:number, rOuter:number} |
 *   {type:'capsule', fwd0:number, fwd1:number, side?:number, r:number}
 * )} ShapeDef
 *   arc: 원점에서 반경 rInner..r, 중심 방향 facing+dirOffset, 좌우 halfAngle(rad). halfAngle ≥ π면 원
 *   ring: 원점 중심의 띠
 *   capsule: 원점에서 앞쪽 fwd0..fwd1 선분(옆으로 side 만큼 평행 이동)을 r로 부풀린 것
 */

/**
 * 월드 공간으로 푼 셰이프(판정 · 텔레그래프 그리기 공용).
 * @typedef {(
 *   {type:'circle', x:number, z:number, r:number} |
 *   {type:'arc', x:number, z:number, r:number, rInner:number, dir:number, halfAngle:number} |
 *   {type:'ring', x:number, z:number, rInner:number, rOuter:number} |
 *   {type:'capsule', ax:number, az:number, bx:number, bz:number, r:number}
 * )} HitShape
 */

/**
 * 공격자가 "이번 틱에 살아 있는 판정"으로 내놓는 것. P1 · P3가 만들고 P2가 판정한다.
 * @typedef {Object} OutgoingHit
 * @property {'player'|'boss'|'projectile'|'hazard'} source
 * @property {string} attackId     플레이어: MoveDef.id / 보스: BossAttackDef.id / 그 외: kind
 * @property {number} hitId        판정 인스턴스 번호(ctx.nextHitId()). 같은 hitId는 한 대상을 한 번만 때린다
 * @property {ShapeDef} shapeDef
 * @property {number} x            셰이프 원점 x
 * @property {number} z
 * @property {number} facing       셰이프 기준 방향
 * @property {number} damage       공격 측 배율을 모두 곱한 피해(대상 측 보정 전, 실수)
 * @property {number} posture      보스에게 쌓는 체간(플레이어 → 보스만. 그 외 0)
 * @property {boolean} guardable   가드로 막을 수 있는가(플레이어 → 보스에서는 무시)
 * @property {boolean} parryable   패링할 수 있는가
 * @property {boolean} knockdown   맞으면 넘어지는가(보스 → 플레이어)
 * @property {boolean} heavy       강타 연출(스파크 · 흔들림 크게)
 * @property {boolean} execute     처형 타격(자동 명중 · 체간 누적 없음)
 * @property {number} hitstop      명중 시 요청할 히트스톱(초). 0이면 P2가 data/combat 기본값을 쓴다
 *
 * 만드는 쪽별 채움 규칙:
 *   플레이어(P1)  — 전 필드를 MoveDef에서. guardable · parryable · knockdown = false
 *   보스(P3)      — heavy = hit.knockdown, hitstop = 0, posture = 0, execute = false. 나머지는 BossHitDef에서
 *   투사체(P2)    — parryable = spec.parryable, heavy = knockdown, hitstop = 0, posture = 0, execute = false,
 *                   shapeDef = {type:'circle', r}, facing = 진행 방향 dir
 *   장판(P2)      — parryable = false, heavy = knockdown, hitstop = 0, posture = 0, execute = false,
 *                   facing = 생성 시 facing (판정은 Hazard.shape — 이미 월드 공간 — 를 바로 쓴다)
 */

/**
 * @typedef {Object} DamageResult
 * @property {'player'|'boss'|'projectile'|'hazard'} source
 * @property {'player'|'boss'|'dummy'} target
 * @property {'hit'|'guard'|'parry'|'dodge'|'immune'} outcome
 * @property {number} damage       실제로 깎인 HP(정수, 0 이상)
 * @property {number} rawDamage    경감 전 피해
 * @property {number} posture      보스에 실제로 쌓인 체간
 * @property {number} staminaDamage 가드로 깎인 스태미나
 * @property {boolean} crit        치명(패링당함/그로기 상태의 보스를 때림)
 * @property {boolean} heavy
 * @property {boolean} execute
 * @property {boolean} knockdown
 * @property {boolean} guardBreak  이 타격으로 가드가 깨졌는가
 * @property {boolean} postureBroken 이 타격으로 체간이 가득 찼는가
 * @property {boolean} lethal      이 타격으로 대상 HP가 0이 됐는가
 * @property {number} x  충돌 지점 x(대상 원의 공격자 쪽 표면)
 * @property {number} z
 * @property {number} y  표현용 높이(m). 플레이어 1.1, 보스 def.height×0.55, 허수아비 1.0
 * @property {number} dir  힘의 방향(rad) — 공격 원점에서 대상을 향하는 각
 * @property {string} attackId
 * @property {number} hitId
 */

// ───────────────────────── §3.3 능력치 · 무기 · 유물 ─────────────────────────

/**
 * 파생 능력치. P4의 computeStatBlock(profile)이 만들고 P1 · P2가 읽는다. 유물 효과가 이미 반영돼 있다
 * (P1 · P2는 유물 ID를 모른다).
 * @typedef {Object} StatBlock
 * @property {number} level            1 + 투자 점수 합
 * @property {number} hpMax
 * @property {number} staminaMax
 * @property {number} staminaRegen     초당
 * @property {WeaponId} weaponId
 * @property {number} weaponLevel      0..10
 * @property {number} weaponDamage     무기 기본 피해 × 강화 배율
 * @property {number} damageMul        근력 배율(1.0~)
 * @property {number} postureMul       기량 × 무기 강화의 체간 배율(1.0~)
 * @property {number} critMul          패링당함/그로기 보스에 대한 피해 배율(1.25~)
 * @property {number} executeMul       처형 피해 배율(1.0~)
 * @property {number} guardReduction   가드 피해 경감 0..1 (무기)
 * @property {number} guardStaminaFactor 가드 시 스태미나 소모 = 들어온 피해 × 이 값 (무기 × 유물)
 * @property {number} flaskCharges     플라스크 최대 충전
 * @property {number} flaskHeal        1회 회복량(HP)
 * @property {number} parryWindow      패링 창(초)
 * @property {number} parryPosture     패링 1회가 보스에 쌓는 체간
 * @property {number} postRollDmgMul   구르기 직후 피해 배율(기본 1)
 * @property {number} postRollWindow   그 지속(초, 기본 0)
 * @property {number} lifesteal        준 피해 중 HP로 돌아오는 비율(기본 0)
 * @property {number} lowHpThreshold   저체력 기준 0..1 (기본 0)
 * @property {number} lowHpDmgMul      저체력 시 피해 배율(기본 1)
 * @property {number} emberGainMul     잔불 획득 배율(기본 1)
 */

/**
 * 플레이어 공격 한 타. 시간은 전부 초.
 * @typedef {Object} MoveDef
 * @property {string} id            'light1'..'light4' | 'heavy' | 'dash' | 'rollAtk'  ('execute'는 무브 표에 없다 — attackId 전용, §7.1 처형)
 * @property {'light'|'heavy'|'dash'|'roll'} kind
 * @property {string} motion        포즈 계열(§9.6): 'slashR'|'slashL'|'slashUp'|'overhead'|'thrust'|'spin'|'sweep'
 * @property {number} windup        예고(초)
 * @property {number} active        판정(초)
 * @property {number} recovery      후딜(초)
 * @property {number} chargeMax     홀드 차지 최대(초). heavy만 > 0, 나머지 0
 * @property {number} dmgMul        피해 배율
 * @property {number} chargeDmgMul  완충 시 피해 배율(차지 0→1에 따라 1→이 값으로 선형). 체간은 PLAYER.chargePostureMul을 쓴다
 * @property {number} posture       체간 피해(기본값. StatBlock.postureMul을 곱한다)
 * @property {number} stamina       소모
 * @property {ShapeDef} shape
 * @property {number} lunge         전진 거리(m). 예고 끝 PLAYER.attack.lungeLead초 전 ~ 판정 끝 사이에 이동
 * @property {number} comboAt       후딜 진입 후 이 시간(초)부터 다음 공격으로 넘어갈 수 있다. 연속기 끝이면 recovery와 같다
 *                                  (예외: 강공격 뒤의 강공격은 comboAt이 아니라 후딜이 끝난 뒤에만 시작한다 — §7.1)
 * @property {number} rollCancelAt  후딜 진입 후 이 시간부터 구르기 · 가드 · 플라스크로 캔슬 가능
 * @property {string|null} next     다음 약공격 id(연속기). 없으면 null
 * @property {number} hitstop       명중 시 히트스톱(초)
 * @property {boolean} heavy        강타 연출 여부
 */

/**
 * @typedef {Object} WeaponDef
 * @property {WeaponId} id
 * @property {'oneHand'|'twoHand'|'polearm'} grip   view가 쥐는 자세 · 메시 선택에 쓴다
 * @property {number} baseDamage
 * @property {number} guardReduction      0..1
 * @property {number} guardStaminaFactor
 * @property {number} reach               봇 · UI용 대략 사거리(m, 플레이어 중심에서)
 * @property {number} length              무기 메시 길이(m) — view · 궤적용
 * @property {Record<string, MoveDef>} moves  키 = MoveDef.id
 */

/**
 * @typedef {Object} RelicDef
 * @property {string} id
 * @property {number} price                잔불
 * @property {Partial<StatBlock>} mods     더하는 값(add) — 아래 mul과 중복 키 금지
 * @property {Partial<StatBlock>} mul      곱하는 값
 * @property {Partial<StatBlock>} set      덮어쓰는 값(lowHpThreshold 같은 것)
 */

// ───────────────────────── §3.4 플레이어 상태 ─────────────────────────

/**
 * @typedef {'idle'|'move'|'roll'|'backstep'|'attack'|'guard'|'guardHit'|'guardBreak'|'parry'|
 *           'flask'|'stagger'|'knockdown'|'getup'|'execute'|'dead'} PlayerStateName
 *   idle      서 있음
 *   move      걷기/달리기(sprinting 플래그로 구분)
 *   roll      구르기(방향 입력 있음)        backstep  백스텝(방향 입력 없음)
 *   attack    공격(세부는 attack 필드)
 *   guard     가드 홀드(이동 가능, 느림)    guardHit  가드 중 피격 경직
 *   guardBreak 가드 붕괴(스태미나 0)        parry     패링 성공 자세
 *   flask     플라스크 사용
 *   stagger   피격 경직                     knockdown 넘어짐       getup 일어남
 *   execute   처형 연출                     dead      사망
 */

/**
 * @typedef {Object} PlayerAttack
 * @property {string} moveId
 * @property {WeaponId} weaponId
 * @property {'light'|'heavy'|'dash'|'roll'|'execute'} kind
 * @property {string} motion
 * @property {number} comboIndex   0부터. 약공격 연속기의 몇 번째인가
 * @property {'windup'|'charge'|'active'|'recovery'} phase
 * @property {number} phaseT       현재 구간 진행도 0..1 (charge에서는 차지량 0..1)
 * @property {number} charge       확정된 차지량 0..1 (active 진입 시 고정)
 * @property {number} hitId        이 휘두르기의 판정 번호
 */

/**
 * @typedef {Object} InputBuffer
 * @property {'light'|'heavy'|'roll'|'flask'|null} action  한 칸. 새 입력이 덮어쓴다
 * @property {number} t            남은 유효 시간(초). 저장할 때의 상태가 PLAYER.bufferLongStates 안이면 PLAYER.bufferAttack, 아니면 PLAYER.buffer
 * @property {number} dirX         버퍼 순간의 이동 의도(구르기 방향용 — 소비 틱에 이동 의도가 없을 때만 쓴다)
 * @property {number} dirZ
 */

/**
 * @typedef {Object} PlayerState
 * @property {Vec2} pos
 * @property {Vec2} prevPos        이전 틱 위치(렌더 보간용)
 * @property {Vec2} vel            m/s
 * @property {number} facing       rad
 * @property {number} prevFacing
 * @property {number} radius       0.4
 * @property {number} hp
 * @property {number} stamina
 * @property {number} staminaDelay 스태미나 회복 재개까지 남은 시간(초)
 * @property {boolean} exhausted   스태미나 0을 찍어 달리기/가드가 막힌 상태
 * @property {StatBlock} stats     현재 파생 능력치(hpMax · staminaMax는 여기서 읽는다)
 * @property {PlayerStateName} state
 * @property {number} stateTime    현재 상태 진입 후 경과(초)
 * @property {number} stateDur     현재 상태의 예정 길이(초). 무기한이면 0
 * @property {PlayerAttack|null} attack  state === 'attack' | 'execute' 일 때만 non-null
 * @property {boolean} iframe      이번 틱에 무적인가(구르기 창 · 넘어짐 · 처형 · 패링 자세 · 피격 직후 포함)
 * @property {boolean} guarding    이번 틱에 가드 판정이 서 있는가
 * @property {boolean} parryActive 이번 틱이 패링 창 안인가 (= state === 'guard' && parryT > 0)
 * @property {number} parryT       패링 창 남은 시간(초)
 * @property {number} parryArmT    가드 버튼을 누른 뒤, guard 상태에 들어가면 패링 창이 열리는 유예 남은 시간(초). 0이면 창이 열리지 않는다
 * @property {number} parryRearm   패링 창 재사용까지 남은 시간(초). 가드 입력을 뗀 틱에 건다
 * @property {boolean} guardHeldPrev 이전 틱의 input.guard(상승 에지 검출용. 히트스톱 틱에는 갱신하지 않는다)
 * @property {boolean} canExecute  이번 틱의 약공격 입력이 처형이 되는가(§7.1 처형 조건 && 현재 상태가 약공격을 받는다). P1이 매 틱 갱신
 * @property {boolean} lockOn      록온 중인가(대상은 항상 보스)
 * @property {boolean} sprinting
 * @property {number} sprintTime   달리기 지속(초) — 대시 공격 조건
 * @property {Vec2} rollDir        구르기 방향(단위 벡터)
 * @property {number} flasks       남은 플라스크
 * @property {InputBuffer} buffer
 * @property {number} hurtInvuln   피격 직후 무적 남은 시간(초)
 * @property {number} postRollT    구르기 직후 피해 증가 남은 시간(초)
 * @property {number} stepDist     발소리용 누적 이동 거리(m)
 * @property {Vec2} knockVel       넉백 속도(m/s) — 감쇠하며 pos에 더해진다
 * @property {number} [lightLock]  (W1) 후딜을 구르기 · 가드 · 플라스크로 캔슬한 뒤 약공격이 다시 허용되기까지 남은 시간(초). P1 내부용 —
 *                                 createPlayerState가 0으로 만든다. 없는 상태(리터럴)는 0으로 본다. 다른 패키지는 읽지 않는다
 * @property {number} [heavyLock]  (W1) 같은 뜻의 강공격 잠금(초) — 「강 → 가드 캔슬 → 강」으로 강 연타가 당겨지지 않게 한다(§7.1)
 */

// ───────────────────────── §3.5 보스 상태 · 보스 정의 ─────────────────────────

/**
 * @typedef {'intro'|'idle'|'chase'|'attack'|'parried'|'groggy'|'executed'|'recover'|'phaseShift'|'dead'} BossStateName
 *   intro      등장 연출(무적)             idle     다음 행동 고르는 중(플레이어 쪽으로 돈다)
 *   chase      거리 조절 이동(moveIntent)  attack   공격(세부는 attack 필드)
 *   parried    패링당해 튕겨남             groggy   체간 붕괴(처형 가능)
 *   executed   처형 타격을 맞는 중         recover  일어남
 *   phaseShift 2페이즈 전환 포효(무적)     dead     사망
 */

/**
 * @typedef {Object} BossAttackRuntime
 * @property {string} id           BossAttackDef.id
 * @property {number} seq          공격 인스턴스 일련번호(1부터 증가)
 * @property {string} pose         view용 포즈 키(BossAttackDef.pose)
 * @property {FxStyle|'none'} glow 예고 발광 색
 * @property {'windup'|'active'|'recovery'} phase
 * @property {number} phaseT       구간 진행도 0..1
 * @property {number} t            공격 시작 후 경과(초)
 * @property {number} windup       이번 인스턴스의 실제 예고 길이(초) — 페이즈/순환 배속 반영
 * @property {number} active       실제 판정 길이(초)
 * @property {number} recovery     실제 후딜 길이(초)
 * @property {boolean} locked      방향이 고정됐는가
 * @property {number} aimX         고정된 조준점(도약 착지 · 순간이동 기준). 고정 전에는 플레이어 현재 위치
 * @property {number} aimZ
 * @property {boolean} chained     연속기로 이어진 공격인가
 * @property {number[]} fired      이미 실행한 타임라인 이벤트 인덱스
 * @property {number[]} hitIds     hits[i]의 현재 hitId(틱 판정이면 틱마다 갱신)
 * @property {Object} [fw]         (W1) 프레임워크(P3) 내부 기억 — 순수 값 · structuredClone 가능. 없으면 P3가 그 자리에서 만든다. 다른 패키지는 읽지 않는다
 */

/**
 * @typedef {Object} BossState
 * @property {BossId} id
 * @property {Vec2} pos
 * @property {Vec2} prevPos
 * @property {number} facing
 * @property {number} prevFacing
 * @property {number} y            표현용 높이(m). 도약 · 부유. 판정에는 안 쓴다
 * @property {number} prevY
 * @property {number} radius       몸통 원 반경
 * @property {number} hp
 * @property {number} hpMax        순환 배율 반영
 * @property {number} posture      0..postureMax
 * @property {number} postureMax
 * @property {number} postureIdle  마지막 체간 피해 후 경과(초)
 * @property {1|2} phase
 * @property {boolean} pendingPhase 2페이즈 전환이 예약됐는가
 * @property {BossStateName} state
 * @property {number} stateTime
 * @property {number} stateDur
 * @property {BossAttackRuntime|null} attack   state === 'attack' 일 때만 non-null
 * @property {string[]} lastAttacks  최근 공격 id(최신이 [0], 길이 ≤ 2)
 * @property {Record<string, number>} cooldowns  attackId → 남은 초
 * @property {'approach'|'strafe'|'retreat'|'hold'} moveIntent
 * @property {1|-1} strafeDir
 * @property {number} chaseTime    후보 없이 chase를 이어 온 시간(초)
 * @property {boolean} invulnerable 피해 · 체간을 받지 않는가
 * @property {number} dmgMul       현재 피해 배율(순환 × 페이즈)
 * @property {number} speedMul     현재 공격 배속(순환 × 페이즈). windup · recovery를 이 값으로 나눈다
 * @property {number} stepDist     발소리용 누적 이동 거리
 * @property {Object} ext          보스별 확장 필드(훅이 쓴다). §8.10~8.12의 보스별 절에 필드를 적는다
 * @property {Object} [fw]         (W1) 프레임워크(P3) 내부 기억(onCreate 호출 여부 · seq 카운터 · 스트레이프 타이머 등). 다른 패키지는 읽지 않는다
 * @property {boolean} [postureGuard]  (W5) 체간 잠금 — 그로기에서 일어난 뒤 다음 공격의 판정이 시작될 때까지 true. 그동안 체간이 쌓이지 않는다(피해는 들어간다 — §8.7). HUD가 읽어 체간 바를 잠금 표시한다
 */

/**
 * @typedef {Object} BossHitDef
 * @property {number} t0           판정 시작 = 0 기준(초). §8.1의 tA
 * @property {number} t1           판정 끝
 * @property {number} interval     > 0이면 t0부터 이 간격으로 반복 타격(브레스). 0이면 한 번
 * @property {ShapeDef} shape
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} parryable
 * @property {boolean} knockdown
 * @property {boolean} telegraph   예고 중 바닥 표식을 그릴까
 * @property {ShapeDef} [telegraphShape]  표식만 다른 모양일 때(돌진의 긴 선 · 광선이 쓸고 가는 부채 전체)
 * @property {'self'|'aim'} [telegraphAt]  표식 원점. 기본 'self'(보스 위치·방향), 'aim'은 조준점
 */

/**
 * @typedef {Object} BossMoveDef
 * @property {'lunge'|'charge'|'leap'|'hop'} kind
 * @property {number} t0           이동 시작(tA 기준 초, 음수 = 예고 중)
 * @property {number} t1           이동 끝
 * @property {number} dist         최대 이동 거리(m)
 * @property {number} [stopShort]  lunge · leap: 대상 중심에서 이만큼 못 미쳐 멈춘다(m). 기본 radius + BOSS_AI.stopShortPad
 * @property {number} [height]     leap · hop: 정점 높이(m, 표현용 y)
 * @property {number} [aimLock]    leap: 조준점이 고정되는 시각(tA 기준 초, 음수)
 */

/**
 * @typedef {Object} BossTimelineEvent
 * @property {number} t            실행 시각(tA 기준 초)
 * @property {'projectile'|'hazard'|'teleport'|'cue'|'hook'} type
 * @property {1|2} [phase]         이 페이즈에서만 실행(없으면 항상)
 * @property {ProjectileSpec} [proj]     type 'projectile'
 * @property {number} [count]            projectile · hazard 개수(기본 1)
 * @property {number} [interval]         개수 > 1일 때 발사/소환 간격(초)
 * @property {number} [spread]           projectile: 부채 전체 각(rad)
 * @property {{fwd:number, side:number}} [origin]  projectile 발사점(보스 로컬)
 * @property {HazardSpec} [hazard]       type 'hazard'
 * @property {HazardPlace} [place]       type 'hazard'
 * @property {'away'|'behindTarget'|'flank'|'center'} [to]  type 'teleport'
 * @property {number} [dist]             teleport: 대상에서의 거리(m)
 * @property {string} [cue]              type 'cue' — §4의 큐 어휘
 * @property {number[]} [shake]          cue: [진폭 m, 길이 초] — 있으면 CAMERA_SHAKE도 낸다
 * @property {Object} [params]           cue payload에 그대로 실린다(length · halfAngle 등)
 * @property {string} [name]             type 'hook' — hooks.onTimelineEvent로 넘어간다
 */

/**
 * @typedef {Object} HazardPlace
 * @property {'self'|'target'|'aim'|'scatter'|'ringAround'|'chase'} mode
 *   self: 보스 위치 · 방향   target: 플레이어 현재 위치   aim: 공격의 조준점
 *   scatter: 플레이어 중심 radius 안의 무작위 count개(첫 개는 플레이어 위치)
 *   ringAround: 보스 중심 radius 원 위에 count개 균등
 *   chase: interval마다 그 순간의 플레이어 위치(+lead초 예측)에 하나씩, count개
 * @property {number} [radius]
 * @property {number} [lead]       초. 플레이어 속도 × lead 만큼 앞을 겨눈다
 */

/**
 * @typedef {Object} BossAttackSelect
 * @property {number} minRange     중심 간 거리(m)
 * @property {number} maxRange
 * @property {number} [minAngle]   |정면에서 플레이어까지의 각| 하한(rad). 기본 0
 * @property {number} [maxAngle]   상한. 기본 π
 * @property {number} weight
 * @property {number} cooldown     초
 * @property {1|2} [minPhase]      기본 1
 * @property {1|2} [maxPhase]      기본 2
 */

/**
 * @typedef {Object} BossChainDef
 * @property {string} next
 * @property {number} chance       1페이즈 확률
 * @property {number} chanceP2     2페이즈 확률
 * @property {number} at           후딜 진입 후 이 시간(초)에 판정해 넘어간다
 * @property {number} [maxRange]   플레이어가 이 거리 안일 때만
 */

/**
 * @typedef {Object} BossAttackDef
 * @property {string} id
 * @property {string} pose               view 포즈 키
 * @property {FxStyle|'none'} glow
 * @property {number} windup             예고(초) — 0.45 이상
 * @property {number} active             판정 구간 전체 길이(초)
 * @property {number} recovery           후딜(초)
 * @property {BossAttackSelect|null} sel null이면 연속기 전용(AI가 직접 고르지 않는다)
 * @property {BossHitDef[]} hits
 * @property {BossMoveDef|null} move
 * @property {{turnRate:number, lockLead:number, activeTurnRate?:number, sweep?:{from:number,to:number}}} track
 *   turnRate: 예고 중 추적 각속도(rad/s). lockLead: 판정 시작 이만큼 전에 방향 고정(초).
 *   activeTurnRate: 판정 중 추적 각속도(브레스). sweep: 판정 중 고정 방향 기준 from→to로 회전(광선)
 * @property {BossTimelineEvent[]} events
 * @property {BossChainDef[]} chain
 */

/**
 * @typedef {Object} BossDef
 * @property {BossId} id
 * @property {'humanoid'|'quadruped'|'floater'} rig
 * @property {string} arenaId            data/world.js의 WORLDS 키
 * @property {FxStyle} style             대표 색
 * @property {number} hp
 * @property {number} postureMax
 * @property {number} postureDecayDelay  초
 * @property {number} postureDecayRate   초당
 * @property {number} radius             중심 원 반경(m). 월드 충돌 · AI 거리 · 플레이어의 전진 정지/처형 거리 · 봇 사거리는 이 원만 본다
 * @property {BossBodyPart[]} [bodyParts] 몸통 원들. 생략하면 [{fwd: 0, r: radius}]. **P2만 쓴다** — 플레이어 타격의 명중 검사(어느 한 원)와
 *                                        몸통 밀어내기(모든 원). 긴 몸(사족)이 머리 · 엉덩이에서도 맞고 막히게 한다
 * @property {number} height             표현용 키(m)
 * @property {number} moveSpeed          m/s
 * @property {number} turnRate           idle/chase 회전(rad/s)
 * @property {number} preferredRange     chase가 맞추려는 거리(m)
 * @property {boolean} kite              true면 플레이어가 가까울 때 물러난다(원거리형)
 * @property {number} stride             발소리 간격(m). 0이면 발소리 없음
 * @property {[number, number]} think    공격 사이 고민 시간 [min, max] 초
 * @property {number} introDur
 * @property {number} parriedDur
 * @property {number} groggyDur
 * @property {number} executedDur
 * @property {number} recoverDur
 * @property {number} phaseShiftDur
 * @property {{hpFrac:number, speedMul:number, dmgMul:number, thinkMul:number, moveSpeedMul:number}} phase2
 * @property {string} fallbackAttack     후보가 계속 없을 때 강제로 쓰는 공격 id
 * @property {number} reward             격파 기본 잔불
 * @property {Record<string, BossAttackDef>} attacks
 */

/**
 * 보스 전용 로직의 확장 지점. 전부 선택.
 * @typedef {Object} BossHooks
 * @property {(ctx:SimCtx)=>void} [onCreate]              ext 초기화
 * @property {(ctx:SimCtx, dt:number)=>void} [onTick]     매 틱(상태 갱신 뒤)
 * @property {(ctx:SimCtx, cands:{id:string, weight:number}[])=>void} [adjustWeights]  후보 가중치를 제자리에서 고친다
 * @property {(ctx:SimCtx)=>string|null} [forceAttack]    non-null이면 AI 선택을 건너뛰고 이 공격
 * @property {(ctx:SimCtx, atk:BossAttackRuntime)=>void} [onAttackStart]
 * @property {(ctx:SimCtx, atk:BossAttackRuntime)=>void} [onAttackEnd]
 * @property {(ctx:SimCtx, ev:BossTimelineEvent)=>void} [onTimelineEvent]  type 'hook'
 * @property {(ctx:SimCtx, phase:number)=>void} [onPhaseChange]
 */

/** 보스 몸통을 이루는 원 하나. 보스 로컬(facing 기준) — 중심에서 앞으로 fwd(m), 반경 r(m).
 * @typedef {{fwd:number, r:number}} BossBodyPart */

// ───────────────────────── §3.6 투사체 · 장판 · 텔레그래프 ─────────────────────────

/**
 * @typedef {Object} ProjectileSpec
 * @property {string} kind         표현 키(부록 A)
 * @property {FxStyle} style
 * @property {number} speed        m/s
 * @property {number} r            반경(m)
 * @property {number} life         초
 * @property {number} homing       유도 각속도(rad/s). 0이면 직선
 * @property {number} homingTime   유도가 유지되는 시간(초)
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} parryable   패링으로 쳐낼 수 있는가(쳐내면 소멸 + 보스 체간 — §6.4)
 * @property {boolean} knockdown
 * @property {number} y            표현용 높이(m)
 */

/**
 * @typedef {Object} Projectile
 * @property {number} id
 * @property {string} kind
 * @property {FxStyle} style
 * @property {number} x
 * @property {number} z
 * @property {number} prevX
 * @property {number} prevZ
 * @property {number} y
 * @property {number} dir          진행 방향(rad)
 * @property {number} speed
 * @property {number} r
 * @property {number} age          초
 * @property {number} life
 * @property {number} homing
 * @property {number} homingTime
 * @property {number} damage       순환/페이즈 배율이 곱해진 값
 * @property {boolean} guardable
 * @property {boolean} parryable
 * @property {boolean} knockdown
 * @property {number} hitId
 */

/**
 * 장판은 항상 패링 불가다(필드 없음).
 * @typedef {Object} HazardSpec
 * @property {string} kind         표현 키(부록 A)
 * @property {FxStyle} style
 * @property {ShapeDef} [shape]    장판 원점 · 방향 기준. grow가 있으면 생략한다(shape와 grow 중 정확히 하나)
 * @property {number} warn         경고 시간(초). 이 동안 바닥 표식만 보인다
 * @property {number} active       판정 시간(초)
 * @property {number} interval     > 0이면 active 동안 이 간격으로 반복 타격. 0이면 한 번
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} knockdown
 * @property {{r0:number, r1:number, width:number}} [grow]  충격파: active 동안 띠 중심 반경이 r0→r1로 커진다
 */

/**
 * @typedef {Object} Hazard
 * @property {number} id
 * @property {string} kind
 * @property {FxStyle} style
 * @property {'warn'|'active'} state
 * @property {number} t            현재 state에서의 경과(초)
 * @property {number} warn
 * @property {number} active
 * @property {number} interval
 * @property {HitShape} shape      **월드 공간** 현재 모양(grow면 매 틱 갱신)
 * @property {number} damage
 * @property {boolean} guardable
 * @property {boolean} knockdown
 * @property {number} hitId
 * @property {number} nextTick     다음 반복 타격까지 남은 시간(초)
 * @property {{r0:number, r1:number, width:number}|null} grow
 * @property {number} x            원점
 * @property {number} z
 * @property {number} [facing]     (W1) 생성 시 방향(rad) — 장판 판정의 OutgoingHit.facing 출처(§3.2). spawnHazard가 채운다. 없으면 0으로 본다
 */

/**
 * 바닥 예고 표식. GameSim이 매 틱 다시 만든다(state.telegraphs). view는 id로 생성/갱신/제거한다.
 * @typedef {Object} Telegraph
 * @property {string} id           'atk:<seq>:<hitIndex>' | 'hz:<hazardId>'
 * @property {HitShape} shape      월드 공간
 * @property {number} progress     0..1 — 1이 되는 순간 판정이 시작된다
 * @property {FxStyle} style
 * @property {'boss'|'hazard'} source
 */

/** P3가 내놓는 미해결 텔레그래프(P2가 월드로 푼다).
 * @typedef {{id:string, shapeDef:ShapeDef, x:number, z:number, facing:number, progress:number, style:FxStyle}} TelegraphSrc */

// ───────────────────────── §3.7 월드 ─────────────────────────

/**
 * @typedef {({type:'circle', x:number, z:number, r:number} |
 *            {type:'box', x:number, z:number, hw:number, hd:number})} Collider
 *   box는 축 정렬. hw = x 반폭, hd = z 반폭
 */

/**
 * @typedef {Object} WorldDef
 * @property {string} id            'town' | 'arena_valder' | 'arena_fenrir' | 'arena_nihil'
 * @property {'town'|'arena'} kind
 * @property {'town'|'ember'|'frost'|'void'} theme
 * @property {number} radius        원형 경계 반경(m). 중심은 원점
 * @property {Collider[]} colliders
 * @property {{x:number, z:number, facing:number}} playerSpawn
 * @property {{x:number, z:number, facing:number}|null} bossSpawn
 * @property {{id:FacilityId, x:number, z:number, r:number}[]} facilities  상호작용 지점과 반경(마을만)
 * @property {{x:number, z:number}|null} dummy   허수아비 위치(마을만)
 * @property {{id:string, x:number, z:number, facing:number}[]} npcs  'blacksmith' | 'merchant'
 */

// ───────────────────────── §3.8 게임 상태 ─────────────────────────

/**
 * @typedef {Object} FightState
 * @property {BossId} bossId
 * @property {'intro'|'fight'|'outro'|'done'} phase
 * @property {number} time          'fight' 구간 누적(초)
 * @property {number} phaseTime     현재 phase 경과(초)
 * @property {number} damageDealt   보스에게 준 피해 합(HP 기준, hpMax를 넘지 않는다)
 * @property {number} damageTaken
 * @property {number} parries
 * @property {number} executions
 * @property {null|'victory'|'death'} outcome
 * @property {RewardResult|null} reward
 */

/**
 * @typedef {Object} DummyState
 * @property {number} x
 * @property {number} z
 * @property {number} radius        0.5
 * @property {number} lastDamage    마지막 타격 피해
 * @property {number} total         누적 피해(3초 맞지 않으면 0으로)
 * @property {number} sinceHit      마지막 타격 후 경과(초)
 */

/**
 * @typedef {Object} GameState
 * @property {'town'|'boss'} mode
 * @property {number} tick          step 호출 횟수(히트스톱 틱 포함)
 * @property {number} time          시뮬레이션 시간(초). 히트스톱 중에는 멈춘다
 * @property {number} hitstop       남은 히트스톱(초)
 * @property {WorldDef} world       현재 월드(data/world.js의 객체 참조 — 고치지 않는다)
 * @property {PlayerState} player
 * @property {BossState|null} boss
 * @property {DummyState|null} dummy
 * @property {Projectile[]} projectiles
 * @property {Hazard[]} hazards
 * @property {Telegraph[]} telegraphs
 * @property {FightState|null} fight
 * @property {FacilityId|null} nearFacility  마을에서 상호작용 가능한 시설(없으면 null)
 * @property {Profile} profile      살아 있는 프로필 참조(Progression과 같은 객체)
 * @property {{godMode:boolean, noStamina:boolean}} debug
 * @property {{name:string, payload:Object}[]} events  이번 틱에 쌓인 이벤트 큐(플러시 뒤 빈다)
 * @property {{hitId:number, target:'player'|'boss'|'dummy'}[]} hitLog  판정 등록부(같은 hitId × 대상은 한 번만).
 *                                  등록 시 push, 길이가 COMBAT.hitLogMax를 넘으면 앞에서 버린다. 모드 전환 때 비운다
 * @property {number} rngState      시드 난수 상태(uint32)
 * @property {number} nextId        hitId · 투사체 · 장판 id 공용 카운터
 */

/**
 * P1 · P3가 받는 틱 컨텍스트. GameSim이 한 번 만들어 재사용한다.
 * @typedef {Object} SimCtx
 * @property {GameState} state
 * @property {Rng} rng
 * @property {(name:string, payload?:Object)=>void} emit       state.events에 쌓는다
 * @property {()=>number} nextHitId
 * @property {(seconds:number)=>void} requestHitstop           max(현재, 요청), 상한 COMBAT.hitstopMax
 * @property {(amp:number, dur:number)=>void} shake            CAMERA_SHAKE를 쌓는다
 * @property {(spec:ProjectileSpec, x:number, z:number, dir:number, damageMul:number)=>Projectile} spawnProjectile
 * @property {(spec:HazardSpec, x:number, z:number, facing:number, damageMul:number)=>Hazard} spawnHazard
 * @property {BossDef|null} bossDef      현재 보스 정의(마을이면 null). P3는 레지스트리 대신 이것을 읽는다
 * @property {BossHooks} bossHooks       현재 보스 훅(없으면 {})
 * @property {CycleScaling} scaling      현재 순환 배율(마을이면 전부 1)
 */

// ───────────────────────── §3.9 진행 · 보상 · 저장 · 설정 ─────────────────────────

/**
 * @typedef {Object} BossProgress
 * @property {boolean} unlocked
 * @property {number} attempts        누적 도전 횟수
 * @property {number} totalKills
 * @property {number} killsThisCycle
 * @property {number} bestFraction    이번 순환 최고 피해 비율 0..1
 * @property {number} milestones      이번 순환에 받은 파편 구간 수(0..3 — 0.25 · 0.5 · 0.75)
 */

/**
 * @typedef {Object} Profile
 * @property {number} embers
 * @property {number} shards
 * @property {{vit:number, end:number, str:number, dex:number}} stats   투자 점수(0..40)
 * @property {Record<WeaponId, {level:number}>} weapons
 * @property {WeaponId} equippedWeapon
 * @property {number} flaskChargeLv   0..3
 * @property {number} flaskHealLv     0..5
 * @property {string[]} relicsOwned
 * @property {[string|null, string|null]} relicsEquipped
 * @property {number} cycle           0부터
 * @property {Record<BossId, BossProgress>} bosses
 * @property {{deaths:number, kills:number, embersEarned:number, playTime:number}} totals  applyReward가 갱신한다(playTime = 교전 시간 합, 초)
 * @property {number} seed            uint32 — 다음 보스전 시드의 재료
 */

/**
 * @typedef {Object} RewardResult
 * @property {BossId} bossId
 * @property {number} cycle           이 보상이 계산된 순환
 * @property {boolean} victory
 * @property {number} damageFraction  0..1
 * @property {number} duration        이 판의 교전 시간(초) = fight.time
 * @property {number} embers          이번에 받은 잔불(정수)
 * @property {number} shards          이번에 받은 파편
 * @property {number[]} milestones    새로 달성한 구간 [0.25, 0.5 …]
 * @property {boolean} firstKill      이번 순환 첫 격파인가
 * @property {number} repeatMul       재도전 감쇠 배율(1 · 0.5 · 0.25)
 * @property {BossId|null} unlocked   새로 열린 보스
 * @property {boolean} cycleAdvanced  이 보상으로 순환이 올랐는가
 * @property {number} embersAfter     지급 후 보유 잔불
 */

/**
 * @typedef {Object} Settings
 * @property {number} mouseSensitivity 0.2..3 (기본 1)
 * @property {boolean} invertY
 * @property {number} volumeMaster    0..1 (기본 0.8)
 * @property {number} volumeSfx       0..1 (기본 1)
 * @property {number} volumeMusic     0..1 (기본 0.6)
 * @property {'low'|'medium'|'high'} quality  (기본 'medium')
 * @property {number} cameraShake     0..1 (기본 1)
 * @property {boolean} damageNumbers  (기본 true)
 */

/**
 * 설정은 세이브에 넣지 않는다 — 별도 키(SETTINGS_KEY)에 따로 저장한다(§11.4).
 * @typedef {Object} SaveData
 * @property {number} version         현재 1
 * @property {number} savedAt         epoch ms(app이 채운다 — sim은 Date를 쓰지 않는다)
 * @property {Profile} profile
 */

/** @typedef {{ok:boolean, reason?:'embers'|'shards'|'max'|'locked'|'owned'|'invalid'}} CmdResult */

/**
 * @typedef {Object} CycleScaling
 * @property {number} hpMul
 * @property {number} dmgMul
 * @property {number} rewardMul
 * @property {number} speedMul        공격 배속에 곱한다
 * @property {number} thinkMul        고민 시간에 곱한다
 * @property {number} chainBonus      연속기 확률에 더한다
 */

/** @typedef {{next:()=>number, range:(a:number,b:number)=>number, int:(a:number,b:number)=>number,
 *             chance:(p:number)=>boolean, pick:<T>(arr:T[])=>T, getState:()=>number, setState:(s:number)=>void}} Rng */

// ───────────────────────── §9 view ─────────────────────────

/**
 * 포즈(§9.5).
 * @typedef {{rot: Record<string, [number, number, number]>, pos?: Record<string, [number, number, number]>}} Pose
 *  rot: 관절별 로컬 오일러 XYZ(rad) — rest(0,0,0) 기준 절대값
 *  pos: 관절별 위치 오프셋(m) — rest 위치에 더한다. 주로 hips(웅크림 · 도약)
 */

/**
 * 공격 포즈 묶음(§9.5 attackPose의 set).
 * @typedef {{windup: Pose, active: Pose, follow?: Pose, holdAt?: number}} PoseSet
 */

/**
 * 렌더 컨텍스트(§9.2). view/renderer.js의 createRenderContext가 만든다.
 * @typedef {Object} RenderContext
 * @property {import('three').WebGLRenderer} renderer   ACESFilmic 톤매핑 · sRGB 출력 · PCFSoft 그림자
 * @property {import('three').Scene} scene              배경 PALETTE.bg · FogExp2
 * @property {import('three').PerspectiveCamera} camera fov 60 · near 0.1 · far 200
 * @property {(q:'low'|'medium'|'high')=>void} setQuality
 * @property {(w:number, h:number)=>void} resize
 * @property {(dt:number)=>void} render       후처리 포함 한 프레임
 * @property {()=>void} dispose
 */

/**
 * 보스 뷰(§9.6). view/bosses/index.js의 createBossView(bossId)가 고른다.
 * @typedef {Object} BossView
 * @property {import('three').Object3D} root   CharacterLayer가 위치 · 회전을 넣는다
 * @property {import('./view/characters/rig.js').Rig} rig
 * @property {(boss:BossState, info:{alpha:number, dt:number, time:number, state:GameState})=>void} update
 * @property {(name:string, payload:Object)=>void} [onEvent]   HIT · BOSS_* 이벤트
 * @property {()=>void} dispose
 */

// ───────────────────────── §10 ui ─────────────────────────

/** @typedef {'title'|'pause'|'bonfire'|'blacksmith'|'merchant'|'gate'|'result'} PanelId */

/**
 * app이 UIRoot에 넘겨주는 콜백 묶음(§10.1).
 * @typedef {Object} UiActions
 * @property {()=>boolean} hasSave
 * @property {()=>void} newGame
 * @property {()=>void} continueGame
 * @property {(bossId:BossId)=>void} startBoss
 * @property {()=>void} retry
 * @property {()=>void} toTown        마을로. 보스전 교전 중이면 app이 sim.forfeitFight()를 먼저 부른다(§11.2)
 * @property {()=>void} resume
 * @property {()=>void} quitToTitle
 * @property {(partial:Partial<Settings>)=>void} applySettings
 */

export {};
