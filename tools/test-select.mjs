// 選択画面のプレビュー: 動作(読み込み→表示→切替→破棄)と、スマホでのレイアウトを確かめる
// 実行: node tools/test-select.mjs   (画像は out/select/*.png)
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, routeThree } from './browser.mjs';
import { startStaticServer, REPO_ROOT } from './static-server.mjs';

const outDir = path.join(REPO_ROOT, 'out', 'select'); fs.mkdirSync(outDir, { recursive: true });
const srv = await startStaticServer(); const browser = await launchBrowser();
let fail = 0;
const check = (n, ok, i = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${i}`); };
const base = `http://127.0.0.1:${srv.port}`;
const isExpected = (t) => /model not installed|MMD load|Failed to load resource/.test(t);

try {
  // 1) 実ページ: モデル未取り込み → 案内表示、スワイプで推しが変わる、レイアウトが重ならない
  for (const vp of [{ width: 393, height: 852, name: 'iphone17' }, { width: 375, height: 667, name: 'small' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !isExpected(m.text())) errs.push(m.text()); });
    await routeThree(page);
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => ['empty', 'ready', 'error'].includes(document.getElementById('select-preview').dataset.state), null, { timeout: 10000 });
    const st = await page.evaluate(() => document.getElementById('select-preview').dataset.state);
    check(`[${vp.name}] 未取り込み: 案内(empty)になる`, st === 'empty', `state=${st}`);
    const lay = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; };
      const slide = document.querySelector('.char-slide.in-view');
      const kids = [...slide.children].map((c) => c.getBoundingClientRect());
      return { preview: r('#select-preview'), head: r('.sel-head'), btn: r('.char-slide.in-view .char-pick-btn'), contentTop: Math.min(...kids.map((k) => k.top)), vh: innerHeight };
    });
    check(`[${vp.name}] プレビューがヘッダーの下にある`, lay.preview.top >= lay.head.bottom - 1, `head下端${lay.head.bottom.toFixed(0)} / preview上端${lay.preview.top.toFixed(0)}`);
    check(`[${vp.name}] プレビューの高さが画面の2割以上ある`, lay.preview.h >= lay.vh * 0.2, `${lay.preview.h.toFixed(0)}px / 画面${lay.vh}px`);
    check(`[${vp.name}] 文字・ボタンがプレビューと重ならない`, lay.contentTop >= lay.preview.bottom - 2, `preview下端${lay.preview.bottom.toFixed(0)} / 文字の上端${lay.contentTop.toFixed(0)}`);
    check(`[${vp.name}] 決定ボタンが画面内`, lay.btn.bottom <= lay.vh, `下端${lay.btn.bottom.toFixed(0)} / 画面${lay.vh}`);
    await page.screenshot({ path: path.join(outDir, `${vp.name}-empty.png`) });
    check(`[${vp.name}] JSエラーなし`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // 2) 部品単体: 代役キャラで 読み込み→表示→(読み込み中の切替で古い結果を捨てる)→破棄
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await routeThree(page);
  await page.goto(`${base}/index.html`);   // importmap(three)が使えるページ
  const r = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createSelectPreview } = await import('/js/select-preview.js');
    document.body.innerHTML = '<div id="h" style="position:relative;width:393px;height:400px;background:#222"></div>';
    const host = document.getElementById('h');
    const disposed = []; let updates = 0;
    const mk = (color, h) => (def, { scene }, cb) => {
      setTimeout(() => {
        const g = new THREE.Group();
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, h, 20), new THREE.MeshToonMaterial({ color })); m.position.y = h / 2; g.add(m);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16), new THREE.MeshToonMaterial({ color: 0xf2d0b8 })); head.position.y = h + 0.1; g.add(head);
        scene.add(g); cb.onLoad({ root: g, id: def.id, update: () => { updates++; g.rotation.y = Math.sin(performance.now() / 600) * 0.1; } });
      }, def.delay || 0);
    };
    const defs = { a: { id: 'a', delay: 300 }, b: { id: 'b', delay: 0 } };
    let which = 'a';
    const p = createSelectPreview({ host, MMDLoader: null, loadCharacter: (d, deps, cb) => mk(d.id === 'a' ? 0xd04070 : 0x4070d0, d.id === 'a' ? 1.5 : 1.3)(d, deps, cb),
      disposeCharacter: (c) => { disposed.push(c.id); }, isModelAvailable: async () => true, debounceMs: 20 });
    const out = {};
    p.show(defs.a); await new Promise((r) => setTimeout(r, 60));
    out.loadingState = p._debug().state;
    p.show(defs.b);                                   // aの読み込み(300ms)中にbへ切替
    await new Promise((r) => setTimeout(r, 700));
    out.afterSwitch = p._debug();
    out.disposedStale = disposed.includes('a');       // 古いaの結果は捨てられた
    out.updatesRunning = updates > 5;                 // 待機モーションのupdateが回っている
    out.hostShot = host.getBoundingClientRect().height;
    out.cvs = host.querySelector('canvas') ? [host.querySelector('canvas').width, host.querySelector('canvas').height] : null;
    p.destroy();
    out.afterDestroy = p._debug(); out.canvasGone = !host.querySelector('canvas');
    return out;
  });
  check('読み込み中は loading 表示', r.loadingState === 'loading', r.loadingState);
  check('読み込み中に切り替えると、最後に選んだ推し(b)だけが残る', r.afterSwitch.state === 'ready' && r.afterSwitch.id === 'b', JSON.stringify(r.afterSwitch));
  check('古い読み込み結果(a)は破棄される(メモリを残さない)', r.disposedStale === true);
  check('待機モーション(update)が回っている', r.updatesRunning === true);
  check('キャンバスがホスト全体の大きさ(DPR反映)', r.cvs && r.cvs[0] >= 700, JSON.stringify(r.cvs));
  check('破棄でGPUコンテキスト・キャンバスが消える', r.afterDestroy.hasContext === false && r.canvasGone === true, JSON.stringify(r.afterDestroy));
  check('部品テストでJSエラーなし', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
} finally { await browser.close(); await srv.close(); }
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格'); process.exit(fail ? 1 : 0);
