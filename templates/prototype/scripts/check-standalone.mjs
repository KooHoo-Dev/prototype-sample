// 선택 명령(게이트가 아니다 — 게이트는 check-dist.mjs) — build:standalone 으로 만든 파일을 건네기 전에 돌린다.
// release/<name>.html 을 헤드리스 Chrome/Edge 로 file:// 에서 열어 부팅 표식을 확인한다(내장 브라우저는 file:// 을 열지 못한다).
// 통과: <html data-game-ready="1"> 이 실제 시간 20초 안에 붙는다 · data-game-error 없음 · 잡히지 않은 예외 0.
// 스크린샷은 release/standalone.png — 직접 열어 본다.
// 실행: npm run check:standalone      브라우저 경로를 못 찾으면 환경 변수 CHROME_PATH 로 준다.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, probeBoot } from './boot-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
const page = join(root, 'release', `${name}.html`);
if (!existsSync(page)) {
  console.error(`${page} 이 없다 — 먼저 npm run build:standalone`);
  process.exit(1);
}
const browser = findBrowser();
if (!browser) {
  console.error('Chrome/Edge 를 찾지 못했다 — CHROME_PATH 환경 변수로 실행 파일 경로를 준다');
  process.exit(1);
}

const shot = join(root, 'release', 'standalone.png');
rmSync(shot, { force: true });
const probe = await probeBoot(browser, pathToFileURL(page).href, { shot });

const problems = [];
if (probe.launchError) problems.push(`브라우저를 띄우지 못했다: ${probe.launchError}`);
else if (probe.error !== null) problems.push(`부팅 실패 표식: ${probe.error}`);
else if (!probe.ready) problems.push(`부팅 표식이 없다 — <html data-game-ready="1"> 이 ${Math.round(probe.waitedMs / 1000)}초 안에 붙지 않았다(스크립트가 file:// 에서 실행되지 않았거나 부트가 던졌다)`);
if (probe.exceptions.length) problems.push(`잡히지 않은 예외 ${probe.exceptions.length}건: ${probe.exceptions.slice(0, 3).join(' | ')}`);

if (problems.length) {
  for (const p of problems) console.error(`- ${p}`);
  console.error(`STANDALONE ng — ${page}`);
  console.error(`스크린샷: ${existsSync(shot) ? shot : '(없음)'}`);
  process.exit(1);
}
console.log(`STANDALONE ok — ${page} · 표식까지 ${probe.waitedMs}ms`);
console.log(`스크린샷: ${existsSync(shot) ? shot : '(만들어지지 않았다)'}`);
