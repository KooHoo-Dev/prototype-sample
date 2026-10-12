// 선택 명령(게이트가 아니다) — 오프라인으로 건넬 파일이 필요할 때만 쓴다. 평소의 전달은 갤러리 URL 이다.
// dist/ 의 빌드를 더블클릭으로 열리는 HTML 한 장으로 합친다 — file:// 에서는 외부 모듈 스크립트가 막히므로 인라인한다.
// 실행: npm run build:standalone  →  release/<package.json 의 name>.html      확인: npm run check:standalone
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
let html = readFileSync(join(dist, 'index.html'), 'utf8');

let scripts = 0;
let styles = 0;
html = html.replace(/<script type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const js = readFileSync(join(dist, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  scripts++;
  return `<script type="module">\n${js}\n</script>`;
});
html = html.replace(/<link rel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g, (_, href) => {
  const css = readFileSync(join(dist, href), 'utf8').replace(/<\/style/gi, '<\\/style');
  styles++;
  return `<style>\n${css}\n</style>`;
});
html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');

if (scripts !== 1) throw new Error(`진입 스크립트가 ${scripts}개다(1개여야 한다)`);
if (styles > 1) throw new Error(`스타일시트가 ${styles}개다(0~1개여야 한다)`);
if (/\s(?:src|href)="\.\/assets\//.test(html)) throw new Error('인라인되지 않은 ./assets/ 참조가 남아 있다');

// 번들이 여러 청크로 갈리면 인라인한 스크립트가 file:// 에서 나머지를 불러오지 못한다
let chunks = [];
try { chunks = readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js')); } catch { /* assets 가 없으면 청크도 없다 */ }
if (chunks.length > 1) throw new Error(`JS 청크가 ${chunks.length}개다 — 동적 import() 를 없애 번들을 하나로 만든다: ${chunks.join(', ')}`);

const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${name}.html`);
writeFileSync(out, html);
console.log(`${out}  (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB)`);
