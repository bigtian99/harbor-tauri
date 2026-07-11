import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  BranchProjectType,
  HarborConfig,
  PackageFromBranchResult,
  GitBranchOption,
  LastCommitInfo,
  CommitInfo,
  CommitListResult,
  AuthorInfo,
  NginxLocationBlock,
  TabType,
} from "../types";
import type { BranchImageResult } from "../branchImageResults";
import {
  isTauriRuntime,
  inferImageName,
  isGitUrl,
  resolveHarborRepository,
  getProjectName,
} from "../types";
import { createBranchImageResult, getBranchPushSummary } from "../branchImageResults";
import { getRememberedBranchAdvancedSettings, rememberBranchRepoSettings } from "../branchSettings";

// 把路径加入历史记录最前（去重，上限 20）；路径为空时仅去重返回
function prependPathHistory(history: string[] | undefined, path: string): string[] {
  const trimmed = path.trim();
  const rest = (history || []).filter((p) => p !== trimmed);
  return trimmed ? [trimmed, ...rest].slice(0, 20) : rest;
}

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

  // 提交信息
  const [lastCommit, setLastCommit] = useState<LastCommitInfo | null>(null);
  const [commitList, setCommitList] = useState<CommitInfo[]>([]);
  const [commitListTotal, setCommitListTotal] = useState(0);
  const [commitListPage, setCommitListPage] = useState(1);
  const [commitListPageSize, setCommitListPageSize] = useState(10);
  const [commitAuthorFilter, setCommitAuthorFilter] = useState("");
  const [commitMessageFilter, setCommitMessageFilter] = useState("");
  const [commitAuthors, setCommitAuthors] = useState<AuthorInfo[]>([]);

  // UI / loading
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showCommitListModal, setShowCommitListModal] = useState(false);
  const [loading, setLoading] = useState({
    scripts: false,
    branches: false,
    profiles: false,
    commit: false,
    commitList: false,
  });
  const updateLoading = (key: keyof typeof loading, value: boolean) =>
    setLoading((prev) => ({ ...prev, [key]: value }));

  const branchLoadRequestRef = useRef(0);

  function restoreRememberedBranchAdvancedSettings(
    sourceConfig = config,
    sourceRepoPath = repoPath,
  ) {
    const remembered = getRememberedBranchAdvancedSettings(sourceConfig, sourceRepoPath);
    setSpringProfile(remembered.springProfile);
    setBranchExposePort(remembered.exposePort);
    setNginxLocations(remembered.nginxLocations ?? []);
  }

  function isStaleBranchLoad(requestId?: number) {
    return requestId !== undefined && requestId !== branchLoadRequestRef.current;
  }

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
    updateLoading("branches", true);
    setLog("");
    try {
      const isUrl = isGitUrl(nextRepoPath);
      const branches = isUrl
        ? await invoke<GitBranchOption[]>("list_git_branches_from_url", { url: nextRepoPath })
        : await invoke<GitBranchOption[]>("list_git_branches", { repoPath: nextRepoPath });
      if (isStaleBranchLoad(requestId)) return;
      setBranchOptions(branches);
      const targetBranch =
        preserveBranch && branches.some((b) => b.name === preserveBranch)
          ? preserveBranch
          : (branches[0]?.name ?? "");
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
          const detectedDir = await invoke<string | null>("detect_frontend_dir", {
            repoPath: nextRepoPath,
          });
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
        updateLoading("branches", false);
      }
    }
  }

  async function loadSpringProfiles(
    repoPathArg: string,
    branch: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPathArg.trim() || !branch.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setSpringProfiles([]);
      }
      return;
    }
    updateLoading("profiles", true);
    try {
      const profiles = await invoke<string[]>("detect_spring_profiles", {
        repoPath: repoPathArg.trim(),
        branch: branch.trim(),
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setSpringProfiles(profiles);
      if (profiles.includes("test")) {
        setSpringProfile((prev) => prev || "test");
      }
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      console.error("[Spring Profiles] 检测失败:", e);
      setSpringProfiles([]);
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading("profiles", false);
      }
    }
  }

  async function loadLastCommit(
    repoPathArg: string,
    branch: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setLastCommit(null);
      }
      return;
    }
    updateLoading("commit", true);
    try {
      const commit = await invoke<LastCommitInfo>("get_last_commit", {
        repoPath: repoPathArg.trim(),
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
        updateLoading("commit", false);
      }
    }
  }

  async function loadCommitList(
    repoPathArg: string,
    branch: string,
    page: number = 1,
    authorFilter?: string,
    messageFilter?: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setCommitList([]);
        setCommitListTotal(0);
      }
      return;
    }
    updateLoading("commitList", true);
    try {
      const result = await invoke<CommitListResult>("get_commit_list", {
        repoPath: repoPathArg.trim(),
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
        updateLoading("commitList", false);
      }
    }
  }

  async function loadCommitAuthors(repoPathArg: string, branch: string) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      setCommitAuthors([]);
      return;
    }
    try {
      const authors = await invoke<AuthorInfo[]>("get_commit_authors", {
        repoPath: repoPathArg.trim(),
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

  async function loadNpmScripts(
    repoPathArg: string,
    frontendDirArg: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setNpmScripts([]);
        setSelectedBuildScript("");
      }
      return;
    }
    updateLoading("scripts", true);
    try {
      const scripts = await invoke<string[]>("list_npm_scripts", {
        repoPath: repoPathArg.trim(),
        frontendDir: frontendDirArg.trim() || null,
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setNpmScripts(scripts);
      const preferred = ["build", "build:prod", "build:production", "compile", "dist"];
      const autoSelected = preferred.find((s) => scripts.includes(s)) || scripts[0] || "";
      setSelectedBuildScript(autoSelected);
    } catch {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setNpmScripts([]);
      setSelectedBuildScript("");
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading("scripts", false);
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

  async function saveBranchSettings() {
    if (!isTauriRuntime() || !config.remember_branch_settings) return;
    try {
      const newHistory = prependPathHistory(config.repo_path_history, repoPath);
      const updatedConfig = rememberBranchRepoSettings(
        {
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
        },
        repoPath,
        {
          springProfile,
          exposePort: branchExposePort,
          nginxLocations,
        },
      );
      await invoke("save_config", { config: updatedConfig });
      setConfig(updatedConfig);
    } catch (e) {
      console.error("保存分支设置失败:", e);
      showToast(`保存分支设置失败: ${e}`);
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
        frontendDir: branchProjectType === "npm" ? frontendDir.trim() || null : null,
        buildScript: branchProjectType === "npm" ? selectedBuildScript : null,
        packageManager: config.npm_package_manager || "npm",
        springProfile:
          (branchProjectType === "maven" || packageWithBackend) && springProfile.trim()
            ? springProfile.trim()
            : null,
        packageWithBackend: branchProjectType === "npm" ? packageWithBackend : false,
      });
      setArtifactPath(result.artifact_path);
      setBackendArtifactPath(result.backend_artifact_path || "");
      setWorktreePath(result.worktree_path);
      setCustomDockerfile(result.dockerfile_path || "");
      const baseName =
        branchProjectType === "npm"
          ? getProjectName(repoPath).toLowerCase()
          : inferImageName(result.artifact_path, "jar");
      const effectiveImageName = imageName.trim() || baseName;
      const branchSafeName = branchName.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
      const scriptSafeName = selectedBuildScript.replace(/[^a-zA-Z0-9._-]/g, "-");
      const frontendDistSuffix =
        branchProjectType === "npm" ? `-frontend-${branchSafeName}-${scriptSafeName}` : "";
      const frontendImageName = `${effectiveImageName}${frontendDistSuffix}`;
      const effectivePort = branchExposePort.trim() || config.expose_port.trim();
      const portSuffix = effectivePort ? `-${effectivePort}` : "";
      const profileSuffix = springProfile.trim() ? `-${springProfile.trim()}` : "";
      const backendImageName =
        branchProjectType === "npm" && result.backend_artifact_path
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
          setLog(
            `⚠️ 分支打包成功，但 Harbor 配置不完整，无法推送镜像\n\n请在"推送配置" tab 中完善 Harbor 配置后重试\n\n${result.log}`,
          );
        } else {
          const hasBackend = !!result.backend_artifact_path;
          const now = new Date();
          const yy = String(now.getFullYear()).slice(-2);
          const mm = String(now.getMonth() + 1).padStart(2, "0");
          const dd = String(now.getDate()).padStart(2, "0");
          const hh = String(now.getHours()).padStart(2, "0");
          const mi = String(now.getMinutes()).padStart(2, "0");
          const branchImageTag =
            imageTag && imageTag !== "latest"
              ? imageTag
              : `${branchSafeName}-v.${yy}.${mm}.${dd}.${hh}.${mi}`;

          if (!effectiveImageName) {
            setLog(`⚠️ 分支打包成功，但未设置镜像名称，跳过推送\n\n${result.log}`);
          } else {
            const namesToPush =
              branchProjectType === "maven"
                ? [backendImageName]
                : hasBackend
                  ? [frontendImageName, backendImageName]
                  : [frontendImageName];
            const invalidName = namesToPush.find(
              (name) => !resolveHarborRepository(name, config.project).ok,
            );
            if (invalidName) {
              const err = resolveHarborRepository(invalidName, config.project);
              setLog(
                `⚠️ 分支打包成功，但镜像名不符合 Harbor 要求，跳过推送\n\n${err.ok ? "" : err.error}\n\n${result.log}`,
              );
            } else {
              const pushLogs: string[] = [];
              const imageList: string[] = [];

              try {
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
                    nginxLocations: [],
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
                    } catch {
                      /* 忽略 */
                    }
                  }
                  setBranchFullImage(imageList.join("\n"));
                  setLog(`✅ 分支打包并推送镜像完成\n\n${result.log}\n\n${pushLogs.join("\n")}`);
                  setActiveTab("branch");
                  return;
                }

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
                    nginxLocations: nginxLocations,
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
                    } catch {
                      /* 忽略 */
                    }
                  }
                } catch (feErr) {
                  pushLogs.push(`❌ 前端推送失败: ${feErr}`);
                }

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
                      nginxLocations: [],
                    });
                    pushLogs.push(`📦 后端: ${beResult}`);
                    const beMatch = beResult.match(/完整镜像:\s*(.+)/);
                    if (beMatch) {
                      const image = beMatch[1].trim();
                      imageList.push(`后端: ${image}`);
                      setBranchImageResults((prev) => [
                        ...prev,
                        createBranchImageResult("backend", image),
                      ]);
                    }
                  } catch (beErr) {
                    pushLogs.push(`❌ 后端推送失败: ${beErr}`);
                  }
                }

                setBranchFullImage(imageList.join("\n"));
                setLog(
                  `${getBranchPushSummary(pushLogs, hasBackend)}\n\n${result.log}\n\n${pushLogs.join("\n")}`,
                );
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
    checkBranchDockerfile();
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
