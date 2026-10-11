// OWNER: P0 — 계약 §3 타입 카탈로그 (W0 완성 · 이후 고치지 않는다 — 결함은 NOTES-P#)
// JSDoc 타입만 있다. 끌어 쓰기: /** @typedef {import('../types.js').MonsterState} MonsterState */ (상대 경로는 파일 위치에 맞춘다)
// 필드 주석의 단위 · 범위가 계약이다. 시간 필드: 이름 끝 At · Until · start · end · born · at · actStart/Hit/End = 절대 틱 · 끝 T = 틱 수.

// ───────────────────────── §3.1 기초 ID · 열거 ─────────────────────────

/** @typedef {{x:number, z:number}} Vec2 */
/** @typedef {'warrior'|'mage'} ClassId */
/** @typedef {'town'|'rift'} SceneId */
/** @typedef {'mainHand'|'offhand'|'helm'|'chest'|'gloves'|'boots'|'belt'|'amulet'|'ring1'|'ring2'} EquipSlot */
/** @typedef {'mainHand'|'offhand'|'helm'|'chest'|'gloves'|'boots'|'belt'|'amulet'|'ring'} ItemSlot */
/** @typedef {'normal'|'magic'|'rare'|'legendary'|'set'} Rarity */
/** @typedef {'normal'|'champion'|'elite'|'minion'|'guardian'|'split'|'spawn'} MonRank
 *  split = 분열 속성의 사본 — RANKS.split 값 그대로(경험치 0.25 · 게이지 0.1 · tc 'split' — flags로 끄지 않는다)
 *  spawn = 둥지 새끼 · 마녀의 하수인 — RANKS.spawn(경험치 · 게이지 0 · tc null). 주술사가 되살린 소인은 rank normal + flags {noXp, noDrops, noGauge, revived}(§8.1) */
/** @typedef {'phys'|'fire'|'cold'|'lightning'} DmgType */
/** @typedef {'crypt'|'cavern'|'town'} TilesetId */
/** @typedef {'scrap'|'dust'|'essence'} MaterialId   고철 · 비전 가루 · 망각의 정수 */
/** @typedef {'str'|'int'} MainStat */
/** @typedef {'rage'|'mana'} ResourceKind */
/** @typedef {'active'|'guardian'|'complete'|'collapsed'} RiftPhase
 *  active = 게이지 모으는 중 · guardian = 게이지 100%(수호자 예고 · 전투) · complete = 수호자 처치 · collapsed = 붕괴(생명 0에서 사망) */
/** @typedef {'idle'|'move'|'attack'|'cast'|'channel'|'dash'|'leap'|'blink'|'recall'|'dead'} PlayerAct */
/** @typedef {'idle'|'move'|'windup'|'strike'|'recover'|'cast'|'channel'|'charge'|'stunned'|'frozen'|'flinch'|'swell'|'flee'|'vanish'|'spawning'|'dead'} MonAct */
/** @typedef {'humanoid'|'small'|'quadruped'|'blob'|'nest'} MonTemplate */
/** @typedef {'monster'|'drop'|'object'} HoverKind */
/** @typedef {({kind:'monster', id:number}|{kind:'drop', id:number}|{kind:'object', id:string}) & {src?:'pick'|'label'}} Hover
 *  object = 마을 물체(blacksmith · general · gambler · mystic · stash · riftStone · townPortal) · 균열 포털('portal:<n>')
 *  src = app이 고른 경로(광선 'pick' · 바닥 이름표 'label' — 봇은 'pick' · 없으면 'pick') — 대상 검사가 다르다(§5.2-1) */
/** @typedef {'npc'|'stash'|'riftStone'|'townPortal'|'riftPortal'} InteractKind */
/** @typedef {'item'|'gold'|'potion'|'globe'|'material'} DropKind */
/** @typedef {'circle'|'cone'|'line'|'ring'|'poly'} ShapeType */
/** @typedef {'low'|'medium'|'high'} QualityId */
/** @typedef {'title'|'charSelect'|'newChar'|'pause'|'settings'|'help'|'death'|'riftComplete'|'confirm'|'hint'|'map'
 *   |'inventory'|'skills'|'character'|'blacksmith'|'general'|'gambler'|'mystic'|'stash'|'riftStone'|'analytics'} PanelId */
/** @typedef {'boot'|'title'|'play'|'fatal'} ScreenId */
/** @typedef {'controls'|'labels'|'elites'|'bagFull'|'death'|'skills'|'gauge'|'town'} HintId */

// ───────────────────────── §3.2 입력 ─────────────────────────

/** @typedef {Object} InputFrame
 * @property {Vec2|null} cursor      커서 아래 바닥 점(월드 m · y=0 평면). 캔버스 밖 · 포커스 없음이면 null — null이면 누르고 있던 이동이 멈춘다(브리프 §6)
 * @property {Hover|null} hover      커서 아래 대상. sim은 그 대상이 살아 있고 cursor에서 가까운지(§5.2-1) 검사한 뒤 쓴다
 * @property {boolean} lmb           좌클릭 누르고 있음
 * @property {boolean} lmbDown       이번 틱의 누름 에지
 * @property {boolean[]} slot        길이 5 · [0] = 우클릭(스킬 바 0) · [1..4] = Digit1..4(스킬 바 1..4) 누르고 있음
 * @property {boolean[]} slotDown    길이 5 · 누름 에지
 * @property {boolean} shift         제자리 공격 · 시전(ShiftLeft/Right)
 * @property {boolean} potionDown    KeyQ 에지
 * @property {boolean} recallDown    KeyT 에지
 */

// ───────────────────────── §3.3 데이터 정의 ─────────────────────────

/** @typedef {Object} ClassDef
 * @property {ClassId} id
 * @property {MainStat} mainStat
 * @property {ResourceKind} resource
 * @property {{base:number, growth:number}} life           생명 = base × growth^(레벨−1) × (1 + 활력 × COMBAT.vitLife + 생명%) (§5.6)
 * @property {{base:number, perLevel:number}} resourceMax  자원 최대 = base + perLevel × (레벨−1) (+ 장비 mana)
 * @property {{base:number, perLevel:number}} regen        마나/초 (분노는 0)
 * @property {null|{onBasicHit:number, perExtraTarget:number, extraCap:number, onHitTaken:number, takenCapPerSec:number, decayDelay:number, decayPerSec:number}} rage
 * @property {number} moveSpeed    m/s (6)
 * @property {number} radius       m (0.40)
 * @property {number} height       m (1.8 — view · 마우스 판별)
 * @property {string} basic        기본 공격 스킬 ID ('bash' | 'magicBolt')
 * @property {Array<{baseId:string, tier:number}>} startGear   일반 등급 · ilvl 1
 * @property {string[]} mainHandBases     낄 수 있는 주무기 기본형 ID
 * @property {string[]} offhandBases      낄 수 있는 보조 기본형 ID
 */

