import {
  getRememberedBranchAdvancedSettings,
  rememberBranchRepoSettings,
} from "../src/branchSettings.ts";
import { readFileSync } from "node:fs";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

const remembered = getRememberedBranchAdvancedSettings({
  remember_branch_settings: true,
  last_spring_profile: "prod",
  last_expose_port: "8181",
  expose_port: "8080",
}, "/repo-a");

assertEqual(remembered.springProfile, "prod", "remembered spring profile should be restored");
assertEqual(remembered.exposePort, "8181", "remembered branch expose port should be restored first");

const fallback = getRememberedBranchAdvancedSettings({
  remember_branch_settings: true,
  last_spring_profile: "",
  last_expose_port: "",
  expose_port: "8080",
}, "/repo-a");

assertEqual(fallback.springProfile, "", "empty spring profile should stay empty");
assertEqual(fallback.exposePort, "8080", "default config port should fill advanced port when no branch port was saved");

const disabled = getRememberedBranchAdvancedSettings({
  remember_branch_settings: false,
  last_spring_profile: "prod",
  last_expose_port: "8181",
  expose_port: "8080",
}, "/repo-a");

assertEqual(disabled.springProfile, "", "disabled branch memory should not restore spring profile");
assertEqual(disabled.exposePort, "8080", "branch expose port should still use the config default when branch memory is disabled");

const repoScopedConfig = {
  remember_branch_settings: true,
  last_repo_path: "/repo-b",
  last_spring_profile: "test",
  last_expose_port: "9090",
  expose_port: "8080",
  branch_repo_settings: {
    "/repo-a": { springProfile: "prod", exposePort: "8181" },
    "/repo-b": { springProfile: "test", exposePort: "9090" },
  },
};

const restoredRepoA = getRememberedBranchAdvancedSettings(repoScopedConfig, "/repo-a");
assertEqual(restoredRepoA.springProfile, "prod", "repo A should restore its own spring profile after switching back");
assertEqual(restoredRepoA.exposePort, "8181", "repo A should restore its own expose port after switching back");

const restoredRepoB = getRememberedBranchAdvancedSettings(repoScopedConfig, "/repo-b");
assertEqual(restoredRepoB.springProfile, "test", "repo B should restore its own spring profile");
assertEqual(restoredRepoB.exposePort, "9090", "repo B should restore its own expose port");

const rememberedRepoA = rememberBranchRepoSettings(repoScopedConfig, "/repo-a", {
  springProfile: "prod",
  exposePort: "8182",
});
assertEqual(
  rememberedRepoA.branch_repo_settings["/repo-a"].exposePort,
  "8182",
  "saving repo A should update repo A's own expose port",
);
assertEqual(
  rememberedRepoA.branch_repo_settings["/repo-b"].exposePort,
  "9090",
  "saving repo A should not overwrite repo B's expose port",
);

// 前端重构后分支记忆逻辑在 hooks/useBranchPack，App 仅在 loadConfig 后调用 applyRememberedConfig
const appSource = readFileSync("src/App.tsx", "utf8");
const branchPackSource = readFileSync("src/hooks/useBranchPack.ts", "utf8");

if (!branchPackSource.includes("restoreRememberedBranchAdvancedSettings(savedConfig, savedConfig.last_repo_path)")) {
  throw new Error("applyRememberedConfig should restore branch advanced settings through the shared helper");
}

if (!branchPackSource.includes("rememberBranchRepoSettings(")) {
  throw new Error("branch settings should save advanced settings per repository");
}

if (!appSource.includes("applyRememberedConfig") && !appSource.includes("onConfigLoadedRef")) {
  throw new Error("App should wire loadConfig success to applyRememberedConfig");
}

if (branchPackSource.includes("setBranchExposePort(savedConfig.last_expose_port)")) {
  throw new Error("loadConfig path should not bypass expose port fallback with savedConfig.last_expose_port");
}
