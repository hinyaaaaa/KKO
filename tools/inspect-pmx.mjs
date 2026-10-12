// tools/inspect-pmx.mjs — PMXモデルの中身(ボーン名・モーフ名・大きさ・テクスチャ)を一覧する
// キャラを追加するとき、ポーズ/表情の定義に使う名前をモデルごとに確かめるためのツール。
// 使い方: node tools/inspect-pmx.mjs <モデル.pmx または モデル.zip> [--bones] [--morphs] [--textures]
//   オプションなしなら概要だけ。zipを渡すと、その中のPMXを調べる(PowerShellで作ったzipもOK)。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MMDParser } from 'three/examples/jsm/libs/mmdparser.module.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/inspect-pmx.mjs <model.pmx|model.zip> [--bones] [--morphs] [--textures]'); process.exit(2); }
const want = (k) => args.includes(`--${k}`);

/** zipから最初のPMXを取り出す(名前はUTF-8/Shift_JIS両対応) */
function pmxFromZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zipとして読めません');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const found = [];
  for (let k = 0; k < n; k++) {
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nameBytes = buf.subarray(p + 46, p + 46 + nl);
    let name; try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch { name = new TextDecoder('shift_jis').decode(nameBytes); }
    p += 46 + nl + el + cl;
    if (!name.toLowerCase().endsWith('.pmx')) continue;
    const ln = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28), start = off + 30 + ln + le;
    const raw = buf.subarray(start, start + cs);
    found.push({ name, data: method === 0 ? raw : zlib.inflateRawSync(raw) });
  }
  if (!found.length) throw new Error('zip内にPMXがありません');
  if (found.length > 1) console.log(`PMXが${found.length}個あります: ${found.map((f) => f.name).join(', ')}(最初のものを調べます)`);
  return found[0];
}

const raw = fs.readFileSync(file);
const { name, data } = file.toLowerCase().endsWith('.zip') ? pmxFromZip(raw) : { name: path.basename(file), data: raw };
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const pmx = new MMDParser.Parser().parsePmx(ab, true);

// モデルの大きさ(頂点の外接ボックス)
let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
for (const v of pmx.vertices) {
  const [x, y] = v.position;
  if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
}
const H = maxY - minY;
console.log(`ファイル: ${name}`);
console.log(`モデル名: ${pmx.metadata.modelName} / 英名: ${pmx.metadata.englishModelName || '-'}`);
console.log(`PMX ${pmx.metadata.version} / 頂点 ${pmx.metadata.vertexCount} / 材質 ${pmx.metadata.materialCount} / ボーン ${pmx.metadata.boneCount} / モーフ ${pmx.metadata.morphCount} / テクスチャ ${pmx.metadata.textureCount}`);
console.log(`高さ(モデル単位): ${H.toFixed(2)}(Y ${minY.toFixed(2)} 〜 ${maxY.toFixed(2)})。幅 ${(maxX - minX).toFixed(2)}`);
console.log(`→ unitToMeter=0.081 のとき約 ${(H * 0.081).toFixed(3)} m(身長に合わせて unitToMeter を調整する目安)`);
const bones = pmx.bones.map((b) => b.name);
const morphs = pmx.morphs.map((m) => `${m.name}(${['グループ', '頂点', 'ボーン', 'UV', 'UV1', 'UV2', 'UV3', 'UV4', '材質'][m.type] || m.type})`);
const tex = pmx.textures;
// 既存キャラのポーズ/表情が使う代表的な名前が、このモデルにあるか
const need = ['下半身', '上半身', '上半身2', '首', '頭', '左肩', '右肩', '左腕', '右腕', '左ひじ', '右ひじ', '左手首', '右手首', '左足', '右足', '左ひざ', '右ひざ', '左足首', '右足首'];
const missingBones = need.filter((n) => !bones.includes(n));
console.log(missingBones.length ? `標準ボーンで見つからないもの: ${missingBones.join(', ')}` : '標準ボーン(腕・脚・首など)は全部あります');
const exprNeed = ['まばたき', 'にこり', '笑い', 'ウィンク', 'ウインク', 'びっくり', '困る', '困り', 'じと目', 'ジト目', '口角上げ', 'あ', 'う', '上'];
const mn = pmx.morphs.map((m) => m.name);
console.log('表情モーフ(既存定義が使う名前)の有無: ' + exprNeed.map((n) => `${n}${mn.includes(n) ? '○' : '×'}`).join(' '));
if (want('bones')) console.log('\n[ボーン]\n' + bones.join('\n'));
if (want('morphs')) console.log('\n[モーフ]\n' + morphs.join('\n'));
if (want('textures')) console.log('\n[テクスチャ]\n' + tex.join('\n'));
