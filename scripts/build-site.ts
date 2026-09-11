#!/usr/bin/env bun
/**
 * README.md から GitHub Pages 用の静的サイトを dist/ に生成する。
 * 使い方: bun run build:site
 *
 * README の文章は加工しない。marked.lexer のトークンを、見出しの規約
 * （h2 = 大節 / h3 = グループ / h4 = 案件内の定型節 / `- **項目**` = 細目）に従って部品へ配置するだけ。
 * - 左に目次（h2 / h3）。現在位置を強調し、狭い画面ではボタンで開閉
 * - 基本情報はプロフィール型（外部リンクの GitHub からアバターを引く）。強み・技術スタックは節ごとの枠
 * - 技術スタック・案件の開発環境・職務経歴の行では、バッククォートで囲んだ名前（<code>）をタグ表示
 * - 職務経歴の一覧行と案件詳細は `[No.N]` で突き合わせ、一覧行を <details> の見出しにして詳細を中に入れる（Web 版だけの合体）
 * - 印刷時は案件詳細をすべて開く。右上に「Markdown をコピー」「PDF」「GitHub」。PDF は広い画面ではページ内のビューワーで開く
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

/**
 * タグ表示。README でバッククォートで囲んだ名前（<code>）をチップにする。
 * 対象は技術スタックの細目・案件の開発環境・職務経歴の行の技術部分だけで、文中のバッククォートは普通のコード表示のまま。
 * 隣り合うチップの間の区切り（", " "・"）は落とし、行頭の `ラベル:` は薄い色にする。
 */
function tagify(html: string): string {
  return html
    .replace(/<\/code>(?:, |・)<code>/g, "</code><code>")
    .replace(/<li>([^<]{1,40}?:)\s*(?=<code>)/g, '<li><span class="tl">$1</span>');
}

/** 子要素を描く。tags なら <code> をチップにする */
const children = (ts: Token[], tags: boolean) => (tags ? `<div class="tags">${tagify(block(ts))}</div>` : block(ts));

/**
 * `[名前](URL)（説明）` の行が並ぶ一覧（OSS の自作ツールなど）は、名前と説明を分けた行にする。
 * 形が合わない行（配布の説明など）は一覧の下の注記にまとめる。
 */
function linkList(list: Tokens.List): string | null {
  const rows: string[] = [];
  const notes: string[] = [];
  for (const item of list.items) {
    const text = (item.tokens[0] as Tokens.Text).text;
    const m = text.match(/^\[([^\]]+)\]\(([^)]+)\)（(.+)）$/);
    if (m) rows.push(`<li><a href="${esc(m[2])}">${inline(m[1])}</a><span class="d">${inline(m[3])}</span></li>`);
    else notes.push(`<p class="note">${inline(text)}</p>`);
  }
  if (rows.length < 2) return null;
  return `<div class="items"><ul class="link-rows">${rows.join("")}</ul>${notes.join("")}</div>`;
}

