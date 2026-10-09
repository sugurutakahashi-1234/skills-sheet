"""選んだ曲の拍を測り、作り手に渡す拍の表を JSON で出す。

1 拍の長さは librosa の beat_track の tempo を使わず、拍の位置に直線を当てはめて出す。
tempo は解析の刻み幅（hop）に丸められ、約 121 BPM の曲が 123 BPM と出た（35 秒で約 0.6 秒ずれる）。
hop を 128 にして当てはめると、ずれは 10 ミリ秒以内に収まった。

使い方（librosa は一時的な環境で取る）:
  uv run --with librosa --with numpy python -I beat-grid.py <曲のファイル> [--bpm-hint 120] [--fit-until 秒]
      [--music-json <作品の music.json> [--duration 秒] [--beats-per-bar 4] [--title 名前] [--source URL] [--offset 秒]]

標準出力に JSON を 1 つ出す:
  bpm・period（1 拍の秒）・first_beat（最初の拍の秒）・beat_formula（拍 n の時刻の式）・max_resid_ms（当てはめのずれ）・
  strong（強い立ち上がりの秒と強さ、強い順に 10 個）・sound_until（鳴り終わる秒）

--music-json を付けたときだけ、測った結果を作品の music.json の形（雛形 assets/scaffold/music.json）で書き出す:
  file（曲のファイル。music.json からの相対パス）・beatSeconds（1 拍の秒）・beatsPerBar・duration（--duration か曲の長さ）・
  markers（拍 n で。strongestHit は 1 秒より後で一番強い立ち上がり、ringOut は鳴り終わり。終わりの部分などは聴いて書き足す）・title・source・sourceOffset。
  雛形は拍 n の時刻を n × beatSeconds とするので、最初の拍が 0 秒から 20 ミリ秒以上ずれていたら、曲を小節の頭で切り直すよう標準エラーに出す
"""
import argparse
import json
import os
import sys


def main() -> int:
    p = argparse.ArgumentParser(description="曲の拍を直線の当てはめで測り、拍の表を JSON で出す")
    p.add_argument("audio", help="曲のファイル（wav・mp3 など）")
    p.add_argument("--bpm-hint", type=float, default=120.0, help="おおよその BPM（拍の検出の初期値）")
    p.add_argument("--fit-until", type=float, default=None, help="この秒より前の拍だけで当てはめる（終わりの部分で拍が崩れる曲向け）")
    p.add_argument("--music-json", default=None, help="測った結果を作品の music.json の形でこのパスに書き出す（付けたときだけ書く）")
    p.add_argument("--duration", type=float, default=None, help="music.json の duration（動画の尺の秒。省くと曲の長さ）")
    p.add_argument("--beats-per-bar", type=int, default=4, help="music.json の beatsPerBar（1 小節の拍）")
    p.add_argument("--title", default=None, help="music.json の title（曲名と出どころ）")
    p.add_argument("--source", default=None, help="music.json の source（原曲の URL）")
    p.add_argument("--offset", type=float, default=None, help="music.json の sourceOffset（原曲から切り出した秒）")
    a = p.parse_args()
    try:
        import librosa
        import numpy as np
    except ImportError:
        print("librosa と numpy が要る: uv run --with librosa --with numpy python -I beat-grid.py <曲>", file=sys.stderr)
        return 1
    y, sr = librosa.load(a.audio, sr=22050, mono=True)
    hop = 128
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    _, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, start_bpm=a.bpm_hint, tightness=300)
    times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    if a.fit_until:
        times = times[times < a.fit_until]
    if len(times) < 8:
        print("拍が 8 つ以上見つからない。--bpm-hint を変えるか、拍のはっきりした区間を指定する", file=sys.stderr)
        return 1
    step = float(np.median(np.diff(times)))
    n = np.round((times - times[0]) / step).astype(int)
    period, t0 = np.linalg.lstsq(np.vstack([n, np.ones_like(n)]).T, times, rcond=None)[0]
    first = float(t0 - np.floor(t0 / period) * period)
    if first > period / 2:  # 0 秒の直前に拍があるときは、負の小さな値で返す（拍 0 が曲の頭）
        first -= float(period)
    resid = times - (t0 + n * period)
    peaks = librosa.onset.onset_detect(onset_envelope=onset, sr=sr, hop_length=hop, units="frames")
    top = sorted(((float(onset[f] / onset.max()), float(librosa.frames_to_time(f, sr=sr, hop_length=hop))) for f in peaks), reverse=True)[:10]
    rms = librosa.feature.rms(y=y)[0]
    loud = np.where(rms > rms.max() * 0.05)[0]
    sound_until = float(librosa.frames_to_time(loud[-1], sr=sr)) if len(loud) else 0.0
    if a.music_json:
        if abs(first) > 0.02:
            print(f"最初の拍が {first:.3f} 秒にある。雛形は拍 n の時刻を n × beatSeconds とするので、曲を小節の頭で切り直してから測る", file=sys.stderr)
        late = [x for x in top if x[1] >= 1.0]  # 切り出しの頭の立ち上がり（曲の途中で切った音の始まり）は一撃に数えない
        strongest = max(late, key=lambda x: x[0])[1] if late else None
        music = {
            "file": os.path.relpath(os.path.abspath(a.audio), os.path.dirname(os.path.abspath(a.music_json))),
            "title": a.title or os.path.basename(a.audio),
            "source": a.source,
            "sourceOffset": a.offset,
            "beatSeconds": round(float(period), 5),
            "beatsPerBar": a.beats_per_bar,
            "duration": a.duration if a.duration is not None else round(float(len(y) / sr), 2),
            "markers": {k: v for k, v in {
                "strongestHit": round(strongest / period, 2) if strongest is not None else None,
                "ringOut": round(sound_until / period, 2),
            }.items() if v is not None},
            "note": f"beat-grid.py で測った値（当てはめのずれ {float(np.abs(resid).max() * 1000):.1f} ミリ秒）。拍 n の時刻 = n × beatSeconds",
        }
        os.makedirs(os.path.dirname(os.path.abspath(a.music_json)), exist_ok=True)
        with open(a.music_json, "w", encoding="utf-8") as f:
            f.write(json.dumps(music, ensure_ascii=False, indent=2) + "\n")
        print(f"{a.music_json} に書いた", file=sys.stderr)
    print(json.dumps({
        "bpm": round(60 / period, 3),
        "period": round(float(period), 5),
        "first_beat": round(first, 4),
        "beat_formula": f"拍 n の時刻 = {first:.4f} + n × {period:.5f} 秒",
        "max_resid_ms": round(float(np.abs(resid).max() * 1000), 1),
        "strong": [{"t": round(t, 2), "strength": round(s, 2)} for s, t in sorted(top, key=lambda x: x[1])],
        "sound_until": round(sound_until, 2),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
