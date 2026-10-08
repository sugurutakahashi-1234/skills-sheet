#!/usr/bin/env bun
/**
 * 構成 × 見た目の案を、履歴と被らないように種（seed）付きで引く。読み取りのみで、何も書き込まない。
 * 棚は ../references/concepts.md の 2 つの表（構成・見た目）が正本。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type Concept = { no: number; name: string; premise: string; build: string; camera: string; fits: string; needs: string };
export type Direction = { name: string; background: string; type: string; motion: string; fits: string; brightness: string; speed: string; tone: string };
export type Mood = { brightness?: string; speed?: string; tone?: string };
export type Pick = { role: "近い" | "大外し"; concept: Concept; direction: Direction };

const CATALOG = path.join(import.meta.dir, "../references/concepts.md");

/** 見出し（## 構成 / ## 見た目）の直後の Markdown の表を行の配列にする */
function table(markdown: string, heading: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`concepts.md に「## ${heading}」の表がない`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) { if (rows.length) break; continue; }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // 見出し行を除く
}

export function loadCatalog(file = CATALOG) {
  const markdown = readFileSync(file, "utf8");
  const concepts: Concept[] = table(markdown, "構成").map(([no, name, premise, build, camera, fits, needs]) => ({ no: Number(no), name, premise, build, camera, fits, needs }));
  const directions: Direction[] = table(markdown, "見た目").map(([name, background, type, motion, fits, brightness, speed, tone]) => ({ name, background, type, motion, fits, brightness, speed, tone }));
  if (!concepts.length || !directions.length) throw new Error("concepts.md の表が空");
  return { concepts, directions };
}

/** 履歴（1 行 1 件の JSON。concept は構成の番号、direction は見た目の名前）。壊れた行は飛ばす */
export function loadHistory(file?: string): { concept?: number; direction?: string }[] {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; }
  });
}

/** 種から決まる乱数（mulberry32）。同じ種なら同じ案が出る */
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 雰囲気の答えにどれだけ合うか（軸ごとに一致 1、`-` は 0.5、答えの無い軸は数えない） */
export function closeness(direction: Direction, mood: Mood): number {
  let score = 0;
  for (const [key, want] of Object.entries(mood) as [keyof Mood, string][]) {
    if (!want) continue;
    const have = direction[key];
    score += have === "-" ? 0.5 : have === want ? 1 : 0;
  }
  return score;
}

export type DrawOptions = { seed: number; mood?: Mood; have?: string[]; history?: { concept?: number; direction?: string }[]; recent?: number; count?: number };

/**
 * 近い案を count - 1 個、雰囲気から一番遠い「大外し」を 1 個引く。
 * 直近 recent 件の履歴にある構成と見た目は避ける（避けると候補が尽きるときだけ戻す）。
 */
export function draw(catalog: ReturnType<typeof loadCatalog>, options: DrawOptions): Pick[] {
  const { seed, mood = {}, have = [], history = [], recent = 2, count = 3 } = options;
  const rnd = random(seed);
  const last = history.slice(-recent);
  const usedConcepts = new Set(last.map((h) => h.concept));
  const usedDirections = new Set(last.map((h) => h.direction));
  const available = catalog.concepts.filter((c) => c.needs === "なし" || have.includes(c.needs));
  const fresh = available.filter((c) => !usedConcepts.has(c.no));
  const concepts = shuffle(fresh.length >= count ? fresh : available, rnd).slice(0, count);
  const directionsFresh = catalog.directions.filter((d) => !usedDirections.has(d.name));
  const directions = directionsFresh.length >= count ? directionsFresh : catalog.directions;
  // 同点の並びは種で崩す
  const ranked = shuffle(directions, rnd).sort((a, b) => closeness(b, mood) - closeness(a, mood));
  const close = ranked.slice(0, count - 1);
  const far = ranked[ranked.length - 1];
  return concepts.map((concept, i) => i < count - 1
    ? { role: "近い" as const, concept, direction: close[i] }
    : { role: "大外し" as const, concept, direction: far });
}

export function main(args: string[]): number {
  const help = `usage: bun draw.ts [--seed N] [--history history.jsonl] [--brightness 明るい|暗い] [--speed 速い|ゆったり] [--tone 真面目|遊び] [--have UI,製品,ロゴ,写真] [--count 3]

構成 × 見た目の案を ../references/concepts.md の棚から引き、JSON で標準出力に出す。何も書き込まない。
--seed を省くと時刻から種を作り、出力に載せる（同じ種を渡せば同じ案が出る。振り直しは別の種で）。
--history は作業ディレクトリの history.jsonl（1 行 1 件、{"concept": 構成の番号, "direction": "見た目の名前", ...}）。直近 2 件の構成と見た目を避ける。
--have は手元にある素材。構成のうち「要る素材」がこれに無いものは引かない。
案は count - 1 個が雰囲気に近いもの、最後の 1 個が一番遠い「大外し」。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const options: DrawOptions = { seed: Date.now() % 1_000_000, mood: {} };
  let historyFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value || value.startsWith("--")) { console.error(help); return 2; }
    i++;
    if (flag === "--seed") options.seed = Number(value);
    else if (flag === "--history") historyFile = value;
    else if (flag === "--brightness") options.mood!.brightness = value;
    else if (flag === "--speed") options.mood!.speed = value;
    else if (flag === "--tone") options.mood!.tone = value;
    else if (flag === "--have") options.have = value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag === "--count") options.count = Number(value);
    else { console.error(help); return 2; }
  }
  if (!Number.isFinite(options.seed) || !(options.count === undefined || options.count >= 2)) { console.error(help); return 2; }
  options.history = loadHistory(historyFile);
  const picks = draw(loadCatalog(), options);
  console.log(JSON.stringify({ seed: options.seed, mood: options.mood, have: options.have ?? [], avoided: options.history.slice(-2), picks }, null, 2));
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
