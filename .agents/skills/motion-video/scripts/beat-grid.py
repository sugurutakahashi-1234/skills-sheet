"""選んだ曲の拍を測り、作り手に渡す拍の表を JSON で出す。

1 拍の長さは librosa の beat_track の tempo を使わず、拍の位置に直線を当てはめて出す。
tempo は解析の刻み幅（hop）に丸められ、約 121 BPM の曲が 123 BPM と出た（35 秒で約 0.6 秒ずれる）。
hop を 128 にして当てはめると、ずれは 10 ミリ秒以内に収まった。

使い方（librosa は一時的な環境で取る）:
  uv run --with librosa --with numpy python -I beat-grid.py <曲のファイル> [--bpm-hint 120] [--fit-until 秒]

標準出力に JSON を 1 つ出す:
  bpm・period（1 拍の秒）・first_beat（最初の拍の秒）・beat_formula（拍 n の時刻の式）・max_resid_ms（当てはめのずれ）・
  strong（強い立ち上がりの秒と強さ、強い順に 10 個）・sound_until（鳴り終わる秒）
"""
import argparse
import json
import sys


def main() -> int:
    p = argparse.ArgumentParser(description="曲の拍を直線の当てはめで測り、拍の表を JSON で出す")
    p.add_argument("audio", help="曲のファイル（wav・mp3 など）")
    p.add_argument("--bpm-hint", type=float, default=120.0, help="おおよその BPM（拍の検出の初期値）")
    p.add_argument("--fit-until", type=float, default=None, help="この秒より前の拍だけで当てはめる（終わりの部分で拍が崩れる曲向け）")
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
