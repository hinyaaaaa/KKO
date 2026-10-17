/* ============================================================
   js/floor-reflection.js — 足元の床反射(平面反射)
   ------------------------------------------------------------
   キャラだけを、床面で鏡像にしたカメラから小さく描き、床の上へ淡く重ねる。
   - 反射するのは layer 1 のオブジェクト(キャラ+ライト)だけ。影・レティクル等は映らない。
   - 足元で濃く、離れるほど薄く・ぼける(つや消しの床を想定)。強さは既定でごく弱い。
   - three.js の Reflector(MIT)の斜めクリップ法を簡略化して使っている。
   ============================================================ */
import * as THREE from 'three';

import { pickRenderTargetSpec } from './gpu-caps.js';

export const REFLECT_LAYER = 1;

const VERT = /* glsl */`
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec2 vLocal;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vLocal = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform float uStrength;
uniform float uRadius;
uniform float uBlur;
varying vec4 vUv;
varying vec2 vLocal;
void main() {
  float d = length(vLocal) / uRadius;
  float fade = 1.0 - smoothstep(0.25, 1.0, d);
  float bias = mix(0.4, uBlur, smoothstep(0.0, 1.0, d));
  vec4 r = texture2DProj(tDiffuse, vUv, bias);
  float a = r.a;
  vec3 rgb = a > 0.001 ? r.rgb / a : vec3(0.0);
  gl_FragColor = vec4(rgb, a * uStrength * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class FloorReflection {
  /**
   * @param {THREE.Scene} scene
   * @param {{strength?: number, rtScale?: number, enabled?: boolean, blur?: number}} opt
   */
  constructor(scene, { strength = 0.16, rtScale = 0.5, enabled = true, blur = 3.0, renderer = null } = {}) {
    const spec = renderer ? pickRenderTargetSpec(renderer, 4) : { type: THREE.HalfFloatType, samples: 4 };
    this.scene = scene;
    this.enabled = enabled;
    this.strength = strength;
    this.rtScale = rtScale;
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.virtualCamera.layers.set(REFLECT_LAYER);
    this.textureMatrix = new THREE.Matrix4();
    this.rt = new THREE.WebGLRenderTarget(256, 256, {
      type: spec.type, samples: spec.samples, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: this.rt.texture }, textureMatrix: { value: this.textureMatrix },
        uStrength: { value: strength }, uRadius: { value: 1 }, uBlur: { value: blur },
      },
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material); // 半径1の正方形(uRadiusで実寸に)
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._n = new THREE.Vector3(); this._p = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._view = new THREE.Vector3(); this._look = new THREE.Vector3(); this._target = new THREE.Vector3();
    this._rot = new THREE.Matrix4(); this._plane = new THREE.Plane(); this._clip = new THREE.Vector4(); this._q = new THREE.Vector4();
  }

  setEnabled(v) { this.enabled = !!v; if (!v) this.mesh.visible = false; }
  setStrength(v) { this.strength = v; this.material.uniforms.uStrength.value = v; }

  /** キャラのObject3D(とライト)を反射の対象にする */
  static markReflected(obj) { obj.traverse((o) => o.layers.enable(REFLECT_LAYER)); }

  /** 床の位置と、反射を出す範囲(半径m) */
  setFloor(x, floorY, z, radius) {
    this.mesh.position.set(x, floorY + 0.002, z);
    this.mesh.scale.set(radius, radius, 1);
    this.material.uniforms.uRadius.value = radius;
    this.mesh.updateMatrixWorld(true);
  }

  setVisible(v) { this.mesh.visible = !!v && this.enabled; }

  /** メイン描画の前に呼ぶ。反射用のRTを更新する */
  update(renderer, camera) {
    if (!this.enabled || !this.mesh.visible || this.strength <= 0) return;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.round(s.x * this.rtScale)), h = Math.max(64, Math.round(s.y * this.rtScale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);

    const m = this.mesh, vc = this.virtualCamera;
    this._p.setFromMatrixPosition(m.matrixWorld);
    this._c.setFromMatrixPosition(camera.matrixWorld);
    this._rot.extractRotation(m.matrixWorld);
    this._n.set(0, 0, 1).applyMatrix4(this._rot);
    this._view.subVectors(this._p, this._c);
    if (this._view.dot(this._n) > 0) return;                    // 床を裏から見ている

    this._view.reflect(this._n).negate().add(this._p);
    this._rot.extractRotation(camera.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(this._c);
    this._target.subVectors(this._p, this._look).reflect(this._n).negate().add(this._p);
    vc.position.copy(this._view);
    vc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(this._n);
    vc.lookAt(this._target);
    vc.far = camera.far; vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse).multiply(m.matrixWorld);

    // 斜めクリップ: 床より下の物を映さない
    this._plane.setFromNormalAndCoplanarPoint(this._n, this._p).applyMatrix4(vc.matrixWorldInverse);
    this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const e = vc.projectionMatrix.elements;
    this._q.set((Math.sign(this._clip.x) + e[8]) / e[0], (Math.sign(this._clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this._clip.multiplyScalar(2 / this._clip.dot(this._q));
    e[2] = this._clip.x; e[6] = this._clip.y; e[10] = this._clip.z + 1; e[14] = this._clip.w;

    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, vc);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setClearAlpha(prevClear);
  }

  dispose() { this.rt.dispose(); this.material.dispose(); this.mesh.geometry.dispose(); this.scene.remove(this.mesh); }
}
