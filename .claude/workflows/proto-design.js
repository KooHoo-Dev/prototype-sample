export const meta = {
  name: 'proto-design',
  description: '프로토타입 설계 — 브리프를 모듈 계약으로 · 3관점 비평 · 개정 · 스캐폴드 (에이전트 6개)',
  whenToUse: '오케스트레이터가 docs/PIPELINE.md §2에서 브리프를 쓴 직후에 연다. args: { slug, root, port, from? } — from 은 contract(기본) · critique · revise · scaffold.',
  phases: [
    { title: 'Contract', detail: '브리프 → docs/CONTRACT.md' },
    { title: 'Critique', detail: '통합 · 핵심 감각 · 루프/경제/UX 세 관점' },
    { title: 'Revise', detail: '비평 반영 · 계약 확정 · docs/_packages.json' },
    { title: 'Scaffold', detail: 'P0 — 설정 · core · 전 모듈 스텁 · 테스트 하네스 · 최소 부트' },
  ],
}

// args: { slug: 'my-game', root: 'C:/…/<리포>/my-game', port: 5300, from?: 'contract' | 'critique' | 'revise' | 'scaffold' }
// 끝난 뒤 오케스트레이터가 할 일은 docs/PIPELINE.md §2. 이 파일을 고치면 node tools/check-workflows.mjs.
const STEPS = ['contract', 'critique', 'revise', 'scaffold']
if (!args || typeof args.slug !== 'string' || typeof args.root !== 'string' || !Number.isInteger(args.port)) {
  throw new Error('args가 필요하다: { slug, root(프로토타입 폴더 절대 경로), port, from? }')
}
const START = STEPS.indexOf(args.from || 'contract')
if (START < 0) throw new Error(`from 은 ${STEPS.join(' · ')} 중 하나다`)

const SLUG = args.slug
const ROOT = args.root.replace(/\\/g, '/').replace(/\/+$/, '')
const REPO = ROOT.slice(0, ROOT.lastIndexOf('/'))
const PORT = args.port

const COMMON = `
## 작업 환경
- 프로토타입 폴더: ${ROOT} (slug ${SLUG} · 포트 ${PORT}). 리포 루트: ${REPO}.
- 리포 규칙은 주입된 CLAUDE.md 그대로다 — 특히: 이 폴더 밖을 쓰지 않는다 · git 은 읽기만 · 다른 서브에이전트를 띄우지 않는다 · 임시 파일은 ${ROOT}/docs/_scratch/ 에 만들고 끝나면 지운다.
- 먼저 ${ROOT}/docs/BRIEF.md 를 끝까지 읽는다 — 방향과 확정 제약이다. 브리프가 말하지 않은 기술 사항은 CLAUDE.md 「기술 기본값」, 공통 품질 기준은 ${REPO}/docs/QUALITY.md 다.
- 문서는 한국어(식별자 · 코드는 영어)로 쓴다.
`

const PACKAGE_RULES = `
## 작업 패키지 분할 (네가 정한다 — "한 파일 = 한 패키지")
- P0 (웨이브 0 · 한 명): 프로젝트 설정 · src/core 전부 · src/types.js · 모든 모듈의 스텁 · 데이터 파일(계약의 값 그대로) · 테스트 하네스 · 최소 부트.
- 웨이브 1 (3~8명 병렬): 서로의 파일을 볼 수 없다고 가정하고 계약만으로 맞물린다. 흔한 축 — ① sim: 플레이어가 직접 조작하는 것 ② sim: 판정 · 규칙 · 세션(틱 순서의 주인) ③ sim: 상대/AI/콘텐츠 프레임워크 + 첫 콘텐츠 ④ 진행 · 경제 · 저장 ⑤ view: 캐릭터 · 오브젝트 ⑥ view: 월드 · 렌더러 · 카메라 ⑦ fx · 오디오 ⑧ ui. 게임이 작으면 합친다. 한 패키지가 다른 패키지의 구현(계약이 아니라)을 봐야 하면 같은 패키지로 묶거나 다음 웨이브로 보낸다.
- 웨이브 2 (1~8명 병렬): 웨이브 1 위에 서는 것. **app 통합**(부트 · 루프 · 화면 상태 기계 · 입력 수집 · 저장 호출 · 디버그 API · 봇 + 헤드리스 봇 테스트)은 반드시 여기에 둔다. 프레임워크 위의 추가 콘텐츠(둘째 이후의 보스 · 레벨 · 모드)도 여기.
- 웨이브는 2까지가 기본이다(꼭 필요할 때만 3). ID 는 P0, P1, P2 … 로 붙인다.
`

