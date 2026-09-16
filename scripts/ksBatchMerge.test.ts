/**
 * KS 批量合并：并行预检工具 + UI 不自动检查。
 * 跑法：pnpm test（scripts/*.test.ts）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const util = read("src/utils/ksBatchMerge.ts");
assert.match(util, /export async function checkKsBatchMergesParallel/);
assert.match(util, /export async function mergeKsBatchReposSequential/);
assert.match(util, /mapPool/);

const confirmModal = read("src/components/ksPublish/KsBatchConfirmModal.tsx");
assert.match(confirmModal, /mergeBeforePack/);
assert.match(confirmModal, /检查冲突/);
assert.match(confirmModal, /runMergeCheck/);
assert.match(confirmModal, /不会自动检查/);
assert.match(confirmModal, /mergePrecheckReady/);
assert.match(confirmModal, /mergeCheckDone/);
assert.match(confirmModal, /请先点击「检查冲突」完成预检后再开始/);
assert.match(confirmModal, /KsBatchMergeConflictFilesModal/);
assert.match(confirmModal, /点击查看冲突文件/);
assert.doesNotMatch(
  confirmModal,
  /useEffect\(\(\) => \{[\s\S]{0,200}checkKsBatchMergesParallel/,
  "选分支不得自动跑预检",
);

const packEntry = read("src/components/KsBatchPackModal.tsx");
assert.match(packEntry, /export \{ KsBatchConfirmModal \}/);
assert.match(packEntry, /export \{ KsBatchProgressModal \}/);

const panel = read("src/components/KsPublishPanel.tsx");
assert.match(panel, /useKsBatchActions/);
assert.match(panel, /mergeRepoPaths=\{batch\.batchMergeRepoPaths\}/);

const batchHook = read("src/components/ksPublish/useKsBatchActions.ts");
assert.match(batchHook, /mergeKsBatchReposSequential/);
assert.match(batchHook, /values\.mergeBeforePack/);

const cloneModal = read("src/components/KsBatchCloneModal.tsx");
assert.match(cloneModal, /restoreSourceSession/);
assert.match(cloneModal, /拉完目标 ns 后立刻回到源环境/);

/** 内联验证限并发池保序 */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => runOne()));
  return results;
}

const results = await mapPool([1, 2, 3, 4], 2, async (n) => n * 2);
assert.deepEqual(results, [2, 4, 6, 8]);

console.log("ksBatchMerge.test.ts: ok");
