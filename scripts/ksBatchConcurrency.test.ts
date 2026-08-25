import test from "node:test";
import assert from "node:assert/strict";

/** 与 ksBatchPackPublish.recommendKsBatchConcurrency 保持一致（避免拉 Tauri） */
function recommend(input: {
  itemCount: number;
  uniqueRepoCount?: number;
  cpuCores?: number;
  max?: number;
}): number {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  if (itemCount <= 0) return 1;
  const max = Math.max(1, input.max ?? 4);
  const cores = Math.max(1, Math.floor(input.cpuCores ?? 4));
  const byCpu = Math.max(1, Math.min(max, Math.floor(cores / 2)));
  const uniqueRepos = Math.max(1, Math.floor(input.uniqueRepoCount ?? itemCount));
  return Math.max(1, Math.min(max, byCpu, itemCount, uniqueRepos));
}

test("recommend scales with cpu cores", () => {
  assert.equal(recommend({ itemCount: 10, cpuCores: 2 }), 1);
  assert.equal(recommend({ itemCount: 10, cpuCores: 4 }), 2);
  assert.equal(recommend({ itemCount: 10, cpuCores: 8 }), 4);
  assert.equal(recommend({ itemCount: 10, cpuCores: 16 }), 4);
});

test("recommend capped by item and unique repo count", () => {
  assert.equal(recommend({ itemCount: 1, cpuCores: 16 }), 1);
  assert.equal(recommend({ itemCount: 5, uniqueRepoCount: 2, cpuCores: 16 }), 2);
});
