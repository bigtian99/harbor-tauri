import { invoke } from "@tauri-apps/api/core";
import type {
  BranchProjectType,
  HarborConfig,
  PackageFromBranchResult,
  NginxLocationBlock,
  TabType,
} from "../../types";
import type { BranchImageResult } from "../../branchImageResults";
import {
  isTauriRuntime,
  inferImageName,
  resolveHarborRepository,
  getProjectName,
} from "../../types";
import { createBranchImageResult, getBranchPushSummary } from "../../branchImageResults";
import { rememberBranchRepoSettings } from "../../branchSettings";
import { prependPathHistory } from "./pathHistory";

export interface BranchPackageActionState {
  repoPath: string;
  branchName: string;
  branchProjectType: BranchProjectType;
  frontendDir: string;
  selectedBuildScript: string;
  autoPushImage: boolean;
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
  setActiveTab: (tab: TabType) => void;
  setLog: (value: string | ((prev: string) => string)) => void;
  setIsBuilding: (value: boolean) => void;
  setCopied: (value: boolean) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
  showToast: (message: string, duration?: number) => void;
  loadBuildHistory: () => Promise<void>;
  setImageName: (value: string) => void;
  setArtifactPath: (value: string) => void;
  setBackendArtifactPath: (value: string) => void;
  setWorktreePath: (value: string) => void;
  setCustomDockerfile: (value: string) => void;
  setBranchFullImage: (value: string) => void;
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
  showToast: BranchPackageActionDeps["showToast"];
  repoPath: string;
  branchName: string;
  frontendDir: string;
  selectedBuildScript: string;
  branchProjectType: BranchProjectType;
  autoPushImage: boolean;
  packageWithBackend: boolean;
  springProfile: string;
  branchExposePort: string;
  nginxLocations: NginxLocationBlock[];
}) {
  const {
    config,
    setConfig,
    showToast,
    repoPath,
    branchName,
    frontendDir,
    selectedBuildScript,
    branchProjectType,
    autoPushImage,
    packageWithBackend,
    springProfile,
    branchExposePort,
    nginxLocations,
  } = deps;

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

export async function handlePackageFromBranch(deps: BranchPackageActionDeps) {
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
  } = deps;

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
    await saveBranchSettings({
      config,
      setConfig,
      showToast,
      repoPath,
      branchName,
      frontendDir,
      selectedBuildScript,
      branchProjectType,
      autoPushImage,
      packageWithBackend,
      springProfile,
      branchExposePort,
      nginxLocations,
    });
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
