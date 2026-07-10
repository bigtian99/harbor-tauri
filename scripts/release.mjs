#!/usr/bin/env node
/**
 * 发版：同步三处版本 → commit → tag → push
 * GitHub Release + dmg 由 CI（build.yml softprops/action-gh-release）在 tag 推送后生成。
 *
 * 用法：
 *   pnpm release            # 用 package.json 当前版本
 *   pnpm release 0.2.32     # 先写成该版本再发
 *   pnpm release:patch
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertVersionsSynced,
  bump,
  parseSemver,
  readVersions,
  syncVersions,
} from "./set-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sh(cmd) {
  return execSync(cmd, { cwd: root, stdio: "inherit" });
}

function shOut(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

function assertCleanEnough() {
  const status = shOut("git status --porcelain");
  const dirty = status
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter(
      (f) =>
        f !== "package.json" &&
        f !== "src-tauri/Cargo.toml" &&
        f !== "src-tauri/tauri.conf.json",
    );
  if (dirty.length) {
    throw new Error(
      `工作区有未提交改动，先处理再 release:\n  ${dirty.join("\n  ")}`,
    );
  }
}

const arg = process.argv[2];
const cur = readVersions();
let version = cur.pkg;

if (arg === "patch" || arg === "minor" || arg === "major") {
  version = bump(cur.pkg, arg);
} else if (arg) {
  version = parseSemver(arg).raw;
} else {
  version = parseSemver(cur.pkg).raw;
}

const tag = `v${version}`;
console.log(`→ 发布 ${tag}`);
console.log(`  当前: package=${cur.pkg} cargo=${cur.cargo} tauri=${cur.tauri}`);

assertCleanEnough();
syncVersions(version);
assertVersionsSynced();

const changed = shOut(
  "git status --porcelain package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json",
);
if (changed) {
  sh("git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json");
  sh(`git commit -m "chore: release ${tag}"`);
}

const tagExists =
  execSync(`git rev-parse -q --verify refs/tags/${tag} || true`, {
    cwd: root,
    encoding: "utf8",
  }).trim().length > 0;
if (tagExists) {
  throw new Error(`本地已有 tag ${tag}，请先删除或换版本号`);
}

sh(`git tag -a ${tag} -m ${tag}`);
sh("git push origin HEAD");
sh(`git push origin ${tag}`);

console.log(`
✓ tag ${tag} 已推送
✓ CI 构建产物并创建 GitHub Release（含 dmg）
  Actions: https://github.com/bigtian99/harbor-tauri/actions
  Release: https://github.com/bigtian99/harbor-tauri/releases/tag/${tag}

等 Actions 绿了再测更新。历史 Release 若 dmg 文件名版本和 tag 不一致（如 v0.2.21 挂着 0.1.10 dmg）不影响检测，但说明当时版本没同步。
`);