/** 箇条書きを「太字の項目 = 左バー付きの見出し + 字下げした子」に並べる。太字でない項目が混ざる一覧はそのまま置く */
function items(list: Tokens.List, tags = false): string {
  const parts = list.items.map(splitBoldItem);
  if (parts.some((p) => p === null)) return linkList(list) ?? `<div class="items"><div class="item">${block([list])}</div></div>`;
  return `<div class="items">${parts
    .map((p) => {
      const { label, rest, children: kids } = p!;
      const head = `<h4 class="item-title">${inline(label)}${rest ? `<span class="item-rest">${inline(rest)}</span>` : ""}</h4>`;
      return `<div class="item">${head}${children(kids, tags)}</div>`;
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

/**
 * 基本情報: `- **項目**: 値` の一覧をプロフィール型に配置する。
 * 「現在のポジション」を大きく、子の箇条書きを持つ項目（外部リンク）はチップ、残りは横並びの事実。
 * 外部リンクに GitHub があればアバター（https://github.com/<user>.png）を左に置く。
 */
function renderBasic(sec: Section) {
  const list = sec.body.find((t): t is Tokens.List => t.type === "list");
  if (!list) return group(`<div class="items"><div class="item">${block(sec.body)}</div></div>`);
  let position = "";
  const facts: string[] = [];
  const chips: string[] = [];
  let avatar = "";
  for (const item of list.items) {
    const p = splitBoldItem(item);
    if (!p) { facts.push(inline((item.tokens[0] as Tokens.Text).text)); continue; }
    const sub = p.children.find((t): t is Tokens.List => t.type === "list");
    if (sub) {
      for (const link of sub.items) {
        // `GitHub: https://…` → 名前をチップに、URL をリンク先に
        const text = (link.tokens[0] as Tokens.Text).text;
        const m = text.match(/^(.+?):\s*(\S+)$/);
        if (!m) { chips.push(`<span class="chip">${inline(text)}</span>`); continue; }
        chips.push(`<a class="chip" href="${esc(m[2])}">${inline(m[1])}</a>`);
        const gh = m[2].match(/^https:\/\/github\.com\/([^/?#]+)\/?$/);
        if (gh) avatar = `https://github.com/${gh[1]}.png?size=160`;
      }
    } else if (p.label === "現在のポジション") {
      position = inline(p.rest);
    } else {
      facts.push(`<span><b>${inline(p.label)}</b>${inline(p.rest)}</span>`);
    }
  }
  return `<div class="group profile">${avatar ? `<img class="avatar" src="${avatar}" alt="" width="80" height="80">` : ""}<div class="profile-main">${position ? `<div class="position">${position}</div>` : ""}<div class="facts">${facts.join("")}</div>${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}</div></div>`;
}

/** 強み（h3 なし）は h2 直下を 1 枠、技術スタックは h3 ごとに 1 枠 */
function renderGroups(sec: Section) {
  const tags = sec.heading.text === "技術スタック";
  const lists = (ts: Token[]) => ts.map((t) => (t.type === "list" ? items(t as Tokens.List, tags) : block([t]))).join("");
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
    block(lead) +
      groups
        .map((g) => `<section class="sub"><h4>${inline(g.heading.text)}</h4>${children(g.body, g.heading.text === "開発環境")}</section>`)
        .join(""),
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

// 目次: h2 と h3。技術スタックは h2 だけ、職務経歴は 会社 → 案件（No. + 案件名。客先の括弧は省く）の 2 段
const TOC_H2_ONLY = new Set(["技術スタック"]);
const casesOf = (g: Group) =>
  g.body
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((l) => l.items.map((i) => parseCaseHeading((i.tokens[0] as Tokens.Text).text)))
    // 目次の中はリンクにできない（<a> の入れ子になる）ので、リンク記法と客先の括弧を外す
    .map(({ no, name }) => {
      const label = name.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/（.*）$/, "");
      return `<li><a href="#no-${no}" title="${esc(label)}"><span class="k">No.${no}</span><span>${esc(label)}</span></a></li>`;
    })
    .join("");
