import assert from "node:assert/strict";
import { filterSearchableDropdownOptions } from "../src/searchableDropdownFilter.ts";

const branches = [
  "origin/master",
  "origin/rc-master",
  "origin/feature/ad",
  "origin/hotfix/login",
];

assert.deepEqual(
  filterSearchableDropdownOptions(branches, "origin/rc-master", false),
  branches,
  "展开下拉且尚未改字时，应列出全部选项，不能用当前选中值过滤",
);

assert.deepEqual(
  filterSearchableDropdownOptions(branches, "rc-master", true),
  ["origin/rc-master"],
);

assert.deepEqual(
  filterSearchableDropdownOptions(branches, "", true),
  branches,
);

console.log("searchableDropdownFilter.test.ts OK");
