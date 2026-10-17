/* ============================================================
   js/color-match-pass.js — 色統計マッチングの描画パス(GPU)
   ------------------------------------------------------------
   キャラ(と足元の影・床反射)をいったんオフスクリーンへ描き、
   トーンマップ → sRGB化 → 色補正行列(js/color-match.js) を掛けて
   キャンバスへ出す。補正の強さは背景映像とキャラの統計から自動で決まる。
   キャラ側の統計は「補正なしの見た目」を小さく描いて測る(自己追従を防ぐ)。
   ============================================================ */
import * as THREE from 'three';
import { pickRenderTargetSpec } from './gpu-caps.js';
import { computeStats, computeGradeParams, buildGrade, smoothParams } from './color-match.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform mat3 uM;
uniform vec3 uOff;
uniform float uLift;
uniform float uGrade; // 0=補正なし(測定用) 1=補正あり
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float a = c.a;
  vec3 rgb = a > 0.0001 ? c.rgb / a : vec3(0.0);   // RTは乗算済みアルファ
  gl_FragColor = vec4(rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 s = gl_FragColor.rgb;
  if (uGrade > 0.5) {
    s = clamp(uM * s + uOff, 0.0, 1.0);
    s = uLift + (1.0 - uLift) * s;
  }
  gl_FragColor = vec4(s * a, a);                    // キャンバスも乗算済み
}`;

export class ColorMatchPass {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{video: HTMLVideoElement, strength?: number, enabled?: boolean, measureIntervalMs?: number}} opt
   */
  constructor(renderer, { video, strength = 0.5, enabled = true, measureIntervalMs = 400, maxSide = 1600 } = {}) {
    this.maxSide = maxSide; // オフスクリーンの長辺上限(iPhoneのメモリ・帯域対策。超える分は縮小して描く)
    this.renderer = renderer;
    this.video = video;
    this.strength = strength;
    this.enabled = enabled;
    this.measureIntervalMs = measureIntervalMs;

    const spec = pickRenderTargetSpec(renderer, 4);
    this.spec = spec;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      type: spec.type, samples: spec.samples, depthBuffer: true,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.probeRT = new THREE.WebGLRenderTarget(48, 48, { type: THREE.UnsignedByteType, depthBuffer: false });
    this._probeBuf = new Uint8Array(48 * 48 * 4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uM: { value: new THREE.Matrix3() }, uOff: { value: new THREE.Vector3() },
        uLift: { value: 0 }, uGrade: { value: 1 },
      },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false, transparent: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.bgCanvas = document.createElement('canvas'); this.bgCanvas.width = 64; this.bgCanvas.height = 36;
    this.bgCtx = this.bgCanvas.getContext('2d', { willReadFrequently: true });

    this.params = { gainY: 1, dY: 0, sat: 1, dCb: 0, dCr: 0, lift: 0 };
    this.lastBg = null; this.lastCh = null;
    this._lastMeasure = 0; this._yMeanChar = 0.5;
    this._applyGrade(buildGrade(this.params, this._yMeanChar));
  }

  setEnabled(v) { this.enabled = !!v; }
  setStrength(v) { this.strength = v; }

  _applyGrade(g) {
    const m = g.m;
    this.material.uniforms.uM.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]); // row-major入力
    this.material.uniforms.uOff.value.set(g.off[0], g.off[1], g.off[2]);
    this.material.uniforms.uLift.value = g.lift;
  }

  _size() {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = Math.min(1, this.maxSide / Math.max(s.x, s.y));
    const w = Math.max(2, Math.round(s.x * k)), h = Math.max(2, Math.round(s.y * k));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
  }

  _measure(dt) {
    const now = performance.now();
    if (now - this._lastMeasure < this.measureIntervalMs) return;
    this._lastMeasure = now;
    const v = this.video;
    if (!v || v.readyState < 2 || !v.videoWidth) return;

    // 背景(カメラ映像)
    this.bgCtx.drawImage(v, 0, 0, 64, 36);
    const bg = computeStats(this.bgCtx.getImageData(0, 0, 64, 36).data);

    // キャラ(補正なしの見た目)を小さく描いて測る
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.material.uniforms.tDiffuse.value = this.rt.texture;
    this.material.uniforms.uGrade.value = 0;
    r.setRenderTarget(this.probeRT); r.clear();
    r.render(this.scene, this.cam);
    r.readRenderTargetPixels(this.probeRT, 0, 0, 48, 48, this._probeBuf);
    r.setRenderTarget(prev);
    this.material.uniforms.uGrade.value = 1;
    const ch = computeStats(this._probeBuf, { alphaMin: 0.5, premultiplied: true });

    this.lastBg = bg; this.lastCh = ch;
    if (bg && ch) {
      this._yMeanChar = ch.yMean;
      const target = computeGradeParams(bg, ch, this.strength);
      const interval = this.measureIntervalMs / 1000;
      this.params = smoothParams(this.params, target, interval, 0.8);
      this._applyGrade(buildGrade(this.params, this._yMeanChar));
    }
  }

  /** effect.render(scene,camera) の代わりに呼ぶ */
  render(effect, scene, camera, dt = 1 / 60) {
    const r = this.renderer;
    this._size();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    effect.render(scene, camera);
    r.setRenderTarget(null);
    this._measure(dt);
    this.material.uniforms.tDiffuse.value = this.rt.texture;
    this.material.uniforms.uGrade.value = this.enabled ? 1 : 0;
    r.clear();
    r.render(this.scene, this.cam);
  }

  dispose() { this.rt.dispose(); this.probeRT.dispose(); this.material.dispose(); this.quad.geometry.dispose(); }
}
