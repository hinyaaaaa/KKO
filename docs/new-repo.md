# 新しいリポジトリを作る(KKO)

古いリポジトリは、履歴にモデルが含まれていたため破棄する。**履歴もモデルも含まない**新しいリポジトリで始める。

## 手順(PowerShell)
```powershell
# 1. 新しい空のフォルダに、kko-repo.zip を展開する(古いフォルダには重ねない)
cd C:\Users\coela
Expand-Archive kko-repo.zip -DestinationPath .\KKO
cd .\KKO

# 2. ローカルにあるモデルを、開発用に戻す(任意。dev.html とヘッドレス撮影で使う)
#    古いフォルダの assets\kanata と assets\kanade を、KKO\assets\ にコピーする。
#    assets/ は .gitignore 済みなので、git には入らない。

# 3. GitHubで空のリポジトリを作る(README等は追加しない)。名前の例: kko
#    その後、次を実行する
git init -b main
git add .
git ls-files | Select-String "assets/|\.pmx"     # 何も表示されなければOK(モデルが入っていない)
git commit -m "KKO: 初回コミット"
git remote add origin https://github.com/<ユーザー名>/kko.git
git push -u origin main

# 4. npm のパッケージを入れる(開発用ツール)
npm install
```

## 古いリポジトリの削除
GitHub → 古いリポジトリ → Settings → 一番下の「Danger Zone」→ Delete this repository。

## 公開(GitHub Pages)
Settings → Pages → Branch を `main` / `(root)` にして保存する。URLが変わるので、iPhoneでは**新しいURLを開き直して、ホーム画面に追加し直す**。
モデルの取り込みデータはURL(オリジン)ごとに別なので、新しいURLでは**モデルを取り込み直す**必要がある。
