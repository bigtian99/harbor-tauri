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
import { ConfigPanel } from "./components/ConfigPanel";
import "./App.css";

import type {
  ArtifactType, BranchProjectType, TabType, HarborConfig,
  PackageFromBranchResult, GitBranchOption, LastCommitInfo,
  CommitInfo, CommitListResult, AuthorInfo, BuildRecord,
  SubChannelData, LandingPageResult, FtpUploadResult
} from "./types";
import {
  DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE, DEFAULT_FRONTEND_NGINX_TEMPLATE,
  isTauriRuntime, inferImageName
} from "./types";

function App() {
  // ==================== 核心状态 ====================
  const [activeTab, setActiveTab] = useState<TabType>("upload");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [config, setConfig] = useState<HarborConfig>({
    harbor_url: "dockerhub.kubekey.local",
    username: "",
    password: "",
    project: "tksy-admin",
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
    repo_path_history: [],
    npm_package_manager: "npm",
    npm_registry: "",
    artifact_output_dir: "",
    build_history: [],
  });

  // ==================== 上传推送状态 ====================
  const [artifactType, setArtifactType] = useState<ArtifactType>("jar");
  const [artifactPath, setArtifactPath] = useState<string>("");
  const [backendArtifactPath, setBackendArtifactPath] = useState<string>("");
  const [imageName, setImageName] = useState<string>("");
  const [imageTag, setImageTag] = useState<string>("latest");
  const [isDragOver, setIsDragOver] = useState(false);
  const [showImageConfig, setShowImageConfig] = useState(false);

  // ==================== 分支打包状态 ====================
  const [repoPath, setRepoPath] = useState<string>("");
  const [frontendDir, setFrontendDir] = useState<string>("");
  const [npmScripts, setNpmScripts] = useState<string[]>([]);
  const [selectedBuildScript, setSelectedBuildScript] = useState<string>("");
  const [isLoadingScripts, setIsLoadingScripts] = useState(false);
  const [branchName, setBranchName] = useState<string>("");
  const [branchOptions, setBranchOptions] = useState<GitBranchOption[]>([]);
  const [branchProjectType, setBranchProjectType] = useState<BranchProjectType>("maven");
  const [worktreePath, setWorktreePath] = useState<string>("");
  const [customDockerfile, setCustomDockerfile] = useState<string>("");
  const [branchHasDockerfile, setBranchHasDockerfile] = useState(false);
  const [autoPushImage, setAutoPushImage] = useState<boolean>(false);
  const [packageWithBackend, setPackageWithBackend] = useState<boolean>(false);
  const [branchFullImage, setBranchFullImage] = useState<string>("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [springProfile, setSpringProfile] = useState<string>("");
  const [springProfiles, setSpringProfiles] = useState<string[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // ==================== 提交信息状态 ====================
  const [lastCommit, setLastCommit] = useState<LastCommitInfo | null>(null);
  const [isLoadingCommit, setIsLoadingCommit] = useState(false);
  const [commitList, setCommitList] = useState<CommitInfo[]>([]);
  const [commitListTotal, setCommitListTotal] = useState(0);
  const [commitListPage, setCommitListPage] = useState(1);
  const [isLoadingCommitList, setIsLoadingCommitList] = useState(false);
  const [commitAuthorFilter, setCommitAuthorFilter] = useState("");
  const [commitMessageFilter, setCommitMessageFilter] = useState("");
  const [commitAuthors, setCommitAuthors] = useState<AuthorInfo[]>([]);
  const [showCommitListModal, setShowCommitListModal] = useState(false);

  // ==================== 构建和日志状态 ====================
  const [isBuilding, setIsBuilding] = useState(false);
  const [log, setLog] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [showBuildLog, setShowBuildLog] = useState(false);
  const [copied, setCopied] = useState(false);

  // ==================== 历史记录状态 ====================
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedRecordId] = useState<string | null>(null);
  const [collapsedProjects] = useState<Set<string>>(new Set());
  const [historySearch] = useState("");

  // ==================== 落地页状态 ====================
  const landingApiUrl = "https://tksyadmin.tiankongshuyu.cn";
  const [landingTemplateBase, setLandingTemplateBase] = useState("/Users/daijunxiong/Desktop/tksy-h5-app");
  const [landingIds, setLandingIds] = useState("");
  const [landingOutputDir, setLandingOutputDir] = useState("");
  const [landingPreviewData, setLandingPreviewData] = useState<SubChannelData[]>([]);
  const [landingGenerated, setLandingGenerated] = useState<Record<string, LandingPageResult>>({});
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [ftpUploadResults, setFtpUploadResults] = useState<Record<string, FtpUploadResult>>({});
  const [isUploadingToFtp, setIsUploadingToFtp] = useState(false);
  const landingDebounceRef = useRef<number | null>(null);

  // ==================== 配置状态 ====================
  const [configSaved, setConfigSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ==================== Toast ====================
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  const toastTimerRef = useRef<number | null>(null);

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
      if (savedConfig.remember_branch_settings) {
        if (savedConfig.last_repo_path) setRepoPath(savedConfig.last_repo_path);
        if (savedConfig.last_branch) setBranchName(savedConfig.last_branch);
        if (savedConfig.last_frontend_dir) setFrontendDir(savedConfig.last_frontend_dir);
        if (savedConfig.last_build_script) setSelectedBuildScript(savedConfig.last_build_script);
        if (savedConfig.last_auto_push_image !== undefined) setAutoPushImage(savedConfig.last_auto_push_image);
        if (savedConfig.last_package_with_backend !== undefined) setPackageWithBackend(savedConfig.last_package_with_backend);
        if (savedConfig.last_repo_path) {
          await loadGitBranches(savedConfig.last_repo_path);
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
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
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
    }
  }

  function handleArtifactPathSelected(path: string, type = artifactType) {
    setArtifactPath(path);
    if (!imageName) {
      setImageName(inferImageName(path, type));
    }
  }

  function handleArtifactTypeChange(type: ArtifactType) {
    setArtifactType(type);
    setArtifactPath("");
    setLog("");
  }

  // ==================== Git 操作 ====================
  async function loadGitBranches(path: string) {
    const nextRepoPath = path.trim();
    setBranchOptions([]);
    setBranchName("");
    if (!nextRepoPath) return;
    if (!isTauriRuntime()) {
      setLog("⚠️ 当前是浏览器预览环境，无法读取本机 Git 分支；请在 Tauri 桌面窗口中操作");
      return;
    }
    setIsLoadingBranches(true);
    setLog("");
    try {
      const branches = await invoke<GitBranchOption[]>("list_git_branches", { repoPath: nextRepoPath });
      setBranchOptions(branches);
      const firstBranch = branches[0]?.name ?? "";
      setBranchName(firstBranch);
      if (branchProjectType === "maven" && firstBranch) {
        await loadSpringProfiles(nextRepoPath, firstBranch);
      }
      if (firstBranch) {
        loadLastCommit(nextRepoPath, firstBranch);
        loadCommitList(nextRepoPath, firstBranch, 1);
      }
      if (branches.length === 0) {
        setLog("⚠️ 没有读取到可用分支");
      }
      if (branchProjectType === "npm") {
        try {
          const detectedDir = await invoke<string | null>("detect_frontend_dir", { repoPath: nextRepoPath });
          if (detectedDir) {
            setFrontendDir(detectedDir);
            loadNpmScripts(nextRepoPath, detectedDir);
          } else {
            setFrontendDir("");
            loadNpmScripts(nextRepoPath, "");
          }
        } catch {
          loadNpmScripts(nextRepoPath, frontendDir);
        }
      }
    } catch (e) {
      setLog(`❌ 读取分支失败:\n${e}`);
    } finally {
      setIsLoadingBranches(false);
    }
  }

  async function loadSpringProfiles(repoPath: string, branch: string) {
    if (!repoPath.trim() || !branch.trim() || !isTauriRuntime()) {
      setSpringProfiles([]);
      return;
    }
    setIsLoadingProfiles(true);
    try {
      const profiles = await invoke<string[]>("detect_spring_profiles", {
        repoPath: repoPath.trim(),
        branch: branch.trim(),
      });
      setSpringProfiles(profiles);
    } catch (e) {
      console.error("[Spring Profiles] 检测失败:", e);
      setSpringProfiles([]);
    } finally {
      setIsLoadingProfiles(false);
    }
  }

  async function loadLastCommit(repoPath: string, branch: string) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      setLastCommit(null);
      return;
    }
    setIsLoadingCommit(true);
    try {
      const commit = await invoke<LastCommitInfo>("get_last_commit", {
        repoPath: repoPath.trim(),
        branch: branch.trim() || null,
      });
      setLastCommit(commit);
    } catch (e) {
      console.error("[Last Commit] 获取失败:", e);
      setLastCommit(null);
    } finally {
      setIsLoadingCommit(false);
    }
  }

  async function loadCommitList(repoPath: string, branch: string, page: number = 1, authorFilter?: string, messageFilter?: string) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      setCommitList([]);
      setCommitListTotal(0);
      return;
    }
    setIsLoadingCommitList(true);
    try {
      const result = await invoke<CommitListResult>("get_commit_list", {
        repoPath: repoPath.trim(),
        branch: branch.trim() || null,
        page,
        pageSize: 10,
        authorFilter: authorFilter || null,
        messageFilter: messageFilter || null,
      });
      setCommitList(result.commits);
      setCommitListTotal(result.total);
      setCommitListPage(result.page);
    } catch (e) {
      console.error("[Commit List] 获取失败:", e);
      setCommitList([]);
      setCommitListTotal(0);
    } finally {
      setIsLoadingCommitList(false);
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
  async function loadNpmScripts(repoPath: string, frontendDir: string) {
    if (!repoPath.trim() || !isTauriRuntime()) {
      setNpmScripts([]);
      setSelectedBuildScript("");
      return;
    }
    setIsLoadingScripts(true);
    try {
      const scripts = await invoke<string[]>("list_npm_scripts", {
        repoPath: repoPath.trim(),
        frontendDir: frontendDir.trim() || null,
      });
      setNpmScripts(scripts);
      const preferred = ["build", "build:prod", "build:production", "compile", "dist"];
      const autoSelected = preferred.find(s => scripts.includes(s)) || scripts[0] || "";
      setSelectedBuildScript(autoSelected);
    } catch (e) {
      setNpmScripts([]);
      setSelectedBuildScript("");
    } finally {
      setIsLoadingScripts(false);
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
        await loadGitBranches(selectedPath);
        if (config.remember_branch_settings) {
          const history = (config.repo_path_history || []).filter((p) => p !== selectedPath);
          const newHistory = [selectedPath, ...history].slice(0, 20);
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
    try {
      const result = await invoke<string>("build_and_push", {
        jarPath: artifactPath,
        imageName,
        imageTag,
        artifactType,
      });
      setLog(result);
      setArtifactPath("");
      setImageTag("latest");
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

    try {
      const result = await invoke<PackageFromBranchResult>("package_from_branch", {
        repoPath,
        branch: branchName.trim(),
        projectType: branchProjectType,
        frontendDir: branchProjectType === "npm" ? (frontendDir.trim() || null) : null,
        buildScript: branchProjectType === "npm" ? selectedBuildScript : null,
        packageManager: config.npm_package_manager || "npm",
        springProfile: branchProjectType === "maven" && springProfile.trim() ? springProfile.trim() : null,
        packageWithBackend: branchProjectType === "npm" ? packageWithBackend : false,
      });
      setArtifactPath(result.artifact_path);
      setBackendArtifactPath(result.backend_artifact_path || "");
      setWorktreePath(result.worktree_path);
      setCustomDockerfile(result.dockerfile_path || "");
      await saveBranchSettings();
      await loadBuildHistory();
      setActiveTab("branch");

      if (autoPushImage) {
        if (!config.harbor_url || !config.username || !config.password || !config.project) {
          setLog(`⚠️ 分支打包成功，但 Harbor 配置不完整，无法推送镜像\n\n请在"推送配置" tab 中完善 Harbor 配置后重试\n\n${result.log}`);
        } else {
          const hasBackend = !!result.backend_artifact_path;
          const artType = hasBackend ? "jar" : (branchProjectType === "npm" ? "frontend_dist" : "jar");
          const pushPath = hasBackend ? result.backend_artifact_path! : result.artifact_path;
          const finalImageName = imageName || inferImageName(pushPath, artType);
          if (!finalImageName.trim()) {
            setLog(`⚠️ 分支打包成功，但未设置镜像名称，跳过推送\n\n${result.log}`);
          } else {
            setProgress(60);
            setProgressMessage(hasBackend ? "🚀 前端+后端打包完成，推送后端 JAR 镜像..." : "🚀 打包完成，开始推送镜像...");
            try {
              const branchSafeName = branchName.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
              const now = new Date();
              const yy = String(now.getFullYear()).slice(-2);
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              const dd = String(now.getDate()).padStart(2, '0');
              const hh = String(now.getHours()).padStart(2, '0');
              const mi = String(now.getMinutes()).padStart(2, '0');
              const branchImageTag = (imageTag && imageTag !== "latest")
                ? imageTag
                : `${branchSafeName}-v.${yy}.${mm}.${dd}.${hh}.${mi}`;
              const pushResult = await invoke<string>("build_and_push", {
                jarPath: pushPath,
                imageName: finalImageName,
                imageTag: branchImageTag,
                artifactType: artType,
                dockerfilePath: result.dockerfile_path || null,
                dockerfileContext: result.dockerfile_context || null,
              });
              const imageMatch = pushResult.match(/完整镜像:\s*(.+)/);
              if (imageMatch) {
                const fullImage = imageMatch[1].trim();
                setBranchFullImage(fullImage);
                try {
                  await invoke("update_build_record_image", {
                    imageName: finalImageName,
                    imageTag: fullImage,
                  });
                  await loadBuildHistory();
                } catch { /* 更新记录失败不影响主流程 */ }
              }
              setLog(`✅ 分支打包并推送镜像完成\n\n${result.log}\n\n📦 镜像推送: ${pushResult}`);
              setActiveTab("branch");
            } catch (pushErr) {
              setLog(`⚠️ 分支打包成功，但镜像推送失败:\n${pushErr}\n\n${result.log}`);
              setActiveTab("branch");
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
      const history = (config.repo_path_history || []).filter((p) => p !== repoPath);
      const newHistory = repoPath.trim() ? [repoPath, ...history].slice(0, 20) : history;
      const updatedConfig = {
        ...config,
        last_repo_path: repoPath,
        last_branch: branchName.trim(),
        last_frontend_dir: frontendDir.trim(),
        last_build_script: selectedBuildScript,
        last_project_type: branchProjectType,
        last_auto_push_image: autoPushImage,
        last_package_with_backend: packageWithBackend,
        repo_path_history: newHistory,
      };
      await invoke("save_config", { config: updatedConfig });
      setConfig(updatedConfig);
    } catch (e) {
      console.error("保存分支设置失败:", e);
    }
  }

  // ==================== 历史记录操作 ====================
  async function loadBuildHistory() {
    if (!isTauriRuntime()) return;
    setIsLoadingHistory(true);
    try {
      const history = await invoke<BuildRecord[]>("get_build_history");
      setBuildHistory(history);
      setConfig(prev => ({ ...prev, build_history: history }));
    } catch (e) {
      console.error("[Build History] 获取失败:", e);
    } finally {
      setIsLoadingHistory(false);
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
      setShowBuildLog(false);
    } else if (log.includes("❌")) {
      setShowBuildLog(true);
    }
  }, [log]);

  useEffect(() => {
    loadConfig();
    if (!isTauriRuntime()) return;

    const appWindow = getCurrentWindow();
    const unlistenProgress = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        setProgress(event.payload.percent);
        setProgressMessage(event.payload.message);
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
    if (activeTab === "landing" && isTauriRuntime() && !landingOutputDir) {
      invoke<string>("get_temp_dir").then((dir) => {
        setLandingOutputDir(dir);
      }).catch(() => {});
    }
  }, [activeTab, landingOutputDir]);

  useEffect(() => {
    if (landingDebounceRef.current !== null) {
      window.clearTimeout(landingDebounceRef.current);
    }
    if (!landingIds.trim() || !isTauriRuntime() || !landingOutputDir) {
      setLandingPreviewData([]);
      setLandingGenerated({});
      return;
    }
    landingDebounceRef.current = window.setTimeout(async () => {
      setIsFetchingPreview(true);
      setLandingPreviewData([]);
      setLandingGenerated({});
      setLog("");
      setProgress(0);
      try {
        const data = await invoke<SubChannelData[]>("fetch_sub_channels", {
          apiUrl: landingApiUrl,
          ids: landingIds.trim(),
        });
        setLandingPreviewData(data);
        setIsGenerating(true);
        const results = await invoke<LandingPageResult[]>("generate_landing_pages", {
          apiUrl: landingApiUrl,
          ids: landingIds.trim(),
          templateBase: landingTemplateBase,
          outputDir: landingOutputDir.trim(),
        });
        const map: Record<string, LandingPageResult> = {};
        for (const r of results) {
          map[r.id] = r;
        }
        setLandingGenerated(map);
        const success = results.filter((r) => r.status === "success").length;
        showToast(`生成完成: 成功 ${success} / ${results.length}`);
      } catch (e: any) {
        showToast(`操作失败: ${e}`);
      } finally {
        setIsFetchingPreview(false);
        setIsGenerating(false);
      }
    }, 800);
    return () => {
      if (landingDebounceRef.current !== null) {
        window.clearTimeout(landingDebounceRef.current);
      }
    };
  }, [landingIds, landingOutputDir, landingTemplateBase]);

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
      loadGitBranches(value);
    } else {
      setBranchOptions([]);
      setBranchName("");
    }
  }

  async function handleBranchChange(value: string) {
    setBranchName(value);
    setSpringProfile("");
    if (value.trim() && repoPath) {
      await loadSpringProfiles(repoPath, value);
      loadLastCommit(repoPath, value);
      loadCommitList(repoPath, value, 1);
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
      const history = (config.repo_path_history || []).filter((p) => p !== repoPath);
      const newHistory = repoPath.trim() ? [repoPath, ...history].slice(0, 20) : history;
      const updatedConfig = {
        ...config,
        remember_branch_settings: true,
        last_repo_path: repoPath,
        last_branch: branchName.trim(),
        last_frontend_dir: frontendDir.trim(),
        last_build_script: selectedBuildScript,
        last_project_type: branchProjectType,
        last_auto_push_image: autoPushImage,
        last_package_with_backend: packageWithBackend,
        repo_path_history: newHistory,
      };
      invoke("save_config", { config: updatedConfig }).then(() => {
        setConfig(updatedConfig);
      });
    }
  }

  // ==================== 落地页操作 ====================
  async function handleLandingPreview() {
    if (!isTauriRuntime() || !landingIds.trim()) return;
    setIsFetchingPreview(true);
    setLandingPreviewData([]);
    setLandingGenerated({});
    setFtpUploadResults({});
    setLog("");
    setProgress(0);
    try {
      const data = await invoke<SubChannelData[]>("fetch_sub_channels", {
        apiUrl: landingApiUrl,
        ids: landingIds.trim(),
      });
      setLandingPreviewData(data);
      setIsGenerating(true);
      const results = await invoke<LandingPageResult[]>("generate_landing_pages", {
        apiUrl: landingApiUrl,
        ids: landingIds.trim(),
        templateBase: landingTemplateBase,
        outputDir: landingOutputDir.trim(),
      });
      const map: Record<string, LandingPageResult> = {};
      for (const r of results) { map[r.id] = r; }
      setLandingGenerated(map);
      const success = results.filter((r) => r.status === "success").length;
      showToast(`生成完成: 成功 ${success} / ${results.length}`);
    } catch (e: any) {
      showToast(`操作失败: ${e}`);
    } finally {
      setIsFetchingPreview(false);
      setIsGenerating(false);
    }
  }

  async function handleFtpUpload() {
    if (!isTauriRuntime()) return;
    setIsUploadingToFtp(true);
    setFtpUploadResults({});
    try {
      const items: { id: string; local_dir: string; remote_dir: string }[] = Object.entries(landingGenerated)
        .filter(([, r]) => r.status === "success")
        .map(([, r]) => ({
          id: r.id,
          local_dir: r.output_dir,
          remote_dir: `${r.id}_${r.type_code}`,
        }));
      if (items.length === 0) {
        showToast("没有可上传的已成功生成的落地页");
        return;
      }
      const results = await invoke<FtpUploadResult[]>("upload_landing_to_ftp", { items });
      const map: Record<string, FtpUploadResult> = {};
      for (const r of results) { map[r.id] = r; }
      setFtpUploadResults(map);
      const success = results.filter((r) => r.status === "success").length;
      showToast(`FTP 上传完成: 成功 ${success} / ${results.length}`);
    } catch (e: any) {
      showToast(`FTP 上传失败: ${e}`);
    } finally {
      setIsUploadingToFtp(false);
    }
  }

  async function handleCopyAllLinks() {
    const urls = Object.values(ftpUploadResults)
      .filter((r) => r.status === "success")
      .map((r) => r.url);
    if (urls.length === 0) {
      showToast("没有可复制的链接");
      return;
    }
    await navigator.clipboard.writeText(urls.join("\n"));
    showToast(`已复制 ${urls.length} 个链接`);
  }

  // ==================== 渲染 ====================
  return (
    <div className="app">
      <Sidebar
        activeTab={activeTab}
        sidebarCollapsed={sidebarCollapsed}
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
            isDragOver={isDragOver}
            isBuilding={isBuilding}
            showImageConfig={showImageConfig}
            showBuildLog={showBuildLog}
            progress={progress}
            progressMessage={progressMessage}
            log={log}
            onArtifactTypeChange={handleArtifactTypeChange}
            onSelectFile={handleSelectFile}
            onBuildAndPush={handleBuildAndPush}
            onCancelBuild={handleCancelBuild}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            setImageName={setImageName}
            setImageTag={setImageTag}
            setShowImageConfig={setShowImageConfig}
            setShowBuildLog={setShowBuildLog}
            renderLog={renderLog}
          />
        )}

        {activeTab === "branch" && (
          <BranchPanel
            branchProjectType={branchProjectType}
            repoPath={repoPath}
            branchName={branchName}
            branchOptions={branchOptions}
            isLoadingBranches={isLoadingBranches}
            frontendDir={frontendDir}
            npmScripts={npmScripts}
            selectedBuildScript={selectedBuildScript}
            isLoadingScripts={isLoadingScripts}
            packageWithBackend={packageWithBackend}
            springProfile={springProfile}
            springProfiles={springProfiles}
            isLoadingProfiles={isLoadingProfiles}
            lastCommit={lastCommit}
            isLoadingCommit={isLoadingCommit}
            commitList={commitList}
            commitListTotal={commitListTotal}
            showCommitListModal={showCommitListModal}
            artifactPath={artifactPath}
            backendArtifactPath={backendArtifactPath}
            worktreePath={worktreePath}
            customDockerfile={customDockerfile}
            branchHasDockerfile={branchHasDockerfile}
            isBuilding={isBuilding}
            autoPushImage={autoPushImage}
            branchFullImage={branchFullImage}
            imageName={imageName}
            imageTag={imageTag}
            showAdvancedSettings={showAdvancedSettings}
            config={config}
            progress={progress}
            progressMessage={progressMessage}
            log={log}
            showBuildLog={showBuildLog}
            copied={copied}
            onBranchProjectTypeChange={handleBranchProjectTypeChange}
            onRepoPathChange={handleRepoPathChange}
            onSelectRepo={handleSelectRepo}
            onRefreshBranches={() => loadGitBranches(repoPath)}
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
            setShowCommitListModal={setShowCommitListModal}
            loadCommitList={loadCommitList}
            loadCommitAuthors={loadCommitAuthors}
            commitAuthors={commitAuthors}
            isLoadingCommitList={isLoadingCommitList}
            commitListPage={commitListPage}
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
            setShowAdvancedSettings={setShowAdvancedSettings}
            setShowBuildLog={setShowBuildLog}
            renderLog={renderLog}
          />
        )}

        {activeTab === "history" && (
          <HistoryPanel
            buildHistory={buildHistory}
            isLoadingHistory={isLoadingHistory}
            expandedRecordId={expandedRecordId}
            collapsedProjects={collapsedProjects}
            historySearch={historySearch}
            onLoadHistory={loadBuildHistory}
            onClearHistory={clearBuildHistory}
            onDeleteRecord={deleteBuildRecord}
            onOpenArtifact={openArtifactPath}
            onCopyImage={handleCopyImage}
          />
        )}

        {activeTab === "landing" && (
          <LandingPanel
            landingTemplateBase={landingTemplateBase}
            landingIds={landingIds}
            landingPreviewData={landingPreviewData}
            landingGenerated={landingGenerated}
            ftpUploadResults={ftpUploadResults}
            isFetchingPreview={isFetchingPreview}
            isGenerating={isGenerating}
            isUploadingToFtp={isUploadingToFtp}
            progress={progress}
            progressMessage={progressMessage}
            setLandingTemplateBase={setLandingTemplateBase}
            setLandingIds={setLandingIds}
            onPreview={handleLandingPreview}
            onFtpUpload={handleFtpUpload}
            onCopyAllLinks={handleCopyAllLinks}
          />
        )}

        {activeTab === "config" && (
          <ConfigPanel
            config={config}
            configSaved={configSaved}
            showPassword={showPassword}
            onConfigChange={handleConfigChange}
            onSaveConfig={handleSaveConfig}
            onTogglePassword={() => setShowPassword(!showPassword)}
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
