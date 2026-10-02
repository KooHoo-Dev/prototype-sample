// dist/ 를 배포되는 모양 그대로(하위 경로 · http) 내주고 헤드리스 Chrome/Edge 로 열어 부팅 표식을 확인한다 — 제작 게이트.
// 통과: <html data-game-ready="1"> 이 실제 시간 20초 안에 붙는다 · data-game-error 없음 · 잡히지 않은 예외 0
//       · 하위 경로 밖으로 새는 요청 0 · 404 0(파일 이름의 대소문자까지 같아야 한다) · JS 청크 1개(단일 번들).
// 스크린샷은 release/boot.png — 직접 열어 본다(빈 화면 · 오류 문구가 아닌지).
// 실행: npm run build 뒤 npm run check:dist      브라우저 경로를 못 찾으면 환경 변수 CHROME_PATH 로 준다.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, probeBoot } from './boot-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${join(dist, 'index.html')} 이 없다 — 먼저 npm run build`);
  process.exit(1);
}
const browser = findBrowser();
if (!browser) {
  console.error('Chrome/Edge 를 찾지 못했다 — CHROME_PATH 환경 변수로 실행 파일 경로를 준다');
  process.exit(1);
}

const problems = [];

// 단일 번들(CLAUDE.md 기술 기본값) — 청크가 갈리면 선택 명령 build:standalone 이 HTML 한 장으로 합치지 못한다
let chunks = [];
try { chunks = readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js')); } catch { /* assets 가 없으면 청크도 없다 */ }
if (chunks.length > 1) problems.push(`JS 청크가 ${chunks.length}개다 — 동적 import() 를 없애 번들을 하나로 만든다: ${chunks.join(', ')}`);

// 갤러리와 같은 꼴: /<사이트>/<slug>/ 아래로만 내준다. 그 밖(루트 · /assets/…)은 404 — 절대 경로로 새는 요청을 잡는다
const PREFIX = `/gallery/${name}/`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const seen = [];
// Windows · macOS 는 대소문자를 가리지 않지만 GitHub Pages 는 가린다 — 이름이 글자 그대로 같은 것만 내준다
const exactCase = rel => {
  let cur = dist;
  for (const seg of rel.split(sep).filter(Boolean)) {
    if (!readdirSync(cur).includes(seg)) return false;
    cur = join(cur, seg);
  }
  return true;
};
const server = createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const miss = () => { seen.push({ path, status: 404 }); res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404'); };
  if (!path.startsWith(PREFIX)) { miss(); return; }
  let file = resolve(join(dist, path.slice(PREFIX.length)));
  if (file !== dist && !file.startsWith(dist + sep)) { miss(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !exactCase(file.slice(dist.length + 1))) { miss(); return; }
  seen.push({ path, status: 200 });
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}${PREFIX}`;

mkdirSync(join(root, 'release'), { recursive: true });
const shot = join(root, 'release', 'boot.png');
rmSync(shot, { force: true });

const probe = await probeBoot(browser, url, { shot });
server.close();
server.closeAllConnections();

const leaks = seen.filter(r => !r.path.startsWith(PREFIX) && r.path !== '/favicon.ico');
const missing = seen.filter(r => r.path.startsWith(PREFIX) && r.status !== 200);
if (probe.launchError) problems.push(`브라우저를 띄우지 못했다: ${probe.launchError}`);
else {
  if (!seen.some(r => r.path === PREFIX && r.status === 200)) problems.push('브라우저가 페이지를 요청하지 않았다');
  if (probe.error !== null) problems.push(`부팅 실패 표식: ${probe.error}`);
  else if (!probe.ready) problems.push(`부팅 표식이 없다 — <html data-game-ready="1"> 이 ${Math.round(probe.waitedMs / 1000)}초 안에 붙지 않았다(번들이 실행되지 않았거나, 부트가 던졌거나, 사용자 입력을 기다린 뒤에야 붙인다)`);
}
if (leaks.length) problems.push(`하위 경로 밖으로 새는 요청 ${leaks.length}건(절대 경로 참조) — 하위 경로에 놓으면 깨진다: ${leaks.map(r => r.path).join(', ')}`);
if (missing.length) problems.push(`404 ${missing.length}건(없는 파일이거나 이름의 대소문자가 다르다): ${missing.map(r => r.path).join(', ')}`);
if (probe.exceptions.length) problems.push(`잡히지 않은 예외 ${probe.exceptions.length}건: ${probe.exceptions.slice(0, 3).join(' | ')}`);

const requests = `요청 ${seen.length}건(200 ${seen.filter(r => r.status === 200).length})`;
if (problems.length) {
  for (const p of problems) console.error(`- ${p}`);
  console.error(`DIST ng — ${PREFIX} · ${requests}`);
  console.error(`스크린샷: ${existsSync(shot) ? shot : '(없음)'}`);
  process.exit(1);
}
console.log(`DIST ok — ${PREFIX} · ${requests} · JS 청크 ${chunks.length}개 · 표식까지 ${probe.waitedMs}ms`);
console.log(`스크린샷: ${existsSync(shot) ? shot : '(만들어지지 않았다)'}`);
