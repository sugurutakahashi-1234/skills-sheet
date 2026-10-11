#!/usr/bin/env bun
/**
 * 選択票の回答を、貼り付けなしで受け取るための手元の中継。
 *
 * picker.ts が作った HTML を 127.0.0.1 の空きポートで配信し、ページの [送信] を受けて <ページ名>.answer.txt に書く。
 * agent は `wait` で回答を待って読む（時間切れは exit 3 なので、同じ wait を打ち直す）。file:// で開いたページには [送信] が出ず、
 * 今までどおり「回答をコピー」で貼り戻す。
 *
 *   open <out.html>            中継を起動（同じフォルダに動いていれば使い回す）してブラウザで開き、URL を出す
 *   wait <out.html> [--timeout 600] [--fresh]   回答を待つ。届けば全文を stdout に出して 0、時間切れは 3。--fresh は wait を始める前の回答を無視する
 *   status <out.html | dir>    中継が動いているか・回答が届いているか
 *   stop <out.html | dir>      中継を止める（回答を読み終えてから）
 *   serve <dir> <port>         中継の本体（open が裏で起動する。手で打たない）
 *
 * - 中継はフォルダごとに 1 つ。状態は <dir>/.relay.json（port と pid）
 * - 外には出ない（127.0.0.1 だけで待つ）。配信するのは <dir> の中だけで、上の階層は見せない
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

type State = { port: number; pid: number };

const stateFile = (dir: string) => join(dir, ".relay.json");
export const answerFile = (page: string) => `${page}.answer.txt`;

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export function readState(dir: string): State | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(dir), "utf8")) as State;
    return alive(s.pid) ? s : null;
  } catch { return null; }
}

const mime: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", txt: "text/plain; charset=utf-8" };

/** 中継の本体。<dir> の中だけを配信し、POST /__answer?page=<name> を <name>.answer.txt に書く */
export function startServer(dir: string, port: number) {
  const root = resolve(dir);
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/__answer") {
        const page = basename(url.searchParams.get("page") ?? "");
        if (!page) return new Response("page が要る", { status: 400 });
        const body = await req.text();
        const target = join(root, answerFile(page));
        const tmp = `${target}.tmp`;
        writeFileSync(tmp, body);
        renameSync(tmp, target); // 書きかけを wait に読ませない
        return new Response("ok");
      }
      if (req.method !== "GET") return new Response("", { status: 405 });
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
      const file = resolve(root, rel || "index.html");
      if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return new Response("見つからない", { status: 404 });
      const ext = file.split(".").pop()?.toLowerCase() ?? "";
      return new Response(Bun.file(file), { headers: { "content-type": mime[ext] ?? "application/octet-stream", "cache-control": "no-store" } });
    },
  });
}

/** 空きポートを 1 つ取る */
function freePort(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = s.port;
  s.stop(true);
  return port;
}

/** 中継を起動する（動いていれば使い回す）。戻り値は port */
export function ensureServer(dir: string): number {
  const running = readState(dir);
  if (running) return running.port;
  const port = freePort();
  const child = Bun.spawn(["bun", import.meta.path, "serve", dir, String(port)], { stdio: ["ignore", "ignore", "ignore"] });
  child.unref(); // 裏で動かしたまま、この呼び出しは返す
  writeFileSync(stateFile(dir), JSON.stringify({ port, pid: child.pid }));
  return port;
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try { Bun.spawnSync(cmd, { stdio: ["ignore", "ignore", "ignore"] }); return true; } catch { return false; }
}

/** 回答を待つ。届けば本文、時間切れは null */
export async function waitAnswer(html: string, timeoutSec: number, fresh: boolean): Promise<string | null> {
  const file = join(dirname(html), answerFile(basename(html)));
  const since = fresh ? Date.now() : 0;
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (existsSync(file) && statSync(file).mtimeMs > since) return readFileSync(file, "utf8");
    await Bun.sleep(500);
  }
  return null;
}

const dirOf = (p: string) => (existsSync(p) && statSync(p).isDirectory() ? p : dirname(p));

export async function main(args: string[]): Promise<number> {
  const help = `usage: bun relay.ts <open | wait | status | stop> <out.html | dir> [--timeout 600] [--fresh]

選択票（picker.ts の HTML）の回答を、貼り付けなしで受け取る手元の中継。127.0.0.1 の空きポートでフォルダを配信し、
ページの [送信] を <ページ名>.answer.txt に書く。file:// で開いたページには [送信] が出ず、今までどおりコピーで貼り戻す。

  open <out.html>     中継を起動（同じフォルダに動いていれば使い回す）してブラウザで開き、URL を stdout に出す
  wait <out.html>     回答を待つ。届けば全文を stdout に出して 0 で終わる。--timeout 秒（既定 600）で時間切れなら 3（同じ wait を打ち直す）。
                      --fresh は wait を始める前に届いていた回答を無視する（同じページを作り直して再送してもらうとき）
  status <out.html>   中継が動いているか・回答が届いているか
  stop <out.html>     中継を止める。回答を読み終えてから（止めると [送信] が届かなくなる）

Bash から wait を呼ぶときは timeout を 600000 ms 程度にする。人が答えない間は別の作業に戻ってよく、中継は残るので後で wait を打ち直せる。`;
  if (args.includes("--help") || args.includes("-h")) { console.log(help); return 0; }
  const [cmd, target] = args;
  if (!cmd || !target) { console.error(help); return 2; }
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

  if (cmd === "serve") {
    startServer(target, Number(args[2]));
    await new Promise(() => {}); // stop されるまで動き続ける
    return 0;
  }
  if (cmd === "open") {
    const html = resolve(target);
    if (!existsSync(html)) { console.error(`${html} が無い`); return 1; }
    const dir = dirname(html);
    mkdirSync(dir, { recursive: true });
    const port = ensureServer(dir);
    const url = `http://127.0.0.1:${port}/${encodeURIComponent(basename(html))}`;
    const opened = openBrowser(url);
    console.log(url);
    if (!opened) console.error("ブラウザを開けなかったので、この URL を人に伝える");
    return 0;
  }
  if (cmd === "wait") {
    const html = resolve(target);
    const answer = await waitAnswer(html, Number(flag("--timeout") ?? 600), args.includes("--fresh"));
    if (answer === null) { console.error("時間切れ（まだ回答が無い）。同じ wait を打ち直す"); return 3; }
    console.log(answer);
    return 0;
  }
  if (cmd === "status") {
    const dir = resolve(dirOf(target));
    const s = readState(dir);
    const html = resolve(target);
    const has = !statSync(html).isDirectory() && existsSync(join(dir, answerFile(basename(html))));
    console.log(`${s ? `中継あり: http://127.0.0.1:${s.port}/ (pid ${s.pid})` : "中継なし"}${statSync(html).isDirectory() ? "" : ` / 回答: ${has ? "あり" : "なし"}`}`);
    return 0;
  }
  if (cmd === "stop") {
    const dir = resolve(dirOf(target));
    const s = readState(dir);
    if (s) { try { process.kill(s.pid); } catch {} }
    try { unlinkSync(stateFile(dir)); } catch {}
    console.log(s ? "止めた" : "動いていなかった");
    return 0;
  }
  console.error(help);
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { console.error(String(error)); process.exitCode = 1; });
}
