import { invoke } from "@tauri-apps/api/core";
import type { HarborConfig, KsPublishMap } from "../types";
import { isTauriRuntime } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "./ksEnvironments";
import {
  createKsPublishMap,
  lookupKsPublishMapByDeployment,
} from "./ksPublishMap";

export type KsBatchCloneConflict = "skip" | "overwrite";

export interface KsBatchCloneSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  maps: KsPublishMap[];
  lines: string[];
}

export interface KsBatchCloneOptions {
  config: HarborConfig;
  /** 局部写盘前取最新整表 */
  getConfigSnapshot?: () => HarborConfig;
  sourceEnvId: string;
  sourceNamespace: string;
  targetEnvId: string;
  targetNamespace: string;
  deployNames: string[];
  conflict: KsBatchCloneConflict;
  copyConfigMap: boolean;
  copyPublishMaps: boolean;
  dryRun: boolean;
  appendLog: (line: string) => void;
  onProgress: (pct: number, message: string) => void;
  /** 映射变更后写回内存 config（save_config 已在 util 内调用） */
  onMapsSaved?: (maps: KsPublishMap[]) => void;
}

interface DeployEditInfo {
  name: string;
  alias: string;
  image: string;
  container: string;
  port: number;
  replicas: number;
  healthPath: string;
  configMap?: string | null;
  envs: string[];
}

interface CachedItem {
  name: string;
  edit: DeployEditInfo | null;
  /** 源部署引用的 CM 名（用于创建 Deployment 的 configMap 字段） */
  cmName: string | null;
  /** 源 CM data 行；copyConfigMap 时用于写入目标 */
  cmLines: string[] | null;
  /** 源 CM keys；创建 Deployment 时传入，避免目标无 CM 时 404 */
  cmKeys: string[] | null;
  readError?: string;
}

function diag(message: string): void {
  void invoke("write_diagnostic_log", { module: "kubesphere", message }).catch(() => {});
}

function note(
  summary: KsBatchCloneSummary,
  appendLog: (line: string) => void,
  line: string,
): void {
  summary.lines.push(line);
  appendLog(line);
  diag(line);
}

function configMapDataToLines(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!k.trim()) continue;
    out.push(`${k}=${v == null ? "" : String(v)}`);
  }
  return out;
}

function configMapKeysFromLines(lines: string[]): string[] {
  const keys: string[] = [];
  for (const line of lines) {
    const eq = line.indexOf("=");
    const k = (eq >= 0 ? line.slice(0, eq) : line).trim();
    if (k) keys.push(k);
  }
  return keys;
}

async function ensureKsConnected(config: HarborConfig, envId: string): Promise<void> {
  const env = pickKsEnvironment(resolveKsEnvironments(config), envId);
  if (!env) throw new Error(`环境 id=${envId} 未找到`);
  const consoleUrl = env.console?.trim() || "";
  const username = env.username?.trim() || "";
  const password = env.password ?? "";
  if (!consoleUrl || !username || !password) {
    throw new Error(`环境「${env.name}」未配齐 console/username/password`);
  }
  await invoke("ks_connect", {
    envId: env.id,
    console: consoleUrl,
    username,
    password,
  });
}

function mergePublishMap(
  maps: KsPublishMap[],
  source: KsPublishMap | null,
  targetEnvId: string,
  targetNamespace: string,
  deployment: string,
  conflict: KsBatchCloneConflict,
): { maps: KsPublishMap[]; action: "created" | "updated" | "skipped" | "none" } {
  if (!source) return { maps, action: "none" };
  const existingIdx = maps.findIndex(
    (m) =>
      m.env_id === targetEnvId
      && m.namespace === targetNamespace
      && m.deployment === deployment,
  );
  const next = createKsPublishMap({
    id: existingIdx >= 0 ? maps[existingIdx].id : undefined,
    git_url: source.git_url,
    role: source.role,
    env_id: targetEnvId,
    namespace: targetNamespace,
    deployment,
    container: source.container,
    expose_port: source.expose_port,
  });
  if (existingIdx < 0) {
    return { maps: [...maps, next], action: "created" };
  }
  if (conflict === "skip") {
    return { maps, action: "skipped" };
  }
  const copy = maps.slice();
  copy[existingIdx] = next;
  return { maps: copy, action: "updated" };
}

