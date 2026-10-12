// tools/capture.mjs — ヘッドレス撮影(Phase 0)
//
// 使い方:
//   npm install
//   node tools/capture.mjs jobs/sample.json out/
//
// ジョブJSONに書いた「状態(state)」ごとにdev.htmlを操作し、合成画像(PNG)と、
// 再現用のstate JSONを out/ に保存する。同じジョブからは同じ画像が出る。
//
// ブラウザ: PCに入っているChrome(なければEdge)をそのまま使う(追加ダウンロード不要)。
//   別のブラウザを使う場合: set KKO_BROWSER=C:\path\to\chrome.exe
//
// three.js: importmapのCDN(three@0.160.0)へのリクエストを、node_modules内の
//   同一バージョンに差し替える。オフラインで動き、バージョンも固定される。
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from './static-server.mjs';
import { launchBrowser, routeThree } from './browser.mjs';

const [jobPath, outArg] = process.argv.slice(2);
if (!jobPath) {
  console.error('usage: node tools/capture.mjs <job.json> [outDir]');
  process.exit(2);
}
const outDir = path.resolve(outArg || 'out');
fs.mkdirSync(outDir, { recursive: true });

const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));
const viewport = job.viewport || { width: 1080, height: 1920 };
const captureOpts = job.capture || {};

function toDataUrl(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
  if (!mime) throw new Error(`unsupported background image: ${file}`);
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

const { port, close } = await startStaticServer();
const browser = await launchBrowser();
let exitCode = 0;
const logs = [];
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await routeThree(page);

  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  const first = job.shots[0]?.state?.character;
  const q = new URLSearchParams({ clean: '1' });
  if (first) q.set('char', first);
  await page.goto(`http://127.0.0.1:${port}/dev.html?${q}`);
  await page.waitForFunction(() => window.KkoDev && typeof window.KkoDev.ready === 'function', null, { timeout: 90000 });
  await page.evaluate(() => window.KkoDev.ready());

  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return 'WebGLなし';
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGLあり';
  });
  console.log(`renderer: ${gl}`);

  for (const shot of job.shots) {
    const name = shot.name;
    const state = { ...(shot.state || {}) };
    if (shot.background) state.background = toDataUrl(path.resolve(shot.background));
    const o = { ...captureOpts, ...(shot.capture || {}) };

    const result = await page.evaluate(async ({ state, o }) => {
      await window.KkoDev.applyState(state);
      return window.KkoDev.capture(o);
    }, { state, o });

    const save = (dataUrl, file) =>
      fs.writeFileSync(path.join(outDir, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    save(result.image, `${name}.png`);
    if (result.layerBackground) save(result.layerBackground, `${name}.bg.png`);
    if (result.layerCharacter) save(result.layerCharacter, `${name}.char.png`);
    // 再現用: 実行時のstateと、元のジョブ指定を保存
    const meta = { name, width: result.width, height: result.height, state: result.state, requested: shot };
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(meta, null, 2));
    console.log(`saved ${name}.png (${result.width}x${result.height})`);
  }

  if (logs.length) {
    fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'));
    console.log(`console: ${logs.length}件 → console.log`);
  }
} catch (e) {
  console.error(e);
  if (logs.length) console.error('--- page console ---\n' + logs.slice(0, 20).join('\n'));
  exitCode = 1;
} finally {
  await browser.close();
  await close();
}
process.exit(exitCode);
