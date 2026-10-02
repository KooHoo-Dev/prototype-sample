#!/usr/bin/env node
// 공개 갤러리를 _site/ 에 만든다 — 프로토타입마다 빌드해 _site/<slug>/ 에 놓고, 목록 페이지(_site/index.html)를 쓴다.
//   node tools/build-site.mjs                 prototypes.json 에서 public: true 인 것만 (배포 워크플로가 이것을 돈다)
//   node tools/build-site.mjs --only <slug>   그 프로토타입 하나만 (미리보기용 — 공개 여부와 무관 · 다른 프로토타입의 폴더를 건드리지 않는다)
//   node tools/build-site.mjs --all           전부 (Jay 의 로컬 미리보기용 — 공개 여부와 무관 · 아직 package.json 이 없는 것은 건너뛴다)
//   node tools/build-site.mjs --only <slug> --serve 5290   만든 뒤 http://localhost:5290 으로 띄운다 (Ctrl+C 로 끈다)
//   옵션: --skip-build   이미 있는 dist/ 를 그대로 쓴다
// 하나라도 빌드에 실패하면 종료 코드 1 — 반쯤 만든 갤러리를 배포하지 않는다.
import { spawnSync } from 'node:child_process'
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(REPO, '_site')
const argv = process.argv.slice(2)
const ALL = argv.includes('--all')
const SKIP_BUILD = argv.includes('--skip-build')
const serveAt = argv.includes('--serve') ? Number(argv[argv.indexOf('--serve') + 1]) : 0
if (argv.includes('--serve') && !Number.isInteger(serveAt)) {
  console.error('--serve 뒤에 포트 번호가 필요하다')
  process.exit(1)
}

const registry = JSON.parse(readFileSync(join(REPO, 'prototypes.json'), 'utf8'))
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const onlyAt = argv.indexOf('--only')
const ONLY = onlyAt >= 0 ? argv[onlyAt + 1] : null
if (onlyAt >= 0 && !(registry.prototypes || []).some(p => p.slug === ONLY)) {
  console.error(`--only 뒤에 prototypes.json 의 slug 가 필요하다. 있는 것: ${(registry.prototypes || []).map(p => p.slug).join(', ') || '(없음)'}`)
  process.exit(1)
}
const chosen = (registry.prototypes || []).filter(p => (ONLY ? p.slug === ONLY : ALL || p.public === true))
const skipped = (registry.prototypes || []).filter(p => !chosen.includes(p))
const mode = ONLY ? ` · --only ${ONLY}` : ALL ? ' · --all' : ' · public: true 인 것만'

function sh(command, cwd) {
  console.log(`\n$ ${command}   (${cwd})`)
  const r = spawnSync(command, { cwd, stdio: 'inherit', shell: true })
  return r.status === 0
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const built = []
for (const p of chosen) {
  const dirName = p.dir || p.slug
  if (!SAFE.test(String(p.slug)) || !SAFE.test(String(dirName))) {
    console.error(`slug · dir 에 쓸 수 없는 문자가 있다: ${p.slug} / ${dirName}`)
    process.exit(1)
  }
  const dir = join(REPO, dirName)
  if (!existsSync(join(dir, 'package.json'))) {
    // --all 은 미리보기다 — 접수만 끝난(스캐폴드 전) 프로토타입 때문에 죽지 않는다. 배포(기본 모드)와 --only 에서는 오류다
    if (ALL && !ONLY) { console.log(`\n건너뛴다 — ${p.slug}: ${dirName}/package.json 이 아직 없다`); continue }
    console.error(`${p.slug}: ${dirName}/package.json 이 없다`)
    process.exit(1)
  }
  if (!SKIP_BUILD) {
    if (!existsSync(join(dir, 'node_modules'))) {
      const install = existsSync(join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install'
      if (!sh(install, dir)) { console.error(`${p.slug}: 의존성 설치 실패`); process.exit(1) }
    }
    if (!sh('npm run build', dir)) { console.error(`${p.slug}: 빌드 실패`); process.exit(1) }
  }
  if (!existsSync(join(dir, 'dist', 'index.html'))) {
    console.error(`${p.slug}: dist/index.html 이 없다`)
    process.exit(1)
  }
  cpSync(join(dir, 'dist'), join(OUT, p.slug), { recursive: true })
  built.push(p)
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const title = registry.title || '프로토타입'
const cards = built.map(p => `
      <a class="card" href="./${esc(p.slug)}/">
        <h2>${esc(p.title || p.slug)}</h2>
        <p>${esc(p.summary || '')}</p>
        <span class="meta">${esc(p.created || '')}${p.controls ? ' · ' + esc(p.controls) : ' · 키보드 · 마우스'}</span>
        <span class="go">플레이 →</span>
      </a>`).join('')

writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --bg: #0d0d10; --panel: #17171c; --line: #2a2a33; --text: #e9e4d8; --dim: #9b968a; --accent: #d9a441; }
  @media (prefers-color-scheme: light) { :root { --bg: #f4f1ea; --panel: #ffffff; --line: #ddd6c8; --text: #24221e; --dim: #6f6a5f; --accent: #9a6a12; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; word-break: keep-all; overflow-wrap: anywhere; }
  main { max-width: 960px; margin: 0 auto; padding: 56px 16px 72px; }
  h1 { font-size: 28px; letter-spacing: 0.04em; margin: 0 0 6px; }
  .lead { color: var(--dim); margin: 0 0 32px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .card { display: flex; flex-direction: column; gap: 8px; padding: 20px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; color: inherit; text-decoration: none; }
  .card:hover, .card:focus-visible { border-color: var(--accent); outline: none; }
  .card h2 { font-size: 18px; margin: 0; }
  .card p { margin: 0; color: var(--dim); flex: 1; }
  .meta { font-size: 13px; color: var(--dim); }
  .go { color: var(--accent); font-weight: 600; }
  .empty { color: var(--dim); padding: 32px 0; }
  footer { margin-top: 40px; font-size: 13px; color: var(--dim); }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="lead">${esc(registry.description || '')}</p>
  ${built.length ? `<div class="grid">${cards}
  </div>` : '<p class="empty">아직 공개된 프로토타입이 없다.</p>'}
  <footer>프로토타입이다 — 데스크톱 브라우저의 키보드 · 마우스로 한다. 진행은 이 브라우저에만 저장된다.</footer>
</main>
</body>
</html>
`)

console.log(`\n_site/ — 목록 1장 + 프로토타입 ${built.length}개${built.length ? ' (' + built.map(p => p.slug).join(', ') + ')' : ''}${mode}`)
if (skipped.length && !ONLY) console.log(`올리지 않는 것(public 이 true 가 아니다) ${skipped.length}개: ${skipped.map(p => p.slug).join(', ')}`)

if (serveAt) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' }
  createServer((req, res) => {
    let rel
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname) } catch { res.writeHead(400).end(); return }
    let file = resolve(join(OUT, rel))
    if (file !== OUT && !file.startsWith(OUT + sep)) { res.writeHead(403).end(); return }
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!rel.endsWith('/')) { res.writeHead(301, { Location: rel + '/' }).end(); return }
      file = join(file, 'index.html')
    }
    if (!existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('없다'); return }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  }).listen(serveAt, () => console.log(`http://localhost:${serveAt} (Ctrl+C 로 끈다)`))
}
