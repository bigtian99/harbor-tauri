import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BranchProjectType,
  HarborConfig,
  GitBranchOption,
  NginxLocationBlock,
  TabType,
} from "../types";
import type { BranchImageResult } from "../branchImageResults";
import { isGitUrl, isTauriRuntime } from "../types";
import { getRememberedBranchAdvancedSettings, hasRememberedRepoExposePort, rememberBranchRepoSettings } from "../branchSettings";
import {
  suggestKlcjZtByGitUrl,
  suggestKlcjZtByRepoPath,
} from "../utils/klcjZtGitDefaults";
import {
  autoPushHarborForSpringProfile,
  buildScriptAfterMerge,
  preferNpmBuildScript,
  shouldPushHarborAfterMerge,
  springProfileAfterMerge,
} from "../mergeSyncPackage";
import { prependPathHistory } from "./branch/pathHistory";
import { useBranchCommits } from "./branch/useBranchCommits";
import { useBranchGitLoad } from "./branch/useBranchGitLoad";
import {
  handlePackageFromBranch as runPackageFromBranch,
} from "./branch/branchPackageAction";

interface UseBranchPackDeps {
  config: HarborConfig;
  setConfig: Dispatch<SetStateAction<HarborConfig>>;
  setActiveTab: (tab: TabType) => void;
  setLog: (value: string | ((prev: string) => string)) => void;
  setIsBuilding: (value: boolean) => void;
  setCopied: (value: string | null) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
  showToast: (message: string, duration?: number) => void;
  loadBuildHistory: () => Promise<void>;
  /**
   * 与 upload 共享的镜像名称/标签（上传推送与分支打包共用同一组字段）。
   */
  imageName: string;
  setImageName: (value: string) => void;
  imageTag: string;
  /** 与 upload 共享的产物路径（分支打包完成后会写入 artifactPath） */
  artifactPath: string;
  setArtifactPath: (value: string) => void;
  /** 未配置 Maven 时引导跳转设置页 */
  onOpenMavenConfig?: () => void;
  /** 二次确认弹窗 */
  confirm?: (opts: {
    title: string;
    message: string;
    details?: string[];
    confirmLabel?: string;
    cancelLabel?: string;
  }) => Promise<boolean>;
}

/**
 * 分支打包：仓库/分支/提交/npm/Maven 与 package_from_branch 全流程。
 * 子逻辑见 hooks/branch/*（git 加载、commits、打包动作）。
 */
