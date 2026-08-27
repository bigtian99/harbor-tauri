import { invoke } from "@tauri-apps/api/core";
import type {
  BranchProjectType,
  HarborConfig,
  KsPublishMap,
  KsPublishMapRole,
  NginxLocationBlock,
} from "../types";
import { isTauriRuntime } from "../types";
import { getRememberedBranchAdvancedSettings } from "../branchSettings";
import {
  primaryImageForKsRole,
  runBranchPackageAndPush,
} from "../hooks/branch/branchPackageRun";
import { pickKsEnvironment, resolveKsEnvironments } from "./ksEnvironments";
import {
  lookupKsPublishMapByDeployment,
  normalizeGitUrl,
} from "./ksPublishMap";
import {
  resolveKlcjZtExposePort,
  suggestKlcjZtGit,
} from "./klcjZtGitDefaults";
import {
  buildGitUrlRepoPathIndex,
  resolveRepoPathFromIndex,
} from "./resolveRepoPath";

export interface KsBatchDeployItem {
  name: string;
  containers: string[];
}

export interface KsBatchTarget {
  deployment: string;
  container: string;
  gitUrl: string;
  role: KsPublishMapRole;
  exposePort: string;
  repoPath: string;
  projectType: BranchProjectType;
  springProfile: string;
  frontendDir: string;
  selectedBuildScript: string;
  packageWithBackend: boolean;
  nginxLocations: NginxLocationBlock[];
}

export interface KsBatchPackSummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  lines: string[];
}

export interface KsBatchPackOptions {
  config: HarborConfig;
  envId: string;
  namespace: string;
  branchName: string;
  deployments: KsBatchDeployItem[];
  /** 并行度；0/省略 = 按 CPU·任务·仓库数自动算 */
  concurrency?: number;
  appendLog: (line: string) => void;
  onProgress: (pct: number, message: string) => void;
}

interface UpdateResult {
  ok: boolean;
  oldImage: string;
  newImage: string;
  revision: string;
}

const CONCURRENCY_PREF_KEY = "jarporter.ks-batch-concurrency";
/** 自动模式，按 CPU / 任务数 / 不同仓库数动态算 */
export const KS_BATCH_CONCURRENCY_AUTO = 0;
const KS_BATCH_CONCURRENCY_MAX = 4;

export type KsBatchConcurrencyPref = typeof KS_BATCH_CONCURRENCY_AUTO | 1 | 2 | 3 | 4;

export function detectCpuCores(): number {
  try {
    const n = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  } catch {
    /* ignore */
  }
  return 4;
}

/**
 * 根据本机 CPU、任务数、不同仓库数推荐并行度。
 * Maven/Docker 偏重，按约一半逻辑核估算，上限 4。
 */
export function recommendKsBatchConcurrency(input: {
  itemCount: number;
  uniqueRepoCount?: number;
  cpuCores?: number;
  max?: number;
}): number {
  const itemCount = Math.max(0, Math.floor(input.itemCount));
  if (itemCount <= 0) return 1;
  const max = Math.max(1, input.max ?? KS_BATCH_CONCURRENCY_MAX);
  const cores = Math.max(1, Math.floor(input.cpuCores ?? detectCpuCores()));
  // 重 IO/编译：核数过半，至少 1；≥8 核时最多给到 max
  const byCpu = Math.max(1, Math.min(max, Math.floor(cores / 2)));
  const uniqueRepos = Math.max(
    1,
    Math.floor(input.uniqueRepoCount ?? itemCount),
  );
  return Math.max(1, Math.min(max, byCpu, itemCount, uniqueRepos));
}

export function loadKsBatchConcurrencyPref(): KsBatchConcurrencyPref {
  try {
    const raw = localStorage.getItem(CONCURRENCY_PREF_KEY);
    if (raw === null || raw === "auto" || raw === "0") return KS_BATCH_CONCURRENCY_AUTO;
    const n = Number(raw);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  } catch {
    /* ignore */
  }
  return KS_BATCH_CONCURRENCY_AUTO;
}

