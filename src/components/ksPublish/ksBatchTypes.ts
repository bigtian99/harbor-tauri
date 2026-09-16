import type { KsPublishMapRole } from "../../types";
import type { KsBatchNpmScriptPref } from "../../utils/ksBatchPackPublish";

export interface KsBatchMeta {
  branch: string;
  namespace: string;
  envName: string;
  deployNames: string[];
  deployRoles?: Record<string, KsPublishMapRole>;
  npmScript?: KsBatchNpmScriptPref;
}

export interface KsBatchConfirmValues {
  branch: string;
  npmScript: KsBatchNpmScriptPref;
  /** 先按源→目标合并各仓库，再打包推送发布 */
  mergeBeforePack: boolean;
  sourceBranch: string;
}

export interface KsBatchSummary {
  success: number;
  failed: number;
  skipped: number;
}
