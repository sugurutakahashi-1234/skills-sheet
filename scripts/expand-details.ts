/**
 * README.md の <details>/<summary> 折りたたみを展開した Markdown を返す。
 *
 * なぜ必要か:
 *   案件詳細は GitHub で開いたときの長さを抑えるため <details> で畳んでいるが、
 *   折りたたみが意味を持つのは GitHub の README 表示だけで、他の出力先では邪魔になる。
 *   - PDF: md-to-pdf は Chromium で描画するため、<details> は閉じた状態で出力され中身が消える
 *   - Web 版の「Markdown をコピー」: コピー先に HTML タグが混ざる
 *   どちらも展開した Markdown を渡せば解決する。
 *
 * 前提とする構造:
 *   <details>
 *   <summary>[No.11] 案件名（客先） — 役割 / 技術</summary>
 *
 *   ### [No.11] 案件名（客先）        ← summary と同じ案件を指す見出しが中にある
 *   ...本文...
 *   </details>
 *   summary を削っても見出しが本文側に残るため、情報は失われない。
 */
export function expandDetails(md: string): string {
  // 1. <summary>...</summary> を丸ごと除去（複数行 summary にも対応）
  md = md.replace(/<summary>[\s\S]*?<\/summary>/gi, "");
  // 2. <details ...> 開始タグと </details> 終了タグを除去して中身を本文化する
  md = md.replace(/<details[^>]*>/gi, "");
  md = md.replace(/<\/details>/gi, "");
  // 3. タグ除去で生じた 3 行以上の連続空行を 2 行に圧縮する
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.replace(/^\n+/, "");
}
