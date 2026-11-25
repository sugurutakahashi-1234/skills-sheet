// コミット規約: type は英語小文字・subject と body は日本語。
// 正本はルール集 ai-rules の rules/language-and-commits.md。
// .ts なのは UserConfig で縛るため。既知ルールの値の形（severity・condition・値の型）が
// エディタと tsc で落ちるので、commit しようとして初めて設定ミスに気づく事態を避けられる。
// なお rules は plugin 用に index signature を持つので、ルール名の綴り違いまでは検出されない。
// 型は import type だけで使う。設定の実行時に @commitlint/types を要求しないので、
// hoist されない依存構成でもフックが壊れない。
import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 全社標準の語彙（Conventional Commits 準拠 + improve）。
    // release-please がこの語彙に依存するリポジトリがあるため勝手に増減しない
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
        "improve",
      ],
    ],
    // 日本語の subject を通す
    "subject-case": [0],
    // 複数の領域にまたがる変更も 1 行で書けるように
    "header-max-length": [2, "always", 120],
    // 日本語の詳しい説明を折り返さずに書けるように
    "body-max-line-length": [0],
  },
};

export default config;
