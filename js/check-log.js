/* ============================================================
   js/check-log.js — 実機チェック用の計測メモ(アプリ本体の動作には影響しない)
   各所から mark(キー, 値) で記録し、?check のオーバーレイ(device-check.js)が表示する。
   ============================================================ */
const store = new Map();
export function mark(key, value) { store.set(key, { value, at: Date.now() }); }
export function get(key) { const e = store.get(key); return e ? e.value : undefined; }
export function all() { return Object.fromEntries([...store].map(([k, v]) => [k, v.value])); }
