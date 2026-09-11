#!/usr/bin/env bun
/**
 * README.md から GitHub Pages 用の静的サイトを dist/ に生成する。
 * 使い方: bun run build:site
 *
 * README の文章は加工しない。marked.lexer のトークンを、見出しの規約
 * （h2 = 大節 / h3 = グループ / h4 = 案件内の定型節 / `- **項目**` = 細目）に従って部品へ配置するだけ。
 * - 左に目次（h2 / h3）。現在位置を強調し、狭い画面ではボタンで開閉
 * - 強み・技術スタックは `- **項目**` ごとにカード
 * - 職務経歴の一覧行と案件詳細は `[No.N]` で突き合わせ、一覧行を <details> の見出しにして詳細を中に入れる（Web 版だけの合体）
 * - 印刷時は案件詳細をすべて開く。右上に「Markdown をコピー」「PDF」「GitHub」
 */
import { $, Glob } from "bun";
import { marked, type Token, type Tokens } from "marked";

const SOURCE = "README.md";
const OUT_DIR = "dist";
const REPO_URL = "https://github.com/sugurutakahashi-1234/skills-sheet";
const PDF_GLOB = "*_高橋俊スキルシート.pdf";

const md = await Bun.file(SOURCE).text();
const tokens = marked.lexer(md);

// ---- 描画の小道具 ----------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (src: string) => marked.parseInline(src, { async: false }) as string;
const block = (ts: Token[]) => (ts.length ? marked.parser(ts) : "");
const idOf = (text: string) => text.replace(/\s+/g, "-").replace(/[^\p{L}\p{N}\-_.]/gu, "");
const isHeading = (t: Token, depth: number): t is Tokens.Heading => t.type === "heading" && (t as Tokens.Heading).depth === depth;

/** `- **項目**（: 補足）` 形式の箇条書きなら、太字の項目名と残りの文と子要素に分ける */
function splitBoldItem(item: Tokens.ListItem): { label: string; rest: string; children: Token[] } | null {
  const [first, ...children] = item.tokens;
  if (!first || (first.type !== "text" && first.type !== "paragraph")) return null;
  const inl = (first as Tokens.Text).tokens ?? [];
  if (inl[0]?.type !== "strong") return null;
  const rest = inl.slice(1).map((t) => t.raw).join("").replace(/^[:：]\s*/, "").trim();
  return { label: (inl[0] as Tokens.Strong).text, rest, children };
}

/** 箇条書きを「太字の項目 = 左バー付きの見出し + 字下げした子」に並べる。太字でない項目が混ざる一覧はそのまま置く */
function items(list: Tokens.List): string {
  const parts = list.items.map(splitBoldItem);
  if (parts.some((p) => p === null)) return `<div class="items"><div class="item">${block([list])}</div></div>`;
  return `<div class="items">${parts
    .map((p) => {
      const { label, rest, children } = p!;
      const head = `<h4 class="item-title">${inline(label)}${rest ? `<span class="item-rest">${inline(rest)}</span>` : ""}</h4>`;
      return `<div class="item">${head}${block(children)}</div>`;
    })
    .join("")}</div>`;
}

/** 節（h3 があればその帯付き）を 1 枚の枠にまとめる */
const group = (body: string, heading?: Tokens.Heading) =>
  `<div class="group"${heading ? ` id="${idOf(heading.text)}"` : ""}>${heading ? `<h3>${inline(heading.text)}</h3>` : ""}${body}</div>`;

// ---- 見出しでトークンを区切る ---------------------------------------------

type Group = { heading: Tokens.Heading; body: Token[] };
type Section = Group & { subs: Group[] };

function groupBy(ts: Token[], depth: number): { lead: Token[]; groups: Group[] } {
  const lead: Token[] = [];
  const groups: Group[] = [];
  for (const t of ts) {
    if (isHeading(t, depth)) groups.push({ heading: t, body: [] });
    else if (groups.length) groups.at(-1)!.body.push(t);
    else lead.push(t);
  }
  return { lead, groups };
}

