import type { NginxLocationBlock } from "./types";

interface RememberedBranchSettingsConfig {
  remember_branch_settings: boolean;
  last_repo_path?: string;
  last_spring_profile: string;
  last_expose_port: string;
  expose_port: string;
  branch_repo_settings?: Record<string, RememberedBranchRepoSettings | undefined>;
}

export interface RememberedBranchRepoSettings {
  springProfile: string;
  exposePort: string;
  nginxLocations: NginxLocationBlock[];
}

function normalizeRepoPath(repoPath?: string) {
  return repoPath?.trim() || "";
}

export function getRememberedBranchAdvancedSettings(
  config: RememberedBranchSettingsConfig,
  repoPath?: string,
): RememberedBranchRepoSettings {
  const defaultExposePort = config.expose_port.trim();

  if (!config.remember_branch_settings) {
    return {
      springProfile: "",
      exposePort: defaultExposePort,
      nginxLocations: [],
    };
  }

  const repoKey = normalizeRepoPath(repoPath);
  const repoSettings = repoKey ? config.branch_repo_settings?.[repoKey] : undefined;
  if (repoSettings) {
    return {
      springProfile: repoSettings.springProfile.trim(),
      exposePort: repoSettings.exposePort.trim() || defaultExposePort,
      nginxLocations: repoSettings.nginxLocations ?? [],
    };
  }

  const legacyRepoKey = normalizeRepoPath(config.last_repo_path);
  const canUseLegacySettings = !repoKey || !legacyRepoKey || repoKey === legacyRepoKey;
  if (!canUseLegacySettings) {
    return {
      springProfile: "",
      exposePort: defaultExposePort,
      nginxLocations: [],
    };
  }

  return {
    springProfile: config.last_spring_profile.trim(),
    exposePort: config.last_expose_port.trim() || defaultExposePort,
    nginxLocations: [],
  };
}

export function rememberBranchRepoSettings<T extends { branch_repo_settings?: Record<string, RememberedBranchRepoSettings | undefined> }>(
  config: T,
  repoPath: string,
  settings: RememberedBranchRepoSettings,
): T & { branch_repo_settings: Record<string, RememberedBranchRepoSettings | undefined> } {
  const repoKey = normalizeRepoPath(repoPath);
  const branchRepoSettings = { ...(config.branch_repo_settings || {}) };
  if (repoKey) {
    branchRepoSettings[repoKey] = {
      springProfile: settings.springProfile.trim(),
      exposePort: settings.exposePort.trim(),
      nginxLocations: settings.nginxLocations ?? [],
    };
  }

  return {
    ...config,
    branch_repo_settings: branchRepoSettings,
  };
}
