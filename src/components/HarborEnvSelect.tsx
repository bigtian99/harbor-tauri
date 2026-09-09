import { Select } from "@mantine/core";
import type { HarborConfig } from "../types";
import {
  pickHarborEnvironment,
  resolveHarborEnvironments,
} from "../utils/harborEnvironments";

interface HarborEnvSelectProps {
  config: HarborConfig;
  value?: string | null;
  onChange: (envId: string) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  /** 紧凑样式（分支/历史上用） */
  size?: "xs" | "sm" | "md";
  style?: React.CSSProperties;
  w?: number | string;
}

/** 推送 Harbor 前选择环境；默认带出上次选中 */
export function HarborEnvSelect({
  config,
  value,
  onChange,
  disabled,
  label = "Harbor 环境",
  description,
  size = "sm",
  style,
  w,
}: HarborEnvSelectProps) {
  const envs = resolveHarborEnvironments(config);
  const active = pickHarborEnvironment(envs, value ?? config.harbor_last_env_id);
  const data = envs.map((env) => ({
    value: env.id,
    label: env.name.trim() || env.id,
  }));

  return (
    <Select
      label={label}
      description={description}
      placeholder={envs.length ? "选择环境" : "请先在设置中添加 Harbor 环境"}
      data={data}
      value={active?.id ?? null}
      onChange={(id) => {
        if (id) onChange(id);
      }}
      disabled={disabled || envs.length === 0}
      searchable={envs.length > 5}
      allowDeselect={false}
      size={size}
      style={style}
      w={w}
      comboboxProps={{ withinPortal: true }}
    />
  );
}
