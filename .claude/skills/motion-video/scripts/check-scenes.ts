#!/usr/bin/env bun
/**
 * 作品のフォルダの content.json（scenes）・music.json・index.html を突き合わせ、場面の並びを検査する。読み取りのみ。
 *
 * 確かめること: 場面の id とファイル・index.html のクリップと窓・長さの合計 = 尺・入り方の拍・前後の姿勢のつながり・
 * 場面ごとの下限（scenes[].limits）・曲のファイル。題材ごとの検査（ロゴのファイル・帯が抜けてから最初の動きが始まるか など、
 * beats の中身の意味が要るもの）は作品の check-content.ts に書き、そこから checkScenes を呼ぶ（雛形の assets/scaffold/check-content.ts）。
 * 時刻の計算は作品の assets/scenes.js（無ければ雛形の scenes.js）の timeline を使うので、書き出しと同じ時刻で確かめる。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Num = Record<string, number | number[] | undefined>;
type Pose = Record<string, unknown>;
export type Scene = {
  id: string; file: string; length: number;
  entry: { type: string; cover?: number; leave?: number; gone?: number; out?: number };
  pose: { start: Pose; end: Pose };
  beats: Num;
  limits?: { shown?: number; gaps?: Record<string, { each?: number; avg?: number } | undefined> };
};
export type Placed = Scene & { start: number; end: number; t0: number; t1: number; at: (b: number) => number; band?: { in: number; cover: number; leave: number; gone: number }; window: { start: number; duration: number } };
export type Music = { file: string | null; beatSeconds: number; duration: number; markers?: Record<string, number | undefined> };
export type Timeline = (content: { scenes: Scene[] }, music: Music) => { beat: (n: number) => number; scenes: Placed[]; totalBeats: number };
export type Result = { errors: string[]; summary: string; scenes: Placed[] };

const SCAFFOLD_TIMELINE = path.join(import.meta.dir, "../assets/scaffold/assets/scenes.js");

/** 作品の assets/scenes.js（無ければ雛形のもの）から timeline を読む。ブラウザ用の部分は document が無いので動かない */
export function loadTimeline(dir: string): Timeline {
  const own = path.join(dir, "assets/scenes.js");
  const file = existsSync(own) ? own : SCAFFOLD_TIMELINE;
  const mod: { exports: { timeline?: Timeline } } = { exports: {} };
  new Function("module", "exports", readFileSync(file, "utf8"))(mod, mod.exports);
  if (!mod.exports.timeline) throw new Error(`${file} が timeline を書き出していない`);
  return mod.exports.timeline;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const close = (a: number, b: number, eps = 0.0005) => Math.abs(a - b) <= eps;
const f2 = (v: number) => v.toFixed(2);

export function checkScenes(dir: string): Result {
  const errors: string[] = [];
  const need = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
  const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
  for (const name of ["content.json", "music.json", "index.html"]) {
    if (!existsSync(path.join(dir, name))) return { errors: [`${name} が無い`], summary: "", scenes: [] };
  }
  const content = JSON.parse(read("content.json")) as { scenes: Scene[]; headings?: Record<string, unknown> };
  const music = JSON.parse(read("music.json")) as Music;
  const index = read("index.html");
  if (!Array.isArray(content.scenes) || !content.scenes.length) return { errors: ["content.json に scenes が無い"], summary: "", scenes: [] };
  const T = loadTimeline(dir)(content, music);
  const sc = T.scenes;
  const bs = music.beatSeconds;

  // ── index.html の根とクリップ ──
  const tags = [...index.matchAll(/<(?:div|section)\b[^>]*data-composition-id="[^"]*"[^>]*>/g)].map((x) => x[0]);
  const rootTag = tags.find((t) => !attr(t, "data-composition-src"));
  const fps = Number(rootTag && attr(rootTag, "data-fps")) || 30;
  need(!!rootTag && Number(attr(rootTag, "data-duration")) === music.duration, `index.html の根の data-duration が music.json の duration（${music.duration}）と違う`);
  const clips = tags.filter((t) => attr(t, "data-composition-src")).map((t) => ({
    id: attr(t, "data-composition-id")!, src: attr(t, "data-composition-src")!, start: Number(attr(t, "data-start")), duration: Number(attr(t, "data-duration")),
  }));
  const full = (c: { start: number; duration: number }) => c.start === 0 && close(c.duration, music.duration);

  // ── 場面 ──
  need(new Set(sc.map((s) => s.id)).size === sc.length, "場面の id が重なっている");
  need(Math.abs(T.totalBeats * bs - music.duration) <= 1 / fps + 1e-9, `場面の長さの合計 ${T.totalBeats} 拍（${f2(T.totalBeats * bs)} 秒）が尺 ${music.duration} 秒と 1 コマ以上違う`);
  sc.forEach((s, i) => {
    need(s.length > 0, `場面 ${s.id} の length が 0 以下`);
    if (!existsSync(path.join(dir, s.file))) need(false, `場面 ${s.id} のファイル ${s.file} が無い`);
    else need(read(s.file).includes(`data-composition-id="${s.id}"`), `${s.file} の data-composition-id が場面の id ${s.id} と違う`);
    const clip = clips.find((c) => c.src === s.file);
    if (!clip) need(false, `index.html に場面 ${s.id} のクリップ（data-composition-src="${s.file}"）が無い`);
    else {
      need(clip.id === s.id, `index.html の ${s.file} のクリップの data-composition-id が ${s.id} でない`);
      need((close(clip.start, s.window.start) && close(clip.duration, s.window.duration)) || full(clip),
        `場面 ${s.id} の窓 ${clip.start}〜+${clip.duration} 秒が scenes から決まる ${s.window.start}〜+${s.window.duration} 秒と違う（scene-windows.ts --write で書き直す）`);
    }
    const e = s.entry;
    if (i === 0) need(e.type === "cut", `最初の場面 ${s.id} の入り方は cut にする`);
    else if (e.type === "band") {
      need(0 < e.cover! && e.cover! < e.leave! && e.leave! < e.gone! && e.gone! < s.length, `場面 ${s.id} の帯の拍は 0 < cover < leave < gone < length にする`);
    } else if (e.type === "swap" || e.type === "fade") need((e.out ?? 0) > 0, `場面 ${s.id} の ${e.type} に out（前の場面が消える秒）が無い`);
    else need(false, `場面 ${s.id} の入り方 ${e.type} が無い（cut・band・swap・fade）`);
    if (content.headings && (e.type === "band" || e.type === "swap")) need(!!content.headings[s.id], `場面 ${s.id} は ${e.type} で入るのに見出し（headings.${s.id}）が無い`);
  });
  clips.forEach((c) => need(sc.some((s) => s.file === c.src) || full(c), `index.html の ${c.src} が scenes に無い（尺いっぱいの重ね以外は、使わない場面のクリップを外す）`));

  // ── 前後の姿勢のつながり。同じ部品が前後の場面にあれば姿勢が一致し、片方にしか無ければ帯かフェードで出入りさせる ──
  sc.forEach((s, i) => {
    if (!i) return;
    const a = sc[i - 1].pose.end, b = s.pose.start, t = s.entry.type;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] && b[k]) need(JSON.stringify(a[k]) === JSON.stringify(b[k]), `${sc[i - 1].id} の終わりと ${s.id} の始まりで部品 ${k} の姿勢が違う（切り替えの前後で ${k} が動いて見える）`);
      else if (a[k]) need(t === "band" || t === "fade", `${s.id} に部品 ${k} が無いのに、入り方 ${t} では ${k} が急に消える（band か fade にする）`);
      else if (b[k]) need(t === "band" || t === "fade", `${s.id} で部品 ${k} が現れるのに、入り方 ${t} では急に現れる（band か fade にする）`);
    }
  });

  // ── 場面ごとの下限 ──
  // 見えている秒: 中身が出始める（帯なら gone、それ以外は始まり）から、次の場面に入れ替わり終わる（次が帯なら cover、swap・fade なら次の始まり + out）まで
  sc.forEach((s, i) => {
    const L = s.limits;
    if (!L) return;
    const n = sc[i + 1];
    const from = s.band ? T.beat(s.band.gone) : s.t0;
    const to = !n ? music.duration : n.band ? T.beat(n.band.cover) : n.t0 + (n.entry.out ?? 0);
    if (L.shown !== undefined) need(to - from >= L.shown - 1e-9, `場面 ${s.id} が見えているのは ${f2(to - from)} 秒（下限 ${L.shown} 秒）`);
    for (const [k, g] of Object.entries(L.gaps ?? {})) {
      const arr = s.beats[k];
      if (!Array.isArray(arr) || arr.length < 2 || !g) { need(false, `場面 ${s.id} の limits.gaps.${k} に当たる beats.${k} が 2 つ以上の配列でない`); continue; }
      const gaps = arr.slice(1).map((v, j) => (v - arr[j]) * bs);
      gaps.forEach((v, j) => need(v > 0, `場面 ${s.id} の beats.${k} が前後している（${j + 1} 番目と ${j + 2} 番目）`));
      if (g.each !== undefined) gaps.forEach((v, j) => need(v >= g.each! - 1e-9, `場面 ${s.id} の beats.${k} の ${j + 1} 番目の間が ${f2(v)} 秒（下限 ${g.each} 秒）`));
      if (g.avg !== undefined) { const avg = gaps.reduce((x, y) => x + y, 0) / gaps.length; need(avg >= g.avg - 1e-9, `場面 ${s.id} の beats.${k} の間が平均 ${f2(avg)} 秒（下限 ${g.avg} 秒）`); }
    }
  });

  // ── 曲 ──
  if (music.file) {
    need(existsSync(path.join(dir, music.file)), `曲のファイル ${music.file} が無い`);
    need(new RegExp(`<audio\\b[^>]*src="${music.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(index), `index.html に曲の <audio src="${music.file}"> が無い`);
  }

  const summary = sc.map((s) => `  ${s.id.padEnd(12)} ${String(+s.start.toFixed(3)).padStart(7)} 拍〜 ${f2(s.t0).padStart(6)}〜${f2(s.t1).padStart(6)} 秒  ${s.entry.type.padEnd(5)} 窓 ${s.window.start}〜+${s.window.duration}`).join("\n");
  return { errors, summary: `場面 ${sc.length}・${T.totalBeats} 拍・${f2(T.totalBeats * bs)} 秒\n${summary}`, scenes: sc };
}

export function main(args: string[]): number {
  const help = `usage: bun check-scenes.ts <作品のフォルダ>

作品の content.json（scenes）・music.json・index.html を突き合わせ、場面の並びを検査する（読み取りのみ）。
確かめること: 場面の id とファイル・index.html のクリップと窓・長さの合計 = 尺（1 コマ以内）・入り方の拍・前後の姿勢のつながり・
場面ごとの下限（scenes[].limits の shown と gaps）・曲のファイル。
通れば場面の表を標準出力に出して 0、通らなければ食い違いを標準エラーに出して 1 で終わる。
題材ごとの検査は作品の check-content.ts に書き、そこから checkScenes(dir) を呼ぶ。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  if (args.length !== 1 || args[0].startsWith("-")) { console.error(help); return 2; }
  const result = checkScenes(path.resolve(args[0]));
  if (result.errors.length) { console.error(result.errors.map((e) => `✗ ${e}`).join("\n")); return 1; }
  console.log(result.summary);
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
