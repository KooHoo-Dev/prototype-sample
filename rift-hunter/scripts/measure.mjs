// OWNER: P15 — 계약 §12.5 (npm run measure → docs/MEASURE.md)
// 측정 작업(src/bot/measure.js 의 measureJobs · runJob)을 워커 스레드 여럿에 나눠 돌리고 measureTable 로 docs/MEASURE.md 를 쓴다.
// 1단계: 두 클래스 × (basic 세션 · challenge · 빌드 비교 · 정예 속성 탐침) + 드랍 표 → 2단계: basic 세션의 판 사본으로 noDodge · 해금 + 3 · 장비 비교.
// 시간은 틱으로 민다(실제 몇 분 ~ 수십 분). 옵션: --hours <n>(basic 세션 길이 · 기본 9) --seed <n> --workers <n> --quick(짧은 점검 — 리포트 형식만 본다) --out <파일>
// 이 스크립트는 Node 전용이다(브라우저 번들에 들어가지 않는다) — 시계(performance.now)는 성능 절과 진행 표시에만 쓴다.

import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { EventBus } from '../src/core/events.js';
import { NEUTRAL_INPUT } from '../src/core/inputFrame.js';
import { measureJobs, measureJobs2, measureTable, runJob } from '../src/bot/measure.js';
import { BOT_MEASURE } from '../src/data/bot.js';
import { GameSim } from '../src/sim/GameSim.js';
import { spawnMonster } from '../src/sim/monsters/monsters.js';
import { spawnProjectile } from '../src/sim/projectiles.js';
import { generateRift } from '../src/sim/world/mapgen.js';
import { randomWalkableNear } from '../src/sim/world/nav.js';
import { makeRng, seedRng } from '../src/core/rng.js';

const makeSim = (seed, account) => new GameSim({ bus: new EventBus(), seed, account, devSession: true });