const titleToken = tokens.find((t) => isHeading(t, 1)) as Tokens.Heading | undefined;
const title = titleToken?.text ?? "スキルシート";
const { lead: intro, groups: h2Groups } = groupBy(tokens.filter((t) => t !== titleToken), 2);
const sections: Section[] = h2Groups.map((g) => {
  const { lead, groups } = groupBy(g.body, 3);
  return { heading: g.heading, body: lead, subs: groups };
});

// ---- 節ごとの描画 ------------------------------------------------------------

const CASE_RE = /^\[No\.(\d+)\]\s*(.*)$/;

/** 案件見出し `[No.N] 案件名 - 役割（技術）` を分解する */
function parseCaseHeading(text: string) {
  const m = text.match(CASE_RE);
  const no = m?.[1] ?? "";
  const [name, ...roleParts] = (m?.[2] ?? text).split(" - ");
  return { no, name: name.trim(), role: roleParts.join(" - ").trim() };
}

function renderBasic(sec: Section) {
  return group(`<div class="items"><div class="item">${block(sec.body)}</div></div>`);
}

/** 強み（h3 なし）は h2 直下を 1 枠、技術スタックは h3 ごとに 1 枠 */
function renderGroups(sec: Section) {
  const lists = (ts: Token[]) => ts.map((t) => (t.type === "list" ? items(t as Tokens.List) : block([t]))).join("");
  const hasBody = sec.body.some((t) => t.type !== "space");
  return (hasBody ? group(lists(sec.body)) : "") + sec.subs.map((s) => group(lists(s.body), s.heading)).join("");
}

/** 案件詳細の本文と見出しを No. で引けるようにする（本文は h4 の定型節ごとに <section>） */
const caseBodies = new Map<string, string>();
const caseNames = new Map<string, string>();
for (const s of sections.find((sec) => sec.heading.text === "案件詳細")?.subs ?? []) {
  const { no, name } = parseCaseHeading(s.heading.text);
  caseNames.set(no, name);
  const { lead, groups } = groupBy(s.body, 4);
  caseBodies.set(
    no,
    block(lead) + groups.map((g) => `<section class="sub"><h4>${inline(g.heading.text)}</h4>${block(g.body)}</section>`).join(""),
  );
}

/** 職務経歴: 所属ごとの一覧行を <details> にし、同じ No. の案件詳細を中に入れる */
function renderCareer(sec: Section) {
  const rows = (list: Tokens.List) =>
    list.items
      .map((item) => {
        const [first, ...children] = item.tokens;
        const text = (first as Tokens.Text).text;
        const { no, name } = parseCaseHeading(text);
        const body = caseBodies.get(no);
        if (!body) throw new Error(`職務経歴の [No.${no}] に対応する案件詳細がありません`);
        // 一覧行と案件詳細の見出しは同じ「案件名（客先）」にする規約。リンク記法だけは見出し側に無い
        const plainName = name.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        if (plainName !== caseNames.get(no)) {
          throw new Error(`[No.${no}] の案件名が一覧と詳細で違います: "${plainName}" / "${caseNames.get(no)}"`);
        }
        const sub = children.find((t): t is Tokens.List => t.type === "list");
        // 子行の `役割 / 技術 / 概要` を 3 つに分けて表示する（文章は原文のまま）
        const meta = sub
          ? sub.items
              .map((i) => (i.tokens[0] as Tokens.Text).text)
              .join(" / ")
              .split(" / ")
              .map((s) => `<span>${inline(s.trim())}</span>`)
              .join("")
          : "";
        return `<details class="case" id="no-${no}"><summary><span class="row-no">No.${no}</span><span class="row-main"><span class="row-name">${inline(name)}</span><span class="row-meta">${meta}</span></span></summary><div class="case-body">${body}</div></details>`;
      })
      .join("");
  return (
    block(sec.body) +
    sec.subs
      .map(
        (s) =>
          `<h3 id="${idOf(s.heading.text)}">${inline(s.heading.text)}</h3>` +
          s.body.map((t) => (t.type === "list" ? rows(t as Tokens.List) : block([t]))).join(""),
      )
      .join("")
  );
}

