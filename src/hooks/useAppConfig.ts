import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HarborConfig, TabType, BuildRecord } from "../types";
import type { UpdateInfo } from "../components/UpdateModal";
import {
  DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE,
  DEFAULT_FRONTEND_NGINX_TEMPLATE,
  isTauriRuntime,
} from "../types";
import { resolveOpsInitialTab, resolveTabForOpsMode } from "../opsNavigation";


export type DiagDateInfo = {
  date: string;
  size: number;
  lines: number;
};

function withSessionConfigDefaults(config: HarborConfig): HarborConfig {
  return { ...config, ops_authorization: config.ops_authorization ?? "" };
}

export function createDefaultHarborConfig(): HarborConfig {
  return {
    harbor_url: "dockerhub.kubekey.local",
    username: "",
    password: "",
    project: "",
    base_image: "eclipse-temurin:21-jre-alpine",
    expose_port: "8181",
    frontend_base_image: "nginx:alpine",
    frontend_expose_port: "80",
    frontend_dockerfile_template: DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE,
    frontend_nginx_template: DEFAULT_FRONTEND_NGINX_TEMPLATE,
    remember_branch_settings: false,
    last_repo_path: "",
    last_branch: "",
    last_frontend_dir: "",
    last_build_script: "",
    last_project_type: "maven",
    last_auto_push_image: false,
    last_package_with_backend: false,
    last_spring_profile: "",
    last_expose_port: "",
    repo_path_history: [],
    branch_repo_settings: {},
    npm_package_manager: "npm",
    npm_registry: "",
    artifact_output_dir: "",
    custom_docker_extras_dir: "",
    build_history: [],
  };
}

interface UseAppConfigDeps {
  setLog: (value: string) => void;
  setActiveTab: (tab: TabType | ((prev: TabType) => TabType)) => void;
  /**
   * 配置加载成功后的副作用（如恢复分支记忆设置）。
   * 返回值由调用方处理；hook 本身只负责 load/save/config state。
   */
  onConfigLoaded?: (config: HarborConfig) => void | Promise<void>;
}

/**
 * Harbor 配置、OPS 模式、更新检查、构建历史与 shell UI 状态。
 */
