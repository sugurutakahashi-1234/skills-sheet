# 言語とコミット

- 議論・作業の合間の一言・ツールの説明（Bash の description など）・生成するページの文言・コードコメント・ドキュメントは日本語で書く。読み手は途中の表示も読んで進み具合を追うため。識別子とコマンドはそのままでよい
- コミットメッセージは `type(scope): 日本語の subject`（scope は任意、body も日本語）。例: `improve(ci): bun のバージョン指定を latest 追随へ統一`
  - type は `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert` `improve` だけ。リリースの自動化がこの語彙に依存するので、増減しない
  - そのリポジトリの `commitlint.config.*` の `type-enum` が違うなら、そちらに従う
- commitlint を新しく入れるときは、ai-rules の `templates/commitlint.config.ts` を写す（日本語の subject を通す設定と、その理由が書いてある）
