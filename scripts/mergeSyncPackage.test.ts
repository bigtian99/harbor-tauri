import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildScriptAfterMerge,
  mergeSyncPackageConfirmHint,
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

// 合并后同步打包进入分支页时，必须补拉分支列表/提交记录，否则提交区不显示
const branchPackSource = readFileSync("src/hooks/useBranchPack.ts", "utf8");
const packageFromMergeFn =
  branchPackSource.match(
    /async function packageFromMergeTarget\([\s\S]*?\n  \}\n\n  async function handleSelectRepo/,
  )?.[0] ?? "";
assert.match(
  packageFromMergeFn,
  /loadGitBranches\(\s*path,\s*branch\s*\)/,
  "packageFromMergeTarget should loadGitBranches(path, branch) so commit UI is populated",
);

console.log("mergeSyncPackage.test.ts: ok");
