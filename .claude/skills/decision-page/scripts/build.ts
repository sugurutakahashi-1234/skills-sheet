#!/usr/bin/env bun
/**
 * 判断ページの JSON を雛形（assets/artifact-decision.html）に差し込み、形を検査して 1 枚の HTML に書き出す。
 *
 *   build.ts <data.json> [-o <out.html>] [--name <ページ名>]
 *
 * - 書き出す前に形を検査し、壊れていれば理由を出して終了 1（書き出さない）。推しが案に無い・id の重なり・文の欄の形など、
 *   公開してから読み手が気づく誤りを、組み立ての時点で止める
 * - 長い 1 文の欄は警告だけ出す（書き出しは止めない）。事柄が 2 つ以上なら配列（箇条書き）にする
 * - ページ名は Artifact の一覧に出る唯一の手がかりなので、中身の分からない名前は止め、短い名前には警告を出す
 * - 雛形を変えずに中身だけ差し込むので、見た目はページごとに確かめなくてよい
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

type Issues = { errors: string[]; warnings: string[] };

const KINDS = new Set(["cards", "rows", "info", "listen", "watch"]);
// これより長い 1 文は、事柄が 2 つ以上入っていることが多い
const LONG = 90;

/** 表（table）の形を確かめる。見出しの数と、各行のマスの数をそろえる */
function checkTable(t: any, where: string, out: Issues) {
  if (!t || typeof t !== "object" || !Array.isArray(t.head) || !t.head.length || !Array.isArray(t.rows) || !t.rows.length) { out.errors.push(`${where}: head（見出しの配列）と rows（行の配列）が要る`); return; }
  t.rows.forEach((r: any, i: number) => { if (!Array.isArray(r) || r.length !== t.head.length) out.errors.push(`${where}.rows[${i}]: マスの数を見出し（${t.head.length} 個）にそろえる`); });
}

/** 比べ（compare）の形を確かめる。道具は 2〜3 個、箇所ごとに元の文と、直した道具だけの文・評価 */
function checkCompare(c: any, at: string, out: Issues) {
  if (!c || typeof c !== "object" || Array.isArray(c)) { out.errors.push(`${at}: {"tools": [...], "items": [...]} の形にする`); return; }
  if (!Array.isArray(c.tools) || c.tools.length < 2 || c.tools.length > 3) { out.errors.push(`${at}.tools: 道具は 2〜3 個の配列が要る`); return; }
  c.tools.forEach((t: any, k: number) => { need(t?.key, `${at}.tools[${k}].key`, out); need(t?.name, `${at}.tools[${k}].name`, out); });
  const keys = c.tools.map((t: any) => t?.key);
  if (new Set(keys).size !== keys.length) out.errors.push(`${at}.tools: key が重なっている`);
  if (!Array.isArray(c.items) || c.items.length === 0) { out.errors.push(`${at}.items: 1 か所以上の配列が要る`); return; }
  c.items.forEach((it: any, i: number) => {
    const w = `${at}.items[${i}]`;
    need(it?.where, `${w}.where`, out);
    // 文の直しは元の文（base）に赤入れを重ねるので base が要る。実物（img）を並べる箇所は要らない
    if (keys.some((k: string) => it?.[k] && !it[k].img)) need(it?.base, `${w}.base`, out);
    if (!keys.some((k: string) => it?.[k])) out.errors.push(`${w}: どの道具も変えていない箇所は載せない`);
    for (const k of keys) {
      const x = it?.[k];
      if (x === undefined || x === null) continue;
      if (!x.img) need(x.text, `${w}.${k}.text`, out);
      if (!["good", "neutral", "bad", "taste"].includes(x.mark)) out.errors.push(`${w}.${k}.mark: good・neutral・bad・taste のどれか`);
    }
  });
  if (c.focus !== undefined && !(Array.isArray(c.focus) && c.focus.every((n: any) => Number.isInteger(n) && n >= 1 && n <= c.items.length)))
    out.errors.push(`${at}.focus: 箇所の番号（1〜${c.items.length}）の配列にする`);
}
/** 語と説明の組（terms）の形を確かめる。札は lines と同じく 2 字にそろえる */
function checkTerms(t: any, where: string, out: Issues) {
  if (!t || typeof t !== "object" || Array.isArray(t)) { out.errors.push(`${where}: {"items": [...]} の形にする`); return; }
  for (const f of ["title", "source"]) if (t[f] !== undefined && typeof t[f] !== "string") out.errors.push(`${where}.${f}: 文字列にする`);
  if (!Array.isArray(t.items) || t.items.length === 0) { out.errors.push(`${where}.items: 1 組以上の配列が要る`); return; }
  t.items.forEach((it: any, j: number) => {
    const w = `${where}.items[${j}]`;
    need(it?.label, `${w}.label`, out);
    if (typeof it?.label === "string" && [...it.label].length !== 2) out.warnings.push(`${w}.label: 札は 2 字にそろえる（「${it.label}」）`);
    need(it?.head, `${w}.head`, out);
    checkRich(it?.text, `${w}.text`, out);
  });
}

