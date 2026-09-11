#!/usr/bin/env bun
/**
 * README.md から GitHub Pages 用の静的サイトを dist/ に生成する。
 * 使い方: bun run build:site
 *
 * - 案件詳細（`## [No.N] …` から次の案件見出しまで）は <details> に包んで折りたたむ
 * - 右上に「Markdown をコピー」「PDF」「GitHub」のボタンを置く。コピー元は README.md をそのまま埋め込む
 * - 最新の PDF と README.md も dist/ に同梱する
 */
import { $, Glob } from "bun";
import { marked } from "marked";

const SOURCE = "README.md";
const OUT_DIR = "dist";
const REPO_URL = "https://github.com/sugurutakahashi-1234/skills-sheet";
const PDF_GLOB = "*_高橋俊スキルシート.pdf";

const md = await Bun.file(SOURCE).text();

// 案件詳細の見出し行で分割する。先頭ブロックは一覧（基本情報〜職務経歴〜「案件詳細」の見出し）
const CASE_HEADING = /^### \[No\.\d+\] .*$/m;
const [summaryMd, ...caseMds] = md.split(/^(?=### \[No\.\d+\] )/m);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const render = (src: string) => marked.parse(src, { async: false }) as string;

// 案件と案件の間の区切り線は <details> の境界で代替するので落とす
const stripRule = (src: string) => src.replace(/^---\s*$/gm, "").trim();

const summaryHtml = render(stripRule(summaryMd));

const casesHtml = caseMds
  .map((caseMd) => {
    const heading = caseMd.match(CASE_HEADING)?.[0].replace(/^### /, "") ?? "";
    const id = heading.match(/\[No\.(\d+)\]/)?.[1] ?? "";
    const body = render(stripRule(caseMd.replace(CASE_HEADING, "")));
    return `<details id="no-${id}"><summary>${escapeHtml(heading)}</summary>\n${body}</details>`;
  })
  .join("\n");

const pdfName = [...new Glob(PDF_GLOB).scanSync(".")][0];
if (!pdfName) throw new Error(`PDF が見つかりません: ${PDF_GLOB}`);

const title = md.match(/^# (.+)$/m)?.[1] ?? "スキルシート";

// コピー用の Markdown は <script type="text/markdown"> に埋め込む。終了タグと衝突しないよう念のためエスケープ
const embeddedMd = md.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1f2328; --bg: #fff; --muted: #59636e; --line: #d1d9e0; --accent: #0969da; }
@media (prefers-color-scheme: dark) { :root { --fg: #f0f6fc; --bg: #0d1117; --muted: #9198a1; --line: #3d444d; --accent: #4493f8; } }
body { margin: 0; color: var(--fg); background: var(--bg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif; }
header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
header .brand { font-weight: 600; }
header nav { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
header a, header button { font: inherit; font-size: 14px; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; text-decoration: none; cursor: pointer; }
header a:hover, header button:hover { border-color: var(--accent); color: var(--accent); }
main { max-width: 900px; margin: 0 auto; padding: 16px 16px 64px; }
a { color: var(--accent); }
h1, h2, h3, h4 { line-height: 1.3; }
h2 { border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-top: 2em; }
ul { padding-left: 1.5em; } li { margin: 2px 0; }
code { font-size: 0.9em; }
details { border: 1px solid var(--line); border-radius: 6px; padding: 0 16px; margin: 12px 0; }
details > summary { cursor: pointer; font-weight: 600; padding: 10px 0; }
details[open] > summary { border-bottom: 1px solid var(--line); }
hr { border: 0; border-top: 1px solid var(--line); }
</style>
</head>
<body>
<header>
  <span class="brand">${escapeHtml(title)}</span>
  <nav>
    <button type="button" id="copy-md">Markdown をコピー</button>
    <a href="${encodeURI(pdfName)}" download>PDF</a>
    <a href="${REPO_URL}">GitHub</a>
  </nav>
</header>
<main>
${summaryHtml}
${casesHtml}
</main>
<script type="text/markdown" id="source-md">${embeddedMd}</script>
<script>
const button = document.getElementById("copy-md");
button.addEventListener("click", async () => {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(document.getElementById("source-md").textContent);
    button.textContent = "コピーしました";
  } catch {
    button.textContent = "コピーに失敗しました";
  }
  setTimeout(() => { button.textContent = label; }, 1500);
});
// URL の #no-N で該当の案件を開く
const openFromHash = () => { const t = document.querySelector(location.hash || "#none"); if (t?.tagName === "DETAILS") t.open = true; };
addEventListener("hashchange", openFromHash); openFromHash();
</script>
</body>
</html>
`;

await $`rm -rf ${OUT_DIR}`;
await $`mkdir -p ${OUT_DIR}`;
await Bun.write(`${OUT_DIR}/index.html`, html);
await $`cp ${SOURCE} ${pdfName} ${OUT_DIR}/`;

console.log(`生成: ${OUT_DIR}/index.html（案件 ${caseMds.length} 件, PDF: ${pdfName}）`);
