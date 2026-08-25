import type { KsPublishMap } from "../types";

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
