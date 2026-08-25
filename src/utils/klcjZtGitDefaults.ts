import type { KsPublishMapRole } from "../types";

export interface KlcjZtGitDefault {
  /** 匹配用短名，按长度优先 */
  keys: string[];
  git_url: string;
  role: KsPublishMapRole;
  /** 服务暴露端口（Docker EXPOSE / Spring server.port） */
  expose_port: string;
  /** 本地目录名，仅文档/排查 */
  dir: string;
}

const GITEE = "https://gitee.com/cstksy";

/** 与 `ksPublishMap.normalizeGitUrl` 保持一致（避免 node --test 跨文件无后缀 import） */
function normalizeGitUrl(url: string): string {
  let s = url.trim().toLowerCase();
  while (s.endsWith("/")) s = s.slice(0, -1);
  if (s.endsWith(".git")) s = s.slice(0, -4);
  if (s.startsWith("git@")) return s.slice(4).replace(":", "/");
  const schemeMatch = s.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?(.+)$/);
  if (schemeMatch) return schemeMatch[1];
  return s;
}

/**
 * klcj-zt 工作区子仓 → Git 远程 + 端口。
 * 端口来自各仓 bootstrap.yml / application.yml 的 server.port。
 * `klcj-zt-soft-service` 本地无 origin，按同组织命名推断。
 * `klcj-zt-api` 为 Feign 契约仓，一般不单独部署，不进默认映射。
 * `kunlunchuangjie-cli` 多模块同仓不同端口，按部署名拆开。
 */
export const KLCJ_ZT_GIT_DEFAULTS: KlcjZtGitDefault[] = [
  {
    dir: "klcj--zt-user-service",
    keys: ["klcj--zt-user-service", "klcj-zt-user-service", "user-service"],
    git_url: `${GITEE}/klcj--zt-user-service.git`,
    role: "backend",
    expose_port: "9611",
  },
  {
    dir: "klcj-zt-ad-service",
    keys: ["klcj-zt-ad-service", "ad-service"],
    git_url: `${GITEE}/klcj-zt-ad-service.git`,
    role: "backend",
    expose_port: "9617",
  },
  {
    dir: "klcj-zt-admin",
    keys: ["klcj-zt-admin", "zt-admin"],
    git_url: `${GITEE}/klcj-zt-admin.git`,
    role: "frontend",
    expose_port: "80",
  },
  {
    dir: "klcj-zt-ai-service",
    keys: ["klcj-zt-ai-service", "ai-service"],
    git_url: `${GITEE}/klcj-zt-ai-service.git`,
    role: "backend",
    expose_port: "9204",
  },
  {
    dir: "klcj-zt-box-service",
    keys: ["klcj-zt-box-service", "box-service"],
    git_url: `${GITEE}/klcj-zt-box-service.git`,
    role: "backend",
    expose_port: "9619",
  },
  {
    dir: "klcj-zt-comic-service",
    keys: ["klcj-zt-comic-service", "comic-service"],
    git_url: `${GITEE}/klcj-zt-comic-service.git`,
    role: "backend",
    expose_port: "9613",
  },
  {
    dir: "klcj-zt-data-service",
    keys: ["klcj-zt-data-service", "data-service"],
    git_url: `${GITEE}/klcj-zt-data-service.git`,
    role: "backend",
    expose_port: "9614",
  },
  {
    dir: "klcj-zt-distribution-service",
    keys: [
      "klcj-zt-distribution-service",
      "distribution-service",
      "klcj-zt-dist-service",
      "dist-service",
    ],
    git_url: `${GITEE}/klcj-zt-distribution-service.git`,
    role: "backend",
    expose_port: "9621",
  },
  {
    dir: "klcj-zt-finance-service",
    keys: ["klcj-zt-finance-service", "finance-service"],
    git_url: `${GITEE}/klcj-zt-finance-service.git`,
    role: "backend",
    expose_port: "9616",
  },
  {
    dir: "klcj-zt-risk-service",
    keys: ["klcj-zt-risk-service", "risk-service"],
    git_url: `${GITEE}/klcj-zt-risk-service.git`,
    role: "backend",
    expose_port: "9618",
  },
  {
    dir: "klcj-zt-soft-service",
    keys: ["klcj-zt-soft-service", "soft-service"],
    git_url: `${GITEE}/klcj-zt-soft-service.git`,
    role: "backend",
    expose_port: "9615",
  },
  {
    dir: "klcj-zt-trade-service",
    keys: ["klcj-zt-trade-service", "trade-service"],
    git_url: `${GITEE}/klcj-zt-trade-service.git`,
    role: "backend",
    expose_port: "9612",
  },
  {
    dir: "klcj-zt-video-service",
    keys: ["klcj-zt-video-service", "video-service"],
    git_url: `${GITEE}/klcj-zt-video-service.git`,
    role: "backend",
    expose_port: "9620",
  },
  {
    dir: "klcj-ztcommon-service",
    keys: [
      "klcj-zt-common-service",
      "klcj-ztcommon-service",
      "common-service",
    ],
    git_url: `${GITEE}/klcj-ztcommon-service.git`,
    role: "backend",
    expose_port: "9610",
  },
  // --- kunlunchuangjie-cli：同仓多模块，按部署名区分端口 ---
  {
    dir: "kunlunchuangjie-cli",
    keys: ["ruoyi-gateway", "klcj-zt-gateway", "gateway"],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "8080",
  },
  {
    dir: "kunlunchuangjie-cli",
    keys: ["ruoyi-auth", "klcj-zt-auth", "kunlunchuangjie-auth"],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "9200",
  },
  {
    dir: "kunlunchuangjie-cli",
    keys: [
      "ruoyi-system",
      "klcj-zt-system",
      "klcj-zt-system-service",
      "kunlunchuangjie-system",
    ],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "9201",
  },
  {
    dir: "kunlunchuangjie-cli",
    keys: ["ruoyi-gen", "kunlunchuangjie-gen"],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "9202",
  },
  {
    dir: "kunlunchuangjie-cli",
    keys: ["ruoyi-job"],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "9203",
  },
  {
    dir: "kunlunchuangjie-cli",
    keys: ["ruoyi-file", "kunlunchuangjie-file"],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "9300",
  },
  {
    dir: "kunlunchuangjie-cli",
    keys: ["ruoyi-monitor", "kunlunchuangjie-cli"],
    git_url: `${GITEE}/kunlunchuangjie-cli.git`,
    role: "backend",
    expose_port: "9100",
  },
];

