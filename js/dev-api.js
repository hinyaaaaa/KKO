/* ============================================================
   js/dev-api.js — dev操作API(window.KkoDev)  Phase 0
   ------------------------------------------------------------
   目的: dev.html を「人間がマウスで触る画面」から「スクリプト/AIが
   決まった入力で操作して、同じ絵を何度でも再現できる画面」にする。

   設計方針:
   - 既存のdev.jsの挙動は変えない。dev.jsが持つ状態への参照(ctx)を
     受け取り、操作用の薄い窓口を window.KkoDev として公開するだけ。
   - 再現性: 撮影時は (1) アニメーションを止め (2) 固定dt(1/60)で
     決まった回数だけ進め (3) 乱数(まばたき)をシードで固定する。
   - 状態は state() で JSON として取り出し、applyState() で復元できる。
     撮影結果と一緒に state JSON を保存すれば、同じ絵を再生成できる。
   ============================================================ */

import { importModel } from './model-import.js';
import { deleteModel, listModels } from './model-store.js';

const FIXED_DT = 1 / 60;

/** mulberry32: 小さく高速なシード付き乱数 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAPTURE_HIDE_CSS = `
body.dev-capture #dev-header,
body.dev-capture #dev-character-switch,
body.dev-capture #dev-scene-panel,
body.dev-capture #dev-view-tools,
body.dev-capture #dev-bottom-bar,
body.dev-capture #dev-tune-panel,
body.dev-capture #pose-toast,
body.dev-capture #loading-overlay { display: none !important; }
`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('background image load failed'));
    img.src = src;
  });
}

/** CSSの background-size: cover / center 相当で画像を描く */
function drawCover(ctx, img, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * @param {object} c dev.jsから渡す参照一式
 */
export function installKkoDev(c) {
  const {
    THREE, camera, controls, bgRenderer, charRenderer, effect,
    backgroundScene, characterScene, devEnvironment, charCanvas, bgCanvas,
    bgImageDiv, grid, CHARACTERS, calibPlacement, applyPlacement,
    getCharacter, getLoadedId, loadById, getLoadError, runState, resize,
  } = c;

  // ---- 撮影用CSS(UIを隠す) ----
  const style = document.createElement('style');
  style.id = 'kko-dev-capture-style';
  style.textContent = CAPTURE_HIDE_CSS;
  document.head.appendChild(style);

  let currentBgUrl = null;
  let bgImageEl = null; // 合成用にデコード済みの背景画像

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(pred, timeoutMs, what) {
    const t0 = performance.now();
    while (!pred()) {
      if (performance.now() - t0 > timeoutMs) throw new Error(`timeout: ${what}`);
      await sleep(30);
    }
  }

  /* ---------------- 読み込み系 ---------------- */
  /** キャラの全テクスチャ画像のデコード完了を待つ(読み込み途中の絵を撮らないため) */
  async function waitForTextures(timeoutMs = 30000) {
    const ch = getCharacter();
    if (!ch) return;
    const pending = () => {
      let n = 0;
      ch.root.traverse((o) => {
        if (!o.isMesh) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          Object.values(m).forEach((v) => {
            if (!v || !v.isTexture) return;
            const im = v.image;
            if (!im) { n++; return; }
            if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement && !(im.complete && im.naturalWidth > 0)) n++;
          });
        });
      });
      return n;
    };
    const t0 = performance.now();
    while (pending() > 0 && performance.now() - t0 < timeoutMs) await sleep(30);
    // 最後のGPUアップロードを済ませるため、実際に1回描画する
    renderNow();
  }

  async function ready(timeoutMs = 60000) {
    await waitFor(() => !!getCharacter() || !!getLoadError(), timeoutMs, 'character load');
    if (getLoadError()) throw new Error(`character load error: ${getLoadError()}`);
    return true;
  }
  function isReady() { return !!getCharacter(); }

  async function loadCharacter(id, timeoutMs = 60000) {
    const def = CHARACTERS.find((d) => d.id === id);
    if (!def) throw new Error(`unknown character: ${id}`);
    if (getLoadedId() !== id) {
      loadById(def);
      await waitFor(() => getLoadedId() === id || !!getLoadError(), timeoutMs, `load ${id}`);
      if (getLoadError()) throw new Error(`character load error: ${getLoadError()}`);
    }
    return id;
  }

  /**
   * モデルzip(または複数ファイル)を端末内ストアへ取り込む。取り込みUIと同じ処理を通る。
   * @param {string} id キャラid
   * @param {ArrayBuffer|string} data zipのバイト列、またはbase64文字列
   */
  async function installModel(id, data, fileName = 'model.zip') {
    const def = CHARACTERS.find((d) => d.id === id);
    if (!def) throw new Error(`unknown character: ${id}`);
    let bytes = data;
    if (typeof data === 'string') {
      const bin = atob(data);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    const file = new File([bytes], fileName, { type: 'application/zip' });
    return importModel(def, [file]);
  }
  async function installedModels() { return listModels(); }
  async function uninstallModel(id) { return deleteModel(id); }

  function listCharacters() {
    return CHARACTERS.map((d) => ({
      id: d.id,
      name: d.name,
      poses: Object.keys(d.poses || {}),
      expressions: Object.keys(d.expressions || {}),
    }));
  }

  /* ---------------- キャラクター操作 ---------------- */
  function need() {
    const ch = getCharacter();
    if (!ch) throw new Error('character not loaded yet (await KkoDev.ready())');
    return ch;
  }

  function setPose(key) {
    const ch = need();
    if (!ch.poses || !ch.poses[key]) throw new Error(`unknown pose: ${key}`);
    ch.setPose(key);
    // 即座に反映(補間待ちをしない)
    ch.allPosableBones.forEach((n) => { ch.poseCurrent[n] = [...(ch.poseTargets[n] || [0, 0, 0])]; });
    return key;
  }
  function setExpression(key) {
    const ch = need();
    if (!ch.expressions || !ch.expressions[key]) throw new Error(`unknown expression: ${key}`);
    ch.setExpression(key);
    return key;
  }
  /** @param {Object<string,[number,number,number]>} map ボーン名→[x,y,z](度、既存ポーズ定義と同じ空間) */
  function setBones(map) {
    const ch = need();
    Object.entries(map || {}).forEach(([name, xyz]) => {
      if (!ch.allPosableBones.includes(name)) throw new Error(`unknown bone: ${name}`);
      ch.setBoneDelta(name, xyz);
    });
  }
  function setGlobalOffset(map) {
    const ch = need();
    Object.entries(map || {}).forEach(([k, v]) => ch.setGlobalOffset(k, v));
  }
  function listBones() { return [...need().allPosableBones]; }
  function getBones() {
    const ch = need();
    const out = {};
    ch.allPosableBones.forEach((n) => {
      const t = ch.poseTargets[n] || [0, 0, 0];
      const b = ch.presetBoneValues[n] || [0, 0, 0];
      if (Math.abs(t[0] - b[0]) + Math.abs(t[1] - b[1]) + Math.abs(t[2] - b[2]) > 1e-3) {
        out[n] = t.map((v) => Math.round(v * 100) / 100);
      }
    });
    return out;
  }
  function setPlacement(p) {
    Object.assign(calibPlacement, p || {});
    applyPlacement();
  }

  /* ---------------- カメラ ---------------- */
  /** 直接指定 */
  function setCamera({ position, target, fov } = {}) {
    if (position) camera.position.set(position[0], position[1], position[2]);
    if (target) controls.target.set(target[0], target[1], target[2]);
    if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    controls.update();
  }
  /** 注視点まわりの球面座標。azimuth=0 が +Z(正面)側、elevation>0 が見下ろし */
  function setOrbit({ distance = 3, azimuthDeg = 0, elevationDeg = 10, target = [0, 0.9, 0], fov } = {}) {
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const el = THREE.MathUtils.degToRad(elevationDeg);
    setCamera({
      position: [
        target[0] + distance * Math.cos(el) * Math.sin(az),
        target[1] + distance * Math.sin(el),
        target[2] + distance * Math.cos(el) * Math.cos(az),
      ],
      target,
      fov,
    });
  }
  /**
   * スマホで撮る状況の再現: カメラ高さ・キャラまでの水平距離・ピッチ(下向きが正)を指定する。
   * キャラは原点に立つ前提で、カメラは +Z 側に置く。
   */
  function setPhoneCamera({ heightM = 1.4, distanceM = 2.5, pitchDeg = 0, fov = 45, azimuthDeg = 0 } = {}) {
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const pitch = THREE.MathUtils.degToRad(pitchDeg);
    const pos = [distanceM * Math.sin(az), heightM, distanceM * Math.cos(az)];
    // 注視点: カメラ位置から、水平方向に(-pos)向き、pitchだけ下を向いた先
    const hx = -Math.sin(az), hz = -Math.cos(az);
    const len = 1.0;
    const target = [
      pos[0] + hx * Math.cos(pitch) * len,
      pos[1] - Math.sin(pitch) * len,
      pos[2] + hz * Math.cos(pitch) * len,
    ];
    setCamera({ position: pos, target, fov });
  }
  function getCamera() {
    return {
      position: camera.position.toArray().map((v) => Math.round(v * 1e4) / 1e4),
      target: controls.target.toArray().map((v) => Math.round(v * 1e4) / 1e4),
      fov: camera.fov,
    };
  }

  /* ---------------- 背景・環境・色調 ---------------- */
  /** @param {string|null} url 画像URL / data URL / null(クリア) */
  async function setBackground(url) {
    if (!url) {
      bgImageDiv.style.backgroundImage = '';
      bgImageDiv.classList.remove('show');
      currentBgUrl = null; bgImageEl = null;
      return;
    }
    bgImageEl = await loadImage(url);
    bgImageDiv.style.backgroundImage = `url('${url}')`;
    bgImageDiv.classList.add('show');
    currentBgUrl = url;
  }
  function setEnvironment(p = {}) {
    const s = devEnvironment.state;
    if (p.date) s.date = new Date(p.date);
    if (typeof p.solarHour === 'number') s.solarHour = p.solarHour;
    if (typeof p.latDeg === 'number') s.latDeg = p.latDeg;
    if (p.biome) s.biome = p.biome;
    devEnvironment.update();
  }
  function setGrade(cssFilter) { charCanvas.style.filter = cssFilter || ''; }
  function setGrid(visible) { grid.visible = !!visible; }

  /* ---------------- 時間の制御と描画 ---------------- */
  function seedRandom(seed) { Math.random = makeRng(seed); }

  /** 固定dtで n フレーム進める(アニメ停止中でも呼べる) */
  function step(frames = 1) {
    const ch = getCharacter();
    for (let i = 0; i < frames; i++) {
      if (ch) ch.update(FIXED_DT);
    }
  }
  /** 現在の状態を1回描画する(rAFを待たない) */
  function renderNow() {
    bgRenderer.render(backgroundScene, camera);
    effect.render(characterScene, camera);
  }
  function pause(p = true) { runState.paused = !!p; }

  /* ---------------- 状態の保存・復元 ---------------- */
  function state() {
    const ch = getCharacter();
    const env = devEnvironment.state;
    return {
      version: 1,
      character: getLoadedId(),
      pose: ch ? ch.activePoseKey : null,
      expression: ch ? (ch.currentExpressionKey || null) : null,
      globalOffset: ch ? { ...ch.globalOffset } : null,
      bones: ch ? getBones() : {},
      placement: { ...calibPlacement },
      camera: getCamera(),
      environment: {
        date: env.date instanceof Date ? env.date.toISOString() : env.date,
        solarHour: env.solarHour, latDeg: env.latDeg, biome: env.biome,
      },
      grade: charCanvas.style.filter || '',
      grid: grid.visible,
      background: currentBgUrl && currentBgUrl.startsWith('data:') ? '(data-url)' : currentBgUrl,
    };
  }

  async function applyState(s) {
    if (!s) return;
    if (s.character) await loadCharacter(s.character);
    await ready();
    if (s.environment) setEnvironment(s.environment);
    if (s.grade !== undefined) setGrade(s.grade);
    if (s.grid !== undefined) setGrid(s.grid);
    if (s.pose) setPose(s.pose);
    if (s.globalOffset) {
      const ch = need();
      ch.resetGlobalOffset();
      setGlobalOffset(s.globalOffset);
    }
    if (s.bones) setBones(s.bones);
    if (s.expression) setExpression(s.expression);
    if (s.placement) setPlacement(s.placement);
    if (s.camera) setCamera(s.camera);
    if (s.cameraPhone) setPhoneCamera(s.cameraPhone);
    if (s.cameraOrbit) setOrbit(s.cameraOrbit);
    if (s.background !== undefined && s.background !== '(data-url)') await setBackground(s.background);
  }

  /* ---------------- 撮影 ---------------- */
  /**
   * 合成画像(背景→背景写真→キャラ(色調フィルタ込み))をPNGのdata URLで返す。
   * @param {object} o
   *  - settleSec: 撮影前に固定dtで進める秒数(既定1.0。ポーズ補間・表情の収束用)
   *  - seed: まばたき等の乱数シード(既定1)
   *  - blink: false(既定)ならまばたきを止める
   *  - hideUI: true(既定)でパネル類を隠す
   *  - layers: true なら背景/キャラ単体の画像も返す(色統計の解析用)
   */
  async function capture(o = {}) {
    const { settleSec = 1.0, seed = 1, blink = false, hideUI = true, layers = false, mime = 'image/png' } = o;
    need();
    await waitForTextures();
    document.body.classList.toggle('dev-capture', !!hideUI);
    if (hideUI) { resize(); }
    pause(true);
    seedRandom(seed);
    const ch = getCharacter();
    if (!blink && ch) { ch.blinkTimer = 1e9; ch.blinkState = 'idle'; ch.blinkWeight = 0; }
    if (ch) {
      // rAFループが実時間で進めた分(ゆらぎの位相・補間途中の値)を捨て、毎回同じ起点から始める
      ch._poseElapsed = 0;
      ch.allPosableBones.forEach((n) => { ch.poseCurrent[n] = [...(ch.poseTargets[n] || [0, 0, 0])]; });
      if (ch.centerOffsetCurrent && ch.centerOffsetTarget) Object.assign(ch.centerOffsetCurrent, ch.centerOffsetTarget);
    }
    step(Math.max(1, Math.round(settleSec / FIXED_DT)));

    renderNow();
    const w = charCanvas.width, h = charCanvas.height;
    const comp = document.createElement('canvas');
    comp.width = w; comp.height = h;
    const g = comp.getContext('2d');
    g.drawImage(bgCanvas, 0, 0, w, h);
    if (bgImageEl) drawCover(g, bgImageEl, w, h);
    g.filter = charCanvas.style.filter || 'none';
    g.drawImage(charCanvas, 0, 0, w, h);
    g.filter = 'none';

    const result = { width: w, height: h, image: comp.toDataURL(mime), state: state() };
    if (layers) {
      const bgOnly = document.createElement('canvas');
      bgOnly.width = w; bgOnly.height = h;
      const bg = bgOnly.getContext('2d');
      bg.drawImage(bgCanvas, 0, 0, w, h);
      if (bgImageEl) drawCover(bg, bgImageEl, w, h);
      const chOnly = document.createElement('canvas');
      chOnly.width = w; chOnly.height = h;
      const cg = chOnly.getContext('2d');
      cg.filter = charCanvas.style.filter || 'none';
      cg.drawImage(charCanvas, 0, 0, w, h);
      result.layerBackground = bgOnly.toDataURL('image/png');
      result.layerCharacter = chOnly.toDataURL('image/png'); // 透明背景
    }
    return result;
  }

  const api = {
    apiVersion: 1,
    // 読み込み
    ready, isReady, waitForTextures, loadCharacter, listCharacters, installModel, installedModels, uninstallModel,
    // キャラクター
    setPose, setExpression, setBones, getBones, listBones, setGlobalOffset, setPlacement,
    // カメラ
    setCamera, setOrbit, setPhoneCamera, getCamera,
    // 背景・環境
    setBackground, setEnvironment, setGrade, setGrid,
    // 時間・描画・撮影
    seedRandom, step, renderNow, pause, capture,
    // 状態
    state, applyState,
  };
  window.KkoDev = api;
  return api;
}