/** @typedef {'meleeBasic'|'boltBasic'|'cone'|'quake'|'dash'|'spin'|'buff'|'leap'|'fireball'|'meteor'|'nova'|'shield'|'chain'|'blink'} SkillBehaviorId */
/** @typedef {'aoe'|'melee'|'projectile'|'movement'|'buff'|'channel'|'dot'|'chain'} SkillTag */
/** @typedef {Object} SkillDef   (액티브 · 기본 공격의 동작 수치 — §7.2)
 * @property {SkillBehaviorId} behavior
 * @property {'target'|'direction'|'point'|'self'} targeting
 * @property {DmgType|null} type
 * @property {SkillTag[]} tags
 * @property {number} cost          자원(시전 시작에 지불)
 * @property {number} [costPerSec]  채널 유지 비용/초
 * @property {number} [gen]         시전에 얻는 자원
 * @property {number|number[]} cd   초(0 = 없음) · 배열이면 랭크별([rank − 1] — 순간이동)
 * @property {number} action        행동 길이(초) — scaled면 APS_REF(1.4)에서의 값 · 돌진은 거리/params.speed 에 더하는 꼬리 · 회오리는 채널 틱 간격
 * @property {boolean} scaled       true면 행동 길이 = action × APS_REF / stats.aps
 * @property {number} hitFrac       판정 시점 = 행동 시작 + action × hitFrac
 * @property {number} [range]       사거리 · 최대 거리(m) @property {number} [radius] 원 · 원뿔 반지름(m) @property {number} [angleDeg] 원뿔 전체 각(도) @property {number} [width] 선 폭(m)
 * @property {number} [reach]       근접 사거리 — 몸 가장자리 사이(m · 강타 1.1)
 * @property {number[]} coef        랭크별 무기 피해 계수(길이 = maxRank · 기본 공격은 1)
 * @property {{stun?:number[], chill?:number|number[], burnFrac?:number, shockChance?:number, knock?:number, slowPct?:number, slowSec?:number}} [status]
 *                                  적중이 싣는 상태 이상(배열이면 랭크별 [rank−1] · 비율은 0..1 — §7.2)
 * @property {Object} [params]      동작 수치(§7.2 표의 「params」 · §8.4가 읽는 키 — 변형 · 전설 패치 키는 넣지 않는다 · 비율은 0..1 · 최소 거리는 minRange)
 */
/** @typedef {Object} SkillNode
 * @property {string} id
 * @property {ClassId} cls
 * @property {0|1|2} branch
 * @property {1|2|3|4} tier         단계 해금 = 그 클래스 트리에 쓴 점수 TREE.tierPoints[tier−1](0 · 5 · 10 · 15)
 * @property {'active'|'passive'|'transform'} kind
 * @property {number} maxRank
 * @property {string} [req]         변형: 이 액티브가 1랭크 이상이어야 찍는다
 * @property {SkillDef} [skill]     액티브
 * @property {Object<string, number[]>} [stats]      패시브: StatKey → 랭크별 값(아이템 옵션과 같은 단위 — 퍼센트 숫자)
 * @property {string} [cond]        조건부 패시브: CondId(§5.7) — condStats는 그 조건이 참인 적중에만
 * @property {Object<string, number[]>} [condStats]
 * @property {string} [transforms]  변형: 대상 액티브 ID(= req)
 * @property {Object} [patch]       변형: 대상 액티브의 skill.params에 덮어쓸 값(§8.4)
 */

/** @typedef {Object} AttackDef     (몬스터 공격 한 가지)
 * @property {string} id
 * @property {'melee'|'projectile'|'charge'|'explode'|'spawn'|'cast'} kind
 * @property {number} windup        예고(초) — 이 동안 자세 · 표식이 보인다(바닥 표식 · cast 공격은 이 값이 그 효과의 예고 길이 — 빠름을 곱하지 않는다 §5.17-5)
 * @property {number} recover       후딜(초)
 * @property {number} cd            같은 공격의 재사용 대기(초)
 * @property {number} [reach]       근접: 몸 가장자리 사이 거리(m) — 시작은 중심 거리 ≤ mon.r + reach + player.r · 판정은 + MON.reachTolerance(0.3)
 * @property {number} [coneDeg]     근접 판정 원뿔(도 · 공격 시작 때의 facing 기준)
 * @property {number} [range]       원거리 · 돌진: 쓰기 시작하는 중심 거리 상한(m)
 * @property {number} [minRange]
 * @property {number} mul           × mon.dmg
 * @property {DmgType} type
 * @property {'pose'|'aimLine'|'groundLine'|'groundCircle'|'glow'} telegraph
 * @property {{speed:number, r:number, life:number, visual:string}} [proj]
 * @property {number} [aimLock]     원거리: 발사 전 이 초부터 조준이 멈춘다(그 전에는 플레이어를 따라간다)
 * @property {number} [push]        근접 적중 시 플레이어를 미는 거리(m · PLAYER.pushSec 0.15초에 걸쳐 — §5.6)
 * @property {number} [escape]      바닥 표식을 만드는 공격: 표식이 시작될 때 최악 자리에서 판정 밖까지 걷는 거리(m — H5 §5.9 · data 검사)
 * @property {{chillSec?:number}} [onHit]
 * @property {Object} [params]      그 공격에만 걸린 값(돌진 · 폭발 · 소환 · 부활 · 수호자 기술의 모양 shape · r · len …)
 */
/** @typedef {Object} MonsterDef
 * @property {string} id
 * @property {MonTemplate} template
 * @property {Array<'melee'|'ranged'|'support'|'swarm'|'structure'|'spawnling'>} tags
 * @property {string} behavior      BEHAVIORS 키(§8.1)
 * @property {number} radius        m(등급 배율 전)
 * @property {number} height        m(마우스 판별 · view)
 * @property {number} speed         m/s
 * @property {number} turnRate      rad/s
 * @property {number} hp            × MON.hpBase
 * @property {number} dmg           × MON.dmgBase
 * @property {number} xp            × XP.base
 * @property {number} gauge         × 등급 게이지
 * @property {Record<DmgType, number>} res   저항(0..0.75 — 받는 피해 × (1 − res))
 * @property {number} aggro         m — 이 거리 안 · 시야가 트이면 깬다
 * @property {boolean} eliteOk      챔피언 · 정예가 될 수 있다
 * @property {AttackDef[]} attacks
 * @property {Object} params        행동 전체에 걸린 값(§7.4 — 도망 · 거리 유지 · 정면 막기 frontBlock)
 * @property {{color:string, variant:string}} look   view 힌트(색 · 변형 이름)
 */
/** @typedef {Object} RankDef
 * @property {MonRank} id
 * @property {number} hp @property {number} dmg @property {number} xp
 * @property {number} gauge         게이지 %(× 종류 gauge)
 * @property {string|null} tc       TREASURE 키(null = 드랍 없음)
 * @property {number} scale         몸 크기 배율(반지름 · 높이 · 모델)
 * @property {number} stunMul @property {number} freezeMul @property {number} knockMul
 * @property {number|null} flinchFrac   한 번에 최대 생명의 이 비율 이상 맞으면 경직(null = 경직 없음)
 */
/** @typedef {Object} MonAffixDef
 * @property {string} id
 * @property {string} hook          AFFIX_HOOKS 키(= id)
 * @property {{hpMul?:number, speedMul?:number, atkSpeedMul?:number, res?:Partial<Record<DmgType,number>>, immune?:Array<'flinch'|'knock'>}} mods
 * @property {Object} params        훅 수치(§7.5 — 바닥 위협을 만드는 속성은 예고 `delay` · 탈출 거리 `escape`를 둔다 · H5)
 * @property {boolean} minionShare  정예의 하수인에게도 붙는가
 * @property {boolean} hazard       바닥 위협을 만드는가(위협 간격 규칙 §5.9 대상)
 * @property {string[]} excludeTags     이 태그의 몬스터에는 안 붙는다
 * @property {string[]} excludeAffixes  같이 붙지 않는 속성
 * @property {number} minLevel
 * @property {number} weight
 */
/** @typedef {Object} PackDef
 * @property {string} id
 * @property {Array<{typeId:string, min:number, max:number}>} members
 * @property {number} minLevel
 */
