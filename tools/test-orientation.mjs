// 姿勢追従の数値テスト: node tools/test-orientation.mjs
import * as THREE from 'three';
import { OrientationTracker, orientationToQuaternion } from '../js/orientation-tracker.js';

let fail = 0;
const near = (name, got, want, tol = 0.6) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(2)} want ${want}`);
};
const settle = (tr, o, n = 240) => { for (let i = 0; i < n; i++) tr.feed(o, i * 16.7 + (tr._lastT || 0)); };

// 1. 縦持ち・水平(beta=90): 俯角0 ロール0
let tr = new OrientationTracker();
settle(tr, { alpha: 0, beta: 90, gamma: 0 });
near('縦持ち水平 pitch', tr.getPitchDeg(), 0);
near('縦持ち水平 roll', tr.getRollDeg(), 0);

// 2. 手前に40°倒す(beta=50): 俯角40°(上から見下ろす)
tr = new OrientationTracker();
settle(tr, { alpha: 0, beta: 50, gamma: 0 });
near('beta=50 pitch(下向き40°)', tr.getPitchDeg(), 40);

// 3. 上向き(beta=120): 俯角-30°
tr = new OrientationTracker();
settle(tr, { alpha: 0, beta: 120, gamma: 0 });
near('beta=120 pitch(上向き30°)', tr.getPitchDeg(), -30);

// 4. 真下(beta=2)でもyaw基準が壊れず、視線が下を向く
tr = new OrientationTracker();
settle(tr, { alpha: 30, beta: 2, gamma: 0 });
near('真下 pitch', tr.getPitchDeg(), 88);

// 5. yawリセット: alphaを60°回して resetYaw → 正面は-Zのまま。さらに回すとyawが変わる
tr = new OrientationTracker();
settle(tr, { alpha: 60, beta: 90, gamma: 0 });
tr.resetYaw();
const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(tr.getQuaternion());
near('リセット直後 正面x', fwd.x, 0, 0.02);
near('リセット直後 正面z', fwd.z, -1, 0.02);
settle(tr, { alpha: 90, beta: 90, gamma: 0 });   // 左へ30°
const f2 = new THREE.Vector3(0, 0, -1).applyQuaternion(tr.getQuaternion());
near('30°回した後のyaw(度)', Math.atan2(-f2.x, -f2.z) * 180 / Math.PI, 30, 1);

// 6. 傾きを変えてもyawは動かない(ワールド固定: 水平方向の向きが保たれる)
tr = new OrientationTracker();
settle(tr, { alpha: 0, beta: 90, gamma: 0 }); tr.resetYaw();
settle(tr, { alpha: 0, beta: 55, gamma: 0 });
const f3 = new THREE.Vector3(0, 0, -1).applyQuaternion(tr.getQuaternion());
near('俯角を変えても水平方位は不変', f3.x, 0, 0.02);

// 7. 平滑化: ノイズ(±0.3°)を与えても出力の揺れは入力より小さい
tr = new OrientationTracker();
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
settle(tr, { alpha: 0, beta: 70, gamma: 0 }, 120);
let lo = 1e9, hi = -1e9;
for (let i = 0; i < 300; i++) {
  tr.feed({ alpha: 0, beta: 70 + rnd() * 0.6, gamma: rnd() * 0.6 }, 5000 + i * 16.7);
  const p = tr.getPitchDeg(); lo = Math.min(lo, p); hi = Math.max(hi, p);
}
near('ノイズ0.6°p-p → 出力の揺れ(度)', hi - lo, 0.1, 0.3);

// 8. 素早く動かしたとき、遅れすぎない(30°を0.3秒以内に90%追従)
tr = new OrientationTracker();
settle(tr, { alpha: 0, beta: 90, gamma: 0 }, 120);
let t = 10000, reached = null;
for (let i = 0; i < 60; i++) {
  t += 16.7;
  tr.feed({ alpha: 0, beta: 60, gamma: 0 }, t);
  if (reached == null && tr.getPitchDeg() >= 27) reached = (i + 1) * 16.7;
}
near('急な30°変化の90%到達(ms, 400以内なら合格)', reached ?? 9999, 200, 200);

console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
