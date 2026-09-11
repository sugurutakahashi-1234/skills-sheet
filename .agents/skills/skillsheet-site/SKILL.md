---
name: skillsheet-site
description: >-
  スキルシートの Web 版（GitHub Pages）を README.md から生成する仕組みの手順と前提。Use this skill whenever
  the user wants to change how the Web version looks or works, add/rename a
  section or a case and check it on the site, preview the site locally, or asks
  why something renders as plain Markdown on the site. "Web 版を直して" "サイトの見た目を変えて"
  "スマホで確認して" "目次に出ない" "チップにならない" のような依頼があったとき。
---
# Skillsheet Web 版

`scripts/build-site.ts` が README.md を `marked` でトークンにし、見出しと箇条書きの形を見て部品に配置する。
文章は加工しない。認識できない部分は普通の Markdown として描かれる（壊れない・消えない）。
公開先: https://sugurutakahashi-1234.github.io/skills-sheet/（`.github/workflows/pages.yml` が `main` への push で配信）。

## 基本の使い方

```bash
bun run build:site        # dist/index.html を生成（README.md と最新 PDF も dist/ に同梱）
open dist/index.html      # 手元で確認
```

- pre-commit（lefthook）が README.md か `scripts/build-site.ts` の変更時に `bun run build:site` を回す。前提が崩れているとコミットが止まる
- `dist/` はコミットしない。push すると Actions がビルドして配信する。失敗したら前の版が残る（壊れたページは出ない）
- 見た目の確認は puppeteer（リポジトリの `node_modules` にある）で撮る。スクリプトはリポジトリ直下の `.tmp/` に置く（scratchpad からは puppeteer が解決できない）:

```ts
import puppeteer from "puppeteer";
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 }); // スマホは { width: 390, height: 844, deviceScaleFactor: 2 }
await page.goto("file://" + process.cwd() + "/dist/index.html", { waitUntil: "networkidle0" });
await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" }); // smooth scroll を切ってから scrollIntoView
await page.screenshot({ path: "/path/to/out.png" });
await browser.close();
```

## ビルドが前提にしている README の形

止まるもの（ビルド失敗 = コミットも失敗）:

- 職務経歴の一覧行 `[No.N] 案件名（客先）` と案件詳細の `### [No.N] 案件名（客先）` は同じ文字列（リンク記法だけ見出しに無くてよい）。一覧行に対応する詳細が無い番号も失敗
- `<details>` を README に書くと PDF 生成が失敗する

警告だけ出して普通の描画に落ちるもの（`bun run build:site` の出力に `警告:` が出る）:

| 前提 | 外れたときの見え方 |
|---|---|
| h2 が `基本情報 / 強み / 技術スタック / 職務経歴 / 案件詳細` | その節の専用の見せ方（プロフィール型・枠・折りたたみ）が外れる |
| 基本情報に `- **現在のポジション**: …` と `GitHub: https://github.com/<user>` | 大きい表示にならない / アバターが出ない |
| 職務経歴の会社見出しが `名前 (YYYY年M月 - YYYY年M月)` か `(… - 現在)` | 目次に年が出ない |
| 案件の h4 が定型 5 節（チーム体制 / 案件概要・担当業務 / 経験した技術 / 取り組み・貢献 / 開発環境） | 節が増減してもそのまま描く。開発環境の名前を変えるとチップにならない |
| OSS の一覧が `[名前](URL)（説明）` の行 | 普通の箇条書きに戻る |

## 見せ方の対応表（README → Web 版）

- h2 = 大節、h3 = 枠のタイトル帯（技術スタック）/ 会社（職務経歴）、`- **項目**` = 左バー付きの見出し、その子 = 字下げした箇条書き
- 職務経歴の一覧行 = 折りたたみの見出し。同じ No. の案件詳細が中に入る（Web 版だけの合体。README は 2 節のまま）
- 一覧行の子行 `役割 / 技術 / 概要` は ` / ` で 3 つに分けて表示
- バッククォートの名前 = チップ。対象は技術スタックの細目・案件の開発環境・職務経歴の行の技術部分だけ。それ以外の `code` は普通のインラインコード
- チップの間の `, ` `・` は表示しない（空白は残す。消すとダブルクリックの単語選択が隣のチップまで広がる）
- 目次: h2 と、職務経歴の会社 → 案件（No. バッジ + 案件名）。技術スタックは h2 だけ。案件を押すと折りたたみを開いて移動
- 印刷（Cmd+P）: `beforeprint` で案件をすべて開く。PDF ボタンは広い画面ではページ内ビューワー、狭い画面は新しいタブ
- 狭い画面（900px 未満）: 左端のハンバーガーで目次がスライド。ヘッダーは下スクロールで隠れ、上に戻すと出る

## 変えるときの決まりごと

- 見た目の案は `design-compare` スキルで比較 HTML を出してから決める（このリポジトリの CLAUDE.md の規則）。実装後は PC 1280px・スマホ 390px・ダーク（`page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }])`）で撮って確認する
- 色は `:root` の CSS 変数（`--accent` `--soft` `--muted` `--line` `--tag`）だけで決まる。アクセント色は線・帯・バッジ・現在位置に使い、文字には使わない
- README の書き方の規則は `.rulesync/rules/skillsheet-wording.md` が正。Web 版の都合で README の表現を変えない（表示側で吸収する）
- ユーザーが「push を控えて」と言ったセッションでは、コミットまでにして push しない（Actions が動くため）