export function useAppConfig(deps: UseAppConfigDeps) {
  const { setLog, setActiveTab, onConfigLoaded } = deps;
  const onConfigLoadedRef = useRef(onConfigLoaded);
  onConfigLoadedRef.current = onConfigLoaded;

  const [config, setConfig] = useState<HarborConfig>(createDefaultHarborConfig);
  const [configSaved, setConfigSaved] = useState(false);
  const [opsMode, setOpsMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [logContent, setLogContent] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logDates, setLogDates] = useState<DiagDateInfo[]>([]);
  const [logDay, setLogDay] = useState<string | null>(null); // null = 最近 3 天（默认）
  const opsModeInitializedRef = useRef(false);

  const handleTabChange = useCallback(
    (tab: TabType) => {
      setActiveTab(resolveTabForOpsMode(tab, opsMode));
    },
    [opsMode, setActiveTab],
  );

  async function loadConfig() {
    if (!isTauriRuntime()) return;
    try {
      const savedConfig = withSessionConfigDefaults(await invoke<HarborConfig>("load_config"));
      setConfig(savedConfig);
      setBuildHistory(savedConfig.build_history || []);
      await onConfigLoadedRef.current?.(savedConfig);
    } catch (e) {
      console.error("加载配置失败:", e);
    }
  }

  async function handleSaveConfig() {
    if (!isTauriRuntime()) {
      setLog("❌ 当前是浏览器预览环境，保存配置请在 Tauri 桌面窗口中操作");
      setActiveTab("config");
      return;
    }
    try {
      await invoke("save_config", { config });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      setLog(`❌ 保存配置失败: ${e}`);
      setActiveTab("upload");
    }
  }

  function handleConfigChange(field: keyof HarborConfig, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  async function handleOpsAuthorizationSave(authorization: string) {
    const token = authorization.trim();
    setConfig((prev) => ({ ...prev, ops_authorization: token }));
  }

  async function loadBuildHistory() {
    if (!isTauriRuntime()) return;
    setIsLoadingHistory(true);
    try {
      const history = await invoke<BuildRecord[]>("get_build_history");
      setBuildHistory(history);
      setConfig((prev) => ({ ...prev, build_history: history }));
    } catch (e) {
      console.error("[Build History] 获取失败:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function deleteArtifactFiles(path: string) {
    if (!isTauriRuntime() || !path) return;
    try {
      await invoke("delete_artifact_path", { path });
    } catch (e) {
      console.error("[Delete Artifact] 删除产物失败:", path, e);
    }
  }

  async function deleteBuildRecord(
    record: BuildRecord,
    showToast?: (message: string) => void,
  ) {
    if (!isTauriRuntime()) return;
    try {
      await invoke("delete_build_record", { recordId: record.id });
      await deleteArtifactFiles(record.artifact_path);
      if (record.backend_artifact_path) {
        await deleteArtifactFiles(record.backend_artifact_path);
      }
      setBuildHistory((prev) => prev.filter((r) => r.id !== record.id));
    } catch (e) {
      console.error("[Delete Record] 删除失败:", e);
      showToast?.(`删除记录失败: ${e}`);
    }
  }

  async function clearBuildHistory(showToast?: (message: string) => void) {
    if (!isTauriRuntime()) return;
    try {
      for (const record of buildHistory) {
        await deleteArtifactFiles(record.artifact_path);
        if (record.backend_artifact_path) {
          await deleteArtifactFiles(record.backend_artifact_path);
        }
      }
      await invoke("clear_build_history");
      setBuildHistory([]);
    } catch (e) {
      console.error("[Clear History] 清空失败:", e);
      showToast?.(`清空历史失败: ${e}`);
    }
  }

  async function openArtifactPath(
    path: string,
    showToast?: (message: string) => void,
  ) {
    if (!isTauriRuntime()) {
      showToast?.("浏览器环境下无法打开目录");
      return;
    }
    try {
      await invoke("open_directory", { path });
    } catch (e) {
      showToast?.(`打开失败: ${e}`);
    }
  }

  async function handleManualCheckUpdate(): Promise<{
    status: "update" | "latest" | "error";
    message: string;
  }> {
    try {
      const info = await invoke<UpdateInfo>("check_update");
      if (info.needs_update && (info.download_url || info.asset_id)) {
        setUpdateInfo(info);
        setUpdateModalOpen(true);
        return {
          status: "update",
          message: `发现新版本 v${info.latest_version}，已打开更新弹窗`,
        };
      }
      const ver = info.latest_version || info.current_version;
      return {
        status: "latest",
        message: ver
          ? `已是最新版本（当前 v${info.current_version}${info.latest_version ? `，远端 v${info.latest_version}` : ""}）`
          : `已是最新版本（当前 v${info.current_version}）`,
      };
    } catch (e) {
      return { status: "error", message: `检查失败：${String(e)}` };
    }
  }

  async function openDiagnosticLog() {
    setLogDay(null);
    try {
      const content = await invoke<string>("read_diagnostic_log", {
        lines: 300,
        day: null,
      });
      setLogContent(content);
      // 同时刷新日期下拉
      try {
        const dates = await invoke<DiagDateInfo[]>("list_diagnostic_log_dates");
        setLogDates(dates);
      } catch {
        // 非 Tauri 环境/未初始化：忽略
      }
    } catch (e) {
      setLogContent(String(e));
    }
    setShowLogViewer(true);
  }

  /**
   * 切换诊断日志日期。
   * - `day === null`：取消过滤，回到「最近 ≤3 天合并」默认行为。
   * - `day === "YYYY-MM-DD"`：仅读该日文件。
   */
  async function selectDiagnosticDay(day: string | null): Promise<void> {
    setLogDay(day);
    try {
      const content = await invoke<string>("read_diagnostic_log", {
        lines: 300,
        day: day ?? null,
      });
      setLogContent(content);
    } catch (e) {
      setLogContent(String(e));
    }
  }

  async function refreshDiagnosticDates(): Promise<void> {
    try {
      const dates = await invoke<DiagDateInfo[]>("list_diagnostic_log_dates");
      setLogDates(dates);
    } catch {
      // 非 Tauri 环境/未初始化：忽略
    }
  }

  async function downloadDiagnosticLog(
    showToast?: (message: string) => void,
  ): Promise<void> {
    if (!isTauriRuntime()) {
      showToast?.("浏览器环境下无法下载日志");
      return;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const date = new Date().toISOString().slice(0, 10);
      const path = await save({
        defaultPath: `jarporter-diagnostic-${date}.log`,
        filters: [{ name: "Log", extensions: ["log", "txt"] }],
      });
      if (!path) return;
      const saved = await invoke<string>("export_diagnostic_log", { path });
      // open_directory：文件路径会打开其所在目录
      try {
        await invoke("open_directory", { path: saved });
      } catch (e) {
        console.error("打开导出目录失败:", e);
      }
      showToast?.(`日志已导出：${saved}`);
    } catch (e) {
      showToast?.(`导出失败：${String(e)}`);
    }
  }

  /** 在文件管理器中定位当前诊断日志文件（按下拉选中的日期，默认今天）。 */
  async function revealDiagnosticLogFile(
    showToast?: (message: string) => void,
  ): Promise<void> {
    if (!isTauriRuntime()) {
      showToast?.("浏览器环境下无法打开日志目录");
      return;
    }
    try {
      const todayPath = await invoke<string>("get_templates_diagnostic_log_path");
      // 选中某一天时，把文件名里的日期替换成该日期
      const path = logDay
        ? todayPath.replace(/diagnostic-\d{4}-\d{2}-\d{2}\.log$/, `diagnostic-${logDay}.log`)
        : todayPath;
      await invoke("open_directory", { path });
    } catch (e) {
      showToast?.(`打开日志目录失败：${String(e)}`);
    }
  }

  // 启动：加载配置 + OPS 模式
  useEffect(() => {
    loadConfig();
    if (!isTauriRuntime()) return;

    invoke<boolean>("is_ops_mode")
      .then((ops) => {
        if (ops) {
          setOpsMode(true);
          if (!opsModeInitializedRef.current) {
            opsModeInitializedRef.current = true;
            setActiveTab((currentTab) => resolveOpsInitialTab(currentTab));
          }
        }
      })
      .catch(() => {
        /* 非 Tauri 环境忽略 */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 读取本地版本
  useEffect(() => {
    invoke<string>("get_app_version")
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, []);

  // 启动 2 秒后检查更新
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke<UpdateInfo>("check_update")
        .then((info) => {
          if (info.current_version) setAppVersion(info.current_version);
          if (info.needs_update && info.download_url) {
            setUpdateInfo(info);
            setUpdateModalOpen(true);
          }
        })
        .catch(() => {
          // 网络不通或 API 异常 → 静默跳过
        });
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return {
    config,
    setConfig,
    configSaved,
    opsMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    updateInfo,
    updateModalOpen,
    setUpdateModalOpen,
    appVersion,
    buildHistory,
    setBuildHistory,
    isLoadingHistory,
    showPassword,
    setShowPassword,
    showLogViewer,
    setShowLogViewer,
    logContent,
    logSearch,
    setLogSearch,
    logDates,
    logDay,
    selectDiagnosticDay,
    refreshDiagnosticDates,
    handleTabChange,
    loadConfig,
    handleSaveConfig,
    handleConfigChange,
    handleOpsAuthorizationSave,
    loadBuildHistory,
    deleteBuildRecord,
    clearBuildHistory,
    openArtifactPath,
    handleManualCheckUpdate,
    openDiagnosticLog,
    downloadDiagnosticLog,
    revealDiagnosticLogFile,
  };
}
