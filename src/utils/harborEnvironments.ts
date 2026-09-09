import type { HarborConfig, HarborEnvironment } from "../types";

const SUGGESTED_NAMES = ["开发", "生产", "测试"];

/** 旧四字段是否足以迁成一条环境 */
function hasLegacyHarbor(config: HarborConfig): boolean {
  return Boolean(
    config.harbor_url?.trim()
      || config.username?.trim()
      || config.password?.trim()
      || config.project?.trim(),
  );
}

export function resolveHarborEnvironments(config: HarborConfig): HarborEnvironment[] {
  if (config.harbor_environments && config.harbor_environments.length > 0) {
    return config.harbor_environments;
  }
  if (hasLegacyHarbor(config)) {
    return [
      {
        id: "legacy",
        name: "默认",
        harbor_url: config.harbor_url?.trim() || "",
        username: config.username?.trim() || "",
        password: config.password ?? "",
        project: config.project?.trim() || "",
      },
    ];
  }
  return [];
}

export function nextHarborEnvName(existing: HarborEnvironment[]): string {
  const used = new Set(existing.map((env) => env.name.trim().toLowerCase()));
  for (const name of SUGGESTED_NAMES) {
    if (!used.has(name.toLowerCase())) return name;
  }
  let i = existing.length + 1;
  while (used.has(`环境-${i}`)) i += 1;
  return `环境-${i}`;
}

export function createHarborEnvironment(existing: HarborEnvironment[]): HarborEnvironment {
  return {
    id: `hb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: nextHarborEnvName(existing),
    harbor_url: existing[0]?.harbor_url || "",
    username: existing[0]?.username || "",
    password: "",
    project: existing[0]?.project || "",
  };
}

export function pickHarborEnvironment(
  envs: HarborEnvironment[],
  lastId?: string | null,
): HarborEnvironment | undefined {
  if (lastId) {
    const matched = envs.find((env) => env.id === lastId);
    if (matched) return matched;
  }
  return envs[0];
}

/** 当前用于推送的一套凭证（含 legacy 兼容） */
export function resolveActiveHarbor(config: HarborConfig): HarborEnvironment | undefined {
  const envs = resolveHarborEnvironments(config);
  return pickHarborEnvironment(envs, config.harbor_last_env_id);
}

/** 将选中环境 mirror 到顶层四字段，并记下 last id */
export function withActiveHarborEnv(
  config: HarborConfig,
  envId: string,
): HarborConfig {
  const envs = resolveHarborEnvironments(config);
  const env = pickHarborEnvironment(envs, envId) ?? envs[0];
  if (!env) {
    return { ...config, harbor_last_env_id: envId };
  }
  return {
    ...config,
    harbor_environments: envs,
    harbor_last_env_id: env.id,
    harbor_url: env.harbor_url,
    username: env.username,
    password: env.password,
    project: env.project,
  };
}

export function isHarborEnvReady(env: HarborEnvironment | undefined): env is HarborEnvironment {
  if (!env) return false;
  return Boolean(
    env.harbor_url.trim()
      && env.username.trim()
      && env.password
      && env.project.trim(),
  );
}
