---
root: true
targets: ["*"]
description: "スキルシートリポジトリの前提"
---

# スキルシート

- `README.md` が正本。PDF（`*_高橋俊スキルシート.pdf`）は pre-commit フックが README の変更時に自動生成する。PDF を手で編集しない
- README の本文を変えたら pre-commit の textlint（`@textlint-ja/preset-ai-writing`）を通す。誇張表現や中身のない強調は指摘に従って直す
- 「太字 + コロン + 箇条書き」の様式はスキルシートとして意図したもの。textlint の該当検査（list-formatting / emphasis-patterns）と、「適切な」のような一般語まで指摘する tech-writing-guideline は `.textlintrc.json` で無効化してあり、文章らしく書き直す対象ではない
- 実績は役割・規模・数値で書く。「一気通貫」「単独で」のような同じ強調語を繰り返さない
- 自分の判断で言い回しを変えるとき（見出し・項目名の言い換え、3 行以上をまとめた修正、節の構成や並びの変更）は、適用前に現状と提案を並べた HTML を出して承認を得る。作り方は `design-compare` スキルに従う（現状を最初に置き、差分を色で示し、実際の描画幅で並べる）。ユーザーが具体的に指示した変更・誤字や記法の修正・1 行に収めるための幅の調整は、そのまま適用してよい
- 製品名・サービス名は略さない（`Firebase Authentication` を `Firebase Auth` にしない）。1 行に収めるために名前を削るのではなく、他の語を削るか、その行は複数行を許容する
- 一覧の箇条書きは 1 行に収める。`bun run check:width` が実際の描画幅で計測し、数文字はみ出しているだけの行を報告する（既定の本文幅 730px は GitHub 表示の実測値）。報告された行は語を削って 1 行にする。段落として複数行になる行は対象外
- `CLAUDE.md` / `AGENTS.md` / `.claude/skills` / `.agents/skills` は `.rulesync/` からの生成物。編集するのは `.rulesync/` と `rulesync.jsonc`
- `git add` / `git commit` / `git push`（`main` への直接 push を含む）は確認を取らずに実行してよい。コミットの分け方や粒度の判断も任せる。このリポジトリでは、グローバル設定と `git-safety` の「明示的な指示があるまで実行しない」よりこの行を優先する
- ただし `git push --force` / `git reset --hard` / `git branch -D` など `git-safety` が挙げる破壊的操作は対象外で、従来どおり指示を待つ
