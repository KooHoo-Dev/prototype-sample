export const meta = {
  name: 'proto-build',
  description: '프로토타입 구현 한 웨이브 — 패키지 병렬 구현 → 통합 게이트 (+ 마지막 웨이브는 밸런스 게이트 · 화면 패스)',
  whenToUse: '오케스트레이터가 docs/PIPELINE.md §3에서 웨이브마다 한 번 연다. args: { slug, root, port, wave, packages: [{ id, name, visual? }], last?, from? } — packages 와 last 는 node tools/check-packages.mjs <slug> 가 찍어 준다. from 은 implement(기본) · integrate · balance · visual.',
  phases: [
    { title: 'Implement', detail: '패키지마다 한 명 — 소유 파일만, 패키지 게이트 통과까지' },
    { title: 'Integrate', detail: '전체 빌드 · 테스트 · 패키지 간 어긋남 수정 · 헤드리스/브라우저 스모크' },
    { title: 'Balance', detail: '마지막 웨이브만 — 봇으로 브리프의 측정 목표를 재고 수치 조정' },
    { title: 'Visual', detail: '마지막 웨이브만 — 실제 앱으로 전체 루프를 보며 화면 · UX 수정' },
  ],
}

// args: { slug, root, port, wave: 1, packages: [{ id: 'P1', name: 'sim-player', visual: false }, …], last: false, from?: 'implement' | 'integrate' | 'balance' | 'visual' }
// 패키지의 소유 파일 · 읽을 절 · focus · 완료 정의는 작업자가 <root>/docs/_packages.json 에서 직접 읽는다.
// 끝난 뒤 오케스트레이터가 할 일은 docs/PIPELINE.md §3. 이 파일을 고치면 node tools/check-workflows.mjs.
const STEPS = ['implement', 'integrate', 'balance', 'visual']
const MAX_PACKAGES = 8
if (!args || typeof args.slug !== 'string' || typeof args.root !== 'string' || !Number.isInteger(args.port) || !Number.isInteger(args.wave) || args.wave < 1) {
  throw new Error('args가 필요하다: { slug, root, port, wave(1 이상), packages: [{ id, name, visual? }], last?, from? }')
}
const START = STEPS.indexOf(args.from || 'implement')
if (START < 0) throw new Error(`from 은 ${STEPS.join(' · ')} 중 하나다`)
const LAST = args.last === true
if (START >= 2 && !LAST) throw new Error('from: balance · visual 은 마지막 웨이브(last: true)에서만 쓴다')
const PKGS = Array.isArray(args.packages) ? args.packages : []
if (START === 0 && PKGS.length === 0) throw new Error('packages 가 비었다 — node tools/check-packages.mjs <slug> 의 출력을 넘긴다')
if (PKGS.length > MAX_PACKAGES) throw new Error(`한 웨이브는 패키지 ${MAX_PACKAGES}개까지다 — 계약의 웨이브를 나눈다`)
if (PKGS.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string')) throw new Error('packages 의 항목은 { id, name, visual? } 다')

const SLUG = args.slug
const ROOT = args.root.replace(/\\/g, '/').replace(/\/+$/, '')
const REPO = ROOT.slice(0, ROOT.lastIndexOf('/'))
const PORT = args.port
const WAVE = args.wave

const COMMON = `
## 작업 환경
- 프로토타입 폴더: ${ROOT} (slug ${SLUG} · 포트 ${PORT}). 리포 루트: ${REPO}.
- 리포 규칙과 환경 주의(포트 · 숨은 브라우저 창 · heredoc)는 주입된 CLAUDE.md 그대로다 — 특히: 이 폴더 밖을 쓰지 않는다 · git 은 읽기만 · 다른 서브에이전트를 띄우지 않는다 · 의존성을 추가하지 않는다 · 임시 파일은 ${ROOT}/docs/_scratch/ 에 만들고 끝나면 지운다.
- ${ROOT}/docs/BRIEF.md(방향)를 먼저 읽는다. 계약은 ${ROOT}/docs/CONTRACT.md — 길다. Grep 으로 절 머리(## · ###)의 줄 번호를 찾아 필요한 범위를 나눠 읽는다. 「W<n> 확정」 표시가 붙은 곳은 앞 웨이브에서 구현에 맞춰 확정된 해석이다. 공통 품질 기준은 ${REPO}/docs/QUALITY.md.
`

const BROWSER = port => `
## 브라우저 확인
- 서버: Bash(run_in_background)로 \`cd ${ROOT} && npx vite --port ${port} --strictPort\`. 끝나면 **네가 띄운 프로세스만** 끈다 — Windows: netstat -ano 로 포트 ${port} 의 PID → taskkill //F //PID <pid> · 리눅스(클라우드 세션): ps -eo pid,args 에서 \`vite --port ${port}\` 의 PID → kill <pid>(npx 의 PID 만 끄면 자식 vite 가 남는다).
- 브라우저 도구: ToolSearch 로 "select:mcp__Claude_Browser__tabs_create,mcp__Claude_Browser__navigate,mcp__Claude_Browser__computer,mcp__Claude_Browser__read_console_messages,mcp__Claude_Browser__javascript_tool,mcp__Claude_Browser__tabs_close" 를 로드 → tabs_create 로 **네 탭**을 만들고 이후 모든 호출에 그 tabId 를 넘긴다. 끝나면 네 탭만 닫는다.
- 브라우저 도구가 로드되지 않으면(클라우드 세션에는 내장 브라우저가 없다) 헤드리스로 찍는다: \`cd ${ROOT} && npm run probe:screen -- "http://127.0.0.1:${port}/?<쿼리>" --step <n> [--eval "<식 — api 는 window.__game>"] --out docs/_scratch/<이름>.png\` → 스크린샷을 Read 로 직접 본다. 출력의 errors() · 예외가 콘솔 확인을 대신한다. 정지 화면만 보이므로 실시간으로만 드러나는 것은 「사람이 확인할 것」으로 남긴다.
- 창이 숨겨져 있으면 화면이 저절로 돌지 않는다 — window.__game.pause(true) 뒤 step(n) 으로 밀어 정지 화면을 본다. 계약의 개발용 URL 쿼리로 장면과 패널을 바로 띄운다. javascript_tool 로 상태를 조작해 여러 순간을 본다. 스크린샷을 실제로 보고 판단한다.
- 콘솔 오류는 새로 읽은 뒤의 window.__game.errors() 로 본다(다른 작업자가 파일을 고치는 동안 옛 오류가 남는다).
- 브라우저 도구와 probe:screen 이 둘 다 안 되면 두 번까지만 시도하고 포기한다 — unverified 에 "화면 미확인"을 적고 Node 로 가능한 검증(생성 · update 반복 · NaN 검사)을 한다.
`

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    packageId: { type: 'string' },
    gateOk: { type: 'boolean', description: '패키지 게이트(자기 테스트 + 자기 파일 원인 빌드 오류 0)를 실제로 실행해 통과했는가' },
    gateOutput: { type: 'string', description: '마지막으로 실행한 게이트 명령과 요약 출력(tests/pass/fail 수)' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    browserChecked: { type: 'boolean' },
    contractIssues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' },
          problem: { type: 'string' },
          resolution: { type: 'string', description: '네 파일 안에서 어떻게 처리했는가 / 통합 때 누가 무엇을 고쳐야 하는가' },
        },
        required: ['section', 'problem', 'resolution'],
      },
    },
    publicSurface: { type: 'string', description: '다른 패키지가 알아야 할 것 — 계약에 없지만 네가 정한 공개 동작과 주의점' },
    unverified: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['packageId', 'gateOk', 'gateOutput', 'filesWritten', 'contractIssues', 'unverified', 'summary'],
}