/** @typedef {Object} GuardianDef   (MonsterDef와 같은 꼴 — sim · view · ui · bot은 getMonDef(typeId) 하나로 읽는다 · §6.2)
 * @property {string} id            GUARDIAN_IMPLS 키
 * @property {MonTemplate} template
 * @property {Array<'melee'|'ranged'>} tags
 * @property {'guardian'} behavior @property {number} xp   (1 — × RANKS.guardian.xp) @property {number} gauge   (0) @property {number} aggro   (99) @property {boolean} eliteOk   (false)
 * @property {number} radius @property {number} height @property {number} speed @property {number} turnRate
 * @property {number} hp @property {number} dmg   (× MON 기준 · 등급 guardian 배율은 따로)
 * @property {Record<DmgType, number>} res
 * @property {AttackDef[]} attacks  기본 공격 + 고유 기술 2(kind 'cast' — 훅이 실행)
 * @property {Object} params
 * @property {{color:string, variant:string}} look
 */

/** @typedef {Object} TilesetDef
 * @property {TilesetId} id
 * @property {number} weight                     균열 타일셋 뽑기 가중치(town은 0)
 * @property {Array<{kind:string, weight:number, block:boolean, r:number, h:number, where:'wall'|'floor'|'room'}>} props
 * @property {{perRoom:[number, number], kinds:Array<{kind:string, color:string, intensity:number, radius:number, flicker:number, y:number}>}} lights
 * @property {string} ambience                   소리 환경음 ID
 */
/** @typedef {Object} RiftRow   (§7.3 — data/rift.js riftRow(L))
 * @property {number} level @property {number} monLevel @property {number} ilvl
 * @property {number} hpMul @property {number} dmgMul @property {number} goldMul @property {number} xpMul
 * @property {number} champAffixes @property {number} eliteAffixes @property {number} guardianAffixes
 * @property {number} championPacks @property {number} elitePacks
 * @property {Record<'magic'|'rare'|'legendary'|'set', number>} rarityMul
 */

/** @typedef {Object} BaseDef    (아이템 기본형 — 무기는 피해 종류를 갖지 않는다: 시트의 weapon.type = 클래스 기본 공격의 type · §5.6)
 * @property {string} id
 * @property {ItemSlot} slot
 * @property {ClassId|null} cls     무기 · 보조는 클래스 전용, 나머지 null(공용)
 * @property {1|2} [hands]          주무기
 * @property {[number, number]} [dmg]   ilvl 1 · 단계 0의 최소 · 최대 피해
 * @property {number} [aps]         초당 공격
 * @property {number} [armor]       ilvl 1 · 단계 0
 * @property {number} [block]       방패 막기 확률(0..1)
 * @property {[number, number]} [bonus] 마법구 추가 피해(ilvl 1)
 * @property {number} [mana]        마법구 자원 최대 +
 * @property {number} weight        같은 부위 · 클래스 안의 뽑기 가중치
 * @property {string} look          view 메시 ID(§9.6)
 */
/** @typedef {'str'|'int'|'vit'|'weaponDmgPct'|'attackSpeedPct'|'critChance'|'critDamage'
 *   |'physPct'|'firePct'|'coldPct'|'lightningPct'|'skillPct'|'cdr'|'costReduce'|'lifePct'|'lifeRegen'|'lifeOnHit'|'lifePctOnHit'
 *   |'armor'|'armorPct'|'allRes'|'resPct'|'physRes'|'fireRes'|'coldRes'|'lightningRes'|'moveSpeed'|'aoePct'|'elitePct'|'thorns'
 *   |'goldFind'|'magicFind'|'xpPct'|'potionPct'|'globePct'|'manaRegenPct'|'dmgTakenReduce'|'rageOnHit'
 *   |'allPct'|'burnFrac'|'freezeAt'|'freezeDurPct'} StatKey
 *  allPct = 모든 종류 피해 %(dmgPct 넷에 더한다) · burnFrac = 화염 적중이 남기는 화상 % · freezeAt = 빙결 문턱 −점(PlayerStats.freezeAtReduce) · freezeDurPct = 빙결 길이 %
 *  아이템 옵션 · 패시브 · 세트 효과가 쓰는 능력치 키. 값의 단위는 §7.7 표(퍼센트 숫자 또는 고정값). */
/** @typedef {Object} ItemAffixDef
 * @property {string} id
 * @property {'prefix'|'suffix'} kind
 * @property {StatKey} stat
 * @property {ItemSlot[]} slots
 * @property {number} weight
 * @property {'flat'|'pow'} scale    pow면 값 × ITEM_GROWTH^(ilvl−1)
 * @property {Array<[number, number]>} tiers   T1..T5 값 범위(포함)
 * @property {MainStat} [main]       str/int 옵션 — 클래스 편향 가중치(§5.13)
 * @property {'skill'} [param]       skillPct — 굴릴 때 클래스 액티브 하나를 고른다
 * @property {0|1} decimals          값 반올림 자리
 */
/** @typedef {Object} TreasureDef
 * @property {string} id            'normal'|'minion'|'champion'|'elite'|'guardian'|'split'
 * @property {number} picks
 * @property {{none:number, gold:number, potion:number, globe:number, material:number, gear:number}} w
 * @property {number} goldMul       골드 더미 크기 배율
 * @property {number} [guaranteed]  희귀 이상 보장 장비 수
 */
/** @typedef {Object} LegendaryDef
 * @property {string} id @property {string} baseId @property {ClassId|null} cls
 * @property {string} hook          효과 이름(문자열 키 legfx.<id> · 사건형이면 EQUIP_HOOKS 키)
 * @property {string} [skill]       패치형: 대상 스킬 노드 ID @property {Object} [patch]   그 스킬 params에 덮어쓸 값(§8.5)
 * @property {'kill'|'globe'} [at]  사건형: 도는 사건 @property {Object} params
 * @property {[number, number]} affixes   추가 옵션 수 범위 @property {number} weight
 */
/** @typedef {Object} SetDef
 * @property {string} id @property {ClassId} cls
 * @property {Array<{id:string, baseId:string, slot:ItemSlot}>} pieces
 * @property {Object<string, number>} bonus2   StatKey → 값(2세트)
 * @property {Object<string, number>} bonus4   (4세트 — 2세트에 더해진다)
 */

// ───────────────────────── §3.4 맵(상태 아님 · ctx.map) ─────────────────────────

/** @typedef {Object} MapData
 * @property {string} id            'town' | `rift:${seed}:${level}` (고정 상태 맵은 'fixture:<id>')
 * @property {'town'|'rift'} kind
 * @property {TilesetId} tileset
 * @property {number} w @property {number} h          타일 수(타일 = 2m)
 * @property {Uint8Array} tiles     w×h · TILE_VOID 0 · TILE_FLOOR 1 · TILE_WALL 2 (벽 = 바닥에 8방향으로 닿는 비바닥 타일)
 * @property {number} nw @property {number} nh        내비 칸 수(= w×4, h×4)
 * @property {Uint8Array} nav       nw×nh · 0 걷기 가능 · 1 막힘(벽 · 막는 소품)
 * @property {Room[]} rooms
 * @property {Array<{a:number, b:number, cells:Array<[number, number]>}>} corridors   방 a–b 연결 · 통로 타일 목록(view · 미니맵)
 * @property {Prop[]} props
 * @property {LightDef[]} lights
 * @property {{x:number, z:number, facing:number}} spawn   플레이어 시작(균열) · 마을 도착점
 * @property {PackSlot[]} packSlots       (균열) 팩 자리 — P3가 채운다
 * @property {MapObject[]} objects        (마을) 상호작용 물체 · 장식 건물
 * @property {{x0:number, z0:number, x1:number, z1:number}} bounds   바닥이 있는 영역(m)
 */