const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: '한 문단 총평' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          section: { type: 'string', description: 'CONTRACT.md 의 절 제목/번호' },
          problem: { type: 'string' },
          fix: { type: 'string', description: '계약에 그대로 넣을 수 있는 구체적인 수정안(수치 · 시그니처 · 문장)' },
        },
        required: ['severity', 'section', 'problem', 'fix'],
      },
    },
  },
  required: ['verdict', 'issues'],
}

const MODULES_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    appliedCount: { type: 'number' },
    rejected: { type: 'array', items: { type: 'string' }, description: '반영하지 않은 지적과 이유' },
    packages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'P0, P1 …' },
          name: { type: 'string' },
          wave: { type: 'number' },
          visual: { type: 'boolean', description: '화면을 눈으로 봐야 완성도를 알 수 있는 패키지인가' },
          files: { type: 'array', items: { type: 'string' }, description: '프로토타입 폴더 기준 상대 경로 — 이 패키지가 소유하는 파일 전부' },
          contractSections: { type: 'array', items: { type: 'string' } },
          focus: { type: 'string', description: '이 패키지의 핵심 — 무엇이 되면 성공이고 무엇이면 실패인가' },
          brief: { type: 'string', description: '완료 정의 3~8줄' },
        },
        required: ['id', 'name', 'wave', 'visual', 'files', 'contractSections', 'focus', 'brief'],
      },
    },
  },
  required: ['summary', 'packages'],
}

const SCAFFOLD_SCHEMA = {
  type: 'object',
  properties: {
    buildOk: { type: 'boolean' },
    testOk: { type: 'boolean' },
    distOk: { type: 'boolean', description: 'build → check:dist 통과(하위 경로 http 부팅)' },
    testSummary: { type: 'string', description: 'tests/pass/fail/todo 수' },
    filesCreated: { type: 'number' },
    contractDeviations: { type: 'array', items: { type: 'string' }, description: '스캐폴드하다 발견해 CONTRACT.md 를 고친 곳' },
    unverified: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string', description: '다음 웨이브의 작업자가 알아야 할 것' },
  },
  required: ['buildOk', 'testOk', 'distOk', 'testSummary', 'contractDeviations', 'unverified', 'notes'],
}

