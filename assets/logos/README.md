# 技術のロゴ

スキルシートに載っている技術・アカウントのロゴ。動画（`.tmp/videos/`）やスライドなど、スキルシートから作るものに使う。技術名ごとに 1 ファイルで、`logos.json` に表示名・分野・出どころをまとめてある。

- 出どころ: 各社の公式のカラーロゴを集めた [SVG Logos（gilbarbara/logos）](https://github.com/gilbarbara/logos)（CC0-1.0、Iconify の `logos`）を第一にする。そこに無いものは [theSVG](https://github.com/glincker/thesvg)（MIT、Iconify の `thesvg-color`）、BigQuery は [Google Cloud Icons](https://cloud.google.com/icons)（Apache-2.0、Iconify の `gcp`）、SQLite は [devicon](https://devicon.dev/)（MIT）。どこにも公式のカラー版が無いものだけ [simple-icons](https://simpleicons.org/)（CC0-1.0、1 色の図案をブランドの色で塗ったもの）を使う。1 色の図案は公式の形と違って見えるので、カラー版があれば差し替える
- 素材のライセンスは上のとおりだが、ロゴそのものは各社の商標。技術を使った経験を示す目的で使い、提携や推薦を示すような使い方はしない
- ロゴの無い技術は、近いもので代える（SwiftUI・UIKit は Swift、Riverpod は Flutter、Codex は Codex のロゴ、ChatGPT は OpenAI のロゴ、Looker Studio は Looker のロゴ）。概念（LLM・RAG など）にはロゴを付けない
- 足すときは README の技術スタックにある名前だけにする
- simple-icons の 1 色の図案で白に近いブランドの色のもの（Drizzle）は、明るい地で見えないので墨色（`#111318`）で塗ってある
- Drizzle は SVG Logos の `drizzle-icon` が別の製品（Drizzle ORM ではない）なので、simple-icons のままにしている

| 分野 | 名前 | ファイル | 出どころ |
|---|---|---|---|
| AI | Claude Code | `claude-code.svg` | SVG Logos `claude-code` |
| AI | Claude | `claude.svg` | SVG Logos `claude-icon` |
| AI | Anthropic | `anthropic.svg` | simple-icons `anthropic` |
| AI | Codex | `codex.svg` | SVG Logos `codex` |
| AI | OpenAI / ChatGPT | `openai.svg` | SVG Logos `openai-icon` |
| AI | Antigravity | `antigravity.svg` | SVG Logos `antigravity` |
| AI | Gemini | `gemini.svg` | SVG Logos `google-gemini-icon` |
| AI | Kimi | `kimi.svg` | theSVG `kimi` |
| AI | DeepSeek | `deepseek.svg` | SVG Logos `deepseek-icon` |
| AI | MCP | `mcp.svg` | SVG Logos `model-context-protocol-icon` |
| AI | v0 | `v0.svg` | SVG Logos `v0` |
| インフラ | Cloudflare | `cloudflare.svg` | SVG Logos `cloudflare-icon` |
| インフラ | Cloudflare Workers | `cloudflare-workers.svg` | SVG Logos `cloudflare-workers-icon` |
| インフラ | Cloudflare Pages | `cloudflare-pages.svg` | simple-icons `cloudflarepages` |
| インフラ | Google Cloud | `google-cloud.svg` | SVG Logos `google-cloud` |
| インフラ | AWS | `aws.svg` | SVG Logos `aws` |
| インフラ | Firebase | `firebase.svg` | SVG Logos `firebase-icon` |
| インフラ | Terraform | `terraform.svg` | SVG Logos `terraform-icon` |
| CI/CD | GitHub Actions | `github-actions.svg` | SVG Logos `github-actions` |
| CI/CD | Xcode Cloud | `xcode-cloud.svg` | SVG Logos `xcode` |
| CI/CD | Bitrise | `bitrise.svg` | SVG Logos `bitrise-icon` |
| CI/CD | CircleCI | `circleci.svg` | SVG Logos `circleci` |
| CI/CD | Codemagic | `codemagic.svg` | theSVG `codemagic` |
| CI/CD | Fastlane | `fastlane.svg` | SVG Logos `fastlane` |
| CI/CD | Renovate | `renovate.svg` | SVG Logos `renovatebot` |
| Web・モバイル | React / React Native | `react.svg` | SVG Logos `react` |
| Web | Next.js | `nextjs.svg` | SVG Logos `nextjs-icon` |
| Web | Astro | `astro.svg` | SVG Logos `astro-icon` |
| Web | TanStack | `tanstack.svg` | theSVG `tanstack` |
| Web | Tailwind CSS | `tailwindcss.svg` | SVG Logos `tailwindcss-icon` |
| Web | shadcn/ui | `shadcn-ui.svg` | theSVG `shadcn-ui-light` |
| モバイル | Swift（SwiftUI・UIKit にも使う） | `swift.svg` | SVG Logos `swift` |
| モバイル | Flutter（Riverpod にも使う） | `flutter.svg` | SVG Logos `flutter-icon` |
| モバイル | Dart | `dart.svg` | SVG Logos `dart` |
| モバイル | Expo | `expo.svg` | SVG Logos `expo-icon` |
| サーバー | TypeScript | `typescript.svg` | SVG Logos `typescript-icon` |
| サーバー | Bun | `bun.svg` | SVG Logos `bun` |
| サーバー | Node.js | `nodejs.svg` | SVG Logos `nodejs-icon` |
| サーバー | Hono | `hono.svg` | SVG Logos `hono` |
| サーバー | Drizzle | `drizzle.svg` | simple-icons `drizzle` |
| サーバー | Prisma | `prisma.svg` | SVG Logos `prisma` |
| サーバー | PostgreSQL | `postgresql.svg` | SVG Logos `postgresql` |
| サーバー | MySQL | `mysql.svg` | SVG Logos `mysql-icon` |
| サーバー | SQLite | `sqlite.svg` | devicon `sqlite-original` |
| サーバー | Python | `python.svg` | SVG Logos `python` |
| サーバー | Zod | `zod.svg` | SVG Logos `zod` |
| サーバー | Better Auth | `better-auth.svg` | theSVG `better-auth-light` |
| サーバー | GraphQL | `graphql.svg` | SVG Logos `graphql` |
| 分析 | PostHog | `posthog.svg` | SVG Logos `posthog-icon` |
| サーバー | PHP | `php.svg` | simple-icons `php` |
| サーバー | Java | `java.svg` | simple-icons `openjdk` |
| 品質 | Vitest | `vitest.svg` | SVG Logos `vitest` |
| 品質 | Playwright | `playwright.svg` | SVG Logos `playwright` |
| 品質 | Storybook | `storybook.svg` | SVG Logos `storybook-icon` |
| モバイル | Redux | `redux.svg` | SVG Logos `redux` |
| サーバー | LINE | `line.svg` | theSVG `line` |
| サーバー | Slack | `slack.svg` | SVG Logos `slack-icon` |
| 発信 | npm | `npm.svg` | SVG Logos `npm-icon` |
| 発信 | Homebrew | `homebrew.svg` | simple-icons `homebrew` |
| 発信 | Speaker Deck | `speakerdeck.svg` | simple-icons `speakerdeck` |
| 分析 | BigQuery | `bigquery.svg` | Google Cloud Icons `bigquery` |
| 分析 | Looker Studio（Looker のロゴで代える） | `looker-studio.svg` | SVG Logos `looker-icon` |
| アカウント | GitHub | `github.svg` | SVG Logos `github-icon` |
| アカウント | X | `x.svg` | simple-icons `x` |
| アカウント | Zenn | `zenn.svg` | theSVG `zenn` |
| アカウント | Qiita | `qiita.svg` | theSVG `qiita` |
