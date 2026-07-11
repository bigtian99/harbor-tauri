import { readFileSync } from "node:fs";
import {
  classifyCommitDiffLine,
  getCommitDiffChangeRefs,
  getCommitDiffFileTree,
  parseCommitDiffFiles,
} from "../src/commitDiff.ts";

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
  }
}

function assertContains(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}`);
  }
}

function assertNotContains(source: string, unexpected: string, message: string) {
  if (source.includes(unexpected)) {
    throw new Error(`${message}\nUnexpected: ${unexpected}`);
  }
}

function assertBefore(source: string, first: string, second: string, message: string) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    throw new Error(`${message}\nExpected "${first}" before "${second}"`);
  }
}

assertEqual(classifyCommitDiffLine("diff --git a/src/App.tsx b/src/App.tsx"), "file", "git diff header should be a file line");
assertEqual(classifyCommitDiffLine("@@ -1,2 +1,3 @@"), "hunk", "hunk header should be highlighted separately");
assertEqual(classifyCommitDiffLine("+const added = true;"), "addition", "added source lines should be highlighted as additions");
assertEqual(classifyCommitDiffLine("-const removed = true;"), "deletion", "removed source lines should be highlighted as deletions");
assertEqual(classifyCommitDiffLine("+++ b/src/App.tsx"), "meta", "new-file marker should stay metadata, not an added line");
assertEqual(classifyCommitDiffLine("--- a/src/App.tsx"), "meta", "old-file marker should stay metadata, not a deleted line");

const parsed = parseCommitDiffFiles(`diff --git a/src/App.tsx b/src/App.tsx
index 1111111..2222222 100644
--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,3 +1,3 @@
 const keep = true;
-const oldValue = 1;
+const newValue = 2;
diff --git a/src/types.ts b/src/types.ts
index 3333333..4444444 100644
--- a/src/types.ts
+++ b/src/types.ts
@@ -5,2 +5,3 @@
 export interface A {}
