import type { BuildRecord, HarborConfig } from "./types.ts";
import { getRememberedBranchAdvancedSettings } from "./branchSettings.ts";

function projectNameFromRepo(repoPath: string): string {
  return repoPath.split("/").filter(Boolean).pop() || repoPath;
}

function inferJarImageName(jarPath: string): string {
  const parts = jarPath.split(/[/\\]/).filter(Boolean);
  const lastName = parts.length > 0 ? parts[parts.length - 1] : "";
  return lastName.replace(/\.jar$/i, "").replace(/-\d.*/, "").toLowerCase();
}

/** 未推送且存在可推 Harbor 的 JAR 路径；否则 null */
export function historyJarPushTarget(record: BuildRecord): string | null {
  if (record.status === "pushed") return null;
  const type = record.project_type.toLowerCase();
  if (type === "maven" && record.artifact_path.trim()) {
    return record.artifact_path.trim();
  }
  if (type === "npm" && record.backend_artifact_path?.trim()) {
    return record.backend_artifact_path.trim();
  }
  return null;
}

export function historyCanPushJar(record: BuildRecord): boolean {
  return historyJarPushTarget(record) !== null;
}

/** 从记录 + 仓库记忆解析推送参数 */
export function resolveHistoryJarPushConfig(
  record: BuildRecord,
  config: HarborConfig,
): {
  jarPath: string;
  imageName: string;
  imageTag: string;
  exposePort: string;
} | null {
  const jarPath = historyJarPushTarget(record);
  if (!jarPath) return null;

  const remembered = getRememberedBranchAdvancedSettings(config, record.repo_path);
  const exposePort = remembered.exposePort.trim() || config.expose_port.trim();

  let imageName = (record.image_name || "").trim();
  if (!imageName) {
    imageName = inferJarImageName(jarPath) || projectNameFromRepo(record.repo_path).toLowerCase();
  }
  if (exposePort && !imageName.endsWith(`-${exposePort}`)) {
    imageName = `${imageName}-${exposePort}`;
  }

  const branchSafe = record.branch.trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "local";
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const imageTag = `${branchSafe}-v.${yy}.${mm}.${dd}.${hh}.${mi}`;

  return { jarPath, imageName, imageTag, exposePort };
}
