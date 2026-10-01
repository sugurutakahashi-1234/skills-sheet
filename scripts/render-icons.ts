/**
 * assets/favicon.svg から PNG のアイコンを書き出す。favicon.svg を変えたら `bun run icons` で作り直してコミットする。
 * - favicon-32.png: SVG のファビコンに対応しないブラウザ向け
 * - apple-touch-icon.png: iPhone の「ホーム画面に追加」向け。角丸は iOS が付けるので、角丸を外した正方形で書き出す
 * Pages の CI は Chromium を入れていない（PUPPETEER_SKIP_DOWNLOAD）ので、ビルドでは作らず手元で作ったものを使う。
 */
import puppeteer from "puppeteer";

const svg = await Bun.file("assets/favicon.svg").text();
const square = svg.replace(/ rx="7"/, "");
const browser = await puppeteer.launch();
const page = await browser.newPage();
for (const [file, size, src] of [["assets/favicon-32.png", 32, svg], ["assets/apple-touch-icon.png", 180, square]] as const) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await page.screenshot({ path: file, omitBackground: true });
  console.log(`生成: ${file}`);
}
await browser.close();
