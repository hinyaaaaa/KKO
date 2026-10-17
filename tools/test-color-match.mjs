// 色統計マッチングの数値テスト: node tools/test-color-match.mjs
import { computeStats, computeGradeParams, buildGrade, applyGrade, rgbToYcc, smoothParams, IDENTITY_GRADE } from '../js/color-match.js';
let fail = 0;
const ok = (name, cond, info = '') => { if (!cond) fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${info}`); };
const img = (fn, n = 400) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const [r, g, b, a = 255] = fn(i / n); d.set([r, g, b, a], i * 4); } return d; };

// 統計
const flatGrey = img(() => [128, 128, 128]);
const st = computeStats(flatGrey);
ok('灰色の平均輝度≒0.5', Math.abs(st.yMean - 0.502) < 0.01, st.yMean.toFixed(3));
ok('灰色の彩度≒0', st.chroma < 0.001);
ok('小さい不透明領域しかない画像はnull', computeStats(img(() => [0, 0, 0, 0])) === null);

// 同じ見た目 → 恒等(補正なし)
const soft = img((t) => [60 + 120 * t, 60 + 120 * t, 60 + 120 * t]);
const s1 = computeStats(soft);
const p0 = computeGradeParams(s1, s1);
ok('同じ統計なら補正なし', Math.abs(p0.gainY - 1) < 1e-6 && Math.abs(p0.sat - 1) < 1e-6 && p0.lift === 0 && p0.dY === 0);
const g0 = buildGrade(p0, s1.yMean);
const px = applyGrade(g0, 0.3, 0.5, 0.7);
ok('恒等行列で色が変わらない', px.every((v, i) => Math.abs(v - [0.3, 0.5, 0.7][i]) < 1e-6), px.map((v) => v.toFixed(3)).join(','));
ok('IDENTITY_GRADEは恒等', IDENTITY_GRADE.m[0] === 1 && IDENTITY_GRADE.m[4] === 1 && IDENTITY_GRADE.m[8] === 1);

// 背景が低コントラスト・黒が浮いている(曇り・室内)/キャラは高コントラスト・黒が締まる
const bgFlat = img((t) => [100 + 60 * t, 100 + 60 * t, 100 + 60 * t]);          // 輝度100-160
const chContrasty = img((t) => [10 + 235 * t, 10 + 235 * t, 10 + 235 * t]);      // 輝度10-245
const bgS = computeStats(bgFlat), chS = computeStats(chContrasty);
const p = computeGradeParams(bgS, chS, 0.5);
ok('低コントラスト背景 → 輝度ゲイン<1(締まりを弱める)', p.gainY < 1, p.gainY.toFixed(3));
ok('黒が浮いた背景 → 黒を持ち上げる(lift>0)', p.lift > 0, p.lift.toFixed(3));
ok('ゲインは0.85未満にならない', p.gainY >= 0.85);
const g = buildGrade(p, chS.yMean);
const dark = applyGrade(g, 0.04, 0.04, 0.04)[0], mid = applyGrade(g, chS.yMean, chS.yMean, chS.yMean)[0];
ok('キャラの最暗部が持ち上がる', dark > 0.04 + 0.02, dark.toFixed(3));
ok('平均輝度付近は大きく動かない', Math.abs(mid - chS.yMean) < 0.07, `${mid.toFixed(3)} vs ${chS.yMean.toFixed(3)}`);

// 彩度: 背景がくすんでいる → 彩度を下げる / 鮮やか → 上げる(上限あり)
const dull = img((t) => [120, 125 + 10 * t, 120]);
const vivid = img((t) => [220, 60 + 40 * t, 60]);
const grey2 = img(() => [128, 128, 128]);
ok('くすんだ背景 + 鮮やかなキャラ → sat<1', computeGradeParams(computeStats(dull), computeStats(vivid)).sat < 1);
ok('鮮やかな背景 + 地味なキャラ → sat>1かつ≤1.25', (() => { const q = computeGradeParams(computeStats(vivid), computeStats(grey2)).sat; return q > 1 && q <= 1.25; })());

// 色かぶり: 背景が暖色 → Crがプラス方向へ
const warm = img(() => [200, 150, 110]);
const neutral = img(() => [150, 150, 150]);
const pw = computeGradeParams(computeStats(warm), computeStats(neutral));
const outWarm = applyGrade(buildGrade(pw, 0.59), 0.6, 0.6, 0.6);
ok('暖色背景 → 灰色が少し暖色寄りになる(R>B)', outWarm[0] > outWarm[2], outWarm.map((v) => v.toFixed(3)).join(','));
ok('色かぶりは控えめ(差0.06以内)', outWarm[0] - outWarm[2] < 0.06, (outWarm[0] - outWarm[2]).toFixed(3));

// 透過: 半透明(premultiplied)の縁が結果を汚さない
const withEdge = new Uint8ClampedArray(400 * 4);
for (let i = 0; i < 400; i++) withEdge.set(i < 40 ? [10, 10, 10, 30] : [200, 100, 100, 255], i * 4);   // 縁は alpha=30
const sE = computeStats(withEdge, { alphaMin: 0.5 });
ok('alphaMin未満の画素は統計から外れる', sE.n === 360, `n=${sE.n}`);

// 平滑化
let cur = { gainY: 1, dY: 0, sat: 1, dCb: 0, dCr: 0, lift: 0 };
for (let i = 0; i < 30; i++) cur = smoothParams(cur, { gainY: 0.9, dY: 0, sat: 1.2, dCb: 0, dCr: 0, lift: 0.04 }, 1 / 30, 0.8);   // 1秒
ok('1秒で目標の約7割まで追従(急変しない)', cur.sat > 1.1 && cur.sat < 1.18, cur.sat.toFixed(3));

// YCbCr往復
const [y, cb, cr] = rgbToYcc(1, 0, 0);
ok('赤: Cr>0', cr > 0.3 && cb < 0, `Y=${y.toFixed(2)} Cb=${cb.toFixed(2)} Cr=${cr.toFixed(2)}`);
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