if (!isMainThread) {
  parentPort.on('message', (job) => {
    const t0 = performance.now();
    try {
      const r = runJob(job, makeSim);
      parentPort.postMessage({ ok: true, r, ms: performance.now() - t0 });
    } catch (e) {
      parentPort.postMessage({ ok: false, error: String(e && e.stack || e), job: { kind: job.kind, cls: job.cls } });
    }
  });
} else {
  await main();
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

/** 작업 목록을 워커 n 개로(긴 것 먼저) → 결과(작업 순서) */
async function pool(jobs, n, label) {
  const order = jobs.map((j, i) => ({ j, i, w: weight(j) })).sort((a, b) => b.w - a.w);
  const out = new Array(jobs.length);
  let next = 0, done = 0;
  const t0 = performance.now();
  await new Promise((resolveAll, rejectAll) => {
    const workers = [];
    const feed = (w) => {
      if (next >= order.length) { w.terminate(); return; }
      const it = order[next++];
      w.cur = it;
      w.postMessage(it.j);
    };
    for (let k = 0; k < Math.min(n, order.length); k++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      workers.push(w);
      w.on('message', (msg) => {
        if (!msg.ok) { rejectAll(new Error(`${label}: ${JSON.stringify(msg.job)}\n${msg.error}`)); for (const x of workers) x.terminate(); return; }
        out[w.cur.i] = { ...msg.r, _ms: msg.ms };
        done++;
        const j = w.cur.j;
        process.stdout.write(`  [${label} ${done}/${jobs.length}] ${j.kind}${j.cls ? ' ' + j.cls : ''}${j.affixId !== undefined ? ' ' + j.affixId : ''}${j.build ? ' ' + j.build : ''}${j.which ? ' ' + j.which : ''}${j.strategy ? ' ' + j.strategy : ''} — ${(msg.ms / 1000).toFixed(1)}s (경과 ${((performance.now() - t0) / 1000).toFixed(0)}s)\n`);
        if (done === jobs.length) { for (const x of workers) x.terminate(); resolveAll(); }
        else feed(w);
      });
      w.on('error', (e) => { rejectAll(e); for (const x of workers) x.terminate(); });
      feed(w);
    }
  });
  return out;
}

/** 대략의 길이(긴 작업 먼저 나눠 준다) */
function weight(j) {
  if (j.kind === 'session') return 1000 + (j.hours ?? 1);
  if (j.kind === 'replay' || j.kind === 'challenge') return 100;
  if (j.kind === 'gear' || j.kind === 'build') return 50;
  return 1;
}

/** 성능(§12.4 S5 와 같은 장면) — 깨어 있는 몬스터 120 + 투사체 200 · 300틱 평균 · generateRift 20시드 최대 */
function perfProbe() {
  const sim = makeSim(7, null);
  sim.start();
  sim.newCharacter({ slot: 0, cls: 'warrior', name: 'perf' });
  sim.debugOpenRift(5, 7);
  sim.debugSetInvincible(true);
  const ctx = sim.ctx;
  const st = sim.state;
  const rng = makeRng(seedRng(11));
  const p = st.player.pos;
  const types = ['ghoul', 'fallen', 'skeletonArcher', 'shieldSkeleton'];
  for (const m of st.rift.mons) m.gone = true;
  sim.step(NEUTRAL_INPUT);
  let k = 0;
  const topMons = () => {
    let alive = 0;
    for (const m of st.rift.mons) if (!m.dead && !m.gone && m.awake) alive++;
    for (; alive < 120; alive++) {
      const q = randomWalkableNear(ctx.map, rng, p.x, p.z, 3, 14, 24) ?? { x: p.x, z: p.z };
      spawnMonster(ctx, { typeId: types[k++ % types.length], rank: 'normal', level: 5, x: q.x, z: q.z, awake: true });
    }
  };
  const topProjs = () => {
    let n = 0;
    for (const pr of st.rift.projs) if (pr.until > st.tick) n++;
    for (; n < 200; n++) {
      const a = rng.range(0, Math.PI * 2);
      spawnProjectile(ctx, { visual: 'arrow', owner: 'mon', srcId: -1, x: p.x + Math.sin(a) * 6, z: p.z + Math.cos(a) * 6, facing: a + Math.PI, speed: 4, range: 30, r: 0.2, spec: { srcId: -1, via: 'projectile', raw: 1, type: 'phys', level: 5 } });
    }
  };
  topMons(); topProjs();
  for (let i = 0; i < 30; i++) sim.step(NEUTRAL_INPUT);
  let total = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    topMons(); topProjs();
    const t0 = performance.now();
    sim.step(NEUTRAL_INPUT);
    total += performance.now() - t0;
  }
  generateRift(1, 1);
  let mapMax = 0;
  for (let s = 1; s <= 20; s++) {
    const t0 = performance.now();
    generateRift(s * 7919, 1 + (s % 10));
    mapMax = Math.max(mapMax, performance.now() - t0);
  }
  return { mons: 120, projs: 200, ticks: N, stepMs: total / N, mapMaxMs: mapMax };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const quick = !!arg('quick', false);
  const opts = {
    hours: Number(arg('hours', quick ? 0.3 : 9)),
    seed: Number(arg('seed', 1)),
    // 밸런스 게이트: 판 수는 data/bot.js BOT_MEASURE 에서(스크립트에 숫자를 두지 않는다)
    challengeRuns: quick ? 2 : BOT_MEASURE.challengeRuns, replayRuns: quick ? 2 : BOT_MEASURE.replayRuns, buildRuns: quick ? 1 : BOT_MEASURE.buildRuns, gearRuns: quick ? 1 : BOT_MEASURE.gearRuns, probeSeeds: quick ? 1 : BOT_MEASURE.probeSeeds,
  };
  const out = String(arg('out', join(root, 'docs', 'MEASURE.md')));
  const workers = Math.max(1, Number(arg('workers', Math.max(1, Math.min(4, (os.availableParallelism?.() ?? os.cpus().length))))));
  const t0 = performance.now();
  console.log(`MEASURE — 시드 ${opts.seed} · basic ${opts.hours}시간 · 워커 ${workers}${quick ? ' · quick' : ''}`);
  const r1 = await pool(measureJobs(opts), workers, '1단계');
  const sessions = r1.filter((r) => r.kind === 'session');
  const r2 = await pool(measureJobs2(sessions, opts), workers, '2단계');
  const perf = perfProbe();
  const ticks = sessions.reduce((s, x) => s + x.final.playSec * 30, 0);
  perf.sessionMsPerTick = ticks > 0 ? sessions.reduce((s, x) => s + x._ms, 0) / ticks : NaN;
  const wallSec = (performance.now() - t0) / 1000;
  const iso = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const md = measureTable({ results: [...r1, ...r2], generatedAt: iso, wallSec, perf, ...opts });
  writeFileSync(out, md);
  console.log(`MEASURE ok — ${out} · ${wallSec.toFixed(0)}초`);
}
