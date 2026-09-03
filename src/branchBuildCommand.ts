import type { BranchProjectType } from "./types";

/** 根据当前选项生成默认执行命令（展示用，与后端实际拆分执行对齐） */
export function computeDefaultBuildCommand(opts: {
  projectType: BranchProjectType;
  packageManager?: string;
  buildScript?: string;
  springProfile?: string;
  packageWithBackend?: boolean;
}): string {
  const pm = (opts.packageManager || "npm").trim() || "npm";
  if (opts.projectType === "maven") {
    const profile = (opts.springProfile || "").trim();
    return profile
      ? `mvn clean package -Dmaven.test.skip=true -Dspring.profiles.active=${profile}`
      : "mvn clean package -Dmaven.test.skip=true";
  }
  const script = (opts.buildScript || "").trim() || "build";
  const frontend = `${pm} install && ${pm} run ${script}`;
  if (opts.packageWithBackend) {
    return `${frontend} && mvn clean package -Dmaven.test.skip=true`;
  }
  return frontend;
}

/** 从手改命令里提取 npm script 名；认不出则返回 null */
export function parseNpmScriptFromCommand(command: string): string | null {
  const raw = command.trim();
  if (!raw) return null;

  // 纯脚本名：build / build:prod（排除包管理器本身，避免手贴整段命令时被当成 script）
  if (
    /^[\w.:/-]+$/.test(raw) &&
    !raw.startsWith("mvn") &&
    !/^(npm|pnpm|yarn|bun)$/i.test(raw)
  ) {
    return raw;
  }

  // … && npm|pnpm|yarn|bun run <script> …
  const runMatch = raw.match(
    /(?:^|&&)\s*(?:npm|pnpm|yarn|bun)\s+run\s+([^\s&|;]+)/i,
  );
  if (runMatch?.[1]) return runMatch[1];

  // npm|pnpm|yarn|bun run <script>
  const onlyRun = raw.match(/^(?:npm|pnpm|yarn|bun)\s+run\s+([^\s&|;]+)/i);
  if (onlyRun?.[1]) return onlyRun[1];

  return null;
}

/** 从手改 mvn 命令里提取 spring.profiles.active */
export function parseMavenProfileFromCommand(command: string): string | null {
  const raw = command.trim();
  if (!raw) return null;
  const m = raw.match(/-Dspring\.profiles\.active=([^\s"']+)/i);
  return m?.[1] ?? null;
}