/** 文の欄（文字列・配列・{"ol"|"ul": [...]}）の形を確かめる */
function checkRich(v: unknown, where: string, out: Issues, top = true) {
  if (v === undefined) return;
  if (typeof v === "string") {
    if (top && v.length > LONG) out.warnings.push(`${where}: ${v.length} 字の 1 文。事柄が 2 つ以上なら配列（箇条書き）にする`);
    return;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => checkRich(x, `${where}[${i}]`, out, false)); return; }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    const list = (v as Record<string, unknown>)[keys[0]];
    if (keys.length === 1 && (keys[0] === "ol" || keys[0] === "ul") && Array.isArray(list)) {
      checkRich(list, `${where}.${keys[0]}`, out, false);
      return;
    }
  }
  out.errors.push(`${where}: 文の欄は文字列・配列・{"ol": [...]}・{"ul": [...]} のどれかで書く`);
}

/**
 * 前の問いの答えで入れ替わるおすすめ {"by": "前の問いの id", "A": "おすすめ", …, "why": {"A": "理由"}} を確かめる。
 * 前の問いはこの問いより前の cards にする。後ろや rows を指すと、一括決定で前から順に決められない
 */
function checkDepRec(rec: Record<string, unknown>, i: number, at: string, keys: Set<string>, multi: boolean, questions: any[], out: Issues) {
  const { by, why, ...map } = rec;
  const j = questions.findIndex((x: any) => x?.id === by);
  const prev = questions[j];
  if (j < 0 || j >= i || prev?.kind !== "cards" || !Array.isArray(prev.options)) {
    out.errors.push(`${at}.rec.by: 「${String(by)}」は、この問いより前の cards の問いの id にする`);
    return;
  }
  // いくつでも選べる問いは答えが 1 つに決まらないので、おすすめを切り替える元にできない
  if (prev.multi === true) { out.errors.push(`${at}.rec.by: 「${String(by)}」は multi の問い。答えが 1 つに決まらないので by に使えない`); return; }
  const byKeys = new Set<string>(prev.options.map((o: any) => o?.key));
  for (const [k, v] of Object.entries(map)) {
    if (!byKeys.has(k)) out.errors.push(`${at}.rec.${k}: 「${k}」は ${by} の案の key に無い`);
    checkRecKeys(v, `${at}.rec.${k}`, keys, multi, out);
  }
  const missing = [...byKeys].filter(k => !(k in map));
  if (missing.length) out.warnings.push(`${at}.rec: ${by} で ${missing.join("・")} を選んだときのおすすめが無い`);
  if (why === undefined) return;
  if (!why || typeof why !== "object" || Array.isArray(why)) { out.errors.push(`${at}.rec.why: {"前の案の key": "理由"} にする`); return; }
  for (const [k, v] of Object.entries(why)) {
    if (!byKeys.has(k)) out.errors.push(`${at}.rec.why.${k}: 「${k}」は ${by} の案の key に無い`);
    need(v, `${at}.rec.why.${k}`, out);
  }
}

/**
 * cards のおすすめ 1 つ分（案の key の文字列）を確かめる。multi の問いでは key の配列も通す。
 * 配列は空にせず、同じ key を重ねない（重ねると一括決定で同じ案が 2 回入る）
 */
function checkRecKeys(v: unknown, where: string, keys: Set<string>, multi: boolean, out: Issues) {
  if (typeof v === "string") { if (!keys.has(v)) out.errors.push(`${where}: 「${v}」は案の key に無い`); return; }
  if (!Array.isArray(v)) { out.errors.push(`${where}: 「${String(v)}」は案の key に無い`); return; }
  if (!multi) { out.errors.push(`${where}: 配列のおすすめは "multi": true の問いだけに書ける`); return; }
  if (!v.length) { out.errors.push(`${where}: 空の配列にしない（おすすめが無ければ rec を書かない）`); return; }
  const seen = new Set<unknown>();
  v.forEach((k, j) => {
    if (typeof k !== "string" || !keys.has(k)) out.errors.push(`${where}[${j}]: 「${String(k)}」は案の key に無い`);
    else if (seen.has(k)) out.errors.push(`${where}[${j}]: 「${k}」が重なっている`);
    seen.add(k);
  });
}

