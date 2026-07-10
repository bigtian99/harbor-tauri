#!/usr/bin/env node
/**
 * 发版（package.json 为唯一版本源）
 *
 *   pnpm release              # 默认：package.json 版本 patch +1 → 同步 → tag → push
 *   pnpm release minor|major  # 按类型 bump
 *   pnpm release 0.2.40       # 指定版本（仍会写回 package.json 并同步）
 *
 * 流程：读 package.json → 算出新版本 → 同步 Cargo.toml / tauri.conf.json
 *      → commit 版本文件 → tag vX.Y.Z → push → CI 建 GitHub Release
 */
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bump, parseSemver, readVersions, syncVersions } from "./set-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sh(cmd) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { cwd: root, stdio: "inherit" });
}

function shOut(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

function tagExistsLocal(tag) {
  try {
    shOut(`git rev-parse -q --verify refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function tagExistsRemote(tag) {
  try {
    const out = shOut(`git ls-remote --tags origin "refs/tags/${tag}"`);
    return out.length > 0;
  } catch {
    return false;
  }
}

function resolveVersion(arg, pkgVersion) {
  // 无参数：默认 patch（以 package.json 为准）
  if (!arg) return bump(pkgVersion, "patch");
  if (arg === "patch" || arg === "minor" || arg === "major") {
    return bump(pkgVersion, arg);
  }
  return parseSemver(arg).raw;
}

function ensureFreeTag(version) {
  let v = version;
  // tag 已占用则继续 patch，直到空位
  while (tagExistsLocal(`v${v}`) || tagExistsRemote(`v${v}`)) {
    console.log(`  tag v${v} 已存在，自动 +patch`);
    v = bump(v, "patch");
  }
  return v;
}

const arg = process.argv[2];
const before = readVersions();
const base = parseSemver(before.pkg).raw; // 只信 package.json

let version = resolveVersion(arg, base);
version = ensureFreeTag(version);
const tag = `v${version}`;

console.log(`→ 发布 ${tag}`);
console.log(`  基准 package.json = ${before.pkg}`);
console.log(`  调整前: cargo=${before.cargo} tauri=${before.tauri}`);
console.log(`  目标版本: ${version}（写回 package.json + 同步 Cargo/tauri）`);

// 其它脏文件只警告，不拦（版本三件套会单独 commit）
const dirty = shOut("git status --porcelain")
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
  console.warn(
    `⚠ 工作区还有其它未提交文件（不会打进版本 commit）:\n  ${dirty.join("\n  ")}`,
  );
}

syncVersions(version);
const after = readVersions();
if (after.pkg !== version || after.cargo !== version || after.tauri !== version) {
  throw new Error(
    `版本同步失败: package=${after.pkg} cargo=${after.cargo} tauri=${after.tauri}`,
  );
}
console.log(`  已同步: package/cargo/tauri → ${version}`);

const changed = shOut(
  "git status --porcelain package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json",
);
if (changed) {
  sh("git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json");
  sh(`git commit -m "chore: release ${tag}"`);
} else {
  console.log("  版本文件无 diff（可能已提交），继续打 tag");
}

if (tagExistsLocal(tag)) {
  throw new Error(`本地已有 tag ${tag}`);
}

sh(`git tag -a ${tag} -m ${tag}`);
sh("git push origin HEAD");
sh(`git push origin ${tag}`);

console.log(`
✓ 已发布 ${tag}
  package.json ${before.pkg} → ${version}
  Cargo / tauri 已对齐
  CI: https://github.com/bigtian99/harbor-tauri/actions
  Release: https://github.com/bigtian99/harbor-tauri/releases/tag/${tag}

等 Actions 绿了 → Release 应为 Published（非 Draft）再测自动更新。
`);
