#!/usr/bin/env node
// 저장 워크플로(.claude/workflows/*.js)를 에이전트 없이 건조 실행한다 — 워크플로를 고친 뒤에 돌린다.
//   node tools/check-workflows.mjs             전체
//   node tools/check-workflows.mjs --verbose   시나리오마다 에이전트 라벨까지
// 검사: 문법 · meta 가 순수 리터럴인가 · phase 제목이 meta.phases 에 있는가 · 스키마 형식(root object · required ⊆ properties)
//       · 프롬프트에 undefined / [object Object] / 포트 NaN 이 섞이지 않았는가 · 금지 API(Date.now · Math.random · 인수 없는 new Date)
//       · 시나리오별 에이전트 수 · 어느 에이전트가 null 을 돌려줘도(건너뜀 · 실패) 의도한 오류 말고는 죽지 않는가.
// 가짜 agent() 는 스키마 모양의 값을 돌려준다. 실제 에이전트는 띄우지 않는다.
// 종료 코드 = 실패 수. 마지막 줄 `WORKFLOWS ok=N/N` (또는 `WORKFLOWS ng=K/N`).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(REPO, '.claude', 'workflows')
const VERBOSE = process.argv.includes('--verbose')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// ── 시나리오: 워크플로 이름 → [{ name, args, agents?(기대 에이전트 수), throws?(기대 오류), promptHas? }]
const BASE = { slug: 'sample-game', root: 'C:/repo/sample-game', port: 5300 }
const pkg = (n, visual) => ({ id: `P${n}`, name: `pkg-${n}`, visual })
const P8 = [1, 2, 3, 4, 5, 6, 7, 8].map(n => pkg(n, n > 4))
const P3 = [9, 10, 11].map(n => pkg(n, true))
const SCENARIOS = {
  'proto-design': [
    { name: '전체', args: BASE, agents: 6 },
    { name: 'from critique', args: { ...BASE, from: 'critique' }, agents: 5 },
    { name: 'from revise', args: { ...BASE, from: 'revise' }, agents: 2, promptHas: '_critique-*.json' },
    { name: 'from scaffold', args: { ...BASE, from: 'scaffold' }, agents: 1 },
    { name: '역슬래시 경로', args: { ...BASE, root: 'C:\\repo\\sample-game\\' }, agents: 6, promptHas: 'C:/repo/sample-game/docs/BRIEF.md' },
    { name: 'args 없음', args: undefined, throws: /args가 필요하다/ },
    { name: 'from 오타', args: { ...BASE, from: 'nope' }, throws: /from 은/ },
  ],
  'proto-build': [
    { name: '웨이브 1 · 패키지 8', args: { ...BASE, wave: 1, packages: P8, last: false }, agents: 9 },
    { name: '마지막 웨이브 · 패키지 3', args: { ...BASE, wave: 2, packages: P3, last: true }, agents: 6 },
    { name: 'from integrate', args: { ...BASE, wave: 1, packages: P8, from: 'integrate' }, agents: 1 },
    { name: 'from integrate · packages 없음', args: { ...BASE, wave: 1, from: 'integrate' }, agents: 1 },
    { name: '마지막 웨이브 from balance', args: { ...BASE, wave: 2, packages: P3, last: true, from: 'balance' }, agents: 2 },
    { name: '마지막 웨이브 from visual', args: { ...BASE, wave: 2, packages: P3, last: true, from: 'visual' }, agents: 1 },
    { name: 'last 아닌데 from balance', args: { ...BASE, wave: 1, packages: P8, from: 'balance' }, throws: /마지막 웨이브/ },
    { name: '패키지 9개', args: { ...BASE, wave: 1, packages: [...P8, pkg(99, false)] }, throws: /8개까지/ },
    { name: 'packages 빔', args: { ...BASE, wave: 1, packages: [] }, throws: /packages 가 비었다/ },
    { name: 'wave 없음', args: { ...BASE, packages: P8 }, throws: /args가 필요하다/ },
  ],
  'proto-review': [
    { name: '전체', args: BASE, agents: 9 },
    { name: 'from fix', args: { ...BASE, from: 'fix' }, agents: 4, promptHas: '_review-*.json' },
    { name: 'from final', args: { ...BASE, from: 'final' }, agents: 1 },
    { name: 'args 없음', args: undefined, throws: /args가 필요하다/ },
  ],
}

