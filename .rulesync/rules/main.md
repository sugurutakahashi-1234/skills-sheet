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
- `CLAUDE.md` / `AGENTS.md` / `.claude/skills` / `.agents/skills` は `.rulesync/` からの生成物。編集するのは `.rulesync/` と `rulesync.jsonc`
- `git add` / `git commit` / `git push`（`main` への直接 push を含む）は確認を取らずに実行してよい。コミットの分け方や粒度の判断も任せる。このリポジトリでは、グローバル設定と `git-safety` の「明示的な指示があるまで実行しない」よりこの行を優先する
- ただし `git push --force` / `git reset --hard` / `git branch -D` など `git-safety` が挙げる破壊的操作は対象外で、従来どおり指示を待つ
