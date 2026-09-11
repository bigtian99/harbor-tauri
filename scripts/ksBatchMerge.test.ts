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

const modal = read("src/components/KsBatchPackModal.tsx");
assert.match(modal, /mergeBeforePack/);
assert.match(modal, /检查冲突/);
assert.match(modal, /runMergeCheck/);
assert.match(modal, /不会自动检查/);
assert.match(modal, /mergePrecheckReady/);
assert.match(modal, /mergeCheckDone/);
assert.match(modal, /请先点击「检查冲突」完成预检后再开始/);
assert.match(modal, /KsBatchMergeConflictFilesModal/);
assert.match(modal, /点击查看冲突文件/);
assert.doesNotMatch(
  modal,
  /useEffect\(\(\) => \{[\s\S]{0,200}checkKsBatchMergesParallel/,
  "选分支不得自动跑预检",
);

const panel = read("src/components/KsPublishPanel.tsx");
assert.match(panel, /mergeKsBatchReposSequential/);
assert.match(panel, /values\.mergeBeforePack/);
assert.match(panel, /mergeRepoPaths=\{batchMergeRepoPaths\}/);

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
