# CHANGELOG

## v3.0.1（2026-10-23）
機能の変更なし。ビルド設定の修正。

- アプリのバージョン表示が常に「1.0」になっていた不具合を修正（XcodeGen が Info.plist に固定値 `1.0` を書いていたため、`$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` を参照するように変更）
- GitHub Actions のトークン権限を `contents: read` に限定
- 注意: `KKO-unsigned-ipa/KKO-unsigned.ipa`（リポジトリ内のIPA）は v3.0.0 より前のビルド（表示バージョン 1.0）のままです。この版をCIでビルドし、Actions の成果物から取り出して差し替えてください

## v3.0.0
