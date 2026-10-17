/* ============================================================
   js/sensor-hub.js — センサー入力の窓口
   ------------------------------------------------------------
   アプリ本体は deviceorientation / devicemotion を直接購読せず、ここを
   通して受け取る。実機では window のイベントを中継し、PCでのリプレイ
   (js/feed-player.js)では録画したサンプルを同じ形で流し込む。
   → 本番と同じ描画経路のまま、入力(映像+センサー)だけを差し替えられる。
   ============================================================ */
const subs = { orientation: new Set(), motion: new Set() };
let attached = false;

function emit(kind, ev) { for (const fn of subs[kind]) { try { fn(ev); } catch (e) { console.error(e); } } }

export function onOrientation(fn) { subs.orientation.add(fn); return () => subs.orientation.delete(fn); }
export function onMotion(fn) { subs.motion.add(fn); return () => subs.motion.delete(fn); }
export function emitOrientation(ev) { emit('orientation', ev); }
export function emitMotion(ev) { emit('motion', ev); }

/** 実機のイベントを中継する(許可を得た後に1回だけ呼ぶ)。リプレイ中は呼ばない */
export function attachRealSensors() {
  if (attached) return;
  attached = true;
  window.addEventListener('deviceorientation', (e) => emitOrientation({
    alpha: e.alpha, beta: e.beta, gamma: e.gamma,
    webkitCompassHeading: e.webkitCompassHeading,
  }));
  window.addEventListener('devicemotion', (e) => {
    const rr = e.rotationRate || {};
    emitMotion({ rotationRate: { alpha: rr.alpha || 0, beta: rr.beta || 0, gamma: rr.gamma || 0 } });
  });
}

/** 画面の向き(度)。縦持ち=0 */
export function getScreenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return typeof window.orientation === 'number' ? window.orientation : 0;
}
