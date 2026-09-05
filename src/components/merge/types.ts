import type { HarborConfig } from "../../types";

export interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
  /** 合并成功且勾选同步打包时回调 */
  onPackageAfterMerge?: (args: { repoPath: string; targetBranch: string }) => void;
  /** 快捷合并预设落盘后写回内存，避免随后「保存配置」用旧值覆盖 */
  onConfigPatch?: (patch: Partial<HarborConfig>) => void;
  /** 局部写盘前取最新整表 */
  getConfigSnapshot?: () => HarborConfig;
}

export type MergeOverlayPhase = "idle" | "running" | "success" | "error";

export interface ConflictBlock {
  /** 该块在 target 面板中的起始行（1-based） */
  targetLine: number;
  /** 该块在 source 面板中的起始行（1-based） */
  sourceLine: number;
  /** 该块在 target 中涉及的行号 */
  targetLines: Set<number>;
  /** 该块在 source 中涉及的行号 */
  sourceLines: Set<number>;
}