export function saveKsBatchConcurrencyPref(pref: KsBatchConcurrencyPref): void {
  try {
    localStorage.setItem(
      CONCURRENCY_PREF_KEY,
      pref === KS_BATCH_CONCURRENCY_AUTO ? "auto" : String(pref),
    );
  } catch {
    /* ignore */
  }
}

/** @deprecated 使用 loadKsBatchConcurrencyPref */
export function loadKsBatchConcurrency(): number {
  const pref = loadKsBatchConcurrencyPref();
  if (pref === KS_BATCH_CONCURRENCY_AUTO) {
    return recommendKsBatchConcurrency({ itemCount: 2 });
  }
  return pref;
}

/** @deprecated 使用 saveKsBatchConcurrencyPref */
export function saveKsBatchConcurrency(n: number): void {
  if (n === 0) saveKsBatchConcurrencyPref(KS_BATCH_CONCURRENCY_AUTO);
  else if (n === 1 || n === 2 || n === 3 || n === 4) saveKsBatchConcurrencyPref(n);
}

function diag(module: "build" | "kubesphere", message: string): void {
  void invoke("write_diagnostic_log", { module, message }).catch(() => {});
}

function note(
  summary: KsBatchPackSummary,
  appendLog: (line: string) => void,
  line: string,
): void {
  summary.lines.push(line);
  appendLog(line);
  diag("kubesphere", line);
  diag("build", line);
}

/** 有限并发池 */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

