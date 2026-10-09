#!/usr/bin/env bun
/**
 * 仮アニメーション（簡単な HTML と CSS の動き）を、決まった時刻ごとに止めて撮り、数秒の MP4 にする。
 * 本番の動画を作り込む前に、見せ方の方向（場面の切り替え・タイトルの出方・結び方など）を本人に選んでもらうための見本。
 * 作り手（重い文脈を抱えた最上位のモデル）を呼ばずに、まとめ役が数十秒で 3〜4 案をそろえられる。
 *
 * - HTML は 1920×1080 で組み、動きは CSS の @keyframes（または Web Animations）で書く。撮るときは全部の動きを止め、
 *   currentTime を 1 コマずつ進めて撮るので、撮影の速さに左右されずに毎回同じ絵になる
 * - 出力は `<out-dir>/<名前>-a.mp4`。picker.ts の images を "{file}-{row}.mp4" にすると、音なしで繰り返す動画として並ぶ
 * - puppeteer と ffmpeg を使う。puppeteer は使う側のリポジトリに入っているものを読む
 */
import { mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type Options = { outDir?: string; fps: number; seconds: number; scale: number; hold: number };

export function parse(args: string[]): { files: string[]; opts: Options } {
  const opts: Options = { fps: 30, seconds: 3.3, scale: 0.5, hold: 0.7 };
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const num = () => {
      const v = Number(args[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`${a} には正の数が要る`);
      return v;
    };
    if (a === "--out-dir") opts.outDir = args[++i];
    else if (a === "--fps") opts.fps = num();
    else if (a === "--seconds") opts.seconds = num();
    else if (a === "--scale") opts.scale = num();
    else if (a === "--hold") opts.hold = Number(args[++i]);
    else if (a.startsWith("--")) throw new Error(`知らない引数: ${a}`);
    else files.push(a);
  }
  return { files, opts };
}

export async function main(args: string[]): Promise<number> {
  const help = `usage: bun capture-mock.ts <mock.html>... [--out-dir <dir>] [--fps 30] [--seconds 3.3] [--scale 0.5] [--hold 0.7]

仮アニメーションの HTML（1920×1080・CSS の動き）を、1 コマずつ時刻を止めて撮り、<out-dir>/<名前>-a.mp4 に書く。
--seconds は撮る長さ、--hold は最後のコマを止めて見せる秒、--scale は書き出す大きさ（0.5 で 960×540）。
--out-dir を省くと HTML と同じフォルダに書く。標準出力には書いた MP4 のパスを 1 行ずつ出す。
puppeteer（使う側のリポジトリに入っているもの）と ffmpeg が要る。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const { files, opts } = parse(args);
  if (!files.length) { console.error(help); return 2; }
  let puppeteer: typeof import("puppeteer").default;
  try {
    // スクリプトの置き場所（ai-rules）ではなく、実行したリポジトリから探す
    puppeteer = (await import(Bun.resolveSync("puppeteer", process.cwd()))).default;
  } catch {
    console.error("puppeteer が読めない。使う側のリポジトリで `bun add -d puppeteer` してから、そのリポジトリの中で実行する");
    return 1;
  }
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: opts.scale });
    for (const file of files) {
      const html = resolve(file);
      const name = basename(html).replace(/\.html?$/, "");
      const outDir = resolve(opts.outDir ?? dirname(html));
      const frames = join(outDir, `.frames-${name}`);
      rmSync(frames, { recursive: true, force: true });
      mkdirSync(frames, { recursive: true });
      await page.goto(`file://${html}`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
      const count = Math.round(opts.seconds * opts.fps);
      for (let i = 0; i < count; i++) {
        await page.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; }), (i * 1000) / opts.fps);
        await page.screenshot({ path: join(frames, `${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 90 });
      }
      const out = join(outDir, `${name}-a.mp4`);
      const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-framerate", String(opts.fps), "-i", join(frames, "%04d.jpg"),
        "-vf", `tpad=stop_mode=clone:stop_duration=${opts.hold},format=yuv420p`, "-c:v", "libx264", "-crf", "20", out]);
      rmSync(frames, { recursive: true, force: true });
      if (r.exitCode !== 0) throw new Error(`ffmpeg が失敗: ${new TextDecoder().decode(r.stderr).slice(0, 300)}`);
      console.error(`${name}: ${count} コマ`);
      console.log(out);
    }
  } finally {
    await browser.close();
  }
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(String(error)); process.exitCode = 1; });
}
