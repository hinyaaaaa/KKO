// 本番ページに「代役キャラ」を立てて、色調補正・床反射・姿勢追従が実際に描画へ効くことを確かめる
// 実行: node tools/test-render.mjs [outDir]   (先に tools/test-feed.mjs で out/feeds/test を作っておく)
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, routeThree } from './browser.mjs';
import { startStaticServer, REPO_ROOT } from './static-server.mjs';

const outDir = path.resolve(process.argv[2] || path.join(REPO_ROOT, 'out', 'render'));
fs.mkdirSync(outDir, { recursive: true });
const srv = await startStaticServer();
const browser = await launchBrowser();
let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const isExpected = (t) => /model not installed|MMD load error/.test(t);   // このテストにはモデルが無い
  await routeThree(page);
  await page.goto(`http://127.0.0.1:${srv.port}/index.html?feed=out/feeds/test`);
  await page.evaluate(() => document.getElementById('start-btn').click());
  await page.waitForFunction(() => window.KkoApp && window.KkoApp.tracker.hasData() && document.getElementById('camera-video').videoWidth > 0, null, { timeout: 20000 });

  // 代役キャラ(人型の単純な立体)。高さ1.6m、足元は床(y=-1.1)
  await page.evaluate(async () => {
    const THREE = await import('three');
    const A = window.KkoApp;
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshToonMaterial({ color: c });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.75, 20), mat(0xd04070)); body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 16), mat(0xf2d0b8)); head.position.y = 1.5;
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.6, 12), mat(0x2c3a66)); legL.position.set(-0.08, 0.3, 0);
    const legR = legL.clone(); legR.position.x = 0.08;
    g.add(body, head, legL, legR);
    g.position.set(0, -1.1, -2.6);
    A.scene.add(g);
    g.traverse((o) => o.layers.enable(1));
    A.floorReflection.setFloor(0, -1.1, -2.6, 1.0);
    A.floorReflection.setVisible(true);
    window.__standin = g;
  });
  await page.waitForTimeout(1500);

  const shot = async (name) => {
    await page.evaluate(() => window.KkoApp.renderFrame());
    const b64 = await page.evaluate(() => {
      const A = window.KkoApp, v = document.getElementById('camera-video');
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const x = c.getContext('2d'); x.drawImage(v, 0, 0, 640, 360); x.drawImage(A.renderer.domElement, 0, 0, 640, 360);
      return c.toDataURL('image/png').split(',')[1];
    });
    const f = path.join(outDir, `${name}.png`); fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return page.evaluate(async (b) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data);
    }, b64);
  };
  const diff = (a, b, region) => {
    let sum = 0, n = 0;
    for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
      const i = (y * 640 + x) * 4; sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3;
    }
    return sum / n;
  };

  // 動画を一時停止して、同じ絵で比較する
  // 比較を安定させる: 映像を止め、環境光推定(時間とともに光を調整する)も止める
  await page.evaluate(() => { window.KkoApp.feed().video.pause(); window.KkoApp.environmentLighting.stop(); });
  const A = await page.evaluate(() => { const a = window.KkoApp; return { pitch: a.tracker.getPitchDeg(), tracking: a.isTracking() }; });
  check('姿勢追従が有効(俯角あり)', A.tracking && A.pitch > 3, `pitch=${A.pitch.toFixed(1)}°`);

  await page.evaluate(() => { const a = window.KkoApp; a.colorMatch.setEnabled(false); a.floorReflection.setEnabled(false); a.floorReflection.setVisible(false); });
  const base = await shot('1-plain');

  // 床反射 on: 足元より下の領域だけ変わる
  await page.evaluate(() => { const a = window.KkoApp; a.floorReflection.setEnabled(true); a.floorReflection.setVisible(true); });
  const refl = await shot('2-reflection');
  // 代役キャラの足元の画面位置を求める
  const feet = await page.evaluate(async () => {
    const THREE = await import('three'); const a = window.KkoApp;
    const v = new THREE.Vector3(0, -1.1, -2.6).project(a.camera);
    return { x: (v.x * 0.5 + 0.5) * 640, y: (-v.y * 0.5 + 0.5) * 360 };
  });
  const below = { x0: Math.max(0, Math.round(feet.x - 60)), x1: Math.min(640, Math.round(feet.x + 60)), y0: Math.round(feet.y + 4), y1: Math.min(360, Math.round(feet.y + 70)) };
  const above = { x0: 0, x1: 640, y0: 0, y1: Math.max(1, Math.round(feet.y - 4)) };   // 足元より上(キャラ本体を含む)
  const dBelow = diff(base, refl, below), dAbove = diff(base, refl, above);
  check('床反射: 足元の下で絵が変わる', dBelow > 0.4, `Δ=${dBelow.toFixed(2)} (足元 y=${feet.y.toFixed(0)})`);
  check('床反射: キャラより上は変わらない', dAbove < 0.05, `Δ=${dAbove.toFixed(3)}`);

  // 色調補正 on: キャラ部分の色が変わり、パラメータが動く
  await page.evaluate(() => { const a = window.KkoApp; a.colorMatch.setEnabled(true); a.colorMatch.measureIntervalMs = 0; });
  for (let i = 0; i < 6; i++) { await page.evaluate(() => window.KkoApp.renderFrame(0.4)); await page.waitForTimeout(50); }
  const graded = await shot('3-colormatch');
  // キャラの脚(足元の少し上)。画面外に出ないよう範囲を切り詰める
  const body = { x0: Math.max(0, Math.round(feet.x - 14)), x1: Math.min(640, Math.round(feet.x + 14)), y0: Math.max(0, Math.round(feet.y - 40)), y1: Math.max(1, Math.min(360, Math.round(feet.y - 6))) };
  const dBody = diff(refl, graded, body);
  const P = await page.evaluate(() => ({ p: window.KkoApp.colorMatch.params, bg: window.KkoApp.colorMatch.lastBg, ch: window.KkoApp.colorMatch.lastCh }));
  check('色調補正: 背景・キャラの統計が取れている', !!P.bg && !!P.ch, P.ch ? `キャラ画素n=${P.ch.n}` : '');
  check('色調補正: パラメータが中立から動く', Math.abs(P.p.sat - 1) + Math.abs(P.p.gainY - 1) + P.p.lift > 0.005, JSON.stringify(Object.fromEntries(Object.entries(P.p).map(([k, v]) => [k, +v.toFixed(3)]))));
  check('色調補正: キャラの色が実際に変わる', dBody > 0.3, `Δ=${dBody.toFixed(2)}`);
  check('色調補正: 変化は控えめ(急激でない)', dBody < 25, `Δ=${dBody.toFixed(2)}`);

  // 傾きを変えると、世界に固定されたキャラが画面上で動く(上から見る=足元が画面下へ)
  const y1 = feet.y;
  await page.evaluate(() => { const a = window.KkoApp; for (let i = 0; i < 200; i++) a.tracker.feed({ alpha: 10, beta: 40, gamma: 0 }, 99999 + i * 16); a.camera.quaternion.copy(a.tracker.getQuaternion()); });
  const y2 = await page.evaluate(async () => { const THREE = await import('three'); const a = window.KkoApp; a.camera.updateMatrixWorld(true); return (-new THREE.Vector3(0, -1.1, -2.6).project(a.camera).y * 0.5 + 0.5) * 360; });
  check('俯角が深いほど、足元が画面の上へ移る(世界固定)', y2 < y1 - 20, `y: ${y1.toFixed(0)} → ${y2.toFixed(0)}`);
  await shot('4-looking-down');

  const real = errors.filter((e) => !isExpected(e));
  check('JSエラーなし(モデル未取り込みは除く)', real.length === 0, real.slice(0, 3).join(' | '));
} finally { await browser.close(); await srv.close(); }
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
