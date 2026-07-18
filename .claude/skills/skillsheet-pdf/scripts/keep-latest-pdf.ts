#!/usr/bin/env bun

import { readdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const PDF_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}_高橋俊スキルシート\.pdf$/;

async function main(): Promise<void> {
  const [latestPath] = process.argv.slice(2);
  if (!latestPath) {
    console.error("usage: bun keep-latest-pdf.ts <latest-pdf>");
    process.exit(1);
  }

  const absoluteLatestPath = resolve(latestPath);
  const latestName = basename(absoluteLatestPath);
  const outputDirectory = dirname(absoluteLatestPath);

  if (!PDF_NAME_PATTERN.test(latestName)) {
    throw new Error(`unexpected PDF filename: ${latestName}`);
  }

  const latestPdf = await stat(absoluteLatestPath);
  if (!latestPdf.isFile()) {
    throw new Error(`latest PDF is not a file: ${absoluteLatestPath}`);
  }

  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const oldPdfNames = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        PDF_NAME_PATTERN.test(entry.name) &&
        entry.name !== latestName,
    )
    .map((entry) => entry.name);

  for (const oldPdfName of oldPdfNames) {
    await unlink(resolve(outputDirectory, oldPdfName));
    console.log(`削除: ${oldPdfName}`);
  }

  console.log(`保持: ${latestName}`);
}

main();
