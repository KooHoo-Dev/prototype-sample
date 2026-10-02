// dist/ 의 빌드를 더블클릭으로 열리는 HTML 한 장으로 합친다 (file:// 에서는 외부 모듈 스크립트가 막히므로 인라인한다).
// 실행: npm run build:standalone  →  release/AshenCycle.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
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

if (scripts !== 1 || styles !== 1) {
  throw new Error(`예상과 다른 빌드 모양: script ${scripts}개 · stylesheet ${styles}개 (각 1개여야 한다)`);
}
if (/\ssrc="\.\/assets\/|\shref="\.\/assets\//.test(html)) {
  throw new Error('인라인되지 않은 ./assets/ 참조가 남아 있다');
}

const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'AshenCycle.html');
writeFileSync(out, html);
console.log(`${out}  (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB)`);
