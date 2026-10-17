# KKO v3 検証アプリ(スパイク)

目的: 「Macなし・費用ゼロ」で、iPhone 17に本物のARKit(床検出・世界固定・人物の前後関係)のアプリを入れて動かせるかを確かめる。
中身は、床をタップすると人型の箱(身長1.5m、鼻の位置に白い小箱)を置くだけ。人数を1/2/3/5に切り替えると、カメラ側へ開いた弧で並ぶ(集合写真の並びの試作)。

## ビルド(自動)
`ios/` 以下をpushすると、GitHub Actions(`ios` ワークフロー)が動く。
1. `ios/KKOCore` の計算(向き・集合の並び)を `swift test` で検証
2. XcodeGenでXcodeプロジェクトを生成 → 署名なしでビルド
3. `KKO-unsigned.ipa` を Artifacts に出す

Artifactsは GitHub の Actions タブ → 該当の実行 → ページ下部 `KKO-unsigned-ipa`。

## iPhoneへ入れる(無料のApple IDで署名)
署名なしIPAを、Windows上のツールで署名しながら入れる。どちらか1つでよい。
- Sideloadly(Windows版)
- AltStore(AltServer)

手順の要点:
1. iPhoneの設定 → プライバシーとセキュリティ → デベロッパモード をON(再起動が必要)
2. ツールにIPAと無料のApple IDを渡して入れる(Sideloadlyの画面案内に従う。iTunes/iCloudは、ツールの案内にあるApple公式配布版が必要になることがある)
3. 初回は 設定 → 一般 → VPNとデバイス管理 で、自分のApple IDを「信頼」
4. 無料のApple IDで署名したアプリは約7日で期限切れになる。AltServerなら同じWi-Fi上で自動更新できる。

## 確認してほしいこと(これだけ)
画面左上の表示を、スクリーンショットで1枚送ってください(床を数回タップして、箱を何個か置いた状態で)。
- 追跡が「良好」になるか
- 「検出した床」が増えるか
- 歩き回っても箱が床に固定されたままか
- 人が前を横切ったとき、箱の前に人が出るか(人の前後関係)
- 5人で置いたとき、箱の鼻が全員こちらを向いているか
- 体感のなめらかさ(fps表示)

## 補足(任意): Claudeが自動で直せるようにする
GitHubの「Fine-grained personal access token」を、KKOリポジトリだけ・短い期限・Contents(書き込み)とActions(読み取り)のみで作って渡してもらえれば、Claudeがpush→CI結果の確認→修正を自分で回せる。毎回zipを展開してGitHub Desktopで反映する手間がなくなる。渡さない場合も、zip方式で進められる。
