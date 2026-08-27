import assert from "node:assert/strict";
import {
  displayBtUpdatedAt,
  formatBtUploadNow,
  getBtLastUpload,
  setBtLastUpload,
} from "../src/utils/btLastUpload.ts";

const store: Record<string, string> = {};
const ls = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
};

// @ts-expect-error test stub
globalThis.localStorage = ls;

const KEY = "jarporter.bt_last_upload.java";
store[KEY] = "{}";

assert.match(formatBtUploadNow(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

setBtLastUpload("java", "52", "2026-08-27 14:00:00");
assert.equal(getBtLastUpload("java", "52"), "2026-08-27 14:00:00");
assert.equal(
  displayBtUpdatedAt("java", "52", "2026-01-15 10:20:30"),
  "2026-08-27 14:00:00",
);
assert.equal(displayBtUpdatedAt("java", "99", "2026-01-15 10:20:30"), "2026-01-15 10:20:30");

console.log("btLastUpload.test.ts ok");
