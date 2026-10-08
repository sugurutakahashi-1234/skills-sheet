#!/usr/bin/env bun
/**
 * 拍の表（JSON）から BGM と効果音を合成し、48 kHz ステレオの WAV を書き出す。
 * 映像と同じ拍番号で音を置くので、場面の切り替わり・一撃・文字の出とずれない。
 * 曲を持ち込めないとき（HyperFrames の BGM 検索は heygen CLI が無いと使えない）の代わり。乱数は種付きで、同じ表なら同じ音になる。
 * 音作りは軽めに寄せてある。低音を厚くした版は「BGM が重い」と 2 本続けて言われたため、キックとベースは控えめにし、明るい分散和音で拍を刻む。
 */
import { readFileSync, writeFileSync } from "node:fs";

export type Typing = number | { start: number; count: number; every: number; gain?: number };
export type BeatTable = {
  bpm: number;
  beats: number;
  /** キック・クラップ・ハイハット・ベースを鳴らす区間 [開始拍, 終了拍) */
  groove?: [number, number];
  /** テンポを半分に感じさせる区間 [開始拍, 終了拍)。解説の場面など */
  halfTime?: [number, number];
  /** 4 拍ごとの和音。既定 "Am F C G" */
  chords?: string;
  /** 一撃（短い打撃と明るい余韻）を置く拍。場面の着地に使う */
  drops?: number[];
  /** 軽い切り替えの風切り音を置く拍（音の山がその拍に来る） */
  whooshes?: number[];
  /** 盛り上げ [開始拍, 長さ（拍）] */
  risers?: [number, number][];
  /** 短いクリック音を置く拍 */
  ticks?: number[];
  /** タイプ音。拍の配列か、{ start, count, every } で等間隔 */
  typing?: Typing[];
  /** この拍から最後まで音を絞る */
  fadeFrom?: number;
};

