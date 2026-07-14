import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BranchProjectType,
  GitBranchOption,
  LastCommitInfo,
  CommitInfo,
} from "../../types";
import { isTauriRuntime, isGitUrl } from "../../types";
import type { BranchLoadingKey } from "./useBranchCommits";

interface UseBranchGitLoadDeps {
  branchProjectType: BranchProjectType;
  frontendDir: string;
  setBranchName: (value: string) => void;
  setBranchOptions: Dispatch<SetStateAction<GitBranchOption[]>>;
  setSpringProfiles: Dispatch<SetStateAction<string[]>>;
  setSpringProfile: Dispatch<SetStateAction<string>>;
  setLastCommit: Dispatch<SetStateAction<LastCommitInfo | null>>;
  setCommitList: Dispatch<SetStateAction<CommitInfo[]>>;
  setCommitListTotal: Dispatch<SetStateAction<number>>;
  setNpmScripts: Dispatch<SetStateAction<string[]>>;
  setSelectedBuildScript: Dispatch<SetStateAction<string>>;
  setFrontendDir: Dispatch<SetStateAction<string>>;
  setBranchHasDockerfile: Dispatch<SetStateAction<boolean>>;
  setLog: (value: string | ((prev: string) => string)) => void;
  updateLoading: (key: BranchLoadingKey, value: boolean) => void;
  /** 竞态守卫：由 useBranchPack 持有 branchLoadRequestRef */
  isStaleBranchLoad: (requestId?: number) => boolean;
  /** 发起新一轮仓库加载时递增 request id */
  nextBranchLoadRequestId: () => number;
  loadLastCommit: (
    repoPathArg: string,
    branch: string,
    branchLoadRequestId?: number,
  ) => Promise<void>;
  loadCommitList: (
    repoPathArg: string,
    branch: string,
    page?: number,
    authorFilter?: string,
    messageFilter?: string,
    branchLoadRequestId?: number,
  ) => Promise<void>;
}

/**
 * 分支/仓库加载：git 分支、Spring profile、npm scripts、Dockerfile 检测。
 * 竞态守卫 branchLoadRequestRef / isStaleBranchLoad 由 composer 持有并注入。
 */
export function useBranchGitLoad(deps: UseBranchGitLoadDeps) {
  const {
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
  } = deps;

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

  async function loadGitBranches(path: string, preserveBranch?: string) {
    const requestId = nextBranchLoadRequestId();
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
      if (targetBranch) {
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

  async function checkBranchDockerfile(repoPath: string, branchName: string) {
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

  return {
    loadGitBranches,
    loadSpringProfiles,
    loadNpmScripts,
    checkBranchDockerfile,
  };
}
