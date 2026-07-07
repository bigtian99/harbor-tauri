import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckCircle, Copy } from "lucide-react";

import { Sidebar } from "./components/Sidebar";
import { UploadPanel } from "./components/UploadPanel";
import { BranchPanel } from "./components/BranchPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LandingPanel } from "./components/LandingPanel";
import { MergePanel } from "./components/MergePanel";
import { PushImagePanel } from "./components/PushImagePanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { SettlementPanel } from "./components/SettlementPanel";
import { useLanding } from "./hooks/useLanding";
import "./App.css";

import type {
  ArtifactType, BranchProjectType, TabType, HarborConfig,
  PackageFromBranchResult, GitBranchOption, LastCommitInfo,
  CommitInfo, CommitListResult, AuthorInfo, BuildRecord
} from "./types";
import type { BranchImageResult } from "./branchImageResults";
import {
  DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE, DEFAULT_FRONTEND_NGINX_TEMPLATE,
  isTauriRuntime, inferImageName, isGitUrl, resolveHarborRepository,
  inferImageNameFromRef, getProjectName
} from "./types";
import { createBranchImageResult, getBranchPushSummary } from "./branchImageResults";
import { getRememberedBranchAdvancedSettings, rememberBranchRepoSettings } from "./branchSettings";

// 把路径加入历史记录最前（去重，上限 20）；路径为空时仅去重返回
function prependPathHistory(history: string[] | undefined, path: string): string[] {
  const trimmed = path.trim();
  const rest = (history || []).filter((p) => p !== trimmed);
  return trimmed ? [trimmed, ...rest].slice(0, 20) : rest;
}