const SR = 48000;

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 和音名（Am, F, C#, Bb など）を、ベースの周波数と 3 和音の周波数にする */
export function chord(name: string): { bass: number; tones: number[] } {
  const m = name.match(/^([A-G])([#b]?)(m?)$/);
  if (!m) throw new Error(`和音名が読めない: ${name}`);
  const pc = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  let bassMidi = 24 + ((pc + 12) % 12);
  if (hz(bassMidi) < 41) bassMidi += 12; // E1〜D#2 に収める
  const root = 53 + ((pc - 5 + 24) % 12); // F3〜E4
  return { bass: hz(bassMidi), tones: [0, m[3] ? 3 : 4, 7].map((i) => hz(root + i)) };
}

export function synth(table: BeatTable, seed = 7) {
  const beatSec = 60 / table.bpm;
  const N = Math.round(SR * beatSec * table.beats);
  const L = new Float64Array(N);
  const R = new Float64Array(N);
  const rnd = mulberry32(seed);
  const at = (beat: number) => Math.round(beat * beatSec * SR);
  const time = (sec: number) => Float64Array.from({ length: Math.floor(sec * SR) }, (_, i) => i / SR);
  const noise = (n: number) => Float64Array.from({ length: n }, () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd()));
  const lowpass = (x: Float64Array, k: number) => {
    if (k <= 1) return x;
    const y = new Float64Array(x.length);
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      sum += x[i];
      if (i >= k) sum -= x[i - k];
      if (i >= k - 1) y[i - k + 1] = sum / k;
    }
    return y;
  };
  const highpass = (x: Float64Array) => x.map((v, i) => v - (i ? x[i - 1] : 0));
  const add = (sig: Float64Array, beat: number, gain = 1, pan = 0) => {
    const i = at(beat);
    if (i >= N || i < 0) return;
    const gl = gain * (1 - Math.max(pan, 0)), gr = gain * (1 + Math.min(pan, 0));
    for (let k = 0; k < sig.length && i + k < N; k++) { L[i + k] += sig[k] * gl; R[i + k] += sig[k] * gr; }
  };

  // ---- 音色 ----
  const kick = () => {
    const t = time(0.45), n = noise(t.length);
    let ph = 0;
    return t.map((s, i) => { ph += (2 * Math.PI * (62 + 110 * Math.exp(-s * 40))) / SR; return Math.sin(ph) * Math.exp(-s * 13) + n[i] * Math.exp(-s * 500) * 0.3; });
  };
  const clap = () => {
    const t = time(0.25), n = highpass(noise(t.length));
    return t.map((s, i) => {
      const env = Math.exp(-s * 22) + 0.6 * Math.exp(-((s - 0.012) ** 2) / 1e-5) + 0.5 * Math.exp(-((s - 0.024) ** 2) / 1e-5);
      return (n[i] * 0.5 * env + Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s * 30) * 0.4) * 0.8;
    });
  };
  const hat = (open: boolean) => {
    const t = time(open ? 0.18 : 0.05), n = highpass(highpass(noise(t.length)));
    return t.map((s, i) => n[i] * Math.exp(-s * (open ? 18 : 90)) * 0.35);
  };
  const bass = (f: number, dur: number) => {
    const t = time(dur);
    const s = t.map((x) => { let v = 0; for (let k = 1; k <= 6; k++) v += Math.sin(2 * Math.PI * f * k * x) / k; return v * Math.min(1, x * 200) * Math.exp(-x * 3.5); });
    return lowpass(s, 6).map((v) => v * 0.55);
  };
  const pad = (tones: number[], dur: number) => {
    const t = time(dur);
    const s = t.map((x) => {
      let v = 0;
      for (const f of tones) for (const d of [-0.15, 0.15]) for (let k = 1; k <= 4; k++) v += Math.sin(2 * Math.PI * (f + d) * k * x) / k;
      return v * Math.min(1, x / 0.4) * Math.min(1, (dur - x) / 0.4);
    });
    return lowpass(s, 4).map((v) => v * 0.035);
  };
  const boom = () => {
    const t = time(1.2), n = highpass(noise(t.length));
    let ph = 0;
    return t.map((s, i) => {
      ph += (2 * Math.PI * (70 + 90 * Math.exp(-s * 30))) / SR;
      const hit = Math.sin(ph) * Math.exp(-s * 9) * 0.6;
      const air = n[i] * Math.exp(-s * 6) * 0.22;
      const bell = [1046.5, 1568, 2093].reduce((v, f) => v + Math.sin(2 * Math.PI * f * s), 0) * Math.exp(-s * 3.5) * 0.08;
      return hit + air + bell;
    });
  };
  // 明るい分散和音の 1 音（ベル風。基音と 2 倍音を短く減衰させる）
  const pluck = (f: number) => {
    const t = time(0.4);
    return t.map((s) => (Math.sin(2 * Math.PI * f * s) + 0.35 * Math.sin(4 * Math.PI * f * s)) * Math.min(1, s * 400) * Math.exp(-s * 9));
  };
  const riser = (beats: number) => {
    const t = time(beats * beatSec), n = noise(t.length), lo = lowpass(n, 40), hi = highpass(n);
    const last = t[t.length - 1] || 1;
    let ph = 0;
    return t.map((s, i) => { const k = s / last; ph += (2 * Math.PI * (200 + 1400 * k * k)) / SR; return ((lo[i] * (1 - k) + hi[i] * k) * 0.5 + Math.sin(ph) * 0.15) * k * k; });
  };
  const whoosh = () => {
    const t = time(0.5), n = lowpass(noise(t.length), 12);
    return t.map((s, i) => n[i] * Math.sin(Math.PI * Math.min(1, s / 0.5)) ** 2 * 0.9);
  };
  const tick = () => { const t = time(0.03), n = highpass(noise(t.length)); return t.map((s, i) => n[i] * Math.exp(-s * 250) * 0.5); };
  const typeClick = () => { const t = time(0.04), n = highpass(noise(t.length)); return t.map((s, i) => (n[i] * Math.exp(-s * 180) + Math.sin(2 * Math.PI * 1800 * s) * Math.exp(-s * 300) * 0.3) * 0.45); };

  // ---- 譜面 ----
  const chords = (table.chords ?? "Am F C G").split(/\s+/).filter(Boolean).map(chord);
  const chordAt = (beat: number) => chords[Math.floor(beat / 4) % chords.length];
  for (let b = 0; b < table.beats; b += 4) add(pad(chordAt(b).tones, 4 * beatSec), b);
  const [g0, g1] = table.groove ?? [0, 0];
  const half = (b: number) => !!table.halfTime && b >= table.halfTime[0] && b < table.halfTime[1];
  const kicks: number[] = [];
  for (let b = g0; b < g1; b++) {
    if (!half(b) || b % 2 === 0) { add(kick(), b, 0.6); kicks.push(b); }
    if (b % 2 === 1 && !half(b)) add(clap(), b, 0.55, 0.05);
    add(hat(false), b + 0.5, 0.75, 0.3);
    if (b % 4 === 3) add(hat(true), b + 0.5, 0.5, -0.3);
    for (const h of half(b) ? [0] : [0, 0.5]) add(bass(chordAt(b).bass * 2, beatSec * 0.48), b + h, 0.42);
    const tones = chordAt(b).tones;
    [0, 0.5].forEach((h, k) => { const step = (b * 2 + k) % 4; add(pluck(tones[[0, 1, 2, 1][step]] * 2), b + h, 0.16, step % 2 ? 0.35 : -0.35); });
  }
  for (const [start, length] of table.risers ?? []) add(riser(length), start, 0.75);
  for (const b of table.drops ?? []) add(boom(), b);
  for (const b of table.whooshes ?? []) add(whoosh(), b - 0.25, 0.7);
  (table.ticks ?? []).forEach((b, i) => add(tick(), b, 0.8, i % 2 ? 0.4 : -0.4));
  let typed = 0;
  for (const item of table.typing ?? []) {
    const list = typeof item === "number" ? [{ beat: item, gain: 0.9 }] : Array.from({ length: item.count }, (_, i) => ({ beat: item.start + i * item.every, gain: item.gain ?? 0.9 }));
    for (const { beat, gain } of list) add(typeClick(), beat, gain, typed++ % 2 ? -0.2 : 0.2);
  }

  // キックの直後に全体を少し沈める（サイドチェイン風）
  const duckLen = Math.floor(0.25 * SR);
  for (const b of kicks) {
    const i = at(b);
    for (let k = 0; k < duckLen && i + k < N; k++) { const g = 0.78 + 0.22 * (k / duckLen); L[i + k] *= g; R[i + k] *= g; }
  }
  if (table.fadeFrom !== undefined) {
    const i0 = at(table.fadeFrom);
    for (let i = Math.max(0, i0); i < N; i++) { const g = (1 - (i - i0) / Math.max(1, N - i0)) ** 1.5; L[i] *= g; R[i] *= g; }
  }
  // 約 70 Hz 以下を削る（1 次のハイパス）。スマホやノートの小さいスピーカーで低音がこもらないように
  const a = 1 / (1 + 2 * Math.PI * 70 / SR);
  for (const ch of [L, R]) { let px = 0, py = 0; for (let i = 0; i < N; i++) { const y = a * (py + ch[i] - px); px = ch[i]; py = y; ch[i] = y; } }
  // 柔らかく潰してから -1 dBFS に揃える
  let peak = 1e-9;
  for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 0.9); R[i] = Math.tanh(R[i] * 0.9); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const gain = 0.89 / peak;
  return { left: L.map((v) => v * gain), right: R.map((v) => v * gain), sampleRate: SR };
}

