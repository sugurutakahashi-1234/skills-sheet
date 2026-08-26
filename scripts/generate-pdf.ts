#!/usr/bin/env bun
/**
 * README.md の <details> を展開して PDF 化し、日付付きファイル名で配置して旧版を削除する。
 * 使い方: bun run pdf
 */
import { $ } from "bun";

const EXPANDED = "/tmp/skillsheet.expanded.md";
const SUFFIX = "_高橋俊スキルシート.pdf";

// 1. 折りたたみを展開した中間 Markdown を生成
await $`bun .claude/skills/skillsheet-pdf/scripts/expand-details.ts README.md ${EXPANDED}`;

// 2. 展開漏れの検証（<details> が残っていたら中身が PDF から消える）
const md = await Bun.file(EXPANDED).text();
if (md.includes("<details") || md.includes("<summary")) {
  throw new Error("展開漏れ: 中間 Markdown に <details>/<summary> が残っています");
}

// 2.5. GitHub 風フォント指定の frontmatter を注入
// md-to-pdf のデフォルトは github-markdown-css だが、日本語フォントはシステム任せになるため
// GitHub と同じゴシック系サンセリフを明示する
const FRONTMATTER = `---
pdf_options:
  format: A4
  margin: 18mm 16mm
css: |-
  .markdown-body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
  }
---

`;

// 2.6. PDF では意味を持たない Web 向けの文言を除去（プルダウン＝折りたたみは展開済みのため）
const cleaned = md.replace(/^※ 各案件の詳細は以下のプルダウンから確認可能。\n?/m, "");

await Bun.write(EXPANDED, FRONTMATTER + cleaned);

// 3. PDF 生成（リポジトリローカルの md-to-pdf を使用。npx は使わない）
await $`./node_modules/.bin/md-to-pdf ${EXPANDED}`;

// 4. 実行日付（ローカルタイムゾーン）のファイル名でリポジトリ直下へ配置
const today = new Date().toLocaleDateString("sv-SE");
const out = `${today}${SUFFIX}`;
await $`mv ${EXPANDED.replace(/\.md$/, ".pdf")} ${out}`;
await $`rm -f ${EXPANDED}`;

// 5. サイズ検証（サマリーだけの数ページだと明らかに小さくなる）
const size = Bun.file(out).size;
if (size < 100_000) {
  throw new Error(`PDF が小さすぎます (${size} bytes)。展開に失敗している可能性`);
}

// 6. 検証済みの最新版だけを残す
await $`bun .claude/skills/skillsheet-pdf/scripts/keep-latest-pdf.ts ${out}`;

console.log(`生成: ${out} (${Math.round(size / 1024)} KB)`);
