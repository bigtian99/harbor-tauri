import type { KsPublishMapRole } from "../../types";
import type { KsBatchNpmScriptPref } from "../../utils/ksBatchPackPublish";

export interface KsBatchMeta {
  branch: string;
  namespace: string;
  envName: string;
  /** 本次打包推送使用的镜像仓库（显示名） */
  harborName?: string;
  deployNames: string[];
  deployRoles?: Record<string, KsPublishMapRole>;
  npmScript?: KsBatchNpmScriptPref;
  /** 本次批量使用的 Spring Profile（Maven 后端构建；空 = 不加 -Dspring.profiles.active） */
  springProfile?: string;
}

export interface KsBatchConfirmValues {
  branch: string;
  npmScript: KsBatchNpmScriptPref;
  /** 先按源→目标合并各仓库，再打包推送发布 */
  mergeBeforePack: boolean;
  sourceBranch: string;
  /** 手选 Maven 子模块：deployment → rel_path（"" = 按部署名自动匹配） */
  moduleOverrides: Record<string, string>;
  /** Spring Profile：所有 Maven 后端部署统一使用；空 = 不加 -Dspring.profiles.active */
  springProfile: string;
}

export interface KsBatchSummary {
  success: number;
  failed: number;
  skipped: number;
}
