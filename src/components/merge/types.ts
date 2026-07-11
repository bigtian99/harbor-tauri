import type { HarborConfig } from "../../types";

export interface MergePanelProps {
  config: HarborConfig;
  onOpenDirectory: (path: string) => void;
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
