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

export function lookupKsPublishMap(
  maps: KsPublishMap[],
  gitUrlKey: string,
  imageRole: "frontend" | "backend",
): KsPublishMap | null {
  const matched = maps.filter((m) => m.git_url_key === gitUrlKey);
  if (matched.length === 0) return null;

  const exact = matched.find((m) => m.role === imageRole);
  if (exact) return exact;

  const any = matched.find((m) => m.role === "any");
  return any ?? null;
}
