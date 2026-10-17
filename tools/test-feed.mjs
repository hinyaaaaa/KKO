// 録画フィード(映像+センサー)を本番ページ(index.html)へ流し、カメラ姿勢が追従することを確認する
// 実行: node tools/test-feed.mjs        (要: npm install、Chrome/Edge または KKO_BROWSER)
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, routeThree } from './browser.mjs';
import { startStaticServer, REPO_ROOT } from './static-server.mjs';

const OUT = path.join(REPO_ROOT, 'out', 'feeds');
fs.mkdirSync(OUT, { recursive: true });
const srv = await startStaticServer();
const base = `http://127.0.0.1:${srv.port}`;
const browser = await launchBrowser();
let fail = 0;
const check = (name, ok, info = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); };

try {
  // 1) フィード生成: 映像(アニメ)+センサー(俯角が0°→40°へ動く)を FeedRecorder で録る
  const gen = await browser.newPage();
  await gen.goto(`${base}/model-import.css`); // 何も描画しない軽いページ(エンコーダを邪魔しない)
  const made = await gen.evaluate(async () => {
    const { FeedRecorder } = await import('/js/feed-recorder.js');
    const { emitOrientation, emitMotion } = await import('/js/sensor-hub.js');
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new FeedRecorder({ mimes: ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'] }); // ヘッドレスChromiumはH.264を持たない
    rec.start(stream);
    const t0 = performance.now();
    await new Promise((res) => {
      // 描画とセンサーは、rAFが間引かれる環境(ヘッドレス)でも一定間隔で出るようタイマーで回す
      const iv = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = `hsl(${(t * 60) % 360},60%,50%)`; g.fillRect(0, 0, 640, 360);
        g.fillStyle = '#fff'; g.fillRect((t * 120) % 600, 150, 40, 40);
        const beta = 90 - Math.min(40, (t / 2.5) * 40);      // 90→50(俯角0→40°)
        emitOrientation({ alpha: 10, beta, gamma: 0 });
        emitMotion({ rotationRate: { alpha: 0, beta: 5, gamma: 0 } });
        if (t >= 3) { clearInterval(iv); res(); }
      }, 33);
    });
    const r = await rec.stop(() => ({ note: 'synthetic' }));
    const buf = new Uint8Array(await r.video.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), meta: r.meta, ext: r.ext };
  });
  check('録画: 映像データが空でない', made.b64.length > 1000, `(${made.b64.length} chars)`);
  fs.writeFileSync(path.join(OUT, `test.${made.ext}`), Buffer.from(made.b64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'test.json'), JSON.stringify(made.meta));
  check('録画: センサー記録が入っている', made.meta.sensors.length > 50, `(${made.meta.sensors.length}件, ${made.ext})`);
  await gen.close();

  // 2) 本番ページで再生
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await routeThree(page);
  await page.goto(`${base}/index.html?feed=out/feeds/test`);
  await page.evaluate(() => document.getElementById('start-btn').click());
  await page.waitForFunction(() => window.KkoApp && window.KkoApp.feed() && window.KkoApp.tracker.hasData(), null, { timeout: 15000 });
  check('本番ページでフィードの再生が始まる', true);

  const samples = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(400);
    samples.push(await page.evaluate(() => ({
      t: window.KkoApp.feed().video.currentTime,
      pitch: window.KkoApp.tracker.getPitchDeg(),
      camQ: window.KkoApp.camera.quaternion.toArray(),
      tracking: window.KkoApp.isTracking(),
    })));
  }
  const pitches = samples.map((s) => s.pitch);
  check('姿勢追従が有効', samples.every((s) => s.tracking));
  check('俯角が時間とともに変わる', Math.max(...pitches) - Math.min(...pitches) > 15, `(${Math.min(...pitches).toFixed(1)}→${Math.max(...pitches).toFixed(1)}°)`);
  check('カメラのquaternionが実際に動いている', JSON.stringify(samples[0].camQ) !== JSON.stringify(samples.at(-1).camQ));
  check('JSエラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close(); await srv.close();
}
console.log(fail ? `\n${fail}件失敗` : '\nすべて合格');
process.exit(fail ? 1 : 0);
