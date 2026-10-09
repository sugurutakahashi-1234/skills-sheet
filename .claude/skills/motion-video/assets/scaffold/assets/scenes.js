// 場面の並び（content.json の scenes）から、各場面の時刻・出入り・帯・時計を決める共通の道具。index.html の head で読み込む。
// 作品ごとに書き換えるのは content.json と場面ファイルと parts.js で、このファイルは雛形のまま使う。
//
// - 時刻の計算（timeline）はブラウザでも Bun でも動く。check-scenes.ts・scene-windows.ts・sample.ts もこの関数を読むので、
//   検査と書き出しで同じ時刻になる
// - ブラウザでは content.json と music.json を同期で読み、window.B に道具を置く（場面ファイルは B を見て描く）
(function (root) {
  "use strict";

  // ── 時刻（ブラウザでも Bun でも動く） ──
  // 場面の始まり start は前の場面の長さ length の合計（拍）。場面の中の拍 beats は場面の始まりから数える。
  // 帯で入る場面は band に通しの拍 { in（場面の始まり）, cover, leave, gone } を持つ。
  // window はクリップの窓（通しの秒・1 ミリ秒に丸める）で、場面の始まりから、次の場面に入れ替わり終わる
  // （次が帯なら cover、swap・fade なら次の始まり + out）まで
  function timeline(content, music) {
    const bs = music.beatSeconds;
    const beat = (n) => n * bs;
    const ms = (v) => Math.round(v * 1000) / 1000;
    let acc = 0;
    const scenes = content.scenes.map((sc) => {
      const S = Object.assign({}, sc, { start: acc, end: acc + sc.length });
      acc += sc.length;
      return S;
    });
    scenes.forEach((S, i) => {
      S.index = i;
      S.prev = scenes[i - 1] || null;
      S.next = scenes[i + 1] || null;
      S.t0 = beat(S.start); // 始まりの通しの秒
      S.t1 = beat(S.end); // 終わりの通しの秒
      S.at = (b) => beat(S.start + b); // 場面の中の拍 b の通しの秒
      if (S.entry.type === "band") S.band = { in: S.start, cover: S.start + S.entry.cover, leave: S.start + S.entry.leave, gone: S.start + S.entry.gone };
    });
    scenes.forEach((S) => {
      const N = S.next;
      const until = !N ? music.duration : N.band ? beat(N.band.cover) : N.t0 + (N.entry.out || 0);
      const start = ms(S.t0);
      S.window = { start, duration: ms(Math.min(music.duration, until) - start) };
    });
    return { beat, scenes, scene: (id) => scenes.find((S) => S.id === id), totalBeats: acc };
  }

  if (typeof module === "object" && module && module.exports) module.exports = { timeline };
  if (typeof document === "undefined") return;

  // ── ブラウザ: JSON を読み、出入り・帯・時計を B に置く ──
  const loadJSON = (path) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path, false);
    xhr.send(null);
    return JSON.parse(xhr.responseText);
  };
  const MUSIC = loadJSON("music.json");
  const CONTENT = loadJSON("content.json");
  const T = timeline(CONTENT, MUSIC);
  // 色は content.json の theme を CSS の変数（--bg・--ink など）にして、場面ファイルの CSS から var() で使う
  for (const k in CONTENT.theme || {}) document.documentElement.style.setProperty(`--${k}`, CONTENT.theme[k]);

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const cache = {};
  const E = (name) => cache[name] || (cache[name] = gsap.parseEase(name));
  const vis = (el, v) => { el.style.visibility = v ? "" : "hidden"; };

  // 場面の切り替えの帯。見出しを載せた帯が左から入って画面を覆い、右へ抜ける。sp は通しの拍 { in, cover, leave, gone }。
  // 帯は傾いた平行四辺形で、前の縁（右端）が通り過ぎたところから次の場面に入れ替わる
  const BAND = { cy: 540, h: 280, w: 2600, slope: Math.tan((12 * Math.PI) / 180) };
  const BAND_FAR = BAND.w / 2 + 960 + BAND.slope * 560 + 60; // 帯が画面の外に出きる横のずれ
  const bandOff = (t, sp) => {
    if (t < T.beat(sp.leave)) return -BAND_FAR * (1 - E("power3.inOut")(prog(t, T.beat(sp.in), T.beat(sp.cover))));
    return BAND_FAR * E("power3.in")(prog(t, T.beat(sp.leave), T.beat(sp.gone)));
  };
  const bandLead = (t, sp, y) => 960 + bandOff(t, sp) + BAND.w / 2 - BAND.slope * (y - BAND.cy);
  // 帯の前の縁で場面を入れ替える clip-path。side は "out"（縁より右だけ残す）か "in"（縁より左だけ見せる）。null は「何も見せない」
  function wipeClip(t, sp, side) {
    const a = T.beat(sp.in), b = T.beat(sp.cover);
    if (t < a) return side === "out" ? "none" : null;
    if (t >= b) return side === "out" ? null : "none";
    const xt = bandLead(t, sp, -60), xb = bandLead(t, sp, 1140);
    return side === "out"
      ? `polygon(${xt.toFixed(1)}px -60px, 4000px -60px, 4000px 1140px, ${xb.toFixed(1)}px 1140px)`
      : `polygon(-4000px -60px, ${xt.toFixed(1)}px -60px, ${xb.toFixed(1)}px 1140px, -4000px 1140px)`;
  }
  function applyWipe(el, clip) {
    el.style.visibility = clip === null ? "hidden" : "";
    el.style.clipPath = clip === null || clip === "none" ? "none" : clip;
  }

  // 場面 S が時刻 t にどう見えるか。帯で入る場面は帯の前の縁より左から見え、次の場面が帯で入ると縁より右だけ残る。
  // 次の場面が見出しの入れ替え（swap）かフェード（fade）で入るときは、場面の終わりから次の entry.out 秒で薄くなって消える。
  // 戻り値は { on, clip（applyWipe に渡す）, out（消える進み 0〜1）, ended（場面の終わりを過ぎたか） }
  function presence(S, t) {
    if (t < S.t0) return { on: false, clip: null, out: 0, ended: false };
    let clip = S.band ? wipeClip(t, S.band, "in") : "none";
    let out = 0;
    const N = S.next, ended = !!N && t >= S.t1;
    if (ended) {
      if (N.band) clip = wipeClip(t, N.band, "out");
      else out = prog(t, S.t1, S.t1 + N.entry.out);
    }
    const on = clip !== null && out < 1;
    return { on, clip: on ? clip : null, out, ended };
  }
  // 次の場面が帯以外で入り、同じ部品（姿勢の key）を描き直すとき、終わった場面は自分の部品を消す（同じ物を 2 枚重ねると縁が濃くなる）
  const handsOff = (S, t, key) => !!S.next && t >= S.t1 && !S.next.band && !!S.next.pose.start[key];

  // 1 本の時計で描く（シークしても同じ絵になる）。who が場面ならクリップの窓（S.window）の長さで時計を作り、render には通しの秒を渡す。
  // 場面でない重ね（帯と見出し）は who に id を渡し、尺いっぱいの窓で動かす
  function clock(who, render) {
    const id = typeof who === "string" ? who : who.id;
    const w = typeof who === "string" ? { start: 0, duration: MUSIC.duration } : who.window;
    const tl = gsap.timeline({ paused: true });
    const c = { t: 0 };
    tl.to(c, { t: w.duration, duration: w.duration, ease: "none", onUpdate: () => render(w.start + c.t) }, 0);
    render(w.start);
    window.__timelines[id] = tl;
    return tl;
  }

  root.B = Object.assign(root.B || {}, {
    MUSIC, CONTENT, beat: T.beat, SCENES: T.scenes, scene: T.scene,
    BAND, bandOff, wipeClip, applyWipe, presence, handsOff, clock, clamp, prog, E, vis,
  });
})(typeof window !== "undefined" ? window : globalThis);
