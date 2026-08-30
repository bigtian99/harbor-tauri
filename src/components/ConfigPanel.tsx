import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  PasswordInput,
} from "@mantine/core";
import {
  Settings, CheckCircle, AlertCircle, FolderOpen, Archive,
  Server, Package, Globe, FolderOutput, Info, RefreshCw, Loader2, ExternalLink, Trash2,
  CloudUpload, Bell, Plus, Pencil, Copy,
} from "lucide-react";
import { showSystemAlert } from "../systemAlert";
import type { HarborConfig, KsEnvironment } from "../types";
import { isTauriRuntime } from "../types";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { createKsEnvironment, resolveKsEnvironments } from "../utils/ksEnvironments";
import {
  fetchBtTempLogin,
  loadBtTempLoginOpenPref,
  saveBtTempLoginOpenPref,
} from "../utils/btTempLogin";
import {
  deriveMavenLocalRepo,
  isDerivedMavenLocalRepo,
} from "../utils/mavenPaths";
import { openReleasePage } from "../utils/releasePage";
import { KsPublishMapEditor } from "./KsPublishMapEditor";

export type CheckUpdateResult = {
  status: "update" | "latest" | "error";
  message: string;
};

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

const TABS: { key: ConfigTab; label: string; icon: React.ReactNode }[] = [
  { key: "connection", label: "Harbor 连接", icon: <Server size={14} /> },
  { key: "jar", label: "JAR 打包", icon: <Package size={14} /> },
  { key: "frontend", label: "前端打包", icon: <Globe size={14} /> },
  { key: "bt", label: "宝塔部署", icon: <CloudUpload size={14} /> },
  { key: "output", label: "输出设置", icon: <FolderOutput size={14} /> },
  { key: "ks", label: "KubeSphere", icon: <CloudUpload size={14} /> },
  { key: "about", label: "关于", icon: <Info size={14} /> },
];

const fieldStyles = {
  label: { color: "var(--color-text)", fontWeight: 600 },
  description: { color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" },
  input: {
    backgroundColor: "var(--color-bg-elevated)",
    borderColor: "var(--color-border-strong)",
    color: "var(--color-text)",
  },
};

const panelPaperProps = {
  p: "md" as const,
  radius: "md" as const,
  withBorder: true as const,
  style: {
    background: "var(--color-bg-card)",
    borderColor: "var(--color-border)",
  },
};

const sectionCardStyle = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
} as const;

const browseButtonProps = {
  size: "compact-xs" as const,
  variant: "default" as const,
  leftSection: <FolderOpen size={14} />,
};