/** 台詞の行（cues）を確かめる。時刻順でないと、再生中に光る行が前後に飛ぶ */
function checkCues(cues: unknown, where: string, out: Issues) {
  if (!Array.isArray(cues) || cues.length === 0) { out.errors.push(`${where}: 台詞の行を 1 つ以上の配列で書く（{"t": 秒, "who": 話し手, "text": 台詞}）`); return; }
  let prev = -Infinity;
  cues.forEach((c: any, j: number) => {
    const w = `${where}[${j}]`;
    if (typeof c?.t !== "number" || !Number.isFinite(c.t) || c.t < 0) { out.errors.push(`${w}.t: 0 以上の秒の数にする`); return; }
    if (c.t < prev) out.errors.push(`${w}.t: ${c.t} 秒が前の行（${prev} 秒）より前。台詞の行は時刻順に並べる`);
    prev = c.t;
    if (c.end !== undefined && (typeof c.end !== "number" || !(c.end > c.t))) out.errors.push(`${w}.end: t より後の秒の数にする`);
    need(c.who, `${w}.who`, out);
    need(c.text, `${w}.text`, out);
    if (c.color !== undefined && typeof c.color !== "string") out.errors.push(`${w}.color: 色の文字列にする`);
  });
}

/** 聞く問い（listen）を確かめる。案が無ければ問いの音と台詞が要り、案があれば案ごとに音と台詞が要る */
function checkListen(q: any, at: string, out: Issues) {
  const opts = q.options;
  if (q.audio !== undefined || opts === undefined) { need(q.audio, `${at}.audio`, out); checkCues(q.cues, `${at}.cues`, out); }
  if (q.offset !== undefined && (typeof q.offset !== "number" || q.offset < 0)) out.errors.push(`${at}.offset: 通しの中の始まりの秒（0 以上の数）にする`);
  if (q.multi !== undefined) out.errors.push(`${at}.multi: 聞く問いは 1 つだけ選ぶ（multi は書けない）`);
  if (opts === undefined) {
    if (q.rec !== undefined) out.errors.push(`${at}.rec: 案（options）の無い聞く問いには、おすすめを書けない`);
    return;
  }
  if (!Array.isArray(opts) || opts.length < 2) { out.errors.push(`${at}.options: 聞き比べる案を 2 つ以上`); return; }
  const keys = new Set<string>();
  opts.forEach((o: any, j: number) => {
    const w = `${at}.options[${j}]`;
    need(o?.key, `${w}.key`, out);
    if (keys.has(o?.key)) out.errors.push(`${w}.key: 「${o.key}」が重なっている`);
    keys.add(o?.key);
    need(o?.name, `${w}.name`, out);
    need(o?.audio, `${w}.audio`, out);
    checkCues(o?.cues, `${w}.cues`, out);
    for (const f of ["pro", "con"]) {
      // 聞き比べ・見比べの案も、cards と同じく利点・欠点を書く。音や絵だけでは、何を得て何を払うかが読めず選べない
      if (o?.[f] === undefined) out.errors.push(`${w}.${f}: 要る（利点・欠点は案ごとに書く。聞き比べ・見比べの案も同じ）`);
      else checkRich(o[f], `${w}.${f}`, out);
    }
  });
  if (q.rec !== undefined && (typeof q.rec !== "string" || !keys.has(q.rec))) out.errors.push(`${at}.rec: 「${String(q.rec)}」は案の key に無い`);
}

/** 場面の札（chapters）を確かめる。時刻順でないと、今の場面の札が前後に飛ぶ */
function checkChapters(chs: unknown, where: string, out: Issues) {
  if (!Array.isArray(chs) || chs.length === 0) { out.errors.push(`${where}: 場面の札を 1 つ以上の配列で書く（{"t": 秒, "label": 名前}）`); return; }
  let prev = -Infinity;
  chs.forEach((c: any, j: number) => {
    const w = `${where}[${j}]`;
    if (typeof c?.t !== "number" || !Number.isFinite(c.t) || c.t < 0) { out.errors.push(`${w}.t: 0 以上の秒の数にする`); return; }
    if (c.t < prev) out.errors.push(`${w}.t: ${c.t} 秒が前の札（${prev} 秒）より前。場面の札は時刻順に並べる`);
    prev = c.t;
    need(c?.label, `${w}.label`, out);
  });
}

