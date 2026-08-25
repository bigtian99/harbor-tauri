#!/usr/bin/env node
/**
 * 生成 GitHub Release 说明（上一 tag → 当前 tag 的 commit 列表）
 * 用法: node scripts/release-notes.mjs v0.2.72 [--out release-notes.md]
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const tag = args.find((a) => a.startsWith("v"));
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

if (!tag || !tag.startsWith("v")) {
  console.error("用法: node scripts/release-notes.mjs vX.Y.Z [--out release-notes.md]");
  process.exit(1);
}

const version = tag.replace(/^v/, "");

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** conventional commit → 可读条目 */
function formatLine(subject) {
  const m = subject.match(/^(feat|fix|chore|docs|refactor|perf|style|test)(\([^)]+\))?!?:\s*(.+)$/i);
  if (!m) return `- ${subject}`;
  const [, type, scopeRaw, msg] = m;
  const scope = scopeRaw ? scopeRaw.slice(1, -1) : "";
  const prefix = scope ? `**${scope}**` : type.toLowerCase();
  return `- ${prefix}：${msg}`;
}

let prev = "";
try {
  prev = sh(`git describe --tags --abbrev=0 ${tag}^`);
} catch {
  prev = "";
}

const range = prev ? `${prev}..${tag}` : tag;
let lines = [];
try {
  lines = sh(`git log ${range} --pretty=format:%s --no-merges`).split("\n").filter(Boolean);
} catch {
  lines = [];
}

const feat = [];
const fix = [];
const other = [];
for (const line of lines) {
  if (/^chore: release /i.test(line)) continue;
  if (/^feat(\(|:)/i.test(line)) feat.push(formatLine(line));
  else if (/^fix(\(|:)/i.test(line)) fix.push(formatLine(line));
  else other.push(formatLine(line));
}

const parts = [`## JarPorter ${version}`, ""];
if (feat.length) parts.push("### 新功能", "", ...feat, "");
if (fix.length) parts.push("### 修复与优化", "", ...fix, "");
if (other.length) parts.push("### 其它", "", ...other, "");

if (feat.length === 0 && fix.length === 0 && other.length === 0) {
  parts.push("### 更新内容", "", "- 维护版本，详见提交对比。", "");
}

if (prev) {
  parts.push(
    "---",
    "",
    `[查看 ${prev} → ${tag} 全部提交](https://github.com/bigtian99/harbor-tauri/compare/${prev}...${tag})`,
    "",
  );
}

const body = parts.join("\n").trimEnd() + "\n";

if (outFile) {
  writeFileSync(outFile, body, "utf8");
} else {
  process.stdout.write(body);
}
