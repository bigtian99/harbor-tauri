interface RememberedBranchSettingsConfig {
  remember_branch_settings: boolean;
  last_spring_profile: string;
  last_expose_port: string;
  expose_port: string;
}

export function getRememberedBranchAdvancedSettings(config: RememberedBranchSettingsConfig) {
  if (!config.remember_branch_settings) {
    return {
      springProfile: "",
      exposePort: "",
    };
  }

  return {
    springProfile: config.last_spring_profile.trim(),
    exposePort: config.last_expose_port.trim() || config.expose_port.trim(),
  };
}
