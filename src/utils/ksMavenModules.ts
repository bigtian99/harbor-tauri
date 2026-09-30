import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../types";

/** 仓库内一个可执行的 Spring Boot Maven 模块 */
export interface MavenModuleInfo {
  /** 相对仓库根的路径，如 `ruoyi-modules/ruoyi-system`（根模块为 ""） */
  relPath: string;
  artifactId: string;
  dirName: string;
}

interface RawMavenModule {
  rel_path?: string;
  artifact_id?: string;
  dir_name?: string;
}

/** Select 中「自动」选项的哨兵值（真实状态里空串 = 自动） */
export const AUTO_MAVEN_MODULE = "__auto__";

export function mavenModuleLabel(m: MavenModuleInfo): string {
  return m.relPath ? `${m.artifactId}（${m.relPath}）` : `${m.artifactId}（根）`;
}

/** 下拉选项：首项「自动」，其后为扫描到的可执行模块（根模块 relPath 为空，无法显式指定，跳过） */
export function mavenModuleOptions(modules: MavenModuleInfo[]) {
  return [
    { value: AUTO_MAVEN_MODULE, label: "自动（按部署名匹配子模块）" },
    ...modules
      .filter((m) => m.relPath)
      .map((m) => ({ value: m.relPath, label: mavenModuleLabel(m) })),
  ];
}

/** 列出仓库内可执行的 Spring Boot Maven 模块（扫描当前工作树） */
export async function listMavenModules(repoPath: string): Promise<MavenModuleInfo[]> {
  const path = repoPath.trim();
  if (!path || !isTauriRuntime()) return [];
  const rows = await invoke<RawMavenModule[]>("list_maven_modules", { repoPath: path });
  return (rows ?? []).map((r) => ({
    relPath: r.rel_path ?? "",
    artifactId: r.artifact_id ?? r.rel_path ?? "",
    dirName: r.dir_name ?? "",
  }));
}

export interface ModuleServerPort {
  port: number;
  /** 命中的配置文件（分支内相对路径） */
  file: string;
}

/** 读取指定分支某个模块的 `server.port`（application/boot 配置），用于回填容器端口 */
export async function detectModuleServerPort(input: {
  repoPath: string;
  branch: string;
  moduleRelPath: string;
  springProfile?: string;
}): Promise<ModuleServerPort | null> {
  const { repoPath, branch, moduleRelPath, springProfile } = input;
  if (!repoPath.trim() || !branch.trim() || !isTauriRuntime()) return null;
  const info = await invoke<{ port?: number; file?: string } | null>(
    "detect_module_server_port",
    {
      repoPath,
      branch,
      moduleRelPath,
      springProfile: springProfile?.trim() || null,
    },
  );
  if (!info || typeof info.port !== "number" || info.port <= 0) return null;
  return { port: info.port, file: info.file ?? "" };
}
