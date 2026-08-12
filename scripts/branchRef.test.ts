import assert from "node:assert/strict";
import { sanitizeBranchForImageRef } from "../src/branchRef.ts";

assert.equal(
  sanitizeBranchForImageRef("origin/rc-master"),
  "rc-master",
  "应去掉 origin/ 前缀，避免 tag 变成 origin-rc-master",
);
assert.equal(sanitizeBranchForImageRef("refs/remotes/origin/rc-master"), "rc-master");
assert.equal(sanitizeBranchForImageRef("refs/heads/develop"), "develop");
assert.equal(sanitizeBranchForImageRef("feature/login"), "feature-login");
assert.equal(sanitizeBranchForImageRef("  "), "local");
assert.equal(sanitizeBranchForImageRef("rc_master"), "rc_master");

console.log("branchRef.test.ts: ok");
