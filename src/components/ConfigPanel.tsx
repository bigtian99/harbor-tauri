import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings, CheckCircle, AlertCircle, FolderOpen, Archive, FolderOutput,
  Info, RefreshCw, Loader2, ExternalLink, Bell,
} from "lucide-react";
import { showSystemAlert } from "../systemAlert";
import type { HarborConfig } from "../types";
import { isTauriRuntime } from "../types";
import { openReleasePage } from "../utils/releasePage";
import "./Modal.css";

export type CheckUpdateResult = {
  status: "update" | "latest" | "error";
  message: string;
};

export type ConfigTab = "output" | "about";

interface ConfigPanelProps {
  config: HarborConfig;
  configSaved: boolean;
  onConfigChange: (
    field: keyof HarborConfig,
    value:
      | HarborConfig[keyof HarborConfig]
      | ((prev: HarborConfig[keyof HarborConfig]) => HarborConfig[keyof HarborConfig]),
  ) => void;
  onSaveConfig: () => void;
  /** 当前应用版本（Cargo） */
  appVersion?: string;
  /** 手动检查更新 */
  onCheckUpdate?: () => Promise<CheckUpdateResult>;
  /** 外部指定初始子页签 */
  initialSubTab?: ConfigTab;
}

const TABS: { key: ConfigTab; label: string; icon: React.ReactNode }[] = [
  { key: "output", label: "输出设置", icon: <FolderOutput size={14} /> },
  { key: "about", label: "关于", icon: <Info size={14} /> },
];

export function ConfigPanel({
  config, configSaved,
  onConfigChange, onSaveConfig,
  appVersion, onCheckUpdate,
  initialSubTab,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>(initialSubTab || "output");

  useEffect(() => {
    if (initialSubTab) setActiveTab(initialSubTab);
  }, [initialSubTab]);

  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ type: "ok" | "update" | "err"; text: string } | null>(null);

  const handleCheckUpdate = async () => {
    if (!onCheckUpdate || checking) return;
    setChecking(true);
    setCheckMsg(null);
    try {
      const r = await onCheckUpdate();
      if (r.status === "update") setCheckMsg({ type: "update", text: r.message });
      else if (r.status === "latest") setCheckMsg({ type: "ok", text: r.message });
      else setCheckMsg({ type: "err", text: r.message });
    } catch (e) {
      setCheckMsg({ type: "err", text: String(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="config-panel">
      <div className="config-subtabs" role="tablist">
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={`config-subtab ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="config-tab-panel">
        {activeTab === "output" && (
          <div className="form-group">
            <label><Archive size={14} /> 打包产物目录</label>
            <div className="path-picker-row">
              <input
                type="text"
                value={config.artifact_output_dir}
                onChange={(e) => onConfigChange("artifact_output_dir", e.target.value)}
                placeholder="默认: 桌面"
              />
              <button
                type="button"
                className="path-picker-btn"
                onClick={async () => {
                  if (!isTauriRuntime()) {
                    return;
                  }
                  try {
                    const selected = await open({
                      multiple: false,
                      directory: true,
                      recursive: false,
                      title: "选择打包产物输出目录",
                    });
                    if (selected) {
                      onConfigChange("artifact_output_dir", selected as string);
                    }
                  } catch (e) {
                    console.error("选择目录失败:", e);
                  }
                }}
              >
                <FolderOpen size={16} /> 选择
              </button>
            </div>
            <p className="template-hint">打包产物将自动复制到此目录，留空则不复制</p>
          </div>
        )}

        {activeTab === "about" && (
          <div className="about-panel">
            <div className="about-card">
              <div className="about-app-name">JarPorter</div>
              <div className="about-version">
                当前版本 <strong>v{appVersion || "—"}</strong>
              </div>
              <p className="about-desc">运营工具：落地页 / 隐私协议 / 结算单 / 打包加速</p>

              <div className="about-actions">
                <button
                  type="button"
                  className="about-check-btn"
                  onClick={handleCheckUpdate}
                  disabled={checking || !onCheckUpdate}
                >
                  {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  {checking ? "检查中…" : "检查更新"}
                </button>
                <button
                  type="button"
                  className="about-link"
                  onClick={() => {
                    void openReleasePage().catch((e) => {
                      void showSystemAlert("无法打开发布页", String(e));
                    });
                  }}
                >
                  发布页
                  <ExternalLink size={12} />
                </button>
              </div>

              {checkMsg && (
                <div className={`about-check-msg about-check-msg--${checkMsg.type}`}>
                  {checkMsg.type === "ok" && <CheckCircle size={14} />}
                  {checkMsg.type === "update" && <RefreshCw size={14} />}
                  {checkMsg.type === "err" && <AlertCircle size={14} />}
                  <span>{checkMsg.text}</span>
                </div>
              )}
            </div>

            <div className="about-card about-data-card">
              <div className="about-data-title">系统通知测试</div>
              <p className="about-data-desc">
                点击发送一条测试通知，验证 macOS 通知中心是否正常工作。若无弹出，请前往
                「系统设置 → 通知 → JarPorter」开启允许通知。
              </p>
              <div className="about-actions">
                <button
                  type="button"
                  className="about-check-btn"
                  onClick={() => void showSystemAlert("测试通知", "JarPorter 系统通知正常 ✅")}
                >
                  <Bell size={16} />
                  发送测试通知
                </button>
              </div>
            </div>

            <div className="config-tip">
              <p><AlertCircle size={16} className="inline-icon" /> 配置说明：</p>
              <ul>
                <li>配置保存后无需重复填写</li>
                <li>打包产物目录留空则不复制产物</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {activeTab !== "about" && (
        <button className="save-btn" onClick={onSaveConfig}>
          {configSaved ? (
            <>
              <CheckCircle size={18} /> 已保存
            </>
          ) : (
            <>
              <Settings size={18} /> 保存配置
            </>
          )}
        </button>
      )}
    </div>
  );
}
