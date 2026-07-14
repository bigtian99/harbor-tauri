import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import { SearchableDropdown } from "../SearchableDropdown";
import type { HarborConfig } from "../../types";

interface QuickMergeConfigModalProps {
  config: HarborConfig;
  branchNames: string[];
  initialSource: string;
  initialTarget: string;
  onClose: () => void;
  onSaved: (source: string, target: string) => void;
}

export function QuickMergeConfigModal({ config, branchNames, initialSource, initialTarget, onClose, onSaved }: QuickMergeConfigModalProps) {
  const [sourceBranch, setSourceBranch] = useState(initialSource || "origin/rc-master");
  const [targetBranch, setTargetBranch] = useState(initialTarget || "origin/master");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!sourceBranch.trim() || !targetBranch.trim()) {
      notifications.show({ message: "源分支和目标分支不能为空", color: "red", autoClose: 3000 });
      return;
    }
    if (sourceBranch === targetBranch) {
      notifications.show({ message: "源分支和目标分支不能相同", color: "red", autoClose: 3000 });
      return;
    }
    setIsSaving(true);
    try {
      const updatedConfig = {
        ...config,
        quick_merge_source: sourceBranch.trim(),
        quick_merge_target: targetBranch.trim(),
      };
      await invoke("save_config", { config: updatedConfig });
      notifications.show({ message: "快捷模式配置已保存", color: "green", autoClose: 2000 });
      onSaved(sourceBranch.trim(), targetBranch.trim());
      onClose();
    } catch (e) {
      notifications.show({ title: "保存失败", message: String(e), color: "red", autoClose: 5000 });
    } finally {
      setIsSaving(false);
    }
  };

  // 过滤掉已选的另一个分支
  const sourceOptions = branchNames.filter((n) => n !== targetBranch);
  const targetOptions = branchNames.filter((n) => n !== sourceBranch);

  const hasLoadedBranches = branchNames.length > 0;

  return (
    <div className="commit-modal-overlay" onClick={onClose}>
      <div className="commit-modal" style={{ maxWidth: 720, width: "90%", height: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="commit-modal-header">
          <h3>配置预设分支</h3>
          <button className="commit-modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div className="merge-branch-row">
            <div className="form-group">
              <label>源分支（被合并）</label>
              <SearchableDropdown
                value={sourceBranch}
                options={sourceOptions}
                onChange={setSourceBranch}
                placeholder={hasLoadedBranches ? "选择或输入源分支..." : "输入源分支（如 origin/rc-master）"}
                disabled={false}
                commitOnInput={false}
                allowCustomValue={true}
              />
            </div>
            <div className="form-group">
              <label>目标分支（合并到此）</label>
              <SearchableDropdown
                value={targetBranch}
                options={targetOptions}
                onChange={setTargetBranch}
                placeholder={hasLoadedBranches ? "选择或输入目标分支..." : "输入目标分支（如 origin/master）"}
                disabled={false}
                commitOnInput={false}
                allowCustomValue={true}
              />
            </div>
          </div>
          <p className="template-hint" style={{ marginTop: 8, marginBottom: 0 }}>
            {hasLoadedBranches
              ? "勾选「预设分支」后，加载分支时会自动选择这两个分支，并自动开启打 tag。配置全局生效。"
              : "请手动输入分支名（如 origin/rc-master），或先在合并面板加载分支后再从下拉选择。"}
          </p>
          <button
            className="build-btn"
            onClick={handleSave}
            disabled={isSaving}
            style={{ width: "100%", marginTop: 12 }}
          >
            {isSaving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </div>
    </div>
  );
}
