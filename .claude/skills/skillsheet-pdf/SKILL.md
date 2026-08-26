---
name: skillsheet-pdf
description: スキルシートやその他の Markdown を、<details>/<summary> による折りたたみを展開した状態で PDF 化し、検証済みの最新版だけを残すスキル。Use this skill whenever the user wants to convert a skill sheet / README / Markdown to PDF, "スキルシートをPDFにして" "READMEをPDF化して" "mdをPDFに変換して" のような依頼があったとき。特に折りたたみ（details）を含む Markdown を PDF にしたいとき。そのまま PDF 化すると折りたたみの中身が消えてしまうため、このスキルで展開してから変換する必要がある。
---

# Skillsheet to PDF

`<details>`/`<summary>` の折りたたみを**展開した状態で** Markdown を PDF に変換し、検証済みの最新版だけを残すスキル。

## なぜこのスキルが必要か

PDF 変換ツール `md-to-pdf` は Chromium でページをレンダリングして PDF 化する。`<details>` は HTML の折りたたみ要素なので、Chromium 上では**閉じた状態**で描画され、中身が PDF に一切出力されない。スキルシートは各案件の詳細をすべて `<details>` の中に入れているため、何も対策せずに変換すると本文の大半が消えてしまう。そこで、変換前に折りたたみタグを除去して中身を本文として露出させる。

## 基本の使い方（これだけでよい）

リポジトリ直下で:

```bash
bun run pdf
```

`scripts/generate-pdf.ts` が以下をすべて行う:

1. `<details>`/`<summary>` を展開した中間 Markdown を生成（`scripts/expand-details.ts`）
2. GitHub 風フォント指定の frontmatter を注入し、PDF に不要な Web 向け文言（「プルダウンから確認可能」）を除去
3. リポジトリローカルの `md-to-pdf`（`node_modules/.bin/`）で PDF 生成（60 秒タイムアウト + 最大 3 回リトライ）
4. `<実行日>_高橋俊スキルシート.pdf` としてリポジトリ直下へ配置
5. 内容の機械検証（`uv run scripts/verify-pdf.py`: 展開漏れ・文言混入・ページ数）
6. 同じ命名規則の旧版を削除し、最新版 1 件だけを残す（`scripts/keep-latest-pdf.ts`）

依存は `package.json`（bun）と PEP 723 インラインメタデータ（uv）で管理。ランタイムは mise.toml で指定。

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
bun .claude/skills/skillsheet-pdf/scripts/expand-details.ts <入力.md> /tmp/expanded.md
./node_modules/.bin/md-to-pdf /tmp/expanded.md
```

見た目の調整が必要な場合は、中間 Markdown の先頭に md-to-pdf の frontmatter（`pdf_options` や `css`）を加える。