/** 見る問い（watch）を確かめる。動画は問いか案ごとに要る。台詞の行と場面の札は任意（あれば時刻順） */
function checkWatch(q: any, at: string, out: Issues) {
  const opts = q.options;
  if (q.video !== undefined || opts === undefined) need(q.video, `${at}.video`, out);
  if (q.cues !== undefined) checkCues(q.cues, `${at}.cues`, out);
  if (q.chapters !== undefined) checkChapters(q.chapters, `${at}.chapters`, out);
  if (q.multi !== undefined) out.errors.push(`${at}.multi: 見る問いは 1 つだけ選ぶ（multi は書けない）`);
  if (opts === undefined) {
    if (q.rec !== undefined) out.errors.push(`${at}.rec: 案（options）の無い見る問いには、おすすめを書けない`);
    return;
  }
  if (!Array.isArray(opts) || opts.length < 2) { out.errors.push(`${at}.options: 見比べる案を 2 つ以上`); return; }
  // 上の動画と同じ動画が案にもあると、読み手は同じ動画を 2 回見せられ、見るだけの節か選ぶ節かが分からなくなる
  if (typeof q.video === "string" && opts.some((o: any) => o?.video === q.video)) out.errors.push(`${at}.video: 案の動画（${q.video}）と同じ動画を上に置かない。案のある見る問いは、上に動画を置かず案の動画で見比べる（上に置くのは、案と別の手本だけ）`);
  const keys = new Set<string>();
  opts.forEach((o: any, j: number) => {
    const w = `${at}.options[${j}]`;
    need(o?.key, `${w}.key`, out);
    if (keys.has(o?.key)) out.errors.push(`${w}.key: 「${o.key}」が重なっている`);
    keys.add(o?.key);
    need(o?.name, `${w}.name`, out);
    need(o?.video, `${w}.video`, out);
    if (o?.cues !== undefined) checkCues(o.cues, `${w}.cues`, out);
    if (o?.chapters !== undefined) checkChapters(o.chapters, `${w}.chapters`, out);
    for (const f of ["pro", "con"]) {
      // 聞き比べ・見比べの案も、cards と同じく利点・欠点を書く。音や絵だけでは、何を得て何を払うかが読めず選べない
      if (o?.[f] === undefined) out.errors.push(`${w}.${f}: 要る（利点・欠点は案ごとに書く。聞き比べ・見比べの案も同じ）`);
      else checkRich(o[f], `${w}.${f}`, out);
    }
  });
  if (q.rec !== undefined && (typeof q.rec !== "string" || !keys.has(q.rec))) out.errors.push(`${at}.rec: 「${String(q.rec)}」は案の key に無い`);
}

/** 通しの再生（listenAll）を確かめる。章の札は時刻順で、聞く問いを指す */
function checkListenAll(L: any, questions: any[], out: Issues) {
  if (!L || typeof L !== "object" || Array.isArray(L)) { out.errors.push(`listenAll: {"audio": …, "marks": [...]} の形にする`); return; }
  need(L.audio, "listenAll.audio", out);
  if (!Array.isArray(L.marks) || L.marks.length === 0) { out.errors.push("listenAll.marks: 章の札を 1 つ以上の配列で書く"); return; }
  const listenIds = new Set(questions.filter((q: any) => q?.kind === "listen").map((q: any) => q.id));
  let prev = -Infinity;
  L.marks.forEach((m: any, j: number) => {
    const w = `listenAll.marks[${j}]`;
    if (typeof m?.t !== "number" || !Number.isFinite(m.t) || m.t < 0) out.errors.push(`${w}.t: 0 以上の秒の数にする`);
    else { if (m.t < prev) out.errors.push(`${w}.t: 章の札は時刻順に並べる`); prev = m.t; }
    need(m?.label, `${w}.label`, out);
    if (m?.q !== undefined && !listenIds.has(m.q)) out.errors.push(`${w}.q: 「${String(m.q)}」は聞く問い（kind: "listen"）の id に無い`);
  });
}

/** 音声と動画のファイル（JSON からの相対パス）があるかを確かめる。無いまま公開すると、読み手のページで鳴らない・映らない */
export function checkMedia(data: any, baseDir: string): Issues {
  const out: Issues = { errors: [], warnings: [] };
  const files: [string, string][] = [];
  if (data?.listenAll?.audio) files.push(["listenAll.audio", data.listenAll.audio]);
  (data?.questions || []).forEach((q: any, i: number) => {
    if (q?.kind !== "listen" && q?.kind !== "watch") return;
    const f = q.kind === "watch" ? "video" : "audio";
    if (typeof q[f] === "string") files.push([`questions[${i}]（${q.id}）.${f}`, q[f]]);
    (Array.isArray(q.options) ? q.options : []).forEach((o: any, j: number) => { if (typeof o?.[f] === "string") files.push([`questions[${i}]（${q.id}）.options[${j}].${f}`, o[f]]); });
  });
  for (const [where, f] of files) {
    if (/^(https?:|data:)/.test(f)) continue;
    if (isAbsolute(f)) { out.errors.push(`${where}: 「${f}」は JSON からの相対パスにする（公開すると絶対パスでは鳴らない）`); continue; }
    if (!existsSync(resolve(baseDir, f))) out.errors.push(`${where}: ${where.endsWith(".video") ? "動画" : "音声"}のファイル「${f}」が無い（JSON からの相対パス）`);
  }
  return out;
}