const ISSUE_ITEM = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    area: { type: 'string' },
    problem: { type: 'string' },
    suggestion: { type: 'string' },
  },
  required: ['severity', 'area', 'problem', 'suggestion'],
}
const FIX_ITEM = { type: 'object', properties: { file: { type: 'string' }, what: { type: 'string' } }, required: ['file', 'what'] }

const INTEG_SCHEMA = {
  type: 'object',
  properties: {
    buildOk: { type: 'boolean' },
    testOk: { type: 'boolean' },
    testSummary: { type: 'string' },
    distOk: { type: 'boolean', description: '마지막 build → check:dist 통과(하위 경로 http 부팅)' },
    headlessSmokeOk: { type: 'boolean' },
    browserSmokeOk: { type: 'boolean' },
    browserNotes: { type: 'string', description: '화면에서 본 것 — 무엇이 그려지고 무엇이 이상한가' },
    fixes: { type: 'array', items: FIX_ITEM },
    contractEdits: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'array', items: ISSUE_ITEM },
    nextWaveNotes: { type: 'string', description: '다음 웨이브(또는 다음 게이트)가 알아야 할 것' },
  },
  required: ['buildOk', 'testOk', 'testSummary', 'distOk', 'headlessSmokeOk', 'browserSmokeOk', 'fixes', 'openIssues', 'nextWaveNotes'],
}

