/** content.json と music.json の形。check-content.ts が tsc で突き合わせる（場面の並びの中身は check-scenes.ts が確かめる） */

/** 共通の部品の姿勢。key は部品の名前（例: boxes）、値はその部品の位置・大きさ。key が無ければ、その時点でその部品は出ていない */
export type Pose = Record<string, Record<string, number | string | boolean> | undefined>;
/**
 * 場面の入り方。type は cut（最初の場面）・band（見出しを載せた帯。cover・leave・gone は場面の始まりからの拍）・
 * swap（帯なしで左上の見出しだけ替える。前の場面は out 秒で薄くなって消える）・fade（前の場面が out 秒で薄くなって消える）
 */
export type Entry = { type: string; cover?: number; leave?: number; gone?: number; out?: number };
/** 場面ごとの下限。shown は見えている秒、gaps は beats の配列の隣り合う拍の間（each はどの間も、avg は平均の秒） */
export type Limits = { shown?: number; gaps?: Record<string, { each?: number; avg?: number } | undefined> };
/** 場面。始まりは前の場面の length の合計（拍）。beats の値は場面の始まりからの拍で、中身は場面ごとに違う */
export type Scene = {
  id: string; file: string; length: number; entry: Entry;
  pose: { start: Pose; end: Pose };
  beats: Record<string, number | number[] | undefined>;
  limits?: Limits;
};

/** 作品の中身。scenes の下は題材ごとに書き換える */
export type Content = {
  scenes: Scene[];
  /** CSS の変数（--bg など）になる色 */
  theme: Record<string, string>;
  title: { text: string; sub: string };
  /** 場面の id ごとの見出し（帯と左上に出す文）。帯か swap で入る場面には要る */
  headings: Record<string, { text: string } | undefined>;
  items: { label: string; detail: string; color: string }[];
  ending: { lead: string; url: string };
};

/** 曲の測った値（beat-grid.py --music-json が書き出す形）。markers は拍で、名前は自由（strongestHit・ringOut など） */
export type Music = {
  file: string | null; title: string; source: string | null; sourceOffset: number | null;
  beatSeconds: number; beatsPerBar: number; duration: number;
  markers: Record<string, number | undefined>;
  note?: string;
};