/**
 * 図の無い節を拾う。どの節にも、目から入れる物（図・語と説明の箱・案ごとの絵・再生する物）を 1 つ置く。
 * 文だけの節は、ぱっと見で何の話かが拾えない。安く足せるのは mermaid。
 */
export function checkFigures(data: any): string[] {
  const has = (x: any) => ["mermaid", "fig", "img"].some(f => typeof x?.[f] === "string" && x[f].trim() !== "") || x?.table !== undefined || x?.compare !== undefined;
  const out: string[] = [];
  (data?.questions ?? []).forEach((q: any, i: number) => {
    if (!q || typeof q !== "object" || q.kind === "listen" || q.kind === "watch") return;
    const rowFig = (r: any) => has(r) || (Array.isArray(r?.pair) && r.pair.length > 0);
    const inside = (q.options ?? []).some(has) || (q.rows ?? []).some(rowFig);
    if (!has(q) && q.terms === undefined && !inside) out.push(`questions[${i}]${q.id ? `（${q.id}）` : ""}: 図が無い。mermaid か fig・terms を 1 つ置く（文だけの節は、ぱっと見で何の話かが拾えない）`);
    // 件ごとに押す問いは、件ごとに図を置く。問いの上の図 1 枚では、どの件が何を変えるのかを読み手が頭の中で組み立てることになる
    if (q.kind === "rows" && Array.isArray(q.rows)) q.rows.forEach((r: any, j: number) => {
      if (!rowFig(r)) out.push(`questions[${i}]${q.id ? `（${q.id}）` : ""}.rows[${j}]: 件の図が無い。mermaid か fig・table を件ごとに置く（図の無い件は、採るか決めにくい）`);
    });
  });
  return out;
}

function need(v: unknown, where: string, out: Issues) {
  if (typeof v !== "string" || v.trim() === "") out.errors.push(`${where}: 空でない文字列が要る`);
}

/** おすすめのある判断ページに、先頭の結論の枠が無ければ警告を返す。置かないと、読み手は下の節を読み終えるまで何をなぜ推すのかが分からない */
export function checkConclusion(data: any): string[] {
  if (data?.conclusion !== undefined || !Array.isArray(data?.questions)) return [];
  return data.questions.some((q: any) => q?.kind === "cards" && q.rec !== undefined)
    ? ["conclusion: おすすめのある問いがあるのに、先頭の結論の枠が無い（結論 1 文と、それを説明する図を書く）"] : [];
}

// 1 問で押す件の上限
const ROWS_MAX = 4;

/**
 * 差分（fig-diff）の件に、種類の札（chg・add・del）があるかを見る。足すだけの件に「前」を置くと、
 * 同じ行を 2 回読ませ、新しく入ることも伝わらない（足す件は前後の行を薄く出し、足す文を + の行にする）
 */
