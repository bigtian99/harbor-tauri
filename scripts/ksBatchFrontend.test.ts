import assert from "node:assert/strict";

/** 与 ksBatchPackPublish.pickRememberedNpmSettings 保持一致（避免拉 Tauri） */
function pickRememberedNpmSettings(
  config: {
    remember_branch_settings: boolean;
    last_repo_path?: string;
    last_frontend_dir?: string;
    last_build_script?: string;
    last_project_type?: string;
  },
  repoPath: string,
) {
  const repoKey = repoPath.trim();
  const lastRepo = config.last_repo_path?.trim() ?? "";
  const useRemembered =
    !!repoKey
    && repoKey === lastRepo
    && config.remember_branch_settings
    && config.last_project_type === "npm";
  return {
    useRemembered,
    frontendDir: useRemembered ? config.last_frontend_dir?.trim() ?? "" : "",
    buildScript: useRemembered
      ? config.last_build_script?.trim() || "build:prod"
      : "",
  };
}

const baseConfig = {
  remember_branch_settings: true,
  last_repo_path: "/code/klcj-zt-admin",
  last_frontend_dir: "admin-ui",
  last_build_script: "build:prod",
  last_project_type: "maven",
};

assert.deepEqual(
  pickRememberedNpmSettings(baseConfig, "/code/klcj-zt-admin"),
  {
    useRemembered: false,
    frontendDir: "",
    buildScript: "",
  },
  "maven last_project_type must not reuse npm frontend dir",
);

assert.deepEqual(
  pickRememberedNpmSettings(
    { ...baseConfig, last_project_type: "npm" },
    "/code/klcj-zt-admin",
  ),
  {
    useRemembered: true,
    frontendDir: "admin-ui",
    buildScript: "build:prod",
  },
  "npm repo should reuse remembered frontend dir and script",
);

assert.deepEqual(
  pickRememberedNpmSettings(
    { ...baseConfig, last_project_type: "npm" },
    "/code/other-frontend",
  ),
  {
    useRemembered: false,
    frontendDir: "",
    buildScript: "",
  },
  "different repo must not reuse another repo's frontend dir",
);

/** 与 ksBatchPackPublish 保持一致（避免拉 Tauri） */
function forcedNpmScriptForBatchPref(pref: {
  mode: "auto" | "prod" | "test" | "custom";
  customScript: string;
}): string | null {
  if (pref.mode === "prod") return "build:prod";
  if (pref.mode === "test") return "build:test";
  if (pref.mode === "custom") return pref.customScript.trim() || null;
  return null;
}

function buildScriptAfterMerge(targetBranch: string): string {
  return targetBranch.includes("rc-master") ? "build:prod" : "build:test";
}

assert.equal(forcedNpmScriptForBatchPref({ mode: "prod", customScript: "" }), "build:prod");
assert.equal(forcedNpmScriptForBatchPref({ mode: "test", customScript: "" }), "build:test");
assert.equal(forcedNpmScriptForBatchPref({ mode: "custom", customScript: "build:dev" }), "build:dev");
assert.equal(forcedNpmScriptForBatchPref({ mode: "auto", customScript: "" }), null);
assert.equal(buildScriptAfterMerge("origin/rc-master"), "build:prod");
assert.equal(buildScriptAfterMerge("origin/test"), "build:test");

console.log("ksBatchFrontend.test.ts OK");
