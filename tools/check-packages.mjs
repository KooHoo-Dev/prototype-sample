#!/usr/bin/env node
// <dir>/docs/_packages.json 을 검사하고, 웨이브마다 proto-build 워크플로에 넘길 args 를 찍는다.
//   node tools/check-packages.mjs <slug>
// 검사: 배열인가 · id 중복 · 필수 필드 · 한 파일이 두 패키지에 · (스캐폴드 뒤) 파일이 실제로 있는가
//       · 웨이브 0 은 패키지 하나 · 웨이브가 빈 번호 없이 이어지는가 · 웨이브당 패키지 8개 이하.
// 종료 코드 = 오류 수. 경고(focus 가 없다 · 짧다)는 오류로 세지 않는다.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_PER_WAVE = 8
const slug = process.argv[2]
if (!slug) {
  console.log('사용: node tools/check-packages.mjs <slug>')
  process.exit(1)
}

const registry = JSON.parse(readFileSync(join(REPO, 'prototypes.json'), 'utf8'))
const entry = (registry.prototypes || []).find(p => p.slug === slug)
if (!entry) {
  console.log(`prototypes.json 에 slug '${slug}' 가 없다`)
  process.exit(1)
}
const dir = join(REPO, entry.dir || entry.slug)
const file = join(dir, 'docs', '_packages.json')
if (!existsSync(file)) {
  console.log(`${file} 이 없다 — 설계(proto-design)의 개정 단계가 쓴다`)
  process.exit(1)
}

const errors = []
const warnings = []
let packages
try {
  packages = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
} catch (e) {
  console.log(`_packages.json 을 읽지 못했다: ${e.message}`)
  process.exit(1)
}
if (!Array.isArray(packages)) {
  console.log('_packages.json 은 배열이어야 한다')
  process.exit(1)
}

const scaffolded = existsSync(join(dir, 'package.json'))
const ids = new Set()
const owner = new Map()
for (const p of packages) {
  const id = p && p.id
  if (typeof id !== 'string' || !id) { errors.push('id 가 없는 패키지가 있다'); continue }
  if (ids.has(id)) errors.push(`${id}: id 가 겹친다`)
  ids.add(id)
  if (typeof p.name !== 'string' || !p.name) errors.push(`${id}: name 이 없다`)
  if (!Number.isInteger(p.wave) || p.wave < 0) errors.push(`${id}: wave 는 0 이상의 정수다`)
  if (!Array.isArray(p.files) || p.files.length === 0) errors.push(`${id}: files 가 비었다`)
  if (!Array.isArray(p.contractSections) || p.contractSections.length === 0) warnings.push(`${id}: contractSections 가 비었다`)
  if (typeof p.brief !== 'string' || !p.brief.trim()) warnings.push(`${id}: brief(완료 정의)가 없다`)
  if (p.wave > 0) {
    if (typeof p.focus !== 'string' || !p.focus.trim()) warnings.push(`${id}: focus 가 없다 — 무엇이면 실패인지 적는다(docs/PIPELINE.md §2-3)`)
    else if (p.focus.trim().length < 80) warnings.push(`${id}: focus 가 짧다(${p.focus.trim().length}자)`)
    if (typeof p.visual !== 'boolean') warnings.push(`${id}: visual 이 없다 — false 로 본다`)
  }
  for (const f of p.files || []) {
    const key = String(f).replace(/\\/g, '/')
    if (owner.has(key)) errors.push(`${key}: ${owner.get(key)} 와 ${id} 가 둘 다 소유한다`)
    else owner.set(key, id)
    if (scaffolded && !existsSync(join(dir, key))) errors.push(`${id}: ${key} 가 없다`)
  }
}

const waves = [...new Set(packages.map(p => p.wave).filter(Number.isInteger))].sort((a, b) => a - b)
const lastWave = waves.length ? waves[waves.length - 1] : 0
for (let w = 0; w <= lastWave; w++) {
  const n = packages.filter(p => p.wave === w).length
  if (n === 0) errors.push(`웨이브 ${w} 가 비었다(번호가 이어져야 한다)`)
  if (w === 0 && n > 1) errors.push(`웨이브 0 은 패키지 하나(P0)다 — ${n}개`)
  if (w > 0 && n > MAX_PER_WAVE) errors.push(`웨이브 ${w}: 패키지 ${n}개 — ${MAX_PER_WAVE}개까지다`)
}
if (lastWave < 1) errors.push('웨이브 1 이 없다')

console.log(`${slug} — 패키지 ${packages.length}개 · 웨이브 0~${lastWave} · 파일 ${owner.size}개${scaffolded ? '' : ' (스캐폴드 전 — 파일 존재는 검사하지 않았다)'}`)
for (let w = 0; w <= lastWave; w++) {
  for (const p of packages.filter(x => x.wave === w)) {
    console.log(`  W${w}  ${String(p.id).padEnd(4)} ${String(p.name).padEnd(22)} ${p.visual === true ? '화면' : '    '}  파일 ${(p.files || []).length}`)
  }
}
for (const e of errors) console.log(`오류: ${e}`)
for (const w of warnings) console.log(`경고: ${w}`)

if (!errors.length) {
  const root = dir.replace(/\\/g, '/')
  console.log('\nproto-build 에 넘길 args (웨이브마다 한 번):')
  for (let w = 1; w <= lastWave; w++) {
    const args = {
      slug,
      root,
      port: entry.port,
      wave: w,
      packages: packages.filter(p => p.wave === w).map(p => ({ id: p.id, name: p.name, visual: p.visual === true })),
      last: w === lastWave,
    }
    console.log(JSON.stringify(args))
  }
}
console.log(errors.length ? `PACKAGES ng=${errors.length} (경고 ${warnings.length})` : `PACKAGES ok (경고 ${warnings.length})`)
process.exit(Math.min(errors.length, 250))
