---
root: false
targets: ["*"]
description: "言語の使い分けとコミットメッセージ規約"
---

# 言語とコミット

- 議論・コードコメント・ドキュメントは日本語で書く。
- コミットメッセージは type が英語小文字・subject と body は日本語。
  - 形式: `type(scope): 日本語の subject`（scope は任意）
  - 許容 type は標準語彙 `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert` / `improve`（Conventional Commits 準拠 + improve。sugurutakahashi-1234/ai-rules の `templates/commitlint.config.ts` が正）。release-please 等のリリース自動化がこの語彙に依存するため勝手に増減しない
  - そのリポジトリの commitlint 設定（`commitlint.config.*` の `type-enum`）が標準と異なる場合はリポジトリ側の設定に従う
  - 例: `improve(ci): bun のバージョン指定を latest 追随へ統一`

## commitlint の前提

日本語 subject を書けるようにするため、既定から以下を変更している。新規リポジトリでも同じ設定を使う（テンプレート: sugurutakahashi-1234/ai-rules の `templates/commitlint.config.ts`）。

- `subject-case` は無効（日本語 subject を許容）
- `header-max-length` は 120（複数領域にまたがる変更でも 1 行で説明できるように）
- `body-max-line-length` は無効（日本語の詳細説明を折り返さずに書けるように）

設定ファイルは `commitlint.config.ts` に揃える。`@commitlint/types` の `UserConfig` で縛ると、既知ルールの値の形（severity・condition・値の型）が commit 時ではなくエディタと tsc で落ちるため。型は `import type` だけで使い、設定の実行時に `@commitlint/types` を要求しない（hoist されない依存構成でもフックが壊れないように）。
