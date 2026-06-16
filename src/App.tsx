import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Container, Upload, Settings, Rocket, Package, FileText, CheckCircle, Copy, AlertCircle, Loader2, Eye, EyeOff, GitBranch, FolderOpen } from "lucide-react";
import { SearchableDropdown } from "./components/SearchableDropdown";
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
  message: string;
  author: string;
  date: string;
}

type TabType = "upload" | "branch" | "config";

function isTauriRuntime() {
  return typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>("upload");
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
  const [configSaved, setConfigSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  const [progressMessage, setProgressMessage] = useState("");

  function getPathName(path: string) {
    return path.split(/[/\\]/).filter(Boolean).pop() || path;
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
        packageManager: null,
        springProfile: branchProjectType === "maven" && springProfile.trim() ? springProfile.trim() : null,
      });
      setArtifactPath(result.artifact_path);
      setWorktreePath(result.worktree_path);
      // 打包成功后保存设置
      await saveBranchSettings();
      setActiveTab("branch");

      // 如果勾选了自动推送镜像，且是 Maven 项目，自动调用 build_and_push
      if (autoPushImage && branchProjectType === "maven") {
        // 检查 Harbor 配置是否完整
        if (!config.harbor_url || !config.username || !config.password || !config.project) {
          setLog(`⚠️ 分支打包成功，但 Harbor 配置不完整，无法推送镜像\n\n请在"推送配置" tab 中完善 Harbor 配置后重试\n\n${result.log}`);
        } else {
          // 验证镜像名称是否已设置
          const finalImageName = imageName || inferImageName(result.artifact_path, "jar");
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
                artifactType: "jar",
              });
              // 从推送结果中提取完整镜像地址
              const imageMatch = pushResult.match(/完整镜像:\s*(.+)/);
              if (imageMatch) {
                setBranchFullImage(imageMatch[1].trim());
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
      setToast({ show: true, message: "浏览器环境下无法打开目录" });
      return;
    }
    try {
      await invoke("open_directory", { path });
    } catch (e) {
      setToast({ show: true, message: `打开目录失败: ${e}` });
    }
  }

  async function handleCopyImage(imageUrl: string) {
    try {
      await navigator.clipboard.writeText(imageUrl);
      setCopied(true);
      setToast({ show: true, message: "镜像地址已复制到剪贴板" });
      setTimeout(() => {
        setCopied(false);
        setToast({ show: false, message: "" });
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
      <header className="app-header">
        <h1><Container className="header-icon" />JarPorter</h1>
        <p className="subtitle">拖拽产物推送 Harbor，或从指定 Git 分支隔离打包</p>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === "upload" ? "active" : ""}`}
          onClick={() => setActiveTab("upload")}
        >
          <Upload size={16} /> 上传推送
        </button>
        <button
          className={`tab ${activeTab === "branch" ? "active" : ""}`}
          onClick={() => setActiveTab("branch")}
        >
          <GitBranch size={16} /> 分支打包
        </button>
        <button
          className={`tab ${activeTab === "config" ? "active" : ""}`}
          onClick={() => setActiveTab("config")}
        >
          <Settings size={16} /> Harbor配置
        </button>
      </nav>

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
              <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                {renderLog(log)}
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
                    } else {
                      setSpringProfiles([]);
                      setLastCommit(null);
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
                    <span className="commit-info-label">📌 最近提交</span>
                    {isLoadingCommit && <span className="commit-loading">加载中...</span>}
                  </div>
                  <div className="commit-info-detail">
                    <span className="commit-hash" title={lastCommit.hash}>{lastCommit.hash.substring(0, 8)}</span>
                    <span className="commit-message">{lastCommit.message}</span>
                  </div>
                  <div className="commit-info-meta">
                    <span className="commit-author">{lastCommit.author}</span>
                    <span className="commit-date">{lastCommit.date}</span>
                  </div>
                </div>
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
                  <span className="path-link-label">📦 产物目录:</span>
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
                    <span className="path-link-label">📁 Worktree:</span>
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
              <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                {renderLog(log)}
              </div>
            )}
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
    </div>
  );
}

export default App;