/**
 * 勾选部署：复制到目标环境/命名空间（Deployment + 可选 CM + 发布映射）。
 */
export async function runKsBatchCloneToEnv(
  opts: KsBatchCloneOptions,
): Promise<KsBatchCloneSummary> {
  const {
    config,
    getConfigSnapshot,
    sourceEnvId,
    sourceNamespace,
    targetEnvId,
    targetNamespace,
    deployNames,
    conflict,
    copyConfigMap,
    copyPublishMaps,
    dryRun,
    appendLog,
    onProgress,
    onMapsSaved,
  } = opts;

  const names = deployNames.map((n) => n.trim()).filter(Boolean);
  let maps = [...(config.ks_publish_maps ?? [])];
  const summary: KsBatchCloneSummary = {
    total: names.length,
    success: 0,
    failed: 0,
    skipped: 0,
    maps,
    lines: [],
  };

  if (!isTauriRuntime()) {
    note(summary, appendLog, "❌ 请在 Tauri 桌面窗口中操作");
    summary.skipped = summary.total;
    return summary;
  }
  if (names.length === 0) {
    note(summary, appendLog, "❌ 未勾选部署");
    return summary;
  }
  if (!sourceNamespace.trim() || !targetNamespace.trim()) {
    note(summary, appendLog, "❌ 源/目标命名空间不能为空");
    return summary;
  }
  if (sourceEnvId === targetEnvId && sourceNamespace === targetNamespace) {
    note(summary, appendLog, "❌ 目标与源相同，无需复制");
    return summary;
  }

  const sourceEnv = pickKsEnvironment(resolveKsEnvironments(config), sourceEnvId);
  const targetEnv = pickKsEnvironment(resolveKsEnvironments(config), targetEnvId);
  note(
    summary,
    appendLog,
    `ks_batch_clone start ${sourceEnv?.name ?? sourceEnvId}/${sourceNamespace}`
      + ` → ${targetEnv?.name ?? targetEnvId}/${targetNamespace}`
      + ` count=${names.length} conflict=${conflict}`
      + ` cm=${copyConfigMap} maps=${copyPublishMaps} dryRun=${dryRun}`,
  );

  onProgress(2, "连接源环境并读取配置…");
  try {
    await ensureKsConnected(config, sourceEnvId);
  } catch (e) {
    note(summary, appendLog, `❌ 连接源环境失败：${String(e)}`);
    summary.failed = summary.total;
    return summary;
  }

  const cached: CachedItem[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    onProgress(
      Math.round(((i + 0.5) / names.length) * 40),
      `${i + 1}/${names.length} · 读取 ${name}`,
    );
    try {
      const edit = await invoke<DeployEditInfo>("ks_get_deployment_edit", {
        namespace: sourceNamespace,
        deployment: name,
      });
      let cmName = edit.configMap?.trim() || null;
      let cmLines: string[] | null = null;
      let cmKeys: string[] | null = null;
      // 只要部署引用了 CM，就从源环境取 keys（与是否勾选「复制 ConfigMap」无关）
      // 否则目标无同名 CM 时 create 会 404
      if (cmName) {
        try {
          const data = await invoke<unknown>("ks_get_configmap", {
            namespace: sourceNamespace,
            name: cmName,
          });
          const lines = configMapDataToLines(data);
          const keys = configMapKeysFromLines(lines);
          if (keys.length === 0) {
            note(summary, appendLog, `  ⚠ ${name} ConfigMap「${cmName}」无 data key`);
          } else {
            cmKeys = keys;
            if (copyConfigMap) cmLines = lines;
            note(
              summary,
              appendLog,
              `  · ${name} ConfigMap「${cmName}」keys=${keys.length}`
                + (copyConfigMap ? "（将复制内容）" : "（仅用于展开引用）"),
            );
          }
        } catch (e) {
          note(summary, appendLog, `  ⚠ ${name} 读取 ConfigMap「${cmName}」失败：${String(e)}`);
        }
      }
      cached.push({ name, edit, cmName, cmLines, cmKeys });
      note(summary, appendLog, `  ✓ 已读取 ${name}`);
    } catch (e) {
      cached.push({
        name,
        edit: null,
        cmName: null,
        cmLines: null,
        cmKeys: null,
        readError: String(e),
      });
      note(summary, appendLog, `  ❌ 读取 ${name} 失败：${String(e)}`);
    }
  }

  onProgress(42, "连接目标环境…");
  try {
    await ensureKsConnected(config, targetEnvId);
    note(summary, appendLog, `KS 已连接目标环境 ${targetEnv?.name ?? targetEnvId}`);
  } catch (e) {
    note(summary, appendLog, `❌ 连接目标环境失败：${String(e)}`);
    summary.failed += cached.filter((c) => c.edit).length;
    try {
      await ensureKsConnected(config, sourceEnvId);
    } catch {
      /* ignore */
    }
    return summary;
  }

  let existingDeps = new Set<string>();
  let existingCms = new Set<string>();
  try {
    const deps = await invoke<Array<{ name: string }>>("ks_list_deployments", {
      namespace: targetNamespace,
    });
    existingDeps = new Set(deps.map((d) => d.name));
  } catch (e) {
    note(summary, appendLog, `⚠ 列出目标部署失败（按「不存在」处理）：${String(e)}`);
  }
  if (copyConfigMap && !dryRun) {
    try {
      const cms = await invoke<Array<{ name: string }>>("ks_list_configmaps", {
        namespace: targetNamespace,
      });
      existingCms = new Set(cms.map((c) => c.name));
    } catch (e) {
      note(summary, appendLog, `⚠ 列出目标 ConfigMap 失败：${String(e)}`);
    }
  }

  const total = cached.length;
  let done = 0;
  let mapsDirty = false;

  for (const item of cached) {
    done += 1;
    const slot = `${done}/${total}`;
    onProgress(Math.round(42 + (done / total) * 55), `${slot} · ${item.name}`);

    if (!item.edit) {
      summary.failed += 1;
      note(summary, appendLog, `[${slot}] ❌ ${item.name}：源读取失败，跳过写入`);
      continue;
    }

    const edit = item.edit;

    try {
      if (copyConfigMap && item.cmName && item.cmLines) {
        if (dryRun) {
          await invoke("ks_create_configmap", {
            namespace: targetNamespace,
            name: item.cmName,
            data: item.cmLines,
            dryRun: true,
          });
          note(summary, appendLog, `  ✓ ConfigMap「${item.cmName}」dry-run 校验通过`);
        } else if (existingCms.has(item.cmName)) {
          if (conflict === "skip") {
            note(
              summary,
              appendLog,
              `  ⏭ ConfigMap「${item.cmName}」已存在，跳过`,
            );
          } else {
            await invoke("ks_replace_configmap", {
              namespace: targetNamespace,
              name: item.cmName,
              data: item.cmLines,
            });
            note(summary, appendLog, `  ✓ 已覆盖 ConfigMap「${item.cmName}」`);
          }
        } else {
          await invoke("ks_create_configmap", {
            namespace: targetNamespace,
            name: item.cmName,
            data: item.cmLines,
            dryRun: false,
          });
          existingCms.add(item.cmName);
          note(summary, appendLog, `  ✓ 已创建 ConfigMap「${item.cmName}」`);
        }
      }

      const cmKeys = item.cmKeys && item.cmKeys.length > 0 ? item.cmKeys : undefined;
      // 无 keys 时不要带 configMap，否则目标 404；有 keys 则传 configMapKeys 跳过集群读取
      const configMapForCreate =
        edit.configMap && cmKeys ? edit.configMap : undefined;

      const exists = existingDeps.has(edit.name);
      if (exists && conflict === "skip") {
        summary.skipped += 1;
        note(summary, appendLog, `[${slot}] ⏭ ${edit.name} 已存在，跳过 Deployment`);
      } else if (exists && dryRun) {
        summary.skipped += 1;
        note(
          summary,
          appendLog,
          `[${slot}] ⏭ ${edit.name} dry-run：已存在，不覆盖`,
        );
      } else if (exists) {
        await invoke("ks_update_deployment", {
          namespace: targetNamespace,
          name: edit.name,
          image: edit.image,
          alias: edit.alias || undefined,
          port: edit.port,
          replicas: edit.replicas,
          envs: edit.envs,
          configMap: configMapForCreate,
          configMapKeys: cmKeys,
          healthPath: edit.healthPath,
          container: edit.container || undefined,
        });
        summary.success += 1;
        note(summary, appendLog, `[${slot}] 🚀 ${edit.name} 已覆盖更新`);
      } else {
        if (edit.configMap && !cmKeys) {
          note(
            summary,
            appendLog,
            `  ⚠ ${edit.name} 引用 ConfigMap「${edit.configMap}」但未拿到 keys，创建时将不展开 CM 引用`,
          );
        }
        await invoke("ks_create_deployment", {
          namespace: targetNamespace,
          name: edit.name,
          image: edit.image,
          alias: edit.alias || undefined,
          port: edit.port,
          replicas: edit.replicas,
          envs: edit.envs,
          configMap: configMapForCreate,
          configMapKeys: cmKeys,
          healthPath: edit.healthPath,
          dryRun,
        });
        if (!dryRun) existingDeps.add(edit.name);
        summary.success += 1;
        note(
          summary,
          appendLog,
          dryRun
            ? `[${slot}] ✓ ${edit.name} dry-run 校验通过`
            : `[${slot}] 🚀 ${edit.name} 已创建`,
        );
      }

      if (copyPublishMaps && !dryRun) {
        const sourceMap = lookupKsPublishMapByDeployment(
          maps,
          sourceEnvId,
          sourceNamespace,
          edit.name,
        );
        const merged = mergePublishMap(
          maps,
          sourceMap,
          targetEnvId,
          targetNamespace,
          edit.name,
          conflict,
        );
        maps = merged.maps;
        if (merged.action === "created") {
          mapsDirty = true;
          note(summary, appendLog, `  ✓ 已新增发布映射`);
        } else if (merged.action === "updated") {
          mapsDirty = true;
          note(summary, appendLog, `  ✓ 已覆盖发布映射`);
        } else if (merged.action === "skipped") {
          note(summary, appendLog, `  ⏭ 发布映射已存在，跳过`);
        } else {
          note(summary, appendLog, `  ⏭ 源无发布映射`);
        }
      }
    } catch (e) {
      summary.failed += 1;
      note(summary, appendLog, `[${slot}] ❌ ${edit.name} 失败：${String(e)}`);
    }
  }

  if (mapsDirty) {
    try {
      onMapsSaved?.(maps);
      await invoke("save_config", {
        config: getConfigSnapshot?.() ?? { ...config, ks_publish_maps: maps },
      });
      note(summary, appendLog, `✓ 发布映射已保存（共 ${maps.length} 条）`);
    } catch (e) {
      note(summary, appendLog, `❌ 保存发布映射失败：${String(e)}`);
    }
  }

  summary.maps = maps;
  note(
    summary,
    appendLog,
    `批量复制汇总：成功 ${summary.success} / 失败 ${summary.failed} / 跳过 ${summary.skipped}`,
  );

  onProgress(98, "切回源环境…");
  try {
    await ensureKsConnected(config, sourceEnvId);
  } catch (e) {
    note(summary, appendLog, `⚠ 切回源环境失败：${String(e)}（请手动重新连接）`);
  }

  onProgress(100, "批量复制完成");
  return summary;
}
