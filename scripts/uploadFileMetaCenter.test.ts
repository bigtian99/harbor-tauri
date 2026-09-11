/**
 * 上传区：整页铺满与其它面板一致；仅产物名/路径在拖放区内居中。
 * 跑法：pnpm test（scripts/*.test.ts）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "src/styles/upload.css"), "utf8");

const shell = css.match(/\.upload-shell\s*\{[^}]+\}/);
assert.ok(shell, "应有 .upload-shell");
assert.match(shell[0], /max-width:\s*100%/, "upload-shell 应铺满，与 branch-panel 一致");
assert.doesNotMatch(shell[0], /margin-inline:\s*auto/, "不应整页居中窄栏");
assert.doesNotMatch(shell[0], /max-width:\s*860px/, "不应限制 860px 窄栏");

const metaBlock = css.match(/\.file-meta\s*\{[^}]+\}/);
assert.ok(metaBlock, "应有 .file-meta");
assert.match(metaBlock[0], /text-align:\s*center/, "file-meta 应在拖放区内居中");

const nameBlocks = [...css.matchAll(/\.file-name\s*\{[^}]+\}/g)].map((m) => m[0]);
assert.ok(nameBlocks.length >= 1, "应有 .file-name");
assert.ok(
  nameBlocks.every((b) => /text-align:\s*center/.test(b)),
  "所有 .file-name 应 text-align:center（红框内居中）",
);

const pathBlocks = [...css.matchAll(/\.file-path\s*\{[^}]+\}/g)].map((m) => m[0]);
assert.ok(pathBlocks.length >= 1, "应有 .file-path");
assert.ok(
  pathBlocks.every((b) => /text-align:\s*center/.test(b)),
  "所有 .file-path 应 text-align:center",
);

console.log("uploadFileMetaCenter.test.ts: ok");
