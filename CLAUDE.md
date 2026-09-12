# スキルシート

- `README.md` が正本。PDF（`*_高橋俊スキルシート.pdf`）は pre-commit フックが README の変更時に自動生成する。PDF を手で編集しない
- **README は 1 ファイルに保つ。案件ごとの分割はしない**。表記の不統一や案件間の形式のずれは全文を通して読んで初めて見つかる（「基点 / 起点」の混在、No.11 だけ節の形式が違う、`Mise` と `mise` の不統一はいずれも横断比較で見つけた）。案件が 20 件に増えても 2 万トークン程度で、必要な節だけ読むのは `grep` と `<details>` の区切りで足りる
- 案件詳細は `## 案件詳細` の下で 1 案件ずつ `<details>` に包む。GitHub で README を開いたときに 600 行超が展開されたまま並ぶのを避けるため。`<summary>` は `[No.N] 案件名（客先） — 役割 / 技術`（職務経歴の一覧行と同じ情報）、その中に `### [No.N] 案件名（客先）` の見出しを残す。見出しを残すのは GitHub の目次（Outline）に案件を出すため。`<details>` と `<summary>` の間、`</details>` の前には空行を入れる（無いと中の Markdown が解釈されない）
- 折りたたみを展開した Markdown は `scripts/expand-details.ts` が作る。PDF 生成（`<details>` のままだと Chromium が閉じた状態で描画して中身が消える）と、Web 版の「Markdown をコピー」（コピー先に HTML タグを持ち込まない）の両方がこれを通す
- Web 版（https://sugurutakahashi-1234.github.io/skills-sheet/）は `scripts/build-site.ts` が README から `dist/` に生成し、`.github/workflows/pages.yml` が `main` への push で GitHub Pages に配信する。`dist/` はコミットしない。手元で確認するときは `bun run build:site` して `dist/index.html` を開く
- README の本文を変えたら pre-commit の textlint（`@textlint-ja/preset-ai-writing`）を通す。誇張表現や中身のない強調は指摘に従って直す
- 「太字 + コロン + 箇条書き」の様式はスキルシートとして意図したもの。textlint の該当検査（list-formatting / emphasis-patterns）と、「適切な」のような一般語まで指摘する tech-writing-guideline は `.textlintrc.json` で無効化してあり、文章らしく書き直す対象ではない
- 実績は役割・規模・数値で書く。「一気通貫」「単独で」のような同じ強調語を繰り返さない
- 「ここを直しませんか」と提案するときは、行数や規模にかかわらず必ず適用前に HTML を出して承認を得る。現状と提案を並べ、その行がどの節・どの項目にあるか（前後の兄弟行）も一緒に見せる。作り方は `design-compare` スキルに従う（現状を最初に置き、差分を色で示し、実際の描画幅で並べる）。ユーザーが具体的に指示した変更・誤字や記法の修正・1 行に収めるための幅の調整は、そのまま適用してよい
- 製品名・サービス名は略さない（`Firebase Authentication` を `Firebase Auth` にしない）。1 行に収めるために名前を削るのではなく、他の語を削るか、その行は複数行を許容する
- 一覧の箇条書きは 1 行に収める。`bun run check:width` が実際の描画幅で計測し、数文字はみ出しているだけの行を報告する（既定の本文幅 730px は GitHub 表示の実測値）。報告された行は語を削って 1 行にする。段落として複数行になる行は対象外
- README に書く前の候補は `bun run check:width --text "候補" --text "別の候補"` で測る。一時ファイルを作らない。深さは `--depth`（既定 2 = `  - ` の説明行、1 = `- ` の項目行）
- 案を出す段階では毎回測らず、文字数で足切りする。使える幅は深さ 2 が 666px・深さ 1 が 698px で、文字幅は全角 16px・半角英数 8.7px・半角スペース 2.8px（42 行の実測から算出、平均誤差 3.9px）。全角だけなら 41 文字が上限。半角英数は全角の 0.55 倍あり「2 文字で全角 1 文字」と丸めると溢れを見逃すので、英数が多い行は測る。確定した案は適用後に `bun run check:width` で確認する
- `CLAUDE.md` / `AGENTS.md` / `.claude/skills` / `.agents/skills` は `.rulesync/` からの生成物。編集するのは `.rulesync/` と `rulesync.jsonc`
- `git add` / `git commit` / `git push`（`main` への直接 push を含む）は確認を取らずに実行してよい。コミットの分け方や粒度の判断も任せる。このリポジトリでは、グローバル設定と `git-safety` の「明示的な指示があるまで実行しない」よりこの行を優先する
- ただし `git push --force` / `git reset --hard` / `git branch -D` など `git-safety` が挙げる破壊的操作は対象外で、従来どおり指示を待つ
