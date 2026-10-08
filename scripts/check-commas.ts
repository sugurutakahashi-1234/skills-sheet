#!/usr/bin/env bun
/**
 * README の箇条書きのうち、HEAD から足した行・書き換えた行に読点（、）があれば止める。
 * 使い方: bun run check:commas [--worktree]
 *
 * 新しく書く行は読点なしにし、並べるときは「・」で区切る（skillsheet-wording「読点」）。
 * 既に書かれている読点つきの行は止めない。その行を書き換えたときに直す。
 * 既定ではコミットされる内容（git の index）を検査する。--worktree で作業ツリーのファイルを検査する（下書きの確認用）。
 */
import { $ } from "bun";

const FILE = "README.md";
const args = process.argv.slice(2);
const usage = `usage: bun run check:commas [--worktree]

README の箇条書きのうち、HEAD から足した行・書き換えた行に読点（、）があれば一覧を出して終了 1。
既定はコミットされる内容（git の index）、--worktree で作業ツリーのファイルを検査する。`;
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}
if (args.some((a) => a !== "--worktree")) {
  console.error(usage);
  process.exit(2);
}

const head = await $`git show HEAD:${FILE}`.quiet().nothrow();
const base = new Set(head.exitCode === 0 ? head.stdout.toString().split("\n") : []);
const current = args.includes("--worktree")
  ? await Bun.file(FILE).text()
  : (await $`git show :${FILE}`.quiet()).stdout.toString();

const found = current
  .split("\n")
  .map((text, i) => ({ line: i + 1, text }))
  .filter(({ text }) => /^\s*- /.test(text) && text.includes("、") && !base.has(text));

if (found.length === 0) process.exit(0);
console.error(`読点のある箇条書きを足した・書き換えた行が ${found.length} 件あります。読点なしの 1 文にし、並べるときは「・」で区切ってください（skillsheet-wording「読点」）。`);
for (const { line, text } of found) console.error(`  L${line}  ${text.trim()}`);
process.exit(1);