// ───────────────────────── Contract
let draft = null
if (START <= 0) {
  phase('Contract')
  draft = await agent(`너는 이 프로토타입의 리드 아키텍트다. 여러 작업자가 **서로 대화 없이 병렬로** 구현해도 한 번에 맞물리도록, 브리프를 구현 계약 문서로 바꾼다.
${COMMON}
${PACKAGE_RULES}

## 산출물: ${ROOT}/docs/CONTRACT.md (한 파일 — 충분히 상세하게, 길어도 된다)
반드시 담을 것:
0. **공통 규약** — 단위(시간은 초로 통일) · 좌표축과 각도 규약(0 이 어느 축인지 · 회전 방향) · 벡터 표현(하나로) · 고정 틱 · 이름 규칙.
1. **디렉터리 트리 + 파일 소유 표** — 모든 소스 · 테스트 파일을 나열하고 소유 패키지(P0, P1 …)를 적는다. 한 파일은 한 패키지만 소유한다.
2. **의존 규칙** — 계층 간 import 허용 표(순수 계층은 three · DOM · WebAudio · 시계 · Math.random 금지), 순환 금지 지점.
3. **타입 카탈로그** — JSDoc @typedef 코드 블록으로, 필드 · 단위 · 범위까지: 입력 프레임(InputFrame), 전체 상태와 그 부분 상태 전부(상태 이름 enum 포함), 데이터 정의, 판정/결과 값, 보상/진행 결과, SaveData(버전 포함), Settings. view 가 그려야 하는 것은 전부 상태에 노출한다(예고 표식 · 진행도 · 가능 여부 플래그).
4. **이벤트 카탈로그** — 이름(문자열 상수) · payload · 발행자 · 구독자. view · fx · audio · ui 가 필요로 하는 순간을 빠짐없이.
5. **틱 순서** — sim.step 안의 처리 순서, 같은 틱 충돌의 해소 규칙, 일시정지와 시간 정지의 처리, 렌더 보간.
6. **모듈별 공개 API** — 파일마다 export 이름과 시그니처. 다른 패키지가 호출하는 것만 공개로 적는다. P0 가 만드는 스텁의 반환 모양(중립 값)도 정한다.
7. **데이터 표와 수치** — 실제 값으로. **브리프 「측정 목표」를 산수로 맞추고** 계산 과정을 짧게 적는다. 그 산수에 묶인 값(패키지가 임의로 못 바꾸는 값)을 표시한다.
8. **콘텐츠 프레임워크** — 여러 개 만드는 것(적 · 보스 · 레벨 · 카드)은 데이터 + 훅으로 정의하는 방식과 확장 지점. 웨이브 2 의 추가 콘텐츠가 프레임워크 파일을 고치지 않고 만들어져야 한다.
9. **view 계약** — sim 상태에서 무엇을 읽어 어떻게 그리는가(리그/스프라이트/포즈 규약 · 카메라 · 장면 전환 · 이벤트 → 연출 표 · 화질 단계). 판정 범위와 보이는 것의 치수를 한 표에 묶는다.
10. **ui 계약** — 화면/패널 목록, 각 패널이 읽는 상태와 호출하는 명령, 열림/닫힘과 입력 포커스(패널이 열리면 sim 입력 차단), 키보드만으로의 조작, 문자열 키 규칙.
11. **app 계약** — 화면 상태 기계, 루프(고정 틱 누산기), 입력 수집, 저장 시점, 디버그 API(window.__game)의 메서드 목록, 개발용 URL 쿼리, **최소 부트**(스텁 상태에서도 화면이 뜨는 진입점 — P0 가 만든다), 부팅 표식(CLAUDE.md 기술 기본값 — 누가 언제 붙이는가. app 패키지가 진입점을 다시 써도 남아야 한다).
12. **봇과 테스트 계획** — 봇의 행동 규칙(사람처럼 InputFrame 만 만든다 · 반응 지연과 실수율 파라미터 · 가능한 한 모든 수단을 쓴다), 파일별 테스트 목록, 헤드리스 봇 시나리오(핵심 루프 완주 · 예외 0 · NaN 0 · 결정성 · 측정 목표), 순수 계층 검사 테스트.
13. **패키지별 완료 정의** — 패키지마다 3~8줄.

## 품질 기준
- 병렬 작업자가 추측해야 하는 것이 없어야 한다: 이름 · 단위 · 각도 규약 · 누가 그 값을 쓰는지 · 누가 만들고 없애는지.
- 장르의 표준 감각을 수치로 옮긴다(이 장르의 대표작들이 쓰는 타이밍 · 속도 · 범위의 관례).
- ${REPO}/docs/QUALITY.md 의 항목이 계약 안에서 지켜지게 설계한다.
- 과설계 금지: ECS 프레임워크 · DI 컨테이너 같은 것을 만들지 않는다. 단순한 클래스/함수 + 데이터 표.
- 형식이 궁금하면 ${REPO}/prototypes.json 에 있는 다른 프로토타입의 docs/CONTRACT.md 목차를 참고한다 — 장르가 다르니 내용은 베끼지 않는다.

끝나면 CONTRACT.md 의 목차와 핵심 결정 10개를 요약해 반환한다.`, { label: 'architect:contract', phase: 'Contract', effort: 'xhigh' })
  if (!draft) throw new Error('계약 작성이 결과 없이 끝났다 — docs/CONTRACT.md 상태를 보고 from 을 정해 다시 연다(docs/PIPELINE.md §6)')
}

