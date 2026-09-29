export interface PodInfo {
  name: string; phase: string; state: string; reason: string | null;
  restarts: number; ready: number; total: number; startTime: string; node: string;
}
export interface DeployStatus { state: string; label: string; reason: string | null; detail: string; old: string; }
export interface DeployInfo {
  name: string;
  alias: string;
  image: string;
  containers: string[];
  ports: number[];
  status: DeployStatus; pods: { new: PodInfo[]; old: PodInfo[] }; revision: string;
  /** 是否配置了 Git 地址（用于批量打包） */
  hasGitConfig?: boolean;
}
export interface UpdateResult { ok: boolean; oldImage: string; newImage: string; revision: string; }
export interface ConfigMapInfo { name: string; alias: string; keys: string[]; dataSize: number; }
export interface DeployRevision {
  revision: string;
  image: string;
  containers: { name: string; image: string }[];
  replicas: number;
  ready: number;
  createdAt: string;
  isCurrent: boolean;
}

export interface DeployEditInfo {
  name: string;
  alias: string;
  image: string;
  container: string;
  port: number;
  replicas: number;
  healthPath: string;
  configMap: string | null;
  envs: string[];
}

export const EMPTY_DEPLOY_FORM = {
  name: "",
  image: "",
  alias: "",
  port: 8080,
  replicas: 1,
  healthPath: "/actuator/health",
  envs: "",
  configMap: null as string | null,
  container: "container-main",
};

/** 创建部署的镜像来源：直接填镜像地址，或填 Git 地址先构建推送再创建 */
export type KsImageSource = "image" | "git";

/** 创建部署「Git 构建」模式表单（构建参数尽量自动解析，这里只收最关键的几项） */
export interface KsCreateGitForm {
  url: string;
  branch: string;
  role: "backend" | "frontend";
  /** 前端 npm 构建脚本选择（后端忽略） */
  npmMode: "auto" | "prod" | "test" | "custom";
  npmCustom: string;
  /** 手选 Maven 子模块 rel_path（后端；"" = 按部署名自动匹配） */
  mavenModule: string;
}

export const EMPTY_CREATE_GIT_FORM: KsCreateGitForm = {
  url: "",
  branch: "",
  role: "backend",
  npmMode: "auto",
  npmCustom: "",
  mavenModule: "",
};

export const STATUS_DOT: Record<string, string> = {
  running: "var(--color-success)",
  updating: "var(--color-primary)",
  pull: "var(--color-error)",
  crash: "var(--color-error)",
  creating: "var(--color-warning)",
  stopped: "var(--color-text-muted)",
  pending: "var(--color-warning)",
  unknown: "var(--color-warning)",
};
export const STATUS_COLOR: Record<string, string> = {
  running: "green", updating: "blue", pull: "red", crash: "red",
  creating: "orange", stopped: "gray", pending: "yellow", unknown: "orange",
};
export const BAD_STATES = ["pull", "crash", "creating", "updating", "pending", "stopped"];
export const PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;
export const REV_PAGE_SIZE_OPTIONS = ["5", "10", "20"] as const;
export const HEALTH_PATH_OPTIONS = ["/actuator/health", "/health"] as const;
/** K8s metadata.name：小写 RFC 1123 subdomain */
export const RFC1123_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
