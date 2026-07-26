import assert from "node:assert/strict";
import {
  mergeSyncPackageConfirmHint,
  shouldPushHarborAfterMerge,
} from "../src/mergeSyncPackage.ts";

assert.equal(shouldPushHarborAfterMerge("origin/rc-master"), true);
assert.equal(shouldPushHarborAfterMerge("feature/rc-master-hotfix"), true);
assert.equal(shouldPushHarborAfterMerge("origin/master"), false);
assert.equal(shouldPushHarborAfterMerge("origin/RC-Master"), false);
assert.match(mergeSyncPackageConfirmHint("origin/rc-master"), /Harbor/);
assert.match(mergeSyncPackageConfirmHint("origin/master"), /不推送/);

console.log("mergeSyncPackage.test.ts: ok");
