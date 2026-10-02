#!/usr/bin/env node
// guard.mjs — PreToolUse 훅(Bash · PowerShell · Edit · Write). .claude/settings.json 이 부른다.
// 종료 코드 2 = 차단(stderr 가 에이전트에게 간다). 파싱 실패와 예외는 통과시키고(fail-open) .claude/logs/guard.log 에 남긴다.
//
// 규칙 — CLAUDE.md 「불변 규칙」 3 · 4 · 5 와 「환경」의 기계 강제:
//   G1  서브에이전트의 git 은 읽기 명령만 (허용 목록 밖은 차단)
//   G2  누구든 node 프로세스를 이름으로 통째로 끄지 못한다 (taskkill /IM node.exe · Stop-Process -Name node · pkill/killall node)
//   G3  서브에이전트는 프로토타입 폴더 안(과 OS 임시 폴더 · ~/.claude)만 쓴다 — 리포 루트 파일과 운영 자산은 못 쓴다
// 서브에이전트 = stdin 에 agent_type 또는 agent_id 가 있는 호출. 메인 세션에는 G2 만 걸린다.
// 리포 루트는 cwd 가 아니라 이 파일의 위치에서 잡는다(에이전트가 cd 해도 같다). 다른 프로젝트의 세션에서 불리면 아무것도 하지 않는다.
// 명령 문자열 검사는 휴리스틱이다 — 마지막 방어선은 오케스트레이터의 git status 확인이다.
//
// 회귀: node .claude/hooks/guard.mjs --selftest   (이 파일을 고치면 돌린다 — 마지막 줄 `GUARD ok=N/N`)
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RESERVED = new Set(['.claude', '.github', '.git', 'docs', 'tools', 'templates', 'node_modules', '_site'])
const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'blame', 'grep', 'describe',
  'cat-file', 'shortlog', 'check-ignore', 'check-attr', 'merge-base', 'name-rev', 'for-each-ref', 'show-ref',
  'version', 'help', '--version', '--help', 'whatchanged', 'reflog', 'count-objects', 'ls-remote',
])

const norm = p => String(p).replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, '$1:/').replace(/\/+$/, '')
const lower = p => norm(p).toLowerCase()
const inside = (child, parent) => {
  const c = lower(child)
  const p = lower(parent)
  return c === p || c.startsWith(p + '/')
}

function tokens(text) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^["']|["']$/g, ''))
}

