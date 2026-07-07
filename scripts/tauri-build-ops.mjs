import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
