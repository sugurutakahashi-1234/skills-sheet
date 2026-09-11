#!/usr/bin/env bun
/**
 * Web 版を手元で確認する。dist/ を http://localhost:3000 で配信し、
 * README.md か scripts/build-site.ts を保存したら作り直す（ブラウザは手動で再読み込み）。
 * 使い方: bun run dev
 */
import { watch } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const PORT = Number(process.env.PORT ?? 3000);
const DIST = "dist";

let building = Promise.resolve();
const build = () => {
  building = building.then(async () => {
    try {
      await $`bun scripts/build-site.ts`.quiet();
      console.log(`${new Date().toLocaleTimeString()} 再生成`);
    } catch (e) {
      console.error(String(e));
    }
  });
  return building;
};

await build();
for (const f of ["README.md", "scripts/build-site.ts"]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(f, () => { clearTimeout(timer); timer = setTimeout(build, 150); });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    await building;
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(DIST, path === "/" ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`http://localhost:${PORT}/ で配信中（README.md / build-site.ts の保存で再生成。Ctrl+C で停止）`);
