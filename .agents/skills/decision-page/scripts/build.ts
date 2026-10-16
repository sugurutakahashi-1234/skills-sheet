#!/usr/bin/env bun
/**
 * 判断ページの JSON を雛形（assets/artifact-decision.html）に差し込み、形を検査して 1 枚の HTML に書き出す。
 *
 *   build.ts <data.json> [-o <out.html>] [--name <ページ名>]
 *
 * - 書き出す前に形を検査し、壊れていれば理由を出して終了 1（書き出さない）。推しが案に無い・id の重なり・文の欄の形など、
 *   公開してから読み手が気づく誤りを、組み立ての時点で止める
 * - 長い 1 文の欄は警告だけ出す（書き出しは止めない）。事柄が 2 つ以上なら配列（箇条書き）にする
 * - 雛形を変えずに中身だけ差し込むので、見た目はページごとに確かめなくてよい
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

type Issues = { errors: string[]; warnings: string[] };

const KINDS = new Set(["cards", "rows", "info"]);
// これより長い 1 文は、事柄が 2 つ以上入っていることが多い
const LONG = 90;

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

function need(v: unknown, where: string, out: Issues) {
  if (typeof v !== "string" || v.trim() === "") out.errors.push(`${where}: 空でない文字列が要る`);
}

export function validate(data: any): Issues {
  const out: Issues = { errors: [], warnings: [] };
  if (!data || typeof data !== "object") { out.errors.push("JSON の一番外はオブジェクトにする"); return out; }
  need(data.title, "title", out);
  checkRich(data.lead, "lead", out);
  if (data.diagram !== undefined) need(data.diagram, "diagram", out);
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
    if (!KINDS.has(q.kind)) { out.errors.push(`${at}.kind: cards・rows・info のどれか`); return; }
    if (q.kind === "rows") need(q.id, `${at}.id`, out); else claim(q.id, `${at}.id`);
    need(q.title, `${at}.title`, out);
    checkRich(q.why, `${at}.why`, out);
    if (q.prior !== undefined) {
      if (!Array.isArray(q.prior)) out.errors.push(`${at}.prior: 配列にする（1 項目に 1 つの決め）`);
      else q.prior.forEach((p: unknown, j: number) => checkRich(p, `${at}.prior[${j}]`, out));
    }
    if (q.mermaid !== undefined) need(q.mermaid, `${at}.mermaid`, out);
    if (q.kind === "info") {
      if (!Array.isArray(q.lines) || q.lines.length === 0) { out.errors.push(`${at}.lines: 1 行以上の配列が要る`); return; }
      q.lines.forEach((l: any, j: number) => {
        need(l?.label, `${at}.lines[${j}].label`, out);
        if (typeof l?.label === "string" && [...l.label].length !== 2) out.warnings.push(`${at}.lines[${j}].label: 見出し語は 2 字にそろえる（「${l.label}」）`);
        checkRich(l?.text, `${at}.lines[${j}].text`, out);
      });
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
      if (q.rec !== undefined && !keys.has(q.rec)) out.errors.push(`${at}.rec: 「${q.rec}」は案の key に無い`);
    } else {
      if (!Array.isArray(q.choices) || q.choices.length < 2) out.errors.push(`${at}.choices: 選び方を 2 つ以上`);
      if (!Array.isArray(q.rows) || q.rows.length === 0) { out.errors.push(`${at}.rows: 1 件以上の配列が要る`); return; }
      q.rows.forEach((r: any, j: number) => {
        const w = `${at}.rows[${j}]`;
        claim(r?.id, `${w}.id`);
        need(r?.rule, `${w}.rule`, out);
        checkRich(r?.reason, `${w}.reason`, out);
        if (r?.rec !== undefined && Array.isArray(q.choices) && !q.choices.includes(r.rec)) out.errors.push(`${w}.rec: 「${r.rec}」は choices に無い`);
      });
    }
  });
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
壊れていれば理由を出して終了 1（書き出さない）。長い 1 文の欄は警告だけ出す。
-o を省くと JSON と同じ場所に .html で書く。--name はページ名（<title>。省くと JSON の title）。
標準出力には書き出したパスを出す。`);
    return args.length === 0 ? 1 : 0;
  }
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const src = args.find((x, i) => !x.startsWith("-") && !["-o", "--name"].includes(args[i - 1]));
  if (!src) { console.error("data.json を渡す"); return 1; }
  let data: any;
  try { data = JSON.parse(readFileSync(src, "utf8")); } catch (e) { console.error(`JSON を読めない: ${(e as Error).message}`); return 1; }
  const { errors, warnings } = validate(data);
  for (const w of warnings) console.error(`警告: ${w}`);
  if (errors.length) { for (const e of errors) console.error(`誤り: ${e}`); return 1; }
  const out = opt("-o") ?? join(dirname(src), basename(src, extname(src)) + ".html");
  writeFileSync(out, build(readFileSync(TEMPLATE, "utf8"), data, opt("--name") ?? data.title));
  console.log(out);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
