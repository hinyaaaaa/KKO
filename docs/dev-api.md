# dev操作API(window.KkoDev)とヘッドレス撮影 — Phase 0

dev.html を、スクリプト/AIから決まった入力で操作し、**同じ入力から同じ絵**を出せるようにする仕組み。

## 使い方(ヘッドレス撮影)

```
npm install
node tools/capture.mjs jobs/sample.json out
```

- PCのChrome(なければEdge)をそのまま使う。追加のブラウザは不要。
- three.js は `node_modules/three`(0.160.0)を使うので、オフラインでも動く。
- `out/` に `<name>.png`(合成画像)と `<name>.json`(再現用state)が出る。
- 別のブラウザを使うなら `set KKO_BROWSER=C:\path\to\chrome.exe`。

## ジョブJSON

`jobs/sample.json` を参照。`shots[].state` に書けるキー:

| キー | 内容 |
|---|---|
| character | `kanata` / `kanade` |
| pose, expression | characters-data.js のキー |
| bones | `{"右腕":[x,y,z]}` 度。既存ポーズ定義と同じ空間 |
| globalOffset | `{"bodyYaw":10,"headRoll":-5}` |
| placement | `{x,z,rotY,scale}` |
| cameraPhone | `{heightM,distanceM,pitchDeg,fov,azimuthDeg}` スマホ撮影の再現(pitchDeg>0で見下ろし) |
| cameraOrbit | `{distance,azimuthDeg,elevationDeg,target,fov}` |
| camera | `{position,target,fov}` 直接指定 |
| environment | `{date,solarHour,latDeg,biome}` |
| grade | CSSフィルタ文字列(キャラのみ) |
| grid | 床グリッドの表示 |
| background | (ジョブ直下の `shots[].background` に画像パスを書く) |

`capture` オプション: `settleSec`(既定1.0)、`seed`(既定1)、`blink`(既定false)、`layers`(trueで `.bg.png` / `.char.png` も出力)。

## ブラウザのコンソールから

`dev.html?clean` を開き、F12コンソールで:

```js
await KkoDev.ready();
await KkoDev.applyState({ character: 'kanata', pose: 'standing',
  cameraPhone: { heightM: 1.6, distanceM: 2, pitchDeg: 25 } });
const r = await KkoDev.capture({ layers: true });
```

`KkoDev.state()` で今の状態をJSONで取り出せる。

## 再現性

- 撮影時はアニメを停止し、固定dt(1/60)で決まったフレーム数だけ進める。
- まばたきは既定で止める。乱数はシード固定。
- `?clean` を付けると、ポーズ調整のlocalStorage自動保存を復元しない。

## 既知の制限

- 本番(index.html/main.js)の描画経路とは別。devで見えるのは「描画コア+キャラ」まで。共有化はPhase 0の次の作業。
- ヘッドレスのGPU(PCのGPU or ソフトウェア描画)は、iPhoneのGPUと完全には一致しない。最終確認は実機で行う。

## テクスチャ縮小(Phase 0)

`node tools/shrink-textures.mjs assets` — 2048pxを超えるPNGだけを、ファイル名を保ったまま2048pxへ縮小する。
実測: 約29.7MB → 約14.4MB。縮小前後で同じジョブを撮影して比較し、画面上の差はほぼゼロ(平均差0.001/255)を確認済み。

## Linux/コンテナでの実行例

`KKO_BROWSER=/path/to/chrome KKO_BROWSER_ARGS="--no-sandbox --use-gl=angle --use-angle=swiftshader" node tools/capture.mjs jobs/sample.json out`
