/* ============================================================
   js/texture-optimize.js — 取り込み時のテクスチャ最適化(端末内で実行)
   ------------------------------------------------------------
   公式配布モデルには 4096×4096 の無圧縮TGA(1枚64MB)が含まれることがある。
   そのままだとiPhoneでは展開・転送が重く、メモリも圧迫する。取り込み時に:
     - TGA → PNG へ変換する(以降のMMDLoaderは .tga の要求にPNGを返す。model-source.js)
     - 最大辺が maxSize(既定2048)を超える画像は、整数倍の縮小(ボックス平均)をかける
   ポイント:
     - 縮小は「アルファで重み付けした平均」。透明に近い画素の色(髪の縁など)が黒く混ざらない。
     - PNGは自前でエンコードする(canvas経由だと、透明部分の色が失われて縁が暗くなるため)。
       圧縮は標準の CompressionStream('deflate') を使う。
     - 変換できないものは元のまま保存する(PNG/JPGで、透明を含む大きな画像など)。
   元ファイルには手を加えない(ユーザーが選んだzipは、そのまま残る)。
   ============================================================ */

/* ---------------- TGA ---------------- */

/** @returns {{w: number, h: number, rgba: Uint8Array}} 上から下の順(見た目どおり)のRGBA */
export function decodeTga(buffer) {
  const u8 = new Uint8Array(buffer);
  const idLen = u8[0], cmType = u8[1], type = u8[2];
  const w = u8[12] | (u8[13] << 8), h = u8[14] | (u8[15] << 8);
  const bpp = u8[16], desc = u8[17];
  if (cmType !== 0 || (type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32) || !w || !h) {
    throw new Error(`未対応のTGA形式です(type ${type}, ${bpp}bit)`);
  }
  const bytes = bpp >> 3;
  const topOrigin = !!(desc & 0x20), rightOrigin = !!(desc & 0x10);
  const hasAlpha = bpp === 32;
  const out = new Uint8Array(w * h * 4);
  let p = 18 + idLen;
  let n = 0; // 格納順の画素番号
  const total = w * h;

  const put = (b, g, r, a) => {
    const sy = (n / w) | 0, sx = n - sy * w;
    const dy = topOrigin ? sy : h - 1 - sy;
    const dx = rightOrigin ? w - 1 - sx : sx;
    const o = (dy * w + dx) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    n++;
  };

  if (type === 2) {
    for (; n < total;) {
      put(u8[p], u8[p + 1], u8[p + 2], hasAlpha ? u8[p + 3] : 255);
      p += bytes;
    }
  } else {
    while (n < total) {
      const head = u8[p++];
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {
        const b = u8[p], g = u8[p + 1], r = u8[p + 2], a = hasAlpha ? u8[p + 3] : 255;
        p += bytes;
        for (let i = 0; i < count && n < total; i++) put(b, g, r, a);
      } else {
        for (let i = 0; i < count && n < total; i++) {
          put(u8[p], u8[p + 1], u8[p + 2], hasAlpha ? u8[p + 3] : 255);
          p += bytes;
        }
      }
    }
  }
  return { w, h, rgba: out };
}

/* ---------------- 縮小(アルファ重み付きボックス平均) ---------------- */

export function downscale(rgba, w, h, f) {
  const nw = Math.floor(w / f), nh = Math.floor(h / f);
  const out = new Uint8Array(nw * nh * 4);
  const area = f * f;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0, ur = 0, ug = 0, ub = 0;
      for (let j = 0; j < f; j++) {
        let i = (((y * f + j) * w) + x * f) * 4;
        for (let k = 0; k < f; k++, i += 4) {
          const a = rgba[i + 3];
          sr += rgba[i] * a; sg += rgba[i + 1] * a; sb += rgba[i + 2] * a; sa += a;
          ur += rgba[i]; ug += rgba[i + 1]; ub += rgba[i + 2];
        }
      }
      const o = (y * nw + x) * 4;
      if (sa > 0) { out[o] = sr / sa; out[o + 1] = sg / sa; out[o + 2] = sb / sa; }
      else { out[o] = ur / area; out[o + 1] = ug / area; out[o + 2] = ub / area; } // 完全に透明: 色だけ普通に平均
      out[o + 3] = sa / area;
    }
  }
  return { w: nw, h: nh, rgba: out };
}

