import { invoke } from "@tauri-apps/api/core";
import type {
  BranchProjectType,
  HarborConfig,
  NginxLocationBlock,
  PackageFromBranchResult,
} from "../../types";
import type { BranchImageResult } from "../../branchImageResults";
import {
  createBranchImageResult,
  getBranchPushSummary,
  sortBranchImageResults,
} from "../../branchImageResults";
import { sanitizeBranchForImageRef } from "../../branchRef";
import {
  getProjectName,
  inferImageName,
  isTauriRuntime,
  resolveHarborRepository,
} from "../../types";

export interface BranchPackageRunParams {
  config: HarborConfig;
  repoPath: string;
  branchName: string;
  branchProjectType: BranchProjectType;
  frontendDir: string;
  selectedBuildScript: string;
  packageWithBackend: boolean;
  springProfile: string;
  branchExposePort: string;
  nginxLocations: NginxLocationBlock[];
  /** 空则按产物/目录推断 */
  imageName?: string;
  imageTag?: string;
  autoPushImage: boolean;
  /** 传给 build_and_push 的 progressLabel */
  progressLabel?: string;
  /** K8s Deployment 名，多模块 Maven 自动匹配子模块 */
  deploymentHint?: string;
  /** 并行打包 worktree 槽位（同 Git 多服务） */
  packSlot?: string;
}

export interface BranchPackageRunResult {
  ok: boolean;
  error?: string;
  packageLog: string;
  images: BranchImageResult[];
  pushErrors: string[];
  artifactPath: string;
  backendArtifactPath: string;
  worktreePath: string;
  dockerfilePath: string;
  effectiveImageName: string;
  btDeploySummary: string;
}

