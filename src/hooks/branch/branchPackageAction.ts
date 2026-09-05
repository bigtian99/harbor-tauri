import { invoke } from "@tauri-apps/api/core";
import type {
  BranchProjectType,
  HarborConfig,
  NginxLocationBlock,
  TabType,
} from "../../types";
import type { BranchImageResult } from "../../branchImageResults";
import { isTauriRuntime } from "../../types";
import { formatBranchImagesForHistory } from "../../branchImageResults";
import { rememberBranchRepoSettings } from "../../branchSettings";
import { showSystemAlert } from "../../systemAlert";
import { runKsAutoPublish } from "../../utils/ksAutoPublish";
import { prependPathHistory } from "./pathHistory";
import { runBranchPackageAndPush } from "./branchPackageRun";

export interface BranchPackageActionState {
  repoPath: string;
  branchName: string;
  branchProjectType: BranchProjectType;
  frontendDir: string;
  selectedBuildScript: string;
  autoPushImage: boolean;
  autoPublishKs: boolean;
  packageWithBackend: boolean;
  springProfile: string;
  branchExposePort: string;
  nginxLocations: NginxLocationBlock[];
  imageName: string;
  imageTag: string;
}

export interface BranchPackageActionDeps extends BranchPackageActionState {
  config: HarborConfig;
  setConfig: (value: HarborConfig | ((prev: HarborConfig) => HarborConfig)) => void;
  getConfigSnapshot?: () => HarborConfig;
  setActiveTab: (tab: TabType) => void;
  setLog: (value: string | ((prev: string) => string)) => void;
  setIsBuilding: (value: boolean) => void;
  setCopied: (value: string | null) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
  showToast: (message: string, duration?: number) => void;
  loadBuildHistory: () => Promise<void>;
  setImageName: (value: string) => void;
  setArtifactPath: (value: string) => void;
  setBackendArtifactPath: (value: string) => void;
  setWorktreePath: (value: string) => void;
  setCustomDockerfile: (value: string) => void;
  setBranchFullImage: (
    value: string | ((prev: string) => string),
  ) => void;
  setBranchImageResults: (
    value: BranchImageResult[] | ((prev: BranchImageResult[]) => BranchImageResult[]),
  ) => void;
}

/**
 * 分支打包：保存记忆设置 + package_from_branch 与可选自动推送。
 * 以函数形式导出，由 useBranchPack 在闭包中绑定最新 state（避免 stale state）。
 */
