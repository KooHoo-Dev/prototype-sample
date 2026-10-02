#!/usr/bin/env node
// 프로토타입 현황 — 읽기 전용.
//   node tools/status.mjs          전체 표
//   node tools/status.mjs <slug>   한 프로토타입 상세(진행 기록 전체 · 문서 유무 · 다음 단계)
// 「다음 단계」는 docs/PIPELINE.md §6 의 표를 디스크 상태에 적용한 것이다 — STATUS.md 의 기록과 어긋나면 기록이 정본이다.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = JSON.parse(readFileSync(join(REPO, 'prototypes.json'), 'utf8'))
const list = registry.prototypes || []
const only = process.argv[2]

// 한글 · 한자 · 전각 문자는 터미널에서 두 칸을 차지한다
const wide = cp => (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
const width = s => [...String(s)].reduce((n, ch) => n + (wide(ch.codePointAt(0)) ? 2 : 1), 0)
const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)))
const cut = (s, n) => {
  let out = ''
  for (const ch of String(s)) {
    if (width(out + ch) > n - 1) return out + '…'
    out += ch
  }
  return out
}

function statusRows(dir) {
  const file = join(dir, 'docs', 'STATUS.md')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^\|/.test(line) && !/^\|\s*:?-+/.test(line))
    .map(line => line.split('|').slice(1, -1).map(c => c.trim()))
    .filter(cells => cells.length >= 3 && cells[0] !== '날짜')
}

function docsOf(dir) {
  const d = join(dir, 'docs')
  const names = existsSync(d) ? readdirSync(d) : []
  const has = name => names.includes(name)
  const count = re => names.filter(n => re.test(n)).length
  return { has, count, names }
}

function nextStep(entry, dir) {
  if (entry.status && entry.status !== 'making') return '—'
  const { has, count } = docsOf(dir)
  if (!has('BRIEF.md')) return '§1 접수 — 브리프가 없다'
  if (!has('CONTRACT.md')) return 'proto-design'
  if (!has('_packages.json')) return count(/^_critique-.+\.json$/) >= 3 ? "proto-design from: 'revise'" : "proto-design from: 'critique'"
  if (!existsSync(join(dir, 'package.json'))) return "proto-design from: 'scaffold'"
  let lastWave = 1
  try {
    const packages = JSON.parse(readFileSync(join(dir, 'docs', '_packages.json'), 'utf8'))
    lastWave = Math.max(1, ...packages.map(p => p.wave).filter(Number.isInteger))
  } catch { /* 형식 오류는 check-packages 가 잡는다 */ }
  for (let w = 1; w <= lastWave; w++) {
    if (!has(`NOTES-W${w}.md`)) return `proto-build wave ${w}${w === lastWave ? ' (last)' : ''}`
  }
  if (!has('NOTES-BALANCE.md')) return `proto-build wave ${lastWave} from: 'balance'`
  if (!has('NOTES-VISUAL.md')) return `proto-build wave ${lastWave} from: 'visual'`
  if (!has('NOTES-REVIEW.md')) return count(/^_review-.+\.json$/) >= 5 ? "proto-review from: 'fix'" : 'proto-review'
  return '§5 마감'
}

if (only) {
  const entry = list.find(p => p.slug === only)
  if (!entry) {
    console.log(`prototypes.json 에 slug '${only}' 가 없다. 있는 것: ${list.map(p => p.slug).join(', ') || '(없음)'}`)
    process.exit(1)
  }
  const dir = join(REPO, entry.dir || entry.slug)
  console.log(`${entry.slug} — ${entry.title || ''}`)
  for (const [k, v] of Object.entries(entry)) if (k !== 'slug' && k !== 'title') console.log(`  ${pad(k, 10)} ${v}`)
  if (!existsSync(dir)) {
    console.log(`\n폴더가 없다: ${dir}`)
    process.exit(1)
  }
  const { names } = docsOf(dir)
  const docs = names.filter(n => /^(BRIEF|CONTRACT|STATUS|NOTES-.+)\.md$|^_packages\.json$|^_(critique|review)-.+\.json$/.test(n)).sort()
  console.log(`\n문서: ${docs.join(' · ') || '(없음)'}`)
  const rel = existsSync(join(dir, 'release')) ? readdirSync(join(dir, 'release')) : []
  console.log(`산출물: dist ${existsSync(join(dir, 'dist', 'index.html')) ? '있음' : '없음'} · 부팅 검사 스크린샷(release/boot.png) ${rel.includes('boot.png') ? '있음' : '없음'} · 오프라인 파일 ${rel.filter(n => n.endsWith('.html')).join(', ') || '없음'}`)
  const rows = statusRows(dir)
  console.log(`\n진행 기록(${rows.length}줄):`)
  for (const r of rows) console.log(`  ${r.join(' | ')}`)
  console.log(`\n다음 단계: ${nextStep(entry, dir)}`)
  process.exit(0)
}

console.log(`${registry.title || '프로토타입'} — ${list.length}개`)
const head = ['slug', '상태', '공개', '포트', '마지막 기록', '다음 단계']
const rows = list.map(entry => {
  const dir = join(REPO, entry.dir || entry.slug)
  if (!existsSync(dir)) return [entry.slug, entry.status || '?', entry.public === true ? '공개' : '-', String(entry.port ?? '?'), `폴더 없음: ${entry.dir || entry.slug}`, '']
  const last = statusRows(dir).pop()
  return [entry.slug, entry.status || '?', entry.public === true ? '공개' : '-', String(entry.port ?? '?'), last ? cut(last.slice(0, 3).join(' · '), 60) : '(STATUS.md 없음)', nextStep(entry, dir)]
})
const widths = head.map((h, i) => Math.max(width(h), ...rows.map(r => width(r[i]))))
console.log(head.map((h, i) => pad(h, widths[i])).join('  '))
for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join('  '))
const making = list.filter(p => p.status === 'making').length
console.log(`\n제작 중 ${making} · 플레이 가능 ${list.filter(p => p.status === 'playable').length} · 공개 ${list.filter(p => p.public === true).length}`)