// ───────────────────────── Critique (barrier: 개정이 셋을 한꺼번에 본다)
const LENSES = [
  {
    key: 'integration',
    prompt: `관점: **병렬 통합 가능성**. "이 계약만 보고 여럿이 따로 구현하면 어디서 안 맞는가"를 찾는다.
찾을 것: 정의되지 않았거나 두 군데서 다르게 적힌 이름 · 시그니처 · 필드 · 단위 · 각도 규약 / 이벤트 payload 의 누락 필드(구독자가 필요로 하는데 없는 것) / 한 파일을 둘이 소유하거나 아무도 소유하지 않는 파일 / 누가 만드는지 불명확한 객체(생성 · 소유 · 파괴) / 순환 import / 순수 계층 위반 / view 가 그려야 하는데 상태에 노출되지 않은 정보 / ui 가 호출할 명령의 부재 / 뒤 웨이브가 앞 웨이브 산출물에 요구하는 확장 지점의 부재 / 테스트 하네스가 sim 을 Node 에서 돌리는 데 필요한 것의 부재 / 틱 순서의 모호함(같은 틱에 서로 끝내는 경우 · 시간 정지 중의 타이머).`,
  },
  {
    key: 'core-feel',
    prompt: `관점: **이 장르의 핵심 감각과 공정함**. 너는 브리프의 장르와 그 대표작들의 수치(타이밍 · 속도 · 범위 · 난이도 곡선)에 밝은 디자이너다.
찾을 것: 조작과 규칙의 수치가 장르의 감각에 맞는가 / 입력이 씹히는 지점(선입력이 적용되지 않는 상태 · 창이 행동 가능 시점보다 짧은 곳) / 플레이어가 읽고 대응할 수 없는 위협(예고 길이 vs 범위 vs 대응 수단) / 대응 불가능한 연속 손해 / **한 가지 행동의 반복으로 무한히 이기는 루프**와 죽은 선택지 / 콘텐츠(상대 · 레벨)별 개성과 차별화 / 카메라와 시점이 필요한 정보를 보여 주는가 / 판정 범위와 보이는 것의 치수가 맞는가 / 선택지 사이의 균형 / 보상감.
수정안은 구체적인 수치와 규칙으로 제시한다.`,
  },
  {
    key: 'loop-economy-ux',
    prompt: `관점: **루프 속도 · 경제 · UX**. 메타 진행과 화면 흐름을 본다.
할 것: 계약의 수치로 **직접 산수해서** 브리프 「측정 목표」를 검증한다 — 실패 한 번의 보상으로 무엇을 살 수 있는가 / 도전 n 회차까지의 누적 성장과 그때의 예상 한 판 길이 / 뒤 콘텐츠로 넘어갈 때 요구 성장과 보상이 이어지는가 / 반복 · 순환에서 비용과 보상의 곡선이 발산하거나 정체하지 않는가 / 파밍과 악용 경로(실패를 반복하는 쪽이 더 버는가) / 재료 수급과 비용의 균형.
또 찾을 것: 실패 → 결과 → 재시도의 단계 수와 시간 / 저장 시점 누락(탭을 닫아도 진행이 남는가) / 세이브 버전과 손상 처리 / 화면 동선 / 패널의 키보드 조작 / 성장 미리보기 / 첫 플레이 안내 / 포인터 락 실패 · 해제 / 일시정지와 탭 비활성화 / 설정 저장.
수정안은 구체적인 수치와 규칙으로 제시한다.`,
  },
]

let critiques = []
if (START <= 1) {
  phase('Critique')
  critiques = (await parallel(LENSES.map(l => () =>
    agent(`${ROOT}/docs/CONTRACT.md 를 비평한다. 계약을 고치지 않는다.
${COMMON}
${l.prompt}

규칙: 취향 지적은 빼고, 고치지 않으면 통합이 깨지거나 게임이 나빠지는 것만 적는다. blocker = 이대로면 병렬 구현이 맞물리지 않거나 게임이 성립하지 않는다 · major = 눈에 띄는 품질 저하 · minor = 다듬기. 지적마다 계약에 그대로 넣을 수 있는 수정안을 쓴다. 15~30개.
반환하는 것과 같은 JSON 을 ${ROOT}/docs/_critique-${l.key}.json 으로도 저장한다(끊겼을 때 다시 쓰기 위한 사본).`,
      { label: `critic:${l.key}`, phase: 'Critique', schema: ISSUES_SCHEMA, effort: 'high' })
      .then(r => (r ? { lens: l.key, verdict: r.verdict, issues: r.issues } : null))
  ))).filter(Boolean)
  const all = critiques.flatMap(c => c.issues)
  log(`비평 ${critiques.length}/${LENSES.length}관점 · 지적 ${all.length}건 (blocker ${all.filter(i => i.severity === 'blocker').length})`)
}

