#!/usr/bin/env node
import { execSync } from "node:child_process";
import { chdir } from "node:process";

chdir("/Users/daijunxiong/Desktop/tauri/jar-to-harbor");

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  try {
    const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (out) process.stdout.write(out);
    return out;
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout.toString());
    if (e.stderr) process.stderr.write(e.stderr.toString());
    throw e;
  }
}

run("git status -sb");
run("git log -3 --oneline");
run("git branch -vv");

// stage
run("git add -A");
// unstage junk if any
try {
  run("git reset HEAD -- node_modules dist src-tauri/target 2>/dev/null || true");
} catch {}

const staged = run("git diff --cached --name-only") || "";
console.log("staged files:\n", staged);
if (!staged.trim()) {
  console.log("Nothing to commit");
  process.exit(0);
}

const msg = `feat: 更新体验闭环（进度/说明/关于页检查）与 Release CI 修复

- 更新弹窗展示 release notes（可滚动）
- 下载进度：async+spawn_blocking，避免阻塞 UI
- 设置→关于：版本展示 + 手动检查更新
- 诊断日志新在前；release 脚本以 package.json 为源自动 bump
- CI：gh release upload --clobber，修复 asset 同名 404 / isLatest`;

// write message to temp file to avoid shell quoting issues
import { writeFileSync, unlinkSync } from "node:fs";
const msgFile = "/tmp/jarporter-commit-msg.txt";
writeFileSync(msgFile, msg);
run(`git commit -F ${msgFile}`);
try { unlinkSync(msgFile); } catch {}

run("git status -sb");
run("git log -1 --oneline");
console.log("\nDONE commit. Push with: git push origin HEAD");
