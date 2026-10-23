# KKO v3.0.1

## 適用方法（GitHub Desktop）
1. この zip の `files/` の中身を、KKO リポジトリのフォルダ直下に **上書きコピー**
2. GitHub Desktop で差分を確認 → Commit → Push（push で CI が走ります）
※ この `CHANGES.md` 自体はコピーしないでください。

## 変更（機能の変更なし）
- `ios/project.yml`: `MARKETING_VERSION` を **3.0.1** に。さらに `CFBundleShortVersionString` / `CFBundleVersion` を `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)` で指定
  - 従来は XcodeGen が Info.plist に固定値 `1.0` を書いており、v3.0.0 をビルドしても端末上のバージョンが 1.0 のままでした（リポジトリ内IPAの Info.plist も 1.0 でした）
- `.github/workflows/ios.yml`: トークン権限を `contents: read` に限定
- `CHANGELOG.md` を新規追加

## 手動で必要なこと
- リポジトリ内の `KKO-unsigned-ipa/KKO-unsigned.ipa` は **v3.0.0 より前のビルド**です。今回の push で CI が走ったら、Actions の成果物 `KKO-unsigned-ipa` から新しい IPA を取り出して差し替えてください（IPAはこの環境では作れないため、今回のzipには含めていません）
- Swift のソースは通信・保存・外部SDKの使用がなく（確認済み）、変更していません