// ── meta 리터럴 추출(문자열을 건너뛰며 중괄호 짝 맞추기)
function extractMeta(src) {
  const head = 'export const meta = '
  const text = src.replace(/^\uFEFF/, '')
  if (!text.startsWith(head + '{')) return { error: '파일이 `export const meta = {` 로 시작하지 않는다' }
  let i = head.length
  let depth = 0
  let quote = null
  let bare = ''
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; bare += ch; continue }
    bare += ch
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { i++; break } }
  }
  if (depth !== 0) return { error: 'meta 의 중괄호가 닫히지 않았다' }
  const literal = text.slice(head.length, i)
  if (/[`()+]|\.\.\./.test(bare)) return { error: 'meta 는 순수 리터럴이어야 한다(변수 · 호출 · 전개 · 템플릿 문자열 금지)' }
  try {
    return { meta: new Function(`"use strict"; return (${literal})`)() }
  } catch (e) {
    return { error: `meta 를 평가하지 못했다: ${e.message}` }
  }
}

// ── 스키마 검사와 가짜 값
function schemaErrors(schema, path = 'schema') {
  const out = []
  if (!schema || typeof schema !== 'object') return [`${path}: 스키마가 객체가 아니다`]
  if (path === 'schema' && schema.type !== 'object') out.push(`${path}: 루트는 type 'object' 여야 한다`)
  if (schema.type === 'object') {
    const props = schema.properties
    if (!props || typeof props !== 'object') out.push(`${path}: properties 가 없다`)
    for (const key of schema.required || []) if (!props || !(key in props)) out.push(`${path}: required 의 '${key}' 가 properties 에 없다`)
    for (const [key, sub] of Object.entries(props || {})) out.push(...schemaErrors(sub, `${path}.${key}`))
  } else if (schema.type === 'array') {
    if (!schema.items) out.push(`${path}: array 에 items 가 없다`)
    else out.push(...schemaErrors(schema.items, `${path}[]`))
  } else if (!['string', 'number', 'boolean', 'integer'].includes(schema.type)) {
    out.push(`${path}: 모르는 type '${schema.type}'`)
  }
  return out
}

function fake(schema, turn = 0) {
  switch (schema.type) {
    case 'object': return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, sub]) => [k, fake(sub, turn)]))
    case 'array': return [0, 1, 2].map(i => fake(schema.items, i))
    case 'string': return schema.enum ? schema.enum[turn % schema.enum.length] : 'x'
    case 'boolean': return true
    default: return 1
  }
}

// ── 건조 실행
async function run(body, args, nullAt = -1) {
  const calls = []
  const phases = []
  const logs = []
  let current = null
  const agent = async (prompt, opts = {}) => {
    const index = calls.length
    calls.push({ label: opts.label || '(라벨 없음)', phase: opts.phase || current, schema: opts.schema, prompt: String(prompt) })
    if (index === nullAt) return null
    return opts.schema ? fake(opts.schema) : 'TEXT'
  }
  const parallel = thunks => Promise.all(thunks.map(async t => { try { return await t() } catch { return null } }))
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let value = item
    try { for (const stage of stages) value = await stage(value, item, i) } catch { return null }
    return value
  }))
  const phase = title => { current = title; phases.push(title) }
  const log = message => logs.push(String(message))
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = async () => { throw new Error('workflow() 는 건조 실행이 지원하지 않는다') }
  let result
  let error = null
  try {
    const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', body)
    result = await fn(agent, parallel, pipeline, phase, log, args, budget, workflow)
  } catch (e) {
    error = e
  }
  return { calls, phases, logs, result, error }
}

const DELIBERATE = /결과 없이 끝났다/ // 워크플로가 일부러 던지는 오류(재개 안내)

async function checkScenario(meta, body, sc) {
  const problems = []
  const r = await run(body, sc.args)
  if (sc.throws) {
    if (!r.error) problems.push('오류가 나야 하는데 끝까지 돌았다')
    else if (!sc.throws.test(r.error.message)) problems.push(`다른 오류가 났다: ${r.error.message}`)
    return { problems, calls: r.calls }
  }
  if (r.error) return { problems: [`오류: ${r.error.stack || r.error.message}`], calls: r.calls }

  const titles = new Set((meta.phases || []).map(p => p.title))
  for (const t of r.phases) if (!titles.has(t)) problems.push(`phase('${t}') 가 meta.phases 에 없다`)
  const labels = new Set()
  for (const c of r.calls) {
    if (c.phase && !titles.has(c.phase)) problems.push(`${c.label}: phase '${c.phase}' 가 meta.phases 에 없다`)
    if (labels.has(c.label)) problems.push(`라벨이 겹친다: ${c.label}`)
    labels.add(c.label)
    if (c.schema) problems.push(...schemaErrors(c.schema).map(e => `${c.label}: ${e}`))
    const bad = c.prompt.match(/\bundefined\b|\[object Object\]|(?:--port|포트)\s+NaN\b/)
    if (bad) problems.push(`${c.label}: 프롬프트에 '${bad[0]}' 가 섞였다`)
  }
  if (sc.agents !== undefined && r.calls.length !== sc.agents) problems.push(`에이전트 수 ${r.calls.length} ≠ 기대 ${sc.agents}`)
  if (sc.promptHas && !r.calls.some(c => c.prompt.includes(sc.promptHas))) problems.push(`어느 프롬프트에도 '${sc.promptHas}' 가 없다`)
  try { JSON.stringify(r.result) } catch (e) { problems.push(`반환값을 직렬화하지 못한다: ${e.message}`) }

  // 에이전트 하나가 null 을 돌려줘도 의도한 오류 말고는 죽지 않는다
  for (let i = 0; i < r.calls.length; i++) {
    const n = await run(body, sc.args, i)
    if (n.error && !DELIBERATE.test(n.error.message)) problems.push(`${r.calls[i].label} 가 null 일 때 죽는다: ${n.error.message}`)
  }
  return { problems, calls: r.calls }
}

// ── 본체
if (!existsSync(DIR)) {
  console.log(`워크플로 폴더가 없다: ${DIR}`)
  process.exit(1)
}
let total = 0
let failed = 0
for (const file of readdirSync(DIR).filter(f => f.endsWith('.js')).sort()) {
  const src = readFileSync(join(DIR, file), 'utf8')
  const staticProblems = []
  const { meta, error } = extractMeta(src)
  if (error) staticProblems.push(error)
  if (meta) {
    if (!meta.name || !meta.description) staticProblems.push('meta 에 name · description 이 필요하다')
    if (meta.name && `${meta.name}.js` !== file) staticProblems.push(`meta.name('${meta.name}') 과 파일 이름이 다르다`)
  }
  const banned = src.match(/\bDate\.now\s*\(|\bMath\.random\s*\(|new Date\(\s*\)/)
  if (banned) staticProblems.push(`금지 API: ${banned[0]} — 워크플로 재개가 깨진다`)
  total++
  if (staticProblems.length) {
    failed++
    console.log(`NG  ${file} [정적]`)
    for (const p of staticProblems) console.log(`      - ${p}`)
    if (!meta) continue
  } else {
    console.log(`ok  ${file} [정적] — phases: ${(meta.phases || []).map(p => p.title).join(' → ')}`)
  }

  const body = src.replace(/^\uFEFF/, '').replace('export const meta =', 'const meta =')
  const scenarios = SCENARIOS[meta.name]
  if (!scenarios) {
    console.log(`  ?  ${file}: 이 도구에 시나리오가 없다 — tools/check-workflows.mjs 의 SCENARIOS 에 더한다`)
    continue
  }
  for (const sc of scenarios) {
    total++
    const { problems, calls } = await checkScenario(meta, body, sc)
    if (problems.length) {
      failed++
      console.log(`NG  ${file} · ${sc.name}`)
      for (const p of problems) console.log(`      - ${p}`)
    } else {
      console.log(`ok  ${file} · ${sc.name}${sc.throws ? ' (기대한 오류)' : ` — 에이전트 ${calls.length}`}`)
    }
    if (VERBOSE && !sc.throws) for (const c of calls) console.log(`        ${c.phase || '-'} · ${c.label} · 프롬프트 ${c.prompt.length}자`)
  }
}
console.log(failed ? `WORKFLOWS ng=${failed}/${total}` : `WORKFLOWS ok=${total}/${total}`)
process.exit(Math.min(failed, 250))
