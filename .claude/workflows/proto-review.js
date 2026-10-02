export const meta = {
  name: 'proto-review',
  description: '프로토타입 리뷰 — 5관점 결함 탐색(증거 필수) → 영역별 반증 · 수정 → 최종 게이트(프로덕션 빌드 전체 루프 · 배포 모양 부팅 검사) (에이전트 9개)',
  whenToUse: '오케스트레이터가 docs/PIPELINE.md §4에서 마지막 웨이브가 끝난 뒤에 연다. args: { slug, root, port, from? } — from 은 find(기본) · fix · final.',
  phases: [
    { title: 'Find', detail: 'sim 로직 · 메타 흐름 · 뷰/성능 · 브라우저 견고성 · 플레이어 경험/완결성' },
    { title: 'Fix', detail: 'sim · view · ui-app 영역별로 먼저 반증하고, 재현되는 것만 수정 + 회귀 테스트' },
    { title: 'Final', detail: '전체 빌드/테스트 · 프로덕션 빌드로 전체 루프 · check:dist · README · NOTES-REVIEW' },
  ],
}

// args: { slug, root, port, from?: 'find' | 'fix' | 'final' }
// 끝난 뒤 오케스트레이터가 할 일은 docs/PIPELINE.md §4. 이 파일을 고치면 node tools/check-workflows.mjs.
const STEPS = ['find', 'fix', 'final']
if (!args || typeof args.slug !== 'string' || typeof args.root !== 'string' || !Number.isInteger(args.port)) {
  throw new Error('args가 필요하다: { slug, root(프로토타입 폴더 절대 경로), port, from? }')
}
const START = STEPS.indexOf(args.from || 'find')
if (START < 0) throw new Error(`from 은 ${STEPS.join(' · ')} 중 하나다`)

const SLUG = args.slug
const ROOT = args.root.replace(/\\/g, '/').replace(/\/+$/, '')
const REPO = ROOT.slice(0, ROOT.lastIndexOf('/'))
const PORT = args.port

const COMMON = `
## 작업 환경
- 프로토타입 폴더: ${ROOT} (slug ${SLUG} · 포트 ${PORT}). 리포 루트: ${REPO}.
- 리포 규칙과 환경 주의(포트 · 숨은 브라우저 창 · heredoc)는 주입된 CLAUDE.md 그대로다 — 특히: 이 폴더 밖을 쓰지 않는다 · git 은 읽기만 · 다른 서브에이전트를 띄우지 않는다 · 의존성을 추가하지 않는다 · 임시 파일은 ${ROOT}/docs/_scratch/ 에 만들고 끝나면 지운다.
- 현재 상태: 구현과 밸런스 게이트 · 화면 패스가 끝났고 빌드와 테스트가 통과한다. 읽을 것: ${ROOT}/docs/BRIEF.md(방향) · ${ROOT}/README.md(실행 · 쿼리 · 디버그 API) · ${ROOT}/docs/NOTES-W*.md · NOTES-BALANCE.md · NOTES-VISUAL.md(**이미 알려진 문제와 고친 것**) · ${REPO}/docs/QUALITY.md(공통 품질 기준). 계약은 ${ROOT}/docs/CONTRACT.md — 길다. Grep 으로 절을 찾아 읽는다.
`

const BROWSER = port => `
## 브라우저 (필요할 때)
- 서버: Bash(run_in_background)로 \`cd ${ROOT} && npx vite --port ${port} --strictPort\`. 끝나면 **네가 띄운 프로세스만** 끈다(netstat -ano 로 포트 ${port} 의 PID → taskkill //F //PID <pid>).
- 브라우저 도구: ToolSearch 로 "select:mcp__Claude_Browser__tabs_create,mcp__Claude_Browser__navigate,mcp__Claude_Browser__computer,mcp__Claude_Browser__read_console_messages,mcp__Claude_Browser__javascript_tool,mcp__Claude_Browser__tabs_close" 를 로드 → tabs_create 로 **네 탭**을 만들고 이후 모든 호출에 그 tabId 를 넘긴다. 끝나면 네 탭만 닫는다.
- 창이 숨겨져 있으면 화면이 저절로 돌지 않는다 — window.__game.pause(true) 뒤 step(n) 으로 밀어 정지 화면을 본다. 화면 전환에는 실제 시간이 든다(호출 뒤 1~2초 기다린다). 오류는 새로 읽은 뒤의 window.__game.errors() 로 본다.
- 브라우저 도구가 안 되면 두 번까지만 시도하고 Node 로 가능한 검증으로 대신한다(그 사실을 적는다).
`

