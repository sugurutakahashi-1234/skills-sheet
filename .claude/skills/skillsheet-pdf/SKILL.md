---
name: skillsheet-pdf
description: スキルシートやその他の Markdown を、<details>/<summary> による折りたたみを展開した状態で PDF 化するスキル。Use this skill whenever the user wants to convert a skill sheet / README / Markdown to PDF, "スキルシートをPDFにして" "READMEをPDF化して" "mdをPDFに変換して" のような依頼があったとき。特に折りたたみ（details）を含む Markdown を PDF にしたいとき。そのまま PDF 化すると折りたたみの中身が消えてしまうため、このスキルで展開してから変換する必要がある。
---

# Skillsheet to PDF

`<details>`/`<summary>` の折りたたみを**展開した状態で** Markdown を PDF に変換するスキル。

## なぜこのスキルが必要か

PDF 変換ツール `md-to-pdf` は Chromium でページをレンダリングして PDF 化する。`<details>` は HTML の折りたたみ要素なので、Chromium 上では**閉じた状態**で描画され、中身が PDF に一切出力されない。スキルシートは各案件の詳細をすべて `<details>` の中に入れているため、何も対策せずに変換すると本文の大半（全案件の詳細）が消え、冒頭のサマリーだけの数ページになってしまう。

そこで、変換前に折りたたみタグを除去して中身を本文として露出させる。各 `<details>` は `<summary>` の直後に同じ内容の `## 見出し` が重複している構造なので、`<summary>` を消しても見出しは本文側に残り、情報は失われない。

## 前提

- 変換は `npx md-to-pdf` を使う。`bunx md-to-pdf` は Puppeteer の Chromium を Bun 側に持たず取得で固まることがあるため、Chromium を備える `npx` 経由が確実（実測で 2 秒ほどで完了）。展開スクリプトは TypeScript で、`bun` が直接実行する。
- スタイルは md-to-pdf のデフォルトをそのまま使う（専用の CSS デザインファイルは持たない）。
- 変換対象はリポジトリ直下の `README.md` が既定。別ファイルを変換したい場合はそのパスを使う。
- **出力先はリポジトリ直下**で、ファイル名は `<日付>_高橋俊スキルシート.pdf`（例: `2026-06-02_高橋俊スキルシート.pdf`）。日付は変換実行日とする。

## 手順

スキルディレクトリを `SKILL_DIR` とする（このファイルのある場所）。カレントはリポジトリ直下を前提とする。以下は対象が `README.md` の例。

### 1. 折りたたみを展開した中間 Markdown を生成する

```bash
bun "$SKILL_DIR/scripts/expand-details.ts" README.md /tmp/skillsheet.expanded.md
```

`<summary>...</summary>`、`<details ...>`、`</details>` を除去し、余分な空行を整えた Markdown を出力する。

### 2. PDF を生成し、日付付きの名前でリポジトリ直下に配置する

```bash
npx --yes md-to-pdf /tmp/skillsheet.expanded.md
OUT="$(date +%Y-%m-%d)_高橋俊スキルシート.pdf"
mv /tmp/skillsheet.expanded.pdf "$OUT"
echo "生成: $OUT"
```

`npx md-to-pdf` は `/tmp/skillsheet.expanded.pdf` を生成するので、それを実行日付つきのファイル名でリポジトリ直下へ移動する。

### 3. 中身を検証する（重要）

折りたたみが正しく展開されたかを必ず確認する。展開漏れがあると詳細が消えたことに気づけない。`<details>` 内にしか登場しないキーワードが PDF テキストに含まれるか、ページ数が妥当か（サマリーだけだと数ページ、全展開なら大幅に増える）を確認する。

```bash
python3 - "$OUT" <<'PY'
import sys
from pypdf import PdfReader  # 無ければ: pip3 install pypdf -q
r = PdfReader(sys.argv[1])
txt = "\n".join(p.extract_text() or "" for p in r.pages)
print("ページ数:", len(r.pages))
# 折りたたみの中身にしか出てこない語が含まれていれば展開成功
for kw in ["チーム体制", "案件概要", "経験した技術"]:
    print(f"  '{kw}':", "○" if kw in txt else "× 欠落（展開失敗の可能性）")
PY
```

### 4. 後片付け

中間ファイルを削除する。

```bash
rm -f /tmp/skillsheet.expanded.md
```

## 補足

- 生成される PDF（`*_高橋俊スキルシート.pdf`）は `.gitignore` の `*.pdf` により Git 追跡対象外。
- **別の入力ファイル**を変換する場合は手順のパスを差し替えるだけでよい。
- 見た目（フォント・余白・改ページなど）は md-to-pdf のデフォルトに従う。調整が必要になった場合は、中間 Markdown の先頭に md-to-pdf の frontmatter（`pdf_options` や `css`）を加える方法がある。
