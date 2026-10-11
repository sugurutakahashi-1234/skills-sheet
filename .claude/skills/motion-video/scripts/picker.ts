#!/usr/bin/env bun
/**
 * 案（静止画・動画・文）と BGM の選択票を 1 枚の HTML に組む。本人は選んで「回答をまとめてコピー」し、会話に貼り戻す。
 * relay.ts の open で開けば [送信] が出て、貼り戻しなしで agent に届く（agent は relay.ts wait で読む）。
 *
 * - 決めごとが複数あるときは pages に並べ、1 枚の中でタブで切り替える（ページを何枚も開かせない）
 * - タブには各ページの状態（未回答 / 回答済み / 送信済み / 送信後に変更、確認用のページは 未確認 / 確認済み）が出る。
 *   最後のタブ「回答のまとめ」に全ページの回答が集まり、未回答のページへ飛べる。コピーした回答の末尾には進み具合の 1 行が付く
 * - mode "keep": 案（列）を最大 N 個選ぶ。足切りは keep 3、方向やキービジュアルを決めるときは keep 1
 * - mode "pick": 件（行）ごとに 1 案を選ぶ。場面ごとに絵を混ぜるときと、文書の指摘や仕分けを件ごとに決めるとき。
 *   文の案はラジオ風に縦に並び、各件に「何を決めるか」の 1 行（why）と現状、各案にメリット・デメリットの 1 行が付く。
 *   推す案は地の色で分かり、最初から選ばれているので、本人は違う件だけ押す。
 *   案を出さず文で答えてもらう問いは ask
 * - mode "view": 選ばせずに見せるだけ（言われたとおりに直した点の確認など）。案ごとのメモ欄だけ付く
 * - mode "check": 自分で決めた扱い（落とす・残す…）を 1 件 1 行で見せ、違う件だけ「戻す」を押してもらう。何もしなければそのまま進む。
 *   答えが決まっている件を票にしない（人の判断の回数を減らす）ための形
 * - 案が文だけ（text か before/after だけで画像・動画が無い）のページは、横並びにせず縦に 1 列で並べる。
 *   文は改行ごとの行・「1. 」の番号つきの並び・空行の段落の間で出す。before / after は「直す前」「直した後」の 2 段に分けて出す。
 *   文の中の {+足す+} は緑の下線、{-消す-} は赤の取り消し線になる
 * - 選ぶボタンの言葉は場面で変わる（keep 1 と pick は「これにする」、keep 2 以上は「候補に残す」）。ページの button で上書きできる。
 *   押した後は「選択中」になり、もう一度押すと戻る
 * - recommend で推す案を明示する（札「おすすめ」と理由 1 行）。選ばなかった件は回答に「未選択 → おすすめ」と出るので、答えなくても進められる
 * - BGM は何曲でも並べられる。1 曲を再生すると他は止まる（止めた位置は残す。頭に戻すと聴き直しづらい）
 * - 入力はブラウザに保存する（作り直しても同じ storageKey なら残る）。作り直したら開き直さず、本人に再読み込みしてもらう
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Column = {
  key: string;
  name: string;
  /** 画像とメモのファイル名に入る名前（既定は key） */
  file?: string;
  /** 画像の代わりに出す文。{+足す+} と {-消す-} の印が使える */
  text?: string;
  /** 「直す前」「直した後」を 2 段に分けて出す（確認用）。after だけでもよい */
  before?: string;
  after?: string;
  /** この案のメリットとデメリット（1 行ずつ）。文の案を縦に並べるとき、案の名前の下に出る */
  pros?: string;
  cons?: string;
};

/** 件ごとの案（pick で列の代わりに行に書く） */
export type Option = { key: string; name: string; text?: string; pros?: string; cons?: string };

export type Row = {
  key: string;
  name: string;
  /** 見出しの横の補足（時刻・場所・識別子など）。check では name を「何の件か」の日本語にし、ID や日付はこちらに書く */
  sub?: string;
  /** この件で何を決めるのか・なぜ今こう提案するのかの 1 行。pick で見出しの下に出す */
  why?: string;
  /** この件の現状の文。pick で案の上に 1 回出す（長くてよい。小さく出る） */
  now?: string;
  /** 案ごとの文（列の key → 文）。pick で件ごとに文が違うときに使う。列の text が共通の文（「このまま」など） */
  text?: Record<string, string>;
  /** 列の代わりに、この件だけの案を並べる（案の数や言葉が件ごとに違うとき） */
  options?: Option[];
  /** 案を出さず、答えを文で書いてもらう問い。書いた文がそのまま答えになる */
  ask?: string;
  /** この件で推す案の key（ページの recommend より優先）。推す案は最初から選ばれた状態で出る */
  recommend?: string;
  /** check で、この件の扱い（「落とす」「まとめる」など）。無ければページの tag */
  tag?: string;
};

export type Page = {
  title: string;
  /** ページの見出しの横に出す断り（例: どれも未完成のコマです） */
  note?: string;
  /** keep = 案を N 個選ぶ / pick = 件ごとに 1 案 / view = 見せるだけ / check = 決めた扱いを 1 行ずつ見せ、違う件だけ「戻す」 */
  mode?: "keep" | "pick" | "view" | "check";
  /** check で、行に tag が無いときの扱い（「落とす」「残す」など） */
  tag?: string;
  /** check の扱いの凡例。name が札の文字、meaning が意味、tone が色（red / green / blue / grey）。ページの頭に並び、札にも同じ色が付く */
  tags?: { name: string; meaning?: string; tone?: "red" | "green" | "blue" | "grey" }[];
  /** mode "keep" で選べる数。既定 3 */
  keep?: number;
  /** 選ぶボタンの言葉。既定は keep 1 と pick が「これにする」、keep 2 以上が「候補に残す」 */
  button?: string;
  /** pick の 2 つ目のボタン（選んだうえで方向を伝える）。既定は絵なら「この方向でもっと」、文なら無し。false で消す */
  more?: string | false;
  /** before / after の見出し。既定は「直す前」「直した後」。仕分けなら ["元の件", "扱い"] のように */
  labels?: [string, string];
  /** 案。file は画像とメモのファイル名に入る名前（既定は key）。text / before / after を書くと画像の代わりに文を出す */
  columns?: Column[];
  /** 件（場面・指摘） */
  rows?: Row[];
  /** 画像の場所。出力 HTML からの相対パスで、{file} と {row} を置き換える。.mp4 / .webm なら音なしで繰り返し再生する動画として並べる */
  images?: string;
  /** 動きのメモの JSON（{row: メモ} か、場面順の配列）。{file} を置き換える。任意 */
  notes?: string;
  /** 推す案の key と、推す理由 1 行 */
  recommend?: { key: string; reason?: string };
  /** BGM の候補 */
  audio?: { key: string; name: string; desc?: string; src: string }[];
};