const AREA_SCOPE = {
  sim: 'src/sim · src/data(strings.ko.js 제외) · src/core · src/bot · test',
  view: 'src/view · src/audio',
  'ui-app': 'src/ui · src/app · src/main.js · index.html · vite.config.js · README.md · src/data/strings.ko.js',
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          area: { type: 'string', enum: ['sim', 'view', 'ui-app'], description: `고칠 파일이 있는 영역 — sim: ${AREA_SCOPE.sim} / view: ${AREA_SCOPE.view} / ui-app: ${AREA_SCOPE['ui-app']}` },
          file: { type: 'string' },
          line: { type: 'number' },
          title: { type: 'string' },
          evidence: { type: 'string', description: '재현 방법과 실제로 관찰한 결과(실행한 스크립트의 출력 · 스크린샷에서 본 것 · 확정적인 코드 경로). 추측이면 내지 않는다.' },
          playerImpact: { type: 'string', description: '플레이어가 겪는 것' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'area', 'file', 'title', 'evidence', 'playerImpact', 'suggestedFix'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const LENSES = [
  {
    key: 'sim-logic',
    browser: false,
    prompt: `관점: **시뮬레이션의 결함**. 대상: src/sim · src/data · src/bot.
찾을 것: 빠져나오지 못하는 상태(소프트락) / 같은 틱 동시 종료 / 전이 도중의 종료와 재진입 / 판정이 두 번 들어가거나 들어가지 않는 경로 / 플래그가 남는 경로 / 대상이 사라진 뒤의 참조 / 거리 0 · atan2(0,0) · NaN 전파 / 경계 밖이나 장애물 안에 끼임 / 이전 판의 잔재가 다음 판으로 넘어옴 / 일시정지와 시간 정지 중의 타이머 / 큰 dt / 데이터 오류(범위 0 · 창이 구간 밖) / 진행 배율이 큰 값일 때 터지는 것 / 대응할 수 없는 위협(무적보다 긴 판정이면서 범위를 벗어날 수도 없는 것) / **한 가지 행동의 반복으로 무한히 이기는 루프** / 효과(아이템 · 강화)가 실제로 적용되는가.
방법: Node 로 실제 sim 을 띄워 재현한다(test 의 헬퍼와 src/bot 사용). 무작위 입력 퍼즈 + 표적 시나리오. **재현 스크립트의 출력이 있는 것만** 보고한다.`,
  },
  {
    key: 'meta-flow',
    browser: true,
    prompt: `관점: **진행 · 경제 · 저장 · 화면 흐름의 결함**. 대상: 진행/경제/저장 모듈 · src/app · src/ui.
찾을 것: 재화 복사와 무한 파밍(포기 · 재도전 · 반복 감쇠 우회) / 음수 재화 · 상한 초과 / 보상 이중 지급(실패와 성공이 겹칠 때 · 결과 화면에서 연타할 때 · 전환 중 입력) / 해금과 완료 표시의 꼬임 / 장착 · 교체 뒤 수치 미갱신 / 저장 누락 지점(탭을 닫으면 잃는 진행) / 깨진 · 구버전 · 악의적 세이브에서 throw 또는 이상 상태 / 새 게임이 기존 세이브를 확인 없이 덮음 / 개발용 쿼리 세션이 실제 세이브를 건드림 / 화면 상태 기계의 경쟁(전환 중 다른 전환 요청 · 일시정지 중 전환 · 결과 화면 중 Esc · 포기 연타) / 패널이 열린 채 sim 이 도는 경우 / 실패 → 결과 → 재시도의 키 입력 수와 시간.
방법: Node 로 진행/저장 모듈을 직접 호출하는 재현 스크립트 + 화면 상태 기계와 저장소는 가짜 UI · 가짜 localStorage 로 재현. 필요하면 브라우저에서 실제 앱으로 확인한다. **재현 결과가 있는 것만** 보고한다.`,
  },
  {
    key: 'view-perf',
    browser: true,
    prompt: `관점: **뷰 · 이펙트 · 오디오의 누수와 성능, 상태와 화면의 불일치**. 대상: src/view · src/audio.
찾을 것: 판을 반복할 때 쌓이는 것(지오메트리 · 재질 · 텍스처의 dispose 누락 · 장면에 남는 객체 · 이벤트 구독 미해제 · 풀에 돌아오지 않는 입자와 DOM) / 프레임마다 도는 경로의 할당 / 불필요한 그림자와 드로 콜 / 화질 전환 뒤 남는 렌더 타깃 / 리사이즈와 DPR / 오디오 노드 누수 · 음악 전환의 겹침 · 볼륨 0 · unlock 전 호출 · 일시정지 중의 소리 / 이벤트 순서 가정 / **sim 상태와 화면의 어긋남** — 판정 범위와 보이는 무기 · 몸 · 바닥 표식을 수치로 대조한다(core 의 판정 함수와 뷰의 치수) · 순간 이동이 보간에서 미끄러져 보이는가 · 끝난 대상이 계속 그려지는가 · 카메라가 한 프레임에 튀는가.
방법: Node 에서 three 객체는 WebGL 없이 만들어진다 — 레이어를 가짜 렌더 컨텍스트로 만들 수 있으면 판을 50회 반복한 뒤 장면의 객체 수 · 풀 크기 · 구독자 수를 잰다. 브라우저에서는 디버그 API 로 판을 20회 반복하며 renderer.info.memory · renderer.info.render.calls · DOM 노드 수의 추세를 기록하고, step 한 번의 CPU 시간도 잰다. **측정값이 있는 것만** 보고한다.`,
  },
  {
    key: 'browser-robustness',
    browser: true,
    prompt: `관점: **실제 브라우저 조건에서의 견고성**. 대상: src/app(입력 · 루프 · 화면 전환 · 저장) · src/main.js · index.html · vite.config.js · 렌더러 · 오디오 엔진 · README.md.
찾을 것: **한글 IME** 가 켜진 상태의 키 입력(event.code 를 쓰는가) / 키 반복이 에지로 세어지는가 / 포커스를 잃었을 때 눌린 키가 남는가 / 전환 막이나 패널이 떠 있는 동안 누르기 시작한 키가 닫힌 뒤 눌림으로 잡히는가 / 포인터 락의 수명(획득 실패 · Esc 해제 · 패널 열림과 닫힘 · 재획득의 사용자 제스처 요건) / 우클릭 메뉴 · 휠 · 옆 버튼 / 마우스 이동 스파이크의 처리(버리지 않고 자르는가) / 게임패드 연결과 해제 / 탭 숨김 → 복귀의 dt 폭주 / 주사율 30 · 60 · 144 · 240Hz 에서의 누산기 / 리사이즈 · 전체 화면 · DPR 변경 / WebGL 미지원과 컨텍스트 로스트의 안내 / AudioContext 자동 재생 정책(첫 제스처 — 키와 클릭 모두 — 에서 켜지는가) / 터치 기기로 열었을 때의 안내 / localStorage 가 막힌 브라우저 / 프로덕션 빌드(\`npm run build\` 뒤 \`npx vite preview --port <네 포트>\`)가 dev 와 똑같이 도는가 / README 의 실행 안내가 실제와 맞는가.
방법: 코드 정독 + 브라우저에서 합성 이벤트로 재현(KeyboardEvent 의 key 'Process' · code 'KeyW' · blur · visibilitychange · resize · 가짜 getGamepads). 프레임 dt 는 루프에 직접 넣어 본다. **재현했거나 코드 경로가 확정적인 것만** 보고한다.`,
  },
  {
    key: 'player-experience',
    browser: true,
    prompt: `관점: **처음 하는 사람의 10분 + 브리프 완결성**. 너는 이 게임을 처음 켠 그 장르의 팬이다.
(1) 실제 앱을 브라우저에서 쿼리 없이 처음부터 플레이한다 — step 과 실제 키 이벤트 · 디버그 입력으로 **직접 조종한다**(봇에게만 맡기지 않는다). 각 단계에서 "모르겠다 · 답답하다 · 안 보인다 · 불공정하다 · 느리다"를 적는다. 스크린샷으로 본 것만.
(2) **브리프 대조(완결성 비평)**: docs/BRIEF.md 를 한 줄씩 체크한다 — 구현됨 / 부분 / 없음. 없음과 부분을 findings 로 낸다.
(3) 한국어 문면: src/data/strings.ko.js 의 번역투 · 오탈자 · 용어 불일치(같은 것을 다른 이름으로) · 뜻이 반대로 읽히는 문장 · 화면에 넘치는 글 · 설명 없는 개발 용어.
(4) 루프 속도: 실패의 순간 → 다시 도전하기까지의 키 입력 수와 초(전환의 실제 시간 포함). 성장하러 다녀오는 동선의 길이.
(5) 조작감: 선입력이 창 안에서 실제로 나가는가 · 누른 것이 버려지는 상황이 있는가 · 규칙의 뜻이 게임 안에 적혀 있는가.
**직접 보거나 실행해 확인한 것만** 보고한다.`,
  },
]

// ───────────────────────── Find (barrier: 영역별 수정이 전체 지적을 나눠 받는다)
let found = []
if (START <= 0) {
  phase('Find')
  found = (await parallel(LENSES.map((l, i) => () =>
    agent(`너는 이 프로토타입의 리뷰어다. 코드를 **고치지 않고** 결함만 찾는다(임시 재현 스크립트는 ${ROOT}/docs/_scratch/${l.key}/ 에 만들고 끝나면 지운다).
${COMMON}
${l.browser ? BROWSER(PORT + 2 + i) : ''}
## 네 관점
${l.prompt}

## 규칙
- 이미 알려진 것(NOTES 의 「남은 문제」와 「사람이 확인할 것」)은 다시 보고하지 않는다. 다만 거기서 가볍게 적혔는데 네가 재현해 보니 더 심각한 것은 근거와 함께 보고한다.
- 취향 · 리팩토링 제안 · "~일 수도 있다"는 내지 않는다. 플레이어가 겪는 결함만, 증거와 함께.
- blocker = 진행 불가 · 데이터 손실 · 크래시 / major = 눈에 띄는 오동작 · 불공정 · 브리프 미충족 / minor = 다듬기.
- 수는 중요하지 않다 — 진짜인 것 5개가 추측 20개보다 낫다. 깊이 판다.
- 반환하는 것과 같은 JSON 을 ${ROOT}/docs/_review-${l.key}.json 으로도 저장한다(끊겼을 때 다시 쓰기 위한 사본).`,
      { label: `find:${l.key}`, phase: 'Find', schema: FINDINGS_SCHEMA, effort: 'xhigh' })
      .then(r => (r ? r.findings.map(f => ({ ...f, lens: l.key })) : []))
  ))).filter(Boolean).flat()
  const n = s => found.filter(f => f.severity === s).length
  log(`탐색 종료 — 지적 ${found.length}건 (blocker ${n('blocker')} · major ${n('major')} · minor ${n('minor')})`)
}

// ───────────────────────── Fix (영역이 겹치지 않아 병렬)
const AREAS = [
  { key: 'sim', note: '수치를 바꾸면 그 수치를 단언하는 테스트와 CONTRACT.md 의 해당 절을 함께 맞춘다. 밸런스에 영향을 주는 수정 뒤에는 봇 시나리오 테스트가 여전히 통과하는지 본다.' },
  { key: 'view', note: '화면을 고쳤으면 브라우저 정지 화면으로 확인한다. 판정과 보이는 것의 치수를 맞추는 수정은 sim 데이터와 뷰 중 어느 쪽을 고칠지 계약의 의도로 정하고, 다른 영역의 파일이면 crossAreaRequests 로 남긴다.' },
  { key: 'ui-app', note: 'app 로직의 수정에는 Node 회귀 테스트를 더한다(가짜 UI · 가짜 localStorage). UI 를 고쳤으면 1280×720 정지 화면으로 확인한다.' },
]
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    area: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          verdict: { type: 'string', enum: ['fixed', 'refuted', 'deferred'] },
          detail: { type: 'string', description: 'fixed: 무엇을 어떻게 고쳤고 어떻게 확인했나 / refuted: 왜 결함이 아닌가(재현 결과) / deferred: 왜 지금 못 고치나 · Jay 가 정할 것' },
          files: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'verdict', 'detail'],
      },
    },
    gateOutput: { type: 'string' },
    crossAreaRequests: { type: 'array', items: { type: 'string' }, description: '다른 영역의 파일을 고쳐야 끝나는 것(네가 고치지 않은 것)' },
  },
  required: ['area', 'results', 'gateOutput'],
}

