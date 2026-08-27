/**
 * 批量发布仓库路径：父目录候选应包含上一级（code/ 而非仅 tksy-middle/）
 */
import assert from "node:assert/strict";

function parentDir(p: string): string {
  const trimmed = p.trim().replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : "";
}

function collectParentCandidates(lastRepoPath: string): string[] {
  const parents = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (t) parents.add(t);
  };
  const lp = lastRepoPath.trim();
  if (lp) {
    const p1 = parentDir(lp);
    add(p1);
    if (p1) add(parentDir(p1));
  }
  return [...parents];
}

const parents = collectParentCandidates(
  "/Users/daijunxiong/code/tksy-middle/tksy-admin",
);
assert.ok(
  parents.includes("/Users/daijunxiong/code"),
  `应包含 code 根目录，实际: ${parents.join(", ")}`,
);
assert.ok(
  parents.includes("/Users/daijunxiong/code/tksy-middle"),
  `应包含 tksy-middle，实际: ${parents.join(", ")}`,
);

console.log("resolveRepoPathParents.test.ts ok");
