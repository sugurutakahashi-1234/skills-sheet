---
root: false
targets: ["*"]
description: "破壊的・外向きの git 操作の境界（指示で引く線と、設定で塞ぐ線）"
---

# git の操作境界

線を引く基準は「取り消せるか」と「他人に見えるか」の 2 つ。手元で取り消せる操作（ファイル編集・テスト実行・ブランチ作成）は自由に進めてよい。取り消せない操作と、他人の目に触れる操作は、ユーザーの明示的な指示があるまで実行しない。

## 明示的な指示があるまで実行しない

未コミットの変更や履歴を失う操作:

- `git reset --hard` / `git checkout -- <file>` / `git restore` で作業中の変更を捨てる
- `git clean -f`
- `git stash drop` / `git stash clear`
- `git branch -D`
- `git rebase --abort`（進行中の rebase の途中結果が消える）
- `git push --force` と、公開済みコミットの amend

他人に見える操作:

- `git push`
- `git commit`（履歴に残り、push の一歩手前になる。「コミットして」と言われたときだけ行う）
- PR・issue へのコメント、外部サービスへの投稿

## 障害の近道に破壊的操作を使わない

フックや検査に止められたとき、`--no-verify` で飛ばす・見慣れないファイルを消す・`reset --hard` で状態を作り直す、といった近道を取らない。止まった原因を直すか、直せないならユーザーに状況を伝えて判断を仰ぐ。シークレット検知で止まったときの手順は `secret-safety` ルールにある。

## 確実に止めたいなら設定で塞ぐ

このルールはモデルへの文脈であって、強制ではない。上の操作を確実に止めたいリポジトリでは、Claude Code の `permissions.deny`（`Bash(git push --force *)` のようなコマンド前置パターン）か `PreToolUse` hook で塞ぐ。deny はどの permission mode でも効き、hook は `--dangerously-skip-permissions` でも効く。雛形は sugurutakahashi-1234/ai-rules の `templates/claude-settings.json`。
