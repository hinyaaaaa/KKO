# 実機テストに代わる(減らす)テスト方式

結論: 実機の完全な代わりはない。ただし「実機で初めて分かる」ものを、PCで再現できる層に分けて先に潰す。
実機は、残った"本当に実機だけの項目"を1回確かめる最終関門にする。

## 層と、各層が捕まえるもの
| 層 | コマンド | 捕まえる | 捕まえられない |
|---|---|---|---|
| 1 数式 | `test-orientation` `test-color-match` | 姿勢・色補正の計算の誤り | 描画・端末差 |
| 2 異常入力 | `test-robustness` | NaN/null、alpha折返し、真下・真上、横持ち、時刻異常、長時間の微振動、GPU機能欠け判定 | 実センサーの癖そのもの |
| 3 本番ページ+録画再生 | `test-feed` `test-render` | 配線ミス、描画パスの不整合、反射・色補正が効くか | 実機のGPU/画質/速度 |
| 4 スマホ条件 | `test-mobile` | タッチ操作、DPR3、HDR描画先なし端末、メモリ見積り、追加機能のコスト比 | 実iOS(WebKit)固有の挙動 |
| 5 実機チェック | `index.html?check` | 実機でだけ起きる事(下記) | — |

## 実機でしか分からないこと(層5で1回確認)
- iOS Safari(WebKit)固有: 許可ダイアログ、IndexedDBの保持、MediaRecorderのmp4、共有シート
- 実GPUの速度と発熱(PCの検証はソフトウェア描画なので、絶対値は意味がない。比だけ見る)
- 実センサーの癖(iOSのalphaのずれ方など)→ `?rec` で1回録れば、以後はPCで再生できる(層3)
- おかゆの取り込み時間・メモリ(`?check` が計測)

## 運用
1. 変更のたびに層1〜4を自動で回す(`npm test`)。
2. 実機は「`?rec` で素材を1本録る」+「`?check` の結果をコピー」の2つだけ。
3. 実機で見つかった不具合は、録った素材をPC再生で再現 → テストに追加 → 直す。

## 自動実行(GitHub Actions)
pushのたびに `.github/workflows/test.yml` が動く。Chromiumで全テスト、macOSのWebKit(iPhoneのSafariと同系統)で録画・描画・選択画面を確認する。
WebKitの結果は参考(落ちても全体は失敗にならない)。見る場所: GitHub Desktop の Repository > View on GitHub > Actions タブ。描画画像は各実行の Artifacts からダウンロードできる。

## 既知の限界
- 層4のローカル検証はChromium(Blink)。WebKitはGitHub Actionsのmacで回す(上記)。タッチ注入・CPU低速化はChromium専用なのでWebKitでは省略される。
- 描画の見た目(画質の良し悪し)は数値で測れない。`out/render/*.png` を目視する。
