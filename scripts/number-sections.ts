#!/usr/bin/env bun
/**
 * README の見出し番号（大節 `1.` / 小節 `3.1`）を上から振り直す（pre-commit で README が変わったときに実行）。
 * 節を足したり並べ替えたりしても番号が飛ばないよう、番号は手で直さずにこのスクリプトに任せる。計算は scripts/section-numbers.ts。
 * 振り直したら README を同じコミットに含める。PDF と Web 版は、lefthook がこの後に名前順で走らせる
 * skillsheet-pdf / site-build が振り直した README から作る（コマンド名 heading-numbers はそれらより前に並ぶ）。
 * Web 版は案件詳細を職務経歴に合体させて節として出さないので、表示する節だけで番号を振り直す（scripts/build-site.ts）。
 *
 * 使い方: bun scripts/number-sections.ts [ファイル] [--check]
 *   --check は書き換えずに、番号がずれていれば終了コード 1 で知らせる
 */
import { $ } from "bun";
import { renumber } from "./section-numbers";

const args = process.argv.slice(2);
const check = args.includes("--check");
const path = args.find((a) => !a.startsWith("--")) ?? "README.md";
const md = await Bun.file(path).text();
const out = renumber(md);
if (out === md) process.exit(0);

if (check) {
  const before = md.split("\n");
  out.split("\n").forEach((line, i) => {
    if (line !== before[i]) console.log(`${i + 1}: ${before[i]}  →  ${line}`);
  });
  console.error(`${path} の見出し番号がずれている（bun scripts/number-sections.ts で直る）`);
  process.exit(1);
}
await Bun.write(path, out);
console.log(`${path} の見出し番号を振り直した`);
if (path === "README.md") await $`git add ${path}`;
