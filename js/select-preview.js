/* ============================================================
   js/select-preview.js — 選択画面の上半分: 取り込み済みの3Dモデルを待機モーションで表示
   ------------------------------------------------------------
   - いま中央にいる推しの1体だけを読み込む(同時に複数は持たない。iPhoneのメモリ対策)。
   - 専用の小さなWebGLコンテキストを使い、選択画面を閉じたら破棄する(撮影画面と併用しない)。
   - 未取り込みなら描かない(host の data-state="empty" で案内表示)。
   - 待機モーションは character.update(dt) の idle-animator に任せる(撮影画面と同じ動き)。
   - 読み込み中にスワイプされたら、古い読み込みの結果は捨てる(トークン方式)。
   ============================================================ */
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

export function createSelectPreview({ host, MMDLoader, loadCharacter, disposeCharacter, isModelAvailable, debounceMs = 250 }) {
  let renderer = null, effect = null, scene = null, camera = null, current = null, currentId = null;
  let token = 0, raf = 0, last = 0, timer = 0, ro = null, destroyed = false;

  const setState = (s) => { host.dataset.state = s; };
  setState('idle');

  function ensureRenderer() {
    if (renderer) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'select-preview-canvas';
    host.appendChild(canvas);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    effect = new OutlineEffect(renderer, { defaultThickness: 0.0015, defaultColor: [0.05, 0.04, 0.05], defaultAlpha: 0.6 });
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 1.5);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6); dir.position.set(1.5, 3, 4);
    scene.add(hemi, dir);
    ro = new ResizeObserver(resize); ro.observe(host);
    resize();
  }

  function resize() {
    if (!renderer) return;
    const w = Math.max(2, host.clientWidth), h = Math.max(2, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    frame();
  }

  /** 全身が上半分にちょうど収まるよう、モデルを縮尺・配置する */
  function frame() {
    if (!current) return;
    const root = current.root;
    root.scale.setScalar(1); root.position.set(0, 0, 0); root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (!isFinite(size.y) || size.y <= 0) return;
    const targetH = 1.6, s = targetH / size.y;
    root.scale.setScalar(s);
    root.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
    // 縦に収まる距離(余白12%)。横が足りなければ引く
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const dV = (targetH / 2) / Math.tan(vFov / 2) * 1.12;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dH = ((size.x * s) / 2) / Math.tan(hFov / 2) * 1.2;
    const d = Math.max(dV, dH);
    camera.position.set(0, targetH * 0.5, d);
    camera.lookAt(0, targetH * 0.5, 0);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!current || document.hidden) return;
    current.update(dt);
    effect.render(scene, camera);
  }
  function startLoop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }
  function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  function unload() {
    if (current) { disposeCharacter(current, scene); current = null; }
    currentId = null;
    stopLoop();
  }

  async function load(def) {
    const my = ++token;
    if (currentId === def.id && current) return;
    unload();
    let available = false;
    try { available = await isModelAvailable(def); } catch { available = false; }
    if (my !== token || destroyed) return;
    if (!available) { setState('empty'); return; }
    setState('loading');
    ensureRenderer();
    loadCharacter(def, { MMDLoader, scene }, {
      onLoad: (character) => {
        if (my !== token || destroyed) { disposeCharacter(character, scene); return; }   // 読み込み中にスワイプされた
        current = character; currentId = def.id;
        frame(); setState('ready'); startLoop();
      },
      onError: (err) => { console.error('preview load error', err); if (my === token) setState('error'); },
    });
  }

  return {
    /** スワイプ中に連続で呼ばれても、止まったときの1回だけ読み込む */
    show(def) { token++; clearTimeout(timer); setState('loading'); timer = setTimeout(() => load(def), debounceMs); },
    /** 取り込み完了後など、同じ推しを読み直す */
    reload(def) { currentId = null; this.show(def); },
    destroy() {
      destroyed = true; token++; clearTimeout(timer); unload();
      if (ro) ro.disconnect();
      if (renderer) { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); renderer = null; }
      setState('idle');
    },
    revive() { destroyed = false; },
    _debug: () => ({ state: host.dataset.state, hasCharacter: !!current, id: currentId, hasContext: !!renderer }),
  };
}
