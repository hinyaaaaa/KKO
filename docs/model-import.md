# モデルの端末内取り込み

モデル本体(PMX+テクスチャ)はリポジトリに含めない。ユーザーが自分のモデルを端末に取り込み、ブラウザ内(IndexedDB)にだけ保存する。外部へは送信しない。

## 使う側の流れ(iPhone)
1. モデルを zip にしてiPhoneの「ファイル」アプリに入れる(下の「zipの作り方」)。
2. アプリでキャラを選ぶ → 「モデルを取り込む」ダイアログが出る → 「ファイルを選ぶ」でzipを選ぶ。
3. 取り込み後は自動で読み込まれる。次回からは取り込み不要(端末内に残る)。

**注意**: iOS Safariは、しばらく使わないサイトの保存データを消すことがある。**ホーム画面に追加して使う**と、この消去の対象から外れる。消えた場合は、もう一度取り込めばよい。

## zipの作り方(Windows / PowerShell)
```powershell
# 先に縮小しておくと、zipが小さく読み込みも速い(任意)
node tools/shrink-textures.mjs assets

Compress-Archive -Path assets\kanata\* -DestinationPath kanata.zip -Force
Compress-Archive -Path assets\kanade\* -DestinationPath kanade.zip -Force
```
- zipの中身は「PMXファイル+テクスチャ画像(サブフォルダ可)」。ラッパーフォルダが1段あっても構わない。
- 1つのzipに入れるのは1キャラ分。複数のPMXが入っている場合(kanadeの「リコーダー.pmx」など)は、`js/characters-data.js` の `model.pmx` に書いた名前のものを使う。
- zipの代わりに、PMXとテクスチャ画像を**まとめて選択**しても取り込める(フォルダ構成は失われるが、ファイル名で解決する)。
- 対応: PMX形式のみ。パスワード付きzip・zip64は非対応。ファイル名はUTF-8とShift_JISの両方に対応。

## 仕組み
| ファイル | 役割 |
|---|---|
| `js/zip-reader.js` | 依存ゼロのZIPリーダー(`DecompressionStream`使用) |
| `js/model-import.js` | zip/複数ファイル → PMXを特定 → 相対パスにそろえて保存 |
| `js/model-store.js` | IndexedDBの保管庫(1ファイル1レコード) |
| `js/model-source.js` | MMDLoaderへの供給。仮想URL+`LoadingManager.setURLModifier`でblob URLへ差し替え |
| `js/model-import-ui.js` / `model-import.css` | 取り込みダイアログ |

読み込みの優先順位: 端末内に取り込み済み → `devPath`(開発用ローカル。`?nodev`で無効) → 未導入(ダイアログを表示)。

## 開発時
- `assets/kanata/`・`assets/kanade/` は `.gitignore` 対象。ローカルに置いておけば、dev.htmlとヘッドレス撮影は従来どおり動く(`devPath`)。
- 取り込み経路の通し検証: `node tools/test-model-import.mjs kanata kanata.zip`
  (未導入→ダイアログ→ファイル選択→保存→再読み込み後も残る→ローカル読み込みと同じ絵、を確認する)
- コンソールから: `await KkoDev.installModel('kanata', arrayBuffer)`

## リポジトリからモデルを外す手順(あなたが実行)
```powershell
git rm -r --cached assets/kanata assets/kanade
git commit -m "モデルをリポジトリから外す(端末内取り込み方式へ)"
git push
```
**注意**: これだけでは、過去のコミット履歴にモデルが残る。公開を止めるには、リポジトリを非公開にするか、履歴から消す(`git filter-repo`、強制pushが必要)。
