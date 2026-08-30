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

export const STATUS_DOT: Record<string, string> = {
  running: "#34c877", updating: "#4aa3e8", pull: "#e5484d", crash: "#e5484d",
  creating: "#f5a623", stopped: "#71717a", pending: "#fbbf24", unknown: "#f59e0b",
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