const RENDERERS: Record<string, (sec: Section) => string> = {
  基本情報: renderBasic,
  強み: renderGroups,
  技術スタック: renderGroups,
  職務経歴: renderCareer,
};

// 案件詳細は職務経歴の行に合体させるので、節としては出さない
const visibleSections = sections.filter((sec) => sec.heading.text !== "案件詳細");

const mainHtml = visibleSections
  .map((sec) => {
    const render = RENDERERS[sec.heading.text] ?? ((s: Section) => block(s.body) + s.subs.map((g) => block([g.heading, ...g.body])).join(""));
    return `<section class="sec" id="${idOf(sec.heading.text)}"><h2>${inline(sec.heading.text)}</h2>${render(sec)}</section>`;
  })
  .join("");

// 目次: h2 と h3
const tocHtml = `<ol class="toc">${visibleSections
  .map((sec) => {
    const subs = sec.subs
      .map((s) => `<li><a href="#${idOf(s.heading.text)}" title="${esc(s.heading.text)}">${inline(s.heading.text)}</a></li>`)
      .join("");
    return `<li><a href="#${idOf(sec.heading.text)}">${inline(sec.heading.text)}</a>${subs ? `<ol>${subs}</ol>` : ""}</li>`;
  })
  .join("")}</ol>`;

const caseCount = caseBodies.size;
const pdfName = [...new Glob(PDF_GLOB).scanSync(".")][0];
if (!pdfName) throw new Error(`PDF が見つかりません: ${PDF_GLOB}`);

// コピー用の Markdown は <script type="text/markdown"> に埋め込む。終了タグと衝突しないよう念のためエスケープ
const embeddedMd = md.replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root {
  color-scheme: light dark;
  /* 文字は本文色 / グレーだけ。アクセント色は線・帯・バッジ・現在位置に使い、文字には使わない */
  --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d0d7de; --soft: #e8f0fe;
  --accent: #2563eb; --link: #1d4ed8;
  --header-h: 52px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --soft: #16233d; --accent: #3b82f6; --link: #60a5fa; }
}
* { box-sizing: border-box; }
html { scroll-padding-top: calc(var(--header-h) + 16px); scroll-behavior: smooth; }
body { margin: 0; color: var(--fg); background: var(--bg); font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif; overflow-wrap: anywhere; }
a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }
code { font-size: .9em; background: var(--soft); padding: 0 .3em; border-radius: 4px; }

