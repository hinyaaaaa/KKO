// 実機でしか起きにくい入力の異常を、PC上で再現して確かめる(ブラウザ不要)
// 実行: node tools/test-robustness.mjs
import * as THREE from 'three';
import { OrientationTracker } from '../js/orientation-tracker.js';
import { pickRenderTargetSpec } from '../js/gpu-caps.js';

let fail = 0;
const ok = (name, cond, info = '') => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const finiteUnit = (q) => [q.x, q.y, q.z, q.w].every(Number.isFinite) && Math.abs(q.length() - 1) < 1e-6;
const angleDeg = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180 / Math.PI;
const run = (tr, seq, dtMs = 16.7, t0 = 1000) => { let t = t0, prev = null, maxJump = 0; for (const o of seq) { t += dtMs; tr.feed(o, t); const q = tr.getQuaternion().clone(); if (prev) maxJump = Math.max(maxJump, angleDeg(prev, q)); prev = q; } return maxJump; };

// 1. 異常値を食わせても落ちず、姿勢が壊れない
{
  const tr = new OrientationTracker();
  tr.feed({ alpha: 0, beta: 80, gamma: 0 }, 1000);
  const junk = [null, undefined, NaN, Infinity, -Infinity, 'abc', 1e308, {}, [], 720, -720, 1e9];
  let threw = false;
  try { for (const a of junk) for (const b of junk) tr.feed({ alpha: a, beta: b, gamma: a }, 2000); tr.feed({ alpha: 10, beta: 80, gamma: 0 }, NaN); tr.feed(null, 1); } catch (e) { threw = String(e); }
  ok('異常値(null/NaN/Infinity/文字列)で例外が出ない', !threw, threw || '');
  ok('異常値のあとも姿勢が有限・単位長', finiteUnit(tr.getQuaternion()));
  tr.feed({ alpha: 5, beta: 70, gamma: 0 }, 3000);
  ok('その後、正常値でちゃんと動き続ける', Math.abs(tr.getPitchDeg() - 20) < 25 && Number.isFinite(tr.getPitchDeg()), `pitch=${tr.getPitchDeg().toFixed(1)}`);
}

// 2. alphaの360°折り返し(359→0)でyawが飛ばない
{
  const tr = new OrientationTracker(); tr.feed({ alpha: 350, beta: 90, gamma: 0 }, 1000);
  const seq = []; for (let a = 350; a <= 370; a += 0.5) seq.push({ alpha: a % 360, beta: 90, gamma: 0 });
  const jump = run(tr, seq);
  ok('alpha 350→10 を横切っても1ステップのずれは小さい', jump < 2, `最大 ${jump.toFixed(2)}°/ステップ`);
}

// 3. ジンバル付近(真下・真上・横倒し)で連続的に動く
for (const [name, mk] of [
  ['真下付近 beta 5→-5', (i) => ({ alpha: 40, beta: 5 - i * 0.2, gamma: 0 })],
  ['真上付近 beta 175→185', (i) => ({ alpha: 40, beta: 175 + i * 0.2, gamma: 0 })],
  ['gamma ±90付近', (i) => ({ alpha: 40, beta: 40, gamma: 85 + i * 0.2 })],
]) {
  const tr = new OrientationTracker(); tr.feed(mk(0), 1000);
  const seq = []; for (let i = 0; i < 50; i++) seq.push(mk(i));
  const jump = run(tr, seq, 16.7);
  ok(`${name}: 入力0.2°刻みで出力が飛ばない`, jump < 3 && finiteUnit(tr.getQuaternion()), `最大 ${jump.toFixed(2)}°`);
}

// 4. 画面の向き(横持ち)でも、水平に構えれば俯角0
for (const angle of [90, 270, 180]) {
  const tr = new OrientationTracker(); tr.screenAngle = angle;
  // 各向きで「水平に構えた」ときの(beta,gamma)。縦=90/0、横左=0/-90、横右=0/90、逆さ=-90/0
  const pose = { 90: { beta: 0, gamma: -90 }, 270: { beta: 0, gamma: 90 }, 180: { beta: -90, gamma: 0 } }[angle];
  for (let i = 0; i < 200; i++) tr.feed({ alpha: 30, ...pose }, 1000 + i * 16.7);
  ok(`画面角${angle}°で水平に構えたら俯角≒0`, Math.abs(tr.getPitchDeg()) < 3 && Math.abs(tr.getRollDeg()) < 3, `pitch=${tr.getPitchDeg().toFixed(1)} roll=${tr.getRollDeg().toFixed(1)}`);
}

// 5. 時刻の異常(同時刻・逆行・長い中断)で壊れない
{
  const tr = new OrientationTracker();
  for (const t of [1000, 1000, 1000, 900, 5000, 5001, 5001.1, 5000, 1e7]) tr.feed({ alpha: 0, beta: 70 + (t % 7), gamma: 0 }, t);
  ok('同時刻・逆行・長い中断でも姿勢が有限', finiteUnit(tr.getQuaternion()));
  const tr2 = new OrientationTracker(); tr2.feed({ alpha: 0, beta: 90, gamma: 0 }, 0); tr2.feed({ alpha: 0, beta: 50, gamma: 0 }, 60000);
  ok('60秒の空白のあとは遅れず新しい値へ(≥25°追従)', tr2.getPitchDeg() > 25, `pitch=${tr2.getPitchDeg().toFixed(1)}`);
}

// 6. 長時間の揺れ(手持ちの微振動)で、平均姿勢がずれない(バイアスが乗らない)
{
  const tr = new OrientationTracker(); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  let sum = 0, n = 0;
  for (let i = 0; i < 6000; i++) { tr.feed({ alpha: 0 + rnd() * 1.5, beta: 65 + rnd() * 1.5, gamma: rnd() * 1.5 }, 1000 + i * 16.7); if (i > 600) { sum += tr.getPitchDeg(); n++; } }
  ok('±0.75°の微振動100秒で平均俯角が真値(25°)から0.3°以内', Math.abs(sum / n - 25) < 0.3, `平均 ${(sum / n).toFixed(2)}°`);
}

// 7. GPU能力の判定(ハーフフロート非対応・MSAA上限の端末を模擬)
{
  const fake = (half, maxS) => ({
    getContext: () => ({ MAX_SAMPLES: 1, getParameter: () => maxS }),
    extensions: { has: (n) => half && /color_buffer/.test(n) },
    capabilities: { isWebGL2: true },
  });
  const a = pickRenderTargetSpec(fake(true, 8), 4), b = pickRenderTargetSpec(fake(false, 2), 4), c = pickRenderTargetSpec(fake(false, 0), 4);
  ok('対応端末: HalfFloat+4xMSAA', a.type === THREE.HalfFloatType && a.samples === 4);
  ok('非対応端末: 8bitに落とす・MSAAは上限に合わせる', b.type === THREE.UnsignedByteType && b.samples === 2);
  ok('MSAA不可の端末: samples=0', c.samples === 0);
}

console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
