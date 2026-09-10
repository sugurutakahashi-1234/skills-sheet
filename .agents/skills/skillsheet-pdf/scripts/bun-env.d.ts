// Bun で実行する単独スクリプト用の最小型宣言。
//
// このリポジトリは依存パッケージを持たない（node_modules も package.json も無い）
// ため、@types/node を導入せずに VSCode の型エラーだけを解消する目的で、
// スキル内スクリプトが使う分の API のみをここで宣言する。実行時の実体は Bun が
// 提供する本物の Node 互換 API なので、ここでの宣言は型補完用に過ぎない。

declare const console: {
  error(message?: unknown): void;
  log(message?: unknown): void;
};

declare const process: {
  readonly argv: readonly string[];
  exit(code?: number): never;
};

declare module "node:fs/promises" {
  interface Dirent {
    readonly name: string;
    isFile(): boolean;
  }

  interface Stats {
    isFile(): boolean;
  }

  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<Dirent[]>;
  export function stat(path: string): Promise<Stats>;
  export function unlink(path: string): Promise<void>;
  export function writeFile(path: string, data: string): Promise<void>;
}

declare module "node:path" {
  export function basename(path: string): string;
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
}
