// 떠 있는 서버(dev · preview)의 한 화면을 헤드리스 Chrome/Edge 로 찍는다 — 내장 브라우저가 없을 때(클라우드 세션)의 화면 확인.
// 부팅 표식을 기다린 뒤 디버그 API 로 멈추고(pause) 틱을 밀어(step) 정지 화면을 찍고, 그 API 의 errors() 와 잡히지 않은 예외를 낸다.
// 실행: npm run probe:screen -- <url> [--step 30] [--eval "<식>"] [--out docs/_scratch/screen.png] [--api __game]
//   url 은 개발용 쿼리까지 붙인 주소(예: http://127.0.0.1:5301/?fresh=1) · --eval 은 step 전에 평가할 식(api 는 디버그 API 객체)
// 출력 마지막 줄: `SCREEN ok|ng — …` · 종료 코드 0/1. 스크린샷은 직접 열어 본다. 브라우저 경로를 못 찾으면 환경 변수 CHROME_PATH.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findBrowser, probeBoot } from './boot-probe.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    step: { type: 'string', default: '30' },
    eval: { type: 'string' },
    out: { type: 'string', default: 'docs/_scratch/screen.png' },
    api: { type: 'string', default: '__game' },
  },
});
const url = positionals[0];
if (!url) {
  console.error('주소가 필요하다 — npm run probe:screen -- http://127.0.0.1:<port>/?fresh=1');
  process.exit(1);
}
const browser = findBrowser();
if (!browser) {
  console.error('Chrome/Edge 를 찾지 못했다 — CHROME_PATH 환경 변수로 실행 파일 경로를 준다');
  process.exit(1);
}
const steps = Math.max(0, Math.floor(Number(opts.step) || 0));
const shot = resolve(opts.out);
mkdirSync(dirname(shot), { recursive: true });

// 페이지에서 도는 식 — 디버그 API 가 없으면 그 사실을 값으로 돌려준다
const afterReady = `(async () => {
  const api = window[${JSON.stringify(opts.api)}];
  if (!api) return { missingApi: true };
  await api.pause(true);
  const evaluated = ${opts.eval ? `await (async () => (${opts.eval}))()` : 'undefined'};
  await api.step(${steps});
  return { evaluated, errors: api.errors() };
})()`;
const r = await probeBoot(browser, url, { shot, afterReady, settleMs: 300 });

const value = /** @type {{ missingApi?: boolean, evaluated?: unknown, errors?: unknown[] } | undefined} */ (r.value);
const problems = [];
if (r.launchError) problems.push(`브라우저를 띄우지 못했다: ${r.launchError}`);
else if (!r.ready) problems.push(r.error ? `부팅 실패(data-game-error): ${r.error}` : `부팅 표식이 ${Math.round(r.waitedMs / 1000)}초 안에 붙지 않았다`);
if (value?.missingApi) problems.push(`window.${opts.api} 가 없다 — --api 로 디버그 API 이름을 준다`);
if (value?.errors?.length) problems.push(`${opts.api}.errors(): ${JSON.stringify(value.errors).slice(0, 500)}`);
for (const e of r.exceptions) problems.push(`예외: ${e}`);
if (value && 'evaluated' in value && value.evaluated !== undefined) console.log(`eval: ${JSON.stringify(value.evaluated).slice(0, 1000)}`);
for (const p of problems) console.log(`- ${p}`);
console.log(`SCREEN ${problems.length ? 'ng' : 'ok'} — ${url} · step ${steps} · 스크린샷 ${r.launchError ? '(없음)' : shot}`);
process.exit(problems.length ? 1 : 0);
