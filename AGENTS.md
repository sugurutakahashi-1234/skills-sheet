# スキルシート

- `README.md` が正本。PDF（`*_高橋俊スキルシート.pdf`）は pre-commit フックが README の変更時に自動生成する。PDF を手で編集しない
- README の本文を変えたら pre-commit の textlint（`@textlint-ja/preset-ai-writing`）を通す。誇張表現や中身のない強調は指摘に従って直す
- 「太字 + コロン + 箇条書き」の様式はスキルシートとして意図したもの。textlint の該当検査（list-formatting / emphasis-patterns）と、「適切な」のような一般語まで指摘する tech-writing-guideline は `.textlintrc.json` で無効化してあり、文章らしく書き直す対象ではない
- 実績は役割・規模・数値で書く。「一気通貫」「単独で」のような同じ強調語を繰り返さない
- 「ここを直しませんか」と提案するときは、行数や規模にかかわらず必ず適用前に HTML を出して承認を得る。現状と提案を並べ、その行がどの節・どの項目にあるか（前後の兄弟行）も一緒に見せる。作り方は `design-compare` スキルに従う（現状を最初に置き、差分を色で示し、実際の描画幅で並べる）。ユーザーが具体的に指示した変更・誤字や記法の修正・1 行に収めるための幅の調整は、そのまま適用してよい
- 製品名・サービス名は略さない（`Firebase Authentication` を `Firebase Auth` にしない）。1 行に収めるために名前を削るのではなく、他の語を削るか、その行は複数行を許容する
- 一覧の箇条書きは 1 行に収める。`bun run check:width` が実際の描画幅で計測し、数文字はみ出しているだけの行を報告する（既定の本文幅 730px は GitHub 表示の実測値）。報告された行は語を削って 1 行にする。段落として複数行になる行は対象外
- `CLAUDE.md` / `AGENTS.md` / `.claude/skills` / `.agents/skills` は `.rulesync/` からの生成物。編集するのは `.rulesync/` と `rulesync.jsonc`
- `git add` / `git commit` / `git push`（`main` への直接 push を含む）は確認を取らずに実行してよい。コミットの分け方や粒度の判断も任せる。このリポジトリでは、グローバル設定と `git-safety` の「明示的な指示があるまで実行しない」よりこの行を優先する
- ただし `git push --force` / `git reset --hard` / `git branch -D` など `git-safety` が挙げる破壊的操作は対象外で、従来どおり指示を待つ

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

# 日本語の文体

Markdown の文章（README・設計メモ・議事録・レポート・記事）を書く、または推敲するときの規範。コードコメントやコミットメッセージには適用しない。

## 構成

- 結論を先に書く。「本章では〜を扱う」「重要なのは〜である」のような予告や総括を置かず、主張をそのまま書く
- 見出しは、その節が答える問いか扱う対象を指す句にする。手順名や決め台詞にしない
- 箇条書きは本当に並列な項目だけに使う。説明や論証は段落で書く
- 同じ文型・同じ文末を 3 回続けない。「また」「さらに」「加えて」を接続の代わりに連打しない
- 因果を書くときは、なぜそうなるかの機構を一文添える。「A だと B になる」だけで済ませない

## 語彙

- 中身のない形容・動詞を使わない: 「不可欠」「鍵となる」「根本的な」「多角的」「包括的」「掘り下げる」「深掘りする」「言語化する」「非常に」「極めて」
- 「〜することが重要です」「〜と言えるでしょう」「いかがでしょうか」「〜において」「〜の観点から」は、情報を足していなければ削る
- 「A ではなく B」の対句は、本当に誤解を正すときだけ使う。演出として多用しない
- 太字は一節に一、二箇所まで。太字とコロンを機械的に組み合わせた「**項目**: 説明」の羅列を段落の代わりにしない
- 固有名詞・数値・具体例で接地する。「多くの場合」「さまざまな」でぼかさない

## 翻訳調

- 無生物主語で擬人化しない。「モデルは知っている」「データが語る」ではなく、人か処理を主体に戻すか「〜から分かる」「〜に含まれる」と書く
- 英語慣用句の直訳比喩を使わない。「運ぶ」「開かれた問い」「露出する」「住んでいる」は、字義どおりの動作に読めるなら言い直す
- 話し言葉の評価語（「効く」「刺さる」「筋がいい」）は、効果の内容を具体的に書き直す

## 断定と不確実性

- 本文の根拠で確定していることは言い切る。根拠なく「かもしれない」「だろう」で弱めない
- 未確認の可能性・推定・読者の疑念を表す「かもしれない」は残す。機械的に断定へ変えない
- 確認していないことを、確認したかのように滑らかに書かない

## 機械検査

- textlint の `@textlint-ja/preset-ai-writing` を pre-commit で回す（設定テンプレート: sugurutakahashi-1234/ai-rules の `templates/.textlintrc.json`）。誇張表現・太字とコロンの機械的な組み合わせ・箇条書きの機械的パターンを検出する
- 議事録・レポート・記事のように長い文書を設計から書くときは、外部スキル natural-japanese（coji/natural-japanese）を rulesync の sources で取り込んで使う

# 言語とコミット

- 議論・コードコメント・ドキュメントは**日本語**で書く。
- コミットメッセージは **type が英語小文字・subject と body は日本語**。
  - 形式: `type(scope): 日本語の subject`（scope は任意）
  - 許容 type は標準語彙 `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert` / `improve`（Conventional Commits 準拠 + improve。sugurutakahashi-1234/ai-rules の `templates/commitlint.config.mjs` が正）。release-please 等のリリース自動化がこの語彙に依存するため勝手に増減しない
  - そのリポジトリの commitlint 設定（`commitlint.config.*` の `type-enum`）が標準と異なる場合はリポジトリ側の設定に従う
  - 例: `improve(ci): bun のバージョン指定を latest 追随へ統一`

## commitlint の前提

日本語 subject を書けるようにするため、既定から以下を変更している。新規リポジトリでも同じ設定を使う（テンプレート: sugurutakahashi-1234/ai-rules の `templates/commitlint.config.mjs`）。

- `subject-case` は無効（日本語 subject を許容）
- `header-max-length` は 120（複数領域にまたがる変更でも 1 行で説明できるように）
- `body-max-line-length` は無効（日本語の詳細説明を折り返さずに書けるように）
