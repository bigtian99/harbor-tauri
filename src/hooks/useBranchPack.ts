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
import { isTauriRuntime } from "../types";
import { getRememberedBranchAdvancedSettings, rememberBranchRepoSettings } from "../branchSettings";
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
  setCopied: (value: boolean) => void;
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

  function restoreRememberedBranchAdvancedSettings(
    sourceConfig = config,
    sourceRepoPath = repoPath,
  ) {
    const remembered = getRememberedBranchAdvancedSettings(sourceConfig, sourceRepoPath);
    setSpringProfile(remembered.springProfile);
    setBranchExposePort(remembered.exposePort);
    setNginxLocations(remembered.nginxLocations ?? []);
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
    frontendDir,
    setBranchName,
    setBranchOptions,
    setSpringProfiles,
    setSpringProfile,
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

  async function handlePackageFromBranch() {
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
      packageWithBackend,
      springProfile,
      branchExposePort,
      nginxLocations,
    });
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
        restoreRememberedBranchAdvancedSettings(config, selectedPath);
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

  /** 拖入仓库目录时调用（与 handleRepoPathChange 语义一致） */
  function handleDropRepoPath(path: string) {
    setRepoPath(path);
    setImageName("");
    restoreRememberedBranchAdvancedSettings(config, path);
    loadGitBranches(path);
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

  /**
   * 配置加载后恢复「记忆分支设置」相关字段。
   * 由 App 在 loadConfig 成功后调用。
   */
  async function applyRememberedConfig(savedConfig: HarborConfig) {
    restoreRememberedBranchAdvancedSettings(savedConfig, savedConfig.last_repo_path);
    if (!savedConfig.remember_branch_settings) return;
    if (savedConfig.last_repo_path) setRepoPath(savedConfig.last_repo_path);
    if (savedConfig.last_branch) setBranchName(savedConfig.last_branch);
    if (savedConfig.last_frontend_dir) setFrontendDir(savedConfig.last_frontend_dir);
    if (savedConfig.last_build_script) setSelectedBuildScript(savedConfig.last_build_script);
    if (savedConfig.last_auto_push_image !== undefined) {
      setAutoPushImage(savedConfig.last_auto_push_image);
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
    setSpringProfile,
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
    handleBranchProjectTypeChange,
    handleRepoPathChange,
    handleDropRepoPath,
    handleBranchChange,
    handleRememberSettingsChange,
    applyRememberedConfig,
    restoreRememberedBranchAdvancedSettings,
  };
}
