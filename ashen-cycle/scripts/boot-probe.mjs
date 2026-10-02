// 헤드리스 Chrome/Edge 로 URL 을 열어 부팅 표식을 **실제 시간으로** 기다린다 — check-dist.mjs · check-standalone.mjs 가 같이 쓴다.
// 가상 시간(--virtual-time-budget)을 쓰지 않는다: requestAnimationFrame 이 1~3번만 돌고 실제 시간이 드는 await 를 기다리지 않아
// 멀쩡한 부트를 떨어뜨린다(2026-10-02 실측). 대신 디버깅 포트(CDP)로 붙어 표식을 폴링하고, 잡히지 않은 예외와 스크린샷을 받는다.
// 의존성 0 — Node 22 의 내장 fetch · WebSocket 만 쓴다.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = ms => new Promise(done => setTimeout(done, ms));

/** @returns {string | undefined} 설치된 Chrome/Edge 의 실행 파일 경로(환경 변수 CHROME_PATH 가 먼저) */
export function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find(p => existsSync(p));
}

/**
 * @param {string} browser 실행 파일 경로
 * @param {string} url 열 주소(http:// 또는 file://)
 * @param {{ shot?: string, timeoutMs?: number, settleMs?: number }} [opts] shot: 스크린샷 경로 · timeoutMs: 표식을 기다리는 실제 시간 · settleMs: 표식 뒤 더 지켜보는 시간
 * @returns {Promise<{ ready: boolean, error: string | null, exceptions: string[], waitedMs: number, launchError: string | null }>}
 *   ready: <html data-game-ready="1"> 을 봤다 · error: data-game-error 의 사유 · exceptions: 잡히지 않은 예외와 처리되지 않은 Promise 거부
 */
export async function probeBoot(browser, url, { shot, timeoutMs = 20000, settleMs = 1000 } = {}) {
  const result = { ready: false, error: null, exceptions: [], waitedMs: 0, launchError: null };
  const profile = mkdtempSync(join(tmpdir(), 'proto-boot-'));
  let spawnError = null;
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: 'ignore' });
  const exited = new Promise(done => {
    child.on('error', e => { spawnError = e; done(); });
    child.on('close', done);
  });
  let ws = null;
  try {
    // 브라우저가 고른 포트는 프로필 폴더의 DevToolsActivePort 첫 줄에 적힌다
    const portFile = join(profile, 'DevToolsActivePort');
    let port = 0;
    for (const began = Date.now(); !port;) {
      if (spawnError) throw spawnError;
      if (Date.now() - began > 20000) throw new Error('브라우저가 디버깅 포트를 열지 않았다');
      if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || 0;
      if (!port) await sleep(50);
    }
    let target = null;
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch { /* 아직 뜨는 중 */ }
      if (!target) await sleep(50);
    }
    if (!target) throw new Error('브라우저의 페이지를 찾지 못했다');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = () => fail(new Error('디버깅 소켓에 붙지 못했다'));
    });
    let seq = 0;
    const pending = new Map();
    ws.onclose = () => { for (const done of pending.values()) done({}); pending.clear(); };
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        const what = String((d.exception && d.exception.description) || d.text || '예외').split('\n')[0];
        result.exceptions.push(`${what}${d.url ? ` (${d.url.split('/').pop()}:${(d.lineNumber ?? 0) + 1})` : ''}`);
      }
    };
    // 응답이 오지 않아도(브라우저가 멈춤) 10초 뒤에는 빈 응답으로 풀린다
    const send = (method, params = {}) => new Promise(done => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); done({}); }, 10000);
      pending.set(id, msg => { clearTimeout(timer); done(msg); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const READ = 'JSON.stringify([document.documentElement.dataset.gameReady ?? null, document.documentElement.dataset.gameError ?? null])';
    const read = async () => {
      const r = await send('Runtime.evaluate', { expression: READ, returnByValue: true });
      const value = r.result && r.result.result && r.result.result.value;
      return typeof value === 'string' ? JSON.parse(value) : [null, null];
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    const began = Date.now();
    while (Date.now() - began < timeoutMs) {
      const [ready, error] = await read();
      if (error !== null) { result.error = error; break; }
      if (ready === '1') { result.ready = true; break; }
      await sleep(100);
    }
    result.waitedMs = Date.now() - began;
    // 표식 직후의 프레임에서 나는 예외와, 막이 걷힌 뒤의 화면을 잡는다
    await sleep(settleMs);
    if (result.error === null) result.error = (await read())[1];
    if (shot) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      if (s.result && s.result.data) writeFileSync(shot, Buffer.from(s.result.data, 'base64'));
    }
  } catch (e) {
    result.launchError = String((e && e.message) || e);
  } finally {
    try { if (ws) ws.close(); } catch { /* 이미 닫혔다 */ }
    child.kill();
    // 끝나기를 5초까지만 기다린다(타이머가 남아 스크립트 종료를 늦추지 않게 치운다)
    let giveUp;
    await Promise.race([exited, new Promise(done => { giveUp = setTimeout(done, 5000); })]);
    clearTimeout(giveUp);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* 프로필 정리 실패는 무시한다 */ }
  }
  return result;
}