/** @typedef {{id:number, x0:number, z0:number, x1:number, z1:number, cx:number, cz:number, depth:number, kind:'start'|'room'|'big'}} Room
 *  좌표는 m(바닥 영역) · depth = 시작 방에서 그래프 거리 */
/** @typedef {{id:number, kind:string, x:number, z:number, facing:number, r:number, h:number, block:boolean}} Prop */
/** @typedef {{x:number, y:number, z:number, color:string, intensity:number, radius:number, flicker:number, kind:string}} LightDef */
/** @typedef {{id:number, roomId:number, x:number, z:number, kind:'normal'|'champion'|'elite', depth:number}} PackSlot */
/** @typedef {{id:string, kind:InteractKind|'deco', npc?:string, x:number, z:number, facing:number, r:number, w?:number, d?:number, h?:number, look:string, block?:boolean, portalKind?:'recall'|'exit'}} MapObject
 *  r = 상호작용 반지름(클릭 판별 · 도착 판정 기준) · w/d/h = 장식 건물 상자 크기 · h = 높이(마우스 판별 · 대상 검사 — 상호작용 물체에 없으면 PICKUP.objectH)
 *  block = 걷기를 막는다(장식) · portalKind = getObject가 균열 포털을 정규화할 때만 */

// ───────────────────────── §3.5 아이템 ─────────────────────────

/** @typedef {Object} ItemAffix
 * @property {string} id            ITEM_AFFIXES 키
 * @property {1|2|3|4|5} tier
 * @property {number} value         굴린 값(pow 옵션이면 ilvl 배율까지 곱한 뒤 decimals로 반올림)
 * @property {string} [param]       skillPct의 스킬 ID
 */
/** @typedef {Object} Item
 * @property {string} id            'i<n>' — 계정에서 유일
 * @property {string} baseId
 * @property {ItemSlot} slot
 * @property {ClassId|null} cls
 * @property {Rarity} rarity
 * @property {number} ilvl          1..
 * @property {number} reqLevel      = ilvl (캐릭터 레벨이 이보다 낮으면 장착 불가 · 툴팁 붉게)
 * @property {0|1|2} tier           기본형 단계(일반 · 고급 · 정예)
 * @property {{dmg?:[number, number], aps?:number, armor?:number, block?:number, bonus?:[number, number], mana?:number}} base
 *                                  굴린 기본 값(ilvl · 단계 배율 · ±편차까지 곱한 결과 · dmg/armor/bonus는 정수)
 * @property {ItemAffix[]} affixes  순서 = 굴린 순서(접두 먼저 · 각 kind 안에서 굴린 순)
 * @property {string[]} name        문자열 키 배열 — ui가 t()로 바꿔 공백으로 잇는다(§10.8)
 * @property {string} [legendaryId] @property {string} [setId] @property {string} [setPieceId]
 * @property {number} dur @property {number} durMax     0..100 · 0이면 그 아이템의 능력치가 꺼진다
 * @property {number|null} rerollIdx   신비술사가 고정한 옵션 인덱스(null = 아직 안 고름)
 * @property {number} rerolls       그 아이템의 재굴림 횟수(비용 증가)
 * @property {number} value         골드 가치(정수 — 판매 · 수리 · 되사기의 기준 · §7.10)
 * @property {{gambled?:boolean, crafted?:boolean, bought?:boolean, start?:boolean, locked?:boolean}} flags
 *                                  locked = 잠금(KeyL — 일괄 판매 · 일괄 분해에서 빠지고, 하나씩 팔기 · 분해는 'itemLocked')
 */
/** @typedef {{where:'bag'|'stash'|'equip'|'stock'|'buyback', idx?:number, slot?:EquipSlot, shop?:'blacksmith'|'general'}} ItemRef */

// ───────────────────────── §3.6 모양 · 판정 값 ─────────────────────────

/** @typedef {Object} Shape
 * @property {ShapeType} type
 * @property {number} x @property {number} z           기준점(원 · 고리 · 원뿔 꼭짓점 · 선의 시작)
 * @property {number} [r]           원 · 원뿔 · 고리(바깥) 반지름
 * @property {number} [r0]          고리 안쪽 반지름
 * @property {number} [facing]      원뿔 · 선의 방향(yaw)
 * @property {number} [angle]       원뿔 전체 각(rad)
 * @property {number} [len] @property {number} [width]  선(직사각형: 시작점에서 facing 방향으로 len · 폭 width)
 * @property {Vec2[]} [pts]         poly(연쇄 번개 같은 꺾은선 — 판정 없음 · 연출용)
 *  몸(원 · 반지름 rb)과의 겹침: core/shapes.js 의 overlaps(shape, x, z, rb) 하나가 정본
 */
/** @typedef {Object} PlayerHitSpec   (플레이어 → 몬스터 적중 한 번의 정의)
 * @property {string} skillId       스킬 노드 ID 또는 'bash' · 'magicBolt' · 전설 훅 ID
 * @property {number} coef          무기 피해 계수
 * @property {DmgType} type
 * @property {SkillTag[]} tags
 * @property {number} actionId      시전 한 번의 번호(state.nextId) — 한 행동 안의 적중당 회복 · 분노 상한을 센다(채널 틱 · 플레이어 지속 효과 틱은 틱마다 새 번호 — §5.6)
 * @property {number} srcX @property {number} srcZ   넉백 방향 · 방패 정면 판정의 기준
 * @property {number} [stun]        초 @property {number} [knock] m @property {number} [chill] 점
 * @property {number} [burnFrac]    이 적중 피해의 비율만큼 3초 화상(패시브 연소와 더한다)
 * @property {number} [shockChance] @property {{pct:number, sec:number}} [slow]
 * @property {number} [maxTargets]  모양 적중의 대상 상한(가까운 순)
 * @property {boolean} [noProcs]    true면 전설 처치 훅 · 적중 회복 · 분노 생성이 돌지 않는다(훅이 만든 적중의 재귀 방지)
 * @property {number} [flat]        coef 대신 고정 피해(시체 폭발처럼 대상 생명 비례) — 주 능력치 · 치명타 미적용
 */
/** @typedef {Object} HitResult
 * @property {number} monId @property {number} dmg   실제로 깎인 생명
 * @property {boolean} crit @property {boolean} killed
 * @property {boolean} immune       보호막 속성 · 사라짐 중이라 0
 * @property {boolean} blocked      방패 해골 정면이라 줄었다
 */
/** @typedef {Object} MonAttackSpec   (몬스터 · 바닥 효과 → 플레이어)
 * @property {number} srcId         몬스터 ID(효과면 효과 ID)
 * @property {'melee'|'projectile'|'hazard'|'charge'|'explode'} via
 * @property {number} raw           감소 전 피해(= mon.dmg × mul)
 * @property {DmgType} type
 * @property {number} level         몬스터 레벨(방어도 · 저항 분모)
 * @property {number} [push]        m
 * @property {{chillSec?:number, slowPct?:number, rootSec?:number}} [onHit]
 * @property {boolean} [noAffix]   true면 속성 onHitPlayer가 돌지 않는다(속성 훅이 만든 피해 — 번개 불꽃 · 화염 추가 · 냉기 노바 · 화염 사망)
 */
/** @typedef {Object} PlayerHitResult
 * @property {number} dmg           생명에서 깎인 양 @property {number} absorbed   보호막이 막은 양
 * @property {boolean} blocked      방패 막기 @property {boolean} killed
 * @property {boolean} ignored      도착 보호 · 무적 · 사망 중이라 무시
 */

// ───────────────────────── §3.7 게임 상태 ─────────────────────────

