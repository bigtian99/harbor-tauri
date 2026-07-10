#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

function sh(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", encoding: "utf8", ...opts });
}
function out(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

console.log("cwd", process.cwd());
sh("git status --short");
sh("git branch -vv");
sh("git log -5 --oneline");
sh("git remote -v");
try {
  sh("node scripts/set-version.mjs");
} catch (e) {
  console.log("set-version view failed", e.message);
}

const pkg = JSON.parse(out("node -p \"require('./package.json').version\""));
console.log("package version", pkg);
const cargo = out("node -e \"const fs=require('fs');const m=fs.readFileSync('src-tauri/Cargo.toml','utf8').match(/^version\\\\s*=\\\\s*\\\"([^\\\"]+)\\\"/m);console.log(m[1])\"");
const tauri = out("node -e \"console.log(JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).version)\"");
console.log({ pkg, cargo, tauri });

// pick version: prefer package.json, ensure synced
let version = pkg;
// if tags exist for this version, bump patch
const localTags = out("git tag --sort=-v:refname | head -20");
console.log("local tags:\n", localTags);
let remoteTags = "";
try {
  remoteTags = out("git ls-remote --tags origin 'v0.2.*'");
  console.log("remote tags:\n", remoteTags);
} catch (e) {
  console.log("ls-remote failed", e.message);
}

function tagExists(v) {
  const t = `v${v}`;
  if (localTags.split("\n").some((l) => l.trim() === t)) return true;
  if (remoteTags.includes(`refs/tags/${t}`)) return true;
  try {
    out(`git rev-parse -q --verify refs/tags/${t}`);
    return true;
  } catch {
    return false;
  }
}

// bump until free
function bumpPatch(v) {
  const [a, b, c] = v.split(".").map(Number);
  return `${a}.${b}.${c + 1}`;
}
while (tagExists(version)) {
  console.log(`tag v${version} exists, bumping`);
  version = bumpPatch(version);
}
console.log("release version", version);

// sync versions
sh(`node scripts/set-version.mjs ${version}`);

// stage all relevant (not secrets)
sh("git add package.json scripts/release.mjs scripts/set-version.mjs src/components/UpdateModal.tsx src/components/UpdateModal.css src-tauri/src/updater.rs src-tauri/src/landing.rs src-tauri/Cargo.toml src-tauri/tauri.conf.json 2>/dev/null || true");
// also add any other modified tracked files
const dirty = out("git status --porcelain");
console.log("dirty after selective add:\n", dirty);
// add remaining source changes
const lines = dirty.split("\n").filter(Boolean);
for (const line of lines) {
  const path = line.slice(3).trim().replace(/^"+|"+$/g, "");
  if (
    path.startsWith("node_modules") ||
    path.startsWith("dist/") ||
    path.startsWith("src-tauri/target") ||
    path.includes(".DS_Store")
  )
    continue;
  if (line.startsWith("??") || line.startsWith(" M") || line.startsWith("M ") || line.startsWith("A ") || line.startsWith("AM") || line.startsWith("MM") || line[0] !== " " || line[1] !== " ") {
    try {
      sh(`git add -- "${path}"`);
    } catch (e) {
      console.log("skip", path, e.message);
    }
  }
}

sh("git status --short");
const staged = out("git diff --cached --name-only");
if (!staged) {
  console.log("nothing staged — check if already committed");
} else {
  const msg = `feat: 自动更新加固、发版/版本同步脚本、日志新在前、更新弹窗样式

- reverse diagnostic log (newest first)
- release/set-version scripts as single source of truth
- updater: validate dmg, API asset download fallback, clearer errors
- UpdateModal restyle to match app theme
- sync package/Cargo/tauri version to ${version}`;
  sh(`git commit -m ${JSON.stringify(msg)}`);
}

sh("git push origin HEAD");
const tag = `v${version}`;
// create tag if missing
try {
  out(`git rev-parse -q --verify refs/tags/${tag}`);
  console.log("tag already local", tag);
} catch {
  sh(`git tag -a ${tag} -m ${tag}`);
}
sh(`git push origin ${tag}`);
sh("git status");
sh("git log -1 --oneline");
console.log("\nDONE", tag);
console.log("Actions: https://github.com/bigtian99/harbor-tauri/actions");
console.log("Release: https://github.com/bigtian99/harbor-tauri/releases/tag/" + tag);
