---
name: skillsheet-pdf
description: >-
  スキルシート（README.md）を md-to-pdf で PDF 化し、内容を検証して最新版だけを残すスキル。Use this skill
  whenever the user wants to convert a skill sheet / README / Markdown to PDF,
  "スキルシートをPDFにして" "READMEをPDF化して" "mdをPDFに変換して" のような依頼があったとき。
---
# Skillsheet to PDF

README.md を PDF に変換し、検証済みの最新版だけを残すスキル。

## 基本の使い方（これだけでよい）

リポジトリ直下で:

```bash
bun run pdf
```

`scripts/generate-pdf.ts` が以下をすべて行う:

1. README.md に `<details>`/`<summary>` が含まれていないことを確認（含まれていると Chromium 上で閉じた状態で描画され、中身が PDF から消える。スキルシートでは折りたたみを使わない方針）
2. GitHub 風フォント指定の frontmatter を注入した中間 Markdown を生成
3. リポジトリローカルの `md-to-pdf`（`node_modules/.bin/`）で PDF 生成（60 秒タイムアウト + 最大 3 回リトライ）
4. `<実行日>_高橋俊スキルシート.pdf` としてリポジトリ直下へ配置
5. 内容の機械検証（`uv run scripts/verify-pdf.py`: 案件詳細の見出し・ページ数）
6. 同じ命名規則の旧版を削除し、最新版 1 件だけを残す（`scripts/keep-latest-pdf.ts`）

依存は `package.json`（bun）と `pyproject.toml`（uv, `uv sync` で `.venv` 作成）で管理。ランタイムは mise.toml で指定。

## 自動実行（lefthook）

`lefthook.yml` の pre-commit フックにより、**README.md をコミットすると自動で PDF が再生成されてステージされる**。手動で `bun run pdf` を呼ぶのは、README 以外のファイルを変換したいときだけでよい。

## 注意事項

- **`npx md-to-pdf` は使わない**。npx はレジストリ解決で頻繁にハングする（2026-08 に恒常化）。必ずローカルの `node_modules/.bin/md-to-pdf` を経由すること（`bun run pdf` はそうなっている）。
- `bunx md-to-pdf` も Puppeteer の Chromium 取得で固まるため使わない。
- サンドボックス環境で foreground 実行すると Chromium 起動が固まることがある。ハングしたら background 実行で再試行する。
- PDF は Git の追跡対象。生成・検証後に旧版の削除と新版の追加を一緒にコミットする。
- 内容検証は `bun run pdf` に組み込み済み（`scripts/verify-pdf.py`）。手動で追加検証する場合、PDF のフォント抽出は一部の漢字を康熙部首（例: 工 → ⼯）で返すため、NFKC 正規化と空白除去をしてから文字列一致で判定すること。

## 別ファイルを変換する場合

```bash
./node_modules/.bin/md-to-pdf <入力.md>
```

見た目の調整が必要な場合は、Markdown の先頭に md-to-pdf の frontmatter（`pdf_options` や `css`）を加える。
