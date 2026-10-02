#!/usr/bin/env bun
/**
 * README の大節（`## ` 見出し）に `1.` `2.` … の番号を上から振り直す（pre-commit で README が変わったときに実行）。
 * 節を足したり並べ替えたりしても番号が飛ばないよう、番号は手で直さずにこのスクリプトに任せる。
 * 番号を振り直したら README を同じコミットに含める。PDF と Web 版は、lefthook がこの後に名前順で走らせる
 * skillsheet-pdf / site-build が振り直した README から作る（コマンド名 heading-numbers はそれらより前に並ぶ）。
 * Web 版は案件詳細を職務経歴に合体させて節として出さないので、表示する節だけで番号を振り直す（scripts/build-site.ts）。
 */
import { $ } from "bun";

const path = "README.md";
const md = await Bun.file(path).text();

let n = 0;
let inFence = false;
const out = md
  .split("\n")
  .map((line) => {
    // コードブロックの中の `## ` は見出しではないので数えない
    if (/^(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return line;
    const m = line.match(/^## (?:\d+\.\s+)?(.+)$/);
    if (!m) return line;
    n += 1;
    return `## ${n}. ${m[1]}`;
  })
  .join("\n");

if (out === md) process.exit(0);
await Bun.write(path, out);
console.log(`大節の番号を 1〜${n} で振り直した`);
await $`git add ${path}`;
