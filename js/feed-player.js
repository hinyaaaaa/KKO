/* ============================================================
   js/feed-player.js — 録った映像+センサーを、本番の入力として再生する
   ------------------------------------------------------------
   使い方: index.html?feed=feeds/walk01  (feeds/walk01.mp4 と walk01.json)
   <video> に録画映像を流し、映像の再生位置に合わせて、録ったセンサー値を
   sensor-hub へ流し込む。アプリ側は実機と同じコードのまま動く。
   ============================================================ */
import { emitOrientation, emitMotion } from './sensor-hub.js';

export class FeedPlayer {
  /** @param {HTMLVideoElement} video @param {string} base 拡張子なしのパス */
  constructor(video, base) { this.video = video; this.base = base; this.meta = null; this.i = 0; this.lastT = -1; this._raf = 0; this.latencyMs = 0; }

  async start() {
    const metaRes = await fetch(`${this.base}.json`);
    if (!metaRes.ok) throw new Error(`feed meta not found: ${this.base}.json`);
    this.meta = await metaRes.json();
    const v = this.video;
    v.srcObject = null;
    v.src = `${this.base}.${this.meta.ext || 'mp4'}`;
    v.loop = true; v.muted = true; v.playsInline = true;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('feed video load error')); });
    await v.play().catch(() => {});
    const tick = () => { this._pump(); this._raf = requestAnimationFrame(tick); };
    tick();
  }
  stop() { cancelAnimationFrame(this._raf); }

  getScreenAngle() { return this.meta ? this.meta.screenAngle || 0 : 0; }

  /** 指定時刻(ms)へ飛んで、その時点までのセンサー値を流す(決定的な撮影用) */
  async seek(tMs) {
    const v = this.video;
    v.pause();
    await new Promise((res) => { v.onseeked = res; v.currentTime = Math.max(0, tMs / 1000); });
    this.i = 0; this.lastT = -1;
    this._pump(true);
  }

  _pump(force) {
    const s = this.meta.sensors; if (!s.length) return;
    const t = this.video.currentTime * 1000 - this.latencyMs;
    if (t < this.lastT - 200) this.i = 0;   // ループして巻き戻った
    this.lastT = t;
    while (this.i < s.length && s[this.i].t <= t) {
      const e = s[this.i++];
      if (e.k === 'o') emitOrientation({ alpha: e.a, beta: e.b, gamma: e.g, webkitCompassHeading: e.h ?? undefined });
      else emitMotion({ rotationRate: { alpha: e.r[0], beta: e.r[1], gamma: e.r[2] } });
    }
  }
}
