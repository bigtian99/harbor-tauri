import test from "node:test";
import assert from "node:assert/strict";
import { sortDeploysByUpdatedDesc } from "../src/utils/ksDeploySort.ts";

function dep(name: string, updatedAt?: string) {
  return { name, alias: "", image: "", containers: [], ports: [], status: { state: "running", label: "", detail: "" }, pods: { new: [], old: [] }, revision: "", updatedAt } as never;
}

test("按更新时间倒序，最新在前", () => {
  const list = [
    dep("a", "2026-01-01T00:00:00Z"),
    dep("b", "2026-03-01T00:00:00Z"),
    dep("c", "2026-02-01T00:00:00Z"),
  ];
  assert.deepEqual(sortDeploysByUpdatedDesc(list).map((d) => d.name), ["b", "c", "a"]);
});

test("无时间/非法时间排最后，同时间按名称升序", () => {
  const list = [
    dep("z", ""),
    dep("m", "not-a-date"),
    dep("b", "2026-03-01T00:00:00Z"),
    dep("a", "2026-03-01T00:00:00Z"),
  ];
  assert.deepEqual(sortDeploysByUpdatedDesc(list).map((d) => d.name), ["a", "b", "m", "z"]);
});

test("不修改原数组", () => {
  const list = [dep("a", "2026-01-01T00:00:00Z"), dep("b", "2026-02-01T00:00:00Z")];
  sortDeploysByUpdatedDesc(list);
  assert.deepEqual(list.map((d) => d.name), ["a", "b"]);
});
