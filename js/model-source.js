/* ============================================================
   js/model-source.js — MMDLoaderに「どこからモデルを読むか」を決めて渡す
   ------------------------------------------------------------
   優先順位:
     1. 端末内(IndexedDB)に取り込み済みのモデル   ← 本番の標準
     2. def.devPath(開発用。リポジトリ外のローカルassets。?nodev で無効化できる)
     3. どちらも無ければ MODEL_MISSING エラー(UI側が取り込みを案内する)
   取り込み済みモデルは、仮想のURL(https://kko.local/...)でMMDLoaderに渡し、
   three.jsのLoadingManager.setURLModifier で、画像などの要求をblob URLへ差し替える。
   ============================================================ */
import { getModelMeta, readModelFiles } from './model-store.js';
import { MIME_BY_EXT } from './model-import.js';

export class ModelMissingError extends Error {
  constructor(def) {
    super(`model not installed: ${def.id}`);
    this.name = 'ModelMissingError';
    this.code = 'MODEL_MISSING';
    this.def = def;
  }
}

const VIRTUAL_ORIGIN = 'https://kko.local/model/';
let releasePrev = null; // 直前に読んだモデルのblob URLを解放する関数

/** URL要求のパスを、保存時と同じ形(小文字・/区切り・./と..を解決)にそろえる */
function normalizeRel(rel) {
  let s = rel;
  try { s = decodeURIComponent(rel); } catch { /* そのまま使う */ }
  s = s.replace(/\\/g, '/').replace(/^\.\//, '');
  const out = [];
  for (const part of s.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return out.join('/').toLowerCase();
}

async function devPathExists(def) {
  if (!def.devPath) return false;
  if (new URLSearchParams(location.search).has('nodev')) return false;
  try { return (await fetch(def.devPath, { method: 'HEAD' })).ok; } catch { return false; }
}

/**
 * @returns {Promise<{loader: object, url: string}>}
 */
export async function prepareMMDSource(def, MMDLoader, THREE) {
  if (releasePrev) { releasePrev(); releasePrev = null; }

  const meta = await getModelMeta(def.id).catch(() => null);
  if (meta) {
    const records = await readModelFiles(def.id);
    const byPath = new Map();   // 小文字の相対パス → blob URL
    const byBase = new Map();   // ファイル名だけ → blob URL(フォルダ構成が違う場合の保険)
    const urls = [];
    for (const r of records) {
      const e = r.path.split('.').pop();
      const u = URL.createObjectURL(new Blob([r.data], { type: MIME_BY_EXT[e] || 'application/octet-stream' }));
      urls.push(u);
      byPath.set(r.path, u);
      const b = r.path.slice(r.path.lastIndexOf('/') + 1);
      if (!byBase.has(b)) byBase.set(b, u);
    }
    const base = `${VIRTUAL_ORIGIN}${encodeURIComponent(def.id)}/`;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (!url.startsWith(base)) return url;
      const rel = normalizeRel(url.slice(base.length));
      return byPath.get(rel) || byBase.get(rel.slice(rel.lastIndexOf('/') + 1)) || url;
    });
    releasePrev = () => urls.forEach((u) => URL.revokeObjectURL(u));
    return { loader: new MMDLoader(manager), url: base + meta.pmx };
  }

  if (await devPathExists(def)) return { loader: new MMDLoader(), url: def.devPath };
  throw new ModelMissingError(def);
}

export async function hasInstalledModel(id) {
  try { return !!(await getModelMeta(id)); } catch { return false; }
}
