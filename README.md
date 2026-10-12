# KKO

推しが「そこにいる」と感じられる、iPhone向けのARカメラ(Webアプリ)。カメラ映像にキャラクターを合成して、写真や動画を撮れる。個人のファン活動として作っており、**公式のものではない**。

- ビルド不要(three.js + MMDLoader)。静的ファイルを配信するだけで動く。
- キャラクターのモデルは**このリポジトリに含まれない**。利用者が自分で入手したPMXモデルを、端末内に取り込んで使う(外部へは送信されない)。→ [docs/model-import.md](docs/model-import.md)
- 開発方針: [docs/](docs/) と、方針書(別途)を参照。

## 開発
```
npm install
node tools/capture.mjs jobs/sample.json out      # ヘッドレス撮影(要: ローカルの assets/<キャラ>/)
node tools/test-model-import.mjs kanata kanata.zip   # 取り込み経路の通し検証
node tools/inspect-pmx.mjs model.zip --bones --morphs   # モデルのボーン名・モーフ名を調べる
```
詳細: [docs/dev-api.md](docs/dev-api.md)

## 権利について
- 非営利のファン活動の範囲で運営する。収益化はしない。公式を名乗らない。
- モデルは、それぞれの配布元の利用規約に従って、利用者自身の責任で使う。リポジトリには含めない(`assets/` は `.gitignore` 対象)。
