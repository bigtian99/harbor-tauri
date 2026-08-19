import test from "node:test";
import assert from "node:assert/strict";

import { shouldKeepPreviewServer } from "../src/utils/previewLifecycle.ts";

test("keeps preview server alive for landing and privacy tabs only", () => {
  assert.equal(shouldKeepPreviewServer("landing"), true);
  assert.equal(shouldKeepPreviewServer("privacy"), true);

  assert.equal(shouldKeepPreviewServer("upload"), false);
  assert.equal(shouldKeepPreviewServer("branch"), false);
  assert.equal(shouldKeepPreviewServer("history"), false);
  assert.equal(shouldKeepPreviewServer(undefined), false);
});
