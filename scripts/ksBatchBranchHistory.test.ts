import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultKsBatchBranch,
  loadKsBatchBranchHistory,
  rememberKsBatchBranch,
} from "../src/utils/ksBatchBranchHistory.ts";

const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  },
  configurable: true,
});

test("rememberKsBatchBranch keeps recent first and dedupes", () => {
  store.clear();
  assert.deepEqual(rememberKsBatchBranch("dev"), ["dev"]);
  assert.deepEqual(rememberKsBatchBranch("test"), ["test", "dev"]);
  assert.deepEqual(rememberKsBatchBranch("dev"), ["dev", "test"]);
  assert.deepEqual(loadKsBatchBranchHistory(), ["dev", "test"]);
});

test("defaultKsBatchBranch prefers history then last_branch", () => {
  store.clear();
  assert.equal(defaultKsBatchBranch("main"), "main");
  rememberKsBatchBranch("release");
  assert.equal(defaultKsBatchBranch("main"), "release");
  store.clear();
  assert.equal(defaultKsBatchBranch(""), "");
});
