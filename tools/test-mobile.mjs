// スマホ相当の条件(縦長・DPR3・タッチ・CPU低速・GPU機能の欠け)で、本番ページの挙動を確かめる
// 実行: node tools/test-mobile.mjs   (先に test-feed.mjs で out/feeds/test を作る)
import { launchBrowser, routeThree, ENGINE } from './browser.mjs';
const CDP_OK = ENGINE === 'chromium';   // CPU低速化・タッチ注入はChromiumのCDP専用
import { startStaticServer } from './static-server.mjs';

const srv = await startStaticServer();
const browser = await launchBrowser();
let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };

async function open({ noHalfFloat = false, throttle = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  if (noHalfFloat) {
    await ctx.addInitScript(() => {   // GPUがHDR描画先を持たない端末を模擬
      const orig = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (n) { return /EXT_color_buffer_(half_)?float/.test(n) ? null : orig.call(this, n); };
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await routeThree(page);
  const cdp = CDP_OK ? await ctx.newCDPSession(page) : null;
  if (cdp && throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto(`http://127.0.0.1:${srv.port}/index.html?feed=out/feeds/test`);
  await page.evaluate(() => document.getElementById('start-btn').click());
  await page.waitForFunction(() => window.KkoApp && window.KkoApp.tracker.hasData(), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { ctx, page, cdp, errors };
}
const real = (errs) => errs.filter((e) => !/model not installed|MMD load/.test(e));

// 1) 通常の端末条件: タッチでレティクルをドラッグ → 指の動きどおり床の上を動く
{
  const { ctx, page, cdp, errors } = await open();
  await page.evaluate(() => { const A = window.KkoApp; A.feed().video.pause(); A.environmentLighting.stop(); A.enterPlacementMode(); document.querySelectorAll('#select-screen,#start-screen,#loading-overlay,.mi-overlay').forEach((e) => { e.style.display = 'none'; }); });
  const proj = () => page.evaluate(async () => {
    const THREE = await import('three'); const A = window.KkoApp, st = document.getElementById('stage').getBoundingClientRect();
    const p = A.placementReticle.getWorldPosition(); const v = new THREE.Vector3(p.x, p.y, p.z).project(A.camera);
    return { x: st.left + (v.x * 0.5 + 0.5) * st.width, y: st.top + (-v.y * 0.5 + 0.5) * st.height, world: p, visible: v.z < 1 };
  });
  const a = await proj();
  const start = { x: a.x, y: a.y }, end = { x: a.x + 40, y: a.y + 60 };
  if (!CDP_OK) { console.log('SKIP  タッチドラッグ(CDP専用のためWebKitでは省略)'); }
  else if (a.visible && start.y > 0 && end.y < 852) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 10, y: start.y + (end.y - start.y) * i / 10 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const b = await proj();
    check('タッチドラッグ: レティクルが指に付いて動く(誤差6px以内)', Math.hypot(b.x - end.x, b.y - end.y) < 6, `指(${end.x.toFixed(0)},${end.y.toFixed(0)}) → 画面(${b.x.toFixed(0)},${b.y.toFixed(0)})`);
    check('タッチドラッグ: レティクルは床の高さのまま', Math.abs(b.world.y - a.world.y) < 1e-6, `y=${b.world.y.toFixed(3)}`);
    check('タッチドラッグ: 手前へ引くと近づく(下へドラッグ→距離が縮む)', Math.hypot(b.world.x, b.world.z) < Math.hypot(a.world.x, a.world.z), `${Math.hypot(a.world.x, a.world.z).toFixed(2)}m → ${Math.hypot(b.world.x, b.world.z).toFixed(2)}m`);
  } else check('レティクルが画面内にある(テスト前提)', false, JSON.stringify(a));

  // メモリ見積り: 1920x1080カメラ + pixelRatio 2 を想定
  const mem = await page.evaluate(async () => {
    const THREE = await import('three');
    const A = window.KkoApp; A.renderer.setPixelRatio(2); A.renderer.setSize(1920, 1080, false); A.renderFrame();
    const rt = A.colorMatch.rt, bytesPer = A.colorMatch.spec.hdr ? 8 : 4, sm = Math.max(1, A.colorMatch.spec.samples);
    const buf = A.renderer.getDrawingBufferSize(new THREE.Vector2());
    const main = rt.width * rt.height * bytesPer * (sm + 1) + rt.width * rt.height * 4 * sm;   // 色(MSAA+解決)+深度
    return { w: rt.width, h: rt.height, bufW: buf.x, bufH: buf.y, mainMB: main / 1048576 };
  });
  check('色補正の描画先が長辺1600以内(iPhoneのメモリ対策)', mem.w && Math.max(mem.w, mem.h) <= 1600, mem.err || `描画バッファ${mem.bufW}x${mem.bufH} → オフスクリーン${mem.w}x${mem.h} ≈ ${mem.mainMB.toFixed(0)}MB`);
  check('色補正の描画先メモリ見積りが 120MB 未満', mem.mainMB < 120, `${mem.mainMB && mem.mainMB.toFixed(0)}MB`);
  check('JSエラーなし', real(errors).length === 0, real(errors).slice(0, 2).join(' | '));
  await ctx.close();
}

// 2) HDR描画先の無い端末: 8bitへ落ちても描ける
{
  const { ctx, page, errors } = await open({ noHalfFloat: true });
  const r = await page.evaluate(() => { const A = window.KkoApp; A.renderFrame(); const gl = A.renderer.getContext(); return { hdr: A.colorMatch.spec.hdr, glErr: gl.getError(), refl: A.floorReflection.rt.texture.type }; });
  check('HDR非対応を検知して8bitに落ちる', r.hdr === false, `hdr=${r.hdr}`);
  check('8bit経路でもGLエラーが出ない', r.glErr === 0, `glError=${r.glErr}`);
  check('8bit経路でJSエラーなし', real(errors).length === 0, real(errors).slice(0, 2).join(' | '));
  await ctx.close();
}

// 3) CPU 4倍遅い端末: 追加機能(色補正+床反射)のコスト比
if (CDP_OK) {
  const { ctx, page } = await open({ throttle: 4 });
  const ms = (label) => page.evaluate(async (l) => {
    const A = window.KkoApp; const THREE = await import('three');
    if (!window.__s) { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.6, 24), new THREE.MeshToonMaterial({ color: 0xd04070 })); m.position.y = 0.8; g.add(m); g.position.set(0, -1.1, -2.6); A.scene.add(g); g.traverse((o) => o.layers.enable(1)); window.__s = g; }
    A.floorReflection.setFloor(0, -1.1, -2.6, 1); A.floorReflection.setVisible(true);
    const t0 = performance.now(); for (let i = 0; i < 20; i++) { A.renderFrame(); A.renderer.getContext().finish(); } return (performance.now() - t0) / 20;
  }, label);
  await page.evaluate(() => { window.KkoApp.colorMatch.setEnabled(false); window.KkoApp.floorReflection.setEnabled(false); });
  const plain = await ms('plain');
  await page.evaluate(() => { window.KkoApp.colorMatch.setEnabled(true); window.KkoApp.floorReflection.setEnabled(true); });
  const full = await ms('full');
  check('追加機能(色補正+床反射)のフレーム時間が、なしの3倍以内', full < plain * 3, `なし ${plain.toFixed(1)}ms / あり ${full.toFixed(1)}ms (比 ${(full / plain).toFixed(2)}、ソフトウェア描画での相対値)`);
  await ctx.close();
}

await browser.close(); await srv.close();
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
