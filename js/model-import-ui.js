/* ============================================================
   js/model-import-ui.js — 「モデルを端末に取り込む」ダイアログ
   ------------------------------------------------------------
   モデルが端末内に無いキャラを選んだときに出す。ファイルは端末の外へ送信されない。
   使い方: showModelImport(def, { onDone, onCancel })
   ============================================================ */
import { importModel } from './model-import.js';
import { deleteModel, getModelMeta } from './model-store.js';

let cssAdded = false;
function ensureCss() {
  if (cssAdded) return;
  cssAdded = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../model-import.css', import.meta.url).href;
  document.head.appendChild(l);
}

export function showModelImport(def, { onDone, onCancel } = {}) {
  ensureCss();
  const root = document.createElement('div');
  root.className = 'mi-overlay';
  root.innerHTML = `
    <div class="mi-card" role="dialog" aria-modal="true">
      <h2 class="mi-title">${def.name}の<br>モデルを取り込む</h2>
      <p class="mi-text">モデルのファイルはこのアプリに入っていません。PMX形式のモデルを、zipのまま(またはPMXとテクスチャ画像をまとめて)選んでください。</p>
      <p class="mi-note">選んだファイルは<strong>この端末の中にだけ</strong>保存され、外部へは送られません。モデルの利用規約に従って使ってください。</p>
      <p class="mi-status" aria-live="polite"></p>
      <input type="file" class="mi-input" multiple accept=".zip,.pmx,.png,.jpg,.jpeg,.bmp,.tga,.gif,.webp,.spa,.sph,application/zip">
      <button type="button" class="mi-pick">モデルを選ぶ</button>
      <button type="button" class="mi-cancel">あとにする</button>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const status = $('.mi-status');
  const input = $('.mi-input');
  const close = () => root.remove();

  $('.mi-pick').addEventListener('click', () => input.click());
  $('.mi-cancel').addEventListener('click', () => { close(); onCancel && onCancel(); });
  input.addEventListener('change', async () => {
    if (!input.files || input.files.length === 0) return;
    $('.mi-pick').disabled = true;
    status.classList.remove('error');
    try {
      const r = await importModel(def, input.files, (m) => { status.textContent = m; });
      status.textContent = `取り込みました(${r.fileCount}ファイル)`;
      close();
      onDone && onDone(r);
    } catch (err) {
      console.error('model import failed', err);
      status.classList.add('error');
      status.textContent = (err && err.message) || '取り込みに失敗しました';
      $('.mi-pick').disabled = false;
      input.value = '';
    }
  });
  return { close };
}

/** 取り込み済みモデルを端末から削除する(再取り込みの前などに) */
export async function removeInstalledModel(def) {
  if (await getModelMeta(def.id)) await deleteModel(def.id);
}
