import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPodLogLines,
  detectPodLogLevel,
  findNextLevelIndex,
} from "../src/utils/podLogLevels.ts";

test("detectPodLogLevel recognizes common levels", () => {
  assert.equal(detectPodLogLevel("2026-08-25 ERROR something"), "error");
  assert.equal(detectPodLogLevel("[WARN] slow query"), "warn");
  assert.equal(detectPodLogLevel("INFO started"), "info");
  assert.equal(detectPodLogLevel("no level here"), null);
});

test("buildPodLogLines counts and filters", () => {
  const raw = ["INFO a", "ERROR b", "WARN c", "ERROR d"].join("\n");
  const view = buildPodLogLines(raw, "");
  assert.equal(view.counts.error, 2);
  assert.equal(view.counts.warn, 1);
  assert.equal(view.counts.info, 1);
  const filtered = buildPodLogLines(raw, "error");
  assert.equal(filtered.matched, 2);
});

test("findNextLevelIndex wraps around", () => {
  const lines = buildPodLogLines("INFO\nERROR one\nWARN\nERROR two", "").lines;
  const first = findNextLevelIndex(lines, "error", -1);
  assert.equal(lines[first].text, "ERROR one");
  const second = findNextLevelIndex(lines, "error", first);
  assert.equal(lines[second].text, "ERROR two");
  const wrap = findNextLevelIndex(lines, "error", second);
  assert.equal(wrap, first);
});
