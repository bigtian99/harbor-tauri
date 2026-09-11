/**
 * 构建日志：成功后保留过程日志；UI 单滚动条。
 * 跑法：pnpm test（scripts/*.test.ts）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendPackageSummaryLog,
  isCompactSuccessLog,
} from "../src/utils/buildProgressLog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const actionSrc = readFileSync(join(root, "src/hooks/branch/branchPackageAction.ts"), "utf8");
const branchPanelSrc = readFileSync(join(root, "src/components/BranchPanel.tsx"), "utf8");
const historyPanelSrc = readFileSync(join(root, "src/components/HistoryPanel.tsx"), "utf8");

assert.doesNotMatch(
  actionSrc,
  /setLog\(`✅ 分支打包完成\\n\\n\$\{resultLog\}`\)/,
  "成功不得用 npm/mvn 原始输出覆盖过程日志",
);
assert.doesNotMatch(
  actionSrc,
  /setLog\(`✅ 分支打包并推送镜像完成\\n\\n\$\{resultLog\}`\)/,
  "推送成功不得用 packageLog 覆盖过程日志",
);
assert.match(
  actionSrc,
  /✅ 分支打包完成/,
  "成功仍应写入摘要",
);

assert.doesNotMatch(
  branchPanelSrc,
  /ScrollArea\.Autosize[\s\S]{0,120}log-panel/,
  "Branch 日志区不要套 ScrollArea（双滚动条）",
);
assert.doesNotMatch(
  historyPanelSrc,
  /ScrollArea\.Autosize[\s\S]{0,120}log-panel/,
  "History 日志区不要套 ScrollArea",
);

assert.equal(isCompactSuccessLog("✅ 分支打包完成"), true);
assert.equal(
  isCompactSuccessLog(
    ["⬇️ 校验", "🔨 npm run build:prod", "✅ 打包完成", "✅ 分支打包完成"].join("\n"),
  ),
  false,
);
assert.equal(
  appendPackageSummaryLog("⬇️ 校验\n✅ 打包完成", "✅ 分支打包完成"),
  "⬇️ 校验\n✅ 打包完成\n✅ 分支打包完成",
);

console.log("buildLogUi.test.ts: ok");