const BALANCE_SCHEMA = {
  type: 'object',
  properties: {
    buildOk: { type: 'boolean' },
    testOk: { type: 'boolean' },
    testSummary: { type: 'string' },
    measurements: { type: 'string', description: '봇 측정 표 — 콘텐츠 × 진행 단계별 한 판 길이 · 승률 · 도전 횟수 · 선택 분포 등 실제 값' },
    targetsMet: { type: 'string', description: '브리프 「측정 목표」 항목마다 목표와 잰 값' },
    tuning: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, change: { type: 'string' }, why: { type: 'string' } }, required: ['file', 'change', 'why'] } },
    fixes: { type: 'array', items: FIX_ITEM },
    limits: { type: 'array', items: { type: 'string' }, description: '측정의 한계 — 봇이 쓰지 않는 수단 등' },
    openIssues: { type: 'array', items: ISSUE_ITEM },
    summary: { type: 'string' },
  },
  required: ['buildOk', 'testOk', 'testSummary', 'measurements', 'targetsMet', 'tuning', 'fixes', 'limits', 'openIssues', 'summary'],
}

const VISUAL_SCHEMA = {
  type: 'object',
  properties: {
    buildOk: { type: 'boolean' },
    testOk: { type: 'boolean' },
    distOk: { type: 'boolean', description: '마지막 build → check:dist 통과(하위 경로 http 부팅)' },
    loopVerified: { type: 'string', description: '실제 앱으로 돈 전체 루프의 단계별 결과(무엇을 눌렀고 무엇이 보였나)' },
    fixes: { type: 'array', items: FIX_ITEM },
    humanChecks: { type: 'array', items: { type: 'string' }, description: '사람이 확인할 것 — 무엇을 어떻게 보면 되는지 + 조정 손잡이(파일 · 상수 · 권장 범위)' },
    openIssues: { type: 'array', items: ISSUE_ITEM },
    summary: { type: 'string' },
  },
  required: ['buildOk', 'testOk', 'distOk', 'loopVerified', 'fixes', 'humanChecks', 'openIssues', 'summary'],
}