let fixes = []
if (START <= 1) {
  phase('Fix')
  const haveFindings = START === 0
  fixes = (await parallel(AREAS.map((a, i) => () => {
    const mine = found.filter(f => f.area === a.key)
    if (haveFindings && mine.length === 0) return Promise.resolve({ area: a.key, results: [], gateOutput: '지적 없음' })
    const findingBlock = haveFindings
      ? `아래 JSON 이 네 영역의 지적 ${mine.length}건이다.\n${JSON.stringify(mine, null, 1)}`
      : `${ROOT}/docs/_review-*.json 을 전부 읽고 area 가 "${a.key}" 인 지적만 처리한다. 이미 고쳐진 것(앞선 실행이 끊겼을 수 있다)은 현재 코드로 확인해 fixed 로 적는다.`
    return agent(`너는 이 프로토타입의 **${a.key} 영역 수정 담당**이다. 리뷰어들이 낸 지적 중 네 영역의 것을 처리한다. 다른 두 영역의 담당이 동시에 작업 중이다.
${COMMON}
${BROWSER(PORT + 7 + i)}
## 네 영역 (이 안의 파일만 고친다)
${AREA_SCOPE[a.key]}
${a.note}
다른 영역의 파일을 고쳐야 하면 고치지 말고 crossAreaRequests 로 남긴다. CONTRACT.md 는 네 수정으로 계약이 달라질 때만 해당 절을 최소한으로 고친다.

## 지적
${findingBlock}

## 처리 방법 — 지적마다
1. **먼저 반증을 시도한다.** 리뷰어의 증거를 믿지 말고 직접 재현한다. 재현되지 않거나 의도된 동작(계약 · 브리프에 근거)이면 refuted.
2. 재현되면 고친다. 증상이 아니라 원인을 고친다. 가능한 것은 회귀 테스트를 더한다(재현 스크립트를 테스트로 옮긴다).
3. blocker · major 는 전부 처리한다. minor 는 값싸고 안전한 것만 고치고 나머지는 deferred(이유와 함께). 브리프의 방향이나 계약이 묶어 둔 값을 바꿔야 닫히는 것은 고치지 않고 deferred 로 올린다 — Jay 가 정한다.
4. 고친 것이 다른 동작을 깨지 않는지 관련 테스트를 돌린다. 동시에 작업 중인 다른 담당의 파일 때문에 전체 테스트가 잠깐 깨질 수 있다 — 네 영역 원인의 실패만 책임진다.
5. 끝에 \`npm run build\` · \`npm test\` 를 돌려 네 영역 원인의 실패 0 을 확인한다.`,
      { label: `fix:${a.key}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'xhigh' })
      .then(r => r || { area: a.key, results: [], gateOutput: '에이전트가 결과 없이 끝났다' })
  }))).map((r, i) => r || { area: AREAS[i].key, results: [], gateOutput: '에이전트 호출이 실패했다' })
  const c = v => fixes.flatMap(f => f.results).filter(r => r.verdict === v).length
  log(`수정 종료 — fixed ${c('fixed')} · refuted ${c('refuted')} · deferred ${c('deferred')}`)
}

// ───────────────────────── Final
const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    buildOk: { type: 'boolean' },
    testOk: { type: 'boolean' },
    testSummary: { type: 'string' },
    prodLoopOk: { type: 'boolean' },
    prodLoopNotes: { type: 'string' },
    distOk: { type: 'boolean', description: 'build → check:dist 통과(하위 경로 http 부팅)' },
    crossAreaHandled: { type: 'array', items: { type: 'string' } },
    jayDecisions: { type: 'array', items: { type: 'string' }, description: 'Jay 가 정할 것 — 선택지와 권고' },
    humanChecks: { type: 'array', items: { type: 'string' }, description: '사람이 확인할 것 — 무엇을 어떻게 + 조정 손잡이' },
    remaining: {
      type: 'array',
      items: {
        type: 'object',
        properties: { severity: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' } },
        required: ['severity', 'problem', 'suggestion'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['buildOk', 'testOk', 'testSummary', 'prodLoopOk', 'prodLoopNotes', 'distOk', 'jayDecisions', 'humanChecks', 'remaining', 'summary'],
}

phase('Final')
const final = await agent(`너는 이 프로토타입의 **최종 게이트** 담당이다. 리뷰 지적의 수정이 끝났다. 전체가 다시 맞물리는지 확인하고 마무리한다. 이 프로토타입 폴더 안의 어느 파일이든 고칠 수 있다(최소한으로).
${COMMON}
${BROWSER(PORT + 20)}
## 수정 결과
${fixes.length ? JSON.stringify(fixes, null, 1) : '(이 실행에는 없다 — docs/_review-*.json 과 현재 코드로 무엇이 고쳐졌는지 확인한다)'}

## 할 일
1. \`npm run build\` · \`npm test\`. 실패를 전부 고친다(세 담당이 동시에 고쳐 서로 어긋난 곳).
2. crossAreaRequests 를 처리한다(영역을 넘는 수정).
3. **프로덕션 빌드로 전체 루프**: \`npm run build\` 뒤 \`npx vite preview --port ${PORT + 20} --strictPort\` 로 방금 빌드한 dist 를 띄워 쿼리 없이 첫 화면부터 — 시작 → 핵심 루프의 모든 화면 → 실패 → 결과 → 재시도 → 성공 → 진행 → 남은 콘텐츠 전부 → 새로고침 → 이어하기. 직접 조종과 봇을 섞는다. 단계마다 오류 0. 여기서 발견한 결함을 고친다.
4. **배포 모양 부팅 검사**: \`npm run build\` → \`npm run check:dist\` 통과(갤러리와 같은 하위 경로 http 에서 부팅 표식 · 새는 요청 0 · 404 0 · 단일 번들), release/boot.png 를 직접 본다. 단일 HTML(build:standalone)은 게이트가 아니다 — 만들지 않는다.
5. deferred 중 값싸게 닫을 수 있는 것을 닫는다. 브리프의 방향이나 묶인 값을 바꿔야 하는 것은 닫지 않고 jayDecisions 로 올린다(선택지 · 각각의 대가 · 권고).
6. README.md 를 최종 상태에 맞춘다: 실행법(\`npm.cmd --prefix <폴더> run dev\` 꼴 포함) · 조작 표 · 게임 흐름 · 팁 · 개발용 쿼리와 디버그 API · 알려진 한계.
7. ${ROOT}/docs/NOTES-REVIEW.md 를 쓴다: 게이트 결과 · 고친 것 · 반증된 것 · 남은 것 · **Jay 가 정할 것** · **사람이 확인할 것**(이 환경에서 볼 수 없었던 것 — 무엇을 어떻게 보면 되는지 + 조정 손잡이).
8. ${ROOT}/docs/_scratch/ 가 남아 있으면 지운다. dist/ 와 release/boot.png 는 지우지 않는다.
9. 마지막으로 \`npm run build\` · \`npm test\` · \`npm run check:dist\` 를 다시 돌린다 — distOk 와 release/boot.png 는 이 마지막 실행의 것이다.`,
  { label: 'final:gate', phase: 'Final', schema: FINAL_SCHEMA, effort: 'xhigh' })
if (!final) log('최종 게이트가 결과 없이 끝났다 — from: "final" 로 다시 연다')

return {
  slug: SLUG,
  from: STEPS[START],
  found: found.map(f => ({ lens: f.lens, severity: f.severity, area: f.area, file: f.file, title: f.title })),
  fixes,
  final,
}