function buildBranchImageTag(branchName: string, imageTag?: string): string {
  const branchSafeName = sanitizeBranchForImageRef(branchName);
  if (imageTag && imageTag !== "latest") return imageTag;
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${branchSafeName}-v.${yy}.${mm}.${dd}.${hh}.${mi}`;
}

/**
 * 分支打包 + 可选 Harbor 推送（与分支打包页同一套逻辑，无 UI 副作用）。
 */
export async function runBranchPackageAndPush(
  params: BranchPackageRunParams,
): Promise<BranchPackageRunResult> {
  const {
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
    imageName = "",
    imageTag,
    autoPushImage,
    progressLabel,
    deploymentHint,
    packSlot,
  } = params;

  const emptyArtifacts = {
    artifactPath: "",
    backendArtifactPath: "",
    worktreePath: "",
    dockerfilePath: "",
    effectiveImageName: "",
    btDeploySummary: "",
  };

  if (!isTauriRuntime()) {
    return {
      ok: false,
      error: "请在 Tauri 桌面窗口中操作",
      packageLog: "",
      images: [],
      pushErrors: [],
      ...emptyArtifacts,
    };
  }
  if (!repoPath.trim()) {
    return {
      ok: false,
      error: "仓库路径为空",
      packageLog: "",
      images: [],
      pushErrors: [],
      ...emptyArtifacts,
    };
  }
  if (!branchName.trim()) {
    return {
      ok: false,
      error: "分支为空",
      packageLog: "",
      images: [],
      pushErrors: [],
      ...emptyArtifacts,
    };
  }

  let result: PackageFromBranchResult;
  try {
    result = await invoke<PackageFromBranchResult>("package_from_branch", {
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
      deploymentHint: deploymentHint?.trim() || null,
      packSlot: packSlot?.trim() || null,
    });
  } catch (e) {
    return {
      ok: false,
      error: String(e),
      packageLog: "",
      images: [],
      pushErrors: [],
      ...emptyArtifacts,
    };
  }

  const baseName =
    branchProjectType === "npm"
      ? getProjectName(repoPath).toLowerCase()
      : inferImageName(result.artifact_path, "jar");
  const effectiveImageName = imageName.trim() || baseName;
  const branchSafeName = sanitizeBranchForImageRef(branchName);
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

  const artifacts = {
    artifactPath: result.artifact_path,
    backendArtifactPath: result.backend_artifact_path || "",
    worktreePath: result.worktree_path,
    dockerfilePath: result.dockerfile_path || "",
    effectiveImageName,
    btDeploySummary: result.bt_deploy_summary?.trim() ?? "",
  };

  if (!autoPushImage) {
    return {
      ok: true,
      packageLog: result.log,
      images: [],
      pushErrors: [],
      ...artifacts,
    };
  }

  if (!config.harbor_url || !config.username || !config.password || !config.project) {
    return {
      ok: false,
      error: "Harbor 配置不完整",
      packageLog: result.log,
      images: [],
      pushErrors: ["Harbor 配置不完整，无法推送镜像"],
      ...artifacts,
    };
  }

  const branchImageTag = buildBranchImageTag(branchName, imageTag);
  const label = progressLabel?.trim() || undefined;

  if (!effectiveImageName) {
    return {
      ok: false,
      error: "未设置镜像名称",
      packageLog: result.log,
      images: [],
      pushErrors: ["未设置镜像名称，跳过推送"],
      ...artifacts,
    };
  }

  const namesToPush =
    branchProjectType === "maven"
      ? [backendImageName]
      : result.backend_artifact_path
        ? [frontendImageName, backendImageName]
        : [frontendImageName];
  const invalidName = namesToPush.find(
    (name) => !resolveHarborRepository(name, config.project).ok,
  );
  if (invalidName) {
    const err = resolveHarborRepository(invalidName, config.project);
    return {
      ok: false,
      error: err.ok ? "镜像名不合法" : err.error,
      packageLog: result.log,
      images: [],
      pushErrors: [err.ok ? "镜像名不合法" : err.error],
      ...artifacts,
    };
  }

  const pushErrors: string[] = [];
  const images: BranchImageResult[] = [];

  try {
    if (branchProjectType === "maven") {
      const resultStr = await invoke<string>("build_and_push", {
        jarPath: result.artifact_path,
        imageName: backendImageName,
        imageTag: branchImageTag,
        artifactType: "jar",
        dockerfilePath: null,
        dockerfileContext: null,
        exposePort: branchExposePort || null,
        nginxLocations: [],
        progressLabel: label,
      });
      const imgMatch = resultStr.match(/完整镜像:\s*(.+)/);
      if (imgMatch) {
        images.push(createBranchImageResult("backend", imgMatch[1].trim()));
      }
      return {
        ok: true,
        packageLog: result.log,
        images,
        pushErrors,
        ...artifacts,
      };
    }

    const roleLabel = (role: "frontend" | "backend") =>
      role === "frontend" ? "前端" : "后端";

    type PushOutcome =
      | { role: "frontend" | "backend"; ok: true; image?: string }
      | { role: "frontend" | "backend"; ok: false; error: unknown };

    const pushOne = async (
      role: "frontend" | "backend",
      args: Record<string, unknown>,
    ): Promise<PushOutcome> => {
      try {
        const value = await invoke<string>("build_and_push", {
          ...args,
          progressLabel: label ?? roleLabel(role),
        });
        const imgMatch = value.match(/完整镜像:\s*(.+)/);
        if (imgMatch) {
          return { role, ok: true, image: imgMatch[1].trim() };
        }
        return { role, ok: true };
      } catch (error) {
        return { role, ok: false, error };
      }
    };

    const pushTasks: Promise<PushOutcome>[] = [
      pushOne("frontend", {
        jarPath: result.artifact_path,
        imageName: frontendImageName,
        imageTag: branchImageTag,
        artifactType: "frontend_dist",
        dockerfilePath: null,
        dockerfileContext: null,
        nginxLocations,
      }),
    ];
    if (result.backend_artifact_path) {
      pushTasks.push(
        pushOne("backend", {
          jarPath: result.backend_artifact_path,
          imageName: backendImageName,
          imageTag: branchImageTag,
          artifactType: "jar",
          dockerfilePath: null,
          dockerfileContext: null,
          exposePort: branchExposePort || null,
          nginxLocations: [],
        }),
      );
    }

    const outcomes = await Promise.all(pushTasks);
    for (const out of outcomes) {
      if (!out.ok) {
        pushErrors.push(`❌ ${roleLabel(out.role)}推送失败: ${out.error}`);
      } else if (out.image) {
        images.push(createBranchImageResult(out.role, out.image));
      }
    }

    const sorted = sortBranchImageResults(images);
    const hasBackend = !!result.backend_artifact_path;
    const pushOk =
      sorted.length > 0
      && (hasBackend ? sorted.length >= 2 : sorted.length >= 1)
      && pushErrors.length === 0;

    return {
      ok: pushOk || (sorted.length > 0 && !hasBackend),
      error: pushOk ? undefined : getBranchPushSummary(pushErrors, hasBackend),
      packageLog: result.log,
      images: sorted,
      pushErrors,
      ...artifacts,
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e),
      packageLog: result.log,
      images,
      pushErrors: [...pushErrors, String(e)],
      ...artifacts,
    };
  }
}

/** KS 批量发布时取主镜像：后端部署用 backend，前端用 frontend */
export function primaryImageForKsRole(
  images: BranchImageResult[],
  role: "frontend" | "backend" | "any",
): string | null {
  if (images.length === 0) return null;
  if (role === "frontend") {
    return images.find((i) => i.role === "frontend")?.image ?? images[0]?.image ?? null;
  }
  return images.find((i) => i.role === "backend")?.image ?? images[0]?.image ?? null;
}
