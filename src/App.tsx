import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Container, Upload, Settings, Rocket, Package, FileText, CheckCircle, Copy,
  AlertCircle, Loader2, Eye, EyeOff, GitBranch, FolderOpen, ExternalLink,
  History, List, Pin, Search, User, Folder, BookOpen, BookMarked, Trash2,
  ChevronLeft, ChevronRight, Archive
} from "lucide-react";
import { SearchableDropdown } from "./components/SearchableDropdown";
import { Modal } from "./components/Modal";
import "./App.css";

const DEFAULT_FRONTEND_DOCKERFILE_TEMPLATE = `FROM {{BASE_IMAGE}}
COPY nginx.conf {{NGINX_CONF_PATH}}
COPY {{DIST_DIR}}/ /usr/share/nginx/html/
EXPOSE {{EXPOSE_PORT}}
CMD ["nginx", "-g", "daemon off;"]
`;

const DEFAULT_FRONTEND_NGINX_TEMPLATE = `server {
    listen       {{EXPOSE_PORT}};
    server_name  _;

    root   /usr/share/nginx/html;
    index  index.html;

    gzip on;
    gzip_min_length 1k;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;
    gzip_vary on;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(?:js|css|woff2?|eot|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
`;

type ArtifactType = "jar" | "frontend_dist";
type BranchProjectType = "maven" | "npm";

interface HarborConfig {
  harbor_url: string;
  username: string;
  password: string;
  project: string;
  base_image: string;
  expose_port: string;
  frontend_base_image: string;
  frontend_expose_port: string;
  frontend_dockerfile_template: string;
  frontend_nginx_template: string;
  // 分支打包记忆配置
  remember_branch_settings: boolean;
  last_repo_path: string;
  last_branch: string;
  last_frontend_dir: string;
  last_build_script: string;
  last_project_type: string;
  last_auto_push_image: boolean;
  repo_path_history: string[];
  npm_package_manager: string;
  npm_registry: string;
  // 打包产物输出目录
  artifact_output_dir: string;
  // 历史打包记录
  build_history: BuildRecord[];
}

interface PackageFromBranchResult {
  artifact_path: string;
  worktree_path: string;
  build_script: string;
  log: string;
}

interface GitBranchOption {
  name: string;
}

interface LastCommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  url: string | null;
}

interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  url: string | null;
}

interface CommitListResult {
  commits: CommitInfo[];
  total: number;
  page: number;
  page_size: number;
}

interface AuthorInfo {
  name: string;
  count: number;
}

interface BuildRecord {
  id: string;
  timestamp: string;
  repo_path: string;
  branch: string;
  project_type: string;
  artifact_path: string;
  image_name: string | null;
  image_tag: string | null;
  build_command: string;
  duration_ms: number;
  status: string;
  log_summary: string;
  full_log: string;
}

type TabType = "upload" | "branch" | "config";

