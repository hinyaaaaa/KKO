/* ============================================================
   js/model-import.js — ユーザーが選んだファイルをモデルとして取り込む
   ------------------------------------------------------------
   入力: zip 1つ、または PMX+テクスチャ画像を複数選択したもの。
   処理: PMXを見つける → PMXのあるフォルダを基準に相対パスへ揃える →
         画像だけ残す → 端末内(IndexedDB)へ保存。
   ============================================================ */
import { readZip } from './zip-reader.js';
import { saveModel, requestPersistence } from './model-store.js';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tga', 'gif', 'webp', 'spa', 'sph']);
export const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp',
  gif: 'image/gif', webp: 'image/webp', tga: 'application/octet-stream',
  spa: 'image/bmp', sph: 'image/bmp', pmx: 'application/octet-stream',
};

export class ModelImportError extends Error {
  constructor(message) { super(message); this.name = 'ModelImportError'; }
}

const ext = (p) => (p.split('.').pop() || '').toLowerCase();
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);

/** FileList/配列 → [{name, read()}] */
async function toEntries(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) throw new ModelImportError('ファイルが選ばれていません');
  const zips = files.filter((f) => ext(f.name) === 'zip');
  if (zips.length > 0) {
    if (files.length > 1) throw new ModelImportError('zipは1つだけ選んでください');
    return readZip(await zips[0].arrayBuffer());
  }
  return files.map((f) => ({ name: norm(f.webkitRelativePath || f.name), size: f.size, read: () => f.arrayBuffer() }));
}

/**
 * @param {{id: string, model?: {pmx?: string}}} def
 * @param {FileList|File[]} fileList
 * @param {(msg: string) => void} [onProgress]
 */
export async function importModel(def, fileList, onProgress = () => {}) {
  onProgress('ファイルを確認しています…');
  const entries = (await toEntries(fileList)).map((e) => ({ ...e, name: norm(e.name) }))
    .filter((e) => !e.name.startsWith('__MACOSX/') && !baseOf(e.name).startsWith('._'));

  // PMXを探す
  const pmxList = entries.filter((e) => ext(e.name) === 'pmx');
  if (pmxList.length === 0) throw new ModelImportError('PMXファイルが見つかりませんでした。PMX形式のモデルを選んでください。');
  const want = (def.model && def.model.pmx ? def.model.pmx : '').toLowerCase();
  let pmx = want ? pmxList.find((e) => baseOf(e.name).toLowerCase() === want) : null;
  if (!pmx) {
    if (pmxList.length === 1) pmx = pmxList[0];
    else throw new ModelImportError(`PMXが複数あり、どれか判断できません: ${pmxList.map((e) => baseOf(e.name)).join(', ')}`);
  }

  // PMXの先頭4バイトが 'PMX ' であることを確認
  const pmxData = await pmx.read();
  const magic = new TextDecoder('ascii').decode(new Uint8Array(pmxData, 0, 4));
  if (magic !== 'PMX ') throw new ModelImportError('PMX形式ではないファイルです(PMD等には対応していません)');

  // PMXのあるフォルダを基準にそろえる
  const prefix = dirOf(pmx.name);
  const targets = entries.filter((e) => IMAGE_EXT.has(ext(e.name)));
  const files = [{ path: baseOf(pmx.name).toLowerCase(), data: pmxData }];
  let i = 0;
  for (const e of targets) {
    i++;
    onProgress(`展開中… ${i}/${targets.length}`);
    const rel = e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name;
    files.push({ path: rel.toLowerCase(), data: await e.read() });
  }

  onProgress('この端末に保存しています…');
  await saveModel(def.id, { pmx: baseOf(pmx.name).toLowerCase(), files });
  requestPersistence();
  return { pmx: baseOf(pmx.name), fileCount: files.length, totalBytes: files.reduce((s, f) => s + f.data.byteLength, 0) };
}