/* ヘッダー */
.header { position: sticky; top: 0; z-index: 20; height: var(--header-h); display: flex; align-items: center; gap: 8px; padding: 0 16px; background: var(--bg); border-bottom: 1px solid var(--line); }
.header .brand { font-weight: 700; margin-right: auto; white-space: nowrap; }
.header nav { display: flex; gap: 6px; }
.btn { font: inherit; font-size: 13px; line-height: 1; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; cursor: pointer; white-space: nowrap; text-decoration: none; }
.btn:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { filter: brightness(1.08); color: #fff; }
.btn .short { display: none; }
#toc-toggle { display: none; }

/* 2 カラム */
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 40px; max-width: 1160px; margin: 0 auto; padding: 24px 24px 80px; }
aside { position: sticky; top: calc(var(--header-h) + 16px); align-self: start; max-height: calc(100vh - var(--header-h) - 32px); overflow-y: auto; font-size: 13px; }
.toc, .toc ol { list-style: none; margin: 0; padding: 0; }
.toc > li { margin-bottom: 6px; }
.toc > li > a { font-weight: 600; color: var(--fg); }
.toc ol { margin: 2px 0 6px 12px; border-left: 1px solid var(--line); }
.toc ol a { color: var(--muted); padding-left: 12px; }
.toc a { display: block; padding: 3px 10px; border-left: 2px solid transparent; margin-left: -1px; border-radius: 0 4px 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toc a:hover { text-decoration: none; background: var(--soft); }
.toc a.active { color: var(--fg); font-weight: 600; border-left-color: var(--accent); background: var(--soft); }
main { min-width: 0; }

/* 本文 */
.intro { color: var(--muted); font-size: 14px; margin-bottom: 8px; }
.intro ul { margin: 0; padding-left: 1.2em; }
h1 { font-size: 26px; margin: 8px 0 12px; }
.sec { margin-top: 40px; }
.sec h2 { font-size: 22px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }
.sec h3 { font-size: 17px; margin: 28px 0 12px; }
ul { padding-left: 1.4em; margin: 0; } li { margin: 2px 0; } li > ul { margin-top: 2px; }
/* 節の枠: h3 があればタイトル帯、中は左バー付きの項目見出しと字下げした子 */
.group { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-top: 16px; }
.group > h3 { margin: 0; padding: 10px 16px; font-size: 15px; background: var(--soft); border-bottom: 1px solid var(--line); }
.items { padding: 4px 20px 12px; }
.item { padding: 10px 0 2px; }
.item-title { margin: 0 0 6px; font-size: 15px; font-weight: 600; line-height: 1.3; padding-left: 10px; border-left: 3px solid var(--accent); }
.item-rest { font-weight: 400; margin-left: .5em; }
.item-title + ul { padding-left: calc(13px + 1.2em); }

/* 職務経歴: 一覧行が案件詳細の見出し（<summary>）を兼ねる */
.case { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; background: var(--bg); }
.case > summary { list-style: none; display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; cursor: pointer; }
.case > summary:hover { border-color: var(--accent); }
.case > summary::-webkit-details-marker { display: none; }
.case > summary::before { content: ""; flex: none; width: 8px; height: 8px; margin: 9px 0 0 2px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .15s; }
.case[open] > summary::before { transform: rotate(45deg); }
.case[open] > summary { border-bottom: 1px solid var(--line); background: var(--soft); border-radius: 8px 8px 0 0; }
.row-no { flex: none; font-size: 12px; font-weight: 700; color: var(--fg); background: var(--soft); border-radius: 999px; padding: 2px 10px; margin-top: 3px; }
.case[open] .row-no { background: var(--bg); }
.row-main { min-width: 0; flex: 1; display: block; }
.row-name { display: block; font-weight: 600; }
.row-meta { display: flex; flex-wrap: wrap; gap: 0 1.2em; font-size: 13px; color: var(--muted); }
.row-meta span + span::before { content: "/"; margin-right: 1.2em; color: var(--line); }
.case-body { padding: 4px 20px 16px; }
.sub h4 { font-size: 15px; margin: 18px 0 6px; padding-left: 10px; border-left: 3px solid var(--accent); }

/* 狭い画面: 目次をボタンで開く */
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; gap: 0; padding: 16px 16px 64px; }
  .header { padding: 0 12px; gap: 6px; }
  .header .brand { font-size: 14px; }
  .header nav { gap: 4px; }
  .btn { padding: 7px 8px; }
  #toc-toggle { display: inline-block; }
  .btn .long { display: none; }
  .btn .short { display: inline; }
  aside { display: none; position: fixed; inset: var(--header-h) 0 0 0; z-index: 10; background: var(--bg); padding: 16px; max-height: none; }
  body.toc-open aside { display: block; }
  body.toc-open { overflow: hidden; }
  .case-body { padding: 4px 14px 14px; }
}

