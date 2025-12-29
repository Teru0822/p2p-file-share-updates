# AI Agent Guide for P2P File Share (v2)

このリポジトリで作業を行うAIエージェント向けのガイドラインです。開発環境の特性と、過去のトラブルに基づいたルールを記載しています。

## 🖥 開発環境
- **OS**: Windows
- **Shell**: PowerShell (Default)
- **Runtime**: Electron / Node.js

## 🛠 コマンド実行のルール (CRITICAL)
WindowsのPowerShell環境でコマンドを実行する際、以下のルールを厳守してください。

1. **コマンド連結の禁止**:
   - `git add . && git commit` のような `&&` による連結は、エージェントの使用するPowerShellのバージョンによってエラー（`InvalidEndOfLine`）になることがあります。
   - **解決策**: コマンドは必ず1つずつ個別の `run_command` で実行してください。
   - 良い例: `git add .` を実行し、完了後に `git commit` を実行。

2. **文字エンコーディング**:
   - ターミナルの出力（特に日本語）が文字化けすることがあります。必要に応じて `chcp 65001` を検討してください。

## 📝 コード編集のルール
1. **ファイルの整合性チェック**:
   - `styles.css` や `renderer.js` は行数が多いため、`replace_file_content` を使用する際は、置換範囲の `StartLine` と `EndLine` を慎重に確認してください。
   - **過去の轍**: Baseスタイルの誤消去や、閉じ括弧 `}` の欠落が発生したことがあります。置換後は必ず `view_file` で整合性を確認してください。

2. **インクリメンタルな編集**:
   - 大規模な変更は一度に行わず、機能単位で `multi_replace_file_content` または複数の `replace_file_content` に分けて実行することを推奨します。

## 🏗 プロジェクト独自の構造
このプロジェクトには独自の **セルフ・アップデート機能** が実装されています。

1. **ASAR設定 (重要)**:
   - `package.json` の `build.asar` は必ず `false` に設定されています。
   - `true` に戻すと、実行ファイルが固められてしまい、`main.js` が自分自身のファイルを書き換えてアップデートすることができなくなります。

2. **自動アップデートの仕組み**:
   - `renderer.js`: 10秒ごとに GitHub Raw Content の `package.json` をチェック。
   - `main.js`: `download-update` ハンドラで自身のリソース（`app.getAppPath()`）を直接上書き。
   - **注意**: ファイルパスの取得に `process.execPath` の横を期待してはいけません。必ず `app.getAppPath()` を起点にしてください。

3. **リリース手順 (自動化)**:
   - `package.json` の `version` を更新して `main` ブランチにプッシュするだけで、GitHub Actions が自動的に以下の処理を行います：
     - `package.json` からバージョンを取得。
     - 対応する Git タグ（例: `v2.4.5`）を自動作成。
     - Windows/Linux 用のインストーラーをビルドし、GitHub Release を作成・アップロード。
   - **注意**: タグを手動で打つ必要はもうありません。`package.json` の更新がリリースのトリガーになります。

## 📡 ネットワーク仕様
- **UDPポート (Search)**: 45678 (Broadcast用)
- **TCPポート (Transfer)**: 45679 (ファイル/メッセージ転送用)
- **ファイアウォール**: Windows環境では `firewall-setup.bat` を管理者権限で実行してポートを開放する必要があります。

---
このガイドに従うことで、不必要なエラーを回避し、Windows環境での開発をスムーズに進めることができます。
