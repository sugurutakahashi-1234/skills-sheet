/**
 * README のエンジニア歴「N 年目」を今日の日付で計算し直す（pre-commit で毎回実行）。
 * 年数が変わったときだけ README を書き換え、PDF を作り直して両方を同じコミットに含める。
 * README を触らないコミットでも走らせるのは、4 月 1 日を過ぎた後の最初のコミットで直すため。
 */
import { $ } from "bun";
import { CAREER_RE, careerYears } from "./career";

const path = "README.md";
const md = await Bun.file(path).text();
const m = md.match(CAREER_RE);
if (!m) {
  console.warn("警告: README にエンジニア歴（N 年目（YYYY年〜））が見つからない");
  process.exit(0);
}
const now = careerYears(Number(m[2]), new Date());
if (Number(m[1]) === now) process.exit(0);

await Bun.write(path, md.replace(CAREER_RE, `${now} 年目（${m[2]}年〜）`));
console.log(`エンジニア歴を ${m[1]} 年目 → ${now} 年目に更新`);
await $`bun run pdf`;
await $`git add README.md`;
await $`git add -A -- ${"*_高橋俊スキルシート.pdf"}`;