/* ---------------- PNG ---------------- */

let crcTable = null;
function crc32(u8) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 全画素が不透明か */
export function isOpaque(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

/** RGBA → PNG(不透明ならRGB 24bitで保存して小さくする)。Subフィルタ付き */
export async function encodePng(rgba, w, h) {
  const opaque = isOpaque(rgba);
  const bpp = opaque ? 3 : 4;
  const stride = w * bpp;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const ro = y * (stride + 1);
    raw[ro] = 1; // filter: Sub
    let prev0 = 0, prev1 = 0, prev2 = 0, prev3 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = ro + 1 + x * bpp;
      raw[o] = (rgba[i] - prev0) & 255;
      raw[o + 1] = (rgba[i + 1] - prev1) & 255;
      raw[o + 2] = (rgba[i + 2] - prev2) & 255;
      prev0 = rgba[i]; prev1 = rgba[i + 1]; prev2 = rgba[i + 2];
      if (!opaque) { raw[o + 3] = (rgba[i + 3] - prev3) & 255; prev3 = rgba[i + 3]; }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; // 8bit, RGB or RGBA
  const idat = await deflate(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

/* ---------------- 画像(PNG/JPG等)のデコード: canvas経由 ---------------- */

async function decodeWithCanvas(buffer, mime) {
  const bmp = await createImageBitmap(new Blob([buffer], { type: mime }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const id = g.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close && bmp.close();
  return { w: id.width, h: id.height, rgba: new Uint8Array(id.data.buffer) };
}

/* ---------------- 入口 ---------------- */

const ext = (p) => (p.split('.').pop() || '').toLowerCase();
const factorFor = (w, h, max) => Math.max(1, Math.ceil(Math.max(w, h) / max));

/**
 * @param {string} path
 * @param {ArrayBuffer} data
 * @param {number} maxSize
 * @returns {Promise<{data: ArrayBuffer, mime?: string, converted?: boolean, note?: string}>}
 *   converted: 元の拡張子と中身が違う(tga → png)。note: 変換・縮小の内容(進捗表示用)
 */
export async function optimizeTexture(path, data, maxSize = 2048) {
  const e = ext(path);
  if (e === 'tga') {
    const t = decodeTga(data); // 失敗したらエラーのまま(取り込み側でユーザーに伝える)
    const f = factorFor(t.w, t.h, maxSize);
    const r = f > 1 ? downscale(t.rgba, t.w, t.h, f) : t;
    return { data: await encodePng(r.rgba, r.w, r.h), mime: 'image/png', converted: true, note: `${t.w}px→${r.w}px` };
  }
  if (e === 'png' || e === 'jpg' || e === 'jpeg') {
    // 先にヘッダだけで大きさを知りたいが、簡単のためPNGはIHDRを読む
    if (e === 'png') {
      const dv = new DataView(data);
      const w = dv.getUint32(16), h = dv.getUint32(20);
      if (Math.max(w, h) <= maxSize) return { data };
    }
    try {
      const t = await decodeWithCanvas(data, e === 'png' ? 'image/png' : 'image/jpeg');
      if (Math.max(t.w, t.h) <= maxSize) return { data };
      // 透明を含む画像は、canvas経由だと透明部分の色が失われるので、縮小せずそのまま使う
      if (!isOpaque(t.rgba)) return { data, note: '透明あり・縮小せず' };
      const f = factorFor(t.w, t.h, maxSize);
      const r = downscale(t.rgba, t.w, t.h, f);
      return { data: await encodePng(r.rgba, r.w, r.h), mime: 'image/png', note: `${t.w}px→${r.w}px` };
    } catch {
      return { data }; // 変換に失敗したら元のまま
    }
  }
  return { data };
}