// ───────────────────────── Implement
let reports = []
if (START <= 0) {
  phase('Implement')
  reports = await parallel(PKGS.map((p, i) => () =>
    agent(`너는 패키지 **${p.id} (${p.name})** 담당이다. 웨이브 ${WAVE} — 지금 다른 ${PKGS.length - 1}명이 각자의 패키지를 동시에 구현하고 있다. 서로 대화할 수 없고, 계약만이 맞물리는 근거다.
${COMMON}
## 읽을 것 (순서대로)
1. ${ROOT}/docs/_packages.json 에서 id 가 "${p.id}" 인 항목 — files(소유 파일) · contractSections(읽을 절) · focus(이 패키지의 핵심) · brief(완료 정의).
2. CONTRACT.md 의 그 절 **전부**.
3. ${ROOT}/docs/NOTES-W*.md 가 있으면 전부(앞 웨이브의 통합 결과와 네 패키지가 알아야 할 것).
4. 네 소유 파일의 현재 상태(스텁이거나, 끊긴 작업이 남긴 중간 상태일 수 있다 — 있는 것을 검증하고 이어 간다), 네가 import 하는 core · data · types, 그리고 앞 웨이브가 이미 구현한 파일(시그니처는 실제 코드로 확인한다).

## 구현 규칙
- **네 소유 파일만** 쓴다. 남의 파일 · src/core · src/types.js · CONTRACT.md 는 고치지 않는다. 계약과 어긋나야 할 사정 · 계약의 모순 · 남의 파일의 결함은 ${ROOT}/docs/NOTES-${p.id}.md 에 짧게 적고(네 파일 안에서 보수적으로 해결) contractIssues 로 반환한다.
- 공개 API(이름 · 시그니처 · 이벤트 이름과 payload · 상태 필드)는 계약 그대로다. 스텁의 export 이름을 바꾸거나 없애지 않는다. 계약에 없는 내부 구조는 네 재량이다.
- 스텁 표식을 지우고 **완전 구현**한다. TODO 로 남기지 않는다. 수치는 src/data 에서 읽는다(계약이 묶어 둔 값은 바꾸지 않는다).
- 같은 웨이브의 남의 구현에 기대는 테스트를 쓰지 않는다(계약의 테스트 헬퍼를 쓴다).
- 프레임마다 도는 경로에서 객체 할당을 줄인다(특히 view · fx).
- 과설계 금지. 다만 **완성도는 타협하지 않는다** — focus 에 적힌 실패 조건에 걸리면 끝난 것이 아니다. QUALITY.md 에서 네 패키지에 해당하는 항목을 지킨다.

## 끝내기 전 (전부 실제로 실행)
- 패키지 게이트: 네 테스트 파일을 \`node --test <파일>\` 로 돌려 실패 0(자리 표시 todo 를 계약의 테스트 항목으로 **실제 테스트로 채운다**) · 순수 계층 검사 테스트가 네 파일 때문에 깨지지 않는다 · \`npm run build\` 에서 네 파일 원인 오류 0.
- 자기 코드를 처음부터 다시 읽으며 계약과 대조한다: 이벤트 누락 · 단위 · 각도 규약 · 경계 조건(0 · 최대 · 큰 dt · 전이 도중 종료).
${p.visual ? BROWSER(PORT + 2 + i) : ''}
최종 반환은 구조화된 보고다(packageId 는 "${p.id}").`,
      { label: `impl:${p.id}-${p.name}`, phase: 'Implement', schema: IMPL_SCHEMA })
      .then(r => r || { packageId: p.id, gateOk: false, gateOutput: '에이전트가 결과 없이 끝났다', filesWritten: [], contractIssues: [], unverified: ['보고 없음 — 이 패키지의 파일 상태를 직접 확인해야 한다'], summary: 'NULL' })
  ))
  // parallel 은 던진 thunk 를 null 로 돌려준다 — 위 .then 은 null 결과만 메우므로 한 번 더 메운다
  reports = reports.map((r, i) => r || { packageId: PKGS[i].id, gateOk: false, gateOutput: '에이전트 호출이 실패했다', filesWritten: [], contractIssues: [], unverified: ['보고 없음'], summary: 'NULL' })
  log(`웨이브 ${WAVE} 구현 종료 — 게이트 통과 ${reports.filter(r => r.gateOk).length}/${PKGS.length} · 계약 이슈 ${reports.reduce((n, r) => n + (r.contractIssues || []).length, 0)}건`)
}