/** 同仓库路径串行，避免并行 worktree/git 冲突 */
function createRepoPathGate() {
  const tails = new Map<string, Promise<void>>();
  return async function withRepoGate<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const key = repoPath.trim();
    const prev = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(
      key,
      prev.then(() => gate).catch(() => gate),
    );
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

function resolveGitForDeployment(
  maps: KsPublishMap[],
  envId: string,
  namespace: string,
  deployment: string,
): { gitUrl: string; role: KsPublishMapRole; exposePort: string; container: string } {
  const map = lookupKsPublishMapByDeployment(maps, envId, namespace, deployment);
  const suggested = suggestKlcjZtGit(deployment);
  const gitUrl = map?.git_url?.trim() || suggested?.git_url || "";
  const role = map?.role ?? suggested?.role ?? "backend";
  const exposePort =
    resolveKlcjZtExposePort({
      deployment,
      gitUrl,
      existingPort: map?.expose_port,
    })
    || suggested?.expose_port
    || "";
  const container = map?.container?.trim() || "";
  return { gitUrl, role, exposePort, container };
}

/** 批量部署对应的 Git URL 列表（去重） */
export function collectGitUrlsForBatchDeployments(
  config: HarborConfig,
  envId: string,
  namespace: string,
  deployments: KsBatchDeployItem[],
): string[] {
  const maps = config.ks_publish_maps ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dep of deployments) {
    const { gitUrl } = resolveGitForDeployment(maps, envId, namespace, dep.name);
    const key = normalizeGitUrl(gitUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(gitUrl);
  }
  return out;
}

/** 确认弹窗打开时预热仓库索引，点开始时可秒开 */
export async function prewarmKsBatchRepoIndex(
  config: HarborConfig,
  envId: string,
  namespace: string,
  deployments: KsBatchDeployItem[],
): Promise<void> {
  const gitUrls = collectGitUrlsForBatchDeployments(config, envId, namespace, deployments);
  if (gitUrls.length === 0) return;
  await buildGitUrlRepoPathIndex(config, gitUrls);
}

/** 解析批量目标；无法解析本地仓库的项进入 skips */
export async function resolveKsBatchTargets(
  config: HarborConfig,
  envId: string,
  namespace: string,
  deployments: KsBatchDeployItem[],
): Promise<{ targets: KsBatchTarget[]; skips: string[] }> {
  const maps = config.ks_publish_maps ?? [];
  const targets: KsBatchTarget[] = [];
  const skips: string[] = [];

  const neededGitUrls: string[] = [];
  for (const dep of deployments) {
    const { gitUrl } = resolveGitForDeployment(maps, envId, namespace, dep.name);
    if (gitUrl) neededGitUrls.push(gitUrl);
  }
  const repoIndex = await buildGitUrlRepoPathIndex(config, neededGitUrls);

  for (const dep of deployments) {
    const { gitUrl, role, exposePort, container } = resolveGitForDeployment(
      maps,
      envId,
      namespace,
      dep.name,
    );
    if (!gitUrl) {
      skips.push(`${dep.name}：未配置 Git 映射，请到系统设置 → KubeSphere 发布映射填写`);
      continue;
    }
    const repoPath = resolveRepoPathFromIndex(gitUrl, config, repoIndex, dep.name);
    if (!repoPath) {
      skips.push(
        `${dep.name}：找不到 Git「${gitUrl}」对应的本地仓库（请先在分支打包页选过该仓库）`,
      );
      continue;
    }
    const remembered = getRememberedBranchAdvancedSettings(config, repoPath);
    const projectType: BranchProjectType = role === "frontend" ? "npm" : "maven";
    targets.push({
      deployment: dep.name,
      container: container || dep.containers[0]?.trim() || "",
      gitUrl,
      role,
      exposePort: exposePort || remembered.exposePort || config.expose_port.trim(),
      repoPath,
      projectType,
      springProfile: remembered.springProfile,
      frontendDir: config.last_frontend_dir?.trim() || "",
      selectedBuildScript: config.last_build_script?.trim() || "build:prod",
      packageWithBackend: false,
      nginxLocations: remembered.nginxLocations ?? [],
    });
  }

  return { targets, skips };
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

async function publishImageToDeploy(
  namespace: string,
  deployment: string,
  container: string,
  image: string,
): Promise<UpdateResult> {
  let resolvedContainer = container.trim();
  if (!resolvedContainer) {
    const list = await invoke<Array<{ name: string; containers: string[] }>>(
      "ks_list_deployments",
      { namespace },
    );
    resolvedContainer = list.find((d) => d.name === deployment)?.containers?.[0]?.trim() ?? "";
  }
  if (!resolvedContainer) {
    throw new Error(`部署 ${namespace}/${deployment} 无可用容器名`);
  }
  return invoke<UpdateResult>("ks_update_image", {
    namespace,
    deployment,
    container: resolvedContainer,
    image,
  });
}

/**
 * 批量：有限并行打包推送 → 更新 KS 部署镜像（同仓库路径仍串行）。
 */
export async function runKsBatchPackPublish(
  opts: KsBatchPackOptions,
): Promise<KsBatchPackSummary> {
  const {
    config,
    envId,
    namespace,
    branchName,
    deployments,
    appendLog,
    onProgress,
  } = opts;

  const summary: KsBatchPackSummary = {
    total: deployments.length,
    success: 0,
    failed: 0,
    skipped: 0,
    lines: [],
  };

  if (!isTauriRuntime()) {
    note(summary, appendLog, "❌ 请在 Tauri 桌面窗口中操作");
    summary.skipped = summary.total;
    return summary;
  }
  if (!branchName.trim()) {
    note(summary, appendLog, "❌ 请填写目标分支");
    summary.skipped = summary.total;
    return summary;
  }

  onProgress(1, "正在解析本地仓库…");
  note(summary, appendLog, "正在解析本地仓库路径…");

  const { targets, skips } = await resolveKsBatchTargets(
    config,
    envId,
    namespace,
    deployments,
  );
  for (const skip of skips) {
    summary.skipped += 1;
    note(summary, appendLog, `⏭ 跳过 ${skip}`);
  }

  if (targets.length === 0) {
    note(summary, appendLog, "无可执行项，批量结束");
    return summary;
  }

  const needsMaven = targets.some((t) => t.projectType === "maven");
  if (needsMaven) {
    onProgress(2, "检查 Maven 配置…");
    const mavenInfo = await invoke<{
      home_valid: boolean;
      effective_home: string;
    }>("resolve_maven_settings", { config });
    if (!mavenInfo.home_valid || !mavenInfo.effective_home.trim()) {
      note(summary, appendLog, "❌ Maven 未配置有效 Home，请到系统设置 → JAR 打包");
      summary.skipped += targets.length;
      return summary;
    }
  }

  const concurrencyPref = opts.concurrency;
  const uniqueRepos = new Set(targets.map((t) => t.repoPath.trim()).filter(Boolean)).size;
  const concurrency =
    concurrencyPref && concurrencyPref > 0
      ? Math.max(1, Math.min(KS_BATCH_CONCURRENCY_MAX, concurrencyPref, targets.length))
      : recommendKsBatchConcurrency({
          itemCount: targets.length,
          uniqueRepoCount: uniqueRepos,
        });

  note(
    summary,
    appendLog,
    `批量开始：${targets.length} 个部署，并发=${concurrency}`
      + `${!concurrencyPref || concurrencyPref <= 0 ? "（自动）" : ""}`
      + `，不同仓库=${uniqueRepos}，CPU≈${detectCpuCores()}，分支=${branchName.trim()}，命名空间=${namespace}`,
  );

  const ksConnectPromise = ensureKsConnected(config, envId)
    .then(() => {
      note(summary, appendLog, `KS 已连接环境 ${envId}`);
      return null as string | null;
    })
    .catch((e: unknown) => {
      const msg = String(e);
      note(summary, appendLog, `❌ KubeSphere 连接失败：${msg}`);
      return msg;
    });

  const total = targets.length;
  let finished = 0;
  let active = 0;
  const withRepoGate = createRepoPathGate();

  const bumpProgress = (label: string) => {
    const pct = Math.round((finished / total) * 100);
    onProgress(pct, active > 0 ? `并行 ${active} · ${label}` : label);
  };

  await mapPool(targets, concurrency, async (target, i) => {
    const step = i + 1;
    active += 1;
    bumpProgress(`[${step}/${total}] ${target.deployment} 打包中…`);
    note(
      summary,
      appendLog,
      `[${step}/${total}] ${target.deployment} ← ${target.repoPath} (${normalizeGitUrl(target.gitUrl)})`,
    );

    try {
      const packResult = await withRepoGate(target.repoPath, () =>
        runBranchPackageAndPush({
          config,
          repoPath: target.repoPath,
          branchName,
          branchProjectType: target.projectType,
          frontendDir: target.frontendDir,
          selectedBuildScript: target.selectedBuildScript,
          packageWithBackend: target.packageWithBackend,
          springProfile: target.springProfile,
          branchExposePort: target.exposePort,
          nginxLocations: target.nginxLocations,
          autoPushImage: true,
          progressLabel: target.deployment,
        }),
      );

      if (!packResult.ok) {
        summary.failed += 1;
        note(
          summary,
          appendLog,
          `  ❌ ${target.deployment} 失败：${packResult.error ?? (packResult.pushErrors.join("；") || "打包或推送失败")}`,
        );
        if (packResult.packageLog) {
          note(summary, appendLog, packResult.packageLog);
        }
        return;
      }

      const image = primaryImageForKsRole(packResult.images, target.role);
      if (!image) {
        summary.failed += 1;
        note(summary, appendLog, `  ❌ ${target.deployment}：推送成功但未拿到镜像地址`);
        return;
      }

      const ksErr = await ksConnectPromise;
      if (ksErr) {
        summary.failed += 1;
        note(summary, appendLog, `  ❌ ${target.deployment}：跳过 KS 发布（连接失败）`);
        return;
      }

      bumpProgress(`[${step}/${total}] ${target.deployment} 发布到 K8s…`);
      note(summary, appendLog, `  ✓ 已推送 ${image}`);

      const r = await publishImageToDeploy(
        namespace,
        target.deployment,
        target.container,
        image,
      );
      if (r.ok) {
        summary.success += 1;
        note(
          summary,
          appendLog,
          `  🚀 KS 发布成功 revision=${r.revision} ${r.oldImage} → ${r.newImage}`,
        );
      } else {
        summary.failed += 1;
        note(summary, appendLog, `  ❌ KS 发布失败 revision=${r.revision}`);
      }
    } catch (e) {
      summary.failed += 1;
      note(summary, appendLog, `  ❌ ${target.deployment} 失败：${String(e)}`);
    } finally {
      active -= 1;
      finished += 1;
      bumpProgress(`[${finished}/${total}] 已完成`);
    }
  });

  note(
    summary,
    appendLog,
    `批量汇总：成功 ${summary.success} / 失败 ${summary.failed} / 跳过 ${summary.skipped}`,
  );
  onProgress(100, "批量完成");
  return summary;
}
