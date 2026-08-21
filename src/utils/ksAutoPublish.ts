import { invoke } from "@tauri-apps/api/core";
import type { HarborConfig, KsPublishMap } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "./ksEnvironments";
import { lookupKsPublishMap, normalizeGitUrl } from "./ksPublishMap";

export interface KsAutoPublishDeps {
  repoPath: string;
  images: Array<{ role: "frontend" | "backend"; image: string }>;
  maps: KsPublishMap[];
  config: HarborConfig;
  /** 同步追加到打包进度 */
  appendLog: (line: string) => void;
}

export interface KsAutoPublishSummary {
  attempted: number;
  success: number;
  skipped: number;
  failed: number;
  lines: string[];
}

interface DeployInfo {
  name: string;
  containers: string[];
}

interface UpdateResult {
  ok: boolean;
  oldImage: string;
  newImage: string;
  revision: string;
}

function diag(module: "build" | "kubesphere", message: string): void {
  void invoke("write_diagnostic_log", { module, message }).catch(() => {
    /* 诊断写入失败不打断主流程 */
  });
}

function note(
  summary: KsAutoPublishSummary,
  appendLog: (line: string) => void,
  line: string,
  modules: Array<"build" | "kubesphere"> = ["build"],
): void {
  summary.lines.push(line);
  appendLog(line);
  for (const m of modules) {
    diag(m, line);
  }
}

async function resolveContainer(
  map: KsPublishMap,
): Promise<{ container: string } | { skip: string }> {
  const mapped = map.container?.trim();
  if (mapped) {
    return { container: mapped };
  }
  try {
    const list = await invoke<DeployInfo[]>("ks_list_deployments", {
      namespace: map.namespace,
    });
    const deploy = list.find((d) => d.name === map.deployment);
    const first = deploy?.containers?.[0]?.trim();
    if (!first) {
      return {
        skip: `部署 ${map.namespace}/${map.deployment} 无可用容器名，跳过`,
      };
    }
    return { container: first };
  } catch (e) {
    return {
      skip: `拉取部署列表失败（${map.namespace}）：${String(e)}，跳过`,
    };
  }
}

/**
 * 推送成功后按 Git 映射自动发布到 KubeSphere。
 * 发布失败/跳过不抛错，由 summary 汇总；不写 password 到日志。
 */
export async function runKsAutoPublish(
  deps: KsAutoPublishDeps,
): Promise<KsAutoPublishSummary> {
  const { repoPath, images, maps, config, appendLog } = deps;
  const summary: KsAutoPublishSummary = {
    attempted: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    lines: [],
  };

  note(
    summary,
    appendLog,
    `KS 自动发布：开始，镜像数=${images.length}，映射数=${maps.length}`,
  );

  let remote: string;
  try {
    remote = await invoke<string>("get_git_remote_url", {
      repoPath,
      remote: null,
    });
  } catch (e) {
    const reason = `读取 Git remote 失败：${String(e)}，全部跳过发布`;
    summary.skipped += images.length > 0 ? images.length : 1;
    note(summary, appendLog, reason, ["build", "kubesphere"]);
    return summary;
  }

  const key = normalizeGitUrl(remote);
  note(
    summary,
    appendLog,
    `KS 自动发布：remote=${remote} → git_url_key=${key}`,
  );

  const envs = resolveKsEnvironments(config);

  for (const item of images) {
    const roleLabel = item.role;
    const map = lookupKsPublishMap(maps, key, item.role);
    if (!map) {
      summary.skipped += 1;
      note(
        summary,
        appendLog,
        `KS 跳过：role=${roleLabel} 无匹配映射（key=${key}）`,
      );
      continue;
    }

    note(
      summary,
      appendLog,
      `KS 命中：role=${roleLabel} → ${map.namespace}/${map.deployment}` +
        `（env_id=${map.env_id}，map_id=${map.id}）`,
    );

    const env = pickKsEnvironment(envs, map.env_id);
    if (!env || env.id !== map.env_id) {
      summary.skipped += 1;
      note(
        summary,
        appendLog,
        `KS 跳过：role=${roleLabel} 环境 id=${map.env_id} 未找到`,
        ["build", "kubesphere"],
      );
      continue;
    }

    const consoleUrl = env.console?.trim() || "";
    const username = env.username?.trim() || "";
    const password = env.password ?? "";
    if (!consoleUrl || !username || !password) {
      summary.skipped += 1;
      note(
        summary,
        appendLog,
        `KS 跳过：环境「${env.name}」未配齐 console/username/password`,
        ["build", "kubesphere"],
      );
      continue;
    }

    summary.attempted += 1;

    try {
      await invoke("ks_connect", {
        envId: env.id,
        console: consoleUrl,
        username,
        password,
      });
      note(
        summary,
        appendLog,
        `KS 已连接：env=${env.name}（${env.id}）`,
        ["build", "kubesphere"],
      );
    } catch (e) {
      summary.failed += 1;
      note(
        summary,
        appendLog,
        `KS 发布失败：连接「${env.name}」失败 — ${String(e)}`,
        ["build", "kubesphere"],
      );
      continue;
    }

    const containerResult = await resolveContainer(map);
    if ("skip" in containerResult) {
      summary.skipped += 1;
      summary.attempted -= 1;
      note(
        summary,
        appendLog,
        `KS 跳过：role=${roleLabel} ${containerResult.skip}`,
        ["build", "kubesphere"],
      );
      continue;
    }
    const { container } = containerResult;

    try {
      diag(
        "kubesphere",
        `ks_update_image ns=${map.namespace} deploy=${map.deployment} ` +
          `container=${container} image=${item.image}`,
      );
      const r = await invoke<UpdateResult>("ks_update_image", {
        namespace: map.namespace,
        deployment: map.deployment,
        container,
        image: item.image,
      });
      if (r.ok) {
        summary.success += 1;
        note(
          summary,
          appendLog,
          `KS 发布成功：${map.namespace}/${map.deployment}` +
            ` container=${container} revision=${r.revision}` +
            ` ${r.oldImage} → ${r.newImage}`,
          ["build", "kubesphere"],
        );
      } else {
        summary.failed += 1;
        note(
          summary,
          appendLog,
          `KS 发布失败：${map.namespace}/${map.deployment}` +
            ` revision=${r.revision} ${r.oldImage} → ${r.newImage}`,
          ["build", "kubesphere"],
        );
      }
    } catch (e) {
      summary.failed += 1;
      note(
        summary,
        appendLog,
        `KS 发布失败：${map.namespace}/${map.deployment} — ${String(e)}`,
        ["build", "kubesphere"],
      );
    }
  }

  note(
    summary,
    appendLog,
    `KS 自动发布汇总：attempted=${summary.attempted} success=${summary.success}` +
      ` skipped=${summary.skipped} failed=${summary.failed}`,
  );

  return summary;
}