export type Spec = Page & {
  /** 決めごとが複数あるとき。各ページは Page と同じ形。無ければ Spec 自身を 1 ページとして使う */
  pages?: Page[];
  /** ブラウザに保存するときの名前。既定は title */
  storageKey?: string;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** エスケープしたあとで {+…+} を ins、{-…-} を del にする */
const marks = (s: string) => esc(s).replace(/\{\+([\s\S]*?)\+\}/g, "<ins>$1</ins>").replace(/\{-([\s\S]*?)-\}/g, "<del>$1</del>");
const hasMarks = (s: string | undefined) => !!s && /\{\+[\s\S]*?\+\}|\{-[\s\S]*?-\}/.test(s);

/** 文を改行ごとに 1 行として出す。「1. 」で始まる行は番号つきの並び（行ごと {+ +} で囲んであってもよい）、空の行は段落の間 */
function textBlock(text: string, cls = "txt"): string {
  let html = "", list = false;
  for (const line of text.split("\n")) {
    const m = line.match(/^(\{[+-])?(\d+)\.\s+(.*)$/);
    if (m) { html += `${list ? "" : "<ol>"}<li value="${m[2]}">${marks((m[1] ?? "") + m[3])}</li>`; list = true; continue; }
    if (list) { html += "</ol>"; list = false; }
    html += line.trim() ? `<p>${marks(line)}</p>` : '<p class="gap"></p>';
  }
  return `<div class="${cls}">${html}${list ? "</ol>" : ""}</div>`;
}

/** 「直す前」「直した後」の 2 段 */
const beforeAfter = (before: string | undefined, after: string, labels: [string, string] = ["直す前", "直した後"]) =>
  `<div class="ba">${before !== undefined ? `<div class="b"><span class="lbl">${esc(labels[0])}</span>${textBlock(before, "t")}</div>` : ""}<div class="a"><span class="lbl">${esc(labels[1])}</span>${textBlock(after, "t")}</div></div>`;

const isText = (c: Column) => c.text !== undefined || c.after !== undefined;
/** 列が無くても、行が自分の案（options）か問い（ask）を持てば選択票になる */
const hasRowCards = (p: Page) => (p.rows ?? []).some((r) => r.options !== undefined || r.ask !== undefined);

function renderPage(p: Page, pi: number, baseDir: string, next: string | null): string {
  const fill = (t: string, file: string, row = "") => t.replaceAll("{file}", file).replaceAll("{row}", row);
  const noteOf = (file: string, row: string, index: number) => {
    if (!p.notes) return "";
    const path = join(baseDir, fill(p.notes, file));
    if (!existsSync(path)) return "";
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(data) ? data[index] ?? "" : data[row] ?? "";
  };
  const rows = p.rows ?? [];
  const cols = p.columns ?? [];
  const mode = p.mode ?? "keep";
  const cellText = (c: Column, r: Row) => r.text?.[c.key] ?? c.text;
  const figure = (c: Column, r: Row, index: number, label: boolean) => {
    if (c.after !== undefined) return `<figure>${beforeAfter(c.before, c.after, p.labels)}</figure>`;
    const text = cellText(c, r);
    if (text !== undefined) return `<figure>${textBlock(text)}</figure>`;
    const file = c.file ?? c.key;
    const src = fill(p.images ?? "", file, r.key);
    const cap = `${label ? `${esc(r.name)}：` : ""}${esc(noteOf(file, r.key, index))}`;
    const media = /\.(mp4|webm|mov)$/i.test(src)
      ? `<video src="${esc(src)}" autoplay loop muted playsinline></video>` // 動きの見本は数秒の動画で並べる（音なしで繰り返す）
      : `<img src="${esc(src)}" alt="" loading="lazy">`;
    return p.images && existsSync(join(baseDir, src))
      ? `<figure>${media}<figcaption>${cap}</figcaption></figure>`
      : `<figure><div class="missing">${esc(r.name)}：まだ無い</div></figure>`;
  };
  const rec = p.recommend?.key;
  const badge = (key: string, recKey = rec) => (key === recKey ? '<span class="rec">おすすめ</span>' : "");
  // 選ぶボタンの言葉は場面で決まる。1 つに決めるなら「これにする」、足切りなら「候補に残す」
  const keepN = p.keep ?? 3;
  const button = p.button ?? (mode === "keep" && keepN > 1 ? "候補に残す" : "これにする");
  const btn = (cls: string) => `<button class="${cls}" data-label="${esc(button)}">${esc(button)}</button>`;
  // 案が文だけなら縦に 1 列で並べる（横並びの狭いカードでは 1 行が短く折れて読みにくい）
  const textOnly = cols.length > 0 && (mode === "keep" || mode === "view") && cols.every(isText);
  // 件ごとの案。行に options があればそれ、無ければ列を案にする（文は行の text → 列の text の順）
  const optionsOf = (r: Row): Option[] => r.options ?? cols.map((c) => ({ key: c.key, name: c.name, text: cellText(c, r), pros: c.pros, cons: c.cons }));
  const pickText = mode === "pick" && rows.some((r) => r.ask !== undefined || r.options !== undefined || cols.some((c) => cellText(c, r) !== undefined));
  const more = p.more === false ? null : p.more ?? (pickText ? null : "この方向でもっと");
  const marked = cols.some((c) => hasMarks(c.text) || hasMarks(c.before) || hasMarks(c.after)) || rows.some((r) => hasMarks(r.now) || hasMarks(r.why) || Object.values(r.text ?? {}).some(hasMarks) || (r.options ?? []).some((o) => hasMarks(o.text)));
  let body = "";
  if (mode === "check") {
    // 決めた扱いを 1 件ずつ。見て、違う件だけ「戻す」を押す。何もしなければそのまま
    const tone = (name: string) => p.tags?.find((t) => t.name === name)?.tone;
    const tagc = (name: string) => `<span class="tagc${tone(name) ? ` ${tone(name)}` : ""}">${esc(name)}</span>`;
    const legend = p.tags?.length ? `<div class="tlegend">${p.tags.map((t) => `<span>${tagc(t.name)}${t.meaning ? `<span class="tm">${esc(t.meaning)}</span>` : ""}</span>`).join("")}</div>` : "";
    body = `${legend}<div class="checks">${rows
      .map((r) => `<div class="chk" data-row="${esc(r.key)}">${tagc(r.tag ?? p.tag ?? "")}<div class="cbody"><b>${esc(r.name)}</b>${r.why ? `<span class="cwhy">${marks(r.why)}</span>` : ""}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</div><button class="undo" data-label="戻す">戻す</button><textarea class="memo cmemo" data-memo="${esc(r.key)}" placeholder="戻す理由・代わりの扱い（任意）"></textarea></div>`)
      .join("")}</div>`;
  } else if (cols.length && (mode === "keep" || mode === "view")) {
    const ph = mode === "view" ? "この直しへの一言（任意）" : "この案への一言（任意）";
    body = `<div class="grid${textOnly ? " list" : ""}">${cols
      .map((c) => `<div class="card${mode === "keep" ? " col" : ""}" data-col="${esc(c.key)}"><div class="head"><b>${esc(c.key)}</b><span class="nm">${esc(c.name)}</span>${badge(c.key)}${mode === "keep" ? btn("keep") : ""}</div>${rows.map((r, i) => figure(c, r, i, rows.length > 1)).join("")}<textarea class="memo" data-memo="${esc(c.key)}" placeholder="${ph}"></textarea></div>`)
      .join("")}</div>`;
  } else if (pickText) {
    // 文の案は件ごとに縦に並べる。見出し → 何を決めるか 1 行 → 現状（小さく） → 案（推す案は最初から選ばれている） → 一言
    body = rows
      .map((r) => {
        const recKey = r.recommend ?? rec;
        const head = `<h3>${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</h3>${r.why ? `<p class="point">${marks(r.why)}</p>` : ""}${r.now !== undefined ? `<div class="now"><span class="lbl">現状</span>${textBlock(r.now, "t")}</div>` : ""}`;
        if (r.ask !== undefined) return `<section class="row ask" data-row="${esc(r.key)}">${head}<textarea class="memo" data-memo="${esc(r.key)}" placeholder="${esc(r.ask || "答えを書く")}"></textarea></section>`;
        // ラジオ風: 左に丸、名前が太字、その下に本文とメリット・デメリット。おすすめは押す前から地の色で分かる
        const opts = optionsOf(r);
        const list = opts
          .map((o) => `<div class="opt${o.key === recKey ? " isrec" : ""}" data-row="${esc(r.key)}" data-col="${esc(o.key)}"><div class="dot"></div><div class="name">${esc(o.key)} ${esc(o.name)}${badge(o.key, recKey)}</div>${o.text !== undefined ? `<div class="obody">${textBlock(o.text)}</div>` : ""}${o.pros || o.cons ? `<div class="md">${o.pros ? `<span class="m">${marks(o.pros)}</span>` : ""}${o.cons ? `<span class="d">${marks(o.cons)}</span>` : ""}</div>` : ""}</div>`)
          .join("");
        return `<section class="row" data-row="${esc(r.key)}">${head}<div class="opts">${list}</div><textarea class="memo" data-memo="${esc(r.key)}" placeholder="この件への一言・自分で直した文（任意）"></textarea></section>`;
      })
      .join("");
  } else if (cols.length) {
    body = rows
      .map((r, i) => {
        const recKey = r.recommend ?? rec;
        const head = `<h3>${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</h3>${r.why ? `<p class="point">${marks(r.why)}</p>` : ""}`;
        const cards = cols
          .map((c) => `<div class="card" data-row="${esc(r.key)}" data-col="${esc(c.key)}">${figure(c, r, i, false)}<div class="meta"><b>${esc(c.key)}</b> ${esc(c.name)}${badge(c.key, recKey)}</div><div class="btns">${btn("pick")}${more ? `<button class="more">${esc(more)}</button>` : ""}</div></div>`)
          .join("");
        return `<section class="row" data-row="${esc(r.key)}">${head}<div class="cards" style="--n:${cols.length}">${cards}</div><textarea class="memo" data-memo="${esc(r.key)}" placeholder="この場面への一言（任意）"></textarea></section>`;
      })
      .join("");
  }
  const audio = p.audio?.length
    ? `<section class="box"><h3>BGM（1 曲を再生すると他は止まります）</h3><div class="tracks">${p.audio
        .map((a) => `<div class="track" data-track="${esc(a.key)}"><div><b>${esc(a.key)}</b> ${esc(a.name)}${badge(a.key)}${a.desc ? `<p>${esc(a.desc)}</p>` : ""}<audio controls preload="none" src="${esc(a.src)}"></audio></div><button class="song">これ</button></div>`)
        .join("")}</div><textarea class="memo" data-memo="bgm" placeholder="BGM への一言（任意）"></textarea></section>`
    : "";
  const legend = marked ? '<span class="legend"><ins>足す</ins>／<del>消す</del></span>' : "";
  const head = `<div class="phead"><h2>${esc(p.title)}</h2><span class="chip st"></span>${p.note ? `<span class="warn">${esc(p.note)}</span>` : ""}${legend}${rec ? `<span class="recline"><span class="rec">おすすめ</span> ${esc(rec)}${p.recommend?.reason ? `：${esc(p.recommend.reason)}` : ""}</span>` : ""}<span class="count"></span></div>`;
  const nav = next === null ? "" : `<div class="nextbar"><button class="next on" data-go="${pi + 1}">${esc(next)} →</button></div>`;
  // 文だけのページは絵のページより幅を絞る（幅はどのタブでも同じにする）
  return `<section class="page${textOnly || pickText || mode === "check" ? " narrow" : ""}" data-p="${pi}">${head}${body}${audio}<textarea class="memo" data-memo="page" placeholder="このページへの一言（任意）"></textarea>${nav}</section>`;
}

export function build(spec: Spec, baseDir: string): string {
  const pages: Page[] = spec.pages?.length ? spec.pages : [spec];
  const multi = pages.length > 1;
  const sumIndex = pages.length;
  const cfg = JSON.stringify({
    storageKey: spec.storageKey ?? spec.title,
    multi,
    pages: pages.map((p) => ({
      title: p.title,
      mode: p.mode === "check" ? "check" : p.columns?.length ? p.mode ?? "keep" : hasRowCards(p) ? "pick" : "none",
      keep: p.keep ?? 3,
      cols: Object.fromEntries((p.columns ?? []).map((c) => [c.key, c.name])),
      // [key, 名前, 推す案, 文で答える問いか, 件ごとの案の名前]
      rows: (p.rows ?? []).map((r) => [r.key, r.name, r.recommend ?? p.recommend?.key ?? null, r.ask !== undefined ? 1 : 0, r.options ? Object.fromEntries(r.options.map((o) => [o.key, o.name])) : null]),
      rec: p.recommend?.key ?? null,
      audio: !!p.audio?.length,
    })),
  });
  const nextLabel = (i: number) => (!multi ? null : i + 1 < pages.length ? `次へ: ${pages[i + 1].title}` : "回答のまとめへ");
  const tabs = multi
    ? `<nav id="tabs">${pages.map((p, i) => `<button class="tab" data-p="${i}"><span class="num">${i + 1}</span>${esc(p.title)}<span class="chip st"></span></button>`).join("")}<button class="tab sumtab" data-p="${sumIndex}">回答のまとめ<span class="chip st"></span></button></nav>`
    : "";
  const summary = `<section class="page summary${multi ? "" : " single"}" data-p="${sumIndex}">
  ${multi ? '<div class="phead"><h2>回答のまとめ</h2><span id="prog"></span></div><div id="sumlist"></div>' : ""}
  <section class="box">
    <h3>全体へのコメント</h3>
    <textarea id="allmemo" class="memo" placeholder="組み合わせたい要素など（任意）"></textarea>
    <p class="actions"><button id="send" class="on" hidden>${multi ? "回答をまとめて送信" : "回答を送信"}</button><button id="copy" class="on">${multi ? "回答をまとめてコピー" : "回答をコピー"}</button><button id="selall">全選択</button><span id="sendmsg" class="warn"></span></p>
    <textarea id="out" readonly placeholder="「回答をコピー」で、ここに選んだ内容が出ます。コピーできないときは全選択してチャットに貼ってください"></textarea>
  </section>
</section>`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title)}</title>
<style>
  :root { --ink: #111318; --sub: #5d6372; --line: #e3e6ec; --blue: #2f5bff; --bg: #f4f6fa; --card: #fff;
          --todo-bg: #fff1e6; --todo: #b54708; --done-bg: #e8efff; --done: #2f5bff; --sent-bg: #e3f6ec; --sent: #1a7f37; --chg-bg: #fff6d6; --chg: #8a6100;
          --ins: #15803d; --ins-bg: rgba(34, 197, 94, .12); --del: #b91c1c; --before: #e5a3a3; --after: #86c99a; --rec-bg: #fff0f5;
          --t-red: #b42318; --t-red-bg: #fde8e8; --t-green: #1a7f37; --t-green-bg: #e3f6ec; --t-blue: #175cd3; --t-blue-bg: #e8efff; --t-grey: #5d6372; --t-grey-bg: #eaeef2; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink: #e9ebf0; --sub: #a3a9b6; --line: #2c313b; --bg: #15181e; --card: #1d2129;
          --todo-bg: #3a2a1c; --todo: #ffb27a; --done-bg: #1f2a4a; --done: #9db4ff; --sent-bg: #173326; --sent: #7fd6a0; --chg-bg: #3a3218; --chg: #f0cf6a;
          --ins: #7fd6a0; --ins-bg: rgba(34, 197, 94, .18); --del: #ff8a8a; --before: #7a3b3b; --after: #2f6b45; --rec-bg: #3a1f2c;
          --t-red: #ff9a9a; --t-red-bg: #3a2020; --t-green: #7fd6a0; --t-green-bg: #173326; --t-blue: #9db4ff; --t-blue-bg: #1f2a4a; --t-grey: #a3a9b6; --t-grey-bg: #2c313b; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; }
  header { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); padding: 10px 16px; }
  header .top { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
  header h1 { font-size: 18px; margin: 0; }
  #tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .tab { font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
  .tab .num { font-size: 12px; opacity: .6; }
  .tab.active { outline: 2px solid var(--ink); outline-offset: -1px; }
  .sumtab { margin-left: auto; }
  .chip { font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--line); color: var(--sub); }
  .chip:empty { display: none; }
  .chip.todo { background: var(--todo-bg); color: var(--todo); }
  .chip.done { background: var(--done-bg); color: var(--done); }
  .chip.sent { background: var(--sent-bg); color: var(--sent); }
  .chip.chg { background: var(--chg-bg); color: var(--chg); }
  .warn, .legend { font-size: 13px; color: var(--sub); }
  button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
  button.on { background: var(--blue); border-color: var(--blue); color: #fff; }
  main { max-width: 1600px; margin: 0 auto; padding: 16px; }
  .page { display: none; }
  .page.active, .page.single { display: block; }
  .phead { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-bottom: 12px; }
  .phead h2 { font-size: 17px; margin: 0; }
  .count { margin-left: auto; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .cards { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 1100px) { .grid, .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 640px) { .grid, .cards { grid-template-columns: 1fr; } }
  .page.narrow { max-width: 1240px; }
  .checks { display: grid; gap: 4px; }
  .chk { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 14px; align-items: center; padding: 8px 12px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
  .chk.undo { border-color: var(--todo); background: var(--todo-bg); }
  .tagc { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--line); color: var(--ink); white-space: nowrap; }
  .tagc.red { background: var(--t-red-bg); color: var(--t-red); } .tagc.green { background: var(--t-green-bg); color: var(--t-green); }
  .tagc.blue { background: var(--t-blue-bg); color: var(--t-blue); } .tagc.grey { background: var(--t-grey-bg); color: var(--t-grey); }
  .tlegend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--sub); margin: 0 0 10px; }
  .tlegend .tagc { margin-right: 6px; }
  .chk.undo .tagc { text-decoration: line-through; opacity: .6; }
  .cbody { min-width: 0; font-size: 14px; line-height: 1.6; }
  .cbody b { display: block; font-size: 15px; }
  .cbody small { display: block; color: var(--sub); font-size: 12px; opacity: .8; }
  .cwhy { color: var(--sub); }
  .cwhy::before { content: "→ "; }
  .chk .undo { white-space: nowrap; }
  .chk .cmemo { grid-column: 1 / -1; display: none; margin-top: 2px; background: var(--card); }
  .chk.undo .cmemo { display: block; }
  .grid.list { grid-template-columns: minmax(0, 1fr); }
  .list .card { padding: 14px 18px; gap: 10px; }
  .list .card .head { font-size: 16px; }
  .card { background: var(--card); border: 2px solid var(--line); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .card.on { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(47, 91, 255, .25); }
  .rec { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #ff4f8b; color: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .recline { flex-basis: 100%; font-size: 13px; }
  /* 記号・札・ボタンは折り返さず縮めない。長い案の名前の方を折り返す */
  .card .head { display: flex; align-items: baseline; gap: 8px; font-size: 15px; }
  .card .head > b, .card .head > .rec, .card .head > button, .card .meta b, .card .btns button, .track .song { white-space: nowrap; flex-shrink: 0; }
  .card .head .nm { min-width: 0; }
  .card .head button { margin-left: auto; }
  .card .meta { font-size: 13px; }
  .card .btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
  figure { margin: 0; }
  figure img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; cursor: zoom-in; }
  figure video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: #000; }
  figcaption { font-size: 12px; color: var(--sub); margin-top: 4px; line-height: 1.5; }
  .txt, .ba > div, .now { font-size: 15px; line-height: 1.75; padding: 12px 16px; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); overflow-wrap: anywhere; }
  .t p, .txt p, .txt li, .t li { margin: 0 0 6px; }
  .txt ol, .t ol { margin: 0 0 6px; padding-left: 1.6em; }
  .txt li::marker, .t li::marker { font-weight: 700; color: var(--sub); }
  .gap { height: 6px; }
  .txt > :last-child, .t > :last-child, .txt li:last-child, .t li:last-child { margin-bottom: 0; }
  ins { color: var(--ins); text-decoration: underline; text-decoration-color: var(--ins); background: var(--ins-bg); }
  del { color: var(--del); }
  .ba { display: grid; gap: 8px; }
  .ba .b { border-left: 4px solid var(--before); }
  .ba .a { border-left: 4px solid var(--after); }
  .lbl { display: block; font-size: 12px; font-weight: 700; color: var(--sub); margin-bottom: 4px; }
  /* 文の案は枠を重ねず、左の帯と字の大きさで階層を出す（件の枠 > 決めること > 現状 > 案 > 一言） */
  .ba > div { background: none; border: 0; border-left: 4px solid var(--line); border-radius: 0; padding: 2px 0 2px 14px; }
  .ba .b { color: var(--sub); font-size: 14px; }
  .now { margin: 0 0 14px; padding: 2px 0 2px 14px; background: none; border: 0; border-left: 4px solid var(--line); border-radius: 0; color: var(--sub); font-size: 13.5px; line-height: 1.6; }
  .now .lbl { display: inline; margin-right: 8px; }
  .now .t { display: inline; }
  .now .t p { display: inline; margin: 0; }
  .point { margin: -6px 0 12px; font-size: 16px; font-weight: 600; line-height: 1.6; }
  .opts { display: grid; gap: 6px; margin-bottom: 4px; }
  .opt { display: grid; grid-template-columns: 26px 1fr; gap: 4px 10px; padding: 10px 12px; border-radius: 10px; border: 2px solid transparent; cursor: pointer; }
  .opt .dot { width: 20px; height: 20px; margin-top: 3px; border-radius: 50%; border: 2px solid #9aa3b2; background: var(--card); }
  .opt.isrec { background: var(--rec-bg); }
  .opt.on, .opt.isrec.on { border-color: var(--blue); background: var(--done-bg); }
  .opt.on .dot { border-color: var(--blue); background: radial-gradient(var(--blue) 45%, var(--card) 50%); }
  .opt .name { font-size: 15px; font-weight: 700; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .opt .name .rec { margin: 0; }
  .opt .obody, .opt .md { grid-column: 2; }
  .obody { min-width: 0; font-size: 15px; line-height: 1.6; }
  .obody .txt { padding: 0; border: 0; background: none; }
  /* 見出し（メリット / デメリット）を同じ幅の列にして、本文の書き出しを揃える */
  .md { display: grid; gap: 2px; font-size: 14px; line-height: 1.6; }
  .md .m, .md .d { display: grid; grid-template-columns: 6em 1fr; column-gap: 4px; }
  .md .m::before { content: "メリット"; color: var(--ins); font-weight: 700; }
  .md .d::before { content: "デメリット"; color: var(--del); font-weight: 700; }
  .row .memo { background: none; }
  .row.ask .memo { min-height: 64px; font-size: 15px; background: var(--bg); }
  .missing { aspect-ratio: 16 / 9; display: grid; place-items: center; color: var(--sub); border: 1px dashed var(--line); border-radius: 8px; }
  .row, .box { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 16px; }
  .row h3, .box h3 { font-size: 16px; margin: 0 0 10px; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .row h3 small { font-size: 13px; font-weight: 400; color: var(--sub); }
  .memo { width: 100%; margin-top: 8px; min-height: 36px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); padding: 6px 8px; font: inherit; font-size: 13px; }
  .nextbar { display: flex; justify-content: flex-end; margin: 16px 0 8px; }
  .nextbar .next { font-size: 14px; font-weight: 700; padding: 8px 18px; }
  .tracks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 700px) { .tracks { grid-template-columns: 1fr; } }
  .track { border: 2px solid var(--line); border-radius: 10px; padding: 10px; display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
  .track > div { flex: 1; min-width: 0; }
  .track p { margin: 4px 0 0; color: var(--sub); font-size: 13px; line-height: 1.5; }
  .track audio { width: 100%; margin-top: 6px; }
  .track.on { border-color: var(--blue); }
  #prog { font-size: 14px; font-weight: 700; }
  #sumlist { display: grid; gap: 10px; margin-bottom: 16px; }
  .sumrow { background: var(--card); border: 2px solid var(--line); border-radius: 12px; padding: 10px 14px; display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: start; }
  .sumrow.todo { border-color: var(--todo); }
  .sumrow h3 { font-size: 15px; margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .sumrow pre { grid-column: 1 / -1; margin: 0; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; color: var(--sub); }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  #out { width: 100%; min-height: 150px; font-family: ui-monospace, monospace; font-size: 13px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); padding: 10px; }
  #lb { position: fixed; inset: 0; background: rgba(0, 0, 0, .85); display: none; place-items: center; z-index: 10; cursor: zoom-out; padding: 16px; }
  #lb img { max-width: 100%; max-height: 100%; }
</style>
</head>
<body>
<header>
  <div class="top"><h1>${esc(spec.title)}</h1>${multi && spec.note ? `<span class="warn">${esc(spec.note)}</span>` : ""}</div>
  ${tabs}
</header>
<main>
${pages.map((p, i) => renderPage(p, i, baseDir, nextLabel(i))).join("\n")}
${summary}
</main>
<div id="lb"><img alt=""></div>
<script>
  const C = ${cfg};
  const N = C.pages.length, SUM = N;
  const blank = () => ({ keep: [], pick: {}, more: {}, memo: {}, song: [], touched: {}, undo: {} });
  let s = { tab: 0, all: "", allSent: "", seen: [], sent: {}, pages: C.pages.map(blank) };
  try { const v = JSON.parse(localStorage.getItem(C.storageKey) || "{}"); if (v.pages) s = Object.assign(s, v); } catch (e) {}
  C.pages.forEach((_, i) => { s.pages[i] = Object.assign(blank(), s.pages[i] || {}); });
  // 推す案は最初から選ばれている（本人は違う件だけ押す）。一度外した件（null）は戻さない
  C.pages.forEach((c, i) => { if (c.mode === "pick") c.rows.forEach(([r, , rec, ask]) => { if (!ask && rec && s.pages[i].pick[r] === undefined) s.pages[i].pick[r] = rec; }); });
  if (!C.multi) s.tab = 0;
  const save = () => { try { localStorage.setItem(C.storageKey, JSON.stringify(s)); } catch (e) {} };
  const $$ = (q, r = document) => [...r.querySelectorAll(q)];
  const sec = (i) => document.querySelector('.page[data-p="' + i + '"]');
  const isView = (i) => C.pages[i].mode === "view" || C.pages[i].mode === "check";
  // 選んだかどうか。確認用のページは開いたら済み
  const answered = (i) => {
    const p = s.pages[i], c = C.pages[i];
    if (isView(i)) return !!s.seen[i];
    const cards = c.mode === "keep" ? p.keep.length > 0 : c.mode === "pick" ? c.rows.every(([r, , , ask]) => (ask ? !!(p.memo[r] || "").trim() : !!p.pick[r])) : true;
    return cards && (!c.audio || p.song.length > 0);
  };
  const optName = (c, opts, k) => (opts && opts[k]) || c.cols[k] || "";
  // 選ばなかったときの行。おすすめがあれば、それで進めてよいという意味になる
  const fallback = (c, opts, rec) => (rec ? "未選択 → おすすめ " + rec + " " + optName(c, opts, rec) + "（お任せ）" : "未選択");
  // 1 ページ分の回答の行
  function pageLines(i) {
    const p = s.pages[i], c = C.pages[i], lines = [];
    if (c.mode === "view") {
      Object.keys(c.cols).forEach((k) => { if (p.memo[k]) lines.push("[メモ] " + k + " " + c.cols[k] + " / " + p.memo[k]); });
      if (!lines.length) lines.push(s.seen[i] ? "[確認] 見た・メモなし" : "[確認] まだ見ていない");
    } else if (c.mode === "check") {
      c.rows.forEach(([r, name]) => { if (p.undo[r]) lines.push("[戻す] " + name + (p.memo[r] ? " / " + p.memo[r] : "")); });
      if (!lines.length) lines.push(s.seen[i] ? "[確認] " + c.rows.length + " 件ともそのまま" : "[確認] まだ見ていない");
    } else if (c.mode === "keep") {
      p.keep.forEach((k) => lines.push("[選んだ] " + k + " " + c.cols[k] + (p.memo[k] ? " / " + p.memo[k] : "")));
      if (!p.keep.length) lines.push("[選んだ] " + fallback(c, null, c.rec));
      Object.keys(c.cols).forEach((k) => { if (!p.keep.includes(k) && p.memo[k]) lines.push("[メモ] " + k + " " + c.cols[k] + " / " + p.memo[k]); });
    } else if (c.mode === "pick") {
      c.rows.forEach(([r, name, rec, ask, opts]) => {
        if (ask) { lines.push("[" + name + "] " + ((p.memo[r] || "").trim() ? p.memo[r].trim().replace(/\\n/g, " / ") : "未回答")); return; }
        const k = p.pick[r];
        const tag = k === rec && !p.touched[r] ? "（おすすめのまま）" : p.more[r] === k ? "（この方向でもっと）" : "";
        lines.push("[" + name + "] " + (k ? k + " " + optName(c, opts, k) + tag : fallback(c, opts, rec)) + (p.memo[r] ? " / " + p.memo[r] : ""));
      });
    }
    if (c.audio) lines.push("[BGM] " + (p.song.length ? p.song.join("・") : "未選択") + (p.memo.bgm ? " / " + p.memo.bgm : ""));
    if (p.memo.page) lines.push("[このページ] " + p.memo.page);
    return lines;
  }
  const pageText = (i) => pageLines(i).join("\\n");
  // 状態: todo（未回答・未確認）/ done（回答済み・確認済み）/ sent（送信済み）/ chg（送信後に変更）
  function status(i) {
    if (!answered(i)) return ["todo", isView(i) ? "未確認" : "未回答"];
    if (s.sent[i] !== undefined) return s.sent[i] === pageText(i) ? ["sent", "送信済み"] : ["chg", "送信後に変更"];
    return ["done", isView(i) ? "確認済み" : "回答済み"];
  }
  const required = () => C.pages.map((_, i) => i).filter((i) => !isView(i));
  function progress() {
    const req = required(), rest = req.filter((i) => !answered(i)), unseen = C.pages.map((_, i) => i).filter((i) => isView(i) && !s.seen[i]);
    let t = rest.length ? "選ぶページ " + req.length + " つのうち " + (req.length - rest.length) + " つ回答済み。まだ: " + rest.map((i) => C.pages[i].title).join(" / ") : "選ぶページの回答がそろいました";
    if (unseen.length) t += "。まだ見ていない確認用のページ: " + unseen.map((i) => C.pages[i].title).join(" / ");
    return { text: t, rest: rest.length, total: req.length };
  }
  function answer() {
    const lines = [];
    C.pages.forEach((c, i) => { if (C.multi) lines.push("## " + c.title); lines.push(...pageLines(i)); });
    const all = (s.all || "").trim();
    if (all) lines.push("[全体] " + all);
    if (C.multi) lines.push("（" + progress().text + "）");
    return lines.join("\\n");
  }
  function go(i) { s.tab = i; if (i < N) s.seen[i] = true; save(); paint(); window.scrollTo(0, 0); }
  // 押したボタンは「選択中」になる（もう一度押すと戻る）
  const toggle = (b, on) => { if (!b) return; b.classList.toggle("on", on); b.textContent = on ? "選択中" : b.dataset.label; b.title = on ? "押すと戻す" : ""; };
  function paint() {
    C.pages.forEach((c, i) => {
      const el = sec(i), p = s.pages[i];
      el.classList.toggle("active", !C.multi || i === s.tab);
      if (c.mode === "keep") {
        $$(".card.col", el).forEach((d) => { const on = p.keep.includes(d.dataset.col); d.classList.toggle("on", on); toggle(d.querySelector(".keep"), on); });
        el.querySelector(".count").textContent = p.keep.length + " / " + c.keep;
      } else if (c.mode === "pick") {
        $$(".row .card", el).forEach((d) => { const r = d.dataset.row, k = d.dataset.col; d.classList.toggle("on", p.pick[r] === k); toggle(d.querySelector(".pick"), p.pick[r] === k); d.querySelector(".more")?.classList.toggle("on", p.more[r] === k); });
        $$(".opt", el).forEach((d) => d.classList.toggle("on", p.pick[d.dataset.row] === d.dataset.col));
        const done = c.rows.filter(([r, , , ask]) => (ask ? !!(p.memo[r] || "").trim() : !!p.pick[r])).length;
        el.querySelector(".count").textContent = done + " / " + c.rows.length;
      } else if (c.mode === "check") {
        $$(".chk", el).forEach((d) => { const on = !!p.undo[d.dataset.row]; d.classList.toggle("undo", on); const b = d.querySelector(".undo"); b.classList.toggle("on", on); b.textContent = on ? "戻すのをやめる" : b.dataset.label; });
        const n = c.rows.filter(([r]) => p.undo[r]).length;
        el.querySelector(".count").textContent = n ? "戻す " + n + " 件" : "";
      }
      $$(".track", el).forEach((t) => { const on = p.song.includes(t.dataset.track); t.classList.toggle("on", on); t.querySelector(".song").classList.toggle("on", on); });
      $$(".memo", el).forEach((m) => { if (document.activeElement !== m) m.value = p.memo[m.dataset.memo] || ""; });
      const [k, label] = status(i), chip = el.querySelector(".phead .st");
      chip.className = "chip st " + k; chip.textContent = C.multi ? label : "";
    });
    const am = document.getElementById("allmemo");
    if (document.activeElement !== am) am.value = s.all || "";
    if (!C.multi) return;
    sec(SUM).classList.toggle("active", s.tab === SUM);
    $$(".tab").forEach((t) => {
      const i = +t.dataset.p, chip = t.querySelector(".st");
      t.classList.toggle("active", i === s.tab);
      if (i === SUM) { const g = progress(); chip.className = "chip st " + (g.rest ? "todo" : "done"); chip.textContent = (g.total - g.rest) + " / " + g.total; return; }
      const [k, label] = status(i); chip.className = "chip st " + k; chip.textContent = label;
    });
    document.getElementById("prog").textContent = progress().text;
    document.getElementById("sumlist").innerHTML = C.pages.map((c, i) => {
      const [k, label] = status(i);
      const e = (x) => x.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[m]);
      return '<div class="sumrow ' + (k === "todo" ? "todo" : "") + '"><h3>' + (i + 1) + ". " + e(c.title) + ' <span class="chip ' + k + '">' + label + '</span></h3><button class="jump" data-go="' + i + '">' + (k === "todo" ? "このページを見る" : "直す") + "</button><pre>" + e(pageText(i)) + "</pre></div>";
    }).join("");
    $$("#sumlist .jump").forEach((b) => b.onclick = () => go(+b.dataset.go));
  }
  C.pages.forEach((c, i) => {
    const el = sec(i), p = () => s.pages[i];
    $$(".card.col", el).forEach((d) => d.querySelector(".keep").onclick = () => {
      const k = d.dataset.col, q = p();
      if (q.keep.includes(k)) q.keep = q.keep.filter((x) => x !== k);
      else if (c.keep === 1) q.keep = [k];
      else if (q.keep.length < c.keep) q.keep.push(k);
      save(); paint();
    });
    $$(".row .card", el).forEach((d) => {
      const r = d.dataset.row, k = d.dataset.col;
      d.querySelector(".pick").onclick = () => { const q = p(); q.pick[r] = q.pick[r] === k ? null : k; save(); paint(); };
      const more = d.querySelector(".more");
      if (more) more.onclick = () => { const q = p(); q.more[r] = q.more[r] === k ? null : k; if (q.more[r]) q.pick[r] = k; save(); paint(); };
    });
    $$(".chk", el).forEach((d) => d.querySelector(".undo").onclick = () => { const q = p(), r = d.dataset.row; q.undo[r] = !q.undo[r]; save(); paint(); });
    // ラジオ風の案は行のどこを押しても選べる（文字を選んでいるときは除く）。もう一度押すと外れる
    $$(".opt", el).forEach((d) => {
      const r = d.dataset.row, k = d.dataset.col;
      d.onclick = () => { if (String(getSelection())) return; const q = p(); q.pick[r] = q.pick[r] === k ? null : k; q.touched[r] = true; save(); paint(); };
    });
    $$(".track", el).forEach((t) => t.querySelector(".song").onclick = () => { const q = p(), k = t.dataset.track; q.song = q.song.includes(k) ? q.song.filter((x) => x !== k) : [...q.song, k]; save(); paint(); });
    $$(".memo", el).forEach((m) => m.oninput = () => { p().memo[m.dataset.memo] = m.value; save(); paint(); });
  });
  $$(".tab, .next").forEach((t) => t.onclick = () => go(+(t.dataset.p ?? t.dataset.go)));
  document.getElementById("allmemo").oninput = (e) => { s.all = e.target.value; save(); };
  // 1 曲を再生すると他は止まる。止めた位置はそのまま残す
  const audios = $$("audio");
  audios.forEach((a) => a.addEventListener("play", () => audios.forEach((b) => { if (b !== a && !b.paused) b.pause(); })));
  $$("figure img").forEach((img) => img.onclick = () => { const lb = document.getElementById("lb"); lb.querySelector("img").src = img.src; lb.style.display = "grid"; });
  document.getElementById("lb").onclick = (e) => { e.currentTarget.style.display = "none"; };
  document.getElementById("copy").onclick = async (e) => {
    const text = answer(), out = document.getElementById("out"), btn = e.currentTarget;
    out.value = text;
    C.pages.forEach((_, i) => { if (answered(i)) s.sent[i] = pageText(i); });
    s.allSent = s.all; save(); paint();
    try { await navigator.clipboard.writeText(text); btn.textContent = "コピーしました"; } catch (err) { out.select(); }
  };
  document.getElementById("selall").onclick = () => { const t = document.getElementById("out"); t.select(); t.setSelectionRange(0, t.value.length); };
  // 中継（relay.ts の open）経由で開いていれば [送信] を出す。押すと回答が中継に届き、agent は wait で読む。file:// ではコピーのまま
  if (location.protocol === "http:" || location.protocol === "https:") {
    const send = document.getElementById("send"), copy = document.getElementById("copy"), msg = document.getElementById("sendmsg");
    send.hidden = false; copy.classList.remove("on");
    send.onclick = async () => {
      const text = answer(), out = document.getElementById("out");
      out.value = text;
      try {
        const res = await fetch("/__answer?page=" + encodeURIComponent(decodeURIComponent(location.pathname.split("/").pop())), { method: "POST", body: text });
        if (!res.ok) throw new Error(res.status);
        C.pages.forEach((_, i) => { if (answered(i)) s.sent[i] = pageText(i); });
        s.allSent = s.all; save(); paint();
        send.textContent = "送信しました"; msg.textContent = "";
      } catch (err) { msg.textContent = "送れなかった（中継が止まっている）。コピーして貼ってください"; }
    };
  }
  if (C.multi && s.tab < N) s.seen[s.tab] = true;
  paint();
</script>
</body>
</html>
`;
}

/** 列・行の文と画像の組み合わせが足りているかを見る。足りなければ理由を返す */
export function check(p: Page): string | null {
  const cols = p.columns ?? [], rows = p.rows ?? [];
  if (!p.title) return "各ページに title が要る";
  if (p.mode === "check") return rows.length ? null : `${p.title}: check には rows が要る`;
  if (!cols.length && !hasRowCards(p) && !p.audio?.length) return `${p.title}: columns か、options / ask を持つ rows か、audio のどれかが要る`;
  if (!cols.length && !hasRowCards(p)) return null;
  if (!rows.length) return `${p.title}: columns を書くときは rows が要る`;
  if (!["keep", "pick", "view", undefined].includes(p.mode)) return `${p.title}: mode は keep・pick・view・check`;
  const covered = rows.every((r) => r.ask !== undefined || r.options !== undefined || cols.every((c) => isText(c) || r.text?.[c.key] !== undefined));
  if (!p.images && !covered) return `${p.title}: images が無いなら、全部の案に text / before / after（pick なら行の text か options か ask）が要る`;
  return null;
}

export function main(args: string[]): number {
  const help = `usage: bun picker.ts <spec.json> <out.html>

案（静止画・動画・文）と BGM の選択票を 1 枚の HTML に組む（書き出すのは <out.html> だけ）。
開くのは relay.ts の open（[送信] が出て、回答が貼り付けなしで届く。agent は relay.ts wait で読む）。relay を使わないなら file:// で開き、コピーで貼り戻してもらう。
決めごとが複数あるときは pages に並べると、1 枚の中でタブで切り替わる。タブに各ページの状態（未回答 / 回答済み / 送信済み）が出て、
最後のタブ「回答のまとめ」に全ページの回答が集まる。コピーした回答の末尾に進み具合の 1 行（まだ: …）が付く。
画像・メモ・音のパスは <out.html> からの相対パスで書く。

spec.json の例（ページが 1 つ）:
  {
    "title": "足切りの選択票", "note": "どれも未完成のコマです",
    "mode": "keep", "keep": 3,                      keep = 案を N 個まで選ぶ / pick = 件ごとに 1 案 / view = 見せるだけ
    "button": "候補に残す",                          任意。選ぶボタンの言葉（既定: keep 1 と pick は「これにする」、keep 2 以上は「候補に残す」）
    "columns": [{ "key": "B0", "name": "コラージュ", "file": "collage" }],
    "rows": [{ "key": "s1", "name": "名乗り", "sub": "0–3 秒" }],
    "images": "png/{file}-{row}.png",
    "notes": "png/{file}-notes.json",                 任意。{row: メモ} か場面順の配列
    "recommend": { "key": "B0", "reason": "推す理由を 1 行" },   推す案に「おすすめ」の札。選ばなかった件は「未選択 → おすすめ」で進められる
    "audio": [{ "key": "H1", "name": "軽快なテック", "desc": "36 秒", "src": "music/h1.mp3" }]
  }

文の案（画像の代わりに文を出す。{+足す+} は緑の下線、{-消す-} は赤の取り消し線）:
  確認用:   { "title": "直した点の確認", "mode": "view", "rows": [{ "key": "r", "name": "" }],
              "columns": [{ "key": "L12", "name": "導入の 1 文", "before": "正本{-を管理するリポジトリです-}", "after": "正本{+。rulesync で取り込む+}" }] }
  1 つ選ぶ: { "title": "冒頭の文言", "mode": "keep", "keep": 1, "rows": [{ "key": "r", "name": "" }],
              "columns": [{ "key": "A", "name": "今のまま", "text": "…" }, { "key": "B", "name": "短く", "text": "…" }], "recommend": { "key": "B" } }
  件ごと:   { "title": "指摘 1〜5", "mode": "pick",
              "columns": [{ "key": "A", "name": "案A" }, { "key": "B", "name": "案B" }, { "key": "K", "name": "このまま", "text": "直さない" }],
              "rows": [{ "key": "i1", "name": "#12 導入", "why": "何を決めるか・なぜそう提案するかの 1 行", "now": "現状の文", "text": { "A": "案A の文", "B": "案B の文" }, "recommend": "A" }] }
            件ごとに案が違うなら行に options を書く（列は省ける）。推す案は最初から選ばれていて、本人は違う件だけ押す:
              { "key": "t1", "name": "#13 スキル登録", "why": "…", "now": "…", "recommend": "A",
                "options": [{ "key": "A", "name": "落とす", "pros": "メリット 1 行", "cons": "デメリット 1 行" }, { "key": "B", "name": "残す", "pros": "…" }] }
            文で答えてもらう問いは ask（案は出ない）: { "key": "q1", "name": "#15 夜の習慣", "why": "…", "ask": "分かっていれば何のことか、分からなければ「不明」" }
  決めた扱いの確認（1 件ずつ。違う件だけ「戻す」。開けば確認済み）:
            { "title": "先に片付ける 12 件", "mode": "check", "tag": "落とす", "note": "もう決めてあります。違う件だけ「戻す」",
              "tags": [{ "name": "落とす", "meaning": "期間が過ぎて次の行動が変わらない", "tone": "red" }, { "name": "片付いた", "meaning": "今日の作業で済んだ", "tone": "green" }],
              "rows": [{ "key": "n1", "name": "#1 週次の振り返り", "sub": "9/1 から", "why": "期間切れ" }, { "key": "n2", "name": "#2 上位目標", "tag": "片付いた", "why": "今日作り直した" }] }

ページが複数:
  { "title": "仕上げ前の選択票", "pages": [ { "title": "直した点の確認", "mode": "view", ... },
                                          { "title": "技術の見せ方", "mode": "keep", "keep": 1, ... }, { "title": "尺", "audio": [...] } ] }`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  if (args.length !== 2) { console.error(help); return 2; }
  const spec = JSON.parse(readFileSync(args[0], "utf8")) as Spec;
  const pages = spec.pages?.length ? spec.pages : [spec];
  if (!spec.title) throw new Error("title は必須");
  for (const p of pages) {
    const problem = check(p);
    if (problem) throw new Error(problem);
  }
  writeFileSync(args[1], build(spec, dirname(args[1])));
  console.error(`${args[1]}: ページ ${pages.length}・案 ${pages.reduce((n, p) => n + (p.columns?.length ?? 0), 0)}・BGM ${pages.reduce((n, p) => n + (p.audio?.length ?? 0), 0)}`);
  console.log(args[1]);
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
