/* ============================================================
   js/zip-reader.js — 依存ゼロの最小ZIPリーダー
   ------------------------------------------------------------
   ユーザーが端末内から選んだモデルzipを、ブラウザ内で展開するために使う。
   - 対応: 無圧縮(stored)と deflate。暗号化・zip64は非対応(明示エラー)。
   - 展開は標準の DecompressionStream('deflate-raw') を使う(iOS 16.4+ / 最新ブラウザ / Node18+)。
   - ファイル名: UTF-8として厳密にデコードでき(またはUTF-8フラグあり)ればUTF-8、
     そうでなければ Shift_JIS として読む(WindowsのエクスプローラーのZIP対策)。
   ============================================================ */

const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024 * 1024; // 展開後の総量の上限(zip爆弾対策)
const MAX_ENTRY_BYTES = 300 * 1024 * 1024;

function decodeName(bytes, utf8Flag) {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder('shift_jis').decode(bytes); }
    catch { return new TextDecoder('utf-8').decode(bytes); }
  }
}

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

/**
 * @param {ArrayBuffer} buffer ZIP全体
 * @returns {{name: string, size: number, read: () => Promise<ArrayBuffer>}[]}
 */
export function readZip(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // 末尾から End of Central Directory(0x06054b50)を探す
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIPファイルとして読めませんでした');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('zip64形式には対応していません');
  }

  const entries = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIPの目次が壊れています');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = decodeName(u8.subarray(p + 46, p + 46 + nameLen), !!(flags & 0x800));
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // ディレクトリ
    if (flags & 1) throw new Error('パスワード付きZIPには対応していません');
    if (size > MAX_ENTRY_BYTES) throw new Error(`ファイルが大きすぎます: ${name}`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('ZIPの展開後サイズが大きすぎます');

    entries.push({
      name,
      size,
      async read() {
        if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`ZIPが壊れています: ${name}`);
        const lnLen = dv.getUint16(localOffset + 26, true);
        const leLen = dv.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + lnLen + leLen;
        const raw = u8.subarray(start, start + compSize);
        if (method === 0) return raw.slice().buffer;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`未対応の圧縮方式です(${method}): ${name}`);
      },
    });
  }
  return entries;
}
