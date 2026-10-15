// tools/ui-shots.mjs — 画面を順に操作して、各画面のスクリーンショットを撮る(UIの確認・回帰用)
// 使い方: node tools/ui-shots.mjs [出力フォルダ] [--size 393x852]
// カメラはブラウザの疑似カメラ(--use-fake-device-for-media-stream)で代用する。
//   Chrome/Edge: 既定で付く。コンテナ等: KKO_BROWSER_ARGS="--no-sandbox --use-gl=angle --use-angle=swiftshader"
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from './static-server.mjs';
import { launchBrowser, routeThree } from './browser.mjs';

const out = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'out/ui');
const sizeArg = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : '393x852';
const [W, H] = sizeArg.split('x').map(Number);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const stageOnly = process.argv.includes('--stage-only');
fs.mkdirSync(out, { recursive: true });

process.env.KKO_BROWSER_ARGS = `${process.env.KKO_BROWSER_ARGS || ''} --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`;
const { port, close } = await startStaticServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, permissions: ['camera'] });
const page = await ctx.newPage();
await routeThree(page);
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 160)}`); });
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name); };
const base = `http://127.0.0.1:${port}/index.html`;

try {
  if (!stageOnly) {
  // 1. 推し選択(3人)
  await page.goto(`${base}?nodev`);
  await page.waitForSelector('.char-slide');
  await shot('01-select-kanata');
  await page.evaluate(() => document.getElementById('character-list').scrollTo({ left: document.getElementById('character-list').clientWidth, behavior: 'instant' }));
  await shot('02-select-kanade');
  await page.evaluate(() => document.getElementById('character-list').scrollTo({ left: 2 * document.getElementById('character-list').clientWidth, behavior: 'instant' }));
  await shot('03-select-okayu');
  await page.click('#credits-btn');
  await shot('04-credits');
  await page.click('#credits-close');

  // 2. モデル未導入 → 取り込みダイアログ(?nodev でローカルassetsを無効化している)
  await page.click('.char-pick-btn >> nth=2');
  await page.waitForSelector('.mi-overlay');
  await shot('05-import-dialog');
  await page.click('.mi-cancel');

  }

  if (only === 'select') throw new Error('stop');

  // 3. ローカルのassetsで進む(かなた): 許可の説明 → 読み込み → 立ち位置 → 撮影
  await page.goto(`${base}`);
  await page.waitForSelector('.char-slide');
  await page.click('.char-pick-btn >> nth=0');
  await shot('06-permissions');
  await page.click('#start-btn');
  await page.waitForTimeout(500);
  await shot('07-loading');
  await page.waitForFunction(() => document.getElementById('loading-overlay').classList.contains('hide'), null, { timeout: 120000 });
  await shot('08-placement');
  await page.click('#placement-confirm-btn');
  await page.waitForTimeout(1200);
  await shot('09-stage');
  // 撮影ステージは描画が重く、Playwrightのclick()が応答待ちで止まることがある。
  // ここから先は、ページ内で要素のclick()を直接呼ぶ。
  await page.evaluate(() => document.getElementById('dock-toggle').click());
  await shot('10-menu');
  await page.evaluate(() => {
    document.getElementById('dock-toggle').click();
    document.querySelectorAll('.pose-ring-row')[0].querySelectorAll('.chip')[2].click();
    document.querySelectorAll('.pose-ring-row')[1].querySelectorAll('.chip')[1].click();
  });
  await shot('11-stage-chips');

  // 撮影結果の見た目だけ確認する(実際の撮影は描画が重いので通さない。見本の画像を差し込む)
  const sample = process.argv.includes('--result-sample') ? process.argv[process.argv.indexOf('--result-sample') + 1] : null;
  if (sample && fs.existsSync(sample)) {
    const data = `data:image/png;base64,${fs.readFileSync(sample).toString('base64')}`;
    await page.evaluate((src) => {
      document.getElementById('ui-layer').style.display = 'none';
      document.getElementById('result-img').src = src;
      document.getElementById('result-screen').classList.add('show');
    }, data);
    await shot('12-result');
  }
} catch (e) {
  if (e.message !== 'stop') { console.error('FAILED:', e.message.split('\n').slice(0, 14).join('\n')); await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); process.exitCode = 1; }
}
if (errors.length) { fs.writeFileSync(path.join(out, 'errors.log'), errors.join('\n')); console.log(`errors: ${errors.length}件 → errors.log`); }
await browser.close();
await close();