export function ConfigPanel({
  config, configSaved, showPassword,
  onConfigChange, onSaveConfig, onTogglePassword,
  appVersion, onCheckUpdate, onClearGitRecords,
  initialSubTab,
}: ConfigPanelProps) {
  const { confirm } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<ConfigTab>(initialSubTab || "connection");

  useEffect(() => {
    if (initialSubTab) setActiveTab(initialSubTab);
  }, [initialSubTab]);

  const applyMavenHome = (home: string) => {
    const nextHome = home.trim();
    const currentRepo = (config.maven_local_repo ?? "").trim();
    const currentHome = (config.maven_home ?? "").trim();
    onConfigChange("maven_home", nextHome);
    if (
      nextHome
      && isDerivedMavenLocalRepo(currentHome, currentRepo)
    ) {
      onConfigChange("maven_local_repo", deriveMavenLocalRepo(nextHome));
    }
  };
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ type: "ok" | "update" | "err"; text: string } | null>(null);
  const [clearingGit, setClearingGit] = useState(false);
  const [gitClearMsg, setGitClearMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [envEditor, setEnvEditor] = useState<{ mode: "add" | "edit"; draft: KsEnvironment } | null>(null);
  const [envEditorPassword, setEnvEditorPassword] = useState(false);
  const [tempLoginLoading, setTempLoginLoading] = useState(false);
  const [tempLoginOpenInBrowser, setTempLoginOpenInBrowser] = useState(
    () => loadBtTempLoginOpenPref(),
  );
  const flushKsMapsRef = useRef<(() => void) | null>(null);

  const handleSaveConfig = () => {
    flushKsMapsRef.current?.();
    void onSaveConfig();
  };

  const gitRecordCount =
    (config.repo_path_history?.length ?? 0) + Object.keys(config.branch_repo_settings ?? {}).length;
  const hasGitRecords = Boolean(
    gitRecordCount > 0 ||
    config.last_repo_path?.trim() ||
    config.last_branch?.trim() ||
    config.last_frontend_dir?.trim() ||
    config.last_build_script?.trim() ||
    config.last_spring_profile?.trim() ||
    config.last_expose_port?.trim(),
  );

  const handleClearGitRecords = async () => {
    if (!onClearGitRecords || clearingGit) return;
    setClearingGit(true);
    setGitClearMsg(null);
    try {
      const cleared = await onClearGitRecords();
      if (cleared) {
        setGitClearMsg({ type: "ok", text: "已清空 Git 记录" });
      } else {
        setGitClearMsg({ type: "err", text: "清空失败，请稍后重试" });
      }
    } catch (e) {
      setGitClearMsg({ type: "err", text: String(e) });
    } finally {
      setClearingGit(false);
    }
  };

  const handleClearGitClick = async () => {
    if (!onClearGitRecords || !hasGitRecords || clearingGit) return;
    const ok = await confirm({
      title: "清空 Git 记录",
      message: "此操作不可恢复，将清除以下本地记忆：",
      details: [
        "分支打包 / 快捷合并的仓库路径历史",
        "上次选择的仓库与分支",
        "各仓库的高级设置（端口、nginx 等）",
      ],
      confirmLabel: "确认清空",
      variant: "danger",
    });
    if (ok) {
      await handleClearGitRecords();
    }
  };

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

  const ksEnvs = resolveKsEnvironments(config);

  const setKsEnvs = (next: KsEnvironment[]) => {
    onConfigChange("ks_environments", next);
  };

  const openAddKsEnv = () => {
    setEnvEditorPassword(false);
    setEnvEditor({ mode: "add", draft: createKsEnvironment(ksEnvs) });
  };

  const openEditKsEnv = (env: KsEnvironment) => {
    setEnvEditorPassword(false);
    setEnvEditor({ mode: "edit", draft: { ...env } });
  };

  const closeKsEnvEditor = () => {
    setEnvEditor(null);
    setEnvEditorPassword(false);
  };

  const saveKsEnvEditor = () => {
    if (!envEditor) return;
    const draft = {
      ...envEditor.draft,
      name: envEditor.draft.name.trim() || envEditor.draft.name,
      console: envEditor.draft.console.trim(),
      username: envEditor.draft.username.trim(),
    };
    if (!draft.name.trim() || !draft.console.trim() || !draft.username.trim() || !draft.password) {
      return;
    }
    if (envEditor.mode === "add") {
      setKsEnvs([...ksEnvs, draft]);
    } else {
      setKsEnvs(ksEnvs.map((env) => (env.id === draft.id ? draft : env)));
    }
    closeKsEnvEditor();
    // 立刻落盘，避免只改内存后切到发布页以为已保存、重启又丢
    handleSaveConfig();
  };

  const removeKsEnv = async (env: KsEnvironment) => {
    const ok = await confirm({
      title: "删除环境",
      message: `确定删除「${env.name || env.id}」？发布页将无法再选择该环境。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (ok) {
      setKsEnvs(ksEnvs.filter((item) => item.id !== env.id));
      handleSaveConfig();
    }
  };

  return (
    <div className="config-shell">
      <Stack gap="md" className="config-panel">
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
            borderBottom: "1px solid var(--color-border)",
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
        <Tabs.List>
          {TABS.map(({ key, label, icon }) => (
            <Tabs.Tab key={key} value={key} leftSection={icon}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="connection" pt="md">
          <Paper {...panelPaperProps}>
            <Stack gap="md">
              <TextInput
                label="Harbor 地址"
                value={config.harbor_url}
                onChange={(e) => onConfigChange("harbor_url", e.currentTarget.value)}
                placeholder="例如: harbor.example.com"
                styles={fieldStyles}
              />
              <TextInput
                label="用户名"
                value={config.username}
                onChange={(e) => onConfigChange("username", e.currentTarget.value)}
                placeholder="Harbor 登录用户名"
                styles={fieldStyles}
              />
              <PasswordInput
                label="密码"
                value={config.password}
                onChange={(e) => onConfigChange("password", e.currentTarget.value)}
                placeholder="Harbor 登录密码"
                visible={showPassword}
                onVisibilityChange={() => onTogglePassword()}
                styles={fieldStyles}
              />
              <TextInput
                label="Harbor 项目"
                value={config.project}
                onChange={(e) => onConfigChange("project", e.currentTarget.value)}
                placeholder="例如: my-project"
                description="推送时自动拼在镜像名前，最终地址为 harbor地址/项目名/镜像名:标签"
                styles={fieldStyles}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="ks" pt="md">
          <Stack gap="md">
            <Paper {...panelPaperProps}>
              <Stack gap="md">
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Text size="sm" c="var(--color-text-muted)">
                    配置多个 KubeSphere 环境，发布页按环境切换连接
                  </Text>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<Plus size={14} />}
                    onClick={openAddKsEnv}
                    style={{ flexShrink: 0 }}
                  >
                    添加环境
                  </Button>
                </Group>
                {ksEnvs.length === 0 && (
                  <Text size="sm" c="var(--color-text-muted)">
                    还没有环境，点击「添加环境」开始配置
                  </Text>
                )}
                {ksEnvs.length > 0 && (
                  <Stack gap="sm">
                    {ksEnvs.map((env) => (
                      <Paper
                        key={env.id}
                        p="sm"
                        radius="md"
                        withBorder
                        style={sectionCardStyle}
                      >
                        <Group justify="space-between" wrap="nowrap">
                          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                            <Text size="sm" fw={600} c="var(--color-text)" truncate>
                              {env.name || env.id}
                            </Text>
                            <Text size="xs" c="var(--color-text-muted)" truncate>
                              {env.console || "未填地址"}
                            </Text>
                            <Text size="xs" c="var(--color-text-muted)" truncate>
                              {env.username || "未填用户"} · {env.password ? "已设密码" : "未设密码"}
                            </Text>
                          </Stack>
                          <Group gap={6} style={{ flexShrink: 0 }}>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              title="编辑"
                              onClick={() => openEditKsEnv(env)}
                            >
                              <Pencil size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              title="删除"
                              onClick={() => void removeKsEnv(env)}
                            >
                              <Trash2 size={14} />
                            </ActionIcon>
                          </Group>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Stack>
            </Paper>

            <Paper {...panelPaperProps}>
              <KsPublishMapEditor
                config={config}
                onMapsChange={(updater) =>
                  onConfigChange("ks_publish_maps", (prev) => {
                    const current = (Array.isArray(prev) ? prev : []) as NonNullable<
                      HarborConfig["ks_publish_maps"]
                    >;
                    return typeof updater === "function" ? updater(current) : updater;
                  })}
                onRegisterFlush={(flush) => {
                  flushKsMapsRef.current = flush;
                }}
              />
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="jar" pt="md">
          <Paper {...panelPaperProps}>
            <Stack gap="md">
              <TextInput
                label="JAR 基础镜像"
                value={config.base_image}
                onChange={(e) => onConfigChange("base_image", e.currentTarget.value)}
                placeholder="例如: eclipse-temurin:17-jre"
                styles={fieldStyles}
              />
              <TextInput
                label="JAR 暴露端口"
                value={config.expose_port}
                onChange={(e) => onConfigChange("expose_port", e.currentTarget.value)}
                placeholder="例如: 8181"
                styles={fieldStyles}
              />
              <TextInput
                label={
                  <Group gap={6}>
                    <FolderOpen size={14} />
                    <span>Maven Home</span>
                  </Group>
                }
                value={config.maven_home ?? ""}
                onChange={(e) => applyMavenHome(e.currentTarget.value)}
                placeholder="优先读 MAVEN_HOME / M2_HOME；例如 /Users/daijunxiong/app/apache-maven-3.9.9"
                description="优先读取环境变量 MAVEN_HOME / M2_HOME；也可在此手动指定。填写后会自动带上 conf/settings.xml"
                rightSectionWidth={90}
                rightSection={
                  <Button
                    {...browseButtonProps}
                    onClick={async () => {
                      if (!isTauriRuntime()) return;
                      try {
                        const current = (config.maven_home ?? "").trim();
                        const selected = await open({
                          multiple: false,
                          directory: true,
                          recursive: false,
                          title: "选择 Maven 安装目录",
                          defaultPath: current || undefined,
                        });
                        if (selected) applyMavenHome(selected as string);
                      } catch (e) {
                        console.error("选择 Maven Home 失败:", e);
                      }
                    }}
                  >
                    选择
                  </Button>
                }
                styles={fieldStyles}
              />
              <TextInput
                label={
                  <Group gap={6}>
                    <FolderOpen size={14} />
                    <span>Maven 本地仓库</span>
                  </Group>
                }
                value={config.maven_local_repo ?? ""}
                onChange={(e) => onConfigChange("maven_local_repo", e.currentTarget.value)}
                placeholder="默认由 Maven Home 带出：{home}/repository"
                description='选择 Maven Home 后会自动带出 {"{home}/repository"}；也可单独改。留空且无 Home 时走 ~/.m2/repository'
                rightSectionWidth={90}
                rightSection={
                  <Button
                    {...browseButtonProps}
                    onClick={async () => {
                      if (!isTauriRuntime()) return;
                      try {
                        const current = (config.maven_local_repo ?? "").trim();
                        const home = (config.maven_home ?? "").trim();
                        const selected = await open({
                          multiple: false,
                          directory: true,
                          recursive: false,
                          title: "选择 Maven 本地仓库目录",
                          defaultPath: current || home || undefined,
                        });
                        if (selected) onConfigChange("maven_local_repo", selected as string);
                      } catch (e) {
                        console.error("选择 Maven 本地仓库失败:", e);
                      }
                    }}
                  >
                    选择
                  </Button>
                }
                styles={fieldStyles}
              />
              <TextInput
                label={
                  <Group gap={6}>
                    <FolderOpen size={14} />
                    <span>tools 目录 (--build-context)</span>
                  </Group>
                }
                value={config.custom_docker_extras_dir}
                onChange={(e) => onConfigChange("custom_docker_extras_dir", e.currentTarget.value)}
                placeholder="例如: /Users/daijunxiong/code/packingmachine/tools"
                description={
                  <>
                    填 tools/ 的绝对路径，jarporter 通过 <code>--build-context tools=</code> 注入。Dockerfile 里用{" "}
                    <code>COPY --from=tools ./ /opt/tools/</code> 获取。
                  </>
                }
                rightSectionWidth={90}
                rightSection={
                  <Button
                    {...browseButtonProps}
                    onClick={async () => {
                      if (!isTauriRuntime()) return;
                      try {
                        const selected = await open({
                          multiple: false,
                          directory: true,
                          recursive: false,
                          title: "选择 tools 目录",
                        });
                        if (selected) {
                          onConfigChange("custom_docker_extras_dir", selected as string);
                        }
                      } catch (e) {
                        console.error("选择目录失败:", e);
                      }
                    }}
                  >
                    选择
                  </Button>
                }
                styles={fieldStyles}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="bt" pt="md">
          <Paper {...panelPaperProps}>
            <Stack gap="md">
              <TextInput
                label="面板地址"
                value={config.bt_panel_url ?? ""}
                onChange={(e) => onConfigChange("bt_panel_url", e.currentTarget.value)}
                placeholder="https://47.107.51.228:10163"
                styles={fieldStyles}
              />
              <PasswordInput
                label="面板 API 密钥"
                value={config.bt_panel_secret ?? ""}
                onChange={(e) => onConfigChange("bt_panel_secret", e.currentTarget.value)}
                placeholder="面板设置 → API 接口密钥"
                visible={showPassword}
                onVisibilityChange={() => onTogglePassword()}
                styles={fieldStyles}
              />
              <Stack gap="xs">
                <Text size="sm" fw={500} c="var(--color-text)">
                  宝塔自动部署
                </Text>
                <Text size="sm" c="var(--color-text-muted)">
                  匹配下方 Profile 时：Maven 打包 FTP 覆盖 JAR 并重启；npm 在对应 Profile 或 build:{"{profile}"} 时上传 dist
                </Text>
                <Checkbox
                  label="启用打包后自动部署"
                  checked={config.bt_auto_deploy_test !== false}
                  onChange={(e) => onConfigChange("bt_auto_deploy_test", e.currentTarget.checked)}
                  color="cyan"
                />
                <TextInput
                  id="bt-auto-deploy-profile"
                  label="自动部署 Profile"
                  value={config.bt_auto_deploy_profile ?? "test"}
                  placeholder="test"
                  disabled={config.bt_auto_deploy_test === false}
                  onChange={(e) => onConfigChange("bt_auto_deploy_profile", e.currentTarget.value.trim())}
                  styles={fieldStyles}
                />
              </Stack>
              <Stack gap="xs">
                <Text size="sm" fw={500} c="var(--color-text)">
                  临时登录
                </Text>
                <Group gap="md" wrap="wrap">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={
                      tempLoginLoading
                      || !(config.bt_panel_url ?? "").trim()
                      || !(config.bt_panel_secret ?? "").trim()
                    }
                    leftSection={
                      tempLoginLoading
                        ? <Loader2 size={14} className="spin" />
                        : tempLoginOpenInBrowser
                          ? <ExternalLink size={14} />
                          : <Copy size={14} />
                    }
                    onClick={() => {
                      setTempLoginLoading(true);
                      void fetchBtTempLogin(tempLoginOpenInBrowser ? "open" : "copy")
                        .finally(() => setTempLoginLoading(false));
                    }}
                    title={
                      tempLoginOpenInBrowser
                        ? "生成临时登录链接并在浏览器打开（约 10 分钟有效）"
                        : "生成临时登录链接并复制到剪贴板（约 10 分钟有效）"
                    }
                  >
                    {tempLoginOpenInBrowser ? "打开临时登录" : "复制临时登录"}
                  </Button>
                  <Checkbox
                    label="默认打开"
                    checked={tempLoginOpenInBrowser}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setTempLoginOpenInBrowser(on);
                      saveBtTempLoginOpenPref(on);
                    }}
                    color="cyan"
                  />
                </Group>
                <Text size="sm" c="var(--color-text-muted)">
                  勾选「默认打开」则在浏览器打开；取消勾选则复制链接到剪贴板。约 10 分钟有效，用后失效。请先保存配置再点。
                </Text>
              </Stack>
              <TextInput
                label="前端 dist 上传目录"
                value={config.bt_frontend_remote_dir ?? ""}
                onChange={(e) => onConfigChange("bt_frontend_remote_dir", e.currentTarget.value)}
                placeholder="/www/wwwroot/pcm.shengyeshudong.cn"
                description="上传 dist 内文件（不套一层 dist 目录）；默认 pcm.shengyeshudong.cn"
                styles={fieldStyles}
              />
              <Checkbox
                label="跳过面板 TLS 证书校验（自签证书）"
                checked={config.bt_panel_insecure !== false}
                onChange={(e) => onConfigChange("bt_panel_insecure", e.currentTarget.checked)}
                color="cyan"
              />
              <TextInput
                label="FTP 主机"
                value={config.bt_ftp_host ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_host", e.currentTarget.value)}
                placeholder="47.107.51.228"
                styles={fieldStyles}
              />
              <TextInput
                label="FTP 用户"
                value={config.bt_ftp_user ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_user", e.currentTarget.value)}
                placeholder="admin"
                styles={fieldStyles}
              />
              <TextInput
                label="FTP 密码"
                type={showPassword ? "text" : "password"}
                value={config.bt_ftp_pass ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_pass", e.currentTarget.value)}
                placeholder="FTP 密码"
                styles={fieldStyles}
              />
              <Textarea
                label="JAR → 项目 ID 映射"
                value={Object.entries(config.bt_jar_project_ids ?? {})
                  .map(([jar, id]) => `${jar}=${id}`)
                  .join("\n")}
                onChange={(e) => {
                  const map: Record<string, string> = {};
                  for (const line of e.currentTarget.value.split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) continue;
                    const eq = trimmed.indexOf("=");
                    if (eq <= 0) continue;
                    const jar = trimmed.slice(0, eq).trim();
                    const id = trimmed.slice(eq + 1).trim();
                    if (jar && id) map[jar] = id;
                  }
                  onConfigChange("bt_jar_project_ids", map);
                }}
                spellCheck={false}
                minRows={4}
                placeholder={"tksy-backend-1.0.0.jar=19"}
                description={
                  <>
                    每行 <code>jar文件名=项目id</code>。同名 JAR 多项目时按此强制部署（如 tksy-backend → 19）
                  </>
                }
                styles={{
                  ...fieldStyles,
                  input: {
                    ...fieldStyles.input,
                    fontFamily: "var(--mantine-font-family-monospace)",
                  },
                }}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="frontend" pt="md">
          <Paper {...panelPaperProps}>
            <Stack gap="md">
              <TextInput
                label="前端基础镜像"
                value={config.frontend_base_image}
                onChange={(e) => onConfigChange("frontend_base_image", e.currentTarget.value)}
                placeholder="例如: nginx:alpine"
                styles={fieldStyles}
              />
              <TextInput
                label="前端暴露端口"
                value={config.frontend_expose_port}
                onChange={(e) => onConfigChange("frontend_expose_port", e.currentTarget.value)}
                placeholder="例如: 80"
                styles={fieldStyles}
              />
              <Textarea
                label="前端 Dockerfile 模板"
                value={config.frontend_dockerfile_template}
                onChange={(e) => onConfigChange("frontend_dockerfile_template", e.currentTarget.value)}
                spellCheck={false}
                minRows={6}
                description={
                  <>
                    可用变量：{"{{BASE_IMAGE}}"}、{"{{EXPOSE_PORT}}"}、{"{{NGINX_CONF_PATH}}"}、{"{{DIST_DIR}}"}、
                    {"{{IMAGE_NAME}}"}、{"{{IMAGE_TAG}}"}、{"{{FULL_IMAGE}}"}
                  </>
                }
                styles={{
                  ...fieldStyles,
                  input: {
                    ...fieldStyles.input,
                    fontFamily: "var(--mantine-font-family-monospace)",
                  },
                }}
              />
              <Textarea
                label="nginx.conf 模板"
                value={config.frontend_nginx_template}
                onChange={(e) => onConfigChange("frontend_nginx_template", e.currentTarget.value)}
                spellCheck={false}
                minRows={9}
                styles={{
                  ...fieldStyles,
                  input: {
                    ...fieldStyles.input,
                    fontFamily: "var(--mantine-font-family-monospace)",
                  },
                }}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="output" pt="md">
          <Paper {...panelPaperProps}>
            <Stack gap="md">
              <TextInput
                label={
                  <Group gap={6}>
                    <Archive size={14} />
                    <span>打包产物目录</span>
                  </Group>
                }
                value={config.artifact_output_dir}
                onChange={(e) => onConfigChange("artifact_output_dir", e.currentTarget.value)}
                placeholder="默认: 桌面"
                description="打包产物将自动复制到此目录，留空则不复制"
                rightSectionWidth={90}
                rightSection={
                  <Button
                    {...browseButtonProps}
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
                    选择
                  </Button>
                }
                styles={fieldStyles}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="about" pt="md">
          <Stack gap="md" className="about-panel">
            <Paper p="lg" radius="md" withBorder style={sectionCardStyle}>
              <Stack gap="sm" align="center">
                <Text size="xl" fw={700} c="var(--color-text)">
                  JarPorter
                </Text>
                <Text size="sm" c="var(--color-text-muted)">
                  当前版本 <Text span fw={600} c="var(--color-primary)">v{appVersion || "—"}</Text>
                </Text>
                <Text size="sm" c="var(--color-text-muted)">
                  JAR / 前端 dist 一键打包推送 Harbor
                </Text>
                <Group gap="sm" mt="xs">
                  <Button
                    size="sm"
                    variant="default"
                    leftSection={checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                    onClick={handleCheckUpdate}
                    disabled={checking || !onCheckUpdate}
                    loading={checking}
                  >
                    {checking ? "检查中…" : "检查更新"}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    color="gray"
                    rightSection={<ExternalLink size={12} />}
                    onClick={() => {
                      void openReleasePage().catch((e) => {
                        void showSystemAlert("无法打开发布页", String(e));
                      });
                    }}
                  >
                    发布页
                  </Button>
                </Group>
                {checkMsg && (
                  <Group
                    gap={8}
                    p="sm"
                    style={{
                      borderRadius: "var(--radius-md)",
                      background:
                        checkMsg.type === "ok"
                          ? "rgba(16, 185, 129, 0.12)"
                          : checkMsg.type === "update"
                            ? "var(--color-primary-muted)"
                            : "rgba(239, 68, 68, 0.12)",
                      border: `1px solid ${
                        checkMsg.type === "ok"
                          ? "var(--color-success)"
                          : checkMsg.type === "update"
                            ? "var(--color-primary)"
                            : "var(--color-error)"
                      }`,
                      color:
                        checkMsg.type === "ok"
                          ? "var(--color-success)"
                          : checkMsg.type === "update"
                            ? "var(--color-primary-hover)"
                            : "var(--color-error)",
                    }}
                  >
                    {checkMsg.type === "ok" && <CheckCircle size={14} />}
                    {checkMsg.type === "update" && <RefreshCw size={14} />}
                    {checkMsg.type === "err" && <AlertCircle size={14} />}
                    <Text size="sm">{checkMsg.text}</Text>
                  </Group>
                )}
              </Stack>
            </Paper>

            <Paper p="lg" radius="md" withBorder style={sectionCardStyle}>
              <Stack gap="sm">
                <Text size="md" fw={600} c="var(--color-text)">
                  Git 本地记录
                </Text>
                <Text size="sm" c="var(--color-text-muted)">
                  包含分支打包与快捷合并中的仓库路径历史，以及各仓库的高级设置记忆。
                  {gitRecordCount > 0 ? ` 当前共 ${gitRecordCount} 条路径/仓库记忆。` : hasGitRecords ? " 当前有分支选择记忆。" : " 当前暂无记录。"}
                </Text>
                <Button
                  size="sm"
                  color="red"
                  variant="light"
                  leftSection={<Trash2 size={16} />}
                  onClick={() => void handleClearGitClick()}
                  disabled={!onClearGitRecords || !hasGitRecords || clearingGit}
                  loading={clearingGit}
                  w="fit-content"
                >
                  清空 Git 记录
                </Button>
                {gitClearMsg && (
                  <Group
                    gap={8}
                    p="sm"
                    style={{
                      borderRadius: "var(--radius-md)",
                      background: gitClearMsg.type === "ok" ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
                      border: `1px solid ${gitClearMsg.type === "ok" ? "var(--color-success)" : "var(--color-error)"}`,
                      color: gitClearMsg.type === "ok" ? "var(--color-success)" : "var(--color-error)",
                    }}
                  >
                    {gitClearMsg.type === "ok" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                    <Text size="sm">{gitClearMsg.text}</Text>
                  </Group>
                )}
              </Stack>
            </Paper>

            <Paper p="lg" radius="md" withBorder style={sectionCardStyle}>
              <Stack gap="sm">
                <Text size="md" fw={600} c="var(--color-text)">
                  系统通知测试
                </Text>
                <Text size="sm" c="var(--color-text-muted)">
                  点击发送一条测试通知，验证 macOS 通知中心是否正常工作。若无弹出，请前往
                  「系统设置 → 通知 → JarPorter」开启允许通知。
                </Text>
                <Button
                  size="sm"
                  variant="default"
                  leftSection={<Bell size={16} />}
                  onClick={() => void showSystemAlert("测试通知", "JarPorter 系统通知正常 ✅")}
                  w="fit-content"
                >
                  发送测试通知
                </Button>
              </Stack>
            </Paper>

            <Paper
              p="md"
              radius="md"
              className="config-tip"
              withBorder
              style={{
                background: "var(--color-primary-subtle)",
                borderColor: "var(--color-border)",
              }}
            >
              <Group gap={6} mb="sm">
                <AlertCircle size={16} className="inline-icon" />
                <Text size="sm" fw={600} c="var(--color-text)">
                  配置说明
                </Text>
              </Group>
              <Stack gap={6} component="ul" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {[
                  "配置保存后无需重复填写",
                  "Harbor 地址不需要带 https:// 前缀",
                  "Harbor 项目为仓库中的项目名，会与镜像名称拼接",
                  "JAR 模式使用 JAR 基础镜像和 JAR 暴露端口",
                  "前端 dist 模式会把所选 dist 目录的内容复制为 nginx 站点根目录，不会在镜像里嵌套 dist 目录",
                  "默认 nginx.conf 的 /index.html 回退路径对应 /usr/share/nginx/html/index.html",
                ].map((item) => (
                  <Text key={item} component="li" size="xs" c="var(--color-text-muted)" pl="md" style={{ position: "relative" }}>
                    <Text
                      span
                      style={{ position: "absolute", left: 0, color: "var(--color-text-muted)" }}
                    >
                      •
                    </Text>
                    {item}
                  </Text>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {activeTab !== "about" && (
        <div className="config-save-bar">
          <Button
            className="config-save-btn"
            onClick={handleSaveConfig}
            variant="filled"
            color="blue"
            data-saved={configSaved || undefined}
            leftSection={configSaved ? <CheckCircle size={18} /> : <Settings size={18} />}
            size="md"
            radius="md"
          >
            {configSaved ? "已保存" : "保存配置"}
          </Button>
        </div>
      )}

      <Modal
        opened={!!envEditor}
        onClose={closeKsEnvEditor}
        title={envEditor?.mode === "add" ? "添加环境" : "编辑环境"}
        size="sm"
        styles={{
          content: { background: "var(--color-bg-surface)" },
          header: { background: "var(--color-bg-surface)" },
          title: { color: "var(--color-text)", fontWeight: 600 },
        }}
      >
        {envEditor && (
          <Stack gap="md">
            <TextInput
              label="环境名"
              value={envEditor.draft.name}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, name: e.currentTarget.value },
              })}
              placeholder="dev / test / prod"
              styles={fieldStyles}
            />
            <TextInput
              label="控制台地址"
              value={envEditor.draft.console}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, console: e.currentTarget.value },
              })}
              placeholder="例如: http://192.168.31.254:30880"
              styles={fieldStyles}
            />
            <TextInput
              label="用户名"
              value={envEditor.draft.username}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, username: e.currentTarget.value },
              })}
              placeholder="KubeSphere 登录用户名"
              styles={fieldStyles}
            />
            <PasswordInput
              label="密码"
              value={envEditor.draft.password}
              onChange={(e) => setEnvEditor({
                ...envEditor,
                draft: { ...envEditor.draft, password: e.currentTarget.value },
              })}
              placeholder="KubeSphere 登录密码"
              visible={envEditorPassword}
              onVisibilityChange={(visible) => setEnvEditorPassword(visible)}
              styles={fieldStyles}
            />
            <Group justify="flex-end" gap="sm" mt="xs">
              <Button variant="default" onClick={closeKsEnvEditor}>
                取消
              </Button>
              <Button
                variant="filled"
                color="blue"
                disabled={
                  !envEditor.draft.name.trim()
                  || !envEditor.draft.console.trim()
                  || !envEditor.draft.username.trim()
                  || !envEditor.draft.password
                }
                onClick={saveKsEnvEditor}
              >
                {envEditor.mode === "add" ? "添加" : "保存"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      </Stack>
    </div>
  );
}
