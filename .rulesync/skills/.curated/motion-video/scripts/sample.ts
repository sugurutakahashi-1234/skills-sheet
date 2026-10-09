#!/usr/bin/env bun
/**
 * 見本を本番のコードの上で撮る。作品の content.json（と music.json）の一部の値を差し替えた写しを作り、静止画か短い動画を撮る。
 * 本番のファイルは書き換えない。写しは作品の複製（macOS の APFS では cp -c の複製なので場所も時間も食わない）で、
 * content.json と music.json だけを差し替える。写しは作品の外（既定は作品の隣の samples/<名前>/）に置く。中に置くと、
 * 本番の検査や書き出しがその写しまで読みかねない。
 *
 * 本番と別の HTML で作った見本は、選ばれた後に作り手が本番で組み直すことになり、往復の時間の多くを食う。
 * 値の差し替えで済む見せ方（文言・拍・長さ・並び・定数で切り替える案）は、これで本番の上で撮る。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkScenes, loadTimeline } from "./check-scenes";
import { replaceBlock, windowLines } from "./scene-windows";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** オブジェクトは中まで重ね、配列と値はまるごと置き換える */
export function merge(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b;
  const out: Obj = { ...a };
  for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
  return out;
}

/**
 * 差し替えを重ねる。scenes を場面の id をキーにしたオブジェクトで書くと、その場面に重ねる（配列で書くとまるごと置き換え）。
 * music のキーは music.json に重ねる。戻り値の warnings は scenes に無い id
 */
export function applyPatch(content: Obj & { scenes: Obj[] }, music: Obj, patch: Obj) {
  const { scenes, music: musicPatch, ...rest } = patch;
  const next = merge(content, rest) as typeof content;
  const warnings: string[] = [];
  if (isObj(scenes)) {
    next.scenes = next.scenes.map((s) => (scenes[s.id as string] ? (merge(s, scenes[s.id as string]) as Obj) : s));
    for (const id of Object.keys(scenes)) if (!next.scenes.some((s) => s.id === id)) warnings.push(`scenes に ${id} が無い`);
  } else if (Array.isArray(scenes)) next.scenes = scenes as Obj[];
  return { content: next, music: isObj(musicPatch) ? (merge(music, musicPatch) as Obj) : music, warnings };
}

/** 時刻の並び（通しの秒か「場面の id@場面の中の拍」）を通しの秒にする。start は場面の id ごとの始まりの拍 */
export function toSeconds(spec: string, start: Record<string, number>, beatSeconds: number): number {
  const m = /^([\w-]+)@(-?[0-9.]+)$/.exec(spec.trim());
  if (!m) {
    const v = Number(spec);
    if (!Number.isFinite(v)) throw new Error(`時刻が読めない: ${spec}`);
    return v;
  }
  if (start[m[1]] === undefined) throw new Error(`場面 ${m[1]} が無い`);
  return (start[m[1]] + Number(m[2])) * beatSeconds;
}

const SKIP = new Set(["renders", "snapshots", "samples", "node_modules"]);

