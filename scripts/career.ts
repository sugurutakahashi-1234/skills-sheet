/**
 * エンジニア歴の「N 年目」を開始年と今日の日付から求める。4 月 1 日に年数が 1 つ上がる（2017 年 4 月入社のため）。
 * README を書き換える pre-commit（scripts/update-career.ts）と、Web 版のページ内スクリプト（build-site.ts が文字列で埋め込む）の両方がこれを使う。
 * ページに埋め込むので、外の変数を参照しない 1 つの関数に保つ。
 */
export function careerYears(startYear: number, today: Date): number {
  const afterApril1 = today.getMonth() >= 3; // getMonth は 0 始まり（3 = 4 月）
  return today.getFullYear() - startYear + (afterApril1 ? 1 : 0);
}

/** README の `- **エンジニア歴**: 10 年目（2017年〜）` の値の部分。1 = 年数、2 = 開始年 */
export const CAREER_RE = /(\d+) 年目（(\d{4})年〜）/;