export function checkDiff(fig: unknown): string[] {
  if (typeof fig !== "string" || !fig.includes("fig-diff")) return [];
  const out: string[] = [];
  const items = [...fig.matchAll(/<div class="it( [^"]*)?">([\s\S]*?)(?=<div class="it[ "]|$)/g)];
  if (items.some(m => !/\b(chg|add|del)\b/.test(m[1] ?? ""))) out.push('差分の件に種類の札が無い。class を "it chg"（書き換える）・"it add"（足す）・"it del"（消す）にする');
  if (items.some(m => /\badd\b/.test(m[1] ?? "") && /class="was"/.test(m[2]))) out.push("足す件に「前」がある。足すだけなら前後の行（ctx）と足す文（plus）にする");
  return out;
}

export function validate(data: any): Issues {
  const out: Issues = { errors: [], warnings: [] };
  if (!data || typeof data !== "object") { out.errors.push("JSON の一番外はオブジェクトにする"); return out; }
  need(data.title, "title", out);
  checkRich(data.lead, "lead", out);
  if (data.diagram !== undefined) need(data.diagram, "diagram", out);
  // 結論の枠（ページのいちばん上）。結論 1 文と、それを説明する図 1 枚だけ。表と理由の箇条書きは、すぐ下の論点の一覧と重なるので置かない
  if (data.conclusion !== undefined) {
    const c = data.conclusion;
    if (!c || typeof c !== "object" || Array.isArray(c)) out.errors.push('conclusion: {"text": 結論, "mermaid" か "fig": 図} にする');
    else {
      need(c.text, "conclusion.text", out);
      if (!["mermaid", "fig"].some(f => typeof c[f] === "string" && c[f].trim() !== "")) out.errors.push("conclusion: 結論を説明する図が要る（mermaid か fig）");
      for (const k of ["why", "table", "terms", "compare", "lines"]) if (c[k] !== undefined) out.errors.push(`conclusion.${k}: 書けない（結論の枠は結論 1 文と図 1 枚だけ。理由や表は、問いの recWhy・recFig と下の節に書く）`);
      if (typeof c.mermaid === "string" && (c.mermaid.match(/\[/g) ?? []).length > 4) out.warnings.push("conclusion.mermaid: 箱が 4 つを超えている。枠の図は小さく出るので、1 本の流れを 4 つまでにする");
    }
  }
  if (!Array.isArray(data.questions)) { out.errors.push("questions: 配列が要る（報告だけのページは空の配列）"); return out; }
  // 回答は id ごとに保存されるので、問いの id と rows の件の id はページ全体で重ねない
  const ids = new Set<string>();
  const claim = (id: unknown, where: string) => {
    need(id, where, out);
    if (typeof id !== "string") return;
    if (ids.has(id)) out.errors.push(`${where}: id「${id}」が重なっている（回答が混ざる）`);
    ids.add(id);
  };
  data.questions.forEach((q: any, i: number) => {
    const at = `questions[${i}]${q && q.id ? `（${q.id}）` : ""}`;
    if (!q || typeof q !== "object") { out.errors.push(`${at}: オブジェクトにする`); return; }
    if (!KINDS.has(q.kind)) { out.errors.push(`${at}.kind: cards・rows・info・listen・watch のどれか`); return; }
    if (q.kind === "rows") need(q.id, `${at}.id`, out); else claim(q.id, `${at}.id`);
    need(q.title, `${at}.title`, out);
    checkRich(q.why, `${at}.why`, out);
    if (q.prior !== undefined) {
      if (!Array.isArray(q.prior)) out.errors.push(`${at}.prior: 配列にする（1 項目に 1 つの決め）`);
      else q.prior.forEach((p: unknown, j: number) => checkRich(p, `${at}.prior[${j}]`, out));
    }
    if (q.mermaid !== undefined) need(q.mermaid, `${at}.mermaid`, out);
    // 案をいくつでも選べる印。cards の問いにだけ効く
    if (q.multi !== undefined) {
      if (typeof q.multi !== "boolean") out.errors.push(`${at}.multi: true か false にする`);
      else if (q.kind !== "cards") out.errors.push(`${at}.multi: cards の問いだけに書ける`);
    }
    if (q.terms !== undefined) checkTerms(q.terms, `${at}.terms`, out);
    if (q.table !== undefined) checkTable(q.table, `${at}.table`, out);
    if (q.compare !== undefined) checkCompare(q.compare, `${at}.compare`, out);
    (q.options ?? []).forEach((o: any, j: number) => { if (o?.table !== undefined) checkTable(o.table, `${at}.options[${j}].table`, out); });
    // 手書きの HTML の表は、`コード` も強調も効かず字のまま出る
    for (const [x, w] of [[q, at], ...(q.options ?? []).map((o: any, j: number) => [o, `${at}.options[${j}]`])] as [any, string][]) if (typeof x?.fig === "string" && /<table[\s>]/i.test(x.fig)) out.warnings.push(`${w}.fig: 手書きの HTML の表がある。table 欄に書く（マスの中で \`コード\` と強調が効く）`);
    for (const [x, w] of [[q, at], ...(q.options ?? []).map((o: any, j: number) => [o, `${at}.options[${j}]`]), ...(q.rows ?? []).map((r: any, j: number) => [r, `${at}.rows[${j}]`])] as [any, string][]) for (const m of checkDiff(x?.fig)) out.warnings.push(`${w}.fig: ${m}`);
    if (q.copy !== undefined) (Array.isArray(q.copy) ? q.copy : [q.copy]).forEach((c: any, j: number) => {
      need(c?.text, `${at}.copy[${j}].text`, out);
      if (c?.label !== undefined) need(c.label, `${at}.copy[${j}].label`, out);
    });
    if (q.kind === "info") {
      // 読むだけの節の種類。見出しの札と枠の色が種類で決まる（references/page.md「節の種類」）
      if (q.role !== undefined && !["now", "option", "ref", "report"].includes(q.role)) out.errors.push(`${at}.role: now・option・ref・report のどれか（書かなければ ref）`);
      if (q.role === "option" && (typeof q.key !== "string" || !q.key.trim())) out.errors.push(`${at}.key: 案の節には、判断の案と同じ記号（A など）を書く`);
      if (q.role !== "option" && q.key !== undefined) out.errors.push(`${at}.key: key は role が option の節だけに書ける`);
      if (typeof q.title === "string" && /^(?:[A-Z]|案\s*[A-Z]|現状|参考|報告)\s*[:：.．]/.test(q.title)) out.warnings.push(`${at}.title: 種類や案の記号は見出しの札が出すので、題に書かない（「${q.title}」）`);
      if (!Array.isArray(q.lines) || q.lines.length === 0) { out.errors.push(`${at}.lines: 1 行以上の配列が要る`); return; }
      q.lines.forEach((l: any, j: number) => {
        need(l?.label, `${at}.lines[${j}].label`, out);
        if (typeof l?.label === "string" && [...l.label].length !== 2) out.warnings.push(`${at}.lines[${j}].label: 見出し語は 2 字にそろえる（「${l.label}」）`);
        checkRich(l?.text, `${at}.lines[${j}].text`, out);
      });
    } else if (q.kind === "listen") {
      checkListen(q, at, out);
    } else if (q.kind === "watch") {
      checkWatch(q, at, out);
    } else if (q.kind === "cards") {
      if (!Array.isArray(q.options) || q.options.length < 2) { out.errors.push(`${at}.options: 案を 2 つ以上`); return; }
      const keys = new Set<string>();
      q.options.forEach((o: any, j: number) => {
        const w = `${at}.options[${j}]`;
        need(o?.key, `${w}.key`, out);
        if (keys.has(o?.key)) out.errors.push(`${w}.key: 「${o.key}」が重なっている`);
        keys.add(o?.key);
        need(o?.name, `${w}.name`, out);
        for (const f of ["pro", "con"]) {
          if (o?.[f] === undefined) out.errors.push(`${w}.${f}: 要る（利点・欠点は案ごとに書く）`);
          else checkRich(o[f], `${w}.${f}`, out);
        }
      });
      const multi = q.multi === true;
      if (q.rec === undefined) { /* おすすめを付けない問い */ }
      else if (typeof q.rec === "string" || Array.isArray(q.rec)) {
        checkRecKeys(q.rec, `${at}.rec`, keys, multi, out);
        // 推す理由。利点・欠点の並びからは、どれが決め手でその案を推したのかが読み手に分からない
        if (q.recWhy === undefined || (typeof q.recWhy === "string" && !q.recWhy.trim())) out.errors.push(`${at}.recWhy: 要る（おすすめを付けた問いには、推す理由を書く）`);
        else checkRich(q.recWhy, `${at}.recWhy`, out);
        // 理由を助ける表や図（任意）。問いの図と同じ欄で書く
        if (q.recFig !== undefined) {
          const f = q.recFig;
          if (!f || typeof f !== "object" || Array.isArray(f) || (!["mermaid", "fig"].some(k => typeof f[k] === "string" && f[k].trim() !== "") && f.table === undefined)) out.errors.push(`${at}.recFig: {"table": …}・{"mermaid": …}・{"fig": …} のどれかにする`);
          else if (f.table !== undefined) checkTable(f.table, `${at}.recFig.table`, out);
        }
      }
      else if (q.rec && typeof q.rec === "object") checkDepRec(q.rec, i, at, keys, multi, data.questions, out);
      else out.errors.push(`${at}.rec: 案の key${multi ? "・key の配列" : ""}か {"by": 前の問いの id, …} にする`);
    } else {
      if (!Array.isArray(q.choices) || q.choices.length < 2) out.errors.push(`${at}.choices: 選び方を 2 つ以上`);
      if (!Array.isArray(q.rows) || q.rows.length === 0) { out.errors.push(`${at}.rows: 1 件以上の配列が要る`); return; }
      // 1 問で押す件が多いと、図を見比べながら決められない。意味のある単位（3-3・4-2 など）で問いを分ける
      if (q.rows.length > ROWS_MAX) out.warnings.push(`${at}.rows: ${q.rows.length} 件ある。1 問は ${ROWS_MAX} 件までにし、意味のある単位で問いを分ける`);
      q.rows.forEach((r: any, j: number) => {
        const w = `${at}.rows[${j}]`;
        claim(r?.id, `${w}.id`);
        need(r?.rule, `${w}.rule`, out);
        checkRich(r?.reason, `${w}.reason`, out);
        // 採ったときの利点・欠点は組で書く。おすすめを付けた件に無ければ、推しを退けるかを読み手が決められない
        const has = ["pro", "con"].filter(f => r?.[f] !== undefined);
        for (const f of has) checkRich(r[f], `${w}.${f}`, out);
        if (has.length === 1) out.errors.push(`${w}.${has[0] === "pro" ? "con" : "pro"}: 要る（利点と欠点は組で書く）`);
        else if (!has.length && r?.rec !== undefined) out.warnings.push(`${w}: 利点・欠点が無い。おすすめを付けた件は pro・con を書く（reason は補足として出る）`);
        if (r?.rec !== undefined && Array.isArray(q.choices) && !q.choices.includes(r.rec)) out.errors.push(`${w}.rec: 「${r.rec}」は choices に無い`);
      });
    }
  });
  if (data.listenAll !== undefined) checkListenAll(data.listenAll, data.questions, out);
  return out;
}

// 一覧で同じ名前が並び、検索にも引っかからない名前
const VAGUE = new Set(["判断ページ", "今決めること", "報告ページ", "まとめ", "比較", "整理", "見直し"]);
// これより短い名前は、対象（リポ・スキル名）か論点の語が抜けていることが多い
const SHORT_NAME = 20;

/** ページ名（Artifact の一覧と検索に出る題名）を確かめる */
export function checkName(name: string): Issues {
  const out: Issues = { errors: [], warnings: [] };
  const n = name.trim();
  if (VAGUE.has(n)) out.errors.push(`ページ名「${n}」では一覧で区別できない。対象・主題・論点の語を入れる`);
  else if ([...n].length < SHORT_NAME) out.warnings.push(`ページ名「${n}」は ${[...n].length} 字。対象（リポ・スキル名）と論点の語を足して検索で引けるようにする`);
  return out;
}

const OPEN = '<script type="application/json" id="decision-data">';

/** 雛形の JSON を差し替え、ページ名（<title>）を入れる */
export function build(template: string, data: unknown, name: string): string {
  const a = template.indexOf(OPEN);
  const b = template.indexOf("</script>", a);
  if (a < 0 || b < 0) throw new Error("雛形に decision-data の欄が見つからない");
  // JSON の中の「</」は、script の終わりと読まれないように崩す
  const json = JSON.stringify(data, null, 1).replace(/<\//g, "<\\/");
  const title = name.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const page = template.slice(0, a + OPEN.length) + "\n" + json + "\n" + template.slice(b);
  return page.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
}

/** 雛形の中の見本の JSON（雛形自身の検査に使う） */
export function sampleData(template: string): unknown {
  const a = template.indexOf(OPEN);
  return JSON.parse(template.slice(a + OPEN.length, template.indexOf("</script>", a)));
}

export const TEMPLATE = join(import.meta.dir, "..", "assets", "artifact-decision.html");

export function main(args: string[]): number {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`使い方: build.ts <data.json> [-o <out.html>] [--name <ページ名>]
判断ページの JSON を雛形 assets/artifact-decision.html に差し込み、形を検査して 1 枚の HTML に書き出す。
壊れていれば理由を出して終了 1（書き出さない）。長い 1 文の欄と、図の無い節は警告だけ出す。
聞く問い（kind: "listen"）と通しの再生（listenAll）の音声、見る問い（kind: "watch"）の動画は、JSON からの相対パスでファイルがあるかも確かめる。
-o を省くと JSON と同じ場所に .html で書く。--name はページ名（<title>。Artifact の一覧と検索に出る。省くと JSON の title）。
「判断ページ」のような中身の分からないページ名は止め、20 字未満は警告を出す。
標準出力には書き出したパスを出す。`);
    return args.length === 0 ? 1 : 0;
  }
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const src = args.find((x, i) => !x.startsWith("-") && !["-o", "--name"].includes(args[i - 1]));
  if (!src) { console.error("data.json を渡す"); return 1; }
  let data: any;
  try { data = JSON.parse(readFileSync(src, "utf8")); } catch (e) { console.error(`JSON を読めない: ${(e as Error).message}`); return 1; }
  const name: string = opt("--name") ?? data?.title ?? "";
  const shape = validate(data), named = checkName(name), media = checkMedia(data, dirname(resolve(src)));
  const errors = [...shape.errors, ...named.errors, ...media.errors], warnings = [...shape.warnings, ...named.warnings, ...checkConclusion(data), ...checkFigures(data)];
  for (const w of warnings) console.error(`警告: ${w}`);
  if (errors.length) { for (const e of errors) console.error(`誤り: ${e}`); return 1; }
  const out = opt("-o") ?? join(dirname(src), basename(src, extname(src)) + ".html");
  // 音声と動画は JSON からの相対パスで読むので、書き出し先が別の場所なら同じ並びで写すよう知らせる
  if (media.errors.length === 0 && resolve(dirname(out)) !== resolve(dirname(src)) && (data?.listenAll || data?.questions?.some((q: any) => q?.kind === "listen" || q?.kind === "watch")))
    console.error(`警告: 音声と動画は JSON からの相対パスで読む。書き出し先（${dirname(out)}）にも同じ並びで置く`);
  writeFileSync(out, build(readFileSync(TEMPLATE, "utf8"), data, name));
  console.log(out);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
