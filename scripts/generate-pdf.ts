#!/usr/bin/env bun
/**
 * README.md を PDF 化し、日付付きファイル名で配置して旧版を削除する。
 * 使い方: bun run pdf
 */
import { $ } from "bun";
import { expandDetails } from "./expand-details";

const SOURCE = "README.md";
const EXPANDED = "/tmp/skillsheet.expanded.md";
const SUFFIX = "_高橋俊スキルシート.pdf";

// 1. 案件詳細の折りたたみを展開する
// <details> のままだと Chromium が閉じた状態で描画するため、中身が PDF から一切出力されない
const md = expandDetails(await Bun.file(SOURCE).text());
if (md.includes("<details") || md.includes("<summary")) {
  throw new Error("展開漏れ: 中間 Markdown に <details>/<summary> が残っています");
}

// 2. GitHub 風フォント指定の frontmatter を注入した中間 Markdown を生成
// md-to-pdf のデフォルトは github-markdown-css だが、日本語フォントはシステム任せになるため
// GitHub と同じゴシック系サンセリフを明示する
const FRONTMATTER = `---
document_title: 高橋俊スキルシート
pdf_options:
  format: A4
  margin: 18mm 16mm
css: |-
  .markdown-body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
  }
---

`;

await Bun.write(EXPANDED, FRONTMATTER + md);

// 3. PDF 生成（リポジトリローカルの md-to-pdf を使用。npx は使わない）
// Chromium の起動がまれに無応答になるため、タイムアウト付きで最大 3 回リトライする
async function generateWithRetry(attempts = 3, timeoutMs = 60_000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    const proc = Bun.spawn(["./node_modules/.bin/md-to-pdf", EXPANDED], {
      stdout: "inherit",
      stderr: "inherit",
    });
    // Bun.sleep だと正常終了後もタイマーが残り、プロセスが timeoutMs 経つまで終了しないため、
    // clearTimeout できる setTimeout を使う
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    });
    const timedOut = await Promise.race([proc.exited.then(() => false), timeout]);
    clearTimeout(timer);
    if (timedOut) {
      proc.kill();
      await proc.exited;
      console.warn(`md-to-pdf が ${timeoutMs / 1000} 秒応答なし（${i}/${attempts} 回目）。リトライします`);
      continue;
    }
    if (proc.exitCode === 0) return;
    throw new Error(`md-to-pdf が失敗しました (exit ${proc.exitCode})`);
  }
  throw new Error("md-to-pdf が繰り返しタイムアウトしました");
}
await generateWithRetry();

// 4. 実行日付（ローカルタイムゾーン）のファイル名でリポジトリ直下へ配置
const today = new Date().toLocaleDateString("sv-SE");
const out = `${today}${SUFFIX}`;
await $`mv ${EXPANDED.replace(/\.md$/, ".pdf")} ${out}`;
await $`rm -f ${EXPANDED}`;

// 5. サイズ検証（案件詳細が欠けると明らかに小さくなる）
const size = Bun.file(out).size;
if (size < 100_000) {
  throw new Error(`PDF が小さすぎます (${size} bytes)。本文が欠けている可能性`);
}

// 6. 内容の検証（案件詳細の見出し・ページ数）
await $`uv run scripts/verify-pdf.py ${out}`;

// 7. 検証済みの最新版だけを残す
await $`bun .claude/skills/skillsheet-pdf/scripts/keep-latest-pdf.ts ${out}`;

console.log(`生成: ${out} (${Math.round(size / 1024)} KB)`);