// 명령 문자열에서 "명령 위치"의 조각들을 낸다: [{ name, args }] — name 은 소문자 · 경로와 .exe 제거
function commands(command) {
  const out = []
  for (const seg of String(command).split(/&&|\|\||[;|\n`]|\$\(|[(){}]|(?<![<>&\d])&(?!&)/)) {
    const words = tokens(seg.trim())
    while (words.length && (/^\w+=/.test(words[0]) || ['env', 'command', 'sudo', 'time', 'exec', 'nohup'].includes(words[0].toLowerCase()))) words.shift()
    if (!words.length) continue
    const name = norm(words[0]).split('/').pop().toLowerCase().replace(/\.exe$/, '')
    out.push({ name, args: words.slice(1) })
  }
  return out
}

function gitWrite(args) {
  const rest = [...args]
  while (rest.length) {
    const a = rest[0]
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') { rest.splice(0, 2); continue }
    if (/^--(git-dir|work-tree|namespace)=/.test(a) || ['--no-pager', '-p', '--paginate', '--no-optional-locks', '--bare', '--no-replace-objects'].includes(a)) { rest.shift(); continue }
    break
  }
  const sub = (rest[0] || '').toLowerCase()
  const more = rest.slice(1)
  if (!sub || GIT_READ.has(sub)) return ''
  const onlyFlags = allowed => more.every(a => allowed.includes(a) || /^--(format|sort|contains|merged|no-merged|points-at)(=|$)/.test(a))
  if (sub === 'branch' && onlyFlags(['--show-current', '-a', '-r', '-v', '-vv', '--list', '-l', '--all', '--remotes'])) return ''
  if (sub === 'tag' && onlyFlags(['-l', '--list', '-n'])) return ''
  if (sub === 'remote' && (!more.length || ['-v', 'show', 'get-url'].includes(more[0]))) return ''
  if (sub === 'config' && more.some(a => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(a))) return ''
  if (sub === 'stash' && ['list', 'show'].includes(more[0])) return ''
  if (sub === 'worktree' && more[0] === 'list') return ''
  return `git ${sub}`
}

function killsAllNode(command) {
  const text = String(command)
  if (/(?:^|[;&|({\n])\s*Get-Process\s+(?:-Name\s+)?["']?node["']?\s*\|\s*(?:Stop-Process|kill)\b/i.test(text)) return 'Get-Process node | Stop-Process'
  for (const { name, args } of commands(text)) {
    const joined = args.join(' ')
    if (name === 'taskkill' && /(?:^|\s)\/{1,2}im\s+node(?:\.exe)?\b/i.test(' ' + joined)) return 'taskkill /IM node.exe'
    if (name === 'stop-process' && /-name\s+node\b/i.test(joined)) return 'Stop-Process -Name node'
    if ((name === 'pkill' || name === 'killall') && /(?:^|\s)(?:-\w+\s+)*node(?:\.exe)?\b/i.test(' ' + joined)) return `${name} node`
    if (name === 'wmic' && /node(?:\.exe)?/i.test(joined) && /\b(delete|terminate)\b/i.test(joined)) return 'wmic … node … delete'
  }
  return ''
}

/**
 * @param {object} input PreToolUse 훅의 stdin JSON
 * @param {{ projectDir?: string }} env
 * @returns {null | { rule: string, message: string }} 차단이면 사유
 */
export function decide(input, env = {}) {
  if (!input || typeof input !== 'object') return null
  const cwd = input.cwd ? norm(input.cwd) : REPO
  // 다른 프로젝트의 세션에서 불렸으면 손대지 않는다
  if (env.projectDir ? lower(env.projectDir) !== lower(REPO) : !inside(cwd, REPO)) return null

  const sub = Boolean(input.agent_type || input.agent_id)
  const tool = input.tool_input || {}

  if (typeof tool.command === 'string') {
    const kill = killsAllNode(tool.command)
    if (kill) {
      return { rule: 'G2', message: `guard: '${kill}' 은 막혀 있다 — 다른 세션과 다른 작업자의 서버까지 꺼진다. 자기가 띄운 것만 끈다: netstat -ano 로 그 포트의 PID 를 찾아 taskkill //F //PID <pid>.` }
    }
    if (sub) {
      for (const { name, args } of commands(tool.command)) {
        if (name !== 'git') continue
        const what = gitWrite(args)
        if (what) {
          return { rule: 'G1', message: `guard: '${what}' 는 서브에이전트에게 막혀 있다 — git 은 읽기 명령만 쓴다(status · diff · log · show · ls-files …). 같은 작업 트리를 다른 작업자와 나눠 쓰므로 스테이징 · 커밋 · stash · reset · checkout 은 하지 않는다. 새 파일은 미추적 그대로 두고, 되돌릴 것은 직접 고쳐 쓴다. 이 차단을 보고에 적고 계속 진행한다.` }
        }
      }
    }
    return null
  }

  if (sub && typeof tool.file_path === 'string' && tool.file_path) {
    let path = norm(tool.file_path)
    if (!isAbsolute(path)) path = join(cwd, path)
    path = norm(resolve(path))
    if (inside(path, REPO)) {
      const rel = path.slice(norm(REPO).length + 1)
      const parts = rel.split('/')
      if (parts.length < 2) {
        return { rule: 'G3', message: `guard: '${rel}' — 리포 루트의 파일은 서브에이전트가 쓰지 않는다(prototypes.json 은 오케스트레이터가, 나머지는 Jay 가 시킬 때만). 맡은 프로토타입 폴더 안에서 해결하고, 필요하면 보고에 적는다.` }
      }
      if (RESERVED.has(parts[0].toLowerCase())) {
        return { rule: 'G3', message: `guard: '${rel}' — ${parts[0]}/ 는 운영 자산이다. 서브에이전트는 쓰지 않는다(고칠 것이 보이면 보고에 적는다 — 오케스트레이터가 docs/RETRO.md 에 옮긴다).` }
      }
      return null
    }
    if (inside(path, tmpdir()) || inside(path, join(homedir(), '.claude'))) return null
    return { rule: 'G3', message: `guard: '${path}' — 리포 밖이다. 서브에이전트는 맡은 프로토타입 폴더 안만 쓴다(임시 파일은 <폴더>/docs/_scratch/).` }
  }
  return null
}

function logLine(line) {
  try {
    const dir = join(REPO, '.claude', 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'guard.log'), `${new Date().toISOString()} ${line}\n`)
  } catch { /* 로그 실패로 작업을 막지 않는다 */ }
}

