import test from "node:test";
import assert from "node:assert/strict";
import {
  appendBuildProgressLog,
  normalizeBatchBranchInput,
  parseBatchStepLabel,
  scaleBatchBuildPercent,
} from "../src/utils/buildProgressLog.ts";

test("appendBuildProgressLog appends lines", () => {
  assert.equal(appendBuildProgressLog("", "a"), "a");
  assert.equal(appendBuildProgressLog("a", "b"), "a\nb");
  assert.equal(appendBuildProgressLog("a\nb", "b"), "a\nb");
});

test("scaleBatchBuildPercent maps item progress into batch", () => {
  assert.equal(scaleBatchBuildPercent(0, 1, 50), 50);
  assert.equal(scaleBatchBuildPercent(0, 2, 100), 50);
  assert.equal(scaleBatchBuildPercent(1, 2, 0), 50);
});

test("normalizeBatchBranchInput keeps origin/ remote-tracking refs", () => {
  assert.equal(
    normalizeBatchBranchInput("origin/migrate-comic"),
    "origin/migrate-comic",
  );
  assert.equal(normalizeBatchBranchInput("  main  "), "main");
});

test("parseBatchStepLabel", () => {
  assert.deepEqual(parseBatchStepLabel("[1/3] foo"), { index: 0, total: 3 });
});