// ───────────────────────── Revise
let revised = null
if (START <= 2) {
  phase('Revise')
  const critiqueBlock = critiques.length
    ? `아래 JSON 이 정본이다(${critiques.length}관점).\n${JSON.stringify(critiques, null, 1)}`
    : `${ROOT}/docs/_critique-*.json 을 전부 읽는다(관점마다 한 파일). 파일이 하나도 없으면 비평 없이 4 · 5 · 6 만 한다.`
  revised = await agent(`너는 리드 아키텍트다. ${ROOT}/docs/CONTRACT.md 에 대한 비평을 반영해 계약을 **확정**한다.
${COMMON}
${PACKAGE_RULES}

## 비평
${critiqueBlock}

## 할 일
1. CONTRACT.md 를 처음부터 끝까지 읽는다(길면 나눠서 전부).
2. 지적 하나하나를 **현재 문서와 대조**한다 — 앞선 개정이 도중에 끊겼을 수 있다. 이미 반영된 것을 다시 적용해 중복 문장이나 이중 수정을 만들지 않는다.
3. blocker · major 는 전부 반영한다(수정안이 틀렸다고 판단하면 더 나은 방식으로 고치고, 반영하지 않으면 이유를 rejected 에 적는다). minor 는 값싼 것만.
4. 지적끼리 충돌하면 브리프의 우선순위로 정한다. 수치를 바꿨으면 **브리프 「측정 목표」에 대한 산수를 다시 맞춘다**.
5. 문서 전체의 일관성을 훑는다 — 같은 이름과 수치가 여러 절에 나오면 전부 같아야 한다. 타입 · 이벤트 · 모듈 API · 데이터 · 파일 소유 표를 서로 대조한다. 「개정 기록」 절을 두지 않는다(계약은 현재 상태만 적는다).
6. ${ROOT}/docs/_packages.json 을 쓴다 — 배열, 패키지마다 { "id", "name", "wave", "visual", "files", "contractSections", "focus", "brief" }. P0(wave 0)부터 전부. 계약의 파일 소유 표와 정확히 일치해야 하고, 한 파일이 두 패키지에 나오면 안 된다.
   - visual: 화면을 눈으로 봐야 완성도를 알 수 있는 패키지(view · fx · ui · app)는 true.
   - focus: 그 패키지의 작업자에게 주는 가장 중요한 말이다. **무엇이 되면 성공이고 무엇이면 실패인가**를 이 게임의 말로 구체적으로 쓴다(예: "상자를 이어 붙인 더미로 보이면 실패다 — 실루엣만으로 주인공과 상대가 구분돼야 한다" · "어떤 상태에서도 입력이 씹히지 않는다 — 버퍼에 들어가 다음 가능한 틱에 나간다" · "프레임워크에 콘텐츠 ID 분기가 있으면 실패다"). 4~10줄.
   - brief: 그 패키지가 끝났을 때 참이어야 하는 것(완료 정의) 3~8줄.
7. 구조화된 결과를 반환한다(packages 는 _packages.json 과 같은 내용).`,
    { label: 'architect:revise', phase: 'Revise', schema: MODULES_SCHEMA, effort: 'xhigh' })
  if (!revised) throw new Error('계약 개정이 결과 없이 끝났다 — from: "revise" 로 다시 연다(docs/PIPELINE.md §6)')
  log(`계약 확정 — 반영 ${revised.appliedCount ?? '?'}건 · 기각 ${(revised.rejected || []).length}건 · 패키지 ${revised.packages.length}개`)
}

