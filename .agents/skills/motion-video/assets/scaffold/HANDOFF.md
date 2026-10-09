# （作品の名前）の引き継ぎ

<!-- 次の作り手がこの 1 枚で続きを直せるように書く（200 行以内）。各節の 1 行は何を書くかの説明なので、書いたら消す。
     作り（ファイルの分け方・データの形）が変わったときに書き直し、見た目の直しのたびには書き直さない -->

尺・縦横・fps・使っている道具（HyperFrames）と、最新の書き出しのパス・版の控えの場所を 2〜3 行で。

## 何を伝える動画か

見た人に何をつかんで、どこへ行ってほしいか。題材（事実の出どころ）と、題材に無い事実は足さないこと。

場面の表（id・通しの秒・入り方・中身 1 行）。秒は `check-scenes.ts` の出す表から写す。

## 作りの考え方

場面の並びは `content.json` の `scenes`、曲の測った値は `music.json`、場面は 1 ファイルずつ、共通の部品は `assets/parts.js`、という作りと、そこから外れた所（あれば理由）。

## 決まった見た目と動き（本人が選んだもの）

色・書体・場面の切り替え・見出し・共通の部品の形・項目の出し方・締め。見本の名前（選択票の key）と、数値（大きさ・位置・拍）を添える。

## 本人に外された表現（繰り返さない）

外された形と、外された理由の本人の言葉。

## ファイルの地図

| ファイル | 役割 |
|---|---|
| `content.json` | 手で書く中身（場面の並び・文言・項目） |
| `music.json` | 曲の測った値（`beat-grid.py --music-json` が書く） |
| `index.html` | 場面のクリップ（窓は `scene-windows.ts --write` が書く）・重ね・音 |
| `compositions/*.html` | 場面ごとの 1 ファイルと、帯と見出しの重ね（`heads.html`） |
| `assets/scenes.js` | 場面の時刻・出入り・帯・時計（雛形のまま） |
| `assets/parts.js` | 共通の部品 |
| `check-content.ts` `content.types.ts` `tsconfig.json` | 形と題材ごとの検査（場面の並びは `check-scenes.ts`） |

## content.json と music.json の形

`scenes[]` の各項目（id・file・length・entry・pose・beats・limits）と、場面ごとの `beats` の中身。題材の節（項目・見出し・締め）の形。`music.json` の目印の拍。

## 曲と拍・配分

曲の出どころとライセンス・拍 n の時刻の式・強い一撃や終わりの部分の拍。場面ごとの下限（`limits`）と、今の値。

## 直し方

文言・拍・場面の長さと並び（`content.json` だけで済む）、場面を足す手順、部品や見せ方を変えるときに触るファイル、落とし穴。

## 見本の撮り方

`sample.ts` で本番の上に見本を撮る例（差し替える JSON と撮る時刻）。

## 確かめ方

1. 形と題材ごとの検査: `bunx -p typescript tsc -p <作品>/tsconfig.json && bun <作品>/check-content.ts`（場面の並びの検査 `check-scenes.ts` も中で呼ぶ）
2. `npx hyperframes check`（0 errors で通す。残る info とその理由）
3. 転換の途中を 0.25 秒刻みで撮って見る点
4. 書き出しのコマンドと、確かめる長さ・fps
