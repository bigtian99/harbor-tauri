import assert from "node:assert/strict";
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

console.log("mergeSyncPackage.test.ts: ok");
