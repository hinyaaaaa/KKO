/* ============================================================
   js/gpu-caps.js — GPUの能力に応じた描画先の選択
   ------------------------------------------------------------
   ハーフフロートの描画先(HDRのまま色補正するため)は、端末によっては
   使えない/フィルタできない。使えないときは8bitに落とし、MSAAも
   上限に合わせる。実機で真っ黒になる事故を、起動時の判定で避ける。
   ============================================================ */
import * as THREE from 'three';

export function pickRenderTargetSpec(renderer, wantSamples = 4) {
  const gl = renderer.getContext();
  const ext = renderer.extensions;
  const isGL2 = renderer.capabilities.isWebGL2;
  const halfOK = isGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
  const maxSamples = isGL2 ? gl.getParameter(gl.MAX_SAMPLES) : 0;
  return {
    type: halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: Math.min(wantSamples, maxSamples),
    hdr: halfOK,
  };
}
