/* ============================================================
   js/device-check.js — 実機チェックのオーバーレイ(?check で有効)
   ------------------------------------------------------------
   iPhoneで「通す」ための確認表。上から順に、いまの状態を ✓/✗/… で出す。
   「結果をコピー」で文章にして貼れる(Claudeに渡せば、原因の切り分けに使える)。
   ============================================================ */
import { all } from './check-log.js';
import { listModels } from './model-store.js';
import { onOrientation } from './sensor-hub.js';

const fmtMB = (b) => (b / 1048576).toFixed(1) + 'MB';

export function initDeviceCheck({ getFps, getRenderInfo }) {
  const box = document.createElement('div');
  box.id = 'device-check';
  box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 8px);z-index:10000;max-height:46vh;overflow:auto;background:rgba(0,0,0,.82);color:#fff;font:12px/1.5 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:10px;white-space:pre-wrap';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:8px;margin-bottom:4px';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = '結果をコピー';
  const hideBtn = document.createElement('button');
  hideBtn.textContent = '閉じる';
  [copyBtn, hideBtn].forEach((b) => { b.style.cssText = 'font:600 12px system-ui;padding:4px 10px;border-radius:999px;border:0;background:#ffc83d;color:#000'; head.appendChild(b); });
  const body = document.createElement('div');
  box.append(head, body);
  document.body.appendChild(box);
  hideBtn.onclick = () => box.remove();

  let sensorHz = null; let oCount = 0; let t0 = performance.now();
  onOrientation(() => { oCount++; });   // 実機でもリプレイでも、本番と同じ入口で数える

  async function lines() {
    const L = all(); const out = [];
    const row = (state, label, detail = '') => out.push(`${state} ${label}${detail ? ' — ' + detail : ''}`);

    // 保存領域
    try {
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      row(persisted ? '✓' : '△', '保存データが消えにくい設定', persisted === null ? '判定不可' : persisted ? '永続化済み' : '未永続化(Safariの容量逼迫時に消える可能性。ホーム画面に追加すると改善)');
      if (est) row('·', '使用量', `${fmtMB(est.usage || 0)} / 上限目安 ${fmtMB(est.quota || 0)}`);
    } catch (e) { row('✗', '保存領域の確認', String(e.message || e)); }

    // 取り込み済みモデル
    try {
      const ms = await listModels();
      row(ms.length ? '✓' : '…', '取り込み済みモデル', ms.length ? ms.map((m) => `${m.id}(${fmtMB(m.totalBytes)}, ${m.fileCount}ファイル)`).join(' / ') : 'まだありません');
    } catch (e) { row('✗', 'モデル保管庫を開く', String(e.message || e)); }

    // 取り込みの重さ
    const imp = L.import;
    if (imp) row(imp.ms > 60000 ? '△' : '✓', 'モデル取り込み', `${(imp.ms / 1000).toFixed(1)}秒 / テクスチャ${imp.textures}枚 / 最大1枚${imp.maxTexMs}ms / ${fmtMB(imp.originalBytes)}→${fmtMB(imp.totalBytes)}`);
    else row('…', 'モデル取り込み', 'この起動では未実施(取り込むと計測されます)');
    if (L.modelLoadMs != null) row(L.modelLoadMs > 15000 ? '△' : '✓', 'モデル読み込み(描画準備)', `${(L.modelLoadMs / 1000).toFixed(1)}秒`);

    // 許可・カメラ・センサー
    row(L.camera ? (L.camera.ok ? '✓' : '✗') : '…', 'カメラ', L.camera ? (L.camera.ok ? `${L.camera.w}x${L.camera.h} / 起動${L.camera.ms}ms` : L.camera.error) : '未起動');
    row(L.orientationPermission === undefined ? '…' : L.orientationPermission ? '✓' : '✗', '向きセンサーの許可', L.orientationPermission === undefined ? '未確認' : L.orientationPermission ? '許可済み' : '拒否(設定→Safari→モーションと画面の向き)');
    const dt = (performance.now() - t0) / 1000;
    if (dt > 2) { sensorHz = oCount / dt; }
    row(sensorHz == null ? '…' : sensorHz > 20 ? '✓' : '✗', 'センサー受信', sensorHz == null ? '計測中' : `${sensorHz.toFixed(0)}回/秒`);
    if (L.tracking) row(L.tracking.active ? '✓' : '✗', '姿勢追従', L.tracking.active ? `俯角 ${L.tracking.pitch.toFixed(0)}°` : '無効(センサー無し or ?track=0)');

    // 描画
    const fps = getFps();
    const info = getRenderInfo();
    row(fps == null ? '…' : fps >= 24 ? '✓' : '△', '描画fps', fps == null ? '計測中' : `${fps.toFixed(0)}fps`);
    row('·', '描画設定', `${info.buffer} / 色調補正${info.cm ? 'ON' : 'OFF'} / 床反射${info.refl ? 'ON' : 'OFF'}`);

    // 撮影・保存・共有
    if (L.capture) row(L.capture.ok ? '✓' : '✗', '撮影', L.capture.ok ? `${L.capture.ms}ms / ${(L.capture.bytes / 1024).toFixed(0)}KB` : L.capture.error);
    else row('…', '撮影', 'まだ撮っていません');
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }));
    row(canShareFiles ? '✓' : '△', '共有シートで画像を保存', canShareFiles ? '対応' : '非対応(長押し保存になります)');
    row(window.MediaRecorder ? '✓' : '△', '動画の録画', window.MediaRecorder ? 'MediaRecorderあり' : '非対応');
    if (L.lastError) row('✗', '直近のエラー', L.lastError);
    out.push(`\nUA: ${navigator.userAgent}`);
    return out;
  }

  async function refresh() { body.textContent = (await lines()).join('\n'); }
  copyBtn.onclick = async () => {
    const text = `KKO 実機チェック ${new Date().toISOString()}\n` + (await lines()).join('\n');
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'コピーしました'; } catch { body.textContent = text; copyBtn.textContent = '下の文を選んでコピー'; }
    setTimeout(() => { copyBtn.textContent = '結果をコピー'; }, 2000);
  };
  refresh(); setInterval(refresh, 1500);
}
