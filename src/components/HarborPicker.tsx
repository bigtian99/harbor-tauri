import { Select } from "@mantine/core";
import type { HarborEnv } from "../types";

/**
 * 计算「当前生效」的 Harbor 环境 id。
 * 优先级：本次会话内的手动选择 → 配置里的 last_harbor_* 记忆 → 第一个环境。
 * 记忆值对应的环境已被删除时回落到第一个环境（与后端 migrate_harbors 的修正语义一致）。
 */
export function pickHarborId(
  envs: HarborEnv[],
  localId?: string,
  rememberedId?: string,
): string {
  if (envs.length === 0) return "";
  const exists = (id?: string) => !!id && envs.some((env) => env.id === id);
  if (exists(localId)) return localId as string;
  if (exists(rememberedId)) return rememberedId as string;
  return envs[0].id;
}

export interface HarborPickerProps {
  /** 可选 Harbor 环境（来自 config.harbors） */
  envs: HarborEnv[];
  /** 当前选中的环境 id */
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** 标签文案，默认「Harbor 环境」 */
  label?: string;
  /** 标签下方的补充说明，可选 */
  hint?: string;
}

/** Harbor 环境选择器（Mantine Select，与各面板的 TextInput 同一套外观） */
export function HarborPicker({
  envs,
  value,
  onChange,
  disabled,
  label = "Harbor 环境",
  hint,
}: HarborPickerProps) {
  const empty = envs.length === 0;
  // 传入 id 已失效（环境被删）时回落到第一个，避免选中值落到空
  const currentId = pickHarborId(envs, value) || null;

  return (
    <Select
      size="sm"
      label={label}
      description={hint}
      placeholder={empty ? "请先在设置中配置 Harbor 环境" : undefined}
      data={envs.map((env) => ({
        value: env.id,
        label: env.project ? `${env.name || env.id} · ${env.project}` : env.name || env.id,
      }))}
      value={empty ? null : currentId}
      onChange={(id) => {
        if (id) onChange(id);
      }}
      disabled={disabled || empty}
      allowDeselect={false}
      checkIconPosition="right"
    />
  );
}