// ───────────────────────── Integrate
let integration = null
if (START <= 1) {
  phase('Integrate')
  const reportBlock = reports.length
    ? JSON.stringify(reports, null, 1)
    : '(이 실행에는 작업자 보고가 없다 — docs/NOTES-P*.md 와 코드로 대신한다)'
  integration = await agent(`너는 웨이브 ${WAVE} **통합 게이트** 담당이다. 작업자들이 병렬 구현을 마쳤다. 전체가 한 번에 맞물리는지 확인하고 패키지 사이의 어긋남을 고친다. 여기서는 **이 프로토타입 폴더 안의 어느 파일이든** 고칠 수 있다 — 최소한으로, 계약의 공개 API 방향으로.
${COMMON}
(계약은 파일 소유 · 의존 규칙 · 이벤트 · 틱 순서 · 모듈 API · 테스트 계획 · 완료 정의 절을 읽는다. 다른 절은 문제를 추적할 때 찾아 읽는다.)

## 작업자 보고
${reportBlock}

## 할 일
1. ${ROOT}/docs/NOTES-P*.md 를 전부 읽고 보고의 contractIssues · unverified 와 합쳐 "통합 때 고쳐야 할 것" 목록을 만든다.
2. \`npm run build\` · \`npm test\`(전체)를 돌려 실패를 전부 고친다. 두 패키지가 서로 다르게 해석한 곳은 계약 문면 → 브리프의 우선순위 순으로 정한다. 계약이 틀렸거나 비어 있었으면 CONTRACT.md 를 현재 상태에 맞추고 고친 곳에 「W${WAVE} 확정」 표시를 붙인다.
3. **교차 호출 지점을 눈으로 대조한다**(테스트가 못 잡는 것): 세션(틱 순서의 주인) ↔ 각 sim 모듈의 시그니처와 반환 / 이벤트 payload — 이벤트 이름 전부를 Grep 으로 발행 지점과 구독 지점을 짝지어, 발행자가 실제로 넣는 필드와 구독자가 읽는 필드를 맞춘다 / view 가 읽는 상태 필드와 sim 이 실제로 채우는 필드 / ui 가 부르는 명령의 존재 / 문자열 키 누락.
4. **헤드리스 통합 스모크**(임시 스크립트): 실제 구현으로 sim 을 만들어 핵심 루프를 스크립트 입력으로 sim 시간 60초 이상 돌린다. 예외 0 · NaN 0 · 양쪽(플레이어와 상대/시스템)이 실제로 영향을 주고받는가 · 실패 종료와 성공 종료가 둘 다 도달 가능한가(디버그로 조건을 당겨서라도) · 종료 뒤 보상/진행 이벤트가 나오는가. 무작위 입력 퍼즈도 돌린다. 안 되는 것을 고친다.
5. **브라우저 스모크**: 계약의 주요 장면과 패널을 전부 띄워 스크린샷과 오류를 본다. 오류를 전부 고친다. 화면이 계약 · 브리프와 다르게 보이는 것(안 보임 · 땅에 묻힘 · 방향 반대 · 카메라가 엉뚱한 곳 · HUD 겹침 · 표식 위치 어긋남 · 발광 과다)을 고치거나 openIssues 로 남긴다.
6. 마지막에 \`npm run build\` · \`npm test\` · \`npm run check:dist\` 를 다시 돌려 통과를 확인한다(check:dist 는 프로덕션 빌드를 갤러리와 같은 하위 경로 http 로 열어 부팅 표식 · 잡히지 않은 예외 · 새는 요청을 본다 — 떨어지면 원인을 고친다). release/boot.png 를 직접 본다.
7. ${ROOT}/docs/NOTES-W${WAVE}.md 를 쓴다: 게이트 결과 · 고친 것 · 계약 수정 목록 · **다음 웨이브의 패키지별로 알아야 할 것** · 남은 문제.
${BROWSER(PORT + 20)}
고치지 못한 것과 판단이 필요한 것은 openIssues 로 구체적으로 남긴다(추측으로 덮지 않는다).`,
    { label: `integrate:W${WAVE}`, phase: 'Integrate', schema: INTEG_SCHEMA, effort: 'xhigh' })
  if (!integration) log(`통합 게이트가 결과 없이 끝났다 — from: "integrate" 로 다시 연다`)
}

