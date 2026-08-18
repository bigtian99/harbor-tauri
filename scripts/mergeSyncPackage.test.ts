import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  autoPushHarborForSpringProfile,
  buildScriptAfterMerge,
  mergeSyncPackageConfirmHint,
  preferNpmBuildScript,
  shouldPushHarborAfterMerge,
  springProfileAfterMerge,
} from "../src/mergeSyncPackage.ts";

assert.equal(shouldPushHarborAfterMerge("origin/rc-master"), true);
assert.equal(shouldPushHarborAfterMerge("feature/rc-master-hotfix"), true);
assert.equal(shouldPushHarborAfterMerge("origin/master"), false);
assert.equal(shouldPushHarborAfterMerge("origin/RC-Master"), false);
assert.match(mergeSyncPackageConfirmHint("origin/rc-master"), /Harbor/);
assert.match(mergeSyncPackageConfirmHint("origin/rc-master"), /build:prod/);
assert.match(mergeSyncPackageConfirmHint("origin/master"), /不推送/);
assert.match(mergeSyncPackageConfirmHint("origin/master"), /build:test/);

assert.equal(springProfileAfterMerge("origin/rc-master"), "prod");
assert.equal(springProfileAfterMerge("feature/rc-master-hotfix"), "prod");
assert.equal(springProfileAfterMerge("origin/master"), "test");

assert.equal(buildScriptAfterMerge("origin/rc-master"), "build:prod");
assert.equal(buildScriptAfterMerge("feature/rc-master-hotfix"), "build:prod");
assert.equal(buildScriptAfterMerge("origin/master"), "build:test");
assert.equal(buildScriptAfterMerge("origin/develop"), "build:test");
assert.equal(buildScriptAfterMerge("origin/test"), "build:test");

assert.equal(
  preferNpmBuildScript("origin/test", ["build", "build:prod", "build:test"], "build:prod"),
  "build:test",
);
assert.equal(
  preferNpmBuildScript("origin/rc-master", ["build", "build:prod", "build:test"], "build:test"),
  "build:prod",
);
assert.equal(
  preferNpmBuildScript("origin/test", ["build", "build:prod"], "build:prod"),
  "build:prod",
);

assert.equal(autoPushHarborForSpringProfile("test"), false);
assert.equal(autoPushHarborForSpringProfile("TEST"), false);
assert.equal(autoPushHarborForSpringProfile("prod"), true);
assert.equal(autoPushHarborForSpringProfile("production"), true);
assert.equal(autoPushHarborForSpringProfile("dev"), null);
assert.equal(autoPushHarborForSpringProfile(""), null);

// 合并后同步打包进入分支页时，必须补拉分支列表/提交记录，否则提交区不显示
const branchPackSource = readFileSync("src/hooks/useBranchPack.ts", "utf8");
const packageFromMergeFn =
  branchPackSource.match(
    /async function packageFromMergeTarget\([\s\S]*?\n  \}\n\n  async function handleSelectRepo/,
  )?.[0] ?? "";
assert.match(
  branchPackSource,
  /preferNpmBuildScript\(value, npmScripts/,
  "handleBranchChange should prefer build:test on non-rc-master branches",
);

const gitLoadSource = readFileSync("src/hooks/branch/useBranchGitLoad.ts", "utf8");
assert.match(
  gitLoadSource,
  /preferNpmBuildScript\(/,
  "loadNpmScripts should prefer branch-based build:test / build:prod",
);

console.log("mergeSyncPackage.test.ts: ok");