const tocHtml = `<ol class="toc">${visibleSections
  .map((sec) => {
    const subs = TOC_H2_ONLY.has(sec.heading.text)
      ? ""
      : sec.subs
          .map((s) => {
            const cases = sec.heading.text === "職務経歴" ? casesOf(s) : "";
            // 職務経歴の会社名は「名前 + 年だけの期間」で 1 行に収める（全文は title に）
            const m = cases ? s.heading.text.match(/^(.*?)\s*\((\d{4})年\d+月 - (?:(\d{4})年\d+月|(現在))\)$/) : null;
            const label = m ? `${inline(m[1])}<span class="years">${m[2]}–${m[3] ?? m[4]}</span>` : inline(s.heading.text);
            return `<li><a href="#${idOf(s.heading.text)}" title="${esc(s.heading.text)}">${label}</a>${cases ? `<ol>${cases}</ol>` : ""}</li>`;
          })
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
  --bg: #ffffff; --fg: #1f2328; --muted: #424a53; --line: #d0d7de; --soft: #e8f0fe;
  --accent: #2563eb; --link: #1d4ed8; --tag: #f6f8fa;
  --header-h: 52px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --soft: #16233d; --accent: #3b82f6; --link: #60a5fa; --tag: #161b22; }
}
* { box-sizing: border-box; }
html { scroll-padding-top: calc(var(--header-h) + 16px); scroll-behavior: smooth; }
body { margin: 0; color: var(--fg); background: var(--bg); font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif; overflow-wrap: anywhere; }
a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }
code { font-size: .9em; background: var(--tag); border: 1px solid var(--line); padding: 0 .3em; border-radius: 4px; }

/* ヘッダー */
.header { position: sticky; top: 0; z-index: 20; height: var(--header-h); display: flex; align-items: center; gap: 8px; padding: 0 16px; background: var(--bg); border-bottom: 1px solid var(--line); transition: transform .25s ease; }
/* 下にスクロールしている間は隠し、上に戻すと現れる */
body.header-hidden .header { transform: translateY(-100%); }
#toc-toggle { display: none; width: 36px; height: 36px; padding: 0; border: 0; background: transparent; cursor: pointer; align-items: center; justify-content: center; }
#toc-toggle svg { width: 22px; height: 22px; stroke: var(--fg); fill: none; stroke-width: 2; stroke-linecap: round; }
.toc-backdrop { display: none; position: fixed; inset: 0; z-index: 9; background: rgba(0, 0, 0, .35); }
.header .brand { font-weight: 700; margin-right: auto; white-space: nowrap; }
.header nav { display: flex; gap: 6px; }
.btn { font: inherit; font-size: 13px; line-height: 1; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; cursor: pointer; white-space: nowrap; text-decoration: none; }
.btn:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.primary:hover { filter: brightness(1.08); color: #fff; }
.btn .short { display: none; }

/* 2 カラム */
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 40px; max-width: 1160px; margin: 0 auto; padding: 24px 24px 80px; }
aside { position: sticky; top: calc(var(--header-h) + 16px); align-self: start; max-height: calc(100vh - var(--header-h) - 32px); overflow-y: auto; font-size: 13px; }
/* 目次: ガイド線なし。h2 太字、会社は太字（期間なし）、案件は本文と同じ丸バッジの番号 + 名前 */
.toc, .toc ol { list-style: none; margin: 0; padding: 0; }
.toc a { display: block; color: var(--fg); border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toc a:hover { text-decoration: none; background: var(--soft); }
.toc > li { margin-bottom: 10px; }
.toc > li > a { font-weight: 700; padding: 4px 10px; }
.toc ol > li { margin-top: 6px; }
.toc ol > li > a { font-weight: 600; padding: 2px 10px 2px 16px; }
.toc .years { font-weight: 400; font-size: 12px; color: var(--muted); margin-left: 6px; font-variant-numeric: tabular-nums; }
.toc ol ol { margin-top: 2px; }
.toc ol ol li { margin-top: 0; }
.toc ol ol a { font-weight: 400; color: var(--muted); padding: 2px 10px 2px 16px; display: flex; align-items: center; gap: 8px; }
.toc ol ol a > span:last-child { overflow: hidden; text-overflow: ellipsis; }
.toc .k { flex: none; font-size: 11px; font-weight: 700; color: var(--fg); background: var(--soft); border-radius: 999px; padding: 0 7px; line-height: 18px; }
.toc a.active { color: var(--fg); background: var(--soft); }
.toc ol ol a.active .k { background: var(--bg); }
main { min-width: 0; }

/* 本文 */
.intro { font-size: 15px; margin-bottom: 8px; }
.intro ul { margin: 0; padding-left: 1.2em; }
h1 { font-size: 26px; margin: 8px 0 12px; }
.sec { margin-top: 40px; }
.sec h2 { font-size: 22px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); }
.sec h3 { font-size: 17px; margin: 28px 0 12px; }
ul { padding-left: 1.4em; margin: 0; } li { margin: 2px 0; } li > ul { margin-top: 2px; }
/* 節の枠: h3 があればタイトル帯、中は左バー付きの項目見出しと字下げした子 */
.group { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-top: 16px; box-shadow: 0 1px 3px rgba(31, 35, 40, .08); }
.group > h3 { margin: 0; padding: 10px 14px; font-size: 15px; background: var(--soft); border-bottom: 1px solid var(--line); border-left: 4px solid var(--accent); }
/* 基本情報 */
.profile { display: flex; gap: 20px; align-items: flex-start; padding: 16px 20px; }
.avatar { width: 80px; height: 80px; border-radius: 50%; border: 1px solid var(--line); flex: none; }
.profile-main { min-width: 0; }
.position { font-size: 18px; font-weight: 600; line-height: 1.3; margin: 4px 0 6px; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 20px; font-size: 15px; }
.facts b { color: var(--muted); font-weight: 600; margin-right: .4em; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.chip { display: inline-block; font-size: 14px; line-height: 1.4; padding: 4px 12px; border: 1px solid var(--line); border-radius: 999px; color: var(--fg); }
.chip:hover { border-color: var(--accent); text-decoration: none; }
.items { padding: 4px 20px 12px; }
.item { padding: 10px 0 2px; }
.item-title { margin: 0 0 6px; font-size: 15px; font-weight: 600; line-height: 1.3; padding-left: 10px; border-left: 3px solid var(--accent); }
.item-rest { font-weight: 400; margin-left: .5em; }
/* リンク付きの一覧（OSS のツール） */
.link-rows { list-style: none; padding: 0; margin: 6px 0 0; }
.link-rows li { display: flex; gap: 12px; align-items: baseline; padding: 8px 0; margin: 0; border-bottom: 1px solid var(--line); }
.link-rows li:last-child { border-bottom: 0; }
.link-rows a { font-weight: 600; flex: none; }
.link-rows .d { color: var(--muted); }
.note { color: var(--muted); font-size: 14px; margin: 4px 0 2px; padding-top: 8px; border-top: 1px solid var(--line); }
/* タグ: 対象の場所だけ <code> をチップにする */
.tags li { margin: 4px 0; }
.tl { color: var(--muted); margin-right: 6px; }
.tags code { font: inherit; font-size: 13px; line-height: 1.4; display: inline-block; padding: 1px 8px; margin: 2px 4px 2px 0; border: 1px solid var(--line); border-radius: 6px; background: var(--tag); }
/* 職務経歴の行の技術名は文字のまま（チップは技術スタックと開発環境だけ） */
.row-meta code { font: inherit; padding: 0; border: 0; background: transparent; color: var(--fg); }
.tags ul { padding-left: 1.2em; }
.item-title + ul, .item-title + .tags > ul { padding-left: calc(13px + 1.2em); }

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
.row-meta { display: flex; flex-wrap: wrap; gap: 0 1.2em; font-size: 14px; }
.row-meta > span:first-child { font-weight: 500; }
.row-meta span + span::before { content: "/"; margin-right: 1.2em; color: var(--line); }
.case-body { padding: 4px 20px 16px; }
.sub h4 { font-size: 15px; margin: 18px 0 6px; padding-left: 10px; border-left: 3px solid var(--accent); }

/* PDF ビューワー（広い画面のみ。狭い画面は新しいタブで開く） */
.pdf-modal { position: fixed; inset: 0; z-index: 30; display: flex; flex-direction: column; background: var(--bg); }
.pdf-modal[hidden] { display: none; }
.pdf-bar { height: var(--header-h); display: flex; align-items: center; gap: 6px; padding: 0 16px; border-bottom: 1px solid var(--line); }
.pdf-bar .brand { margin-right: auto; font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdf-modal iframe { flex: 1; border: 0; width: 100%; }

/* 狭い画面: 目次をボタンで開く */
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; gap: 0; padding: 16px 16px 64px; }
  .profile { gap: 14px; padding: 14px 16px; } .avatar { width: 56px; height: 56px; }
  .header { padding: 0 12px; gap: 6px; }
  .header .brand { font-size: 14px; }
  .header nav { gap: 4px; }
  .btn { padding: 7px 8px; }
  #toc-toggle { display: inline-flex; margin-left: -8px; }
  .btn .long { display: none; }
  .btn .short { display: inline; }
  aside { display: block; position: fixed; top: 0; left: 0; bottom: 0; width: min(300px, 85vw); height: 100vh; max-height: none; z-index: 25; background: var(--bg); padding: 16px; box-shadow: 2px 0 12px rgba(0, 0, 0, .15); transform: translateX(-100%); transition: transform .25s ease; }
  body.toc-open aside { transform: none; }
  body.toc-open .toc-backdrop { display: block; }
  body.toc-open { overflow: hidden; }
  .case-body { padding: 4px 14px 14px; }
}

/* 印刷: 目次とヘッダーを消し、案件はすべて開く（JS が beforeprint で open にする） */
@media print {
  .header, aside, .pdf-modal { display: none; }
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
  <button type="button" id="toc-toggle" aria-label="目次を開く" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
  <span class="brand">${esc(title)}</span>
  <nav>
    <button type="button" class="btn primary" id="copy-md"><span class="long">Markdown を</span>コピー</button>
    <a class="btn" id="open-pdf" href="${encodeURI(pdfName)}" target="_blank" rel="noopener">PDF</a>
    <a class="btn" href="${REPO_URL}">GitHub</a>
  </nav>
</header>
<div class="pdf-modal" id="pdf-modal" hidden>
  <div class="pdf-bar">
    <span class="brand">${esc(pdfName)}</span>
    <a class="btn" href="${encodeURI(pdfName)}" target="_blank" rel="noopener">新しいタブで開く</a>
    <a class="btn" href="${encodeURI(pdfName)}" download>ダウンロード</a>
    <button type="button" class="btn" id="close-pdf">閉じる</button>
  </div>
  <iframe title="PDF" data-src="${encodeURI(pdfName)}"></iframe>
</div>
<div class="toc-backdrop" id="toc-backdrop"></div>
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

  // 印刷（Cmd+P / PDF に保存）では案件詳細をすべて開き、終わったら元に戻す
  let before = [];
  addEventListener("beforeprint", () => { before = cases.map((d) => d.open); cases.forEach((d) => { d.open = true; }); });
  addEventListener("afterprint", () => { cases.forEach((d, i) => { d.open = before[i]; }); });

  // PDF: 広い画面ではページ内のビューワー（iframe）で開く。狭い画面はブラウザのビューワー（新しいタブ）に任せる
  const modal = document.getElementById("pdf-modal");
  const frame = modal.querySelector("iframe");
  document.getElementById("open-pdf").addEventListener("click", (e) => {
    if (matchMedia("(max-width: 900px)").matches) return;
    e.preventDefault();
    if (!frame.src) frame.src = frame.dataset.src;
    modal.hidden = false;
  });
  const closePdf = () => { modal.hidden = true; };
  document.getElementById("close-pdf").addEventListener("click", closePdf);
  addEventListener("keydown", (e) => { if (e.key === "Escape") closePdf(); });

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
  const setToc = (open) => { document.body.classList.toggle("toc-open", open); tocToggle.setAttribute("aria-expanded", String(open)); };
  tocToggle.addEventListener("click", () => setToc(!document.body.classList.contains("toc-open")));
  document.getElementById("toc-backdrop").addEventListener("click", () => setToc(false));
  const tocLinks = [...document.querySelectorAll(".toc a")];
  tocLinks.forEach((a) => a.addEventListener("click", () => setToc(false)));

  // ヘッダー: 下にスクロールしたら隠し、上に戻したら出す
  let lastY = scrollY;
  addEventListener("scroll", () => {
    const y = scrollY;
    const down = y > lastY && y > 80;
    document.body.classList.toggle("header-hidden", down);
    lastY = y;
  }, { passive: true });
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
