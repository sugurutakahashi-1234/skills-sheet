/**
 * 作品の検査。content.json・music.json を書き換えたら、書き出す前に通す:
 *   bunx -p typescript tsc -p <作品>/tsconfig.json && bun <作品>/check-content.ts
 * tsc は形（キーの抜け・型の違い）を確かめる。場面の並び（長さの合計 = 尺・姿勢のつながり・index.html の窓・場面ごとの下限）は
 * motion-video スキルの scripts/check-scenes.ts に任せ、ここには題材ごとの検査（項目・ロゴのファイルなど）だけを書く。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import data from "./content.json";
import musicData from "./music.json";
import type { Content, Music } from "./content.types";

const here = dirname(fileURLToPath(import.meta.url));
const c: Content = data; // 形が合わなければ tsc がここで止める
const m: Music = musicData;
const errors: string[] = [];
const need = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };

// ── 題材ごとの検査（作品に合わせて書き換える） ──
need(c.items.length > 0, "items が空");
c.items.forEach((it) => need(/^#[0-9a-f]{6}$/i.test(it.color), `項目 ${it.label} の色 ${it.color} が #rrggbb でない`));
const focus = c.scenes.find((s) => s.id === "focus");
if (focus) need((focus.beats.picks as number[]).length <= c.items.length, "focus の picks が項目の数より多い");
// 帯で入る場面の最初の動きは、帯が抜け終えてから（帯の下で始まる動きは隠れて見えない。beats のどれが時刻かは場面ごとに違うのでここで書く）
const items = c.scenes.find((s) => s.id === "items");
if (items?.entry.type === "band") need((items.beats.first as number) - 0.3 / m.beatSeconds >= items.entry.gone!, "items の最初の線（first の 0.3 秒前）が、帯が抜け終える前に伸び始める");
need(m.file === null || existsSync(join(here, m.file)), `曲のファイル ${m.file} が無い`);

// ── 場面の並びの検査（スキルの check-scenes.ts）。スキルの置き場所は MOTION_VIDEO_SCRIPTS か、上のフォルダをたどって探す
// （rulesync で入れたリポジトリは .claude/skills か .agents/skills の下） ──
function findCheckScenes(from: string): string | null {
  if (process.env.MOTION_VIDEO_SCRIPTS) return join(process.env.MOTION_VIDEO_SCRIPTS, "check-scenes.ts");
  for (let dir = from; ; dir = dirname(dir)) {
    for (const rel of [".claude/skills", ".agents/skills", "skills"]) {
      const file = join(dir, rel, "motion-video/scripts/check-scenes.ts");
      if (existsSync(file)) return file;
    }
    if (dirname(dir) === dir) return null;
  }
}
const found = findCheckScenes(here);
if (!found) errors.push("motion-video スキルの scripts/check-scenes.ts が見つからない（MOTION_VIDEO_SCRIPTS に scripts のフォルダを渡す）");
else {
  const { checkScenes } = await import(found);
  const result = checkScenes(here);
  errors.push(...result.errors);
  if (!errors.length) console.log(result.summary);
}

if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join("\n")); process.exit(1); }
console.log(`content.json OK（場面 ${c.scenes.length}・項目 ${c.items.length}）`);
