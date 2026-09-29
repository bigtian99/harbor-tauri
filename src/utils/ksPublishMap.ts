import type { KsPublishMap, KsPublishMapRole } from "../types";

export function normalizeGitUrl(url: string): string {
  let s = url.trim().toLowerCase();

  while (s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  if (s.endsWith(".git")) {
    s = s.slice(0, -4);
  }

  if (s.startsWith("git@")) {
    return s.slice(4).replace(":", "/");
  }

  const schemeMatch = s.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?(.+)$/);
  if (schemeMatch) {
    return schemeMatch[1];
  }

  return s;
}

export function createKsPublishMap(
  partial: Omit<KsPublishMap, "id" | "git_url_key"> & { id?: string },
): KsPublishMap {
  const id =
    partial.id ??
    `ks-map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const git_url_key = normalizeGitUrl(partial.git_url);
  return { ...partial, id, git_url_key };
}

/** 同一 Git + 角色可对应多个部署；精确 role 优先，否则回退 any。 */
export function lookupKsPublishMaps(
  maps: KsPublishMap[],
  gitUrlKey: string,
  imageRole: "frontend" | "backend",
): KsPublishMap[] {
  const matched = maps.filter((m) => m.git_url_key === gitUrlKey);
  if (matched.length === 0) return [];

  const exact = matched.filter((m) => m.role === imageRole);
  if (exact.length > 0) return exact;

  return matched.filter((m) => m.role === "any");
}

export function lookupKsPublishMap(
  maps: KsPublishMap[],
  gitUrlKey: string,
  imageRole: "frontend" | "backend",
): KsPublishMap | null {
  return lookupKsPublishMaps(maps, gitUrlKey, imageRole)[0] ?? null;
}

/** 按环境 + 命名空间 + 部署名查映射（KS 列表批量操作用） */
export function lookupKsPublishMapByDeployment(
  maps: KsPublishMap[],
  envId: string,
  namespace: string,
  deployment: string,
): KsPublishMap | null {
  const dep = deployment.trim();
  if (!dep) return null;
  return (
    maps.find(
      (m) =>
        m.env_id === envId
        && m.namespace === namespace
        && m.deployment === dep,
    ) ?? null
  );
}

/**
 * 按 环境 + 命名空间 + 部署名 upsert 一条发布映射（同一部署只保留一条）。
 * 创建部署走 Git 构建成功后写回，便于之后用批量打包。
 */
export function upsertKsPublishMapForDeployment(
  maps: KsPublishMap[],
  input: {
    git_url: string;
    role: KsPublishMapRole;
    env_id: string;
    namespace: string;
    deployment: string;
    container?: string;
    expose_port?: string;
    maven_module?: string;
  },
): { maps: KsPublishMap[]; action: "created" | "updated" | "none" } {
  const gitUrl = input.git_url.trim();
  const deployment = input.deployment.trim();
  if (!gitUrl || !deployment) return { maps, action: "none" };

  const existingIdx = maps.findIndex(
    (m) =>
      m.env_id === input.env_id
      && m.namespace === input.namespace
      && m.deployment === deployment,
  );
  const next = createKsPublishMap({
    id: existingIdx >= 0 ? maps[existingIdx].id : undefined,
    git_url: gitUrl,
    role: input.role,
    env_id: input.env_id,
    namespace: input.namespace,
    deployment,
    container: input.container,
    expose_port: input.expose_port,
    maven_module: input.maven_module?.trim() || undefined,
  });
  if (existingIdx < 0) return { maps: [...maps, next], action: "created" };
  const copy = maps.slice();
  copy[existingIdx] = next;
  return { maps: copy, action: "updated" };
}