export function wav(left: Float64Array, right: Float64Array, sampleRate = SR): Uint8Array {
  const n = left.length, bytes = new Uint8Array(44 + n * 4), view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + n * 4, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return bytes;
}

export function main(args: string[]): number {
  const help = `usage: bun beat-music.ts <beat-table.json> <out.wav>

拍の表から BGM と効果音を合成して、48 kHz ステレオの WAV を書き出す（書き出すのは <out.wav> だけ）。
映像（HyperFrames の GSAP のタイムライン）と同じ拍番号で表を書くと、音と映像がずれない。

表の例（120 BPM・60 拍 = 30 秒）:
  {
    "bpm": 120, "beats": 60,
    "groove": [4, 58],                         キック・クラップ・ハイハット・ベースを鳴らす区間
    "halfTime": [26, 34],                      テンポを半分に感じさせる区間（任意）
    "chords": "Am F C G",                      4 拍ごとの和音（任意）
    "drops": [4, 18, 36, 52],                  一撃（場面の着地）
    "whooshes": [10, 26, 44],                  軽い切り替え
    "risers": [[14, 4], [34, 2], [50, 2]],     盛り上げ [開始拍, 長さ]
    "ticks": [18, 19, 20],                     短いクリック
    "typing": [{ "start": 0.6, "count": 6, "every": 0.2 }],  タイプ音
    "fadeFrom": 57                             この拍から絞る
  }`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  if (args.length !== 2) { console.error(help); return 2; }
  const table = JSON.parse(readFileSync(args[0], "utf8")) as BeatTable;
  if (!(table.bpm > 0) || !(table.beats > 0)) throw new Error("bpm と beats は正の数で書く");
  const { left, right, sampleRate } = synth(table);
  writeFileSync(args[1], wav(left, right, sampleRate));
  console.error(`${args[1]}: ${(left.length / sampleRate).toFixed(2)} 秒, ${sampleRate} Hz ステレオ`);
  console.log(args[1]);
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
