# 実機の映像+動きを、PCで再生する(Phase 1)

本番(index.html)と**同じコード**のまま、入力(カメラ映像・センサー)だけを録画に差し替える。
dev.html を別経路で調整する代わりに、実機で起きた見た目をPCでそのまま再現して直せる。

## 実機で録る(iPhone)
1. `https://<公開URL>/index.html?rec` を開く(通常どおり許可→推しを選ぶ)
2. 左上の「● 素材を録る」→ 歩いたり傾けたりして撮る →「■ 止めて保存」
3. 共有シートで、`feed-….mp4` と `feed-….json` の**2つ**をPCへ送る(AirDrop等)

## PCで再生する
`feeds/` に2つを置き(`.gitignore` 済み)、次を開く(`npm run serve`):

`http://localhost:<port>/index.html?feed=feeds/feed-20261016-101500`

- 許可ダイアログは出ない。映像はループ再生され、録ったセンサー値が映像と同期して流れる。
- 録画時のキャラ・配置・俯角は `.json` の `app` に入っている。

## 実機チェック(?check)
`index.html?check` を開くと、画面下に確認表が出る。保存の永続化・取り込み時間・カメラ・センサー受信・fps・撮影・共有の可否を順に見られる。「結果をコピー」で貼り付け用の文になる。

## スイッチ(トラブル時の逃げ道)
| URL | 効果 |
|---|---|
| `?track=0` | 姿勢追従を切る(従来の固定カメラ) |
| `?cm=0` | 色調補正を切る |
| `?refl=0` | 床反射を切る |
| `?gaze=1` | 顔をカメラへ向ける(既定OFF。向きが逆なら `&gazesign=-1`) |

## 自動テスト
```
node tools/test-orientation.mjs   # 姿勢追従の数値(重力・yaw・平滑化)
node tools/test-color-match.mjs   # 色統計マッチングの数値
node tools/test-feed.mjs          # 録画→本番ページで再生→カメラ姿勢が追従
node tools/test-render.mjs        # 代役キャラで 色補正・床反射・姿勢追従が描画に効く
```
(ヘッドレスのChrome/Edgeが必要。`KKO_BROWSER` / `KKO_BROWSER_ARGS` は docs/dev-api.md 参照)
