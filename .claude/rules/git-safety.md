# git の操作境界

取り消せない操作と、他人の目に触れる操作は、ユーザーの明示的な指示があるまで実行しない。手元で取り消せる操作（編集・テスト・ブランチ作成）は自由に進めてよい。

- 作業中の変更や履歴を失う操作: `git reset --hard`・`git checkout -- <file>`・`git restore`・`git clean -f`・`git stash drop` / `clear`・`git branch -D`・`git rebase --abort`・`git push --force`・公開済みコミットの amend
- 他人に見える操作: `git push`、`git commit`（「コミットして」と言われたときだけ）、PR や issue へのコメント、外部サービスへの投稿
- フックや検査に止められたら、`--no-verify`・見慣れないファイルの削除・`reset --hard` で近道をしない。原因を直すか、直せないならユーザーに状況を伝えて判断を仰ぐ（シークレット検知は `secret-safety`）
- このルールは文脈であって強制ではない。確実に止めたいリポジトリでは、Claude Code の `permissions.deny` か `PreToolUse` hook で塞ぐ（雛形は ai-rules の `templates/claude-settings.json`）
