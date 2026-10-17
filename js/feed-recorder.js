/* ============================================================
   js/feed-recorder.js — 実機の「映像+センサー」を録る(?rec で有効)
   ------------------------------------------------------------
   iPhoneで撮った素材を、PCで ?feed=<名前> として再生するための記録。
   出力: <名前>.mp4(またはwebm) と <名前>.json(センサー・端末情報)。
   共有シートでPCへ送る(AirDrop/ファイル)。
   ============================================================ */
import { onOrientation, onMotion, getScreenAngle } from './sensor-hub.js';

const DEFAULT_MIMES = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
function pickMime(list) {
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

export class FeedRecorder {
  constructor({ mimes } = {}) { this.mimes = mimes || DEFAULT_MIMES; this.rec = null; this.samples = []; this.t0 = 0; this.chunks = []; this.mime = ''; this._offs = []; }

  isRecording() { return !!this.rec; }

  start(stream, extraMeta = {}) {
    if (this.rec) return false;
    this.mime = pickMime(this.mimes);
    if (!this.mime) throw new Error('この端末は録画(MediaRecorder)に対応していません');
    this.samples = []; this.chunks = []; this.extra = extraMeta;
    this.rec = new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.t0 = performance.now();
    this.rec.start(1000);
    this._offs = [
      onOrientation((e) => this.samples.push({ t: Math.round(performance.now() - this.t0), k: 'o', a: e.alpha, b: e.beta, g: e.gamma, h: e.webkitCompassHeading ?? null })),
      onMotion((e) => this.samples.push({ t: Math.round(performance.now() - this.t0), k: 'm', r: [e.rotationRate.alpha, e.rotationRate.beta, e.rotationRate.gamma] })),
    ];
    return true;
  }

  /** @returns {Promise<{video: Blob, meta: object, ext: string}>} */
  stop(getAppState) {
    return new Promise((resolve) => {
      const rec = this.rec;
      this._offs.forEach((f) => f()); this._offs = [];
      rec.onstop = () => {
        const ext = this.mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        const meta = {
          version: 1, ext, mime: this.mime, durationMs: Math.round(performance.now() - this.t0),
          screenAngle: getScreenAngle(), ua: navigator.userAgent, dpr: window.devicePixelRatio,
          app: getAppState ? getAppState() : null, ...this.extra, sensors: this.samples,
        };
        this.rec = null;
        resolve({ video: new Blob(this.chunks, { type: this.mime }), meta, ext });
      };
      rec.stop();
    });
  }
}

/** 録った2ファイルを共有シート(なければダウンロード)で出す */
export async function shareFeed({ video, meta, ext }, name) {
  const files = [
    new File([video], `${name}.${ext}`, { type: video.type }),
    new File([JSON.stringify(meta)], `${name}.json`, { type: 'application/json' }),
  ];
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  for (const f of files) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  return 'downloaded';
}