function normalizeDeployName(name: string): string {
  return name.trim().toLowerCase().replace(/--+/g, "-");
}

function basenamePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(i + 1) : normalized;
}

function scoreKeyMatch(name: string, raw: string, key: string): number {
  const k = normalizeDeployName(key);
  if (!k) return 0;
  if (name === k || raw === key.toLowerCase()) return 300 + k.length;
  if (name.endsWith(`-${k}`) || name.startsWith(`${k}-`)) return 200 + k.length;
  if (name.includes(k) && k.length >= 10) return 100 + k.length;
  return 0;
}

function bestMatch(
  candidates: Array<{ mod: KlcjZtGitDefault; score: number }>,
): KlcjZtGitDefault | null {
  let best: { mod: KlcjZtGitDefault; score: number } | null = null;
  for (const c of candidates) {
    if (!best || c.score > best.score) best = c;
  }
  return best?.mod ?? null;
}

/** 按 Deployment / 目录名匹配 */
export function suggestKlcjZtGit(
  deployment: string,
): { git_url: string; role: KsPublishMapRole; expose_port: string } | null {
  const raw = deployment.trim().toLowerCase();
  const name = normalizeDeployName(raw);
  if (!name) return null;

  const hits: Array<{ mod: KlcjZtGitDefault; score: number }> = [];
  for (const mod of KLCJ_ZT_GIT_DEFAULTS) {
    for (const key of mod.keys) {
      const score = scoreKeyMatch(name, raw, key);
      if (score > 0) hits.push({ mod, score });
    }
  }
  const mod = bestMatch(hits);
  return mod
    ? { git_url: mod.git_url, role: mod.role, expose_port: mod.expose_port }
    : null;
}

/** 按本地仓库路径（目录名）匹配；同仓多端口时取该 dir 的第一条 */
export function suggestKlcjZtByRepoPath(
  repoPath: string,
): { git_url: string; role: KsPublishMapRole; expose_port: string } | null {
  const base = basenamePath(repoPath.trim());
  if (!base) return null;
  // 优先精确匹配 dir
  const byDir = KLCJ_ZT_GIT_DEFAULTS.find(
    (m) => normalizeDeployName(m.dir) === normalizeDeployName(base),
  );
  if (byDir) {
    return {
      git_url: byDir.git_url,
      role: byDir.role,
      expose_port: byDir.expose_port,
    };
  }
  return suggestKlcjZtGit(base);
}

/** 按 Git 远程地址匹配；同仓多端口时返回该 git 的第一条（可再按 deployment 细化） */
export function suggestKlcjZtByGitUrl(
  gitUrl: string,
): { git_url: string; role: KsPublishMapRole; expose_port: string } | null {
  const key = normalizeGitUrl(gitUrl);
  if (!key) return null;
  const hits = KLCJ_ZT_GIT_DEFAULTS.filter(
    (m) => normalizeGitUrl(m.git_url) === key,
  );
  if (hits.length === 0) return null;
  // 单服务仓：唯一端口；cli 多端口：返回第一条，调用方应用 deployment 再精化
  const mod = hits[0];
  return { git_url: mod.git_url, role: mod.role, expose_port: mod.expose_port };
}

/**
 * 解析暴露端口：优先已有记忆 → 部署名 → Git URL → 本地路径。
 */
export function resolveKlcjZtExposePort(input: {
  deployment?: string;
  gitUrl?: string;
  repoPath?: string;
  existingPort?: string;
}): string {
  const existing = input.existingPort?.trim() ?? "";
  if (existing) return existing;
  if (input.deployment?.trim()) {
    const byDeploy = suggestKlcjZtGit(input.deployment);
    if (byDeploy?.expose_port) return byDeploy.expose_port;
  }
  if (input.gitUrl?.trim()) {
    const byGit = suggestKlcjZtByGitUrl(input.gitUrl);
    if (byGit?.expose_port) return byGit.expose_port;
  }
  if (input.repoPath?.trim()) {
    const byPath = suggestKlcjZtByRepoPath(input.repoPath);
    if (byPath?.expose_port) return byPath.expose_port;
  }
  return "";
}
