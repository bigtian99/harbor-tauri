import { readFileSync } from "node:fs";

function assertContains(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}`);
  }
}

function assertNotContains(source: string, unexpected: string, message: string) {
  if (source.includes(unexpected)) {
    throw new Error(`${message}\nUnexpected: ${unexpected}`);
  }
}

const buildScript = readFileSync("src-tauri/build.rs", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

assertContains(
  buildScript,
  "cargo:rerun-if-env-changed=OPS_MODE",
  "Cargo build script should rebuild when OPS_MODE changes between normal and ops builds",
);

assertContains(
  packageJson.scripts["tauri:build:ops"],
  "node scripts/tauri-build-ops.mjs",
  "macOS ops build script should use the cross-platform env wrapper",
);

assertContains(
  packageJson.scripts["tauri:build:ops:win64"],
  "node scripts/tauri-build-ops.mjs",
  "Windows ops build script should use the cross-platform env wrapper",
);

assertNotContains(
  packageJson.scripts["tauri:build:ops:win64"],
  "OPS_MODE=true",
  "Windows ops build script should not rely on Unix shell env assignment",
);
