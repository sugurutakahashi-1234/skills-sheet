# git の破壊的操作

以下は**ユーザーの明示的な指示なしに実行しない**。いずれも取り返しがつかない、または復旧に手間がかかる。

- `git stash drop` / `git stash clear`
- `git branch -D`
- `git reset --hard`
- `git checkout -- <file>`（未コミットの変更が消える）
- `git clean -f`
- `git rebase --abort`
- `git push --force`

`git add` / `git commit` / `git push` も、ユーザーから明示的に指示があるまで実行しない。
