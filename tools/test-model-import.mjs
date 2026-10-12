// tools/test-model-import.mjs — 「モデルを端末内に取り込んで読む」経路の通し検証
//   1. ?nodev でローカルassetsを無効化 → モデル未導入(MODEL_MISSING)になることを確認
//   2. zipを取り込み(IndexedDBへ保存)→ 読み込み → 撮影
//   3. 同じ状態でローカルassetsから読んだ画像と比較し、一致することを確認
// 使い方: node tools/test-model-import.mjs <キャラid> <モデルzip> <比較用に撮るdevPath版の出力先>
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from './static-server.mjs';
import { launchBrowser, routeThree } from './browser.mjs';

const [id = 'kanata', zipPath, outDir = 'out/import-test'] = process.argv.slice(2);
if (!zipPath) { console.error('usage: node tools/test-model-import.mjs <id> <model.zip> [outDir]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const state = {
  character: id, pose: 'standing', expression: 'smile', grid: false,
  cameraPhone: { heightM: 1.4, distanceM: 4.2, pitchDeg: 0, fov: 45 },
};
const { port, close } = await startStaticServer();
const browser = await launchBrowser();
let code = 0;
const shot = async (page, name) => {
  const r = await page.evaluate(async (s) => { await window.KkoDev.applyState(s); return window.KkoDev.capture({}); }, state);
  const f = path.join(outDir, name);
  fs.writeFileSync(f, Buffer.from(r.image.split(',')[1], 'base64'));
  return f;
};
const open = async (query) => {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await routeThree(page);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/dev.html?${query}`);
  await page.waitForFunction(() => window.KkoDev, null, { timeout: 90000 });
  return page;
};
try {
  // --- 1. 未導入の確認 ---
  const p1 = await open(`clean&nodev&char=${id}`);
  const missing = await p1.evaluate(() => window.KkoDev.ready(8000).then(() => 'loaded', (e) => String(e.message)));
  console.log('未導入の挙動:', missing);
  if (!/MODEL_MISSING|model not installed|timeout/.test(missing)) throw new Error('未導入なのに読み込めてしまった');
  const dialog = await p1.evaluate(() => !!document.querySelector('.mi-overlay'));
  console.log('取り込みダイアログ表示:', dialog);
  if (!dialog) throw new Error('取り込みダイアログが出ていない');

  // --- 2. 実際のファイル選択経路(<input type=file>)で取り込む ---
  const input = await p1.$('.mi-input');
  await input.setInputFiles(zipPath);
  await p1.waitForFunction(() => !document.querySelector('.mi-overlay'), null, { timeout: 120000 });
  console.log('取り込み完了(ダイアログが閉じた)');
  const models = await p1.evaluate(() => window.KkoDev.installedModels());
  console.log('保存済み:', JSON.stringify(models.map((m) => ({ id: m.id, pmx: m.pmx, files: m.fileCount, MB: +(m.totalBytes / 1048576).toFixed(1) }))));
  await p1.waitForFunction(() => window.KkoDev.isReady(), null, { timeout: 120000 });
  const imported = await shot(p1, `${id}.imported.png`);
  // --- 3. ページを再読み込みしても(取り込み直さずに)読めるか = 端末内に残っているか ---
  await p1.reload();
  await p1.waitForFunction(() => window.KkoDev, null, { timeout: 90000 });
  const again = await p1.evaluate(() => window.KkoDev.ready(120000).then(() => 'loaded', (e) => String(e.message)));
  console.log('再読み込み後(取り込み直しなし):', again);
  if (again !== 'loaded') throw new Error('再読み込み後にモデルが残っていない');
  const reloaded = await shot(p1, `${id}.reloaded.png`);
  await p1.context().close();

  // 比較用: ローカルassetsから読んだ画像
  const p3 = await open(`clean&char=${id}`);
  await p3.evaluate(() => window.KkoDev.ready());
  const local = await shot(p3, `${id}.local.png`);

  // 画像比較はブラウザのcanvasで行う(追加依存なし)。半透明の髪の端などで数十ピクセル
  // だけ揺れることがあるため、完全一致ではなく「差のあるピクセルの割合」で判定する。
  const diff = async (f1, f2) => p3.evaluate(async ([x, y]) => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const px = async (u) => { const i = await load(u); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const A = await px(x), B = await px(y);
    let n = 0;
    for (let k = 0; k < A.length; k += 4) if (Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]) > 24) n++;
    return { changed: n, total: A.length / 4 };
  }, [`data:image/png;base64,${fs.readFileSync(f1).toString('base64')}`, `data:image/png;base64,${fs.readFileSync(f2).toString('base64')}`]);
  const d1 = await diff(imported, local), d2 = await diff(imported, reloaded);
  const pct = (d) => ((100 * d.changed) / d.total).toFixed(4);
  console.log(`取り込み経由 vs ローカル読み込み: 差のあるピクセル ${d1.changed} (${pct(d1)}%)`);
  console.log(`取り込み直後 vs 再読み込み後:     差のあるピクセル ${d2.changed} (${pct(d2)}%)`);
  await p3.context().close();
  if (d1.changed / d1.total > 0.0005 || d2.changed / d2.total > 0.0005) { console.log('NG: 差が大きすぎる'); code = 3; }
  else console.log('OK: 見た目は同じ(許容: 0.05%未満)');
} catch (e) {
  console.error('FAILED:', e.message || e);
  code = 1;
} finally {
  await browser.close();
  await close();
}
process.exit(code);