/** @typedef {Object} GameState
 * @property {number} v             STATE_VERSION
 * @property {number} tick          0부터 · step마다 +1(장면에 관계없이)
 * @property {number} seed          세션 시드(uint32)
 * @property {{combat:{s:number}, loot:{s:number}, ai:{s:number}, shop:{s:number}}} rng   난수 줄기 넷(§5.14)
 * @property {number} nextId        엔티티 · 행동 번호(1부터)
 * @property {SceneId} scene
 * @property {Travel|null} pendingTravel    장면 전환 대기(§5.11) — 있으면 step은 tick만 민다
 * @property {AccountState} account
 * @property {CharacterState|null} char     null = 캐릭터를 아직 고르지 않음(타이틀 뒤 마을 배경)
 * @property {PlayerState} player
 * @property {TownState} town
 * @property {RiftState|null} rift         열린 균열(마을에 있어도 남는다 · 마을에서는 step하지 않는다)
 * @property {MeterState} meter
 * @property {SimEvent[]} events            플러시 전 큐(§4.1)
 * @property {{invincible:boolean, devSession:boolean}} flags
 */
/** @typedef {{name:string, payload:Object}} SimEvent */
/** @typedef {{to:SceneId, reason:'openRift'|'recall'|'townPortal'|'riftPortal'|'respawn'|'exit'|'debug', level?:number, seed?:number}} Travel */

/** @typedef {Object} AccountState
 * @property {Array<null|{name:string, cls:ClassId, level:number, riftUnlocked:number}>} chars   길이 4(캐릭터 칸 요약)
 * @property {Array<Item|null>} stash       길이 60(계정 공유)
 * @property {number} nextItemId            다음 아이템 번호(1부터 · 저장된다)
 * @property {number} lastSlot              마지막으로 쓴 캐릭터 칸(-1 = 없음)
 */
/** @typedef {Object} CharacterState
 * @property {number} slot @property {string} name @property {ClassId} cls
 * @property {number} level         1..30
 * @property {number} xp            지금 레벨 안의 경험치(0 .. XP.req(level)) · 캡이면 0
 * @property {number} xpTotal       누적(기록용)
 * @property {number} gold
 * @property {Record<MaterialId, number>} materials
 * @property {number} potions       0..ECON.potionMax @property {number} scrolls   0..ECON.scrollMax
 * @property {{ranks:Object<string, number>, bar:Array<string|null>}} skills   bar 길이 5(0 = 우클릭)
 * @property {Record<EquipSlot, Item|null>} equip
 * @property {Array<Item|null>} bag         길이 40(8 × 5 · 인덱스 = 행 × 8 + 열)
 * @property {number} riftUnlocked          고를 수 있는 최고 균열 레벨(1부터)
 * @property {Object<string, {timeSec:number, deaths:number}>} best   균열 레벨 → 최고 기록(완료한 것만)
 * @property {RunRecord[]} records          최근 RECORDS_MAX(200)개
 * @property {{count:number}} blp           불운 보정 — 전설 · 세트 없이 지나간 장비 드랍 수
 * @property {Array<{item:Item, price:number}>} buyback   최근 판 것 10개(새것이 앞)
 * @property {ShopState} shop
 * @property {Object<string, boolean>} hints  본 안내 카드
 * @property {number} playSec               누적 플레이 시간(초 — step한 틱 / 30 + 마을에서 패널이 열린 시간 `addPlaySec` · 측정용)
 * @property {number} runs                  연 균열 수(시드 파생)
 * @property {number} seed                  캐릭터 시드(생성 때 hash32(state.seed, slot) · 저장 — 상점 재고 시드 §6.11)
 * @property {number} lastRiftLevel         마지막으로 연 균열 레벨(1부터 · 소모품 · 초기화 가격의 PLc — §7.10)
 */
/** @typedef {Object} ShopState
 * @property {Item[]} blacksmith            재고(SHOP.blacksmithStock개 · 균열 한 판마다 새로 — stockRun)
 * @property {Item[]} general               장신구 재고
 * @property {number} restocks              재고 갱신 횟수(시드 파생)
 * @property {number} stockRun              재고를 굴린 때의 char.runs(-1 = 아직 없음 · 같으면 다시 굴리지 않는다 — §6.11)
 * @property {RerollOffer|null} reroll      진행 중인 재굴림 제안
 */
/** @typedef {{itemId:string, where:'bag'|'equip', idx:number, affixIdx:number, options:ItemAffix[], cost:{gold:number, dust:number, essence:number}}} RerollOffer
 *  options[0] = 기존 옵션, [1..2] = 새 후보 · where 'equip' 이면 idx 는 EQUIP_SLOTS 의 인덱스 */

/** @typedef {Object} PlayerState
 * @property {Vec2} pos @property {Vec2} prevPos
 * @property {number} facing        yaw
 * @property {number} r             몸 반지름(m)
 * @property {number} life @property {number} lifeMax
 * @property {number} resource @property {number} resourceMax
 * @property {PlayerAct} act
 * @property {string|null} actSkill     지금 행동의 스킬 ID('bash' · 'magicBolt' · 노드 ID · 'recall')
 * @property {number} actStart @property {number} actHit @property {number} actEnd    틱(판정 없는 행동은 actHit = actStart)
 * @property {Vec2|null} actPoint       행동의 목표 지점(돌진 · 도약 · 순간이동 · 메테오)
 * @property {number|null} actTargetId
 * @property {number} actId             행동 번호(PlayerHitSpec.actionId)
 * @property {Vec2[]} path              남은 경유점(마지막 = 목적지)
 * @property {Intent} intent
 * @property {Buffered|null} buffer     선입력(§5.3)
 * @property {Object<string, number>} readyAt   스킬 ID → 다시 쓸 수 있는 틱(쿨다운)
 * @property {number} potionReadyAt
 * @property {Buff[]} buffs
 * @property {number} shield            마력 보호막 남은 흡수량
 * @property {{slowPct:number, slowUntil:number, rootUntil:number}} st   (감속 · 속박 — 냉기 강화 · 감옥)
 * @property {{start:number, end:number}|null} recall
 * @property {{skillId:string, nextAt:number, startedAt:number}|null} channel
 * @property {{from:Vec2, to:Vec2, start:number, end:number, kind:'dash'|'leap'}|null} air   돌진 · 도약 궤적(view — sim 위치는 §5.4 규칙으로 매 틱 pos에 있다)
 * @property {{hitIds:number[], hits:number, nextAt:number}} sk   지금 행동 · 채널의 스킬 스크래치(행동을 시작할 때 {hitIds:[], hits:0, nextAt:-1}로 새로 · 동작이 키를 더할 수 있다 — 순수 값 · 절대 틱 키는 At으로 끝난다)
 * @property {{vx:number, vz:number, until:number}|null} knock   몬스터 공격의 밀림(PLAYER.pushSec — §5.6)
 * @property {number} potionQueuedUntil   쿨다운 끝 직전에 누른 포션의 대기(틱 · 0 = 없음 — §5.3)
 * @property {{typeId:string, rank:MonRank, name:string[]|null}|null} killedBy   마지막 사망의 처치자(killPlayer가 세우고 부활 commit에서 null — 사망 패널)
 * @property {Hover|null} hover         이번 틱 입력의 대상(검사 통과한 것만)
 * @property {number|null} targetId     지금 공격 중인 몬스터(대상 프레임)
 * @property {number} combatUntil       분노 감소 시작 틱
 * @property {number} protectUntil      도착 보호(이 틱까지 피해 무시)
 * @property {number} invulnUntil       도약 공중 무적
 * @property {boolean} lowLife          생명 ≤ COMBAT.lowLife
 * @property {boolean} dead @property {number} deadAt   (-1 = 없음)
 * @property {number} speed             이번 틱 실제 이동 속력(m/s — 걷기 애니메이션)
 * @property {boolean} moving
 * @property {{windowStart:number, sum:number}} rageTaken   피격 분노의 초당 상한 집계(§5.5)
 * @property {{actionId:number, n:number}} loh             적중 회복 대상 수 집계(§5.6)
 * @property {number} hitstopAt         마지막 히트스톱 틱(-1 = 없음 · §5.12)
 * @property {number} failAt            마지막 SKILL_FAIL 틱(-1 = 없음) · @property {string|null} failKey   (같은 실패 0.5초에 한 번)
 */