function isTauriRuntime() {
  return typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

function App() {
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
    repo_path_history: [],
    npm_package_manager: "npm",
    npm_registry: "",
    artifact_output_dir: "",
    build_history: [],
  });
  const [artifactType, setArtifactType] = useState<ArtifactType>("jar");
  const [artifactPath, setArtifactPath] = useState<string>("");
  const [imageName, setImageName] = useState<string>("");
  const [imageTag, setImageTag] = useState<string>("latest");
  const [repoPath, setRepoPath] = useState<string>("");
  const [frontendDir, setFrontendDir] = useState<string>("");
  const [npmScripts, setNpmScripts] = useState<string[]>([]);
  const [selectedBuildScript, setSelectedBuildScript] = useState<string>("");
  const [isLoadingScripts, setIsLoadingScripts] = useState(false);
  const [branchName, setBranchName] = useState<string>("");
  const [branchOptions, setBranchOptions] = useState<GitBranchOption[]>([]);
  const [branchProjectType, setBranchProjectType] = useState<BranchProjectType>("maven");
  const [log, setLog] = useState<string>("");
  const [worktreePath, setWorktreePath] = useState<string>("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [autoPushImage, setAutoPushImage] = useState<boolean>(false);
  const [branchFullImage, setBranchFullImage] = useState<string>("");
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [springProfile, setSpringProfile] = useState<string>("");
  const [springProfiles, setSpringProfiles] = useState<string[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [lastCommit, setLastCommit] = useState<LastCommitInfo | null>(null);
  const [isLoadingCommit, setIsLoadingCommit] = useState(false);
  const [commitList, setCommitList] = useState<CommitInfo[]>([]);
  const [commitListTotal, setCommitListTotal] = useState(0);
  const [commitListPage, setCommitListPage] = useState(1);
  const [isLoadingCommitList, setIsLoadingCommitList] = useState(false);
  const [commitAuthorFilter, setCommitAuthorFilter] = useState("");
  const [commitMessageFilter, setCommitMessageFilter] = useState("");
  const [commitAuthors, setCommitAuthors] = useState<AuthorInfo[]>([]);
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [showCommitListModal, setShowCommitListModal] = useState(false);
  const [showBuildHistoryModal, setShowBuildHistoryModal] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [historySearch, setHistorySearch] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showBuildLog, setShowBuildLog] = useState(false);

  // 构建日志自动展开/收起：错误自动展开，清空自动收起
  useEffect(() => {
    if (!log) {
      setShowBuildLog(false);
    } else if (log.includes("❌")) {
      setShowBuildLog(true);
    }
  }, [log]);
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  const [progressMessage, setProgressMessage] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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

  function getPathName(path: string) {
    return path.split(/[/\\]/).filter(Boolean).pop() || path;
  }

  function getProjectName(repoPath: string) {
    return repoPath.split('/').filter(Boolean).pop() || repoPath;
  }

  function toggleProjectCollapse(projectName: string) {
    setCollapsedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectName)) {
        newSet.delete(projectName);
      } else {
        newSet.add(projectName);
      }
      return newSet;
    });
  }

  function inferImageName(path: string, type: ArtifactType) {
    const parts = path.split(/[/\\]/).filter(Boolean);
    const lastName = parts.length > 0 ? parts[parts.length - 1] : "";

    if (type === "jar") {
      const nameWithoutExt = lastName.replace(/\.jar$/i, "");
      return nameWithoutExt.replace(/-\d.*/, "").toLowerCase();
    }

    const directoryName = lastName.toLowerCase() === "dist" && parts.length > 1
      ? parts[parts.length - 2]
      : lastName;
    return directoryName.toLowerCase();
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

  useEffect(() => {
    loadConfig();
    if (!isTauriRuntime()) {
      return;
    }

    // 监听构建进度事件
    const appWindow = getCurrentWindow();
    const unlistenProgress = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        setProgress(event.payload.percent);
        setProgressMessage(event.payload.message);
      }
    );

    // 使用Tauri的拖拽事件获取文件路径
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

  async function loadConfig() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      const savedConfig = await invoke<HarborConfig>("load_config");
      setConfig(savedConfig);
      setBuildHistory(savedConfig.build_history || []);
      // 加载记忆的分支打包设置
      if (savedConfig.remember_branch_settings) {
        if (savedConfig.last_repo_path) {
          setRepoPath(savedConfig.last_repo_path);
        }
        if (savedConfig.last_branch) {
          setBranchName(savedConfig.last_branch);
        }
        if (savedConfig.last_frontend_dir) {
          setFrontendDir(savedConfig.last_frontend_dir);
        }
        if (savedConfig.last_build_script) {
          setSelectedBuildScript(savedConfig.last_build_script);
        }
        if (savedConfig.last_auto_push_image !== undefined) {
          setAutoPushImage(savedConfig.last_auto_push_image);
        }
        // 恢复后加载分支列表、Spring Profiles 和提交信息
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

  async function loadGitBranches(path: string) {
    const nextRepoPath = path.trim();
    setBranchOptions([]);
    setBranchName("");
    if (!nextRepoPath) {
      return;
    }
    if (!isTauriRuntime()) {
      setLog("⚠️ 当前是浏览器预览环境，无法读取本机 Git 分支；请在 Tauri 桌面窗口中操作");
      return;
    }

    setIsLoadingBranches(true);
    setLog("");
    try {
      const branches = await invoke<GitBranchOption[]>("list_git_branches", {
        repoPath: nextRepoPath,
      });
      setBranchOptions(branches);
      const firstBranch = branches[0]?.name ?? "";
      setBranchName(firstBranch);
      // 加载 Spring profiles
      if (branchProjectType === "maven" && firstBranch) {
        await loadSpringProfiles(nextRepoPath, firstBranch);
      }
      // 加载最后一次提交信息
      if (firstBranch) {
        loadLastCommit(nextRepoPath, firstBranch);
        loadCommitList(nextRepoPath, firstBranch, 1);
      }
      if (branches.length === 0) {
        setLog("⚠️ 没有读取到可用分支");
      }
      // 如果是 npm 项目，自动检测前端目录并加载 scripts
      if (branchProjectType === "npm") {
        try {
          const detectedDir = await invoke<string | null>("detect_frontend_dir", {
            repoPath: nextRepoPath,
          });
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
      console.log("[Spring Profiles] 检测到:", profiles);
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

  async function loadBuildHistory() {
    if (!isTauriRuntime()) {
      return;
    }
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

  async function deleteBuildRecord(recordId: string) {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invoke("delete_build_record", { recordId });
      setBuildHistory(prev => prev.filter(r => r.id !== recordId));
    } catch (e) {
      console.error("[Delete Record] 删除失败:", e);
    }
  }

  async function clearBuildHistory() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invoke("clear_build_history");
      setBuildHistory([]);
    } catch (e) {
      console.error("[Clear History] 清空失败:", e);
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
      // 自动选择推荐的构建脚本
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
        // 选择后更新历史记录
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
      // 推送成功后重置状态，方便用户拖拽下一个产物
      setArtifactPath("");
      setImageTag("latest");
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
    setWorktreePath("");
    setBranchFullImage("");

    try {
      const result = await invoke<PackageFromBranchResult>("package_from_branch", {
        repoPath,
        branch: branchName.trim(),
        projectType: branchProjectType,
        // 只有 NPM 项目才传递 frontendDir，Maven 项目忽略它
        frontendDir: branchProjectType === "npm" ? (frontendDir.trim() || null) : null,
        buildScript: branchProjectType === "npm" ? selectedBuildScript : null,
        packageManager: config.npm_package_manager || "npm",
        springProfile: branchProjectType === "maven" && springProfile.trim() ? springProfile.trim() : null,
      });
      setArtifactPath(result.artifact_path);
      setWorktreePath(result.worktree_path);
      // 打包成功后保存设置
      await saveBranchSettings();
      await loadBuildHistory();
      setActiveTab("branch");

      // 如果勾选了自动推送镜像，自动调用 build_and_push
      if (autoPushImage) {
        // 检查 Harbor 配置是否完整
        if (!config.harbor_url || !config.username || !config.password || !config.project) {
          setLog(`⚠️ 分支打包成功，但 Harbor 配置不完整，无法推送镜像\n\n请在"推送配置" tab 中完善 Harbor 配置后重试\n\n${result.log}`);
        } else {
          const artifactType = branchProjectType === "npm" ? "frontend_dist" : "jar";
          // 验证镜像名称是否已设置
          const finalImageName = imageName || inferImageName(result.artifact_path, artifactType);
          if (!finalImageName.trim()) {
            setLog(`⚠️ 分支打包成功，但未设置镜像名称，跳过推送\n\n${result.log}`);
          } else {
            setProgress(60);
            setProgressMessage("🚀 打包完成，开始推送镜像...");
            try {
              const pushResult = await invoke<string>("build_and_push", {
                jarPath: result.artifact_path,
                imageName: finalImageName,
                imageTag: imageTag || "latest",
                artifactType,
              });
              // 从推送结果中提取完整镜像地址
              const imageMatch = pushResult.match(/完整镜像:\s*(.+)/);
              if (imageMatch) {
                const fullImage = imageMatch[1].trim();
                setBranchFullImage(fullImage);
                // 更新构建记录，保存镜像信息
                try {
                  await invoke("update_build_record_image", {
                    imageName: finalImageName,
                    imageTag: fullImage,
                  });
                  await loadBuildHistory();
                } catch {
                  // 更新记录失败不影响主流程
                }
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
    if (!isTauriRuntime() || !config.remember_branch_settings) {
      return;
    }
    try {
      // 更新仓库路径历史（去重，最新的放前面，最多保留20个）
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
        repo_path_history: newHistory,
      };
      await invoke("save_config", { config: updatedConfig });
      setConfig(updatedConfig);
    } catch (e) {
      console.error("保存分支设置失败:", e);
    }
  }

  async function handleOpenDirectory(path: string) {
    if (!isTauriRuntime()) {
      showToast("浏览器环境下无法打开目录");
      return;
    }
    try {
      await invoke("open_directory", { path });
    } catch (e) {
      showToast(`打开目录失败: ${e}`);
    }
  }

  async function handleCopyImage(imageUrl: string) {
    try {
      await navigator.clipboard.writeText(imageUrl);
      setCopied(true);
      showToast("镜像地址已复制到剪贴板");
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (e) {
      console.error("复制失败:", e);
    }
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
    // 检查是否是成功消息
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

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <Container size={24} className="header-icon" />
          {!sidebarCollapsed && <h1>JarPorter</h1>}
        </div>
        <nav className="sidebar-nav">
          <button
            className={`sidebar-item ${activeTab === "upload" ? "active" : ""}`}
            onClick={() => setActiveTab("upload")}
            data-label="上传推送"
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              document.documentElement.style.setProperty('--tooltip-top', `${rect.top + rect.height / 2}px`);
            }}
          >
            <Upload size={18} />
            {!sidebarCollapsed && <span>上传推送</span>}
          </button>
          <button
            className={`sidebar-item ${activeTab === "branch" ? "active" : ""}`}
            onClick={() => setActiveTab("branch")}
            data-label="分支打包"
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              document.documentElement.style.setProperty('--tooltip-top', `${rect.top + rect.height / 2}px`);
            }}
          >
            <GitBranch size={18} />
            {!sidebarCollapsed && <span>分支打包</span>}
          </button>
        </nav>
        <div className="sidebar-footer">
          <button
            className="sidebar-item settings-item"
            onClick={() => setActiveTab("config")}
            data-label="Harbor配置"
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              document.documentElement.style.setProperty('--tooltip-top', `${rect.top + rect.height / 2}px`);
            }}
          >
            <Settings size={18} />
            {!sidebarCollapsed && <span>Harbor配置</span>}
          </button>
        </div>
      </aside>

      <button
        className="sidebar-toggle"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      <main className="content">
        {activeTab === "upload" ? (
          <div className="upload-panel">
            <div className="artifact-type-selector">
              <button
                type="button"
                className={`artifact-type ${artifactType === "jar" ? "active" : ""}`}
                onClick={() => handleArtifactTypeChange("jar")}
              >
                <FileText size={16} /> JAR 应用
              </button>
              <button
                type="button"
                className={`artifact-type ${artifactType === "frontend_dist" ? "active" : ""}`}
                onClick={() => handleArtifactTypeChange("frontend_dist")}
              >
                <Package size={16} /> 前端 dist
              </button>
            </div>

            <div
              className={`drop-zone ${isDragOver ? "drag-over" : ""} ${artifactPath ? "has-file" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleSelectFile}
            >
              {artifactPath ? (
                <div className="file-info">
                  {artifactType === "jar" ? (
                    <FileText size={40} strokeWidth={1.5} className="file-icon" />
                  ) : (
                    <Package size={40} strokeWidth={1.5} className="file-icon" />
                  )}
                  <span className="file-name">
                    {getPathName(artifactPath)}
                  </span>
                  <span className="file-path">{artifactPath}</span>
                </div>
              ) : (
                <div className="drop-hint">
                  <Package size={64} strokeWidth={1.5} className="drop-icon" />
                  <p>{artifactType === "jar" ? "拖拽JAR文件到这里" : "拖拽前端 dist 目录到这里"}</p>
                  <p className="drop-sub">{artifactType === "jar" ? "或点击选择文件" : "或点击选择目录"}</p>
                </div>
              )}
            </div>

            <div className="image-config">
              <div className="form-row">
                <label>镜像名称</label>
                <input
                  type="text"
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  placeholder="例如: my-app"
                />
              </div>
              <div className="form-row">
                <label>镜像标签</label>
                <input
                  type="text"
                  value={imageTag}
                  onChange={(e) => setImageTag(e.target.value)}
                  placeholder="留空则自动生成 v.YY.MM.DD.HH.MM"
                />
              </div>
            </div>

            <button
              className="build-btn"
              onClick={handleBuildAndPush}
              disabled={isBuilding || !artifactPath}
            >
              {isBuilding ? (
                <>
                  <Loader2 size={18} className="spin" /> 构建推送中...
                </>
              ) : (
                <>
                  <Rocket size={18} /> 构建并推送到Harbor
                </>
              )}
            </button>

            {isBuilding && (
              <div className="progress-section">
                <div className="progress-info">
                  <span className="progress-message">{progressMessage}</span>
                  <span className="progress-percent">{progress}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-bar"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {log && (
              <div className="log-section">
                <button
                  type="button"
                  className="log-toggle-btn"
                  onClick={() => setShowBuildLog(!showBuildLog)}
                  title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                >
                  {showBuildLog ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                </button>
                {showBuildLog && (
                  <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                    {renderLog(log)}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === "branch" ? (
          <div className="branch-panel">
            <div className="artifact-type-selector">
              <button
                type="button"
                className={`artifact-type ${branchProjectType === "maven" ? "active" : ""}`}
                onClick={() => {
                  setBranchProjectType("maven");
                  setNpmScripts([]);
                  setSelectedBuildScript("");
                }}
              >
                <FileText size={16} /> Maven 项目
              </button>
              <button
                type="button"
                className={`artifact-type ${branchProjectType === "npm" ? "active" : ""}`}
                onClick={async () => {
                  setBranchProjectType("npm");
                  if (repoPath) {
                    try {
                      const detectedDir = await invoke<string | null>("detect_frontend_dir", {
                        repoPath,
                      });
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
                  }
                }}
              >
                <Package size={16} /> npm 前端
              </button>
            </div>

            <div className="branch-card">
              <div className="form-group">
                <label>Git 仓库目录</label>
                <div className="path-picker-row">
                  <div className="searchable-dropdown-wrapper">
                    <SearchableDropdown
                      value={repoPath}
                      options={config.repo_path_history || []}
                      onChange={(value) => {
                        setRepoPath(value);
                        if (value.trim()) {
                          loadGitBranches(value);
                        } else {
                          setBranchOptions([]);
                          setBranchName("");
                        }
                      }}
                      placeholder="选择或输入 Git 仓库目录"
                    />
                  </div>
                  <button type="button" className="path-picker-btn" onClick={handleSelectRepo}>
                    <FolderOpen size={16} /> 选择
                  </button>
                  <button
                    type="button"
                    className="path-picker-btn"
                    onClick={() => loadGitBranches(repoPath)}
                    disabled={!repoPath || isLoadingBranches}
                  >
                    <GitBranch size={16} /> {isLoadingBranches ? "读取中" : "刷新分支"}
                  </button>
                </div>
                {repoPath && <p className="template-hint">当前选择：{repoPath}</p>}
              </div>

              {branchProjectType === "npm" && (
                <div className="form-group">
                  <label>前端子目录（自动检测）</label>
                  <input
                    type="text"
                    value={frontendDir}
                    onChange={(e) => {
                      setFrontendDir(e.target.value);
                      if (repoPath) {
                        loadNpmScripts(repoPath, e.target.value);
                      }
                    }}
                    onBlur={() => {
                      if (repoPath) {
                        loadNpmScripts(repoPath, frontendDir);
                      }
                    }}
                    placeholder="自动检测中..."
                  />
                  <p className="template-hint">
                    {frontendDir ? `已检测到前端目录: ${frontendDir}` : "选择仓库后自动检测 package.json 所在目录"}
                  </p>
                </div>
              )}

              {branchProjectType === "npm" && npmScripts.length > 0 && (
                <div className="form-group">
                  <label>构建命令</label>
                  <SearchableDropdown
                    value={selectedBuildScript}
                    options={npmScripts}
                    onChange={setSelectedBuildScript}
                    placeholder="选择构建命令..."
                    disabled={isLoadingScripts}
                    loading={isLoadingScripts}
                  />
                </div>
              )}

              <div className="form-group">
                <label>目标分支</label>
                <SearchableDropdown
                  value={branchName}
                  options={branchOptions.map((b) => b.name)}
                  onChange={async (value) => {
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
                  }}
                  placeholder={isLoadingBranches ? "加载中..." : branchOptions.length === 0 ? "请先选择仓库" : "搜索或选择分支..."}
                  disabled={!repoPath || branchOptions.length === 0}
                  loading={isLoadingBranches}
                />
                <p className="template-hint">点击打包时会先执行 git fetch --all --prune 更新分支代码</p>
              </div>

              {lastCommit && (
                <div className="commit-info">
                  <div className="commit-info-header">
                    <span className="commit-info-label"><Pin size={14} /> 最近提交</span>
                    {isLoadingCommit && <span className="commit-loading">加载中...</span>}
                  </div>
                  <div className="commit-info-detail">
                    {lastCommit.url ? (
                      <button
                        className="commit-hash commit-link"
                        title={`在浏览器中打开: ${lastCommit.hash}`}
                        onClick={() => openUrl(lastCommit.url!)}
                      >
                        {lastCommit.short_hash}
                        <ExternalLink size={12} />
                      </button>
                    ) : (
                      <span className="commit-hash" title={lastCommit.hash}>{lastCommit.short_hash}</span>
                    )}
                    <span className="commit-message">{lastCommit.message}</span>
                  </div>
                  <div className="commit-info-meta">
                    <span className="commit-author">{lastCommit.author}</span>
                    <span className="commit-date">{lastCommit.date}</span>
                  </div>
                </div>
              )}

              {commitListTotal > 0 && (
                <button
                  className="modal-trigger-btn"
                  onClick={() => {
                    setShowCommitListModal(true);
                    if (commitList.length === 0) {
                      loadCommitList(repoPath, branchName, 1);
                    }
                    if (commitAuthors.length === 0) {
                      loadCommitAuthors(repoPath, branchName);
                    }
                  }}
                >
                  <List size={16} />
                  查看提交记录 ({commitListTotal})
                </button>
              )}

              {branchProjectType === "maven" && (
                <div className="form-group">
                  <label>Spring Profile</label>
                  <SearchableDropdown
                    value={springProfile}
                    options={springProfiles}
                    onChange={setSpringProfile}
                    placeholder={isLoadingProfiles ? "扫描中..." : springProfiles.length === 0 ? "未检测到 profile 配置文件" : "选择 profile..."}
                    disabled={isLoadingProfiles}
                    loading={isLoadingProfiles}
                  />
                  <p className="template-hint">
                    {springProfile
                      ? `将执行: mvn clean package -DskipTests -Dspring.profiles.active=${springProfile}`
                      : springProfiles.length > 0
                        ? `检测到 ${springProfiles.length} 个 profile: ${springProfiles.join(", ")}`
                        : "留空则不添加 -Dspring.profiles.active 参数"}
                  </p>
                </div>
              )}

              <div className="branch-command-preview">
                固定命令：
                <code>{branchProjectType === "maven"
                  ? `mvn clean package -DskipTests${springProfile.trim() ? ` -Dspring.profiles.active=${springProfile.trim()}` : ""}`
                  : `npm install && npm run ${selectedBuildScript || "build"}`}</code>
              </div>

              {branchProjectType === "maven" && (
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={autoPushImage}
                      onChange={(e) => setAutoPushImage(e.target.checked)}
                    />
                    <span className="checkbox-toggle"></span>
                    <span>打包后联动推送镜像到 Harbor</span>
                  </label>
                  <p className="template-hint">
                    {autoPushImage ? "打包成功后将自动构建并推送镜像" : "勾选后打包成功会自动推送镜像"}
                  </p>
                </div>
              )}

              {branchProjectType === "maven" && autoPushImage && (
                <>
                  <div className="form-group">
                    <label>镜像名称</label>
                    <input
                      type="text"
                      value={imageName}
                      onChange={(e) => setImageName(e.target.value)}
                      placeholder="例如: tksy-admin（小写）"
                    />
                    <p className="template-hint">留空则自动从 JAR 文件名推断</p>
                  </div>
                  <div className="form-group">
                    <label>镜像标签</label>
                    <input
                      type="text"
                      value={imageTag}
                      onChange={(e) => setImageTag(e.target.value)}
                      placeholder="latest"
                    />
                    <p className="template-hint">留空则使用时间戳格式 v.YY.MM.DD.HH.MM</p>
                  </div>
                </>
              )}

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.remember_branch_settings}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setConfig((prev) => ({ ...prev, remember_branch_settings: checked }));
                      // 如果勾选，立即保存当前设置
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
                          repo_path_history: newHistory,
                        };
                        invoke("save_config", { config: updatedConfig }).then(() => {
                          setConfig(updatedConfig);
                        });
                      }
                    }}
                  />
                  <span className="checkbox-toggle"></span>
                  <span>记住本次配置，下次自动带出</span>
                </label>
              </div>
            </div>

            <button
              className="build-btn"
              onClick={handlePackageFromBranch}
              disabled={isBuilding || !repoPath || !branchName.trim()}
            >
              {isBuilding ? (
                <>
                  <Loader2 size={18} className="spin" /> 分支打包中...
                </>
              ) : (
                <>
                  <GitBranch size={18} /> 从指定分支打包
                </>
              )}
            </button>

            {isBuilding && (
              <div className="progress-section">
                <div className="progress-info">
                  <span className="progress-message">{progressMessage}</span>
                  <span className="progress-percent">{progress}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-bar"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {artifactPath && (
              <div className="path-links">
                {branchFullImage && (
                  <div className="path-link-item image-url-row">
                    <span className="path-link-label">🐳 完整镜像:</span>
                    <span className="image-url-value" title={branchFullImage}>{branchFullImage}</span>
                    <button
                      className={`copy-btn ${copied ? "copied" : ""}`}
                      onClick={() => handleCopyImage(branchFullImage)}
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
                )}
                <div className="path-link-item">
                  <span className="path-link-label"><FileText size={14} /> 产物目录:</span>
                  <button
                    type="button"
                    className="path-link-btn"
                    onClick={() => handleOpenDirectory(artifactPath)}
                  >
                    {artifactPath}
                  </button>
                </div>
                {worktreePath && (
                  <div className="path-link-item">
                    <span className="path-link-label"><FolderOpen size={14} /> 输出目录:</span>
                    <button
                      type="button"
                      className="path-link-btn"
                      onClick={() => handleOpenDirectory(worktreePath)}
                    >
                      {worktreePath}
                    </button>
                  </div>
                )}
              </div>
            )}

            {log && (
              <div className="log-section">
                <button
                  type="button"
                  className="log-toggle-btn"
                  onClick={() => setShowBuildLog(!showBuildLog)}
                  title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                >
                  {showBuildLog ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
                </button>
                {showBuildLog && (
                  <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                    {renderLog(log)}
                  </div>
                )}
              </div>
            )}

            <button
              className="modal-trigger-btn"
              onClick={() => {
                setShowBuildHistoryModal(true);
                loadBuildHistory();
              }}
            >
              <History size={16} />
              历史打包记录 ({buildHistory.length})
            </button>
          </div>
        ) : (
          <div className="config-panel">
            <div className="form-group">
              <label>Harbor地址</label>
              <input
                type="text"
                value={config.harbor_url}
                onChange={(e) => handleConfigChange("harbor_url", e.target.value)}
                placeholder="例如: harbor.example.com"
              />
            </div>
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                value={config.username}
                onChange={(e) => handleConfigChange("username", e.target.value)}
                placeholder="Harbor登录用户名"
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.password}
                  onChange={(e) => handleConfigChange("password", e.target.value)}
                  placeholder="Harbor登录密码"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>项目名称</label>
              <input
                type="text"
                value={config.project}
                onChange={(e) => handleConfigChange("project", e.target.value)}
                placeholder="例如: my-project"
              />
            </div>
            <div className="form-group">
              <label>JAR基础镜像</label>
              <input
                type="text"
                value={config.base_image}
                onChange={(e) => handleConfigChange("base_image", e.target.value)}
                placeholder="例如: eclipse-temurin:17-jre"
              />
            </div>
            <div className="form-group">
              <label>JAR暴露端口</label>
              <input
                type="text"
                value={config.expose_port}
                onChange={(e) => handleConfigChange("expose_port", e.target.value)}
                placeholder="例如: 8181"
              />
            </div>
            <div className="form-group">
              <label>前端基础镜像</label>
              <input
                type="text"
                value={config.frontend_base_image}
                onChange={(e) => handleConfigChange("frontend_base_image", e.target.value)}
                placeholder="例如: nginx:alpine"
              />
            </div>
            <div className="form-group">
              <label>前端暴露端口</label>
              <input
                type="text"
                value={config.frontend_expose_port}
                onChange={(e) => handleConfigChange("frontend_expose_port", e.target.value)}
                placeholder="例如: 80"
              />
            </div>
            <div className="form-group">
              <label>前端 Dockerfile 模板</label>
              <textarea
                value={config.frontend_dockerfile_template}
                onChange={(e) => handleConfigChange("frontend_dockerfile_template", e.target.value)}
                spellCheck={false}
                rows={6}
              />
              <p className="template-hint">可用变量：{"{{BASE_IMAGE}}"}、{"{{EXPOSE_PORT}}"}、{"{{NGINX_CONF_PATH}}"}、{"{{DIST_DIR}}"}、{"{{IMAGE_NAME}}"}、{"{{IMAGE_TAG}}"}、{"{{FULL_IMAGE}}"}</p>
            </div>
            <div className="form-group">
              <label>nginx.conf 模板</label>
              <textarea
                value={config.frontend_nginx_template}
                onChange={(e) => handleConfigChange("frontend_nginx_template", e.target.value)}
                spellCheck={false}
                rows={9}
              />
            </div>

            <div className="form-group">
              <label><Archive size={14} /> 打包产物目录</label>
              <div className="path-picker-row">
                <input
                  type="text"
                  value={config.artifact_output_dir}
                  onChange={(e) => handleConfigChange("artifact_output_dir", e.target.value)}
                  placeholder="默认: 桌面"
                />
                <button
                  type="button"
                  className="path-picker-btn"
                  onClick={async () => {
                    if (!isTauriRuntime()) {
                      setLog("⚠️ 当前是浏览器预览环境，无法打开系统目录选择器");
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
                        handleConfigChange("artifact_output_dir", selected as string);
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

            <div className="config-tip">
              <p><AlertCircle size={16} className="inline-icon" /> 配置说明：</p>
              <ul>
                <li>配置保存后无需重复填写</li>
                <li>Harbor地址不需要带 https:// 前缀</li>
                <li>项目名称为Harbor中的项目名</li>
                <li>JAR模式使用JAR基础镜像和JAR暴露端口</li>
                <li>前端dist模式会把所选 dist 目录的内容复制为 nginx 站点根目录，不会在镜像里嵌套 dist 目录</li>
                <li>默认 nginx.conf 的 /index.html 回退路径对应 /usr/share/nginx/html/index.html</li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {toast.show && (
        <div className="toast">
          <CheckCircle size={16} />
          {toast.message}
        </div>
      )}

      <Modal
        isOpen={showCommitListModal}
        onClose={() => {
          setShowCommitListModal(false);
          setCommitAuthorFilter("");
          setCommitMessageFilter("");
        }}
        title="提交记录"
        width="700px"
        footer={
          commitList.length > 0 || commitAuthorFilter || commitMessageFilter ? (
            <div className="modal-pagination">
              <button
                className="pagination-btn"
                disabled={commitListPage <= 1 || isLoadingCommitList}
                onClick={() => loadCommitList(repoPath, branchName, commitListPage - 1, commitAuthorFilter, commitMessageFilter)}
              >
                <ChevronLeft size={14} /> 上一页
              </button>
              <span className="modal-pagination-info">
                第 {commitListPage} 页 / 共 {Math.ceil(commitListTotal / 10)} 页
              </span>
              <button
                className="pagination-btn"
                disabled={commitListPage >= Math.ceil(commitListTotal / 10) || isLoadingCommitList}
                onClick={() => loadCommitList(repoPath, branchName, commitListPage + 1, commitAuthorFilter, commitMessageFilter)}
              >
                下一页 <ChevronRight size={14} />
              </button>
            </div>
          ) : undefined
        }
      >
        <div className="commit-search-bar">
          <div className="commit-search-input-wrapper">
            <Search size={14} className="commit-search-icon" />
            <input
              type="text"
              className="commit-search-input"
              placeholder="搜索提交信息..."
              value={commitMessageFilter}
              onChange={(e) => setCommitMessageFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter);
                }
              }}
            />
          </div>
          <div className="commit-author-select-wrapper">
            <User size={14} className="commit-author-icon" />
            <select
              className="commit-author-select"
              value={commitAuthorFilter}
              onChange={(e) => {
                setCommitAuthorFilter(e.target.value);
                loadCommitList(repoPath, branchName, 1, e.target.value, commitMessageFilter);
              }}
            >
              <option value="">全部作者</option>
              {commitAuthors.map((author) => (
                <option key={author.name} value={author.name}>
                  {author.name} ({author.count})
                </option>
              ))}
            </select>
          </div>
          <button
            className="commit-search-btn"
            onClick={() => loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter)}
          >
            搜索
          </button>
          {(commitAuthorFilter || commitMessageFilter) && (
            <button
              className="commit-search-clear"
              onClick={() => {
                setCommitAuthorFilter("");
                setCommitMessageFilter("");
                loadCommitList(repoPath, branchName, 1, "", "");
              }}
            >
              清除
            </button>
          )}
        </div>

        {commitList.length === 0 && isLoadingCommitList ? (
          <div className="modal-loading">加载中...</div>
        ) : commitList.length === 0 ? (
          <div className="modal-empty">暂无提交记录</div>
        ) : (
          <div className="modal-list-wrapper">
            {isLoadingCommitList && (
              <div className="modal-loading-inline">加载中...</div>
            )}
            <div className="modal-list">
              {commitList.map((commit) => (
                <div key={commit.hash} className="modal-list-item">
                  <div className="modal-list-item-main">
                    {commit.url ? (
                      <button
                        className="commit-hash commit-link"
                        title={`在浏览器中打开: ${commit.hash}`}
                        onClick={() => openUrl(commit.url!)}
                      >
                        {commit.short_hash}
                        <ExternalLink size={10} />
                      </button>
                    ) : (
                      <span className="commit-hash" title={commit.hash}>{commit.short_hash}</span>
                    )}
                    <span className="commit-message">{commit.message}</span>
                  </div>
                  <div className="modal-list-item-meta">
                    <span className="commit-author">{commit.author}</span>
                    <span className="commit-date">{commit.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showBuildHistoryModal}
        onClose={() => { setShowBuildHistoryModal(false); setHistorySearch(""); }}
        title="历史打包记录"
        width="800px"
      >
        {isLoadingHistory ? (
          <div className="modal-loading">加载中...</div>
        ) : buildHistory.length === 0 ? (
          <div className="modal-empty">暂无打包记录</div>
        ) : (
          <>
            {/* 搜索栏 — 支持搜索 Docker 镜像地址、分支名、项目名 */}
            <div className="history-search-bar">
              <Search size={14} className="history-search-icon" />
              <input
                type="text"
                className="history-search-input"
                placeholder="搜索 Docker 镜像地址 / 分支名 / 项目名..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
              {historySearch && (
                <button
                  className="history-search-clear"
                  onClick={() => setHistorySearch("")}
                  title="清除搜索"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="modal-list">
              {(() => {
                // 按repo_path分组
                let groupedRecords = buildHistory.reduce((groups, record) => {
                  const projectName = getProjectName(record.repo_path);
                  if (!groups[projectName]) {
                    groups[projectName] = {
                      repoPath: record.repo_path,
                      records: []
                    };
                  }
                  groups[projectName].records.push(record);
                  return groups;
                }, {} as Record<string, { repoPath: string; records: BuildRecord[] }>);

                // 搜索过滤：匹配镜像地址、分支名、项目名、仓库路径
                const searchLower = historySearch.trim().toLowerCase();
                if (searchLower) {
                  const filtered: Record<string, { repoPath: string; records: BuildRecord[] }> = {};
                  for (const [projectName, group] of Object.entries(groupedRecords)) {
                    const matchedRecords = group.records.filter(r =>
                      r.image_tag?.toLowerCase().includes(searchLower) ||
                      r.image_name?.toLowerCase().includes(searchLower) ||
                      r.branch.toLowerCase().includes(searchLower) ||
                      r.repo_path.toLowerCase().includes(searchLower) ||
                      projectName.toLowerCase().includes(searchLower)
                    );
                    if (matchedRecords.length > 0) {
                      filtered[projectName] = { ...group, records: matchedRecords };
                    }
                  }
                  groupedRecords = filtered;
                }

                // 按项目名称排序
                const sortedProjects = Object.entries(groupedRecords).sort(([a], [b]) => a.localeCompare(b));
                // 搜索时自动展开所有匹配的项目
                const isSearching = searchLower.length > 0;

                return sortedProjects.map(([projectName, { repoPath, records }]) => (
                  <div key={projectName} className="project-group">
                    <div
                      className="project-group-header"
                      onClick={() => toggleProjectCollapse(projectName)}
                    >
                      <span className={`project-group-arrow ${collapsedProjects.has(projectName) ? 'collapsed' : ''}`}>
                        ▼
                      </span>
                      <span className="project-group-name">{projectName}</span>
                      <span className="project-group-count">({records.length} 条记录)</span>
                      <span className="project-group-path" title={repoPath}>{repoPath}</span>
                    </div>
                    {(!collapsedProjects.has(projectName) || isSearching) && (
                      <div className="project-group-items">
                        {records.map((record) => (
                          <div key={record.id} className={`modal-history-item ${record.status}`}>
                            <div className="modal-history-item-header">
                              <span className={`history-status ${record.status}`}>
                                {record.status === 'success' || record.status === 'pushed' ? '✅' : '❌'}
                              </span>
                              <div className="modal-history-item-info">
                                <div className="modal-history-item-row">
                                  <span className="history-time">{record.timestamp}</span>
                                  <span className="history-branch">{record.branch}</span>
                                  {record.image_tag && (
                                    <button
                                      className="history-image-btn"
                                      title={record.image_tag}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await handleCopyImage(record.image_tag!);
                                      }}
                                    >
                                      <Copy size={12} />
                                      <span className="history-image-text">{record.image_tag}</span>
                                    </button>
                                  )}
                                  <span className="history-meta">耗时: {(record.duration_ms / 1000).toFixed(1)}s</span>
                                </div>
                                <div className="modal-history-item-path">
                                  <button
                                    className="path-link-btn"
                                    onClick={() => openArtifactPath(record.artifact_path)}
                                    title={record.artifact_path}
                                  >
                                    {record.artifact_path}
                                  </button>
                                </div>
                              </div>
                              <div className="modal-history-item-actions">
                                <button
                                  className="history-action-btn"
                                  onClick={() => openArtifactPath(record.artifact_path)}
                                  title="打开产物目录"
                                >
                                  <Folder size={14} />
                                </button>
                                <button
                                  className="history-action-btn"
                                  onClick={() => setExpandedRecordId(expandedRecordId === record.id ? null : record.id)}
                                  title={expandedRecordId === record.id ? "收起日志" : "展开日志"}
                                >
                                  {expandedRecordId === record.id ? <BookMarked size={14} /> : <BookOpen size={14} />}
                                </button>
                                <button
                                  className="history-action-btn delete"
                                  onClick={() => {
                                    if (confirm('确定要删除这条记录吗？')) {
                                      deleteBuildRecord(record.id);
                                    }
                                  }}
                                  title="删除记录"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            {expandedRecordId === record.id && (
                              <div className="modal-history-log">
                                <pre>{record.full_log}</pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
            <div className="modal-footer">
              <button
                className="clear-history-btn"
                onClick={() => {
                  if (confirm('确定要清空所有打包历史吗？')) {
                    clearBuildHistory();
                  }
                }}
              >
                清空历史
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default App;
