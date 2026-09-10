#!/usr/bin/env bun
// Markdown の <details>/<summary> 折りたたみを「展開」した Markdown を生成する。
//
// なぜ必要か:
//   md-to-pdf は Chromium でレンダリングして PDF 化するため、<details> は
//   折りたたまれた（閉じた）状態で描画され、中身が PDF に一切出力されない。
//   スキルシートでは各案件の詳細がすべて <details> の中にあるため、そのまま
//   変換すると本文の大半が消える。これを防ぐためタグを除去して中身を露出させる。
//
// 前提とする構造:
//   <details><summary>[No.13] ...</summary>
//
//   ## [No.13] ...          ← summary と同じ内容の見出しが直後に重複している
//   ...本文...
//   </details>
//   のように、summary の中身は直後の Markdown 見出しと重複している。
//   よって <summary> を削除しても見出しは本文側に残り、情報は失われない。
//
// 使い方（Bun で TypeScript を直接実行）:
//   bun expand-details.ts <input.md> [output.md]
//   - output.md 省略時は <input>.expanded.md を生成
//   - 標準出力には生成したファイルのパスを 1 行で返す

import { readFile, writeFile } from "node:fs/promises";

function expandDetails(md: string): string {
  // 1. <summary>...</summary> を丸ごと除去（複数行 summary にも対応）。
  //    中身は直後の Markdown 見出しと重複しているため情報は失われない。
  md = md.replace(/<summary>[\s\S]*?<\/summary>/gi, "");
  // 2. <details ...> 開始タグと </details> 終了タグを除去して中身を本文化する。
  md = md.replace(/<details[^>]*>/gi, "");
  md = md.replace(/<\/details>/gi, "");
  // 3. タグ除去で生じた 3 行以上の連続空行を 2 行に圧縮して見た目を整える。
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.replace(/^\n+/, "");
}

async function main(): Promise<void> {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath) {
    console.error("usage: bun expand-details.ts <input.md> [output.md]");
    process.exit(1);
  }

  const md = expandDetails(await readFile(inPath, "utf8"));
  const out = outPath ?? inPath.replace(/\.md$/i, ".expanded.md");
  await writeFile(out, md);
  console.log(out);
}

main();
