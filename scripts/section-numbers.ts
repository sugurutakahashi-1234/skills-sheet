/**
 * README の見出し番号を上から振り直す計算。大節（`## `）に `1.` `2.` …、その下の小節（`### `）に `3.1` `3.2` … を付ける。
 * 案件の見出し（`### [No.N]`）は独自の番号を持つので振らない。コードブロックの中は見出しではないので数えない。
 * 番号の付け直し（pre-commit の scripts/number-sections.ts）と、ずれの検出（Web 版のビルドの警告）がこの 1 か所を使う。
 */
export function renumber(md: string): string {
  let n = 0;
  let sub = 0;
  let inFence = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return line;
      const h2 = line.match(/^## (?:\d+\.\s+)?(.+)$/);
      if (h2) {
        n += 1;
        sub = 0;
        return `## ${n}. ${h2[1]}`;
      }
      const h3 = line.match(/^### (?:\d+\.\d+\s+)?(.+)$/);
      if (!h3 || h3[1].startsWith("[No.")) return line;
      sub += 1;
      return `### ${n}.${sub} ${h3[1]}`;
    })
    .join("\n");
}
