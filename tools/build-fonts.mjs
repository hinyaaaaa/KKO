// tools/build-fonts.mjs — 見出し用フォント(Dela Gothic One)から、アプリで使う文字だけを取り出して同梱する
// 使い方: node tools/build-fonts.mjs
//   元のTTF(約2.5MB)は fonts/src/ に置く(gitには入れない)。無ければ配布元から自動で取得する。
//   出力: fonts/dela-gothic-one-subset.woff2(数十KB)。キャラを追加して名前の文字が増えたら、再実行する。
// ライセンス: SIL Open Font License 1.1(fonts/OFL.txt)。再配布・サブセット化は許可されている。
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';
import { REPO_ROOT } from './static-server.mjs';
import { CHARACTERS } from '../js/characters-data.js';

const SRC = path.join(REPO_ROOT, 'fonts/src/DelaGothicOne-Regular.ttf');
const OUT = path.join(REPO_ROOT, 'fonts/dela-gothic-one-subset.woff2');
const URL_SRC = 'https://raw.githubusercontent.com/google/fonts/main/ofl/delagothicone/DelaGothicOne-Regular.ttf';

if (!fs.existsSync(SRC)) {
  fs.mkdirSync(path.dirname(SRC), { recursive: true });
  const res = await fetch(URL_SRC);
  if (!res.ok) throw new Error(`フォントを取得できませんでした: ${res.status}`);
  fs.writeFileSync(SRC, Buffer.from(await res.arrayBuffer()));
}

// 使う文字: 基本のラテン文字・数字・記号、ひらがな、カタカナ、+ 画面とデータに出てくる漢字
let text = '';
for (let c = 0x20; c <= 0x7e; c++) text += String.fromCharCode(c);
for (let c = 0x3041; c <= 0x3096; c++) text += String.fromCharCode(c);
for (let c = 0x30a1; c <= 0x30fa; c++) text += String.fromCharCode(c);
text += 'ー、。・「」…';
for (const f of ['index.html', 'js/credits.js', 'js/model-import-ui.js']) {
  text += fs.readFileSync(path.join(REPO_ROOT, f), 'utf-8');
}
for (const c of CHARACTERS) text += (c.nameLines || [c.name]).join('') + c.name + (c.short || '');

const kanji = [...new Set([...text].filter((ch) => /[\u4e00-\u9fff]/.test(ch)))].join('');
const chars = [...new Set([...text].filter((ch) => /[\u0020-\u007e\u3040-\u30ff\u4e00-\u9fff、。・「」…ー]/.test(ch)))].join('');
const buf = await subsetFont(fs.readFileSync(SRC), chars, { targetFormat: 'woff2' });
fs.writeFileSync(OUT, buf);
console.log(`漢字 ${kanji.length}字を含む計${chars.length}字 → ${path.relative(REPO_ROOT, OUT)} (${(buf.length / 1024).toFixed(0)}KB)`);