export function main(args: string[]): number {
  const help = `usage: bun sample.ts <作品のフォルダ> <名前> [--patch '<JSON>'] [--patch-file <JSON のファイル>] [--at <時刻,…>] [--render <始め-終わり>]
                    [--fps 30] [--out <写しのフォルダ>] [--hf hyperframes]

作品の content.json（と music.json）の一部を差し替えた写しを作り、本番のコードの上で見本を撮る。本番のファイルは書き換えない。
--patch は content.json に重ねる JSON（オブジェクトは中まで重ね、配列はまるごと置き換える）。scenes は場面の id をキーにした
  オブジェクトで書くと、その場面に重ねる。music のキーは music.json に重ねる。例:
  --patch '{"scenes": {"focus": {"beats": {"picks": [1, 3, 5, 7]}}}, "headings": {"focus": {"text": "別の見出し"}}}'
--at は通しの秒か「場面の id@場面の中の拍」（例: 9.5,focus@2）。写しの shots/ に PNG を撮る
--render は通しの秒の範囲（両端に id@拍 も使える）。全体を下書きの画質で書き出し、その範囲を写しの <名前>.mp4 に切り出す
--out を省くと、作品の隣の samples/<名前>/ に写す（前の写しは、この道具が作ったものだけ消して作り直す）
--hf は npx で呼ぶ HyperFrames（版を固定するなら hyperframes@0.8.140 のように）
場面の窓の印（<!-- scenes:begin -->）がある index.html は、写しの中で窓を作り直す。撮る前に差し替えた値を check-scenes で検査し、写しに check-content.ts があればそれも通す。通らなくても撮る（下限を割る見本も撮れるように）。
標準出力には撮った静止画のフォルダと動画のパスを出す。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const [work, name] = args;
  if (!work || !name || work.startsWith("-") || name.startsWith("-")) { console.error(help); return 2; }
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const dir = path.resolve(work);
  if (!existsSync(path.join(dir, "content.json"))) { console.error(`${dir} に content.json が無い`); return 2; }
  const hf = opt("--hf") ?? "hyperframes";

  let patch: Obj = {};
  if (opt("--patch-file")) patch = JSON.parse(readFileSync(opt("--patch-file")!, "utf8"));
  if (opt("--patch")) patch = merge(patch, JSON.parse(opt("--patch")!)) as Obj;
  const content = JSON.parse(readFileSync(path.join(dir, "content.json"), "utf8"));
  const music = JSON.parse(readFileSync(path.join(dir, "music.json"), "utf8"));
  const next = applyPatch(content, music, patch);
  next.warnings.forEach((w) => console.error(`△ ${w}`));

  // 写しを作る
  const out = path.resolve(opt("--out") ?? path.join(path.dirname(dir), "samples", name));
  if (out === dir || out.startsWith(dir + path.sep)) { console.error("写しは作品のフォルダの外に置く"); return 2; }
  if (existsSync(out)) {
    if (!existsSync(path.join(out, ".sample"))) { console.error(`${out} はこの道具の写しではないので消さない`); return 1; }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, ".sample"), "sample.ts が作った写し。消してよい\n");
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || SKIP.has(entry)) continue;
    const r = Bun.spawnSync(["cp", "-Rc", path.join(dir, entry), path.join(out, entry)]);
    if (r.exitCode !== 0) cpSync(path.join(dir, entry), path.join(out, entry), { recursive: true }); // 複製できないディスクでは普通に写す
  }
  writeFileSync(path.join(out, "content.json"), JSON.stringify(next.content, null, 2) + "\n");
  writeFileSync(path.join(out, "music.json"), JSON.stringify(next.music, null, 2) + "\n");
  // 場面の長さや並びを差し替えたら、写しの index.html の窓も作り直す（印があるときだけ。尺いっぱいの窓の作品はそのまま）
  const indexFile = path.join(out, "index.html");
  const index = readFileSync(indexFile, "utf8");
  if (index.includes("<!-- scenes:begin -->")) writeFileSync(indexFile, replaceBlock(index, windowLines(out)));

  // 差し替えた値の検査（結果は表示だけ）
  const check = checkScenes(out);
  console.error(check.errors.length ? check.errors.map((e) => `✗ ${e}`).join("\n") : check.summary);
  if (existsSync(path.join(out, "check-content.ts"))) {
    const r = Bun.spawnSync(["bun", path.join(out, "check-content.ts")], { env: { ...process.env, MOTION_VIDEO_SCRIPTS: import.meta.dir }, stdout: "pipe", stderr: "pipe" });
    console.error((new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr)).trim());
  }

  const T = loadTimeline(out)(next.content as never, next.music as never);
  const start = Object.fromEntries(T.scenes.map((s) => [s.id, s.start]));
  const bs = (next.music as { beatSeconds: number }).beatSeconds;
  if (opt("--at")) {
    const at = opt("--at")!.split(",").map((x) => toSeconds(x, start, bs));
    const r = Bun.spawnSync(["npx", "--yes", hf, "snapshot", out, "-o", path.join(out, "shots"), "--at", at.map((v) => v.toFixed(3)).join(","), "--no-end", "--describe", "false"], { stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) return r.exitCode ?? 1;
    console.log(path.join(out, "shots"));
  }
  if (opt("--render")) {
    const [a, b] = opt("--render")!.split(/-(?=[\w.])/).map((x) => toSeconds(x, start, bs));
    if (!(b > a)) { console.error("--render は 始め-終わり（終わりが後）"); return 2; }
    const full = path.join(out, "full.mp4");
    const r = Bun.spawnSync(["npx", "--yes", hf, "render", out, "--quality", "draft", "--fps", opt("--fps") ?? "30", "-o", full], { stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) return r.exitCode ?? 1;
    const clip = path.join(out, `${name}.mp4`);
    const c = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-ss", String(a), "-i", full, "-t", String(b - a), "-c:v", "libx264", "-crf", "20", "-c:a", "aac", clip], { stdout: "inherit", stderr: "inherit" });
    if (c.exitCode !== 0) return c.exitCode ?? 1;
    console.log(clip);
  }
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
