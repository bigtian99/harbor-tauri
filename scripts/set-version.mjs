#!/usr/bin/env node
/**
 * 版本单一真相源：package.json
 *
 * 同步到：
 *   - package.json          ← 你只改这个（或用本脚本）
 *   - src-tauri/Cargo.toml  ← check_update 读 CARGO_PKG_VERSION
 *   - src-tauri/tauri.conf.json ← 安装包显示版本
 *
 * 用法：
 *   node scripts/set-version.mjs              # 查看当前三处版本
 *   node scripts/set-version.mjs 0.2.32       # 指定版本
 *   node scripts/set-version.mjs patch|minor|major
 *   pnpm version:set 0.2.32
 *   pnpm version:patch
 *   pnpm release:patch   # 改版本 + tag + push → CI Release
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const tauriPath = join(root, "src-tauri", "tauri.conf.json");

export function parseSemver(v) {
  const m = String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`非法版本号: ${v}（需要 x.y.z）`);
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: `${m[1]}.${m[2]}.${m[3]}` };
}

export function bump(v, kind) {
  const s = parseSemver(v);
  if (kind === "major") return `${s.major + 1}.0.0`;
  if (kind === "minor") return `${s.major}.${s.minor + 1}.0`;
  if (kind === "patch") return `${s.major}.${s.minor}.${s.patch + 1}`;
  throw new Error(`未知 bump: ${kind}`);
}

export function syncVersions(version) {
  parseSemver(version); // validate

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  let cargo = readFileSync(cargoPath, "utf8");
  const nextCargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
  if (nextCargo === cargo) throw new Error("Cargo.toml 未找到 version 字段");
  writeFileSync(cargoPath, nextCargo);

  const tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
  tauri.version = version;
  writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

  return version;
}

export function readVersions() {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  const cargo = (readFileSync(cargoPath, "utf8").match(/^version\s*=\s*"([^"]+)"/m) || [])[1];
  const tauri = JSON.parse(readFileSync(tauriPath, "utf8")).version;
  return { pkg, cargo, tauri };
}

export function assertVersionsSynced() {
  const v = readVersions();
  if (v.pkg !== v.cargo || v.pkg !== v.tauri) {
    throw new Error(
      `版本不一致:\n  package.json=${v.pkg}\n  Cargo.toml=${v.cargo}\n  tauri.conf.json=${v.tauri}\n请先: pnpm version:set ${v.pkg}`,
    );
  }
  return v.pkg;
}

// CLI：node scripts/set-version.mjs [version|patch|minor|major]
const invoked = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
const isMain = invoked.endsWith("/set-version.mjs") || invoked.endsWith("set-version.mjs");

if (isMain) {
  const arg = process.argv[2];
  const cur = readVersions();

  if (!arg || arg === "-h" || arg === "--help") {
    console.log(`当前版本:
  package.json       ${cur.pkg}  ← 唯一需要你改的
  Cargo.toml         ${cur.cargo}  (更新检测用)
  tauri.conf.json    ${cur.tauri}  (安装包显示)
  一致: ${cur.pkg === cur.cargo && cur.pkg === cur.tauri ? "是" : "否 ⚠️"}

用法:
  pnpm version:set 0.2.32   # 指定版本，只改三处文件不发版
  pnpm version:patch        # +0.0.1
  pnpm release:patch        # 改版本 + 打 tag + 推送 → CI 出 Release
`);
    process.exit(0);
  }

  let version;
  if (arg === "patch" || arg === "minor" || arg === "major") {
    version = bump(cur.pkg, arg);
  } else {
    version = parseSemver(arg).raw;
  }

  const before = readVersions();
  syncVersions(version);
  const after = readVersions();
  console.log(`✓ 版本已同步 → ${version}
  package.json       ${before.pkg} → ${after.pkg}
  Cargo.toml         ${before.cargo} → ${after.cargo}
  tauri.conf.json    ${before.tauri} → ${after.tauri}

下一步发版: pnpm release   （打 v${version} + CI 创建 GitHub Release）
`);
}