// ───────────────────────── Scaffold
phase('Scaffold')
const scaffold = await agent(`너는 P0(스캐폴드) 담당이다. 확정된 계약대로 프로젝트 골격을 만들어, 이후 작업자들이 **자기 파일만 채우면** 되게 한다.
${COMMON}
${ROOT}/docs/CONTRACT.md 를 끝까지 읽고(길면 나눠서 전부) ${ROOT}/docs/_packages.json 의 P0 항목을 본다.

## 만들 것
1. **프로젝트 설정** — ${REPO}/templates/prototype/ 의 파일을 ${ROOT}/ 로 복사하고 자리 표시(__SLUG__ · __TITLE__ · __PORT__)를 채운다: package.json(name 은 "${SLUG}" · 스크립트는 그대로) · vite.config.js(port ${PORT}) · .gitignore · scripts/ 의 네 파일(check-dist.mjs 는 게이트 · boot-probe.mjs 는 그 엔진 · make-standalone.mjs 와 check-standalone.mjs 는 선택 명령 — 고치지 않고 그대로 둔다). index.html(캔버스 + UI 루트 + 진입점)과 README.md(실행법 · 조작 · 구조 · 디버그 API — 임시본)를 쓴다. 의존성은 \`npm install -D vite\` 와 (3D 면) \`npm install three\` 만 — 그 밖은 추가하지 않는다(테스트는 node:test · node:assert).
2. **완성해서 내는 것**(P0 소유): src/core 전부 · src/types.js(계약의 타입 카탈로그 전부를 JSDoc @typedef 로) · 테스트 공용 헬퍼 · core 단위 테스트 · 순수 계층 검사 테스트(순수 계층의 금지 import 와 금지 토큰 — three · window · document · AudioContext · localStorage · performance. · Date.now · Math.random — 을 소스에서 찾는다. 같은 테스트가 src 전체의 상대 import 경로가 디스크의 파일 이름과 **대소문자까지** 같은지도 본다 — Windows 는 틀려도 돌지만 갤러리를 빌드하는 리눅스에서는 깨진다. 일부러 위반 파일을 넣어 실제로 잡는지 확인한 뒤 지운다).
3. **스텁으로 내는 것**(다른 패키지 소유 파일 전부): 계약의 공개 API 그대로 export 하고 JSDoc 시그니처를 붙인다. 본문은 계약이 정한 중립 값을 돌려주거나 no-op — **import 할 때도 호출할 때도 던지지 않는다**(스텁 위에서 최소 부트가 돌아야 한다). 파일 머리에 \`// OWNER: P<n> — 계약 §<절>\` 과 \`// STUB\` 을 한 줄씩. src/data 의 수치 표는 계약의 값을 **실제 값으로** 채운다.
4. **최소 부트**(진입점은 app 패키지 소유지만 지금은 P0 가 쓴다): 스텁 상태에서도 \`npm run dev\` 로 화면이 뜬다 — 자리 표시 도형이라도 sim 상태를 읽어 그린다. window.__game 에 getState · pause · step(n — 틱을 민 뒤 렌더까지) · errors 를 둔다(다음 웨이브의 화면 작업자가 숨은 탭에서 이것으로 화면을 민다). 계약의 개발용 URL 쿼리(장면 · 패널 바로 띄우기)가 동작한다. 첫 화면이 그려지면 document.documentElement.dataset.gameReady = '1', 부팅이 실패하면(예외 · WebGL 없음) dataset.gameError 에 사유 — check:dist 가 이 표식을 읽는다(사용자 입력 없이 실제 시간 20초 안에 붙어야 한다 · 잡히지 않은 예외가 하나라도 나면 떨어진다).
5. **test/** — 통과하는 core · 계층 테스트 + 패키지마다 채울 테스트 파일의 자리(계약의 파일명 · test.todo — 스텁 상태에서 \`npm test\` 가 실패하지 않게).

## 검증 (전부 실제로 실행하고 결과를 본다)
- \`npm run build\` 오류 0 · \`npm test\` 실패 0.
- _packages.json 의 모든 파일이 존재하고 각 파일 머리의 OWNER 가 표와 같은지 스크립트로 대조한다.
- \`npm run build\` → \`npm run check:dist\` 통과(프로덕션 빌드가 갤러리와 같은 하위 경로 http 에서 부팅 표식을 낸다 — 절대 경로 참조와 동적 import 로 갈린 청크가 여기서 걸린다). release/boot.png 를 직접 열어 화면이 그려졌는지 본다.
- 브라우저 스모크(가능하면): Bash(run_in_background)로 \`npx vite --port ${PORT + 1} --strictPort\` → 자기 탭에서 최소 부트와 쿼리 한두 개를 열어 콘솔 오류 0 과 화면을 본다 → 자기 탭을 닫고 자기 서버(포트 ${PORT + 1} 의 PID)만 끈다.

스캐폴드하다가 계약의 모순 · 누락(스텁의 시그니처를 정할 수 없음 등)을 발견하면 **CONTRACT.md 를 최소한으로 고쳐 확정**하고 contractDeviations 에 적는다. 추측으로 넘어가지 않는다.`,
  { label: 'scaffold:P0', phase: 'Scaffold', schema: SCAFFOLD_SCHEMA, effort: 'high' })
if (!scaffold) log('스캐폴드가 결과 없이 끝났다 — from: "scaffold" 로 다시 연다')

return {
  slug: SLUG,
  from: STEPS[START],
  contractSummary: draft,
  critiques: critiques.map(c => ({
    lens: c.lens,
    verdict: c.verdict,
    blocker: c.issues.filter(i => i.severity === 'blocker').length,
    major: c.issues.filter(i => i.severity === 'major').length,
    minor: c.issues.filter(i => i.severity === 'minor').length,
  })),
  revised: revised && {
    summary: revised.summary,
    appliedCount: revised.appliedCount,
    rejected: revised.rejected || [],
    packages: revised.packages.map(p => ({ id: p.id, name: p.name, wave: p.wave, visual: p.visual, files: p.files.length })),
  },
  scaffold,
}