+export interface B {}
`);

assertEqual(parsed.length, 2, "commit diff parser should keep separate sections for multiple files");
assertEqual(parsed[0].path, "src/App.tsx", "first parsed file path should come from patch metadata");
assertEqual(parsed[0].lines.length, 3, "first file should include only code lines, not git metadata");
assertEqual(parsed[0].lines[0].text, "const keep = true;", "context lines should drop the unified-diff leading space");
assertEqual(parsed[0].lines[1].kind, "deletion", "deleted code line should be kept as code");
assertEqual(parsed[0].lines[1].text, "const oldValue = 1;", "deleted code line should drop the unified-diff minus marker");
assertEqual(parsed[0].lines[2].kind, "addition", "added code line should be kept as code");
assertEqual(parsed[0].lines[2].text, "const newValue = 2;", "added code line should drop the unified-diff plus marker");
assertEqual(parsed[1].path, "src/types.ts", "second parsed file should be preserved");
assertEqual(parsed.some((file) => file.lines.some((line) => line.text.includes("diff --git") || line.text.includes("@@") || line.text.includes("index "))), false, "parsed code lines should not expose git metadata");

const changeRefs = getCommitDiffChangeRefs(parsed);
assertEqual(changeRefs.length, 2, "change navigation should jump by contiguous change blocks, not every changed line");
assertEqual(changeRefs[0].fileIndex, 0, "first change should start in the first file");
assertEqual(changeRefs[0].lineIndex, 1, "first change block should point to the first changed line");
assertEqual(changeRefs[1].fileIndex, 1, "second change block should continue into the second file");

const fileTree = getCommitDiffFileTree([
  { path: "src/components/App.tsx", lines: [] },
  { path: "src/types.ts", lines: [] },
  { path: "src/components/Button.tsx", lines: [] },
  { path: "README.md", lines: [] },
]);
assertEqual(fileTree.length, 2, "file menu should render a root-level file and one top-level directory");
assertEqual(fileTree[0].name, "README.md", "root-level files should stay at the tree root");
assertEqual(fileTree[0].fileIndex, 3, "file tree leaves should keep their original file index for scrolling");
assertEqual(fileTree[1].name, "src", "same top-level directory should appear once in the tree");
assertEqual(fileTree[1].children?.length, 2, "top-level directory should contain nested dirs and files");
assertEqual(fileTree[1].children?.[0].name, "components", "nested directories should render as tree nodes");
assertEqual(fileTree[1].children?.[0].children?.[0].name, "App.tsx", "tree leaves should show only the file name");
assertEqual(fileTree[1].children?.[0].children?.[1].fileIndex, 2, "nested leaves should keep their original file index");
assertEqual(fileTree[1].children?.[1].path, "src/types.ts", "direct child files should keep full paths for titles");

const mergePanelSource = [
  readFileSync("src/components/MergePanel.tsx", "utf8"),
  readFileSync("src/components/merge/useMergePanel.ts", "utf8"),
  readFileSync("src/components/merge/CommitDiffModal.tsx", "utf8"),
  readFileSync("src/components/merge/utils.tsx", "utf8"),
].join("\n");
const libSource = readFileSync("src-tauri/src/lib.rs", "utf8");
const commitSource = readFileSync("src-tauri/src/commit.rs", "utf8");
const typesSource = readFileSync("src/types.ts", "utf8");

assertContains(typesSource, "CommitDiffResult", "Frontend types should expose the commit diff result returned by Tauri");
assertContains(mergePanelSource, 'invoke<CommitDiffResult>("get_commit_diff"', "Merge panel should load a clicked commit diff through Tauri");
assertContains(mergePanelSource, "commit-diff-modal", "Merge panel should render the diff in a modal");
assertContains(mergePanelSource, "parseCommitDiffFiles", "Merge panel should render parsed code-only diff files");
assertContains(mergePanelSource, "getCommitDiffChangeRefs", "Merge panel should compute code change jump targets");
assertContains(mergePanelSource, "getCommitDiffFileTree", "Merge panel should compute a directory tree for the file menu");
assertContains(mergePanelSource, "scrollCommitDiffFile", "Merge panel should let the file menu jump to a file block");
assertContains(mergePanelSource, "commit-diff-file-menu", "Merge panel should render a left file menu");
assertContains(mergePanelSource, "commit-diff-file-tree", "Merge panel should render the file menu as a tree");
assertContains(mergePanelSource, "commit-diff-file-tree-dir", "Merge panel should show directory nodes in the file tree");
assertContains(mergePanelSource, "commit-diff-file-tree-file", "Merge panel should show concrete file leaves in the file tree");
assertContains(mergePanelSource, "collapsedCommitDiffDirs", "Merge panel should track collapsed diff tree directories");
assertContains(mergePanelSource, "toggleCommitDiffTreeDir", "Merge panel should toggle a directory node when clicked");
assertContains(mergePanelSource, "aria-expanded={!isCollapsed}", "Diff tree directories should expose their expanded state");
assertContains(mergePanelSource, "commit-diff-file-tree-dir--collapsed", "Diff tree directories should have a collapsed visual state");
assertContains(mergePanelSource, "commit-diff-file-tree-children", "Diff tree should hide or show child nodes per directory");
assertContains(mergePanelSource, "jumpCommitDiffChange", "Merge panel should expose previous/next jump behavior");
assertContains(mergePanelSource, "commit-diff-jump-btn", "Merge panel should render previous and next jump buttons");
assertBefore(mergePanelSource, 'className="commit-diff-summary"', 'className="commit-diff-jump-actions"', "Diff jump buttons should sit below the commit summary instead of in the modal title bar");
assertContains(mergePanelSource, "commit-diff-file", "Merge panel should render multiple files separately");
assertNotContains(mergePanelSource, "classifyCommitDiffLine", "Merge panel should not render raw git metadata lines");
assertNotContains(mergePanelSource, "commit-diff-line-number", "Merge panel should not show synthetic raw diff line numbers");
assertContains(commitSource, "pub async fn get_commit_diff", "Rust backend should expose a get_commit_diff command");
assertContains(commitSource, '"show"', "Rust backend should call git show");
assertContains(commitSource, '"--format="', "Rust backend should omit commit header from raw diff output");
assertContains(commitSource, '"--find-renames"', "Rust backend should ask git show to detect renamed files");
assertContains(commitSource, '"--patch"', "Rust backend should include patch output");
assertNotContains(commitSource, '"--stat"', "Rust backend should not include git stat metadata in commit diff output");
assertContains(libSource, "get_commit_diff", "Tauri should register the get_commit_diff command");