/** @typedef {{kind:'none'|'move'|'attack'|'standAttack'|'pickup'|'interact', point?:Vec2, targetId?:number, objectId?:string, follow?:boolean, held?:boolean}} Intent */
/** @typedef {{kind:'basic'|'skill'|'move'|'attack', slot?:number, skillId?:string, point?:Vec2, targetId?:number|null, stand?:boolean, until:number}} Buffered */
/** @typedef {{id:string, until:number, value:number}} Buff     id: 'warCry'(value = 방어도 배율 + · 0..1) · 'energyShield'(value = 처음 흡수량) */

/** @typedef {Object} TownState
 * @property {boolean} portalOpen       열린 균열이 있고 붕괴하지 않았다
 * @property {boolean} returnPrompt     부활 직후 「Enter — 포털로 돌아가기」(포털을 쓰거나 균열이 닫히면 false)
 * @property {string|null} lastInteract
 */

/** @typedef {Object} RiftState
 * @property {number} level @property {number} seed @property {TilesetId} tileset @property {string} mapId
 * @property {RiftPhase} phase
 * @property {number} gauge         0..100(%)
 * @property {number} lives         3에서 시작 · 사망마다 −1 · 0에서 사망하면 붕괴
 * @property {number} deaths
 * @property {number} openedAt      틱
 * @property {number} leftAt        마지막으로 균열을 떠난 틱(균열에서 pendingTravel이 선 틱 · 균열 안이면 -1 — 마을 → 균열 commit이 rift 하위 시각을 민다 §5.11)
 * @property {number} ticksIn       균열 장면에서 step한 틱 수(「한 판 길이」 · 기록)
 * @property {MonsterState[]} mons @property {Proj[]} projs @property {Effect[]} effects @property {Drop[]} drops
 * @property {PackState[]} packs
 * @property {Portal[]} portals
 * @property {number|null} guardianId
 * @property {{x:number, z:number, at:number}|null} guardianSpawn   출현 예고(at = 나타나는 틱)
 * @property {Vec2|null} returnPos      마을 포털로 돌아올 자리(귀환한 자리 · 사망이면 checkpoint)
 * @property {Vec2} checkpoint          안전 지점(§5.10)
 * @property {number} checkpointCalm    그 자리에서 조용했던 틱 수
 * @property {number[]} explored        w×h 타일 · 0/1(미니맵)
 * @property {number} rootLockUntil     감옥 속박 중 · 직후 — 새 바닥 위협이 플레이어 발밑에 시작하지 않는다(§5.9 · -1 = 없음)
 * @property {RunStats} stats
 * @property {RunSummary|null} summary  완료 · 붕괴 때 만든 요약(패널이 읽는다)
 * @property {number|null} completeAt   요약 패널을 띄울 틱
 * @property {string} guardianType      채울 때 정한 수호자 ID(GUARDIANS 키)
 * @property {number|null} calmAt       사망 뒤 몬스터를 재울 틱(§5.10)
 * @property {null} mods                로드맵 자리(균열 변형 옵션 — v0.1은 늘 null · §8.8)
 */
/** @typedef {Object} RunStats
 * @property {{normal:number, champion:number, elite:number, minion:number, guardian:number, other:number}} kills   (split · spawn은 other)
 * @property {Record<Rarity, number>} drops      바닥에 떨어진 장비(등급별)
 * @property {number} gold @property {number} xp @property {number} upgrades     업그레이드 드랍 수(§5.13)
 * @property {number} recalls @property {number} potions
 * @property {number} maxTargeting  동시에 플레이어를 노린 몬스터 수의 최대
 * @property {number} swarmMoments  25마리 이상이 노린 순간 수(§5.15)
 * @property {number} dmgDealt @property {number} dmgTaken
 * @property {boolean} bagFullRecall  가방이 차서 귀환한 적이 있다
 */
/** @typedef {Object} MonsterState
 * @property {number} id @property {string} typeId @property {MonRank} rank
 * @property {number} packId @property {number} level
 * @property {string[]} affixes     MON_AFFIXES 키
 * @property {string[]|null} name   정예: [elite.a.N, elite.b.M] 문자열 키 · 그 밖 null(이름 = mon.<typeId>)
 * @property {Vec2} pos @property {Vec2} prevPos @property {number} facing @property {Vec2} vel
 * @property {number} r @property {number} height @property {number} scale
 *                                  r = def.radius × rank.scale · height = def.height × rank.scale — 이미 곱한 값(sim · view · pick은 그대로 쓰고 scale을 다시 곱하지 않는다 · scale은 모델 배율에만)
 * @property {number} hp @property {number} hpMax @property {number} dmg @property {number} speed
 * @property {Record<DmgType, number>} res
 * @property {boolean} awake
 * @property {boolean} targeting    플레이어를 노리는 중(깨어 있고 15m 안 · 도망 아님 — 떼 순간 집계)
 * @property {MonAct} act @property {string|null} actId
 * @property {number} actStart @property {number} actHit @property {number} actEnd
 * @property {Vec2|null} aim        조준점(궁수 조준선 · 돌진 끝 · 주술사 부활 대상) — view가 예고에 쓴다
 * @property {boolean} aimLocked    조준이 멈췄다(궁수 발사 직전 0.2초 · 돌진)
 * @property {Object<string, number>} readyAt    공격 ID → 다시 쓸 수 있는 틱
 * @property {MonStatus} st
 * @property {{vx:number, vz:number, until:number}|null} knock
 * @property {boolean} dead @property {number} deadAt   (-1 = 없음)
 * @property {boolean} gone        목록에서 뺄 표시(갱신 · 판정 · 질의 · 그리기에서 빠진다 — 배열에서는 cleanup이 뺀다 §5.14)
 * @property {{x:number, z:number}|null} launch   사망 때 날아가는 수평 속도(view 연출 — 큰 일격)
 * @property {Object<string, Object>} ax          속성 · 행동 훅의 상태(순수 객체 · 키 = 속성 ID 또는 'b' · 절대 틱은 이름 끝 At · Until로만 — shiftTicks §5.11)
 * @property {{noXp:boolean, noDrops:boolean, noGauge:boolean, revived:boolean}} flags
 * @property {{by:'player'|'env'|'mon', skillId:string|null, noProcs:boolean, frozen:boolean}|null} lastHit   마지막 피해(처치 훅 · 집계)
 * @property {number} sleepAt       깨어 있는데 멀어진 틱(다시 잠드는 판정 · -1 = 없음)
 */
/** @typedef {Object} MonStatus   (시각 필드 -1 = 없음)
 * @property {number} stunUntil @property {number} stunImmuneUntil
 * @property {number} chill          0..100 점 @property {number} chillDecayAt   이 틱부터 감소
 * @property {number} freezeUntil @property {number} freezeImmuneUntil
 * @property {{dps:number, until:number, nextAt:number}|null} burn
 * @property {number} shockUntil
 * @property {{pct:number, until:number}|null} slow
 * @property {number} flinchUntil @property {number} flinchImmuneUntil @property {number} knockImmuneUntil
 * @property {number} invulnUntil    보호막 속성 · 사라짐
 */
