#!/usr/bin/env bun
/**
 * 箇条書きが 1 行に収まるかを実測する。
 * 使い方: bun run check:width [README.md] [--width 730] [--slack 1.1] [--top 12] [--all]
 *        bun run check:width --text "候補の文字列" --text "別の候補" [--depth 2]
 *
 * --text の候補には、読点（、）があれば数も出す。新しく書く行は読点なしにする（skillsheet-wording「読点」）。
 *
 * --text は README に書く前の候補を、一時ファイルを作らずにその場で測るためのもの。
 * --depth は箇条書きの深さ（既定 2 = `  - ` で始まる説明行）。
 *
 * 目的は「全部を 1 行にする」ことではなく、あと少し削れば 1 行になる行を見つけること。
 * したがって既定では、はみ出しが --slack 倍までの行（＝数文字削れば収まる行）を、
 * 削る文字数が少ない順に --top 件だけ報告する。段落として複数行を前提にしている長い行は無視する。
 * --all で全件の実測値を出す。
 *
 * 既定の --width 730 は GitHub の README 表示幅の実測値。この幅だと深さ 2 の箇条書き
 * （`  - ` で始まる説明行）に使えるのは 730 - 64 = 666px で、
 * 実機で 1 行だった 661px の行は収まり、折り返した 690px の行は収まらない。
 */
import puppeteer from "puppeteer";

const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
/** 値を取るフラグの引数を、ファイル名と取り違えないように集めておく */
const BOOL_FLAGS = new Set(["--all"]);
const flagValues = new Set(
  args.filter((a, i) => i > 0 && args[i - 1].startsWith("--") && !BOOL_FLAGS.has(args[i - 1])),
);
const texts = args.filter((a, i) => i > 0 && args[i - 1] === "--text");
const file = args.find((a) => !a.startsWith("--") && !flagValues.has(a) && !/^[\d.]+$/.test(a)) ?? "README.md";
const width = flag("width", 730);
const slack = flag("slack", 1.1);
const top = flag("top", 12);
const showAll = args.includes("--all") || texts.length > 0;

const INDENT_PX = 32; // GitHub の ul は padding-left: 2em（16px × 2）

/** Markdown の装飾を落として、実際に表示される文字列にする */
const toDisplayText = (s: string) =>
  s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1");

/**
 * 測るための HTML。コード（`名前`）と太字は GitHub と同じ描き方で測る。
 * 記号を外しただけの文字列で測ると、等幅の字体と左右の余白のぶん狭く出て、
 * 技術名が並ぶ行（職務経歴の一覧行など）を「1 行に収まる」と見誤る（664px と出た行が実際は折り返した）
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toMeasureHtml = (s: string) =>
  esc(s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]*)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]*)\*/g, "<i>$1</i>");

type Target = { line: number; depth: number; text: string; html: string; usable: number };

const targets: Target[] = [];
if (texts.length > 0) {
  const depth = flag("depth", 2);
  texts.forEach((t, i) => {
    targets.push({ line: i + 1, depth, text: toDisplayText(t), html: toMeasureHtml(t), usable: width - depth * INDENT_PX });
  });
} else {
  const src = await Bun.file(file).text();
  src.split("\n").forEach((raw, i) => {
    const m = raw.match(/^(\s*)[-*] (.+)$/);
    if (!m) return;
    const depth = Math.floor(m[1].length / 2) + 1;
    targets.push({
      line: i + 1,
      depth,
      text: toDisplayText(m[2]),
      html: toMeasureHtml(m[2]),
      usable: width - depth * INDENT_PX,
    });
  });
}

const browser = await puppeteer.launch();
try {
  const page = await browser.newPage();
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; }
      #probe { position: absolute; white-space: nowrap; visibility: hidden; }
      /* GitHub の Markdown 表示と同じ値 */
      #probe code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 85%; padding: 0.2em 0.4em; }
      #probe b { font-weight: 600; }
    </style><span id="probe"></span>`,
    { waitUntil: "load" },
  );
  const widths: number[] = await page.evaluate((htmls: string[]) => {
    const probe = document.getElementById("probe") as HTMLElement;
    return htmls.map((h) => {
      probe.innerHTML = h;
      return Math.round(probe.getBoundingClientRect().width);
    });
  }, targets.map((t) => t.html));

  const rows = targets.map((t, i) => ({ ...t, px: widths[i] }));
  const over = rows.filter((r) => r.px > r.usable);
  const close = over
    .filter((r) => r.px <= r.usable * slack)
    .sort((a, b) => a.px - a.usable - (b.px - b.usable));

  console.log(
    texts.length > 0
      ? `本文幅 ${width}px・深さ ${targets[0].depth} で計測（候補 ${rows.length} 件）`
      : `本文幅 ${width}px で計測（箇条書き ${rows.length} 行）`,
  );
  if (showAll) {
    for (const r of rows) {
      const mark = r.px > r.usable ? "折返" : "1行";
      const label = texts.length > 0 ? `#${r.line}` : `L${r.line}`;
      // 新しく書く行は読点なしにする（skillsheet-wording「読点」）。下書きの段階で気づけるよう、候補には読点の数も出す
      const commas = (r.text.match(/、/g) ?? []).length;
      const ten = texts.length > 0 && commas ? `【読点 ${commas}】` : "";
      console.log(`  ${mark}  ${String(r.px).padStart(4)}/${r.usable}px  ${label}  ${ten}${r.text}`);
    }
    const withCommas = texts.length > 0 ? rows.filter((r) => r.text.includes("、")).length : 0;
    if (withCommas) console.log(`読点のある候補: ${withCommas} 件。新しく書く行は読点なしにし、並べるときは「・」で区切る（skillsheet-wording「読点」）`);
  }

  if (close.length === 0) {
    console.log(`あと少しで 1 行に収まる行: なし（はみ出し ${Math.round((slack - 1) * 100)}% 以内の行が対象）`);
  } else {
    console.log(`あと少しで 1 行に収まる行: ${close.length} 件（削る文字数が少ない順に ${Math.min(top, close.length)} 件）`);
    for (const r of close.slice(0, top)) {
      const perChar = r.px / Math.max(r.text.length, 1);
      const cut = Math.ceil((r.px - r.usable) / perChar);
      console.log(`  L${r.line}  ${r.px}px / 使える幅 ${r.usable}px（約 ${cut} 文字分オーバー）`);
      console.log(`        ${r.text}`);
    }
  }

  const far = over.length - close.length;
  if (far > 0) {
    console.log(`（複数行を前提とみなして除外: ${far} 件）`);
  }
} finally {
  await browser.close();
}