export function useBranchPack(deps: UseBranchPackDeps) {
  const {
    config,
    setConfig,
    setActiveTab,
    setLog,
    setIsBuilding,
    setCopied,
    setProgress,
    setProgressMessage,
    showToast,
    loadBuildHistory,
    imageName,
    setImageName,
    imageTag,
    // setImageTag 由 upload 侧持有，分支打包只读 imageTag 用于自动 tag
    setArtifactPath,
    onOpenMavenConfig,
    confirm,
  } = deps;

  const [repoPath, setRepoPath] = useState("");
  const [frontendDir, setFrontendDir] = useState("");
  const [npmScripts, setNpmScripts] = useState<string[]>([]);
  const [selectedBuildScript, setSelectedBuildScript] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchOptions, setBranchOptions] = useState<GitBranchOption[]>([]);
  const [branchProjectType, setBranchProjectType] = useState<BranchProjectType>("maven");
  const [worktreePath, setWorktreePath] = useState("");
  const [customDockerfile, setCustomDockerfile] = useState("");
  const [branchHasDockerfile, setBranchHasDockerfile] = useState(false);
  const [autoPushImage, setAutoPushImage] = useState(false);
  const [autoPublishKs, setAutoPublishKs] = useState(false);
  const [packageWithBackend, setPackageWithBackend] = useState(false);
  const [branchExposePort, setBranchExposePort] = useState("");
  const [nginxLocations, setNginxLocations] = useState<NginxLocationBlock[]>([]);
  const [branchFullImage, setBranchFullImage] = useState("");
  const [branchImageResults, setBranchImageResults] = useState<BranchImageResult[]>([]);
  const [backendArtifactPath, setBackendArtifactPath] = useState("");
  const [springProfile, setSpringProfile] = useState("");
  const [springProfiles, setSpringProfiles] = useState<string[]>([]);

  // UI / loading
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [loading, setLoading] = useState({
    scripts: false,
    branches: false,
    profiles: false,
    commit: false,
    commitList: false,
  });
  const updateLoading = (key: keyof typeof loading, value: boolean) =>
    setLoading((prev) => ({ ...prev, [key]: value }));

  // 竞态守卫：切换仓库时忽略过期的 load 结果（branchRepoSwitch 测试扫描此符号）
  const branchLoadRequestRef = useRef(0);
  function isStaleBranchLoad(requestId?: number) {
    return requestId !== undefined && requestId !== branchLoadRequestRef.current;
  }
  function nextBranchLoadRequestId() {
    return ++branchLoadRequestRef.current;
  }

  async function restoreRememberedBranchAdvancedSettings(
    sourceConfig = config,
    sourceRepoPath = repoPath,
  ) {
    const trimmedRepoPath = sourceRepoPath.trim();
    const repoPathIsGitUrl = isGitUrl(trimmedRepoPath);
    const remembered = getRememberedBranchAdvancedSettings(
      sourceConfig,
      sourceRepoPath,
    );
    let exposePort = remembered.exposePort;
    // 无仓库专属记忆时，按本地路径 / Git 远程带出 klcj-zt 模块端口
    if (!hasRememberedRepoExposePort(sourceConfig, sourceRepoPath)) {
      const fromModule =
        suggestKlcjZtByRepoPath(sourceRepoPath)?.expose_port
        || (repoPathIsGitUrl ? suggestKlcjZtByGitUrl(trimmedRepoPath)?.expose_port : "")
        || "";
      if (fromModule) exposePort = fromModule;
    }
    setSpringProfile(remembered.springProfile);
    setBranchExposePort(exposePort);
    setNginxLocations(remembered.nginxLocations ?? []);

    // 二次精化：本地仓库尝试按 origin 再补一次端口（不会覆盖用户已记忆值）
    if (
      !repoPathIsGitUrl
      && isTauriRuntime()
      && trimmedRepoPath
      && !hasRememberedRepoExposePort(sourceConfig, sourceRepoPath)
    ) {
      try {
        const gitUrl = await invoke<string>("get_git_remote_url", {
          repoPath: trimmedRepoPath,
          remote: null,
        });
        const fromRemote = suggestKlcjZtByGitUrl(gitUrl)?.expose_port || "";
        if (fromRemote) {
          setBranchExposePort((prev) => (prev.trim() ? prev : fromRemote));
        }
      } catch {
        /* 非 git 目录或无 origin：忽略 */
      }
    }
  }

  const commits = useBranchCommits({
    updateLoading,
    isStaleBranchLoad,
  });

  const {
    lastCommit,
    setLastCommit,
    commitList,
    setCommitList,
    commitListTotal,
    setCommitListTotal,
    commitListPage,
    commitListPageSize,
    commitAuthorFilter,
    setCommitAuthorFilter,
    commitMessageFilter,
    setCommitMessageFilter,
    commitAuthors,
    showCommitListModal,
    setShowCommitListModal,
    loadLastCommit,
    loadCommitList,
    loadCommitAuthors,
  } = commits;

  const gitLoad = useBranchGitLoad({
    branchProjectType,
    branchName,
    frontendDir,
    setBranchName,
    setBranchOptions,
    setSpringProfiles,
    setSpringProfile,
    setAutoPushImage,
    setLastCommit,
    setCommitList,
    setCommitListTotal,
    setNpmScripts,
    setSelectedBuildScript,
    setFrontendDir,
    setBranchHasDockerfile,
    setLog,
    updateLoading,
    isStaleBranchLoad,
    nextBranchLoadRequestId,
    loadLastCommit,
    loadCommitList,
  });

  const { loadGitBranches, loadSpringProfiles, loadNpmScripts, checkBranchDockerfile } = gitLoad;

  /** Profile=test 默认关 Harbor；prod 默认开；其它 profile 不改勾选 */
  function handleSpringProfileChange(profile: string) {
    setSpringProfile(profile);
    const next = autoPushHarborForSpringProfile(profile);
    if (next !== null) {
      setAutoPushImage(next);
    }
  }

  async function ensureMavenConfigured(): Promise<boolean> {
    const needsMaven =
      branchProjectType === "maven" || (branchProjectType === "npm" && packageWithBackend);
    if (!needsMaven) return true;
    if (!isTauriRuntime()) return true;

    try {
      const info = await invoke<{
        effective_home: string;
        home_valid: boolean;
        source: string;
        env_home: string;
        bundled_available: boolean;
        bundled_home: string;
      }>("resolve_maven_settings", { config });

      if (info.home_valid && info.effective_home.trim()) {
        return true;
      }

      const details = [
        "优先读取环境变量 MAVEN_HOME / M2_HOME；",
        "也可在「系统设置 → JAR 打包」手动指定 Maven Home 与本地仓库。",
        "本机需已安装 Maven 与 JDK（安装包默认不再内置）。",
      ];
      if (info.bundled_available) {
        details.push(`检测到可选内置 Maven：${info.bundled_home || "（路径解析中）"}`);
      }
      if (info.env_home) {
        details.push(`当前环境变量: ${info.env_home}（目录无效或不含 bin/mvn）`);
      }

      if (confirm) {
        const go = await confirm({
          title: "未配置 Maven",
          message: "分支打包需要有效的 Maven 安装目录，否则会用错仓库（如 ~/.m2）导致依赖解析失败。",
          details,
          confirmLabel: "去配置 Maven",
          cancelLabel: "取消",
        });
        if (go) onOpenMavenConfig?.();
        return false;
      }

      showToast("未配置 Maven，请到系统设置 → JAR 打包填写");
      onOpenMavenConfig?.();
      return false;
    } catch (e) {
      console.error("[Maven] resolve_maven_settings failed:", e);
      return true; // 探测失败不阻断，交给后端再报错
    }
  }

  async function handlePackageFromBranch() {
    if (!(await ensureMavenConfigured())) return;
    await runPackageFromBranch({
      config,
      setConfig,
      setActiveTab,
      setLog,
      setIsBuilding,
      setCopied,
      setProgress,
      setProgressMessage,
      showToast,
      loadBuildHistory,
      imageName,
      setImageName,
      imageTag,
      setArtifactPath,
      setBackendArtifactPath,
      setWorktreePath,
      setCustomDockerfile,
      setBranchFullImage,
      setBranchImageResults,
      repoPath,
      branchName,
      branchProjectType,
      frontendDir,
      selectedBuildScript,
      autoPushImage,
      autoPublishKs,
      packageWithBackend,
      springProfile,
      branchExposePort,
      nginxLocations,
    });
  }

  /**
   * 合并成功后同步打包：写入分支页可见状态，并用 overrides 强制仓库/目标分支/Harbor 规则。
   */
  async function packageFromMergeTarget(mergeRepoPath: string, targetBranch: string) {
    const path = mergeRepoPath.trim();
    const branch = targetBranch.trim();
    if (!path || !branch) return;

    const autoPush = shouldPushHarborAfterMerge(branch);
    const remembered = getRememberedBranchAdvancedSettings(config, path);
    let mergeExposePort = remembered.exposePort;
    if (!hasRememberedRepoExposePort(config, path)) {
      const fromModule = suggestKlcjZtByRepoPath(path)?.expose_port || "";
      if (fromModule) mergeExposePort = fromModule;
    }
    const nextSpringProfile = springProfileAfterMerge(branch);
    // npm：rc-master → build:prod，其它目标 → build:test（覆盖记忆脚本）
    const nextBuildScript = buildScriptAfterMerge(branch);

    let nextProjectType: BranchProjectType = branchProjectType;
    let nextFrontendDir = frontendDir;
    let nextPackageWithBackend = packageWithBackend;

    if (config.remember_branch_settings) {
      const lastRepo = (config.last_repo_path || "").trim();
      if (!lastRepo || lastRepo === path) {
        if (config.last_project_type === "npm" || config.last_project_type === "maven") {
          nextProjectType = config.last_project_type;
        }
        if (config.last_frontend_dir) nextFrontendDir = config.last_frontend_dir;
        if (config.last_package_with_backend !== undefined) {
          nextPackageWithBackend = config.last_package_with_backend;
        }
      }
    }

    setRepoPath(path);
    setBranchName(branch);
    setAutoPushImage(autoPush);
    setSpringProfile(nextSpringProfile);
    setBranchExposePort(mergeExposePort);
    setNginxLocations(remembered.nginxLocations ?? []);
    setBranchProjectType(nextProjectType);
    setFrontendDir(nextFrontendDir);
    setSelectedBuildScript(nextBuildScript);
    setPackageWithBackend(nextPackageWithBackend);

    // 合并跳转只写了仓库/分支并开打，原先不拉提交；分支页提交区会空白
    void loadGitBranches(path, branch);

    await runPackageFromBranch(
      {
        config,
        setConfig,
        setActiveTab,
        setLog,
        setIsBuilding,
        setCopied,
        setProgress,
        setProgressMessage,
        showToast,
        loadBuildHistory,
        imageName: "",
        setImageName,
        imageTag,
        setArtifactPath,
        setBackendArtifactPath,
        setWorktreePath,
        setCustomDockerfile,
        setBranchFullImage,
        setBranchImageResults,
        repoPath: path,
        branchName: branch,
        branchProjectType: nextProjectType,
        frontendDir: nextFrontendDir,
        selectedBuildScript: nextBuildScript,
        autoPushImage: autoPush,
        autoPublishKs,
        packageWithBackend: nextPackageWithBackend,
        springProfile: nextSpringProfile,
        branchExposePort: mergeExposePort,
        nginxLocations: remembered.nginxLocations ?? [],
      },
      {
        repoPath: path,
        branchName: branch,
        autoPushImage: autoPush,
        autoPublishKs,
      },
    );
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
        setImageName("");
        void restoreRememberedBranchAdvancedSettings(config, selectedPath);
        setShowAdvancedSettings(true);
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
            loadNpmScripts(repoPath, detectedDir, undefined, branchName);
          } else {
            setFrontendDir("");
            loadNpmScripts(repoPath, "", undefined, branchName);
          }
        } catch {
          loadNpmScripts(repoPath, frontendDir, undefined, branchName);
        }
      })();
    }
  }

  function handleRepoPathChange(value: string) {
    setRepoPath(value);
    if (value.trim()) {
      setImageName("");
      void restoreRememberedBranchAdvancedSettings(config, value);
      loadGitBranches(value);
    } else {
      setBranchOptions([]);
      setBranchName("");
      setImageName("");
      setBranchExposePort("");
      setSpringProfile("");
    }
  }

  /** 拖入仓库目录时调用（与 handleRepoPathChange 语义一致） */
  function handleDropRepoPath(path: string) {
    setRepoPath(path);
    setImageName("");
    void restoreRememberedBranchAdvancedSettings(config, path);
    loadGitBranches(path);
  }

  async function handleBranchChange(value: string) {
    setBranchName(value);
    setSpringProfile("");
    if (npmScripts.length > 0) {
      setSelectedBuildScript(preferNpmBuildScript(value, npmScripts, selectedBuildScript));
    } else {
      setSelectedBuildScript(buildScriptAfterMerge(value));
    }
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
      const newHistory = prependPathHistory(config.repo_path_history, repoPath);
      const updatedConfig = rememberBranchRepoSettings(
        {
          ...config,
          remember_branch_settings: true,
          last_repo_path: repoPath,
          last_branch: branchName.trim(),
          last_frontend_dir: frontendDir.trim(),
          last_build_script: selectedBuildScript,
          last_project_type: branchProjectType,
          last_auto_push_image: autoPushImage,
          last_auto_publish_ks: autoPublishKs,
          last_package_with_backend: packageWithBackend,
          last_spring_profile: springProfile,
          last_expose_port: branchExposePort,
          repo_path_history: newHistory,
        },
        repoPath,
        {
          springProfile,
          exposePort: branchExposePort,
          nginxLocations,
        },
      );
      invoke("save_config", { config: updatedConfig }).then(() => {
        setConfig(updatedConfig);
      });
    }
  }

  /** 清空 Git 记忆后重置分支面板本地状态。 */
  function resetGitMemoryUi() {
    setRepoPath("");
    setBranchName("");
    setBranchOptions([]);
    setFrontendDir("");
    setSelectedBuildScript("");
    setBranchProjectType("maven");
    setAutoPushImage(false);
    setAutoPublishKs(false);
    setPackageWithBackend(false);
    setSpringProfile("");
    setSpringProfiles([]);
    setBranchExposePort("");
    setNginxLocations([]);
  }

  /**
   * 配置加载后恢复「记忆分支设置」相关字段。
   * 由 App 在 loadConfig 成功后调用。
   */
  async function applyRememberedConfig(savedConfig: HarborConfig) {
    await restoreRememberedBranchAdvancedSettings(savedConfig, savedConfig.last_repo_path);
    if (!savedConfig.remember_branch_settings) return;
    if (savedConfig.last_repo_path) setRepoPath(savedConfig.last_repo_path);
    if (savedConfig.last_branch) setBranchName(savedConfig.last_branch);
    if (savedConfig.last_frontend_dir) setFrontendDir(savedConfig.last_frontend_dir);
    if (savedConfig.last_build_script) setSelectedBuildScript(savedConfig.last_build_script);
    if (savedConfig.last_auto_push_image !== undefined) {
      setAutoPushImage(savedConfig.last_auto_push_image);
    }
    if (savedConfig.last_auto_publish_ks !== undefined) {
      setAutoPublishKs(savedConfig.last_auto_publish_ks);
    }
    if (savedConfig.last_package_with_backend !== undefined) {
      setPackageWithBackend(savedConfig.last_package_with_backend);
    }
    if (savedConfig.last_repo_path) {
      await loadGitBranches(savedConfig.last_repo_path, savedConfig.last_branch || undefined);
      if (savedConfig.last_branch) {
        await loadSpringProfiles(savedConfig.last_repo_path, savedConfig.last_branch);
        loadLastCommit(savedConfig.last_repo_path, savedConfig.last_branch);
      }
    }
  }

  useEffect(() => {
    checkBranchDockerfile(repoPath, branchName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, branchName]);

  return {
    repoPath,
    setRepoPath,
    frontendDir,
    setFrontendDir,
    npmScripts,
    selectedBuildScript,
    setSelectedBuildScript,
    branchName,
    branchOptions,
    branchProjectType,
    worktreePath,
    customDockerfile,
    branchHasDockerfile,
    autoPushImage,
    setAutoPushImage,
    autoPublishKs,
    setAutoPublishKs,
    packageWithBackend,
    setPackageWithBackend,
    branchExposePort,
    setBranchExposePort,
    nginxLocations,
    setNginxLocations,
    branchFullImage,
    branchImageResults,
    backendArtifactPath,
    springProfile,
    setSpringProfile: handleSpringProfileChange,
    springProfiles,
    lastCommit,
    commitList,
    commitListTotal,
    commitListPage,
    commitListPageSize,
    commitAuthorFilter,
    setCommitAuthorFilter,
    commitMessageFilter,
    setCommitMessageFilter,
    commitAuthors,
    showAdvancedSettings,
    setShowAdvancedSettings,
    showCommitListModal,
    setShowCommitListModal,
    loading,
    loadGitBranches,
    loadSpringProfiles,
    loadLastCommit,
    loadCommitList,
    loadCommitAuthors,
    loadNpmScripts,
    handleSelectRepo,
    handlePackageFromBranch,
    packageFromMergeTarget,
    handleBranchProjectTypeChange,
    handleRepoPathChange,
    handleDropRepoPath,
    handleBranchChange,
    handleRememberSettingsChange,
    applyRememberedConfig,
    resetGitMemoryUi,
    restoreRememberedBranchAdvancedSettings,
  };
}