/** @typedef {{id:number, kind:'normal'|'champion'|'elite'|'guardian', memberIds:number[], awake:boolean, nextHazardAt:number, fled:boolean, anchor:Vec2}} PackState */
/** @typedef {Object} Proj
 * @property {number} id @property {string} visual   §9.8의 투사체 연출 ID
 * @property {'player'|'mon'} owner @property {number} srcId
 * @property {Vec2} pos @property {Vec2} prevPos @property {Vec2} vel
 * @property {number} r @property {number} born @property {number} until   틱
 * @property {number} pierce        남은 관통(0 = 첫 적중에서 끝)
 * @property {number[]} hitIds      이미 맞힌 몬스터(관통 중복 방지)
 * @property {boolean} bounce       벽에 튕긴다(번개 불꽃)
 * @property {Object} spec          적중 정의(owner player: PlayerHitSpec · mon: MonAttackSpec) — 연출이 읽지 않는다
 * @property {{r:number, spec:Object, visual:string}|null} explode   끝날 때 폭발(화염구)
 */
/** @typedef {Object} Effect
 * @property {number} id @property {string} kind    §9.8의 효과 kind
 * @property {'player'|'mon'|'env'} owner @property {number} srcId
 * @property {number} packId        적대 위협의 팩(위협 간격 §5.9 · 없으면 -1)
 * @property {boolean} cancelOnSrcDeath   출처가 죽으면 예고째 지운다(§5.16-6)
 * @property {boolean} hostile      플레이어를 다치게 한다(붉은 · 위협 색) — false면 플레이어 스킬(주황 · 파랑 · 흰)
 * @property {Shape} shape
 * @property {number} start @property {number} hitAt @property {number} end   틱. 예고 = [start, hitAt) · 판정 = hitAt · 지속 = [hitAt, end)
 * @property {number} tickT         지속 효과의 판정 간격(틱 · 0 = 지속 판정 없음 · 첫 지속 판정 = hitAt + tickT)
 * @property {number} nextTickAt    (-1 = 지속 판정 없음)
 * @property {boolean} resolved     hitAt 판정을 했다
 * @property {Object|null} spec     hitAt 판정 정의(null = 판정 없는 표시 전용 예고 — 돌진 선 · 연출이 읽지 않는다)
 * @property {Object|null} tickSpec 지속 틱 판정 정의(null이면 spec · 비적대는 만드는 쪽이 coef = coefPerSec × 틱 초를 넣는다)
 * @property {Vec2|null} from       몰타르 포탄 · 메테오 낙하의 출발점(연출)
 */
/** @typedef {Object} Drop
 * @property {number} id @property {DropKind} kind
 * @property {Vec2} pos @property {Vec2} from      떨어진 자리 → 놓인 자리(view의 튀어나오는 호)
 * @property {number} born          틱
 * @property {Item|null} item       kind 'item'
 * @property {number} amount        골드 · 포션 · 재료 개수 · 구슬은 1
 * @property {MaterialId|null} mat
 * @property {Rarity|null} rarity   item이면 item.rarity
 * @property {boolean} gone       주웠다 · 사라졌다(removeDrop이 표시 · 배열에서는 cleanup이 뺀다 §5.14)
 */
/** @typedef {{id:string, kind:'recall'|'exit', pos:Vec2, r:number, born:number}} Portal   id = 'portal:<n>' · r = RIFT.portalR(1.0) · getObject가 MapObject 꼴(kind 'riftPortal' · portalKind)로 정규화한다(§6.4) */

/** @typedef {Object} MeterState
 * @property {number[]} dealt       길이 METER.window(150틱 = 5초) 링 버퍼 — 틱별 준 피해
 * @property {number[]} taken       같은 모양 — 받은 피해
 * @property {number} idx           링 버퍼의 지금 칸
 * @property {number[]} killTicks   최근 처치 틱(최근 METER.killCap개 · 분당 처치)
 * @property {number} runXp @property {number} runGold   이번 균열에서 얻은 것
 * @property {number} targeting     이번 틱 노리는 몬스터 수
 * @property {boolean} swarmArmed   떼 순간을 다시 셀 준비(§5.15)
 */

// ───────────────────────── §3.8 캐릭터 시트 ─────────────────────────

/** @typedef {Object} PlayerStats
 * @property {ClassId} cls @property {number} level
 * @property {number} main @property {number} vit
 * @property {number} lifeMax @property {number} resourceMax @property {number} resourceRegen   (마나/초)
 * @property {{min:number, max:number, aps:number, type:DmgType, hands:1|2, baseId:string|null, fist:boolean}} weapon
 *           무기 로컬 옵션(weaponDmgPct)과 마법구 추가 피해까지 더한 값 · 무기가 없거나 내구도 0이면 fist(FIST 표)
 *           type = 그 클래스 기본 공격의 type(BASIC_SKILLS[CLASSES[cls].basic].type — warrior 'phys' · mage 'lightning') · 무기 기본형은 피해 종류를 갖지 않는다
 * @property {number} aps            weapon.aps × (1 + attackSpeedPct)
 * @property {number} critChance     0..COMBAT.critCap @property {number} critDamage  치명타 추가 배율(0.5 = +50%)
 * @property {Record<DmgType, number>} dmgPct       더하는 피해 보너스(0..)
 * @property {Object<string, number>} skillPct      스킬 ID → 보너스
 * @property {number} aoePct @property {number} elitePct
 * @property {number} cdr            0..COMBAT.cdrCap @property {number} costReduce  0..COMBAT.costCap
 * @property {number} lifeRegen      생명/초 @property {number} lifeOnHit   적중당 고정 회복
 * @property {number} lifePctOnHit   적중당 최대 생명 비율 회복(피의 갈증)
 * @property {number} armor          armorPct까지 곱한 값
 * @property {Record<DmgType, number>} res          (allRes 더하고 resPct 곱한 값)
 * @property {number} block          0..1(방패)
 * @property {number} moveSpeed      m/s (기본 × (1 + 이동 속도 · 상한 COMBAT.moveCap))
 * @property {number} thorns @property {number} goldFind @property {number} magicFind @property {number} xpPct
 * @property {number} potionPct @property {number} globePct @property {number} dmgTakenReduce @property {number} rageOnHit
 * @property {number} burnFrac       화염 적중의 화상 비율(0..) @property {number} freezeAtReduce   빙결 문턱 −점 @property {number} freezeDurPct
 * @property {number} manaRegenPct   (resourceRegen에 이미 곱했다 · 표시용)
 * @property {string[]} hooks        활성 전설 ID(내구도 0 아이템 제외 · 전설 행의 hook 이 아니라 LEGENDARIES 의 id)
 * @property {Object<string, number>} ranks     스킬 노드 랭크(skills.ranks 복사)
 * @property {string[]} transforms   찍은 변형 노드 ID
 * @property {Array<{cond:string, stats:Object<string, number>}>} conds   조건부 패시브 — stats 키: dmgPct(= allPct/100) · critChance · critDamage · dmgTakenReduce · attackSpeedPct(모두 0..1 · 그 밖의 StatKey 는 같은 이름 /100)
 * @property {EquipSlot[]} broken    내구도 0 칸
 * @property {Object<string, number>} setCounts   세트 ID → 낀 조각 수
 * @property {number} sheetDps       기본 공격 DPS(조건부 제외 · 치명타 기대값 포함 · 저항 없는 대상) — §5.6
 * @property {number} ehp            유효 생명(레벨 = 해금 최고 균열의 몬스터 기준 · §5.6)
 */

