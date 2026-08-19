import type { HarborConfig, KsEnvironment } from "../types";

const DEFAULT_KS_CONSOLE = "http://192.168.31.254:30880";
const SUGGESTED_NAMES = ["dev", "test", "prod"];

export function resolveKsEnvironments(config: HarborConfig): KsEnvironment[] {
  if (config.ks_environments && config.ks_environments.length > 0) {
    return config.ks_environments;
  }
  if (config.ks_username?.trim() || config.ks_password?.trim()) {
    return [
      {
        id: "legacy",
        name: "dev",
        console: config.ks_console?.trim() || DEFAULT_KS_CONSOLE,
        username: config.ks_username?.trim() || "admin",
        password: config.ks_password ?? "",
      },
    ];
  }
  return [];
}

export function nextKsEnvName(existing: KsEnvironment[]): string {
  const used = new Set(existing.map((env) => env.name.trim().toLowerCase()));
  for (const name of SUGGESTED_NAMES) {
    if (!used.has(name)) return name;
  }
  let i = existing.length + 1;
  while (used.has(`env-${i}`)) i += 1;
  return `env-${i}`;
}

export function createKsEnvironment(existing: KsEnvironment[]): KsEnvironment {
  return {
    id: `ks-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: nextKsEnvName(existing),
    console: existing[0]?.console || DEFAULT_KS_CONSOLE,
    username: existing[0]?.username || "admin",
    password: "",
  };
}

export function pickKsEnvironment(
  envs: KsEnvironment[],
  lastId?: string | null,
): KsEnvironment | undefined {
  if (lastId) {
    const matched = envs.find((env) => env.id === lastId);
    if (matched) return matched;
  }
  return envs[0];
}
