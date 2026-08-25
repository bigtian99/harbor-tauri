#!/usr/bin/env node
/**
 * 生成 GitHub Release 说明（上一 tag → 当前 tag 的 commit 列表）
 * 用法: node scripts/release-notes.mjs v0.2.72
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
if (!tag || !tag.startsWith("v")) {
  console.error("用法: node scripts/release-notes.mjs vX.Y.Z");
  process.exit(1);
}

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

let prev = "";
try {
  prev = sh(`git describe --tags --abbrev=0 ${tag}^ 2>/dev/null`);
} catch {
  prev = "";
}

const range = prev ? `${prev}..${tag}` : tag;
const lines = sh(`git log ${range} --pretty=format:%s --no-merges`)
  .split("\n")
  .filter(Boolean);

const feat = [];
const fix = [];
const other = [];
for (const line of lines) {
  if (/^feat(\(|:)/i.test(line)) feat.push(line);
  else if (/^fix(\(|:)/i.test(line)) fix.push(line);
  else if (/^chore: release /i.test(line)) continue;
  else other.push(line);
}

const bullets = (items) => items.map((s) => `- ${s}`).join("\n");
const parts = [];
if (feat.length) parts.push(`## 新功能\n\n${bullets(feat)}`);
if (fix.length) parts.push(`## 修复与优化\n\n${bullets(fix)}`);
if (other.length) parts.push(`## 其它\n\n${bullets(other)}`);

const compare = prev
  ? `\n\n[完整提交对比](https://github.com/bigtian99/harbor-tauri/compare/${prev}...${tag})`
  : "";

process.stdout.write(parts.join("\n\n") + compare + "\n");
