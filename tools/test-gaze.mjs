// 視線の計算テスト: node tools/test-gaze.mjs
import { relativeYawToCamera, GazeController, wrap180 } from '../js/gaze.js';
let fail = 0;
const ok = (n, c, i = '') => { if (!c) fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${i}`); };
const near = (a, b, t = 0.01) => Math.abs(a - b) <= t;

ok('正面(カメラが真正面)で相対0°', near(relativeYawToCamera(0, -3.2, 0, 0, 0), 0));
ok('キャラが右(+X)にいるとカメラは左: 相対が負', relativeYawToCamera(2, -3, 0) < 0, relativeYawToCamera(2, -3, 0).toFixed(1));
ok('キャラが左にいるとカメラは右: 相対が正', relativeYawToCamera(-2, -3, 0) > 0);
ok('キャラが45°回っていれば、その分ずれる', near(relativeYawToCamera(0, -3, Math.PI / 4), -45, 0.01));
ok('180°折り返しで飛ばない', near(wrap180(190), -170) && near(wrap180(-190), 170));

const g = new GazeController();
for (let i = 0; i < 300; i++) g.update(1 / 60, 3);
ok('deadband内(3°)では顔を動かさない', Math.abs(g.value) < 0.01);
for (let i = 0; i < 300; i++) g.update(1 / 60, 40);
ok('40°ずれでも可動域(22°)を超えない', g.value <= 22 + 1e-6 && g.value > 10, g.value.toFixed(1));
const g2 = new GazeController(); for (let i = 0; i < 300; i++) g2.update(1 / 60, -90);
ok('負側も対称に頭打ち', near(g2.value, -22, 0.2), g2.value.toFixed(1));
const g3 = new GazeController(); let first = 0; for (let i = 0; i < 6; i++) first = g3.update(1 / 60, 30);
ok('急にカメラが動いても首が飛ばない(0.1秒で目標の3割未満)', first < 0.3 * 14.4, first.toFixed(2));
const g4 = new GazeController({ sign: -1 }); for (let i = 0; i < 300; i++) g4.update(1 / 60, 30);
ok('sign=-1で向きが反転する', g4.value < 0);
const g5 = new GazeController(); g5.update(1, NaN);
ok('NaNを入れても値が壊れない', Number.isFinite(g5.value), String(g5.value));
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格'); process.exit(fail ? 1 : 0);