// ───────────────────────── Balance · Visual (마지막 웨이브만)
let balance = null
let visual = null
if (LAST) {
  if (START <= 2) {
    phase('Balance')
    balance = await agent(`너는 **밸런스 게이트** 담당이다. 구현이 끝났다. 이제 게임이 성립하는지 **숫자로** 확인하고 고친다. 이 프로토타입 폴더 안의 어느 파일이든 고칠 수 있다(sim · data · bot · test 가 중심이다 — 화면은 다음 담당이 본다).
${COMMON}
(계약은 틱 순서 · 데이터와 수치 · 콘텐츠 프레임워크 · 봇과 테스트 계획 절을 읽는다.)

## 직전 통합 게이트의 결과
${integration ? JSON.stringify({ openIssues: integration.openIssues, nextWaveNotes: integration.nextWaveNotes }, null, 1) : '(이 실행에는 없다 — docs/NOTES-W*.md 를 읽는다)'}

## 할 일
1. ${ROOT}/docs/NOTES-W*.md · NOTES-P*.md 의 남은 문제를 읽는다.
2. \`npm run build\` · \`npm test\`. skip · todo 로 미뤄 둔 테스트를 **켠다**.
3. **봇으로 잰다**(임시 스크립트): 콘텐츠(상대 · 레벨 · 모드) 전부 × 여러 시드(각 10판 이상) × 진행 단계(처음 / 그 지점에 도달했을 법한 상태 / 과성장)에서 — 예외 0 · NaN 0 · 교착(아무 일도 일어나지 않는 30초) 0 · 선택 분포(상대가 고르는 행동과 플레이어의 선택지 — 하나가 60%를 넘거나 한 번도 나오지 않는 것이 없는가) · 한 판 길이 · 승률 · 실패 시 진행 비율 · 손해의 원인 분포(대응할 수 없는 위협이 있는가).
4. **브리프 「측정 목표」를 맞춘다**: 메타 루프 시나리오(처음부터 시작해 봇이 실패 → 얻은 것으로 가장 값싼 성장 → 재도전을 반복)로 목표 항목을 하나씩 잰다. 뒤 콘텐츠로 이어질 때 성장과 보상이 끊기지 않는지, 반복 · 순환에서 발산하거나 정체하지 않는지도 본다. 벗어나면 계약이 묶어 둔 값을 조정하고, 그 수치를 단언하는 테스트와 CONTRACT.md 를 함께 맞춘다. 봇은 사람보다 반응이 빠르다 — 반응 지연과 실수율을 "보통 사람" 설정으로 두고 잰다.
5. **퇴화 동작을 고친다**: 같은 행동만 반복 · 제자리에서 돌기만 함 · 닿지 않는 거리의 헛동작 · 한 수단으로 무한히 이기는 루프 · 밀려서 끼임. 고친 뒤 3 을 다시 돌려 확인한다.
6. **조작감에 직결되는 sim 결함을 찾아 고친다**: 입력이 씹히는 경로(선입력 창이 행동 가능 시점보다 짧은 상태) · 과도한 벌(연타가 긴 무력화로 이어짐) · 대응할 수 없는 연속 손해.
7. \`npm run build\` · \`npm test\` 재확인. ${ROOT}/docs/NOTES-BALANCE.md 를 쓴다: 측정 표 · 조정한 값과 이유 · 고친 것 · 남은 문제 · 측정의 한계(봇이 쓰지 않는 수단).

고치지 못한 것은 openIssues 로 구체적으로 남긴다.`,
      { label: 'gate:balance', phase: 'Balance', schema: BALANCE_SCHEMA, effort: 'xhigh' })
    if (!balance) log('밸런스 게이트가 결과 없이 끝났다 — from: "balance" 로 다시 연다')
  }

  phase('Visual')
  visual = await agent(`너는 **화면/UX 패스** 담당이다. sim 과 밸런스 게이트는 끝났다. 이제 실제 앱을 브라우저에서 처음부터 끝까지 돌려 "플레이어가 보는 것"을 확인하고 고친다. view · audio · ui · app 의 어느 파일이든 고칠 수 있다(sim · data 는 화면 문제의 원인일 때만 최소한으로).
${COMMON}
(계약은 view · ui · app 절을 읽는다. ${ROOT}/docs/NOTES-BALANCE.md 와 NOTES-W*.md 의 남은 문제도 읽는다.)

## 직전 게이트의 결과
${balance ? JSON.stringify({ summary: balance.summary, openIssues: balance.openIssues }, null, 1) : '(이 실행에는 없다 — docs/NOTES-BALANCE.md 를 읽는다)'}
${BROWSER(PORT + 22)}
## 할 일
1. **전체 루프를 실제 앱으로 돈다**(쿼리 없이 첫 화면부터): 시작 → 핵심 루프의 모든 화면과 패널 → 실패 → 결과 → 재시도 → 성공 → 진행(구매 · 해금) → 남은 콘텐츠 전부 → 새로고침 → 이어하기. 직접 조종하고(실제 키 이벤트 · 디버그 입력) 봇도 써서, 중요한 순간(예고 · 판정 · 피격 · 전환 · 종료)의 스크린샷을 본다. 단계마다 오류 0 을 확인한다.
2. **보이는 문제를 고친다** — ${REPO}/docs/QUALITY.md §4 를 한 줄씩 대조한다. 특히:
   - 가독성: 대상이 배경에 묻히는가 · 바닥 표식과 경고가 모든 장면의 바닥 위에서 읽히는가.
   - 연출 과다: 화면이 하얗게 뜨는 프레임 · 대상을 덮는 섬광 · 블룸 · 비네트 · 점멸 · 흔들림.
   - 캐릭터: 발이 땅에 묻히거나 뜨는가 · 무기가 손에 붙어 있는가 · 방향이 반대인가 · 포즈 전환이 튀는가(연속 step 스크린샷) · 걸음이 미끄러지는가 · 판정과 보이는 몸이 맞는가 · 타격의 순간에 무기가 닿아 있는가.
   - 카메라: 고정 구도 · 벽과 기둥 · 급회전.
   - UI: 1280×720 과 1920×1080 에서 겹침 · 잘림 · 낮은 대비 · 화면에 그대로 보이는 문자열 키 · 패널의 키보드 조작 · 결과 화면의 수치가 sim 과 같은가.
   - 흐름: 전환 시간 · 입력 누수(패널 키가 게임으로, 연타가 다음 화면으로) · 포인터 락 실패 시 대체 조작 · 일시정지 · 첫 플레이 안내.
3. 고친 뒤 \`npm run build\` · \`npm test\` · \`npm run check:dist\` 통과를 확인한다(부팅 표식은 남아 있어야 한다 — CLAUDE.md 기술 기본값). release/boot.png 를 직접 본다.
4. ${ROOT}/docs/NOTES-VISUAL.md 를 쓴다: 방법(환경의 한계 포함) · 돌려 본 것 · 고친 것 · 남은 문제 · **사람이 확인할 것**(무엇을 어떻게 보면 되는지 + 조정 손잡이: 파일 · 상수 이름 · 권장 범위).

스크린샷을 실제로 보고 판단한다 — 코드만 읽고 "괜찮을 것"이라고 쓰지 않는다.`,
    { label: 'visual:ux-pass', phase: 'Visual', schema: VISUAL_SCHEMA, effort: 'xhigh' })
  if (!visual) log('화면 패스가 결과 없이 끝났다 — from: "visual" 로 다시 연다')
}

return {
  slug: SLUG,
  wave: WAVE,
  last: LAST,
  from: STEPS[START],
  reports: reports.map(r => ({
    packageId: r.packageId,
    gateOk: r.gateOk,
    gateOutput: r.gateOutput,
    browserChecked: r.browserChecked,
    files: (r.filesWritten || []).length,
    contractIssues: r.contractIssues,
    unverified: r.unverified,
    summary: r.summary,
  })),
  integration,
  balance,
  visual,
}