function App() {
  // ==================== 核心状态 ====================
  const [activeTab, setActiveTab] = useState<TabType>("upload");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [opsMode, setOpsMode] = useState(false);
  const [config, setConfig] = useState<HarborConfig>({
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
  });

  // ==================== 上传推送状态 ====================
  const [artifactType, setArtifactType] = useState<ArtifactType>("jar");
  const [artifactPath, setArtifactPath] = useState<string>("");
  const [backendArtifactPath, setBackendArtifactPath] = useState<string>("");
  const [imageName, setImageName] = useState<string>("");
  const [imageTag, setImageTag] = useState<string>("latest");
  const [uploadExposePort, setUploadExposePort] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);

  // ==================== 镜像推送状态 ====================
  const [pushLocalImage, setPushLocalImage] = useState<string>("");
  const [pushImageName, setPushImageName] = useState<string>("");
  const [pushImageTag, setPushImageTag] = useState<string>("latest");
  const [pushFullImage, setPushFullImage] = useState<string>("");
  const [pushLocalImageOptions, setPushLocalImageOptions] = useState<string[]>([]);
  const [pushIsLoadingImages, setPushIsLoadingImages] = useState(false);

  // ==================== 分支打包状态 ====================
  const [repoPath, setRepoPath] = useState<string>("");
  const [frontendDir, setFrontendDir] = useState<string>("");
  const [npmScripts, setNpmScripts] = useState<string[]>([]);
  const [selectedBuildScript, setSelectedBuildScript] = useState<string>("");
  const [branchName, setBranchName] = useState<string>("");
  const [branchOptions, setBranchOptions] = useState<GitBranchOption[]>([]);
  const [branchProjectType, setBranchProjectType] = useState<BranchProjectType>("maven");
  const [worktreePath, setWorktreePath] = useState<string>("");
  const [customDockerfile, setCustomDockerfile] = useState<string>("");
  const [branchHasDockerfile, setBranchHasDockerfile] = useState(false);
  const [autoPushImage, setAutoPushImage] = useState<boolean>(false);
  const [packageWithBackend, setPackageWithBackend] = useState<boolean>(false);
  const [branchExposePort, setBranchExposePort] = useState<string>("");
  const [branchFullImage, setBranchFullImage] = useState<string>("");
  const [branchImageResults, setBranchImageResults] = useState<BranchImageResult[]>([]);
  // 上传推送菜单：推送成功后的镜像地址，独立展示，不依赖构建日志折叠框
  const [uploadFullImage, setUploadFullImage] = useState<string>("");
  const [springProfile, setSpringProfile] = useState<string>("");
  const [springProfiles, setSpringProfiles] = useState<string[]>([]);

  // ==================== 提交信息状态 ====================
  const [lastCommit, setLastCommit] = useState<LastCommitInfo | null>(null);
  const [commitList, setCommitList] = useState<CommitInfo[]>([]);
  const [commitListTotal, setCommitListTotal] = useState(0);
  const [commitListPage, setCommitListPage] = useState(1);
  const [commitListPageSize, setCommitListPageSize] = useState(10);
  const [commitAuthorFilter, setCommitAuthorFilter] = useState("");
  const [commitMessageFilter, setCommitMessageFilter] = useState("");
  const [commitAuthors, setCommitAuthors] = useState<AuthorInfo[]>([]);

  // ==================== UI 状态（合并） ====================
  const [ui, setUi] = useState({
    showImageConfig: false,
    showAdvancedSettings: false,
    showCommitListModal: false,
    showBuildLog: false,
    showPassword: false,
  });
  const updateUi = (key: keyof typeof ui, value: boolean) => setUi(prev => ({ ...prev, [key]: value }));

  // ==================== 加载状态（合并） ====================
  const [loading, setLoading] = useState({
    scripts: false,
    branches: false,
    profiles: false,
    commit: false,
    commitList: false,
    history: false,
  });
  const updateLoading = (key: keyof typeof loading, value: boolean) => setLoading(prev => ({ ...prev, [key]: value }));

  // ==================== 构建和日志状态 ====================
  const [isBuilding, setIsBuilding] = useState(false);
  const [log, setLog] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // ==================== 历史记录状态 ====================
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);

  // ==================== 配置状态 ====================
  const [configSaved, setConfigSaved] = useState(false);

  // ==================== Toast ====================
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  const toastTimerRef = useRef<number | null>(null);
  const branchLoadRequestRef = useRef(0);

  // ==================== 工具函数 ====================
  function showToast(message: string, duration = 2000) {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ show: true, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast({ show: false, message: "" });
      toastTimerRef.current = null;
    }, duration);
  }

  function restoreRememberedBranchAdvancedSettings(sourceConfig = config, sourceRepoPath = repoPath) {
    const remembered = getRememberedBranchAdvancedSettings(sourceConfig, sourceRepoPath);
    setSpringProfile(remembered.springProfile);
    setBranchExposePort(remembered.exposePort);
  }

  function isStaleBranchLoad(requestId?: number) {
    return requestId !== undefined && requestId !== branchLoadRequestRef.current;
  }

  // ==================== 落地页（状态与逻辑封装在 hook） ====================
  const landing = useLanding({
    activeTab,
    setLog,
    setProgress,
    setProgressMessage,
  });

  function renderLog(text: string) {
    const imageMatch = text.match(/完整镜像:\s*(.+)/);
    if (imageMatch) {
      const imageUrl = imageMatch[1].trim();
      const prefix = text.substring(0, text.indexOf("完整镜像:"));
      return (
        <>
          <pre>{prefix}</pre>
          <div className="image-url-row">
            <span className="image-url-label">完整镜像:</span>
            <span className="image-url-value" title={imageUrl}>{imageUrl}</span>
            <button
              className={`copy-btn ${copied ? "copied" : ""}`}
              onClick={() => handleCopyImage(imageUrl)}
              title="复制镜像地址"
            >
              {copied ? (
                <>
                  <CheckCircle size={14} /> 已复制
                </>
              ) : (
                <>
                  <Copy size={14} /> 复制
                </>
              )}
            </button>
          </div>
        </>
      );
    }
    if (text.includes("✅")) {
      return (
        <div className="success-message">
          <CheckCircle size={20} className="success-icon" />
          <pre>{text}</pre>
        </div>
      );
    }
    return <pre>{text}</pre>;
  }

  // ==================== 配置管理 ====================
  async function loadConfig() {
    if (!isTauriRuntime()) return;
    try {
      const savedConfig = await invoke<HarborConfig>("load_config");
      setConfig(savedConfig);
      setBuildHistory(savedConfig.build_history || []);
      restoreRememberedBranchAdvancedSettings(savedConfig, savedConfig.last_repo_path);
      if (savedConfig.remember_branch_settings) {
        if (savedConfig.last_repo_path) setRepoPath(savedConfig.last_repo_path);
        if (savedConfig.last_branch) setBranchName(savedConfig.last_branch);
        if (savedConfig.last_frontend_dir) setFrontendDir(savedConfig.last_frontend_dir);
        if (savedConfig.last_build_script) setSelectedBuildScript(savedConfig.last_build_script);
        if (savedConfig.last_auto_push_image !== undefined) setAutoPushImage(savedConfig.last_auto_push_image);
        if (savedConfig.last_package_with_backend !== undefined) setPackageWithBackend(savedConfig.last_package_with_backend);
        if (savedConfig.last_repo_path) {
          await loadGitBranches(savedConfig.last_repo_path, savedConfig.last_branch || undefined);
          if (savedConfig.last_branch) {
            await loadSpringProfiles(savedConfig.last_repo_path, savedConfig.last_branch);
            loadLastCommit(savedConfig.last_repo_path, savedConfig.last_branch);
          }
        }
      }
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

  // ==================== 文件和拖拽处理 ====================
  const handleDragEvents = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  async function handleSelectFile() {
    if (!isTauriRuntime()) {
      setLog("⚠️ 当前是浏览器预览环境，无法打开系统文件选择器；请在 Tauri 桌面窗口中操作");
      return;
    }
    try {
      const selected = artifactType === "jar"
        ? await open({
            multiple: false,
            filters: [{ name: "JAR Files", extensions: ["jar"] }],
          })
        : await open({
            multiple: false,
            directory: true,
            recursive: true,
            title: "选择前端 dist 目录",
          });
      if (selected) {
        handleArtifactPathSelected(selected as string);
      }
    } catch (e) {
      console.error("选择产物失败:", e);
      showToast(`选择产物失败: ${e}`);
    }
  }

  function handleArtifactPathSelected(path: string, type = artifactType) {
    setArtifactPath(path);
    const inferred = inferImageName(path, type);
    setImageName(inferred);
    // 从 SQLite 查上次对这个 JAR 用的端口
    if (type === "jar" && isTauriRuntime()) {
      invoke<string | null>("get_jar_port", { jarName: inferred }).then((port) => {
        if (port) setUploadExposePort(port);
      }).catch(() => {});
    }
  }

  function handleArtifactTypeChange(type: ArtifactType) {
    setArtifactType(type);
    setArtifactPath("");
    setLog("");
  }

  // ==================== Git 操作 ====================
  async function loadGitBranches(path: string, preserveBranch?: string) {
    const requestId = ++branchLoadRequestRef.current;
    const nextRepoPath = path.trim();
    if (!preserveBranch) {
      setBranchName("");
      setBranchOptions([]);
      setSpringProfiles([]);
      setLastCommit(null);
      setCommitList([]);
      setCommitListTotal(0);
      if (branchProjectType === "npm") {
        setNpmScripts([]);
        setSelectedBuildScript("");
      }
    }
    if (!nextRepoPath) return;
    if (!isTauriRuntime()) {
      setLog("⚠️ 当前是浏览器预览环境，无法读取本机 Git 分支；请在 Tauri 桌面窗口中操作");
      return;
    }
    updateLoading('branches', true);
    setLog("");
    try {
      // 判断是 Git URL 还是本地路径
      const isUrl = isGitUrl(nextRepoPath);
      const branches = isUrl
        ? await invoke<GitBranchOption[]>("list_git_branches_from_url", { url: nextRepoPath })
        : await invoke<GitBranchOption[]>("list_git_branches", { repoPath: nextRepoPath });
      if (isStaleBranchLoad(requestId)) return;
      setBranchOptions(branches);
      // 刷新时优先保持之前选中的分支，不存在则选第一个
      const targetBranch = preserveBranch && branches.some((b) => b.name === preserveBranch)
        ? preserveBranch
        : branches[0]?.name ?? "";
      setBranchName(targetBranch);
      if (branchProjectType === "maven" && targetBranch) {
        await loadSpringProfiles(nextRepoPath, targetBranch, requestId);
      }
      if (targetBranch && !isUrl) {
        loadLastCommit(nextRepoPath, targetBranch, requestId);
        loadCommitList(nextRepoPath, targetBranch, 1, undefined, undefined, requestId);
      }
      if (branches.length === 0) {
        setLog("⚠️ 没有读取到可用分支");
      }
      if (branchProjectType === "npm" && !isUrl) {
        try {
          const detectedDir = await invoke<string | null>("detect_frontend_dir", { repoPath: nextRepoPath });
          if (isStaleBranchLoad(requestId)) return;
          if (detectedDir) {
            setFrontendDir(detectedDir);
            loadNpmScripts(nextRepoPath, detectedDir, requestId);
          } else {
            setFrontendDir("");
            loadNpmScripts(nextRepoPath, "", requestId);
          }
        } catch {
          if (!isStaleBranchLoad(requestId)) {
            loadNpmScripts(nextRepoPath, frontendDir, requestId);
          }
        }
      }
    } catch (e) {
      if (!isStaleBranchLoad(requestId)) {
        setLog(`❌ 读取分支失败:\n${e}`);
      }
    } finally {
      if (!isStaleBranchLoad(requestId)) {
        updateLoading('branches', false);
      }
    }
  }

  async function loadSpringProfiles(repoPath: string, branch: string, branchLoadRequestId?: number) {
    if (!repoPath.trim() || !branch.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setSpringProfiles([]);
      }
      return;
    }
    updateLoading('profiles', true);
    try {
      const profiles = await invoke<string[]>("detect_spring_profiles", {
        repoPath: repoPath.trim(),
        branch: branch.trim(),
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setSpringProfiles(profiles);
      // ponytail: 检测到 test profile 时自动选中，仅在用户尚未手动选过时生效
      if (profiles.includes("test")) {
        setSpringProfile(prev => prev || "test");
      }
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      console.error("[Spring Profiles] 检测失败:", e);
      setSpringProfiles([]);
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading('profiles', false);
      }
    }
  }

  async function loadLastCommit(repoPath: string, branch: string, branchLoadRequestId?: number) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setLastCommit(null);
      }
      return;
    }
    updateLoading('commit', true);
    try {
      const commit = await invoke<LastCommitInfo>("get_last_commit", {
        repoPath: repoPath.trim(),
        branch: branch.trim() || null,
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setLastCommit(commit);
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      console.error("[Last Commit] 获取失败:", e);
      setLastCommit(null);
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading('commit', false);
      }
    }
  }

  async function loadCommitList(
    repoPath: string,
    branch: string,
    page: number = 1,
    authorFilter?: string,
    messageFilter?: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setCommitList([]);
        setCommitListTotal(0);
      }
      return;
    }
    updateLoading('commitList', true);
    try {
      const result = await invoke<CommitListResult>("get_commit_list", {
        repoPath: repoPath.trim(),
        branch: branch.trim() || null,
        page,
        pageSize: 10,
        authorFilter: authorFilter || null,
        messageFilter: messageFilter || null,
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setCommitList(result.commits);
      setCommitListTotal(result.total);
      setCommitListPage(result.page);
      setCommitListPageSize(result.page_size);
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      console.error("[Commit List] 获取失败:", e);
      setCommitList([]);
      setCommitListTotal(0);
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading('commitList', false);
      }
    }
  }

  async function loadCommitAuthors(repoPath: string, branch: string) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      setCommitAuthors([]);
      return;
    }
    try {
      const authors = await invoke<AuthorInfo[]>("get_commit_authors", {
        repoPath: repoPath.trim(),
        branch: branch.trim() || null,
      });
      setCommitAuthors(authors);
    } catch (e) {
      console.error("[Commit Authors] 获取失败:", e);
      setCommitAuthors([]);
    }
  }

  async function checkBranchDockerfile() {
    if (!isTauriRuntime() || !repoPath || !branchName.trim()) {
      setBranchHasDockerfile(false);
      return;
    }
    try {
      const has = await invoke<boolean>("check_dockerfile", {
        repoPath,
        branch: branchName.trim(),
      });
      setBranchHasDockerfile(has);
    } catch {
      setBranchHasDockerfile(false);
    }
  }

  // ==================== npm 操作 ====================
  async function loadNpmScripts(repoPath: string, frontendDir: string, branchLoadRequestId?: number) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setNpmScripts([]);
        setSelectedBuildScript("");
      }
      return;
    }
    updateLoading('scripts', true);
    try {
      const scripts = await invoke<string[]>("list_npm_scripts", {
        repoPath: repoPath.trim(),
        frontendDir: frontendDir.trim() || null,
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setNpmScripts(scripts);
      const preferred = ["build", "build:prod", "build:production", "compile", "dist"];
      const autoSelected = preferred.find(s => scripts.includes(s)) || scripts[0] || "";
      setSelectedBuildScript(autoSelected);
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setNpmScripts([]);
      setSelectedBuildScript("");
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading('scripts', false);
      }
    }
  }

  async function handleSelectRepo() {
    if (!isTauriRuntime()) {
      setLog("⚠️ 当前是浏览器预览环境，无法打开系统目录选择器；请在 Tauri 桌面窗口中操作");
      return;
    }
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        recursive: false,
        title: "选择 Git 仓库目录",
      });
      if (selected) {
        const selectedPath = selected as string;
        setRepoPath(selectedPath);
        // 切换仓库时清空镜像名称，打包时自动从产物推断
        setImageName("");
        restoreRememberedBranchAdvancedSettings(config, selectedPath);
        updateUi('showAdvancedSettings', true);
        await loadGitBranches(selectedPath);
        if (config.remember_branch_settings) {
          const newHistory = prependPathHistory(config.repo_path_history, selectedPath);
          const updatedConfig = { ...config, repo_path_history: newHistory };
          await invoke("save_config", { config: updatedConfig });
          setConfig(updatedConfig);
        }
      }
    } catch (e) {
      setLog(`❌ 选择仓库目录失败:\n${e}`);
    }
  }

  // ==================== 构建和推送 ====================
  async function handleBuildAndPush() {
    if (!isTauriRuntime()) {
      setLog("❌ 当前是浏览器预览环境，构建推送请在 Tauri 桌面窗口中操作");
      return;
    }
    if (!artifactPath) {
      setLog(artifactType === "jar" ? "⚠️ 请先选择JAR文件" : "⚠️ 请先选择前端 dist 目录");
      return;
    }
    if (!imageName) {
      setLog("⚠️ 请输入镜像名称");
      return;
    }
    if (!config.harbor_url || !config.username || !config.password || !config.project) {
      setLog("⚠️ 请先配置Harbor信息");
      setActiveTab("config");
      return;
    }
    setIsBuilding(true);
    setCopied(false);
    setProgress(0);
    setProgressMessage("🚀 开始构建和推送镜像...");
    setLog("");
    setUploadFullImage("");
    const uploadPort = artifactType === "jar" ? (uploadExposePort.trim() || config.expose_port.trim()) : "";
    const uploadImageName = uploadPort ? `${imageName}-${uploadPort}` : imageName;
    const resolvedRepo = resolveHarborRepository(uploadImageName, config.project);
    if (!resolvedRepo.ok) {
      setLog(`⚠️ ${resolvedRepo.error}`);
      return;
    }
    try {
      const result = await invoke<string>("build_and_push", {
        jarPath: artifactPath,
        imageName: uploadImageName,
        imageTag,
        artifactType,
        exposePort: uploadExposePort || null,
      });
      // 提取推送成功的镜像地址，独立展示在日志折叠框之外
      const imgMatch = result.match(/完整镜像:\s*(.+)/);
      if (imgMatch) {
        setUploadFullImage(imgMatch[1].trim());
      }
      // 完整镜像已在上方提取并独立展示，日志里不再重复显示完整镜像行，
      // 只保留成功提示 + 过程日志（过程日志由 build-progress 事件实时累积进 log）。
      const logResult = result.replace(/完整镜像:.*(\n|$)/g, '').replace(/\n{3,}/g, '\n\n').trim();
      setLog((prev) => (prev ? `${prev}\n\n${logResult}` : logResult));
      setArtifactPath("");
      setImageTag("latest");
      // 推送成功后保存 JAR 端口到 SQLite
      const jarName = artifactType === "jar" ? inferImageName(artifactPath, "jar") : null;
      if (jarName && uploadExposePort && isTauriRuntime()) {
        invoke("save_jar_port", { jarName, port: uploadExposePort }).catch(() => {});
      }
    } catch (e) {
      setLog(`❌ 推送失败:\n${e}`);
    } finally {
      setIsBuilding(false);
    }
  }

  async function handleCancelBuild() {
    try {
      await invoke("cancel_build");
    } catch { /* 忽略取消错误 */ }
    setIsBuilding(false);
  }

  // ==================== 镜像推送 ====================
  async function loadLocalImages() {
    if (!isTauriRuntime()) return;
    setPushIsLoadingImages(true);
    try {
      const images = await invoke<string[]>("list_local_images");
      setPushLocalImageOptions(images);
    } catch (e) {
      console.error("加载本地镜像列表失败:", e);
      setPushLocalImageOptions([]);
    } finally {
      setPushIsLoadingImages(false);
    }
  }

  async function handlePushImage() {
    if (!isTauriRuntime()) {
      setLog("❌ 当前是浏览器预览环境，推送请在 Tauri 桌面窗口中操作");
      return;
    }
    if (!pushLocalImage.trim()) {
      setLog("⚠️ 请输入本地镜像引用");
      return;
    }
    if (!pushImageName.trim()) {
      setLog("⚠️ 请输入目标镜像名称");
      return;
    }
    if (!config.harbor_url || !config.username || !config.password || !config.project) {
      setLog("⚠️ 请先配置Harbor信息");
      setActiveTab("config");
      return;
    }
    setIsBuilding(true);
    setCopied(false);
    setProgress(0);
    setProgressMessage("🏷️ 镜像打标签...");
    setLog("");
    setPushFullImage("");
    try {
      const result = await invoke<string>("push_local_image", {
        localImage: pushLocalImage.trim(),
        imageName: pushImageName.trim(),
        imageTag: pushImageTag.trim() || "latest",
      });
      const imgMatch = result.match(/完整镜像:\s*(.+)/);
      if (imgMatch) {
        setPushFullImage(imgMatch[1].trim());
      }
      const logResult = result.replace(/完整镜像:.*(\n|$)/g, '').replace(/\n{3,}/g, '\n\n').trim();
      setLog((prev) => (prev ? `${prev}\n\n${logResult}` : logResult));
    } catch (e) {
      setLog(`❌ 推送失败:\n${e}`);
    } finally {
      setIsBuilding(false);
    }
  }

  async function handlePackageFromBranch() {
    if (!isTauriRuntime()) {
      setLog("❌ 当前是浏览器预览环境，分支打包请在 Tauri 桌面窗口中操作");
      return;
    }
    if (!repoPath) {
      setLog("⚠️ 请先选择 Git 仓库目录");
      return;
    }
    if (!branchName.trim()) {
      setLog("⚠️ 请输入目标分支或引用");
      return;
    }
    setIsBuilding(true);
    setActiveTab("branch");
    setCopied(false);
    setProgress(0);
    setProgressMessage("⬇️ 开始更新分支代码...");
    setLog("");
    setArtifactPath("");
    setBackendArtifactPath("");
    setWorktreePath("");
    setCustomDockerfile("");
    setBranchFullImage("");
    setBranchImageResults([]);

    try {
      const result = await invoke<PackageFromBranchResult>("package_from_branch", {
        repoPath,
        branch: branchName.trim(),
        projectType: branchProjectType,
        frontendDir: branchProjectType === "npm" ? (frontendDir.trim() || null) : null,
        buildScript: branchProjectType === "npm" ? selectedBuildScript : null,
        packageManager: config.npm_package_manager || "npm",
        springProfile: (branchProjectType === "maven" || packageWithBackend) && springProfile.trim() ? springProfile.trim() : null,
        packageWithBackend: branchProjectType === "npm" ? packageWithBackend : false,
      });
      setArtifactPath(result.artifact_path);
      setBackendArtifactPath(result.backend_artifact_path || "");
      setWorktreePath(result.worktree_path);
      setCustomDockerfile(result.dockerfile_path || "");
      // 分支打包时自动推断镜像名称（setState 异步，用局部变量保证后续逻辑可用）
      // npm 前端：用仓库名，避免 worktree 时间戳目录名污染镜像名
      // Maven JAR：用 JAR 文件名推断
      const baseName = branchProjectType === "npm"
        ? getProjectName(repoPath).toLowerCase()
        : inferImageName(result.artifact_path, "jar");
      const effectiveImageName = imageName.trim() || baseName;
      const branchSafeName = branchName.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
      // 前端镜像名称：拼接分支和构建命令（如 myapp-frontend-develop-build_prod）
      const scriptSafeName = selectedBuildScript.replace(/[^a-zA-Z0-9._-]/g, '-');
      const frontendDistSuffix = branchProjectType === "npm"
        ? `-frontend-${branchSafeName}-${scriptSafeName}`
        : "";
      const frontendImageName = `${effectiveImageName}${frontendDistSuffix}`;
      // 后端镜像名称：拼接端口号和 Spring Profile（如 myapp-8181-test、myapp-backend-8181-test）
      const effectivePort = branchExposePort.trim() || config.expose_port.trim();
      const portSuffix = effectivePort ? `-${effectivePort}` : "";
      const profileSuffix = springProfile.trim() ? `-${springProfile.trim()}` : "";
      const backendImageName = (branchProjectType === "npm" && result.backend_artifact_path)
        ? `${effectiveImageName}-backend${portSuffix}${profileSuffix}`
        : branchProjectType === "maven"
          ? `${effectiveImageName}${portSuffix}${profileSuffix}`
          : effectiveImageName;
      setImageName(effectiveImageName);
      await saveBranchSettings();
      await loadBuildHistory();
      setActiveTab("branch");

      if (autoPushImage) {
        if (!config.harbor_url || !config.username || !config.password || !config.project) {
          setLog(`⚠️ 分支打包成功，但 Harbor 配置不完整，无法推送镜像\n\n请在"推送配置" tab 中完善 Harbor 配置后重试\n\n${result.log}`);
        } else {
          const hasBackend = !!result.backend_artifact_path;
          const now = new Date();
          const yy = String(now.getFullYear()).slice(-2);
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const hh = String(now.getHours()).padStart(2, '0');
          const mi = String(now.getMinutes()).padStart(2, '0');
          const branchImageTag = (imageTag && imageTag !== "latest")
            ? imageTag
            : `${branchSafeName}-v.${yy}.${mm}.${dd}.${hh}.${mi}`;

          if (!effectiveImageName) {
            setLog(`⚠️ 分支打包成功，但未设置镜像名称，跳过推送\n\n${result.log}`);
          } else {
            const namesToPush = branchProjectType === "maven"
              ? [backendImageName]
              : hasBackend
                ? [frontendImageName, backendImageName]
                : [frontendImageName];
            const invalidName = namesToPush.find((name) => !resolveHarborRepository(name, config.project).ok);
            if (invalidName) {
              const err = resolveHarborRepository(invalidName, config.project);
              setLog(`⚠️ 分支打包成功，但镜像名不符合 Harbor 要求，跳过推送\n\n${err.ok ? "" : err.error}\n\n${result.log}`);
            } else {
            const pushLogs: string[] = [];
            const imageList: string[] = [];

            try {
              // ===== Maven 项目：只推 JAR =====
              if (branchProjectType === "maven") {
                setProgress(60);
                setProgressMessage("🚀 推送镜像...");
                const resultStr = await invoke<string>("build_and_push", {
                  jarPath: result.artifact_path,
                  imageName: backendImageName,
                  imageTag: branchImageTag,
                  artifactType: "jar",
                  dockerfilePath: null,
                  dockerfileContext: null,
                  exposePort: branchExposePort || null,
                });
                pushLogs.push(`📦: ${resultStr}`);
                const imgMatch = resultStr.match(/完整镜像:\s*(.+)/);
                if (imgMatch) {
                  const image = imgMatch[1].trim();
                  imageList.push(image);
                  setBranchImageResults([createBranchImageResult("backend", image)]);
                  try {
                    await invoke("update_build_record_image", {
                      imageName: backendImageName,
                      imageTag: image,
                    });
                    await loadBuildHistory();
                  } catch { /* 忽略 */ }
                }
                setBranchFullImage(imageList.join("\n"));
                setLog(`✅ 分支打包并推送镜像完成\n\n${result.log}\n\n${pushLogs.join("\n")}`);
                setActiveTab("branch");
                return;
              }

              // ===== NPM 项目：先推前端 =====
              setProgress(60);
              setProgressMessage("🚀 推送前端镜像...");
              try {
                const feResult = await invoke<string>("build_and_push", {
                  jarPath: result.artifact_path,
                  imageName: frontendImageName,
                  imageTag: branchImageTag,
                  artifactType: "frontend_dist",
                  dockerfilePath: null,
                  dockerfileContext: null,
                });
                pushLogs.push(`📦 前端: ${feResult}`);
                const feMatch = feResult.match(/完整镜像:\s*(.+)/);
                if (feMatch) {
                  const image = feMatch[1].trim();
                  imageList.push(`前端: ${image}`);
                  setBranchImageResults([createBranchImageResult("frontend", image)]);
                  try {
                    await invoke("update_build_record_image", {
                      imageName: effectiveImageName,
                      imageTag: image,
                    });
                    await loadBuildHistory();
                  } catch { /* 忽略 */ }
                }
              } catch (feErr) {
                pushLogs.push(`❌ 前端推送失败: ${feErr}`);
              }

              // ===== 有后端时再接续推后端 =====
              if (hasBackend) {
                setProgress(80);
                setProgressMessage("🚀 推送后端 JAR 镜像...");
                try {
                  const beResult = await invoke<string>("build_and_push", {
                    jarPath: result.backend_artifact_path,
                    imageName: backendImageName,
                    imageTag: branchImageTag,
                    artifactType: "jar",
                    dockerfilePath: null,
                    dockerfileContext: null,
                    exposePort: branchExposePort || null,
                  });
                  pushLogs.push(`📦 后端: ${beResult}`);
                  const beMatch = beResult.match(/完整镜像:\s*(.+)/);
                  if (beMatch) {
                    const image = beMatch[1].trim();
                    imageList.push(`后端: ${image}`);
                    setBranchImageResults((prev) => [...prev, createBranchImageResult("backend", image)]);
                  }
                } catch (beErr) {
                  pushLogs.push(`❌ 后端推送失败: ${beErr}`);
                }
              }

              // 设置展示用的镜像地址
              setBranchFullImage(imageList.join("\n"));

              // 判断整体是否成功
              setLog(`${getBranchPushSummary(pushLogs, hasBackend)}\n\n${result.log}\n\n${pushLogs.join("\n")}`);
              setActiveTab("branch");
            } catch (pushErr) {
              setLog(`⚠️ 分支打包成功，但镜像推送失败:\n${pushErr}\n\n${result.log}`);
              setActiveTab("branch");
            }
            }
          }
        }
      }
    } catch (e) {
      setLog(`❌ 打包失败:\n${e}`);
    } finally {
      setIsBuilding(false);
    }
  }

  async function saveBranchSettings() {
    if (!isTauriRuntime() || !config.remember_branch_settings) return;
    try {
      const newHistory = prependPathHistory(config.repo_path_history, repoPath);
      const updatedConfig = rememberBranchRepoSettings({
        ...config,
        last_repo_path: repoPath,
        last_branch: branchName.trim(),
        last_frontend_dir: frontendDir.trim(),
        last_build_script: selectedBuildScript,
        last_project_type: branchProjectType,
        last_auto_push_image: autoPushImage,
        last_package_with_backend: packageWithBackend,
        last_spring_profile: springProfile,
        last_expose_port: branchExposePort,
        repo_path_history: newHistory,
      }, repoPath, {
        springProfile,
        exposePort: branchExposePort,
      });
      await invoke("save_config", { config: updatedConfig });
      setConfig(updatedConfig);
    } catch (e) {
      console.error("保存分支设置失败:", e);
      showToast(`保存分支设置失败: ${e}`);
    }
  }

  // ==================== 历史记录操作 ====================
  async function loadBuildHistory() {
    if (!isTauriRuntime()) return;
    updateLoading('history', true);
    try {
      const history = await invoke<BuildRecord[]>("get_build_history");
      setBuildHistory(history);
      setConfig(prev => ({ ...prev, build_history: history }));
    } catch (e) {
      console.error("[Build History] 获取失败:", e);
    } finally {
      updateLoading('history', false);
    }
  }

  async function deleteBuildRecord(record: BuildRecord) {
    if (!isTauriRuntime()) return;
    try {
      await invoke("delete_build_record", { recordId: record.id });
      await deleteArtifactFiles(record.artifact_path);
      if (record.backend_artifact_path) {
        await deleteArtifactFiles(record.backend_artifact_path);
      }
      setBuildHistory(prev => prev.filter(r => r.id !== record.id));
    } catch (e) {
      console.error("[Delete Record] 删除失败:", e);
      showToast(`删除记录失败: ${e}`);
    }
  }

  async function clearBuildHistory() {
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
      showToast(`清空历史失败: ${e}`);
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

  async function openArtifactPath(path: string) {
    if (!isTauriRuntime()) {
      showToast("浏览器环境下无法打开目录");
      return;
    }
    try {
      await invoke("open_directory", { path });
    } catch (e) {
      showToast(`打开失败: ${e}`);
    }
  }

  async function handleCopyImage(imageUrl: string) {
    try {
      await navigator.clipboard.writeText(imageUrl);
      setCopied(true);
      showToast("镜像地址已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("复制失败:", e);
      showToast(`复制失败: ${e}`);
    }
  }

  // ==================== Effects ====================
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!log) {
      updateUi('showBuildLog', false);
    } else if (log.includes("❌")) {
      updateUi('showBuildLog', true);
    }
  }, [log]);

  useEffect(() => {
    loadConfig();
    if (!isTauriRuntime()) return;

    // 检查是否为运营版构建（编译时注入 OPS_MODE=true）
    invoke<boolean>("is_ops_mode").then((ops) => {
      if (ops) {
        setOpsMode(true);
        setActiveTab("landing");
      }
    }).catch(() => {/* 非 Tauri 环境忽略 */});

    const appWindow = getCurrentWindow();
    const unlistenProgress = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        setProgress(event.payload.percent);
        setProgressMessage(event.payload.message);
        // 累积构建/推送过程日志，让"展开构建日志"能看到打包镜像、推送镜像等过程，
        // 而不是只看到最终一句成功提示。各流程结束时仍会 setLog 覆盖/追加最终结果。
        setLog((prev) => (prev ? `${prev}\n${event.payload.message}` : event.payload.message));
      }
    );

    const unlistenDrag = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (activeTab === "branch") {
          if (paths[0]) {
            setRepoPath(paths[0]);
            // 切换仓库时清空镜像名称，打包时自动从产物推断
            setImageName("");
            loadGitBranches(paths[0]);
          } else {
            setLog("⚠️ 请拖入 Git 仓库目录");
          }
        } else if (artifactType === "jar") {
          const jarFile = paths.find((p) => p.toLowerCase().endsWith(".jar"));
          if (jarFile) {
            handleArtifactPathSelected(jarFile, "jar");
          } else {
            setLog("⚠️ 请拖入 .jar 文件");
          }
        } else if (paths[0]) {
          handleArtifactPathSelected(paths[0], "frontend_dist");
        } else {
          setLog("⚠️ 请拖入前端 dist 目录");
        }
      } else {
        setIsDragOver(false);
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenDrag.then((fn) => fn());
    };
  }, [activeTab, artifactType, imageName]);

  useEffect(() => {
    if (activeTab === "history" && isTauriRuntime()) {
      loadBuildHistory();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "push" && isTauriRuntime()) {
      loadLocalImages();
    }
  }, [activeTab]);

  // 选择本地镜像后自动推断目标镜像名称和标签
  useEffect(() => {
    if (pushLocalImage.trim()) {
      const { name, tag } = inferImageNameFromRef(pushLocalImage);
      if (name) setPushImageName(name);
      if (tag) setPushImageTag(tag);
    }
  }, [pushLocalImage]);

  useEffect(() => {
    checkBranchDockerfile();
  }, [repoPath, branchName]);

  // ==================== 分支打包回调 ====================
  function handleBranchProjectTypeChange(type: BranchProjectType) {
    setBranchProjectType(type);
    setNpmScripts([]);
    setSelectedBuildScript("");
    if (type === "npm" && repoPath) {
      (async () => {
        try {
          const detectedDir = await invoke<string | null>("detect_frontend_dir", { repoPath });
          if (detectedDir) {
            setFrontendDir(detectedDir);
            loadNpmScripts(repoPath, detectedDir);
          } else {
            setFrontendDir("");
            loadNpmScripts(repoPath, "");
          }
        } catch {
          loadNpmScripts(repoPath, frontendDir);
        }
      })();
    }
  }

  function handleRepoPathChange(value: string) {
    setRepoPath(value);
    if (value.trim()) {
      // 切换仓库时清空镜像名称，打包时自动从产物推断
      setImageName("");
      restoreRememberedBranchAdvancedSettings(config, value);
      loadGitBranches(value);
    } else {
      setBranchOptions([]);
      setBranchName("");
      setImageName("");
      setBranchExposePort("");
      setSpringProfile("");
    }
  }

  async function handleBranchChange(value: string) {
    setBranchName(value);
    setSpringProfile("");
    if (value.trim() && repoPath) {
      await loadSpringProfiles(repoPath, value);
      if (!isGitUrl(repoPath)) {
        loadLastCommit(repoPath, value);
        loadCommitList(repoPath, value, 1);
      }
    } else {
      setSpringProfiles([]);
      setLastCommit(null);
      setCommitList([]);
      setCommitListTotal(0);
    }
  }

  function handleRememberSettingsChange(checked: boolean) {
    setConfig((prev) => ({ ...prev, remember_branch_settings: checked }));
    if (checked) {
      const newHistory = prependPathHistory(config.repo_path_history, repoPath);
      const updatedConfig = rememberBranchRepoSettings({
        ...config,
        remember_branch_settings: true,
        last_repo_path: repoPath,
        last_branch: branchName.trim(),
        last_frontend_dir: frontendDir.trim(),
        last_build_script: selectedBuildScript,
        last_project_type: branchProjectType,
        last_auto_push_image: autoPushImage,
        last_package_with_backend: packageWithBackend,
        last_spring_profile: springProfile,
        last_expose_port: branchExposePort,
        repo_path_history: newHistory,
      }, repoPath, {
        springProfile,
        exposePort: branchExposePort,
      });
      invoke("save_config", { config: updatedConfig }).then(() => {
        setConfig(updatedConfig);
      });
    }
  }

  // ==================== 渲染 ====================
  return (
    <div className="app">
      <Sidebar
        activeTab={activeTab}
        sidebarCollapsed={sidebarCollapsed}
        opsMode={opsMode}
        onTabChange={setActiveTab}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <main className="content">
        {activeTab === "upload" && (
          <UploadPanel
            artifactType={artifactType}
            artifactPath={artifactPath}
            imageName={imageName}
            imageTag={imageTag}
            exposePort={uploadExposePort}
            isDragOver={isDragOver}
            isBuilding={isBuilding}
            showImageConfig={ui.showImageConfig}
            showBuildLog={ui.showBuildLog}
            progress={progress}
            progressMessage={progressMessage}
            log={log}
            fullImage={uploadFullImage}
            copied={copied}
            onCopyImage={handleCopyImage}
            onArtifactTypeChange={handleArtifactTypeChange}
            onSelectFile={handleSelectFile}
            onBuildAndPush={handleBuildAndPush}
            onCancelBuild={handleCancelBuild}
            onDragOver={handleDragEvents}
            onDragLeave={handleDragEvents}
            onDrop={handleDragEvents}
            setImageName={setImageName}
            setImageTag={setImageTag}
            setExposePort={setUploadExposePort}
            setShowImageConfig={(v: boolean) => updateUi('showImageConfig', v)}
            setShowBuildLog={(v: boolean) => updateUi('showBuildLog', v)}
            renderLog={renderLog}
          />
        )}

        {activeTab === "push" && (
          <PushImagePanel
            localImage={pushLocalImage}
            localImageOptions={pushLocalImageOptions}
            isLoadingImages={pushIsLoadingImages}
            imageName={pushImageName}
            imageTag={pushImageTag}
            isBuilding={isBuilding}
            showImageConfig={ui.showImageConfig}
            showBuildLog={ui.showBuildLog}
            progress={progress}
            progressMessage={progressMessage}
            log={log}
            fullImage={pushFullImage}
            copied={copied}
            onCopyImage={handleCopyImage}
            onPushImage={handlePushImage}
            onCancelBuild={handleCancelBuild}
            onRefreshImages={loadLocalImages}
            setLocalImage={setPushLocalImage}
            setImageName={setPushImageName}
            setImageTag={setPushImageTag}
            setShowImageConfig={(v: boolean) => updateUi('showImageConfig', v)}
            setShowBuildLog={(v: boolean) => updateUi('showBuildLog', v)}
            renderLog={renderLog}
          />
        )}

        {activeTab === "branch" && (
          <BranchPanel
            branchProjectType={branchProjectType}
            repoPath={repoPath}
            branchName={branchName}
            branchOptions={branchOptions}
            isLoadingBranches={loading.branches}
            frontendDir={frontendDir}
            npmScripts={npmScripts}
            selectedBuildScript={selectedBuildScript}
            isLoadingScripts={loading.scripts}
            packageWithBackend={packageWithBackend}
            springProfile={springProfile}
            springProfiles={springProfiles}
            isLoadingProfiles={loading.profiles}
            lastCommit={lastCommit}
            isLoadingCommit={loading.commit}
            commitList={commitList}
            commitListTotal={commitListTotal}
            showCommitListModal={ui.showCommitListModal}
            artifactPath={artifactPath}
            backendArtifactPath={backendArtifactPath}
            worktreePath={worktreePath}
            customDockerfile={customDockerfile}
            branchHasDockerfile={branchHasDockerfile}
            isBuilding={isBuilding}
            autoPushImage={autoPushImage}
            branchFullImage={branchFullImage}
            branchImageResults={branchImageResults}
            imageName={imageName}
            imageTag={imageTag}
            exposePort={branchExposePort}
            showAdvancedSettings={ui.showAdvancedSettings}
            config={config}
            progress={progress}
            progressMessage={progressMessage}
            log={log}
            showBuildLog={ui.showBuildLog}
            copied={copied}
            onBranchProjectTypeChange={handleBranchProjectTypeChange}
            onRepoPathChange={handleRepoPathChange}
            onSelectRepo={handleSelectRepo}
            onRefreshBranches={() => loadGitBranches(repoPath, branchName)}
            onBranchChange={handleBranchChange}
            onFrontendDirChange={(dir) => {
              setFrontendDir(dir);
              if (repoPath) loadNpmScripts(repoPath, dir);
            }}
            onSelectedBuildScriptChange={setSelectedBuildScript}
            onPackageWithBackendChange={setPackageWithBackend}
            onSpringProfileChange={setSpringProfile}
            onAutoPushImageChange={setAutoPushImage}
            onRememberSettingsChange={handleRememberSettingsChange}
            setShowCommitListModal={(v: boolean) => updateUi('showCommitListModal', v)}
            loadCommitList={loadCommitList}
            loadCommitAuthors={loadCommitAuthors}
            commitAuthors={commitAuthors}
            isLoadingCommitList={loading.commitList}
            commitListPage={commitListPage}
            commitListPageSize={commitListPageSize}
            commitAuthorFilter={commitAuthorFilter}
            commitMessageFilter={commitMessageFilter}
            setCommitAuthorFilter={setCommitAuthorFilter}
            setCommitMessageFilter={setCommitMessageFilter}
            onPackageFromBranch={handlePackageFromBranch}
            onCancelBuild={handleCancelBuild}
            onOpenDirectory={openArtifactPath}
            onCopyImage={handleCopyImage}
            setImageName={setImageName}
            setImageTag={setImageTag}
            setExposePort={setBranchExposePort}
            setShowAdvancedSettings={(v: boolean) => updateUi('showAdvancedSettings', v)}
            setShowBuildLog={(v: boolean) => updateUi('showBuildLog', v)}
            renderLog={renderLog}
          />
        )}

        {activeTab === "history" && (
          <HistoryPanel
            buildHistory={buildHistory}
            isLoadingHistory={loading.history}
            expandedRecordId={null}
            collapsedProjects={new Set()}
            historySearch=""
            onLoadHistory={loadBuildHistory}
            onClearHistory={clearBuildHistory}
            onDeleteRecord={deleteBuildRecord}
            onOpenArtifact={openArtifactPath}
            onCopyImage={handleCopyImage}
          />
        )}

        {activeTab === "merge" && (
          <MergePanel
            config={config}
            onOpenDirectory={openArtifactPath}
          />
        )}

        {activeTab === "landing" && (
          <LandingPanel
            landingIds={landing.landingIds}
            landingPreviewData={landing.landingPreviewData}
            landingGenerated={landing.landingGenerated}
            ftpUploadResults={landing.ftpUploadResults}
            templateIndices={landing.templateIndices}
            isFetchingPreview={landing.isFetchingPreview}
            isGenerating={landing.isGenerating}
            isUploadingToFtp={landing.isUploadingToFtp}
            progress={progress}
            progressMessage={progressMessage}
            landingOutputDir={landing.landingOutputDir}
            previewBaseUrl={landing.previewBaseUrl}
            setLandingIds={landing.setLandingIds}
            setTemplateIndices={landing.setTemplateIndices}
            onPreview={landing.handleLandingPreview}
            onFtpUpload={landing.handleFtpUpload}
            onCopyAllLinks={landing.handleCopyAllLinks}
          />
        )}

        {activeTab === "settlement" && (
          <SettlementPanel />
        )}

        {activeTab === "config" && (
          <ConfigPanel
            config={config}
            configSaved={configSaved}
            showPassword={ui.showPassword}
            onConfigChange={handleConfigChange}
            onSaveConfig={handleSaveConfig}
            onTogglePassword={() => updateUi('showPassword', !ui.showPassword)}
          />
        )}
      </main>

      {toast.show && (
        <div className="toast">
          <CheckCircle size={16} />
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