// ── 회귀 표: [id, 입력, 기대(차단 규칙 또는 null), 설명]
function selftest() {
  const R = norm(REPO)
  const agent = { agent_type: 'workflow-subagent', agent_id: 'a1' }
  const bash = (command, who = agent, cwd = `${R}/my-game`) => ({ ...who, cwd, tool_name: 'Bash', tool_input: { command } })
  const write = (file_path, who = agent, cwd = `${R}/my-game`) => ({ ...who, cwd, tool_name: 'Write', tool_input: { file_path, content: '문서 끝' } })
  const main = {}
  const cases = [
    ['B01', bash('git status --short'), null, '읽기 git'],
    ['B02', bash('git -C .. log --oneline -5 && git diff --stat'), null, '읽기 git — 전역 옵션 · 연결'],
    ['B03', bash('git add -A'), 'G1', '스테이징'],
    ['B04', bash('cd src && git commit -m "x"'), 'G1', '연결 뒤의 커밋'],
    ['B05', bash('git -C "C:/some path/repo" push origin main'), 'G1', '전역 옵션 뒤의 push'],
    ['B06', bash('git stash'), 'G1', 'stash'],
    ['B07', bash('git stash list'), null, 'stash 조회'],
    ['B08', bash('git checkout -- src/a.js'), 'G1', 'checkout'],
    ['B09', bash('git reset --hard HEAD'), 'G1', 'reset'],
    ['B10', bash('grep -rn "git add" README.md'), null, '인수 안의 문자열은 명령이 아니다'],
    ['B11', bash('echo $(git rev-parse --show-toplevel)'), null, '명령 치환 안의 읽기'],
    ['B12', bash('echo $(git clean -fd)'), 'G1', '명령 치환 안의 쓰기'],
    ['B13', bash('git branch --show-current'), null, '브랜치 조회'],
    ['B14', bash('git branch -D feature'), 'G1', '브랜치 삭제'],
    ['B15', bash('git add -A', main), null, '메인 세션의 git 은 막지 않는다'],
    ['B16', bash('npm test && node --test test/a.test.js'), null, '평범한 명령'],
    ['B17', bash('"C:/Program Files/Git/cmd/git.exe" commit -m x'), 'G1', '경로가 붙은 git.exe'],
    ['B18', bash('git config --get user.name'), null, 'config 조회'],
    ['B19', bash('git config user.name x'), 'G1', 'config 쓰기'],
    ['B20', bash('git ls-remote --tags https://github.com/actions/checkout'), null, '원격 조회(읽기)'],
    ['K01', bash('taskkill //F //IM node.exe'), 'G2', 'node 를 이름으로 끔'],
    ['K02', bash('taskkill /F /IM node.exe', main), 'G2', '메인 세션에도 걸린다'],
    ['K03', bash('taskkill //F //PID 2904'), null, 'PID 로 끄는 것은 된다'],
    ['K04', bash('Stop-Process -Name node -Force', main), 'G2', 'PowerShell'],
    ['K05', bash('Get-Process node | Stop-Process', main), 'G2', 'PowerShell 파이프'],
    ['K06', bash('pkill -f node'), 'G2', 'pkill'],
    ['K07', bash('grep -n "taskkill //IM node.exe" docs/NOTES.md'), null, '문서 검색은 된다'],
    ['K08', bash('netstat -ano | grep LISTENING | grep :5301'), null, '포트 조회'],
    ['W01', write(`${R}/my-game/src/sim/player.js`), null, '프로토타입 폴더 안'],
    ['W02', write('src/sim/player.js'), null, '상대 경로 — cwd 가 프로토타입 폴더'],
    ['W03', write(`${R}/CLAUDE.md`), 'G3', '리포 루트 파일'],
    ['W04', write(`${R}/prototypes.json`), 'G3', '목록은 오케스트레이터 것'],
    ['W05', write(`${R}/docs/PIPELINE.md`), 'G3', '운영 문서'],
    ['W06', write(`${R}/.claude/workflows/proto-build.js`), 'G3', '워크플로'],
    ['W07', write('../tools/status.mjs'), 'G3', '상대 경로로 빠져나감'],
    ['W08', write(`${R}/my-game/docs/NOTES-P1.md`), null, '프로토타입의 docs 는 된다'],
    ['W09', write(`${norm(tmpdir())}/proto-scratch/a.mjs`), null, 'OS 임시 폴더'],
    ['W10', write(norm(resolve(parse(REPO).root, 'guard-selftest-outside', 'a.txt'))), 'G3', '리포 밖(임시 폴더도 ~/.claude 도 아닌 곳)'],
    ['W11', write(`${R}/CLAUDE.md`, main), null, '메인 세션은 규율로 지킨다'],
    ['W12', write(`${R}/.github/workflows/deploy-gallery.yml`), 'G3', '배포 워크플로'],
    ['W13', write(R.replace(/^([a-zA-Z]):/, (m, d) => `/${d.toLowerCase()}`) + '/README.md'), 'G3', 'Git Bash 꼴 경로(/c/…)'],
    ['X01', { ...agent, cwd: 'C:/Other/Project', tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, null, '다른 프로젝트의 cwd — 손대지 않는다'],
    ['X02', write(`${R}/CLAUDE.md`, { agent_id: 'only-id' }), 'G3', 'agent_id 만 있어도 서브에이전트'],
  ]
  let failed = 0
  for (const [id, input, expect, note] of cases) {
    const got = decide(input)
    const rule = got ? got.rule : null
    if (rule !== expect) {
      failed++
      console.log(`NG  ${id} 기대 ${expect} · 실제 ${rule} — ${note}`)
    }
  }
  // projectDir 이 다른 세션에서는 꺼진다
  if (decide(bash('git add -A'), { projectDir: 'C:/Other/Project' }) !== null) { failed++; console.log('NG  X03 다른 프로젝트 세션에서 동작했다') }
  if (decide(bash('git add -A'), { projectDir: REPO }) === null) { failed++; console.log('NG  X04 자기 프로젝트 세션에서 동작하지 않았다') }
  const total = cases.length + 2
  console.log(failed ? `GUARD ng=${failed}/${total}` : `GUARD ok=${total}/${total}`)
  return failed
}

// ── 진입
if (process.argv.includes('--selftest')) {
  process.exit(Math.min(selftest(), 250))
}
let code = 0
try {
  const raw = readFileSync(0)
  const input = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
  const verdict = decide(input, { projectDir: process.env.CLAUDE_PROJECT_DIR })
  if (verdict) {
    logLine(`BLOCK ${verdict.rule} agent=${input.agent_type || input.agent_id || 'main'} tool=${input.tool_name || '?'} target=${String((input.tool_input || {}).command || (input.tool_input || {}).file_path || '').slice(0, 200).replace(/\s+/g, ' ')}`)
    process.stderr.write(verdict.message + '\n')
    code = 2
  }
} catch (e) {
  logLine(`FAILOPEN ${e && e.message ? e.message.slice(0, 160) : e}`)
  code = 0
}
process.exit(code)
