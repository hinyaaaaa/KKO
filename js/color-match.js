/* ============================================================
   js/color-match.js — 背景の色の統計に合わせた、キャラの色調補正
   ------------------------------------------------------------
   「撮った写真を一瞬、実写だと思う」ための最短手段。カメラ映像(背景)と
   キャラの描画結果の、明るさの幅(コントラスト)・黒の浮き・彩度・色かぶりを
   比べ、キャラ側を背景へ寄せる(Reinhardの色転写の簡易版)。
   - 空間: YCbCr(BT.601, sRGB表示値)。RGBに対してアフィンなので、
     3x3行列+オフセットだけでGPUに渡せる。
   - 補正は控えめ(strength既定0.5・各値にクランプ)。明るさ自体は既存の
     環境光推定(lighting.js)が担当し、ここは「残りのずれ」だけを直す。
   - キャラの統計は補正前の見た目から測るので、補正が自分を追いかけて
     発振することはない(measure用に補正なしで描いた小さな絵を使う)。
   この計算部分は純粋関数。three.js側の描画パスは js/color-match-pass.js。
   ============================================================ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** sRGB(0-1) → YCbCr(Y:0-1, Cb/Cr:約±0.5) */
export function rgbToYcc(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y, (b - y) * 0.564, (r - y) * 0.713];
}

/**
 * RGBA(0-255, 直列)から統計を出す。
 * @param {Uint8Array|Uint8ClampedArray} data
 * @param {{alphaMin?:number, premultiplied?:boolean}} opt  alphaが小さい画素は除く(キャラ用)
 * @returns {null | {n:number, yMean:number, yStd:number, yP5:number, cbMean:number, crMean:number, chroma:number}}
 */
export function computeStats(data, { alphaMin = 0, premultiplied = false } = {}) {
  const ys = [];
  let sy = 0, syy = 0, scb = 0, scr = 0, sch = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < alphaMin || a <= 0) continue;
    const k = premultiplied ? 1 / a : 1;
    const r = clamp(data[i] / 255 * k, 0, 1), g = clamp(data[i + 1] / 255 * k, 0, 1), b = clamp(data[i + 2] / 255 * k, 0, 1);
    const [y, cb, cr] = rgbToYcc(r, g, b);
    ys.push(y); sy += y; syy += y * y; scb += cb; scr += cr; sch += Math.hypot(cb, cr); n++;
  }
  if (n < 8) return null;
  const yMean = sy / n;
  ys.sort((p, q) => p - q);
  return {
    n, yMean, yStd: Math.sqrt(Math.max(0, syy / n - yMean * yMean)),
    yP5: ys[Math.floor(n * 0.05)], cbMean: scb / n, crMean: scr / n, chroma: sch / n,
  };
}

export const IDENTITY_GRADE = Object.freeze({
  // out = M * in + off(sRGB表示値)。その後 out = lift + (1-lift)*out
  m: [1, 0, 0, 0, 1, 0, 0, 0, 1], off: [0, 0, 0], lift: 0,
  params: { gainY: 1, dY: 0, sat: 1, dCb: 0, dCr: 0, lift: 0 },
});

/** 補正パラメータ(スカラー)を統計から求める */
export function computeGradeParams(bg, ch, strength = 0.5) {
  if (!bg || !ch) return { gainY: 1, dY: 0, sat: 1, dCb: 0, dCr: 0, lift: 0 };
  const s = strength;
  const gainY = clamp(Math.pow((bg.yStd + 0.02) / (ch.yStd + 0.02), s), 0.85, 1.2);
  const dY = clamp((bg.yMean - ch.yMean) * s * 0.35, -0.05, 0.05);
  const sat = clamp(Math.pow((bg.chroma + 0.01) / (ch.chroma + 0.01), s), 0.65, 1.25);
  const dCb = clamp((bg.cbMean - ch.cbMean) * s * 0.3, -0.03, 0.03);
  const dCr = clamp((bg.crMean - ch.crMean) * s * 0.3, -0.03, 0.03);
  const lift = clamp((bg.yP5 - ch.yP5) * s, 0, 0.06);
  return { gainY, dY, sat, dCb, dCr, lift };
}

// 3x3行列(行優先)
const mul = (a, b) => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const T = [0.299, 0.587, 0.114, -0.299 * 0.564, -0.587 * 0.564, (1 - 0.114) * 0.564, (1 - 0.299) * 0.713, -0.587 * 0.713, -0.114 * 0.713];
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
const T_INV = inv3(T);

/** パラメータ → 行列・オフセット(キャラ平均輝度 yMeanChar を中心に輝度を伸縮) */
export function buildGrade(p, yMeanChar = 0.5) {
  const S = [p.gainY, 0, 0, 0, p.sat, 0, 0, 0, p.sat];
  const M = mul(T_INV, mul(S, T));
  // 輝度の中心(yMeanChar)を動かさない: out = Tinv*(S*(T*v - c) + c + d) = M*v + Tinv*(c - S*c + d)
  const c = [yMeanChar, 0, 0], d = [p.dY, p.dCb, p.dCr];
  const sc = [S[0] * c[0], 0, 0];
  const t = [c[0] - sc[0] + d[0], d[1], d[2]];
  const off = [0, 1, 2].map((r) => T_INV[r * 3] * t[0] + T_INV[r * 3 + 1] * t[1] + T_INV[r * 3 + 2] * t[2]);
  return { m: M, off, lift: p.lift, params: p };
}

/** 画素へ適用(CPU版。テスト・静止画の後処理用。GPU版と同じ式) */
export function applyGrade(grade, r, g, b) {
  const { m, off, lift } = grade;
  const o = [0, 1, 2].map((i) => clamp(m[i * 3] * r + m[i * 3 + 1] * g + m[i * 3 + 2] * b + off[i], 0, 1));
  return o.map((v) => lift + (1 - lift) * v);
}

/** 指数移動平均でパラメータをなめらかに動かす(tauSec秒で約63%追従) */
export function smoothParams(prev, next, dtSec, tauSec = 0.8) {
  const a = 1 - Math.exp(-dtSec / tauSec);
  const out = {};
  for (const k of Object.keys(next)) out[k] = prev[k] + (next[k] - prev[k]) * a;
  return out;
}
