/* ============================================================
   js/orientation-tracker.js — 重力基準の姿勢追従(3DoF)
   ------------------------------------------------------------
   スマホの向き(deviceorientation)から、「世界に固定された」カメラ姿勢を
   求める。ワールドは Y=上(重力と逆)、-Z=リセット時のカメラ正面(水平)。

   - 傾き(pitch/roll)は重力で決まるので、ドリフトしない。
     → 上から撮れば、立っているキャラも正しく「上から見た姿」になる。
   - 向き(yaw)は端末の相対値。resetYaw() を呼んだ時点を基準(正面)にする。
     iOSのalphaは北基準ではなく任意基準だが、相対回転としては使える。
   - 位置(並進)は追わない。スマホを平行移動するとキャラは動かない(3DoFの限界)。

   純粋な計算だけを持ち、DOM・three.jsのシーンには触れない
   (PCでのリプレイ・Node上のテストでも同じ計算が動くように)。
   ============================================================ */
import * as THREE from 'three';

const DEG = Math.PI / 180;
const _euler = new THREE.Euler();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // 背面カメラ向きに-90°(X)
const _zee = new THREE.Vector3(0, 0, 1);
const _qTmp = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * deviceorientation(alpha,beta,gamma度)+画面の回転角(度)から、
 * 背面カメラのワールド姿勢(クォータニオン)を作る。three.js標準の式。
 * ワールド: Y上 / alpha=0の向きが-Z。
 */
export function orientationToQuaternion(out, alphaDeg, betaDeg, gammaDeg, screenAngleDeg = 0) {
  _euler.set(betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG, 'YXZ');
  out.setFromEuler(_euler);
  out.multiply(_q1);
  out.multiply(_qTmp.setFromAxisAngle(_zee, -screenAngleDeg * DEG));
  return out;
}

/** クォータニオンが表すカメラの、水平面上の向き(yaw, rad)。真下/真上を向くときは上方向ベクトルで代用。 */
export function cameraYaw(q) {
  _v.set(0, 0, -1).applyQuaternion(q);              // 視線
  if (Math.hypot(_v.x, _v.z) > 0.35) return Math.atan2(-_v.x, -_v.z);
  _v.set(0, 1, 0).applyQuaternion(q);               // 画面の上方向(視線が縦に近いとき)
  // 真下を向くとき、画面の上は「前」を指す。真上のときは逆。
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const s = look.y < 0 ? 1 : -1;
  return Math.atan2(-_v.x * s, -_v.z * s);
}

/** 二つのクォータニオン間の角度(rad) */
function angleBetween(a, b) {
  const d = Math.min(1, Math.abs(a.dot(b)));
  return 2 * Math.acos(d);
}

export class OrientationTracker {
  /**
   * @param {object} opt
   * @param {number} [opt.minAlpha=0.06]  静止時の追従率(小さいほど滑らか・遅い)
   * @param {number} [opt.maxAlpha=0.9]   大きく動かしたときの追従率
   * @param {number} [opt.speedForMax=1.2] この角速度(rad/s)以上で maxAlpha
   */
  constructor(opt = {}) {
    this.minAlpha = opt.minAlpha ?? 0.06;
    this.maxAlpha = opt.maxAlpha ?? 0.9;
    this.speedForMax = opt.speedForMax ?? 1.2;
    this.screenAngle = 0;

    this._raw = new THREE.Quaternion();      // センサーそのままの姿勢
    this._smooth = new THREE.Quaternion();   // 平滑化後(yaw補正前)
    this._yawOffset = new THREE.Quaternion();// yaw基準(リセット時に確定)
    this._out = new THREE.Quaternion();      // 最終出力
    this._hasData = false;
    this._lastT = null;
    this._needYawReset = true;
    this.sampleCount = 0;
  }

  /** センサー値を入れる。t は ms(performance.now基準でも録画時刻でもよい) */
  feed(sample, t) {
    if (!sample || typeof sample !== 'object') return false;
    const { alpha, beta, gamma } = sample;
    if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma) || !Number.isFinite(t)) return false;   // null/NaN/Infinityは捨てる
    orientationToQuaternion(this._raw, alpha, beta, gamma, this.screenAngle);
    this.sampleCount++;
    if (!this._hasData) {
      this._smooth.copy(this._raw);
      this._hasData = true;
    } else {
      const dt = this._lastT == null ? 1 / 60 : Math.max(1e-3, Math.min(0.25, (t - this._lastT) / 1000));
      const speed = angleBetween(this._smooth, this._raw) / dt;
      const k = THREE.MathUtils.clamp(speed / this.speedForMax, 0, 1);
      // 動きが小さいほど強く平滑化(手ぶれ・センサーノイズ除去)、大きいほど遅れなく追従
      const aBase = this.minAlpha + (this.maxAlpha - this.minAlpha) * k * k;
      const a = 1 - Math.pow(1 - aBase, dt * 60);
      this._smooth.slerp(this._raw, a);
    }
    this._lastT = t;
    if (this._needYawReset) this._applyYawReset();
    this._compose();
    return true;
  }

  hasData() { return this._hasData; }

  /** 今向いている水平方向を「正面(-Z)」にする。配置確定時などに呼ぶ。 */
  resetYaw() {
    this._needYawReset = true;
    if (this._hasData) { this._applyYawReset(); this._compose(); }
  }

  _applyYawReset() {
    const yaw = cameraYaw(this._smooth);
    this._yawOffset.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this._needYawReset = false;
  }
  _compose() {
    this._out.copy(this._yawOffset).multiply(this._smooth);
  }

  /** カメラへ設定する姿勢(Quaternion参照。書き換えないこと) */
  getQuaternion() { return this._out; }

  /** カメラの俯角(度)。下向きが正。0=水平、90=真下 */
  getPitchDeg() {
    _v.set(0, 0, -1).applyQuaternion(this._out);
    return -Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)) / DEG;
  }
  /** 画面の傾き(ロール, 度)。0=水平 */
  getRollDeg() {
    _v.set(1, 0, 0).applyQuaternion(this._out);
    return Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)) / DEG;
  }
}
