// tools/browser.mjs — capture.mjs / test-*.mjs 共通: ブラウザ起動とthree.jsのローカル差し替え
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright-core';
import { REPO_ROOT } from './static-server.mjs';

// three のローカルコピーを探す(three@0.160のexportsはpackage.jsonを公開しないので、パスで直接探す)
const threeRoot = path.join(REPO_ROOT, 'node_modules', 'three');
if (!fs.existsSync(path.join(threeRoot, 'build', 'three.module.js'))) {
  console.error('three が見つかりません。先に `npm install` を実行してください。');
  process.exit(2);
}

const MIME_BY_EXT = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

/** KKO_ENGINE=webkit でWebKit(iPhoneのSafariと同系統)で動かす。CDP前提の確認(CPU低速・タッチ注入)はChromiumのみ。 */
export const ENGINE = process.env.KKO_ENGINE === 'webkit' ? 'webkit' : 'chromium';

export async function launchBrowser() {
  if (ENGINE === 'webkit') return webkit.launch({ headless: true });
  const args = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=default'];
  // 追加引数(Linux/コンテナ等): set KKO_BROWSER_ARGS="--no-sandbox --use-angle=swiftshader"
  if (process.env.KKO_BROWSER_ARGS) args.push(...process.env.KKO_BROWSER_ARGS.split(/\s+/).filter(Boolean));
  if (process.env.KKO_BROWSER) {
    return chromium.launch({ executablePath: process.env.KKO_BROWSER, headless: true, args });
  }
  const errors = [];
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launch({ channel, headless: true, args }); }
    catch (e) { errors.push(`${channel}: ${String(e.message).split('\n')[0]}`); }
  }
  // CIなど: Playwrightが入れたChromium(npx playwright-core install chromium)
  try { return await chromium.launch({ headless: true, args }); } catch (e) { errors.push(`chromium: ${String(e.message).split('\n')[0]}`); }
  throw new Error(`Chrome/Edgeを起動できませんでした。\n${errors.join('\n')}\nKKO_BROWSER でexeパスを指定できます。`);
}


/** CDNのthree.js(importmap)を node_modules/three に差し替える */
export async function routeThree(page) {
  await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.replace('/npm/three@0.160.0/', '');
    const file = path.join(threeRoot, rel);
    if (!file.startsWith(threeRoot) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      status: 200,
      body: fs.readFileSync(file),
      headers: {
        'content-type': MIME_BY_EXT[path.extname(file)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
      },
    });
  });
}