/* 印刷: 目次とヘッダーを消し、案件はすべて開く（JS が beforeprint で open にする） */
@media print {
  .header, aside { display: none; }
  .layout { display: block; padding: 0; max-width: none; }
  body { font-size: 12px; }
  .case { break-inside: auto; }
  .case > summary { break-after: avoid; }
  .case > summary::before { display: none; }
  .sec h2 { break-after: avoid; }
  a { color: inherit; }
}
</style>
</head>
<body>
<header class="header">
  <span class="brand">${esc(title)}</span>
  <nav>
    <button type="button" class="btn" id="toc-toggle">目次</button>
    <button type="button" class="btn" id="toggle-all"><span class="long">すべて展開</span><span class="short">展開</span></button>
    <button type="button" class="btn primary" id="copy-md"><span class="long">Markdown を</span>コピー</button>
    <a class="btn" href="${encodeURI(pdfName)}" download>PDF</a>
    <a class="btn" href="${REPO_URL}">GitHub</a>
  </nav>
</header>
<div class="layout">
<aside aria-label="目次">${tocHtml}</aside>
<main>
<h1>${inline(title)}</h1>
<div class="intro">${block(intro)}</div>
${mainHtml}
</main>
</div>
<script type="text/markdown" id="source-md">${embeddedMd}</script>
<script>
(() => {
  const cases = [...document.querySelectorAll("details.case")];
  const toggleAll = document.getElementById("toggle-all");
  const setAll = (open) => { cases.forEach((d) => { d.open = open; }); syncToggle(); };
  const syncToggle = () => {
    const allOpen = cases.every((d) => d.open);
    toggleAll.querySelector(".long").textContent = allOpen ? "すべて閉じる" : "すべて展開";
    toggleAll.querySelector(".short").textContent = allOpen ? "閉じる" : "展開";
  };
  toggleAll.addEventListener("click", () => setAll(!cases.every((d) => d.open)));
  cases.forEach((d) => d.addEventListener("toggle", syncToggle));

  // 印刷（Cmd+P / PDF に保存）では案件詳細をすべて開き、終わったら元に戻す
  let before = [];
  addEventListener("beforeprint", () => { before = cases.map((d) => d.open); setAll(true); });
  addEventListener("afterprint", () => { cases.forEach((d, i) => { d.open = before[i]; }); syncToggle(); });

  // Markdown をコピー
  const copy = document.getElementById("copy-md");
  const copyLabel = copy.innerHTML;
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(document.getElementById("source-md").textContent); copy.textContent = "コピーしました"; }
    catch { copy.textContent = "コピーに失敗しました"; }
    setTimeout(() => { copy.innerHTML = copyLabel; }, 1500);
  });

  // #no-N で該当の案件を開く
  const openFromHash = () => { const t = location.hash && document.querySelector(location.hash); if (t?.tagName === "DETAILS") { t.open = true; } };
  addEventListener("hashchange", openFromHash); openFromHash();

  // 目次: 狭い画面での開閉と、現在位置の強調
  const tocToggle = document.getElementById("toc-toggle");
  tocToggle.addEventListener("click", () => document.body.classList.toggle("toc-open"));
  const tocLinks = [...document.querySelectorAll(".toc a")];
  tocLinks.forEach((a) => a.addEventListener("click", () => document.body.classList.remove("toc-open")));
  const byId = new Map(tocLinks.map((a) => [a.getAttribute("href").slice(1), a]));
  const targets = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const visible = new Set();
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => { e.isIntersecting ? visible.add(e.target) : visible.delete(e.target); });
    // 画面内にある見出しのうち、文書順で最初のものを現在位置とする
    const current = targets.find((t) => visible.has(t));
    if (!current) return;
    tocLinks.forEach((a) => a.classList.toggle("active", a === byId.get(current.id)));
  }, { rootMargin: "-52px 0px -70% 0px" });
  targets.forEach((t) => spy.observe(t));
})();
</script>
</body>
</html>
`;

await $`rm -rf ${OUT_DIR}`;
await $`mkdir -p ${OUT_DIR}`;
await Bun.write(`${OUT_DIR}/index.html`, html);
await $`cp ${SOURCE} ${pdfName} ${OUT_DIR}/`;

console.log(`生成: ${OUT_DIR}/index.html（案件 ${caseCount} 件, PDF: ${pdfName}）`);
