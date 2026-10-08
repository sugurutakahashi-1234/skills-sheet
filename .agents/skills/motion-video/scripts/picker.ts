#!/usr/bin/env bun
/**
 * コマ（静止画）と BGM の選択票を 1 枚の HTML に組む。本人は選んで「回答をまとめてコピー」し、会話に貼り戻す。
 *
 * - 決めごとが複数あるときは pages に並べ、1 枚の中でタブで切り替える（ページを何枚も開かせない）
 * - タブには各ページの状態（未回答 / 回答済み / 送信済み / 送信後に変更、確認用のページは 未確認 / 確認済み）が出る。
 *   最後のタブ「回答のまとめ」に全ページの回答が集まり、未回答のページへ飛べる。コピーした回答の末尾には進み具合の 1 行が付く
 * - mode "keep": 案（列）を最大 N 個「残す」。足切りは keep 3、方向やキービジュアルを決めるときは keep 1
 * - mode "pick": 場面（行）ごとに 1 案を選び、「この方向でもっと」を付けられる。本人が場面ごとに混ぜたいときだけ
 * - mode "view": 選ばせずに見せるだけ（言われたとおりに直した点の確認など）。案ごとのメモ欄だけ付く
 * - recommend で推す案を明示する（札「おすすめ」と理由 1 行）
 * - BGM は何曲でも並べられる。1 曲を再生すると他は止まる（止めた位置は残す。頭に戻すと聴き直しづらい）
 * - 入力はブラウザに保存する（作り直しても同じ storageKey なら残る）。作り直したら開き直さず、本人に再読み込みしてもらう
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Page = {
  title: string;
  /** ページの見出しの横に出す断り（例: どれも未完成のコマです） */
  note?: string;
  mode?: "keep" | "pick" | "view";
  /** mode "keep" で残せる数。既定 3 */
  keep?: number;
  /** 案。file は画像とメモのファイル名に入る名前（既定は key） */
  columns?: { key: string; name: string; file?: string }[];
  /** 場面 */
  rows?: { key: string; name: string; sub?: string }[];
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
  const figure = (file: string, row: NonNullable<Page["rows"]>[number], index: number, label: boolean) => {
    const src = fill(p.images ?? "", file, row.key);
    const cap = `${label ? `${esc(row.name)}：` : ""}${esc(noteOf(file, row.key, index))}`;
    const media = /\.(mp4|webm|mov)$/i.test(src)
      ? `<video src="${esc(src)}" autoplay loop muted playsinline></video>` // 動きの見本は数秒の動画で並べる（音なしで繰り返す）
      : `<img src="${esc(src)}" alt="" loading="lazy">`;
    return p.images && existsSync(join(baseDir, src))
      ? `<figure>${media}<figcaption>${cap}</figcaption></figure>`
      : `<figure><div class="missing">${esc(row.name)}：まだ無い</div></figure>`;
  };
  const rec = p.recommend?.key;
  const badge = (key: string) => (key === rec ? '<span class="rec">おすすめ</span>' : "");
  const mode = p.mode ?? "keep";
  let body = "";
  if (cols.length && (mode === "keep" || mode === "view")) {
    body = `<div class="grid">${cols
      .map((c) => `<div class="card${mode === "keep" ? " col" : ""}" data-col="${esc(c.key)}"><div class="head"><b>${esc(c.key)}</b> ${esc(c.name)}${badge(c.key)}${mode === "keep" ? '<button class="keep">残す</button>' : ""}</div>${rows.map((r, i) => figure(c.file ?? c.key, r, i, rows.length > 1)).join("")}<textarea class="memo" data-memo="${esc(c.key)}" placeholder="この案への一言（任意）"></textarea></div>`)
      .join("")}</div>`;
  } else if (cols.length) {
    body = rows
      .map((r, i) => `<section class="row" data-row="${esc(r.key)}"><h3>${esc(r.name)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</h3><div class="cards" style="--n:${cols.length}">${cols
        .map((c) => `<div class="card" data-row="${esc(r.key)}" data-col="${esc(c.key)}">${figure(c.file ?? c.key, r, i, false)}<div class="meta"><b>${esc(c.key)}</b> ${esc(c.name)}${badge(c.key)}</div><div class="btns"><button class="pick">これ</button><button class="more">この方向でもっと</button></div></div>`)
        .join("")}</div><textarea class="memo" data-memo="${esc(r.key)}" placeholder="この場面への一言（任意）"></textarea></section>`)
      .join("");
  }
  const audio = p.audio?.length
    ? `<section class="box"><h3>BGM（1 曲を再生すると他は止まります）</h3><div class="tracks">${p.audio
        .map((a) => `<div class="track" data-track="${esc(a.key)}"><div><b>${esc(a.key)}</b> ${esc(a.name)}${badge(a.key)}${a.desc ? `<p>${esc(a.desc)}</p>` : ""}<audio controls preload="none" src="${esc(a.src)}"></audio></div><button class="song">これ</button></div>`)
        .join("")}</div><textarea class="memo" data-memo="bgm" placeholder="BGM への一言（任意）"></textarea></section>`
    : "";
  const head = `<div class="phead"><h2>${esc(p.title)}</h2><span class="chip st"></span>${p.note ? `<span class="warn">${esc(p.note)}</span>` : ""}${rec ? `<span class="recline"><span class="rec">おすすめ</span> ${esc(rec)}${p.recommend?.reason ? `：${esc(p.recommend.reason)}` : ""}</span>` : ""}<span class="count"></span></div>`;
  const nav = next === null ? "" : `<div class="nextbar"><button class="next on" data-go="${pi + 1}">${esc(next)} →</button></div>`;
  return `<section class="page" data-p="${pi}">${head}${body}${audio}<textarea class="memo" data-memo="page" placeholder="このページへの一言（任意）"></textarea>${nav}</section>`;
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
      mode: p.columns?.length ? p.mode ?? "keep" : "none",
      keep: p.keep ?? 3,
      cols: Object.fromEntries((p.columns ?? []).map((c) => [c.key, c.name])),
      rows: (p.rows ?? []).map((r) => [r.key, r.name]),
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
    <p class="actions"><button id="copy" class="on">${multi ? "回答をまとめてコピー" : "回答をコピー"}</button><button id="selall">全選択</button></p>
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
          --todo-bg: #fff1e6; --todo: #b54708; --done-bg: #e8efff; --done: #2f5bff; --sent-bg: #e3f6ec; --sent: #1a7f37; --chg-bg: #fff6d6; --chg: #8a6100; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ink: #e9ebf0; --sub: #a3a9b6; --line: #2c313b; --bg: #15181e; --card: #1d2129;
          --todo-bg: #3a2a1c; --todo: #ffb27a; --done-bg: #1f2a4a; --done: #9db4ff; --sent-bg: #173326; --sent: #7fd6a0; --chg-bg: #3a3218; --chg: #f0cf6a; } }
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
  .warn { font-size: 13px; color: var(--sub); }
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
  .card { background: var(--card); border: 2px solid var(--line); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .card.on { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(47, 91, 255, .25); }
  .rec { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: #ff4f8b; color: #fff; font-size: 12px; font-weight: 700; }
  .recline { flex-basis: 100%; font-size: 13px; }
  .card .head { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  .card .head button { margin-left: auto; }
  .card .meta { font-size: 13px; }
  .card .btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
  figure { margin: 0; }
  figure img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; cursor: zoom-in; }
  figure video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: #000; }
  figcaption { font-size: 12px; color: var(--sub); margin-top: 4px; line-height: 1.5; }
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
  const blank = () => ({ keep: [], pick: {}, more: {}, memo: {}, song: [] });
  let s = { tab: 0, all: "", allSent: "", seen: [], sent: {}, pages: C.pages.map(blank) };
  try { const v = JSON.parse(localStorage.getItem(C.storageKey) || "{}"); if (v.pages) s = Object.assign(s, v); } catch (e) {}
  C.pages.forEach((_, i) => { s.pages[i] = Object.assign(blank(), s.pages[i] || {}); });
  if (!C.multi) s.tab = 0;
  const save = () => { try { localStorage.setItem(C.storageKey, JSON.stringify(s)); } catch (e) {} };
  const $$ = (q, r = document) => [...r.querySelectorAll(q)];
  const sec = (i) => document.querySelector('.page[data-p="' + i + '"]');
  const isView = (i) => C.pages[i].mode === "view";
  // 選んだかどうか。確認用のページは開いたら済み
  const answered = (i) => {
    const p = s.pages[i], c = C.pages[i];
    if (c.mode === "view") return !!s.seen[i];
    const cards = c.mode === "keep" ? p.keep.length > 0 : c.mode === "pick" ? Object.values(p.pick).some(Boolean) : true;
    return cards && (!c.audio || p.song.length > 0);
  };
  // 1 ページ分の回答の行
  function pageLines(i) {
    const p = s.pages[i], c = C.pages[i], lines = [];
    if (c.mode === "view") {
      Object.keys(c.cols).forEach((k) => { if (p.memo[k]) lines.push("[メモ] " + k + " " + c.cols[k] + " / " + p.memo[k]); });
      if (!lines.length) lines.push(s.seen[i] ? "[確認] 見た・メモなし" : "[確認] まだ見ていない");
    } else if (c.mode === "keep") {
      p.keep.forEach((k) => lines.push("[残す] " + k + " " + c.cols[k] + (p.memo[k] ? " / " + p.memo[k] : "")));
      if (!p.keep.length) lines.push("[残す] 未選択");
      Object.keys(c.cols).forEach((k) => { if (!p.keep.includes(k) && p.memo[k]) lines.push("[メモ] " + k + " " + c.cols[k] + " / " + p.memo[k]); });
    } else if (c.mode === "pick") {
      c.rows.forEach(([r, name]) => { const k = p.pick[r]; lines.push("[" + name + "] " + (k ? k + " " + c.cols[k] + (p.more[r] === k ? "（この方向でもっと）" : "") : "未選択") + (p.memo[r] ? " / " + p.memo[r] : "")); });
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
  function paint() {
    C.pages.forEach((c, i) => {
      const el = sec(i), p = s.pages[i];
      el.classList.toggle("active", !C.multi || i === s.tab);
      if (c.mode === "keep") {
        $$(".card.col", el).forEach((d) => { const on = p.keep.includes(d.dataset.col); d.classList.toggle("on", on); d.querySelector(".keep").classList.toggle("on", on); });
        el.querySelector(".count").textContent = p.keep.length + " / " + c.keep;
      } else if (c.mode === "pick") {
        $$(".row .card", el).forEach((d) => { const r = d.dataset.row, k = d.dataset.col; d.classList.toggle("on", p.pick[r] === k); d.querySelector(".pick").classList.toggle("on", p.pick[r] === k); d.querySelector(".more").classList.toggle("on", p.more[r] === k); });
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
      d.querySelector(".more").onclick = () => { const q = p(); q.more[r] = q.more[r] === k ? null : k; if (q.more[r]) q.pick[r] = k; save(); paint(); };
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
  if (C.multi && s.tab < N) s.seen[s.tab] = true;
  paint();
</script>
</body>
</html>
`;
}

export function main(args: string[]): number {
  const help = `usage: bun picker.ts <spec.json> <out.html>

コマ（静止画）と BGM の選択票を 1 枚の HTML に組む（書き出すのは <out.html> だけ）。
決めごとが複数あるときは pages に並べると、1 枚の中でタブで切り替わる。タブに各ページの状態（未回答 / 回答済み / 送信済み）が出て、
最後のタブ「回答のまとめ」に全ページの回答が集まる。コピーした回答の末尾に進み具合の 1 行（まだ: …）が付く。
画像・メモ・音のパスは <out.html> からの相対パスで書く。

spec.json の例（ページが 1 つ）:
  {
    "title": "足切りの選択票", "note": "どれも未完成のコマです",
    "mode": "keep", "keep": 3,                      keep = 案を N 個まで残す / pick = 場面ごとに 1 案 / view = 見せるだけ
    "columns": [{ "key": "B0", "name": "コラージュ", "file": "collage" }],
    "rows": [{ "key": "s1", "name": "名乗り", "sub": "0–3 秒" }],
    "images": "png/{file}-{row}.png",
    "notes": "png/{file}-notes.json",                 任意。{row: メモ} か場面順の配列
    "recommend": { "key": "B0", "reason": "推す理由を 1 行" },   推す案に「おすすめ」の札
    "audio": [{ "key": "H1", "name": "軽快なテック", "desc": "36 秒", "src": "music/h1.mp3" }]
  }

ページが複数:
  { "title": "仕上げ前の選択票", "pages": [ { "title": "直した点の確認", "mode": "view", ... },
                                          { "title": "技術の見せ方", "mode": "keep", "keep": 1, ... }, { "title": "尺", "audio": [...] } ] }`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  if (args.length !== 2) { console.error(help); return 2; }
  const spec = JSON.parse(readFileSync(args[0], "utf8")) as Spec;
  const pages = spec.pages?.length ? spec.pages : [spec];
  if (!spec.title) throw new Error("title は必須");
  for (const p of pages) {
    const hasCards = !!p.columns?.length;
    if (!p.title) throw new Error("各ページに title が要る");
    if (!hasCards && !p.audio?.length) throw new Error(`${p.title}: columns か audio のどちらかが要る`);
    if (hasCards && (!p.rows?.length || !p.images || !["keep", "pick", "view", undefined].includes(p.mode))) throw new Error(`${p.title}: columns を書くときは rows・images が要り、mode は keep・pick・view`);
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
