# /// script
# requires-python = ">=3.11"
# dependencies = ["pypdf"]
# ///
"""生成したスキルシート PDF の内容を検証する。

使い方: uv run scripts/verify-pdf.py <PDF パス>

- 折りたたみの中身にしか出てこない見出しが含まれるか（展開漏れ検知）
- Web 向けの文言（プルダウン）が混入していないか
- ページ数が妥当か

PDF のフォント抽出は一部の漢字を康熙部首（例: 工 → ⼯）で返すため、
NFKC 正規化と空白除去をしてから文字列一致で判定する。
"""

import re
import sys
import unicodedata

from pypdf import PdfReader

path = sys.argv[1]
reader = PdfReader(path)
text = "\n".join(page.extract_text() or "" for page in reader.pages)
normalized = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))

errors: list[str] = []

if len(reader.pages) < 10:
    errors.append(f"ページ数が少なすぎます ({len(reader.pages)} ページ)。展開失敗の可能性")

for keyword in ["チーム体制", "案件概要", "経験した技術", "取り組み・貢献"]:
    if keyword not in normalized:
        errors.append(f"'{keyword}' が見つかりません。展開漏れの可能性")

if "プルダウン" in normalized:
    errors.append("Web 向け文言「プルダウン」が PDF に残っています")

if errors:
    for e in errors:
        print(f"NG: {e}")
    sys.exit(1)

print(f"OK: {path} ({len(reader.pages)} ページ) の検証に成功")
