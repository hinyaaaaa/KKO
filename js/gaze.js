/* ============================================================
   js/gaze.js — 視線(顔)をカメラへ向ける
   ------------------------------------------------------------
   世界固定の姿勢追従(orientation-tracker)を入れると、撮る位置・向きで
   「キャラから見たカメラの方向」が変わる。顔だけをその方向へ少し向けて、
   「こちらを見ている」感じを出す。体の向き(rotY)は触らない。
   - 正面近く(deadband内)では顔を動かさない(常にきょろきょろしない)
   - 可動域(maxHead)で頭打ち。実際の見た目より控えめ(gain<1)
   - なめらかに追従(tau秒)。急にカメラが動いても首が飛ばない
   純粋な計算のみ。キャラへの反映は main.js が setGlobalOffset('headYaw') で行う。
   ============================================================ */
const DEG = 180 / Math.PI;
export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * キャラの正面から見た、カメラの水平方向(度)。右(+X側)が正。
 * キャラは rotY=0 のとき +Z を向く(カメラが -Z 側にいる前提の既存の配置)。
 */
export function relativeYawToCamera(charX, charZ, rotYRad, camX = 0, camZ = 0) {
  const toCam = Math.atan2(camX - charX, camZ - charZ) * DEG;   // +Z基準、+Xへ増える
  return wrap180(toCam - rotYRad * DEG);
}

export class GazeController {
  /**
   * @param {{maxHead?:number, gain?:number, deadband?:number, tau?:number, sign?:number}} o
   * sign: 頭ボーンのY回転の正負がモデル座標でどちらか(+1/-1)。実機/devで一度だけ確認する。
   */
  constructor(o = {}) {
    this.maxHead = o.maxHead ?? 22;
    this.gain = o.gain ?? 0.6;
    this.deadband = o.deadband ?? 6;
    this.tau = o.tau ?? 0.4;
    this.sign = o.sign ?? 1;
    this.value = 0;
  }
  /** @returns headYaw(度。GLOBAL_OFFSETの単位) */
  update(dtSec, relDeg) {
    let target = 0;
    const a = Math.abs(relDeg);
    if (a > this.deadband) {
      // deadbandを越えた分だけ追う(境目で急に動かない)
      target = Math.sign(relDeg) * Math.min(this.maxHead, (a - this.deadband) * this.gain);
    }
    target *= this.sign;
    const k = 1 - Math.exp(-Math.max(0, dtSec) / this.tau);
    this.value += (target - this.value) * k;
    return this.value;
  }
  reset() { this.value = 0; }
}