// ───────────────────────── §3.9 진행 · 보상 · 결과 ─────────────────────────

/** @typedef {{amount:number, level:number, xp:number, toNext:number|null, levels:number}} XpResult   levels = 이번에 오른 레벨 수 */
/** @typedef {Object} RunSummary
 * @property {number} level @property {number} seed @property {TilesetId} tileset @property {ClassId} cls
 * @property {'complete'|'collapse'|'abandon'} result
 * @property {number} timeSec       ticksIn / 30
 * @property {RunStats['kills']} kills @property {number} deaths
 * @property {Record<Rarity, number>} drops @property {number} gold @property {number} xp @property {number} upgrades
 * @property {number} recalls @property {number} maxTargeting @property {number} swarmMoments
 * @property {number} unlockedTo    완료 뒤 riftUnlocked(붕괴면 그대로)
 * @property {boolean} noDeath @property {boolean} record   이 레벨의 새 최고 기록
 */
/** @typedef {RunSummary & {at:number, charLevel:number}} RunRecord   at = 그때의 playSec */
/** @typedef {Object} RiftPreview   (균열석 패널 — §6.13 previewRift)
 * @property {number} level @property {number} monLevel @property {number} ilvl
 * @property {number} hpMul @property {number} dmgMul @property {number} goldMul @property {number} xpMul
 * @property {Record<'magic'|'rare'|'legendary'|'set', number>} rarityMul
 * @property {number} champAffixes @property {number} eliteAffixes
 * @property {{timeSec:number, deaths:number}|null} best
 * @property {boolean} unlocked
 */
/** @typedef {{ok:true}|{ok:false, reason:string, params?:Object}} Result */
/** @typedef {Object} DropRoll     (rollDrops의 결과 한 줄)
 * @property {DropKind} kind @property {Item|null} item @property {number} amount @property {MaterialId|null} mat
 */

// ───────────────────────── §3.10 sim 문맥 ─────────────────────────

/** @typedef {Object} Rng   (core/rng.js — state.rng.* 위)
 * @property {{s:number}} state
 * @property {() => number} next            [0, 1)
 * @property {(a:number, b:number) => number} range   [a, b)
 * @property {(a:number, b:number) => number} int     양끝 포함
 * @property {(p:number) => boolean} chance
 * @property {() => number} sign            ±1
 * @property {(weights:Record<string, number>|Array<{id:string, w:number}>) => string|null} pick   키 순서대로 누적 · 합 ≤ 0 이면 null
 * @property {(weights:number[]) => number} pickIndex   합 ≤ 0 이면 -1
 * @property {<T>(arr:T[]) => T[]} shuffle  제자리
 */
/** @typedef {Object} SimHooks   (§2.2 · §3.10 — 역방향 호출 표)
 * @property {(ctx:SimCtx, mon:MonsterState) => void} onMonSpawn
 * @property {(ctx:SimCtx, mon:MonsterState, hit:HitResult, spec:Object) => void} onMonDamaged
 * @property {(ctx:SimCtx, mon:MonsterState) => void} onMonDeath
 * @property {(ctx:SimCtx, mon:MonsterState, res:PlayerHitResult, spec:MonAttackSpec) => void} onMonHitPlayer
 * @property {(ctx:SimCtx, mon:MonsterState, lastHit:Object) => void} onPlayerKill
 * @property {(ctx:SimCtx) => {mul:number, radiusAdd:number}} onGlobe
 * @property {(ctx:SimCtx, dmg:number) => void} onPlayerDamaged
 * @property {(ctx:SimCtx, killer:MonsterState|null) => void} onPlayerKilled
 */
/** @typedef {Object} SimCtx
 * @property {GameState} state
 * @property {MapData|null} map              지금 장면의 맵(마을이면 마을 맵)
 * @property {MapData|null} riftMap          열린 균열의 맵(마을에 있어도 남는다)
 * @property {FlowField|null} flow           균열에서만(P4) — 균열 장면이면 null이 아니다
 * @property {import('./core/spatialHash.js').SpatialHash} space   깨어 있는 살아 있는 몬스터(틱마다 다시 만든다)
 * @property {number} monVer                몬스터 목록 판(addMonster · removeMarked가 +1 — getMonster 색인 무효화 · §6.4)
 * @property {PlayerStats} stats             refreshStats()가 다시 계산
 * @property {{combat:Rng, loot:Rng, ai:Rng, shop:Rng}} rng   state.rng.* 위의 Rng(§6.1)
 * @property {(name:string, payload?:Object) => void} emit     state.events에 쌓는다(§4.1)
 * @property {() => number} nextId
 * @property {() => string} newItemId        'i' + account.nextItemId++
 * @property {() => void} refreshStats       stats = computeStats(char, …) · player.lifeMax/resourceMax 갱신(현재 값은 max로 자르기만) · STATS_CHANGED
 * @property {SimHooks} hooks
 * @property {{ignoreReqLevel?:boolean}} dev 개발용
 */
/** @typedef {Object} FlowField   (P4 — 상태 아님)
 * @property {Uint16Array} dist      nw×nh · 플레이어 칸까지 걸음 수(0xffff = 닿지 않음 · 범위 밖)
 * @property {number} cx @property {number} cz   기준 칸 @property {number} builtAt   틱
 */

// ───────────────────────── §3.11 저장 · 설정 ─────────────────────────

/** @typedef {Object} AccountSave
 * @property {number} v             SAVE_VERSION @property {'rift-hunter'} game @property {number} savedAt   ms(app)
 * @property {AccountState['chars']} chars @property {Array<Item|null>} stash @property {number} nextItemId @property {number} lastSlot
 */
/** @typedef {Object} CharSave
 * @property {number} v @property {'rift-hunter'} game @property {number} savedAt
 * @property {Omit<CharacterState, 'shop'> & {shop:{restocks:number, stockRun:number, blacksmith:Item[], general:Item[]}}} char
 */
/** @typedef {Object} Settings
 * @property {number} volMaster @property {number} volSfx @property {number} volAmbient   0..1
 * @property {QualityId} quality
 * @property {boolean} damageNumbers @property {boolean} alwaysLabels @property {boolean} hideNormal
 * @property {boolean} advancedTooltips @property {boolean} meterHud @property {boolean} screenShake
 */

// ───────────────────────── §10.1 패널 · §6.14 렌더 ─────────────────────────

/** @typedef {Object} Panel   (ui/panels/*.js 의 createXPanel(ctx) 반환)
 * @property {PanelId} id @property {boolean} modal @property {HTMLElement} el
 * @property {(args?:Object) => void} open @property {() => void} close @property {(state:GameState) => void} update
 * @property {(e:KeyboardEvent) => boolean} handleKey @property {string[]} keys   그 패널이 먹는 event.code
 * @property {() => void} dispose
 */
/** @typedef {Object} RenderContext   (view/renderer.js createRenderContext)
 * @property {any} renderer @property {any} scene @property {any} camera
 * @property {{world:any, actors:any, fx:any}} layers
 * @property {(w:number, h:number) => void} resize @property {(q:QualityId) => void} setQuality
 * @property {() => void} render @property {() => void} dispose
 * @property {(x:number, y:number, z:number) => {x:number, y:number, visible:boolean}} project   CSS px
 * @property {(px:number, py:number) => {ox:number, oy:number, oz:number, dx:number, dy:number, dz:number}} rayFromScreen
 * @property {(px:number, py:number) => Vec2|null} groundAt
 * @property {() => {calls:number, triangles:number, geometries:number, textures:number, programs:number}} stats
 */

export {};
