import { readFileSync } from "node:fs";

function assertContains(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}`);
  }
}

const dropdownSource = readFileSync("src/components/SearchableDropdown.tsx", "utf8");
const mergeFormSource = readFileSync("src/components/merge/MergeFormSection.tsx", "utf8");

assertContains(
  dropdownSource,
  "commitOnInput",
  "SearchableDropdown should support filtering without committing typed text",
);

const branchDropdowns = mergeFormSource.match(/<SearchableDropdown[\s\S]*?\/>/g) ?? [];
const sourceBranchDropdown = branchDropdowns.find((block) => block.includes("value={sourceBranch}")) ?? "";
const targetBranchDropdown = branchDropdowns.find((block) => block.includes("value={targetBranch}")) ?? "";

assertContains(
  sourceBranchDropdown,
  "commitOnInput={false}",
  "Source branch input should filter only and commit after selecting an option",
);
assertContains(
  sourceBranchDropdown,
  "allowCustomValue={false}",
  "Source branch input should only allow existing branch options",
);
assertContains(
  targetBranchDropdown,
  "commitOnInput={false}",
  "Target branch input should filter only and commit after selecting an option",
);
assertContains(
  targetBranchDropdown,
  "allowCustomValue={false}",
  "Target branch input should only allow existing branch options",
);