export async function saveBranchSettings(deps: {
  config: HarborConfig;
  setConfig: BranchPackageActionDeps["setConfig"];
  getConfigSnapshot?: () => HarborConfig;
  showToast: BranchPackageActionDeps["showToast"];
  repoPath: string;
  branchName: string;
  frontendDir: string;
  selectedBuildScript: string;
  branchProjectType: BranchProjectType;
  autoPushImage: boolean;
  autoPublishKs: boolean;
  packageWithBackend: boolean;
  springProfile: string;
  branchExposePort: string;
  nginxLocations: NginxLocationBlock[];
}) {
  const {
    config,
    setConfig,
    getConfigSnapshot,
    showToast,
    repoPath,
    branchName,
    frontendDir,
    selectedBuildScript,
    branchProjectType,
    autoPushImage,
    autoPublishKs,
    packageWithBackend,
    springProfile,
    branchExposePort,
    nginxLocations,
  } = deps;

  const base = getConfigSnapshot?.() ?? config;
  if (!isTauriRuntime() || !base.remember_branch_settings) return;
  try {
    const newHistory = prependPathHistory(base.repo_path_history, repoPath);
    const updatedConfig = rememberBranchRepoSettings(
      {
        ...base,
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
    setConfig(updatedConfig);
    await invoke("save_config", { config: getConfigSnapshot?.() ?? updatedConfig });
  } catch (e) {
    console.error("保存分支设置失败:", e);
    showToast(`保存分支设置失败: ${e}`);
  }
}

/** 合并后同步打包等场景：覆盖仓库/分支/是否推 Harbor（避免 setState 未 flush） */
export type BranchPackageOverrides = {
  repoPath?: string;
  branchName?: string;
  autoPushImage?: boolean;
  autoPublishKs?: boolean;
};

export async function handlePackageFromBranch(
  deps: BranchPackageActionDeps,
  overrides?: BranchPackageOverrides,
) {
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
    setArtifactPath,
    setBackendArtifactPath,
    setWorktreePath,
    setCustomDockerfile,
    setBranchFullImage,
    setBranchImageResults,
    branchProjectType,
    frontendDir,
    selectedBuildScript,
    packageWithBackend,
    springProfile,
    branchExposePort,
    nginxLocations,
  } = deps;
  const repoPath = overrides?.repoPath ?? deps.repoPath;
  const branchName = overrides?.branchName ?? deps.branchName;
  const autoPushImage = overrides?.autoPushImage ?? deps.autoPushImage;
  const autoPublishKs = overrides?.autoPublishKs ?? deps.autoPublishKs;

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
  setCopied(null);
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
    setProgressMessage("⬇️ 开始更新分支代码...");
    const runResult = await runBranchPackageAndPush({
      config,
      repoPath,
      branchName,
      branchProjectType,
      frontendDir,
      selectedBuildScript,
      packageWithBackend,
      springProfile,
      branchExposePort,
      nginxLocations,
      imageName,
      imageTag,
      autoPushImage,
    });

    if (!runResult.ok && !runResult.packageLog) {
      setLog(`❌ 打包失败:\n${runResult.error ?? "未知错误"}`);
      return;
    }

    setArtifactPath(runResult.artifactPath);
    setBackendArtifactPath(runResult.backendArtifactPath);
    setWorktreePath(runResult.worktreePath);
    setCustomDockerfile(runResult.dockerfilePath);
    if (runResult.effectiveImageName) {
      setImageName(runResult.effectiveImageName);
    }

    const resultLog = runResult.packageLog;
    const btSummary = runResult.btDeploySummary;

    await saveBranchSettings({
      config,
      setConfig,
      getConfigSnapshot: deps.getConfigSnapshot,
      showToast,
      repoPath,
      branchName,
      frontendDir,
      selectedBuildScript,
      branchProjectType,
      autoPushImage,
      autoPublishKs,
      packageWithBackend,
      springProfile,
      branchExposePort,
      nginxLocations,
    });
    await loadBuildHistory();
    setActiveTab("branch");

    /** 推送成功后按映射发布 KS；失败不改推送成功态 */
    async function maybeAutoPublishKs(imageResults: BranchImageResult[]) {
      if (!autoPublishKs || imageResults.length === 0) return;
      setProgressMessage("🚀 自动发布到 KubeSphere...");
      await runKsAutoPublish({
        repoPath,
        images: imageResults.map((r) => ({ role: r.role, image: r.image })),
        maps: config.ks_publish_maps ?? [],
        config,
        appendLog: (line) => {
          setLog((prev) => (prev ? `${prev}\n${line}` : line));
        },
      });
    }

    if (!autoPushImage) {
      setLog(`✅ 分支打包完成\n\n${resultLog}`);
      setProgress(100);
      setProgressMessage("✅ 分支打包完成");
      await showSystemAlert(
        "打包完成",
        `分支「${branchName.trim()}」打包成功。`,
      );
      if (btSummary) {
        await showSystemAlert("上传完成", btSummary);
      }
      return;
    }

    if (runResult.pushErrors.length > 0 || runResult.images.length === 0) {
      const errText = runResult.error || runResult.pushErrors.join("\n");
      setLog(
        runResult.artifactPath
          ? `⚠️ 分支打包成功，但镜像推送未完成\n\n${errText}\n\n${resultLog}`
          : `❌ 打包失败:\n${errText}`,
      );
      if (runResult.artifactPath) {
        await showSystemAlert("打包完成", `分支「${branchName.trim()}」打包成功，但推送未完成。`);
      }
      return;
    }

    setProgress(60);
    setProgressMessage("🚀 推送镜像...");
    setBranchImageResults(runResult.images);
    setBranchFullImage(
      runResult.images
        .map((r) => `${r.role === "frontend" ? "前端" : "后端"}: ${r.image}`)
        .join("\n"),
    );
    try {
      await invoke("update_build_record_image", {
        imageName: runResult.effectiveImageName,
        imageTag:
          runResult.images.length === 1
            ? runResult.images[0].image
            : formatBranchImagesForHistory(runResult.images),
      });
      await loadBuildHistory();
    } catch {
      /* 忽略 */
    }
    setProgress(100);
    setProgressMessage("✅ 镜像推送完成");
    setLog(`✅ 分支打包并推送镜像完成\n\n${resultLog}`);
    setActiveTab("branch");
    await maybeAutoPublishKs(runResult.images);
    await showSystemAlert(
      "打包完成",
      `分支「${branchName.trim()}」打包成功。`,
    );
    if (btSummary) {
      await showSystemAlert("上传完成", btSummary);
    }
  } catch (e) {
    setLog(`❌ 打包失败:\n${e}`);
  } finally {
    setIsBuilding(false);
  }
}
