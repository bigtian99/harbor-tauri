import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Settings, CheckCircle, AlertCircle, Eye, EyeOff, FolderOpen, Archive,
  Server, Package, Globe, FolderOutput, Info, RefreshCw, Loader2, ExternalLink, Trash2,
  CloudUpload, Bell, Plus, Pencil, X, Copy,
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
import "./Modal.css";

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
  };

  const removeKsEnv = async (env: KsEnvironment) => {
    const ok = await confirm({
      title: "删除环境",
      message: `确定删除「${env.name || env.id}」？发布页将无法再选择该环境。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (ok) setKsEnvs(ksEnvs.filter((item) => item.id !== env.id));
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
        {activeTab === "connection" && (
          <>
            <div className="form-group">
              <label>Harbor 地址</label>
              <input
                type="text"
                value={config.harbor_url}
                onChange={(e) => onConfigChange("harbor_url", e.target.value)}
                placeholder="例如: harbor.example.com"
              />
            </div>
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                value={config.username}
                onChange={(e) => onConfigChange("username", e.target.value)}
                placeholder="Harbor 登录用户名"
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.password}
                  onChange={(e) => onConfigChange("password", e.target.value)}
                  placeholder="Harbor 登录密码"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={onTogglePassword}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Harbor 项目</label>
              <input
                type="text"
                value={config.project}
                onChange={(e) => onConfigChange("project", e.target.value)}
                placeholder="例如: my-project"
              />
              <p className="template-hint">推送时自动拼在镜像名前，最终地址为 harbor地址/项目名/镜像名:标签</p>
            </div>
          </>
        )}

        {activeTab === "ks" && (
          <>
            <div className="ks-env-toolbar">
              <p className="template-hint" style={{ margin: 0 }}>
                配置多个 KubeSphere 环境，发布页按环境切换连接
              </p>
              <button type="button" className="config-add-env-btn" onClick={openAddKsEnv}>
                <Plus size={14} />
                添加环境
              </button>
            </div>
            {ksEnvs.length === 0 && (
              <p className="template-hint">还没有环境，点击「添加环境」开始配置</p>
            )}
            {ksEnvs.length > 0 && (
              <div className="ks-env-list">
                {ksEnvs.map((env) => (
                  <div key={env.id} className="ks-env-row">
                    <div className="ks-env-row-main">
                      <span className="ks-env-name">{env.name || env.id}</span>
                      <span className="ks-env-console">{env.console || "未填地址"}</span>
                      <span className="ks-env-user">
                        {env.username || "未填用户"} · {env.password ? "已设密码" : "未设密码"}
                      </span>
                    </div>
                    <div className="ks-env-row-actions">
                      <button type="button" title="编辑" onClick={() => openEditKsEnv(env)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="danger" title="删除" onClick={() => void removeKsEnv(env)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
          </>
        )}

        {activeTab === "jar" && (
          <>
            <div className="form-group">
              <label>JAR 基础镜像</label>
              <input
                type="text"
                value={config.base_image}
                onChange={(e) => onConfigChange("base_image", e.target.value)}
                placeholder="例如: eclipse-temurin:17-jre"
              />
            </div>
            <div className="form-group">
              <label>JAR 暴露端口</label>
              <input
                type="text"
                value={config.expose_port}
                onChange={(e) => onConfigChange("expose_port", e.target.value)}
                placeholder="例如: 8181"
              />
            </div>
            <div className="form-group">
              <label><FolderOpen size={14} /> Maven Home</label>
              <div className="path-picker-row">
                <input
                  type="text"
                  value={config.maven_home ?? ""}
                  onChange={(e) => applyMavenHome(e.target.value)}
                  placeholder="优先读 MAVEN_HOME / M2_HOME；例如 /Users/daijunxiong/app/apache-maven-3.9.9"
                />
                <button
                  type="button"
                  className="path-picker-btn"
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
                  <FolderOpen size={16} /> 选择
                </button>
              </div>
              <p className="template-hint">
                优先读取环境变量 MAVEN_HOME / M2_HOME；也可在此手动指定。填写后会自动带上 conf/settings.xml
              </p>
            </div>
            <div className="form-group">
              <label><FolderOpen size={14} /> Maven 本地仓库</label>
              <div className="path-picker-row">
                <input
                  type="text"
                  value={config.maven_local_repo ?? ""}
                  onChange={(e) => onConfigChange("maven_local_repo", e.target.value)}
                  placeholder="默认由 Maven Home 带出：{home}/repository"
                />
                <button
                  type="button"
                  className="path-picker-btn"
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
                  <FolderOpen size={16} /> 选择
                </button>
              </div>
              <p className="template-hint">
                选择 Maven Home 后会自动带出 {"{home}/repository"}；也可单独改。留空且无 Home 时走 ~/.m2/repository
              </p>
            </div>
            <div className="form-group">
              <label><FolderOpen size={14} /> tools 目录 (--build-context)</label>
              <div className="path-picker-row">
                <input
                  type="text"
                  value={config.custom_docker_extras_dir}
                  onChange={(e) => onConfigChange("custom_docker_extras_dir", e.target.value)}
                  placeholder="例如: /Users/daijunxiong/code/packingmachine/tools"
                />
                <button
                  type="button"
                  className="path-picker-btn"
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
                  <FolderOpen size={16} /> 选择
                </button>
              </div>
              <p className="template-hint">填 tools/ 的绝对路径，jarporter 通过 <code>--build-context tools=</code> 注入。Dockerfile 里用 <code>COPY --from=tools ./ /opt/tools/</code> 获取。</p>
            </div>
          </>
        )}

        {activeTab === "bt" && (
          <>
            <div className="form-group">
              <label>面板地址</label>
              <input
                type="text"
                value={config.bt_panel_url ?? ""}
                onChange={(e) => onConfigChange("bt_panel_url", e.target.value)}
                placeholder="https://47.107.51.228:10163"
              />
            </div>
            <div className="form-group">
              <label>面板 API 密钥</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.bt_panel_secret ?? ""}
                  onChange={(e) => onConfigChange("bt_panel_secret", e.target.value)}
                  placeholder="面板设置 → API 接口密钥"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={onTogglePassword}
                  title={showPassword ? "隐藏" : "显示"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>宝塔自动部署</label>
              <p className="template-hint">
                匹配下方 Profile 时：Maven 打包 FTP 覆盖 JAR 并重启；npm 在对应 Profile 或 build:{"{profile}"} 时上传 dist
              </p>
              <label className="checkbox-label" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={config.bt_auto_deploy_test !== false}
                  onChange={(e) => onConfigChange("bt_auto_deploy_test", e.target.checked)}
                />
                <span className="checkbox-toggle"></span>
                <span>启用打包后自动部署</span>
              </label>
              <div style={{ marginTop: 10 }}>
                <label htmlFor="bt-auto-deploy-profile">自动部署 Profile</label>
                <input
                  id="bt-auto-deploy-profile"
                  type="text"
                  value={config.bt_auto_deploy_profile ?? "test"}
                  placeholder="test"
                  disabled={config.bt_auto_deploy_test === false}
                  onChange={(e) => onConfigChange("bt_auto_deploy_profile", e.target.value.trim())}
                />
              </div>
            </div>
            <div className="form-group">
              <label>临时登录</label>
              <div className="bt-temp-login-row">
                <button
                  type="button"
                  className="config-add-env-btn"
                  disabled={
                    tempLoginLoading
                    || !(config.bt_panel_url ?? "").trim()
                    || !(config.bt_panel_secret ?? "").trim()
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
                  {tempLoginLoading
                    ? <Loader2 size={14} className="spin" />
                    : tempLoginOpenInBrowser
                      ? <ExternalLink size={14} />
                      : <Copy size={14} />}
                  {tempLoginOpenInBrowser ? "打开临时登录" : "复制临时登录"}
                </button>
                <label className="checkbox-label bt-temp-login-open-pref">
                  <input
                    type="checkbox"
                    checked={tempLoginOpenInBrowser}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setTempLoginOpenInBrowser(on);
                      saveBtTempLoginOpenPref(on);
                    }}
                  />
                  <span className="checkbox-toggle" aria-hidden />
                  <span>默认打开</span>
                </label>
              </div>
              <p className="template-hint">
                勾选「默认打开」则在浏览器打开；取消勾选则复制链接到剪贴板。约 10 分钟有效，用后失效。请先保存配置再点。
              </p>
            </div>
            <div className="form-group">
              <label>前端 dist 上传目录</label>
              <input
                type="text"
                value={config.bt_frontend_remote_dir ?? ""}
                onChange={(e) => onConfigChange("bt_frontend_remote_dir", e.target.value)}
                placeholder="/www/wwwroot/pcm.shengyeshudong.cn"
              />
              <p className="template-hint">上传 dist 内文件（不套一层 dist 目录）；默认 pcm.shengyeshudong.cn</p>
            </div>
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.bt_panel_insecure !== false}
                  onChange={(e) => onConfigChange("bt_panel_insecure", e.target.checked)}
                />
                <span className="checkbox-toggle"></span>
                <span>跳过面板 TLS 证书校验（自签证书）</span>
              </label>
            </div>
            <div className="form-group">
              <label>FTP 主机</label>
              <input
                type="text"
                value={config.bt_ftp_host ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_host", e.target.value)}
                placeholder="47.107.51.228"
              />
            </div>
            <div className="form-group">
              <label>FTP 用户</label>
              <input
                type="text"
                value={config.bt_ftp_user ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_user", e.target.value)}
                placeholder="admin"
              />
            </div>
            <div className="form-group">
              <label>FTP 密码</label>
              <input
                type={showPassword ? "text" : "password"}
                value={config.bt_ftp_pass ?? ""}
                onChange={(e) => onConfigChange("bt_ftp_pass", e.target.value)}
                placeholder="FTP 密码"
              />
            </div>
            <div className="form-group">
              <label>JAR → 项目 ID 映射</label>
              <textarea
                value={Object.entries(config.bt_jar_project_ids ?? {})
                  .map(([jar, id]) => `${jar}=${id}`)
                  .join("\n")}
                onChange={(e) => {
                  const map: Record<string, string> = {};
                  for (const line of e.target.value.split("\n")) {
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
                rows={4}
                placeholder={"tksy-backend-1.0.0.jar=19"}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="template-hint">
                每行 <code>jar文件名=项目id</code>。同名 JAR 多项目时按此强制部署（如 tksy-backend → 19）
              </p>
            </div>
          </>
        )}

        {activeTab === "frontend" && (
          <>
            <div className="form-group">
              <label>前端基础镜像</label>
              <input
                type="text"
                value={config.frontend_base_image}
                onChange={(e) => onConfigChange("frontend_base_image", e.target.value)}
                placeholder="例如: nginx:alpine"
              />
            </div>
            <div className="form-group">
              <label>前端暴露端口</label>
              <input
                type="text"
                value={config.frontend_expose_port}
                onChange={(e) => onConfigChange("frontend_expose_port", e.target.value)}
                placeholder="例如: 80"
              />
            </div>
            <div className="form-group">
              <label>前端 Dockerfile 模板</label>
              <textarea
                value={config.frontend_dockerfile_template}
                onChange={(e) => onConfigChange("frontend_dockerfile_template", e.target.value)}
                spellCheck={false}
                rows={6}
              />
              <p className="template-hint">可用变量：{"{{BASE_IMAGE}}"}、{"{{EXPOSE_PORT}}"}、{"{{NGINX_CONF_PATH}}"}、{"{{DIST_DIR}}"}、{"{{IMAGE_NAME}}"}、{"{{IMAGE_TAG}}"}、{"{{FULL_IMAGE}}"}</p>
            </div>
            <div className="form-group">
              <label>nginx.conf 模板</label>
              <textarea
                value={config.frontend_nginx_template}
                onChange={(e) => onConfigChange("frontend_nginx_template", e.target.value)}
                spellCheck={false}
                rows={9}
              />
            </div>
          </>
        )}

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
              <p className="about-desc">JAR / 前端 dist 一键打包推送 Harbor</p>

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
                  onClick={() => { void openReleasePage(); }}
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
              <div className="about-data-title">Git 本地记录</div>
              <p className="about-data-desc">
                包含分支打包与快捷合并中的仓库路径历史，以及各仓库的高级设置记忆。
                {gitRecordCount > 0 ? ` 当前共 ${gitRecordCount} 条路径/仓库记忆。` : hasGitRecords ? " 当前有分支选择记忆。" : " 当前暂无记录。"}
              </p>
              <div className="about-actions">
                <button
                  type="button"
                  className="about-danger-btn"
                  onClick={() => void handleClearGitClick()}
                  disabled={!onClearGitRecords || !hasGitRecords || clearingGit}
                >
                  <Trash2 size={16} />
                  清空 Git 记录
                </button>
              </div>
              {gitClearMsg && (
                <div className={`about-check-msg about-check-msg--${gitClearMsg.type === "ok" ? "ok" : "err"}`}>
                  {gitClearMsg.type === "ok" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  <span>{gitClearMsg.text}</span>
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
                <li>Harbor 地址不需要带 https:// 前缀</li>
                <li>Harbor 项目为仓库中的项目名，会与镜像名称拼接</li>
                <li>JAR 模式使用 JAR 基础镜像和 JAR 暴露端口</li>
                <li>前端 dist 模式会把所选 dist 目录的内容复制为 nginx 站点根目录，不会在镜像里嵌套 dist 目录</li>
                <li>默认 nginx.conf 的 /index.html 回退路径对应 /usr/share/nginx/html/index.html</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {activeTab !== "about" && (
        <button className="save-btn" onClick={handleSaveConfig}>
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

      {envEditor && (
        <div className="modal-overlay" onClick={closeKsEnvEditor}>
          <div className="modal-content modal-content--sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{envEditor.mode === "add" ? "添加环境" : "编辑环境"}</h3>
              <button type="button" className="modal-close" onClick={closeKsEnvEditor}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>环境名</label>
                <input
                  type="text"
                  value={envEditor.draft.name}
                  onChange={(e) => setEnvEditor({
                    ...envEditor,
                    draft: { ...envEditor.draft, name: e.target.value },
                  })}
                  placeholder="dev / test / prod"
                />
              </div>
              <div className="form-group">
                <label>控制台地址</label>
                <input
                  type="text"
                  value={envEditor.draft.console}
                  onChange={(e) => setEnvEditor({
                    ...envEditor,
                    draft: { ...envEditor.draft, console: e.target.value },
                  })}
                  placeholder="例如: http://192.168.31.254:30880"
                />
              </div>
              <div className="form-group">
                <label>用户名</label>
                <input
                  type="text"
                  value={envEditor.draft.username}
                  onChange={(e) => setEnvEditor({
                    ...envEditor,
                    draft: { ...envEditor.draft, username: e.target.value },
                  })}
                  placeholder="KubeSphere 登录用户名"
                />
              </div>
              <div className="form-group">
                <label>密码</label>
                <div className="password-input-wrapper">
                  <input
                    type={envEditorPassword ? "text" : "password"}
                    value={envEditor.draft.password}
                    onChange={(e) => setEnvEditor({
                      ...envEditor,
                      draft: { ...envEditor.draft, password: e.target.value },
                    })}
                    placeholder="KubeSphere 登录密码"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setEnvEditorPassword((v) => !v)}
                    title={envEditorPassword ? "隐藏密码" : "显示密码"}
                  >
                    {envEditorPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="ks-env-modal-footer">
              <button type="button" className="ks-env-modal-cancel" onClick={closeKsEnvEditor}>
                取消
              </button>
              <button
                type="button"
                className="ks-env-modal-ok"
                disabled={
                  !envEditor.draft.name.trim()
                  || !envEditor.draft.console.trim()
                  || !envEditor.draft.username.trim()
                  || !envEditor.draft.password
                }
                onClick={saveKsEnvEditor}
              >
                {envEditor.mode === "add" ? "添加" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
