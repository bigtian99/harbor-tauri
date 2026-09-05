/**
 * 配置落盘竞态回归：改完立刻 save / 局部快照写盘不得冲掉其它字段。
 * 跑法：pnpm test（scripts/*.test.ts）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appConfig = readFileSync("src/hooks/useAppConfig.ts", "utf8");
const branchPack = readFileSync("src/hooks/useBranchPack.ts", "utf8");
const branchAction = readFileSync("src/hooks/branch/branchPackageAction.ts", "utf8");
const quickMerge = readFileSync("src/components/merge/QuickMergeConfigModal.tsx", "utf8");
const cloneDeploy = readFileSync("src/utils/ksBatchCloneDeploy.ts", "utf8");
const ksPublish = readFileSync("src/components/KsPublishPanel.tsx", "utf8");
const configPanel = readFileSync("src/components/ConfigPanel.tsx", "utf8");

describe("config snapshot save races", () => {
  it("setConfig 同步写 configRef，避免改完立刻 save 丢字段", () => {
    assert.match(appConfig, /configRef\.current = next/);
    assert.match(appConfig, /getConfigSnapshot/);
    assert.match(appConfig, /同步写 configRef/);
  });

  it("handleSaveConfig 在 load 回读前检查快照未漂移", () => {
    assert.match(appConfig, /configRef\.current !== snapshot/);
    assert.match(appConfig, /load 等待期间又有编辑/);
  });

  it("保存失败留在设置页并通知，不跳上传", () => {
    assert.match(appConfig, /保存配置失败/);
    assert.match(appConfig, /setActiveTab\("config"\)/);
    assert.doesNotMatch(appConfig, /setActiveTab\("upload"\)/);
  });

  it("分支打包局部写盘优先 getConfigSnapshot", () => {
    assert.ok(branchPack.includes("getConfigSnapshot?.() ?? config"));
    assert.ok(branchAction.includes("getConfigSnapshot?.() ?? config"));
    assert.match(branchAction, /setConfig\(updatedConfig\);\s*await invoke\("save_config"/);
    assert.doesNotMatch(branchPack, /\.then\(\(\) => \{\s*setConfig\(updatedConfig\)/);
  });

  it("快捷合并 / 批量复制先写内存再按快照落盘", () => {
    assert.ok(quickMerge.includes("onSaved(source, target)"));
    assert.ok(quickMerge.includes("getConfigSnapshot?.()"));
    assert.ok(cloneDeploy.includes("onMapsSaved?.(maps)"));
    assert.ok(cloneDeploy.includes("getConfigSnapshot?.()"));
    assert.ok(ksPublish.includes("getConfigSnapshot"));
  });

  it("KS 环境校验失败有提示；发布页只对当前环境凭证重连", () => {
    assert.match(configPanel, /无法保存环境/);
    assert.match(ksPublish, /currentCredFp/);
    assert.match(ksPublish, /selectedEnv\.password/);
  });
});
