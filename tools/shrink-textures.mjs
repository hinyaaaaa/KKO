// tools/shrink-textures.mjs — モデルのテクスチャを、ファイル名を保ったまま縮小する(Node版・Python不要)
// 2048pxを超えるPNGだけを2048pxへ縮小する。縮小は透明部分の縁が滲まないよう、アルファを考慮して行う。
// 使い方: node tools/shrink-textures.mjs <フォルダ> [--max 2048] [--dry-run]
//   例: node tools/shrink-textures.mjs assets
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--'));
if (!root) { console.error('usage: node tools/shrink-textures.mjs <dir> [--max 2048] [--dry-run]'); process.exit(2); }
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 2048;
const dry = args.includes('--dry-run');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

let before = 0, after = 0;
for (const f of walk(root)) {
  if (!f.toLowerCase().endsWith('.png')) continue;
  const buf = fs.readFileSync(f);
  before += buf.length;
  const meta = await sharp(buf).metadata();
  if (Math.max(meta.width, meta.height) <= MAX) { after += buf.length; continue; }
  if (dry) { console.log(`would shrink ${f} (${meta.width}x${meta.height})`); after += buf.length; continue; }
  const out = await sharp(buf)
    .resize({ width: MAX, height: MAX, fit: 'inside', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(f, out);
  after += out.length;
  console.log(`${f}: ${meta.width}x${meta.height} → ${(await sharp(out).metadata()).width}px, ${(buf.length / 1024) | 0}KB → ${(out.length / 1024) | 0}KB`);
}
console.log(`total ${(before / 1024) | 0}KB → ${(after / 1024) | 0}KB`);
