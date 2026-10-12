/* ============================================================
   js/model-store.js — 端末内(IndexedDB)のモデル保管庫
   ------------------------------------------------------------
   取り込んだモデル(PMX+テクスチャ)を、この端末のブラウザ内にだけ保存する。
   外部へは送信しない。リポジトリにも含まれない。
   構成:
     models: { id, pmx, importedAt, totalBytes, fileCount }   ← 取り込み済みの目録
     files : { id, path, data(ArrayBuffer) }                    ← 1ファイル1レコード
   ============================================================ */

const DB_NAME = 'kko-models';
const DB_VERSION = 1;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('このブラウザはIndexedDBに対応していません')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: ['id', 'path'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('IndexedDBを開けませんでした')); };
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('保存に失敗しました(容量不足の可能性があります)'));
    tx.onabort = () => reject(tx.error || new Error('保存が中断されました(容量不足の可能性があります)'));
  });
}
const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** 取り込み済みの目録を返す。無ければ null */
export async function getModelMeta(id) {
  const db = await openDb();
  return (await wrap(db.transaction('models').objectStore('models').get(id))) || null;
}

export async function listModels() {
  const db = await openDb();
  return wrap(db.transaction('models').objectStore('models').getAll());
}

/**
 * 1モデルを丸ごと保存する(同じidは置き換え)。
 * @param {string} id
 * @param {{pmx: string, files: {path: string, data: ArrayBuffer}[]}} model
 */
export async function saveModel(id, { pmx, files }) {
  await deleteModel(id);
  const db = await openDb();
  const tx = db.transaction(['models', 'files'], 'readwrite');
  const fs = tx.objectStore('files');
  let totalBytes = 0;
  for (const f of files) {
    fs.put({ id, path: f.path, data: f.data });
    totalBytes += f.data.byteLength;
  }
  tx.objectStore('models').put({ id, pmx, importedAt: Date.now(), totalBytes, fileCount: files.length });
  await done(tx);
}

/** 保存済みのファイルを全部読む */
export async function readModelFiles(id) {
  const db = await openDb();
  const range = IDBKeyRange.bound([id, ''], [id, '\uffff']);
  return wrap(db.transaction('files').objectStore('files').getAll(range));
}

export async function deleteModel(id) {
  const db = await openDb();
  const tx = db.transaction(['models', 'files'], 'readwrite');
  tx.objectStore('files').delete(IDBKeyRange.bound([id, ''], [id, '\uffff']));
  tx.objectStore('models').delete(id);
  await done(tx);
}

/**
 * ブラウザに「この保存領域を勝手に消さないで」と頼む。
 * iOS Safariは、しばらく使わないサイトの保存データを消すことがある。
 * ホーム画面に追加して使うと、この消去の対象から外れる。
 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* 失敗しても動作には影響しない */ }
  return false;
}
