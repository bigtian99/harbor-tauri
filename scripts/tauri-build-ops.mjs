import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const prepareScript = join(process.cwd(), "scripts", "prepare-bundle-resources.mjs");
if (existsSync(prepareScript)) {
  const prep = spawnSync(process.execPath, [prepareScript], { stdio: "inherit" });
  if (prep.status !== 0) {
    process.exit(prep.status ?? 1);
  }
}

// OPS 无分支/上传打包菜单，不必内置 ~180MB Maven+JDK
const downloadScript = join(process.cwd(), "scripts", "download-bundle-tools.mjs");
if (existsSync(downloadScript)) {
  const dl = spawnSync(process.execPath, [downloadScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      SKIP_BUNDLE_TOOLS: process.env.SKIP_BUNDLE_TOOLS || "1",
    },
  });
  if (dl.status !== 0) {
    process.exit(dl.status ?? 1);
  }
}

const [target, ...restArgs] = process.argv.slice(2);
const args = ["build"];

if (target && !target.startsWith("-")) {
  args.push("--target", target);
  args.push(...restArgs);
} else if (target) {
  args.push(target, ...restArgs);
}

const localCommand = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);
const command = existsSync(localCommand) ? localCommand : process.platform === "win32" ? "tauri.cmd" : "tauri";
const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    OPS_MODE: "true",
  },
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
