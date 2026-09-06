import assert from "node:assert/strict";
import {
  nextRepoPathHistory,
  prependPathHistory,
  shouldApplyLoadSeq,
} from "../src/hooks/branch/pathHistory.ts";

assert.deepEqual(prependPathHistory(["/a", "/b"], "/c"), ["/c", "/a", "/b"]);
assert.deepEqual(prependPathHistory(["/a", "/b"], "/b"), ["/b", "/a"]);
assert.equal(nextRepoPathHistory(["/a", "/b"], "/a"), null);
assert.deepEqual(nextRepoPathHistory(["/a", "/b"], "/b"), ["/b", "/a"]);
assert.equal(nextRepoPathHistory(["/a"], "  "), null);
assert.equal(shouldApplyLoadSeq(3, 3), true);
assert.equal(shouldApplyLoadSeq(2, 3), false);
console.log("pathHistory.test.ts OK");
