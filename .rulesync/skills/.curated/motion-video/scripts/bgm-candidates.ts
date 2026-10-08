#!/usr/bin/env bun
/**
 * BGM の候補を、テイストの言葉ごとに HeyGen の音楽カタログ（heygen の CLI）から探し、
 * 長さで絞ってダウンロードし、中身がどこで終わるかと速さを測って JSON にまとめる。
 * 結果は picker.ts の audio にそのまま渡せる。編集せずに使える曲（尺に収まり、自然に終わる曲）を選ぶため。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

export type Query = { label: string; query: string };
export type Candidate = { key: string; name: string; desc: string; src: string; id: string; label: string; duration: number; contentEnd: number; tail: number; ending: "自然に終わる" | "途中で切れる"; bpm: number };

const SR = 11025;

/** 単音 f32 の波形から、0.5 秒ごとの音量・中身の終わり・終わり方・BPM を測る */
export function analyze(x: Float32Array, duration: number) {
  const win = Math.floor(SR / 2);
  const db: number[] = [];
  for (let i = 0; i + win <= x.length; i += win) { let e = 0; for (let k = 0; k < win; k++) e += x[i + k] ** 2; db.push(10 * Math.log10(e / win + 1e-12)); }
  const sorted = [...db].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? -99;
  let last = db.length - 1;
  while (last > 0 && db[last] < median - 20) last--;
  const contentEnd = Math.min(duration, (last + 1) / 2);
  const tail = Math.max(0, +(duration - contentEnd).toFixed(1));
  // 最後の 0.5 秒がまだ大きければ、曲の途中で切れている
  const ending = (db[db.length - 1] ?? -99) > median - 8 ? "途中で切れる" : "自然に終わる";
  // 音の立ち上がりの周期から BPM を推定する（70〜180）
  const hop = 256, fr = SR / hop, env: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) { let e = 0; for (let k = 0; k < hop; k++) e += x[i + k] ** 2; env.push(Math.sqrt(e / hop)); }
  const on = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  let best = { bpm: 0, s: -1 };
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fr; let s = 0;
    for (let i = 0; i + lag * 4 < on.length; i++) s += on[i] * (on[Math.round(i + lag)] + on[Math.round(i + 2 * lag)] + on[Math.round(i + 4 * lag)]);
    if (s > best.s) best = { bpm, s };
  }
  return { contentEnd: +contentEnd.toFixed(1), tail, ending: ending as Candidate["ending"], bpm: best.bpm };
}

function run(cmd: string[], env?: Record<string, string>) {
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} が失敗: ${new TextDecoder().decode(r.stderr).slice(0, 300)}`);
  return r.stdout;
}

export async function main(args: string[]): Promise<number> {
  const help = `usage: bun bgm-candidates.ts <queries.json> <out-dir> [--min 30] [--max 40] [--per 2] [--limit 30]

テイストの言葉ごとに HeyGen の音楽カタログを検索し（heygen の CLI に OAuth でサインイン済みであること）、
長さが --min〜--max 秒の曲を言葉ごとに --per 曲まで <out-dir> にダウンロードする（.wav と、聴き比べ用の .mp3）。
曲ごとに中身の終わり（余韻を除いた秒）・終わり方・BPM を測り、<out-dir>/candidates.json に書く。
書き込むのは <out-dir> の中だけ。標準出力には candidates.json のパスを出す。

queries.json の例:
  [{ "label": "軽快で明るいテック", "query": "upbeat bright modern tech, confident, resolving ending" },
   { "label": "ローファイ", "query": "lo-fi hip hop, warm, relaxed, catchy" }]

candidates.json の各曲の src は "<out-dir の名前>/<id>.mp3"。picker.ts の audio にそのまま入れ、
選択票の HTML を <out-dir> と同じ階層に置けば鳴る。曲の権利（HeyGen 以外で作った動画に使えるか）は公開前に確かめる。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const opt = (name: string, def: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
  const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
  if (positional.length !== 2) { console.error(help); return 2; }
  const [queriesPath, outDir] = positional;
  const min = opt("--min", 30), max = opt("--max", 40), per = opt("--per", 2), limit = opt("--limit", 30);
  const queries = JSON.parse(readFileSync(queriesPath, "utf8")) as Query[];
  mkdirSync(outDir, { recursive: true });
  const path = `${join(homedir(), ".local/bin")}:${process.env.PATH}`;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const q of queries) {
    const res = JSON.parse(new TextDecoder().decode(run(["heygen", "audio", "sounds", "list", "--query", q.query, "--limit", String(limit), "--min-score", "0.6"], { PATH: path })));
    const picked = (res.data ?? []).filter((t: { id: string; duration: number }) => t.duration >= min && t.duration <= max && !seen.has(t.id)).slice(0, per);
    console.error(`${q.label}: ${res.data?.length ?? 0} 曲中 ${picked.length} 曲（${min}〜${max} 秒）`);
    for (const t of picked) {
      seen.add(t.id);
      const wav = join(outDir, `${t.id}.wav`), mp3 = join(outDir, `${t.id}.mp3`);
      const body = await fetch(t.audio_url);
      if (!body.ok) { console.error(`  ${t.id}: ダウンロードに失敗（${body.status}）`); continue; }
      writeFileSync(wav, new Uint8Array(await body.arrayBuffer()));
      run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-b:a", "160k", mp3]);
      const raw = run(["ffmpeg", "-v", "error", "-i", wav, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"]);
      const a = analyze(new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4)), t.duration);
      const key = `M${out.length + 1}`;
      out.push({
        key, id: t.id, label: q.label, duration: t.duration, ...a,
        name: `${q.label}（${t.duration} 秒）`,
        desc: `${a.ending}${a.ending === "自然に終わる" ? `（中身は ${a.contentEnd} 秒まで、余韻 ${a.tail} 秒）` : ""}・約 ${a.bpm} BPM・${t.description}`,
        src: `${basename(outDir)}/${t.id}.mp3`,
      });
    }
  }
  const file = join(outDir, "candidates.json");
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.error(`${out.length} 曲を ${file} に書いた`);
  console.log(file);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { console.error(String(error)); process.exitCode = 1; });
}
