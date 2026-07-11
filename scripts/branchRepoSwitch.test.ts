import { readFileSync } from "node:fs";

function assertContains(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}`);
  }
}

// 前端重构后：repo 切换/加载竞态在 useBranchPack；repo picker UI 仍在 BranchPanel
const appSource = readFileSync("src/App.tsx", "utf8");
const branchPanelSource = readFileSync("src/components/BranchPanel.tsx", "utf8");
const branchPackSource = readFileSync("src/hooks/useBranchPack.ts", "utf8");

const repoDropdown =
  branchPanelSource.match(/<SearchableDropdown[\s\S]*?placeholder="输入 Git 地址或选择本地目录"[\s\S]*?\/>/)?.[0] ?? "";

assertContains(
  repoDropdown,
  "commitOnInput={false}",
  "Git repo picker should not switch repositories while the user is only filtering or typing",
);
assertContains(
  repoDropdown,
  "onBlur={onRepoPathChange}",
  "Git repo picker should commit manually typed paths when the input loses focus",
);
assertContains(
  branchPackSource,
  "branchLoadRequestRef",
  "Branch loading should track request order when switching repositories",
);
assertContains(
  branchPackSource,
  "isStaleBranchLoad(requestId)",
  "Branch loading should ignore stale results from previously selected repositories",
);
assertContains(
  branchPackSource,
  "setBranchOptions([])",
  "Switching repositories should clear old branch options before loading the new repository",
);
// App 仍挂载 BranchPanel
assertContains(appSource, "<BranchPanel", "App should render BranchPanel");
