#!/usr/bin/env bun
/**
 * content.json の scenes から、index.html に置く場面のクリップの行（窓 = data-start・data-duration）を作る。
 * 窓は作品の assets/scenes.js の timeline と同じ計算（場面の始まりから、次の場面に入れ替わり終わるまで）なので、
 * HyperFrames Studio の時間の帯に場面の区切りがそのまま見える。場面ファイルは B.clock(S, …) が窓の始まりを足して通しの秒で描く。
 * 既定は行を標準出力に出すだけ。--write のときだけ、index.html の <!-- scenes:begin --> と <!-- scenes:end --> の間を書き換える。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadTimeline } from "./check-scenes";

/** 場面ごとのクリップの行。大きさは index.html の根（data-composition-id があり data-composition-src の無い要素）から取る */
export function windowLines(dir: string): string[] {
  const content = JSON.parse(readFileSync(path.join(dir, "content.json"), "utf8"));
  const music = JSON.parse(readFileSync(path.join(dir, "music.json"), "utf8"));
  const index = readFileSync(path.join(dir, "index.html"), "utf8");
  const root = [...index.matchAll(/<(?:div|section)\b[^>]*data-composition-id="[^"]*"[^>]*>/g)].map((x) => x[0]).find((t) => !/data-composition-src=/.test(t)) ?? "";
  const w = /data-width="(\d+)"/.exec(root)?.[1] ?? "1920", h = /data-height="(\d+)"/.exec(root)?.[1] ?? "1080";
  return loadTimeline(dir)(content, music).scenes.map((s, i) =>
    `<div id="${s.id}" data-composition-id="${s.id}" data-composition-src="${s.file}" data-start="${s.window.start}" data-duration="${s.window.duration}" data-track-index="${i + 1}" data-width="${w}" data-height="${h}"></div>`);
}

/** index.html の印の間を、場面のクリップの行で置き換えた文字列。印が無ければ投げる */
export function replaceBlock(index: string, lines: string[]): string {
  const m = /^([ \t]*)<!-- scenes:begin -->[\s\S]*?<!-- scenes:end -->/m.exec(index);
  if (!m) throw new Error("index.html に <!-- scenes:begin --> と <!-- scenes:end --> の印が無い（場面のクリップを置く所に 2 行で書く）");
  const pad = m[1];
  return index.replace(m[0], [`${pad}<!-- scenes:begin -->`, ...lines.map((l) => pad + l), `${pad}<!-- scenes:end -->`].join("\n"));
}

export function main(args: string[]): number {
  const help = `usage: bun scene-windows.ts <作品のフォルダ> [--write]

content.json の scenes から、index.html に置く場面のクリップの行（窓 = data-start・data-duration・data-track-index）を作り、標準出力に出す。
窓は作品の assets/scenes.js の timeline と同じ計算で、Studio の時間の帯に場面の区切りが見える。
--write のときだけ、index.html の <!-- scenes:begin --> と <!-- scenes:end --> の間を書き換える（場面の順・長さを変えたら作り直す）。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const dirs = args.filter((a) => !a.startsWith("-"));
  if (dirs.length !== 1 || args.some((a) => a.startsWith("-") && a !== "--write")) { console.error(help); return 2; }
  const dir = path.resolve(dirs[0]);
  const lines = windowLines(dir);
  if (args.includes("--write")) {
    const file = path.join(dir, "index.html");
    const before = readFileSync(file, "utf8");
    const after = replaceBlock(before, lines);
    if (after !== before) writeFileSync(file, after);
    console.error(after !== before ? `${file} の場面のクリップを書き直した（${lines.length} 行）` : `${file} は scenes と同じ`);
  }
  console.log(lines.join("\n"));
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
