import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tabs } from "@mantine/core";
import {
  Settings, CheckCircle, Server, Package, Globe, FolderOutput, Info,
} from "lucide-react";
import type { HarborConfig } from "../types";
import { BaotaIcon, KubeSphereIcon } from "./icons/BrandIcons";
import { PanelPageHeader } from "./PanelPageHeader";
import { ConfigHarborSection } from "./config/ConfigHarborSection";
import { ConfigJarSection } from "./config/ConfigJarSection";
import { ConfigFrontendSection } from "./config/ConfigFrontendSection";
import { ConfigBtSection } from "./config/ConfigBtSection";
import { ConfigOutputSection } from "./config/ConfigOutputSection";
import { ConfigKsSection } from "./config/ConfigKsSection";
import {
  ConfigAboutSection,
  type CheckUpdateResult,
} from "./config/ConfigAboutSection";

export type { CheckUpdateResult };

export type ConfigTab = "connection" | "jar" | "frontend" | "bt" | "output" | "ks" | "about";

interface ConfigPanelProps {
  config: HarborConfig;
  configSaved: boolean;
  showPassword: boolean;
  onConfigChange: (
    field: keyof HarborConfig,
    value:
      | HarborConfig[keyof HarborConfig]
      | ((prev: HarborConfig[keyof HarborConfig]) => HarborConfig[keyof HarborConfig]),
  ) => void;
  onSaveConfig: () => void;
  onTogglePassword: () => void;
  /** 当前应用版本（Cargo） */
  appVersion?: string;
  /** 手动检查更新 */
  onCheckUpdate?: () => Promise<CheckUpdateResult>;
  /** 清空 Git 本地记录（路径历史与分支记忆） */
  onClearGitRecords?: () => Promise<boolean>;
  /** 外部指定初始子页签（如从打包页跳转配置 Maven） */
  initialSubTab?: ConfigTab;
}

const TABS: { key: ConfigTab; label: string; icon: ReactNode }[] = [
  { key: "connection", label: "Harbor 连接", icon: <Server size={14} /> },
  { key: "jar", label: "JAR 打包", icon: <Package size={14} /> },
  { key: "frontend", label: "前端打包", icon: <Globe size={14} /> },
  { key: "bt", label: "宝塔部署", icon: <BaotaIcon size={14} /> },
  { key: "output", label: "输出设置", icon: <FolderOutput size={14} /> },
  { key: "ks", label: "KubeSphere", icon: <KubeSphereIcon size={14} /> },
  { key: "about", label: "关于", icon: <Info size={14} /> },
];

export function ConfigPanel({
  config, configSaved, showPassword,
  onConfigChange, onSaveConfig, onTogglePassword,
  appVersion, onCheckUpdate, onClearGitRecords,
  initialSubTab,
}: ConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>(initialSubTab || "connection");
  const flushKsMapsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (initialSubTab) setActiveTab(initialSubTab);
  }, [initialSubTab]);

  const handleSaveConfig = () => {
    flushKsMapsRef.current?.();
    void onSaveConfig();
  };

  return (
    <div className="config-shell">
      <div className="config-panel-body">
      <div className="config-panel" style={{ display: "flex", flexDirection: "column", gap: "var(--mantine-spacing-md)" }}>
      <PanelPageHeader
        eyebrow="HARBOR · BAOTA · KUBESPHERE"
        title="设置"
        sub="配置 Harbor、宝塔、KubeSphere 等连接与偏好"
      />
      <Tabs
        value={activeTab}
        onChange={(value) => {
          if (value) setActiveTab(value as ConfigTab);
        }}
        color="cyan"
        classNames={{ list: "config-tabs-list" }}
        styles={{
          list: {
            flexWrap: "wrap",
            gap: "2px 4px",
            padding: "0 0 2px",
            marginBottom: 0,
            borderBottom: "none",
          },
          tab: {
            color: "var(--color-text-muted)",
            fontSize: 12,
            fontWeight: 500,
            padding: "6px 10px",
            minHeight: 32,
            "&[data-active]": {
              color: "var(--color-primary-hover)",
              borderColor: "var(--color-primary)",
              background: "transparent",
            },
            "&:hover:not([data-active])": {
              color: "var(--color-text)",
              background: "var(--color-primary-subtle)",
            },
          },
        }}
      >
        <div className="config-toolbar">
        <Tabs.List>
          {TABS.map(({ key, label, icon }) => (
            <Tabs.Tab key={key} value={key} leftSection={icon}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        </div>

        <Tabs.Panel value="connection" pt="md">
          <ConfigHarborSection
            config={config}
            showPassword={showPassword}
            onConfigChange={onConfigChange}
            onTogglePassword={onTogglePassword}
          />
        </Tabs.Panel>

        <Tabs.Panel value="ks" pt="md">
          <ConfigKsSection
            config={config}
            onConfigChange={onConfigChange}
            onSaveConfig={handleSaveConfig}
            onRegisterFlush={(flush) => {
              flushKsMapsRef.current = flush;
            }}
          />
        </Tabs.Panel>

        <Tabs.Panel value="jar" pt="md">
          <ConfigJarSection
            config={config}
            onConfigChange={onConfigChange}
          />
        </Tabs.Panel>

        <Tabs.Panel value="bt" pt="md">
          <ConfigBtSection
            config={config}
            showPassword={showPassword}
            onConfigChange={onConfigChange}
            onTogglePassword={onTogglePassword}
          />
        </Tabs.Panel>

        <Tabs.Panel value="frontend" pt="md">
          <ConfigFrontendSection
            config={config}
            onConfigChange={onConfigChange}
          />
        </Tabs.Panel>

        <Tabs.Panel value="output" pt="md">
          <ConfigOutputSection
            config={config}
            onConfigChange={onConfigChange}
          />
        </Tabs.Panel>

        <Tabs.Panel value="about" pt="md">
          <ConfigAboutSection
            config={config}
            appVersion={appVersion}
            onCheckUpdate={onCheckUpdate}
            onClearGitRecords={onClearGitRecords}
          />
        </Tabs.Panel>
      </Tabs>
      </div>
      </div>
      {activeTab !== "about" && (
        <div className="config-save-bar">
          <Button
            className="config-save-btn"
            onClick={handleSaveConfig}
            variant="filled"
            color="blue"
            data-saved={configSaved || undefined}
            leftSection={configSaved ? <CheckCircle size={16} /> : <Settings size={16} />}
            size="compact-sm"
            radius="md"
          >
            {configSaved ? "已保存" : "保存配置"}
          </Button>
        </div>
      )}
    </div>
  );
}
