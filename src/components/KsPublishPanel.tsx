import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Card, Title, Text, TextInput, Button, Select, Table, Badge, Modal, Textarea, NumberInput, SegmentedControl, Tooltip,
  Checkbox, Group, Stack, Divider, ScrollArea, Box, Loader, Pagination, SimpleGrid, Tabs, Autocomplete,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { RefreshCw, Download, Rocket, Container as ContainerIcon, Search, History, Plus, Copy, Pencil, Package } from "lucide-react";
import type { HarborConfig } from "../types";
import { isTauriRuntime } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "../utils/ksEnvironments";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import {
  KsBatchConfirmModal,
  KsBatchProgressModal,
  type KsBatchMeta,
  type KsBatchSummary,
} from "./KsBatchPackModal";
import {
  detectCpuCores,
  KS_BATCH_CONCURRENCY_AUTO,
  loadKsBatchConcurrencyPref,
  recommendKsBatchConcurrency,
  runKsBatchPackPublish,
  saveKsBatchConcurrencyPref,
  type KsBatchConcurrencyPref,
} from "../utils/ksBatchPackPublish";
import {
  defaultKsBatchBranch,
  loadKsBatchBranchHistory,
  rememberKsBatchBranch,
} from "../utils/ksBatchBranchHistory";
import {
  appendBuildProgressLog,
  normalizeBatchBranchInput,
  parseBatchStepLabel,
  scaleBatchBuildPercent,
} from "../utils/buildProgressLog";

interface PodInfo {
  name: string; phase: string; state: string; reason: string | null;
  restarts: number; ready: number; total: number; startTime: string; node: string;
}
interface DeployStatus { state: string; label: string; reason: string | null; detail: string; old: string; }
interface DeployInfo {
  name: string;
  alias: string;
  image: string;
  containers: string[];
  ports: number[];
  status: DeployStatus; pods: { new: PodInfo[]; old: PodInfo[] }; revision: string;
}
interface UpdateResult { ok: boolean; oldImage: string; newImage: string; revision: string; }
interface ConfigMapInfo { name: string; alias: string; keys: string[]; dataSize: number; }
interface DeployRevision {
  revision: string;
  image: string;
  containers: { name: string; image: string }[];
  replicas: number;
  ready: number;
  createdAt: string;
  isCurrent: boolean;
}

interface DeployEditInfo {
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

const EMPTY_DEPLOY_FORM = {
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

const STATUS_DOT: Record<string, string> = {
  running: "#34c877", updating: "#4aa3e8", pull: "#e5484d", crash: "#e5484d",
  creating: "#f5a623", stopped: "#9aa5b8", pending: "#9aa5b8", unknown: "#9aa5b8",
};
const STATUS_COLOR: Record<string, string> = {
  running: "green", updating: "blue", pull: "red", crash: "red",
  creating: "orange", stopped: "gray", pending: "gray", unknown: "gray",
};
const BAD_STATES = ["pull", "crash", "creating", "updating", "pending", "stopped"];
const PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;
const REV_PAGE_SIZE_OPTIONS = ["5", "10", "20"] as const;
const HEALTH_PATH_OPTIONS = ["/actuator/health", "/health"] as const;
/** K8s metadata.name：小写 RFC 1123 subdomain */
const RFC1123_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

function isRfc1123Name(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 253 && RFC1123_NAME.test(n);
}

/** 仅当已有 SW_AGENT_NAME 行时，将其值同步为 ConfigMap 名称；没有则不新增 */
function syncSwAgentNameIfPresent(data: string, cmName: string): string {
  const name = cmName.trim();
  if (!name) return data;
  const lines = data.split("\n");
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "SW_AGENT_NAME") return line;
    found = true;
    const indent = line.match(/^\s*/)?.[0] ?? "";
    return `${indent}SW_AGENT_NAME=${name}`;
  });
  return found ? next.join("\n") : data;
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(/\//g, "-");
}

/** 轻量指纹：静默刷新无变化时跳过 setState，避免整表重渲染卡顿 */
function deployListFingerprint(list: DeployInfo[]): string {
  let s = String(list.length);
  for (const d of list) {
    const headNew = d.pods.new[0];
    const headOld = d.pods.old[0];
    s += `|${d.name}:${d.alias ?? ""}:${d.revision}:${d.image}:${d.status.state}:${d.status.detail}:${d.ports.join(",")}:${d.pods.new.length}:${d.pods.old.length}:${headNew?.reason ?? headNew?.state ?? ""}:${headOld?.reason ?? headOld?.state ?? ""}`;
  }
  return s;
}

/** 毫秒 → 中文可读时长（如 2 天 3 小时） */
function fmtDurationMs(ms: number): string {
  if (ms <= 0) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hour = Math.floor(min / 60);
  const rmin = min % 60;
  if (hour < 24) return rmin > 0 ? `${hour} 小时 ${rmin} 分` : `${hour} 小时`;
  const day = Math.floor(hour / 24);
  const rhour = hour % 24;
  if (day < 30) return rhour > 0 ? `${day} 天 ${rhour} 小时` : `${day} 天`;
  const month = Math.floor(day / 30);
  const rday = day % 30;
  return rday > 0 ? `${month} 个月 ${rday} 天` : `${month} 个月`;
}

/** 按 revision 时间线推算各版本运行时长：当前版至今，历史版至下一 revision 创建 */
function buildRevisionDurationMap(
  revisions: DeployRevision[],
  nowMs: number,
): Map<string, { label: string; ongoing: boolean }> {
  const map = new Map<string, { label: string; ongoing: boolean }>();
  if (revisions.length === 0) return map;
  const sorted = [...revisions].sort((a, b) => {
    const ra = Number.parseInt(a.revision, 10) || 0;
    const rb = Number.parseInt(b.revision, 10) || 0;
    return ra - rb;
  });
  for (let i = 0; i < sorted.length; i++) {
    const rev = sorted[i];
    const start = new Date(rev.createdAt).getTime();
    if (Number.isNaN(start)) continue;
    const ongoing = rev.isCurrent;
    const nextStart = sorted[i + 1] ? new Date(sorted[i + 1].createdAt).getTime() : NaN;
    const end = ongoing ? nowMs : nextStart;
    if (Number.isNaN(end) || end <= start) continue;
    map.set(rev.revision, { label: fmtDurationMs(end - start), ongoing });
  }
  return map;
}

const DeployRow = memo(function DeployRow({
  d,
  selected,
  checked,
  onSelect,
  onToggleCheck,
  onEdit,
}: {
  d: DeployInfo;
  selected: boolean;
  checked: boolean;
  onSelect: (d: DeployInfo) => void;
  onToggleCheck: (name: string, checked: boolean) => void;
  onEdit: (d: DeployInfo) => void;
}) {
  const s = d.status;
  return (
    <Table.Tr
      className={selected ? "ks-row-sel" : checked ? "ks-row-checked" : undefined}
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(d)}
    >
      <Table.Td onClick={(e) => e.stopPropagation()}>
        <Checkbox
          aria-label={`选择 ${d.name}`}
          checked={checked}
          onChange={(e) => onToggleCheck(d.name, e.currentTarget.checked)}
        />
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[s.state] ?? "#9aa5b8", display: "inline-block" }} />
          <Badge color={STATUS_COLOR[s.state] ?? "gray"} variant="light" size="xs">{s.label}</Badge>
        </Group>
      </Table.Td>
      <Table.Td fw={700}>{d.name}</Table.Td>
      <Table.Td>{d.alias?.trim() || "-"}</Table.Td>
      <Table.Td>{d.containers.join(", ") || "-"}</Table.Td>
      <Table.Td style={{ fontFamily: "monospace", fontSize: 12 }}>
        {(d.ports ?? []).length ? d.ports.join(", ") : "-"}
      </Table.Td>
      <Table.Td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.image}>
        {d.image || "-"}
      </Table.Td>
      <Table.Td>{s.detail.split(" · ")[0]}{s.old && <Text span size="xs" c="dimmed">{s.old}</Text>}</Table.Td>
      <Table.Td>{d.revision}</Table.Td>
      <Table.Td>
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<Pencil size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(d);
          }}
        >
          修改
        </Button>
      </Table.Td>
    </Table.Tr>
  );
});

export function KsPublishPanel({
  config,
  configReady = true,
  onLastEnvChange,
}: {
  config: HarborConfig;
  /** 配置已从磁盘加载完成；false 时不要自动连接，避免 reload 后空配置误报「未配置环境」 */
  configReady?: boolean;
  onLastEnvChange?: (id: string) => void;
}) {
  const { confirm } = useConfirmDialog();
  const envs = resolveKsEnvironments(config);
  const [envId, setEnvId] = useState<string | null>(
    () => pickKsEnvironment(envs, config.ks_last_env_id)?.id ?? null,
  );
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState<string | null>(null);
  const [deploys, setDeploys] = useState<DeployInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<DeployInfo | null>(null);
  const [checkedNames, setCheckedNames] = useState<Set<string>>(() => new Set());
  const [batchBranch, setBatchBranch] = useState(
    () => defaultKsBatchBranch(config.last_branch),
  );
  const [branchHistory, setBranchHistory] = useState(() => loadKsBatchBranchHistory());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchMeta, setBatchMeta] = useState<KsBatchMeta | null>(null);
  const [batchSummary, setBatchSummary] = useState<KsBatchSummary | null>(null);
  const [batchConcurrencyPref, setBatchConcurrencyPref] = useState<KsBatchConcurrencyPref>(
    () => loadKsBatchConcurrencyPref(),
  );
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchLog, setBatchLog] = useState("");
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchMessage, setBatchMessage] = useState("");
  /** 当前批量项标题，用于与 build-progress 子进度拼接 */
  const batchStepLabelRef = useRef("");
  /** 部署名精确筛选（下拉）；空 = 全部 */
  const [filterDeploy, setFilterDeploy] = useState<string | null>(null);
  /** all | bad | 具体 status.state */
  const [filterStatus, setFilterStatus] = useState<string | null>("all");
  /** 仅搜镜像地址 */
  const [filterImage, setFilterImage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState("30");
  const [image, setImage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({ ...EMPTY_DEPLOY_FORM });
  const [editPreviewYaml, setEditPreviewYaml] = useState("");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [mainTab, setMainTab] = useState<string | null>("deploy");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_DEPLOY_FORM });
  const [previewYaml, setPreviewYaml] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [cms, setCms] = useState<ConfigMapInfo[]>([]);
  const [cmLoading, setCmLoading] = useState(false);
  const [cmPage, setCmPage] = useState(1);
  const [cmPageSize, setCmPageSize] = useState(20);
  const [cmOpen, setCmOpen] = useState(false);
  const [cmMode, setCmMode] = useState<"form" | "yaml">("form");
  const [cmForm, setCmForm] = useState({ name: "", data: "" });
  const [cmYaml, setCmYaml] = useState("");
  const [cmPreview, setCmPreview] = useState("");
  const [cmBusy, setCmBusy] = useState(false);
  const [revisions, setRevisions] = useState<DeployRevision[]>([]);
  const [revsLoading, setRevsLoading] = useState(false);
  const [revPage, setRevPage] = useState(1);
  const [revPageSize, setRevPageSize] = useState(10);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 防止自动刷新叠加重试把 UI 拖死 */
  const loadInFlightRef = useRef(false);
  const loadSeqRef = useRef(0);
  const cmInFlightRef = useRef(false);
  const connectGenRef = useRef(0);
  const deploysFpRef = useRef("");

  const selectedEnv = pickKsEnvironment(envs, envId);

  const connect = async (id?: string | null) => {
    const gen = ++connectGenRef.current;
    const env = pickKsEnvironment(envs, id ?? envId);
    if (!env) {
      if (gen !== connectGenRef.current) return;
      setStatusText("未配置环境：请到 系统设置 → KubeSphere 添加 dev / test / prod");
      setConnected(false);
      return;
    }
    const consoleUrl = env.console || "http://192.168.31.254:30880";
    const username = env.username || "admin";
    const password = env.password || "";
    if (!consoleUrl.trim() || !username.trim() || !password) {
      if (gen !== connectGenRef.current) return;
      setStatusText(`环境「${env.name}」未配齐：请到 系统设置 → KubeSphere 填写地址/账号/密码`);
      setConnected(false);
      return;
    }
    setConnecting(true);
    setConnected(false);
    setNamespaces([]);
    setNamespace(null);
    setDeploys([]);
    deploysFpRef.current = "";
    setSel(null);
    setCheckedNames(new Set());
    setStatusText(`正在连接「${env.name}」…`);
    try {
      const result = await invoke<{ mode: string; message: string }>("ks_connect", {
        envId: env.id,
        console: consoleUrl.trim(),
        username: username.trim(),
        password,
      });
      if (gen !== connectGenRef.current) return;
      const ns = await invoke<string[]>("ks_list_namespaces");
      if (gen !== connectGenRef.current) return;
      if (ns.length === 0) {
        setNamespaces([]);
        setNamespace(null);
        setConnected(false);
        setStatusText(`「${env.name}」已连接但未拿到命名空间，会话可能已失效，请再点环境重连`);
        notifications.show({
          color: "yellow",
          message: `「${env.name}」命名空间为空，请重新连接`,
          autoClose: 3200,
        });
        return;
      }
      setNamespaces(ns);
      const prefer = ns.includes("klcj-zt-dev") ? "klcj-zt-dev" : ns[0] ?? null;
      setNamespace(prefer);
      setConnected(true);
      const tip =
        result.mode === "cached"
          ? "已复用会话"
          : result.mode === "refreshed"
            ? "已自动续期"
            : "已登录";
      setStatusText("");
      notifications.show({
        color: "green",
        message: `「${env.name}」${tip}`,
        autoClose: 1800,
      });
    } catch (e) {
      if (gen !== connectGenRef.current) return;
      setStatusText(`连接「${env.name}」失败：${e}（请到 系统设置 → KubeSphere 检查配置）`);
      setConnected(false);
    } finally {
      if (gen === connectGenRef.current) setConnecting(false);
    }
  };

  const switchEnv = (id: string | null) => {
    setEnvId(id);
    if (id) onLastEnvChange?.(id);
    void connect(id);
  };

  // 等配置加载完成再自动连接；避免 reload 恢复页签时抢跑空默认配置
  useEffect(() => {
    if (!configReady) {
      setStatusText("正在加载配置…");
      return;
    }
    const nextId = pickKsEnvironment(envs, config.ks_last_env_id)?.id ?? null;
    setEnvId(nextId);
    const t = setTimeout(() => {
      void connect(nextId);
    }, 40);
    return () => {
      clearTimeout(t);
      connectGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady]);

  const loadCms = useCallback(async () => {
    if (!connected || !namespace) return;
    if (cmInFlightRef.current) return;
    cmInFlightRef.current = true;
    setCmLoading(true);
    try {
      setCms(await invoke<ConfigMapInfo[]>("ks_list_configmaps", { namespace }));
    } catch {
      /* 列表失败不阻断 */
    } finally {
      cmInFlightRef.current = false;
      setCmLoading(false);
    }
  }, [connected, namespace]);

  /** silent：自动刷新，不挡 UI；withCms：同时拉 ConfigMap（仅 Config 页签已打开时） */
  const load = useCallback(async (opts: { silent?: boolean; withCms?: boolean } = {}) => {
    const { silent = false, withCms = false } = opts;
    if (!connected || !namespace) return;
    if (loadInFlightRef.current) {
      // 自动刷新撞上进行中的请求：直接跳过，避免堆积
      if (silent) return;
      // 手动刷新：等当前结束后再拉一轮意义不大，同样跳过并提示
      notifications.show({ color: "blue", message: "上一轮刷新仍在进行，请稍候", autoClose: 1200 });
      return;
    }
    loadInFlightRef.current = true;
    const seq = ++loadSeqRef.current;
    if (!silent) setLoading(true);
    try {
      const list = await invoke<DeployInfo[]>("ks_list_deployments", { namespace });
      if (seq !== loadSeqRef.current) return;
      const fp = deployListFingerprint(list);
      const unchanged = fp === deploysFpRef.current;
      if (!unchanged) {
        deploysFpRef.current = fp;
        setDeploys(list);
        setSel((prev) => (prev && list.find((d) => d.name === prev.name)) || null);
      }
      setLastRefresh(new Date().toLocaleTimeString("zh-CN"));
      if (withCms) void loadCms();
    } catch (e) {
      if (seq === loadSeqRef.current && !silent) {
        notifications.show({ color: "red", message: String(e) });
      }
    } finally {
      loadInFlightRef.current = false;
      if (seq === loadSeqRef.current && !silent) setLoading(false);
    }
  }, [connected, namespace, loadCms]);

  // 自动刷新：只刷部署状态，不刷 ConfigMap
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh && connected && namespace) {
      timerRef.current = setInterval(() => { void load({ silent: true }); }, Number(refreshSec) * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSec, connected, namespace, load]);

  // 切换命名空间自动加载部署（ConfigMap 等切到对应页签再拉）
  useEffect(() => {
    if (connected && namespace) void load({ silent: false, withCms: mainTab === "config" });
    setFilterDeploy(null);
    setFilterStatus("all");
    setFilterImage("");
    setPage(1);
    setCmPage(1);
    setCheckedNames(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, connected]);

  const toggleDeployCheck = useCallback((name: string, on: boolean) => {
    setCheckedNames((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }, []);

  const selectedDeploys = useMemo(
    () => deploys.filter((d) => checkedNames.has(d.name)),
    [deploys, checkedNames],
  );

  const batchBranchSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const b of [...branchHistory, config.last_branch?.trim() || ""]) {
      const t = b.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }, [branchHistory, config.last_branch]);

  // 批量执行期间订阅后端 build-progress（与分支打包页同一事件源）
  useEffect(() => {
    if (!batchRunning || !isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        const { percent, message } = event.payload;
        const step = batchStepLabelRef.current;
        const { index, total } = parseBatchStepLabel(step);
        setBatchProgress(scaleBatchBuildPercent(index, total, percent));
        setBatchMessage(step ? `${step} · ${message}` : message);
        setBatchLog((prev) => appendBuildProgressLog(prev, message));
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [batchRunning]);

  // ConfigMap 页签懒加载：进入时才拉，避免与部署列表抢带宽/主线程
  useEffect(() => {
    if (connected && namespace && mainTab === "config") void loadCms();
  }, [connected, namespace, mainTab, loadCms]);

  const doCreate = async (dry: boolean) => {
    const f = createForm;
    const depName = f.name.trim().toLowerCase();
    if (!namespace || !depName || !f.image.trim()) {
      notifications.show({ color: "yellow", message: "请填写部署名称与镜像地址" });
      return;
    }
    if (!isRfc1123Name(depName)) {
      notifications.show({
        color: "yellow",
        title: "部署名称不合法",
        message: "须为小写字母/数字/'-'/'.'，且以字母或数字开头结尾（例：klcj-test-service）",
      });
      return;
    }
    if (!f.port || f.port < 1 || f.port > 65535) {
      notifications.show({ color: "yellow", message: "请填写有效的容器端口（1–65535）" });
      return;
    }
    const healthPath = (f.healthPath.trim() || "/actuator/health").startsWith("/")
      ? (f.healthPath.trim() || "/actuator/health")
      : `/${f.healthPath.trim()}`;
    if (f.name !== depName) setCreateForm({ ...f, name: depName });
    setCreateBusy(true);
    try {
      const msg = await invoke<string>("ks_create_deployment", {
        namespace,
        name: depName,
        image: f.image.trim(),
        alias: f.alias.trim() || undefined,
        port: f.port,
        replicas: f.replicas,
        envs: f.envs.split("\n").map((l) => l.trim()).filter(Boolean),
        configMap: f.configMap || undefined,
        healthPath,
        dryRun: dry,
      });
      notifications.show({ color: "green", title: dry ? "校验通过" : "创建成功", message: msg });
      if (!dry) {
        setCreateOpen(false);
        setCreateForm({ ...EMPTY_DEPLOY_FORM });
        setPreviewYaml("");
        void load({ silent: true });
      }
    } catch (e) {
      notifications.show({ color: "red", title: "失败", message: String(e) });
    } finally {
      setCreateBusy(false);
    }
  };

  const doPreview = async () => {
    const f = createForm;
    const depName = f.name.trim().toLowerCase();
    if (!depName || !f.image.trim()) {
      notifications.show({ color: "yellow", message: "请填写部署名称与镜像地址" });
      return;
    }
    if (!isRfc1123Name(depName)) {
      notifications.show({
        color: "yellow",
        title: "部署名称不合法",
        message: "须为小写字母/数字/'-'/'.'，且以字母或数字开头结尾（例：klcj-test-service）",
      });
      return;
    }
    if (!f.port || f.port < 1 || f.port > 65535) {
      notifications.show({ color: "yellow", message: "请填写有效的容器端口（1–65535）" });
      return;
    }
    const healthPath = (f.healthPath.trim() || "/actuator/health").startsWith("/")
      ? (f.healthPath.trim() || "/actuator/health")
      : `/${f.healthPath.trim()}`;
    if (f.name !== depName) setCreateForm({ ...f, name: depName });
    setCreateBusy(true);
    try {
      const yaml = await invoke<string>("ks_preview_deployment", {
        namespace,
        name: depName,
        image: f.image.trim(),
        alias: f.alias.trim() || undefined,
        port: f.port,
        replicas: f.replicas,
        envs: f.envs.split("\n").map((l) => l.trim()).filter(Boolean),
        configMap: f.configMap || undefined,
        healthPath,
      });
      setPreviewYaml(yaml);
    } catch (e) {
      notifications.show({ color: "red", title: "预览失败", message: String(e) });
    } finally {
      setCreateBusy(false);
    }
  };

  const copyYaml = async () => {
    if (!previewYaml) return;
    try {
      await navigator.clipboard.writeText(previewYaml);
      notifications.show({ color: "green", message: "已复制到剪贴板" });
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>(".ks-preview-textarea");
      if (ta) { ta.select(); document.execCommand("copy"); notifications.show({ color: "green", message: "已复制（请 Ctrl+C 确认）" }); }
    }
  };

  const doCmCreate = async (dry: boolean) => {
    setCmBusy(true);
    try {
      if (cmMode === "form") {
        const msg = await invoke<string>("ks_create_configmap", {
          namespace,
          name: cmForm.name.trim(),
          data: cmForm.data.split("\n").map((l) => l.trim()).filter(Boolean),
          dryRun: dry,
        });
        notifications.show({ color: "green", title: dry ? "校验通过" : "创建成功", message: msg });
      } else {
        const msg = await invoke<string>("ks_create_configmap_yaml", { namespace, yaml: cmYaml, dryRun: dry });
        notifications.show({ color: "green", title: dry ? "校验通过" : "创建成功", message: msg });
      }
      if (!dry) { setCmOpen(false); setCmForm({ name: "", data: "" }); setCmYaml(""); setCmPreview(""); void loadCms(); }
    } catch (e) {
      notifications.show({ color: "red", title: "失败", message: String(e) });
    } finally {
      setCmBusy(false);
    }
  };

  const doCmPreview = async () => {
    if (cmMode !== "form") { setCmPreview(""); return; }
    if (!cmForm.name.trim()) { notifications.show({ color: "yellow", message: "请填写名称" }); return; }
    setCmBusy(true);
    try {
      const yaml = await invoke<string>("ks_preview_configmap", {
        namespace,
        name: cmForm.name.trim(),
        data: cmForm.data.split("\n").map((l) => l.trim()).filter(Boolean),
      });
      setCmPreview(yaml);
    } catch (e) {
      notifications.show({ color: "red", title: "预览失败", message: String(e) });
    } finally {
      setCmBusy(false);
    }
  };

  const copyCmFrom = async (cm: ConfigMapInfo) => {
    try {
      const data = await invoke<Record<string, string>>("ks_get_configmap", { namespace, name: cm.name });
      const newName = `${cm.name}-copy`;
      const lines = Object.entries(data).map(([k, v]) => `${k}=${v}`).join("\n");
      setCmForm({ name: newName, data: syncSwAgentNameIfPresent(lines, newName) });
      setCmMode("form");
      setCmYaml("");
      setCmPreview("");
      setCmOpen(true);
    } catch (e) {
      notifications.show({ color: "red", title: "读取失败", message: String(e) });
    }
  };

  const copyText = async (text: string, tip = "已复制到剪贴板") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notifications.show({ color: "green", message: tip });
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>(".ks-preview-textarea");
      if (ta) { ta.select(); document.execCommand("copy"); notifications.show({ color: "green", message: "已复制（请 Ctrl+C 确认）" }); }
    }
  };

  const deferredImage = useDeferredValue(filterImage);
  const deployOptions = useMemo(
    () =>
      [...deploys]
        .map((d) => ({
          value: d.name,
          label: d.alias?.trim() ? `${d.name}（${d.alias}）` : d.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    [deploys],
  );
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of deploys) {
      if (!seen.has(d.status.state)) seen.set(d.status.state, d.status.label);
    }
    return [
      { value: "all", label: "全部状态" },
      { value: "bad", label: "只看异常" },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "zh-CN"))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [deploys]);
  const filtered = useMemo(() => {
    let list = deploys;
    if (filterDeploy) list = list.filter((d) => d.name === filterDeploy);
    if (filterStatus === "bad") {
      list = list.filter((d) => BAD_STATES.includes(d.status.state));
    } else if (filterStatus && filterStatus !== "all") {
      list = list.filter((d) => d.status.state === filterStatus);
    }
    const q = deferredImage.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const tag = d.image.split(":").pop() ?? d.image;
        return d.image.toLowerCase().includes(q) || tag.toLowerCase().includes(q);
      });
    }
    return list;
  }, [deploys, filterDeploy, filterStatus, deferredImage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const pageAllChecked =
    pageRows.length > 0 && pageRows.every((d) => checkedNames.has(d.name));
  const pageSomeChecked =
    pageRows.some((d) => checkedNames.has(d.name)) && !pageAllChecked;

  const togglePageChecks = (on: boolean) => {
    setCheckedNames((prev) => {
      const next = new Set(prev);
      for (const d of pageRows) {
        if (on) next.add(d.name);
        else next.delete(d.name);
      }
      return next;
    });
  };

  const beginBatchPack = () => {
    if (!envId || !namespace || selectedDeploys.length === 0) return;
    if (!isTauriRuntime()) {
      notifications.show({ color: "yellow", message: "请在 Tauri 桌面窗口中操作" });
      return;
    }
    const branch = normalizeBatchBranchInput(batchBranch);
    if (!branch) {
      notifications.show({ color: "yellow", message: "请填写目标分支" });
      return;
    }

    setBatchMeta({
      branch,
      namespace,
      envName: selectedEnv?.name ?? envId,
      deployNames: selectedDeploys.map((d) => d.name),
    });
    setBatchConfirmOpen(true);
  };

  const startBatchPack = async () => {
    if (!envId || !namespace || !batchMeta) return;
    const branch = batchMeta.branch;

    setBatchConfirmOpen(false);
    setBranchHistory(rememberKsBatchBranch(branch));
    setBatchOpen(true);
    setBatchRunning(true);
    setBatchSummary(null);
    setBatchLog("");
    setBatchProgress(0);
    batchStepLabelRef.current = "";
    setBatchMessage("正在解析本地仓库…");

    try {
      const summary = await runKsBatchPackPublish({
        config,
        envId,
        namespace,
        branchName: branch,
        concurrency: batchConcurrencyPref === KS_BATCH_CONCURRENCY_AUTO
          ? KS_BATCH_CONCURRENCY_AUTO
          : batchConcurrencyPref,
        deployments: selectedDeploys.map((d) => ({
          name: d.name,
          containers: d.containers,
        })),
        appendLog: (line) => setBatchLog((prev) => (prev ? `${prev}\n${line}` : line)),
        onProgress: (pct, msg) => {
          batchStepLabelRef.current = msg;
          setBatchProgress(pct);
          setBatchMessage(msg);
        },
      });
      setBatchSummary({
        success: summary.success,
        failed: summary.failed,
        skipped: summary.skipped,
      });
      notifications.show({
        color: summary.failed > 0 ? "orange" : "green",
        title: "批量完成",
        message: `成功 ${summary.success} · 失败 ${summary.failed} · 跳过 ${summary.skipped}`,
        autoClose: 5000,
      });
      void load({ silent: true });
    } finally {
      setBatchRunning(false);
    }
  };

  const cmTotalPages = Math.max(1, Math.ceil(cms.length / cmPageSize));
  const cmSafePage = Math.min(cmPage, cmTotalPages);
  const cmPageRows = cms.slice((cmSafePage - 1) * cmPageSize, cmSafePage * cmPageSize);

  useEffect(() => {
    setPage(1);
  }, [filterDeploy, filterStatus, deferredImage, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    setCmPage(1);
  }, [cmPageSize, namespace]);

  useEffect(() => {
    if (cmPage !== cmSafePage) setCmPage(cmSafePage);
  }, [cmPage, cmSafePage]);

  const revTotalPages = Math.max(1, Math.ceil(revisions.length / revPageSize));
  const revSafePage = Math.min(revPage, revTotalPages);
  const revPageRows = revisions.slice((revSafePage - 1) * revPageSize, revSafePage * revPageSize);

  const [revNow, setRevNow] = useState(() => Date.now());
  useEffect(() => {
    if (!revisions.some((r) => r.isCurrent)) return;
    const id = setInterval(() => setRevNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [revisions]);

  const revDurationMap = useMemo(
    () => buildRevisionDurationMap(revisions, revNow),
    [revisions, revNow],
  );

  useEffect(() => {
    setRevPage(1);
  }, [sel?.name, revPageSize]);

  useEffect(() => {
    if (revPage !== revSafePage) setRevPage(revSafePage);
  }, [revPage, revSafePage]);

  const selContainer = sel?.containers[0] ?? "";

  const loadRevisions = useCallback(async (depName?: string) => {
    const name = depName ?? sel?.name;
    if (!connected || !namespace || !name) {
      setRevisions([]);
      return;
    }
    setRevsLoading(true);
    try {
      const list = await invoke<DeployRevision[]>("ks_list_deployment_revisions", {
        namespace,
        deployment: name,
      });
      setRevisions(list);
    } catch (e) {
      setRevisions([]);
      notifications.show({ color: "red", title: "读取历史版本失败", message: String(e) });
    } finally {
      setRevsLoading(false);
    }
  }, [connected, namespace, sel?.name]);

  useEffect(() => {
    void loadRevisions();
  }, [loadRevisions, sel?.revision]);

  const submit = async () => {
    if (!namespace || !editForm.name.trim()) return;
    if (!editForm.image.trim()) {
      notifications.show({ color: "yellow", message: "请填写镜像地址" });
      return;
    }
    if (!editForm.port || editForm.port < 1 || editForm.port > 65535) {
      notifications.show({ color: "yellow", message: "请填写有效的容器端口（1–65535）" });
      return;
    }
    const healthPath = (editForm.healthPath.trim() || "/actuator/health").startsWith("/")
      ? (editForm.healthPath.trim() || "/actuator/health")
      : `/${editForm.healthPath.trim()}`;
    setSubmitting(true);
    try {
      const r = await invoke<UpdateResult>("ks_update_deployment", {
        namespace,
        name: editForm.name.trim(),
        image: editForm.image.trim(),
        alias: editForm.alias.trim() || undefined,
        port: editForm.port,
        replicas: editForm.replicas,
        envs: editForm.envs.split("\n").map((l) => l.trim()).filter(Boolean),
        configMap: editForm.configMap || undefined,
        healthPath,
        container: editForm.container || selContainer || undefined,
      });
      notifications.show({
        color: r.ok ? "green" : "red",
        title: r.ok ? "🚀 更新成功" : "更新失败",
        message: `${r.newImage}（revision ${r.revision}）`,
      });
      setEditOpen(false);
      setEditPreviewYaml("");
      setImage(r.newImage || editForm.image.trim());
      void load({ silent: true });
      void loadRevisions(editForm.name.trim());
    } catch (e) {
      notifications.show({ color: "red", title: "变更失败", message: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  /** 详情区右下角：仅改镜像并发布（旧交互） */
  const submitImageOnly = async () => {
    if (!sel || !namespace) return;
    if (!image.trim()) {
      notifications.show({ color: "yellow", message: "请填写新镜像地址" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await invoke<UpdateResult>("ks_update_image", {
        namespace,
        deployment: sel.name,
        container: selContainer,
        image: image.trim(),
      });
      notifications.show({
        color: r.ok ? "green" : "red",
        title: r.ok ? "🚀 发布成功" : "发布失败",
        message: `${r.newImage}（revision ${r.revision}）`,
      });
      setImage("");
      void load({ silent: true });
      void loadRevisions(sel.name);
    } catch (e) {
      notifications.show({ color: "red", title: "变更失败", message: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const doEditPreview = async () => {
    if (!namespace || !editForm.name.trim() || !editForm.image.trim()) {
      notifications.show({ color: "yellow", message: "请填写部署名称与镜像地址" });
      return;
    }
    const healthPath = (editForm.healthPath.trim() || "/actuator/health").startsWith("/")
      ? (editForm.healthPath.trim() || "/actuator/health")
      : `/${editForm.healthPath.trim()}`;
    setSubmitting(true);
    try {
      const yaml = await invoke<string>("ks_preview_deployment", {
        namespace,
        name: editForm.name.trim(),
        image: editForm.image.trim(),
        alias: editForm.alias.trim() || undefined,
        port: editForm.port,
        replicas: editForm.replicas,
        envs: editForm.envs.split("\n").map((l) => l.trim()).filter(Boolean),
        configMap: editForm.configMap || undefined,
        healthPath,
      });
      setEditPreviewYaml(yaml);
    } catch (e) {
      notifications.show({ color: "red", title: "预览失败", message: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const rollback = async (rev: DeployRevision) => {
    if (!sel || !namespace || rev.isCurrent) return;
    const ok = await confirm({
      title: "回滚到此版本",
      message: `将「${sel.name}」回滚到 revision ${rev.revision}？`,
      details: [rev.image],
      confirmLabel: "确认回滚",
      variant: "danger",
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const r = await invoke<UpdateResult>("ks_update_image", {
        namespace,
        deployment: sel.name,
        container: selContainer,
        image: rev.image,
      });
      notifications.show({
        color: r.ok ? "green" : "red",
        title: r.ok ? "回滚已提交" : "回滚失败",
        message: `${r.newImage}（revision ${r.revision}）`,
      });
      void load({ silent: true });
      void loadRevisions(sel.name);
    } catch (e) {
      notifications.show({ color: "red", title: "回滚失败", message: String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["状态", "部署", "别名", "容器", "端口", "镜像", "就绪", "版本"].map(esc).join(","),
      ...filtered.map((d) => {
        return [d.status.label, d.name, d.alias ?? "", d.containers.join("/"), (d.ports ?? []).join("/"), d.image, d.status.detail.split(" · ")[0], d.revision].map(esc).join(",");
      }),
    ].join("\r\n");
    const blob = new Blob(["\ufeff" + rows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deployments-status-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  /** 列表「修改」：弹框与创建 Deployment 同款表单 */
  const beginEdit = useCallback(async (d: DeployInfo) => {
    setSel(d);
    setEditOpen(true);
    setEditLoading(true);
    setEditPreviewYaml("");
    setEditForm({
      ...EMPTY_DEPLOY_FORM,
      name: d.name,
      image: d.image || "",
      port: d.ports?.[0] || 8080,
      container: d.containers?.[0] || "container-main",
    });
    if (namespace) void loadCms();
    try {
      const info = await invoke<DeployEditInfo>("ks_get_deployment_edit", {
        namespace,
        deployment: d.name,
      });
      setEditForm({
        name: info.name,
        alias: info.alias || info.name,
        image: info.image,
        port: info.port || 8080,
        replicas: info.replicas ?? 1,
        healthPath: info.healthPath || "/actuator/health",
        envs: (info.envs ?? []).join("\n"),
        configMap: info.configMap,
        container: info.container || d.containers?.[0] || "container-main",
      });
    } catch (e) {
      notifications.show({ color: "yellow", message: `读取部署详情失败，已用列表数据预填：${e}` });
    } finally {
      setEditLoading(false);
    }
  }, [namespace, loadCms]);

  return (
    <>
      <Stack gap="md" className="ks-publish-panel">
        <Card shadow="sm" radius="md" withBorder>
          <Group justify="space-between" mb="md" wrap="nowrap">
            <Group gap={8} wrap="wrap">
              <ContainerIcon size={20} color="#329dce" />
              <Title order={4}>KubeSphere 镜像发布</Title>
              {connecting && <Loader size={15} />}
              {connecting && (
                <Text size="xs" c="dimmed">
                  {statusText || "正在连接…"}
                </Text>
              )}
              {connected && selectedEnv && (
                <Badge color="green" variant="light" size="xs">已连接 {selectedEnv.name}</Badge>
              )}
              {!connected && !connecting && statusText && <Text size="xs" c="red">{statusText}</Text>}
            </Group>
          </Group>
          <SimpleGrid cols={connected ? 2 : 1} spacing="md" className="ks-form-2col">
            <Select
              label="环境"
              description="KubeSphere 控制台环境"
              data={envs.map((env) => ({ value: env.id, label: env.name || env.id }))}
              value={envId}
              onChange={switchEnv}
              placeholder={envs.length ? "选择环境" : "请先在设置中添加环境"}
              disabled={connecting || envs.length === 0}
            />
            {connected && (
              <Select
                label="命名空间"
                description="当前集群命名空间"
                data={namespaces}
                value={namespace}
                onChange={(v) => setNamespace(v)}
                searchable
                clearable
                placeholder="选择命名空间"
              />
            )}
          </SimpleGrid>
        </Card>

        {connected && (
          <Tabs value={mainTab} onChange={setMainTab} keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="deploy">部署与发布</Tabs.Tab>
              <Tabs.Tab value="config">ConfigMap</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="deploy">
              <Stack gap="md">
            <Card shadow="sm" radius="md" withBorder>
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
                  <Group gap={8}>
                    <Title order={5}>📋 全部部署状态</Title>
                    {lastRefresh && <Text size="xs" c="dimmed">最近刷新 {lastRefresh}</Text>}
                  </Group>
                  <Group gap="sm" wrap="wrap">
                    <Checkbox label="自动刷新" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} size="xs" />
                    <Select
                      value={refreshSec}
                      onChange={(v) => setRefreshSec(v ?? "30")}
                      data={["10", "30", "60"]}
                      w={76}
                      size="xs"
                      disabled={!autoRefresh}
                    />
                    <Button size="xs" variant="default" leftSection={<RefreshCw size={13} />} loading={loading} onClick={() => void load({ silent: false, withCms: mainTab === "config" })}>
                      刷新
                    </Button>
                    <Button size="xs" variant="default" leftSection={<Plus size={13} />} onClick={() => setCreateOpen(true)}>
                      创建部署
                    </Button>
                    <Button size="xs" variant="default" leftSection={<Download size={13} />} onClick={exportCsv}>
                      导出 CSV
                    </Button>
                    <Autocomplete
                      size="xs"
                      w={180}
                      placeholder="分支（可点选历史）"
                      data={batchBranchSuggestions}
                      value={batchBranch}
                      onChange={setBatchBranch}
                      disabled={batchRunning}
                      aria-label="批量打包目标分支"
                    />
                    <Button
                      size="xs"
                      variant="filled"
                      color="blue"
                      leftSection={<Package size={13} />}
                      disabled={
                        checkedNames.size === 0
                        || batchRunning
                        || !batchBranch.trim()
                      }
                      loading={batchRunning}
                      onClick={beginBatchPack}
                    >
                      批量打包并发布{checkedNames.size > 0 ? ` (${checkedNames.size})` : ""}
                    </Button>
                  </Group>
                </Group>
                {checkedNames.size > 0 && (
                  <Text size="xs" c="blue">
                    已选 {checkedNames.size} 个部署
                    {batchBranch.trim()
                      ? ` · 分支 ${batchBranch.trim()}`
                      : " · 请输入或点选历史分支"}
                    {" · "}
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      onClick={() => setCheckedNames(new Set())}
                    >
                      清空选择
                    </Button>
                  </Text>
                )}
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                  <Select
                    label="部署"
                    placeholder="全部部署"
                    data={deployOptions}
                    value={filterDeploy}
                    onChange={(v) => {
                      setFilterDeploy(v);
                      if (v) {
                        const hit = deploys.find((d) => d.name === v);
                        if (hit) setSel(hit);
                      }
                    }}
                    searchable
                    clearable
                    nothingFoundMessage="无匹配部署"
                    size="sm"
                  />
                  <Select
                    label="状态"
                    placeholder="全部状态"
                    data={statusOptions}
                    value={filterStatus}
                    onChange={(v) => setFilterStatus(v ?? "all")}
                    allowDeselect={false}
                    size="sm"
                  />
                  <TextInput
                    label="镜像"
                    type="search"
                    placeholder="按镜像地址 / tag 过滤"
                    leftSection={<Search size={14} />}
                    value={filterImage}
                    onChange={(e) => setFilterImage(e.currentTarget.value)}
                    size="sm"
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </SimpleGrid>
              </Stack>
              <ScrollArea className="ks-deploys-scroll" mah="min(72vh, 720px)" type="auto" offsetScrollbars mt="sm">
                <Table striped highlightOnHover verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={36}>
                        <Checkbox
                          aria-label="全选当前页"
                          checked={pageAllChecked}
                          indeterminate={pageSomeChecked}
                          onChange={(e) => togglePageChecks(e.currentTarget.checked)}
                        />
                      </Table.Th>
                      <Table.Th>状态</Table.Th><Table.Th>部署</Table.Th><Table.Th>别名</Table.Th><Table.Th>容器</Table.Th>
                      <Table.Th>端口</Table.Th><Table.Th>镜像地址</Table.Th><Table.Th>就绪</Table.Th><Table.Th>版本</Table.Th>
                      <Table.Th>操作</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {pageRows.length === 0 && (
                      <Table.Tr><Table.Td colSpan={10} align="center" c="dimmed">没有匹配的部署</Table.Td></Table.Tr>
                    )}
                    {pageRows.map((d) => (
                      <DeployRow
                        key={d.name}
                        d={d}
                        selected={sel?.name === d.name}
                        checked={checkedNames.has(d.name)}
                        onSelect={setSel}
                        onToggleCheck={toggleDeployCheck}
                        onEdit={beginEdit}
                      />
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
              <div className="ks-list-pager">
                <Text size="sm" c="dimmed">
                  共 {filtered.length} 条
                  {filterDeploy || (filterStatus && filterStatus !== "all") || filterImage.trim()
                    ? `（筛选自 ${deploys.length}）`
                    : ""}
                  {filtered.length > 0
                    ? ` · 第 ${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filtered.length)} 条`
                    : ""}
                </Text>
                <Group gap="sm" wrap="nowrap">
                  <Select
                    size="xs"
                    w={100}
                    data={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
                    value={String(pageSize)}
                    onChange={(v) => setPageSize(Number(v || 20))}
                    allowDeselect={false}
                  />
                  <Pagination
                    value={safePage}
                    onChange={setPage}
                    total={totalPages}
                    size="sm"
                    disabled={filtered.length === 0}
                  />
                </Group>
              </div>
            </Card>

            {sel && (
              <Card shadow="sm" radius="md" withBorder>
                <Group justify="space-between" mb="xs">
                  <Group gap={8}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[sel.status.state] ?? "#9aa5b8", display: "inline-block" }} />
                    <Title order={5}>{sel.name}</Title>
                    <Badge color={STATUS_COLOR[sel.status.state] ?? "gray"} variant="light">{sel.status.label}</Badge>
                    <Text size="sm" c="dimmed">
                      {sel.status.detail}{sel.status.old}
                    </Text>
                  </Group>
                  <Button size="xs" variant="light" leftSection={<Pencil size={13} />} onClick={() => beginEdit(sel)}>
                    修改镜像
                  </Button>
                </Group>
                <Group align="flex-start" gap="lg" wrap="wrap">
                  <Box style={{ flex: "1 1 520px", minWidth: 0, maxWidth: "100%" }}>
                    <Text size="sm" fw={600} c="blue">🆕 新版本（当前 revision）</Text>
                    {sel.pods.new.length === 0 && <Text size="xs" c="dimmed">暂无</Text>}
                    {sel.pods.new.map((p) => (
                      <Group key={p.name} gap={8} my={4} wrap="nowrap">
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.state] ?? "#9aa5b8", display: "inline-block" }} />
                        <Text size="xs" style={{ fontFamily: "monospace" }}>{p.name}</Text>
                        <Text size="xs" c="dimmed">{p.state === "running" ? `就绪 ${p.ready}/${p.total}` : (p.reason ?? p.state ?? p.phase)}{p.restarts ? ` · 重启${p.restarts}次` : ""}</Text>
                        <Text size="xs" c="dimmed">{fmtTime(p.startTime)}</Text>
                      </Group>
                    ))}
                    <Text size="sm" fw={600} c="dimmed" mt="sm">📦 旧版本</Text>
                    {sel.pods.old.length === 0 && <Text size="xs" c="dimmed">无</Text>}
                    {sel.pods.old.map((p) => (
                      <Group key={p.name} gap={8} my={4} wrap="nowrap" opacity={0.6}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.state] ?? "#9aa5b8", display: "inline-block" }} />
                        <Text size="xs" style={{ fontFamily: "monospace" }}>{p.name}</Text>
                        <Text size="xs" c="dimmed">{p.state === "running" ? `就绪 ${p.ready}/${p.total}` : (p.reason ?? p.state ?? p.phase)}{p.restarts ? ` · 重启${p.restarts}次` : ""}</Text>
                      </Group>
                    ))}
                    <Group justify="space-between" mt="md" mb={6}>
                      <Group gap={6}>
                        <History size={14} />
                        <Text size="sm" fw={600}>历史版本（ReplicaSet）</Text>
                        {revsLoading && <Loader size={12} />}
                      </Group>
                      <Button size="xs" variant="subtle" onClick={() => void loadRevisions()}>
                        刷新历史
                      </Button>
                    </Group>
                    {revisions.length === 0 && !revsLoading && (
                      <Text size="xs" c="dimmed">暂无历史版本</Text>
                    )}
                    {revisions.length > 0 && (
                      <Stack gap="xs">
                      <Box className="ks-revisions-scroll">
                        <Table className="ks-revisions-table" verticalSpacing="xs" stickyHeader stickyHeaderOffset={0}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th className="ks-rev-col-rev">Revision</Table.Th>
                              <Table.Th className="ks-rev-col-image">镜像地址</Table.Th>
                              <Table.Th className="ks-rev-col-ready">就绪</Table.Th>
                              <Table.Th className="ks-rev-col-dur">运行时长</Table.Th>
                              <Table.Th className="ks-rev-col-time">创建时间</Table.Th>
                              <Table.Th className="ks-rev-col-act">操作</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {revPageRows.map((rev) => (
                                <Table.Tr key={rev.revision} className={rev.isCurrent ? "ks-rev-current" : undefined}>
                                  <Table.Td className="ks-rev-col-rev">
                                    <Group gap={6} wrap="nowrap">
                                      <Text size="xs" fw={700} c={rev.isCurrent ? "blue.3" : undefined}>{rev.revision}</Text>
                                      {rev.isCurrent && (
                                        <Badge size="sm" color="cyan" variant="filled" radius="sm">当前</Badge>
                                      )}
                                    </Group>
                                  </Table.Td>
                                  <Table.Td className="ks-rev-col-image">
                                    {rev.isCurrent ? (
                                      <span className="ks-rev-current-tag ks-rev-image" title={rev.image || undefined}>
                                        {rev.image || "—"}
                                      </span>
                                    ) : (
                                      <span className="ks-rev-image" title={rev.image || undefined}>
                                        {rev.image || "—"}
                                      </span>
                                    )}
                                  </Table.Td>
                                  <Table.Td className="ks-rev-col-ready">
                                    <Text size="xs">{rev.ready}/{rev.replicas}</Text>
                                  </Table.Td>
                                  <Table.Td className="ks-rev-col-dur">
                                    {(() => {
                                      const dur = revDurationMap.get(rev.revision);
                                      if (!dur) return <Text size="xs" c="dimmed">—</Text>;
                                      return (
                                        <Text size="xs" c={dur.ongoing ? "blue.3" : "dimmed"} fw={dur.ongoing ? 600 : undefined}>
                                          {dur.label}
                                          {dur.ongoing ? " · 进行中" : ""}
                                        </Text>
                                      );
                                    })()}
                                  </Table.Td>
                                  <Table.Td className="ks-rev-col-time">
                                    <Text size="xs" c="dimmed">{fmtTime(rev.createdAt)}</Text>
                                  </Table.Td>
                                  <Table.Td className="ks-rev-col-act">
                                    {rev.isCurrent ? (
                                      <Text size="xs" c="dimmed">—</Text>
                                    ) : (
                                      <Group gap={4} wrap="nowrap">
                                        <Button
                                          size="compact-xs"
                                          variant="light"
                                          onClick={() => setImage(rev.image)}
                                        >
                                          填入
                                        </Button>
                                        <Button
                                          size="compact-xs"
                                          variant="light"
                                          color="orange"
                                          loading={submitting}
                                          onClick={() => void rollback(rev)}
                                        >
                                          回滚
                                        </Button>
                                      </Group>
                                    )}
                                  </Table.Td>
                                </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </Box>
                      <div className="ks-list-pager">
                        <Text size="xs" c="dimmed">
                          共 {revisions.length} 个 revision
                          {revisions.length > 0
                            ? ` · 第 ${(revSafePage - 1) * revPageSize + 1}-${Math.min(revSafePage * revPageSize, revisions.length)} 条`
                            : ""}
                        </Text>
                        <Group gap="sm" wrap="nowrap">
                          <Select
                            size="xs"
                            w={96}
                            data={REV_PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
                            value={String(revPageSize)}
                            onChange={(v) => setRevPageSize(Number(v || 5))}
                            allowDeselect={false}
                          />
                          <Pagination
                            value={revSafePage}
                            onChange={setRevPage}
                            total={revTotalPages}
                            size="sm"
                            disabled={revisions.length === 0}
                          />
                        </Group>
                      </div>
                      </Stack>
                    )}
                  </Box>
                  <Divider orientation="vertical" />
                  <Box style={{ flex: 1, minWidth: 280 }}>
                    <Title order={6} mb="xs">🚀 修改镜像并发布</Title>
                    <Text size="xs" c="dimmed" mb={4}>容器：{selContainer || "-"}</Text>
                    <TextInput
                      placeholder="dockerhub.kubekey.local/项目/镜像:tag"
                      value={image}
                      onChange={(e) => setImage(e.currentTarget.value)}
                      mb="sm"
                    />
                    <Button
                      fullWidth
                      leftSection={<Rocket size={15} />}
                      loading={submitting}
                      onClick={() => void submitImageOnly()}
                    >
                      提交变更
                    </Button>
                  </Box>
                </Group>
              </Card>
            )}
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="config" style={{ minHeight: 400 }}>
        <Card shadow="sm" radius="md" withBorder>
          <Group justify="space-between" mb="xs">
            <Group gap={8}>
              <Title order={5}>🗂 ConfigMap</Title>
              <Text size="xs" c="dimmed">共 {cms.length} 个</Text>
            </Group>
            <Group gap="sm">
              <Button size="xs" variant="default" leftSection={<RefreshCw size={13} />} loading={cmLoading} onClick={() => void loadCms()}>
                刷新
              </Button>
              <Button size="xs" variant="default" leftSection={<Plus size={13} />} onClick={() => { setCmMode("form"); setCmForm({ name: "", data: "" }); setCmYaml(""); setCmPreview(""); setCmOpen(true); }}>
                新建 ConfigMap
              </Button>
            </Group>
          </Group>
          <ScrollArea className="ks-cms-scroll" mah="min(68vh, 640px)" type="auto" offsetScrollbars>
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr><Table.Th>名称</Table.Th><Table.Th>别名</Table.Th><Table.Th>键数</Table.Th><Table.Th>键</Table.Th><Table.Th>操作</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {cmPageRows.length === 0 && <Table.Tr><Table.Td colSpan={5} align="center" c="dimmed">暂无 ConfigMap</Table.Td></Table.Tr>}
                {cmPageRows.map((cm) => (
                  <Table.Tr key={cm.name}>
                    <Table.Td fw={600}>{cm.name}</Table.Td>
                    <Table.Td>{cm.alias || "-"}</Table.Td>
                    <Table.Td>{cm.dataSize}</Table.Td>
                    <Table.Td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <Tooltip label={cm.keys.join(", ")}><span>{cm.keys.join(", ")}</span></Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Button size="xs" variant="subtle" color="blue" leftSection={<Copy size={12} />} onClick={() => void copyCmFrom(cm)}>
                        复制创建
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <div className="ks-list-pager">
            <Text size="sm" c="dimmed">
              共 {cms.length} 条
              {cms.length > 0
                ? ` · 第 ${(cmSafePage - 1) * cmPageSize + 1}-${Math.min(cmSafePage * cmPageSize, cms.length)} 条`
                : ""}
            </Text>
            <Group gap="sm" wrap="nowrap">
              <Select
                size="xs"
                w={100}
                data={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
                value={String(cmPageSize)}
                onChange={(v) => setCmPageSize(Number(v || 20))}
                allowDeselect={false}
              />
              <Pagination
                value={cmSafePage}
                onChange={setCmPage}
                total={cmTotalPages}
                size="sm"
                disabled={cms.length === 0}
              />
            </Group>
          </div>
        </Card>
            </Tabs.Panel>
          </Tabs>
        )}

      </Stack>
      <Modal
        opened={editOpen}
        onClose={() => { setEditOpen(false); setEditPreviewYaml(""); }}
        title={editForm.name ? `修改 Deployment · ${editForm.name}` : "修改 Deployment"}
        size="xl"
        centered
        styles={{ content: { maxHeight: "92vh" }, body: { maxHeight: "84vh", overflow: "auto" } }}
      >
        <Stack className="ks-form-modal">
          {editLoading && (
            <Group gap={8}>
              <Loader size={14} />
              <Text size="xs" c="dimmed">正在读取部署详情…</Text>
            </Group>
          )}
          <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
            <TextInput
              label="部署名称"
              description="修改时不可更改"
              value={editForm.name}
              readOnly
              required
            />
            <TextInput
              label="别名（显示名）"
              description="KubeSphere 控制台显示名；默认跟随部署名称，可改"
              placeholder="默认与部署名称相同"
              value={editForm.alias}
              onChange={(e) => setEditForm({ ...editForm, alias: e.currentTarget.value })}
            />
          </SimpleGrid>
          <TextInput
            label="镜像地址"
            placeholder="dockerhub.kubekey.local/tksy-admin/my-service:v1.0.0"
            value={editForm.image}
            onChange={(e) => setEditForm({ ...editForm, image: e.currentTarget.value })}
            required
            data-autofocus
          />
          <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
            <NumberInput
              label="容器端口"
              description="写入 containerPort，并作为三探针探测端口"
              value={editForm.port}
              onChange={(v) => setEditForm({ ...editForm, port: typeof v === "number" ? v : 8080 })}
              min={1}
              max={65535}
              required
            />
            <NumberInput
              label="副本数"
              description="Deployment spec.replicas"
              value={editForm.replicas}
              onChange={(v) => setEditForm({ ...editForm, replicas: typeof v === "number" ? v : 1 })}
              min={0}
              max={100}
            />
          </SimpleGrid>
          <Autocomplete
            label="健康检查路径"
            description="写入 liveness / readiness / startup 三探针；可下拉选择或手动输入"
            placeholder="/actuator/health"
            data={[...HEALTH_PATH_OPTIONS]}
            filter={({ options }) => options}
            value={editForm.healthPath}
            onChange={(v) => setEditForm({ ...editForm, healthPath: v })}
            required
          />
          <Select
            label="引用配置字典"
            description="对齐 KubeSphere：读取该 ConfigMap 全部 key，逐项生成 env.valueFrom.configMapKeyRef"
            placeholder={cms.length ? "选择当前命名空间的 ConfigMap" : "当前命名空间暂无 ConfigMap"}
            data={cms.map((cm) => ({
              value: cm.name,
              label: cm.alias ? `${cm.name}（${cm.alias} · ${cm.dataSize} keys）` : `${cm.name}（${cm.dataSize} keys）`,
            }))}
            value={editForm.configMap}
            onChange={(v) => setEditForm({ ...editForm, configMap: v })}
            searchable
            clearable
            disabled={cms.length === 0}
            nothingFoundMessage="无匹配配置字典"
          />
          <Textarea
            label="环境变量（可选，K=V 每行一个，可与配置字典叠加）"
            placeholder={"TZ=Asia/Shanghai\nSPRING_DATA_REDIS_SENTINEL_MASTER=mymaster"}
            value={editForm.envs}
            onChange={(e) => setEditForm({ ...editForm, envs: e.currentTarget.value })}
            minRows={4}
            styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
            spellCheck={false}
          />
          <Text size="xs" c="dimmed">提交后将 merge-patch 更新 Deployment（镜像/端口/副本/探针/环境变量/别名），并触发滚动发布</Text>
          <Group justify="flex-end">
            <Button size="xs" variant="default" loading={submitting || editLoading} onClick={() => void doEditPreview()}>
              预览 YAML
            </Button>
            <Button size="xs" variant="default" onClick={() => { setEditOpen(false); setEditPreviewYaml(""); }} disabled={submitting}>
              取消
            </Button>
            <Button
              size="xs"
              leftSection={<Rocket size={14} />}
              loading={submitting || editLoading}
              onClick={() => void submit()}
            >
              提交变更
            </Button>
          </Group>
          {editPreviewYaml && (
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" fw={600} c="dimmed">预览 Deployment YAML（模板结构）</Text>
                <Button size="xs" variant="default" onClick={() => void copyText(editPreviewYaml)}>
                  📋 复制
                </Button>
              </Group>
              <Textarea
                value={editPreviewYaml}
                readOnly
                minRows={16}
                className="ks-preview-textarea"
                styles={{ input: { fontFamily: "monospace", fontSize: 12, minHeight: "40vh", height: "40vh" } }}
              />
            </Stack>
          )}
        </Stack>
      </Modal>
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="创建 Deployment"
        size="xl"
        centered
        styles={{ content: { maxHeight: "92vh" }, body: { maxHeight: "84vh", overflow: "auto" } }}
      >
        <Stack className="ks-form-modal">
          <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
            <TextInput
              label="部署名称"
              description="须小写字母/数字/'-'/'.'（会自动转小写）"
              placeholder="klcj-test-service"
              value={createForm.name}
              onChange={(e) => {
                const name = e.currentTarget.value.toLowerCase();
                setCreateForm((prev) => ({
                  ...prev,
                  name,
                  // 别名未手改（空或仍等于旧部署名）时跟随；后端空别名也会落成部署名
                  alias: !prev.alias.trim() || prev.alias === prev.name ? name : prev.alias,
                }));
              }}
              error={createForm.name.trim() && !isRfc1123Name(createForm.name) ? "名称不符合 K8s 规范" : undefined}
              required
            />
            <TextInput
              label="别名（显示名）"
              description="KubeSphere 控制台显示名；默认跟随部署名称，可改"
              placeholder="默认与部署名称相同"
              value={createForm.alias}
              onChange={(e) => setCreateForm({ ...createForm, alias: e.currentTarget.value })}
            />
          </SimpleGrid>
          <TextInput
            label="镜像地址"
            placeholder="dockerhub.kubekey.local/tksy-admin/my-service:v1.0.0"
            value={createForm.image}
            onChange={(e) => setCreateForm({ ...createForm, image: e.currentTarget.value })}
            required
          />
          <SimpleGrid cols={2} spacing="sm" className="ks-form-2col">
            <NumberInput
              label="容器端口"
              description="写入 containerPort，并作为三探针探测端口"
              value={createForm.port}
              onChange={(v) => setCreateForm({ ...createForm, port: typeof v === "number" ? v : 8080 })}
              min={1}
              max={65535}
              required
            />
            <NumberInput
              label="副本数"
              description="Deployment spec.replicas"
              value={createForm.replicas}
              onChange={(v) => setCreateForm({ ...createForm, replicas: typeof v === "number" ? v : 1 })}
              min={0}
              max={100}
            />
          </SimpleGrid>
          <Autocomplete
            label="健康检查路径"
            description="写入 liveness / readiness / startup 三探针；可下拉选择或手动输入"
            placeholder="/actuator/health"
            data={[...HEALTH_PATH_OPTIONS]}
            filter={({ options }) => options}
            value={createForm.healthPath}
            onChange={(v) => setCreateForm({ ...createForm, healthPath: v })}
            required
          />
          <Select
            label="引用配置字典"
            description="对齐 KubeSphere：读取该 ConfigMap 全部 key，逐项生成 env.valueFrom.configMapKeyRef"
            placeholder={cms.length ? "选择当前命名空间的 ConfigMap" : "当前命名空间暂无 ConfigMap"}
            data={cms.map((cm) => ({
              value: cm.name,
              label: cm.alias ? `${cm.name}（${cm.alias} · ${cm.dataSize} keys）` : `${cm.name}（${cm.dataSize} keys）`,
            }))}
            value={createForm.configMap}
            onChange={(v) => setCreateForm({ ...createForm, configMap: v })}
            searchable
            clearable
            disabled={cms.length === 0}
            nothingFoundMessage="无匹配配置字典"
          />
          <Textarea
            label="环境变量（可选，K=V 每行一个，可与配置字典叠加）"
            placeholder={"TZ=Asia/Shanghai\nSPRING_DATA_REDIS_SENTINEL_MASTER=mymaster"}
            value={createForm.envs}
            onChange={(e) => setCreateForm({ ...createForm, envs: e.currentTarget.value })}
            minRows={4}
            styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
            spellCheck={false}
          />
          <Text size="xs" c="dimmed">完整 Deployment（探针/volumes/滚动策略等）由后端模板拼接；部署名已存在会返回 409</Text>
          <Group justify="flex-end">
            <Button size="xs" variant="default" loading={createBusy} onClick={() => void doPreview()}>
              预览 YAML
            </Button>
            <Button size="xs" variant="default" loading={createBusy} onClick={() => void doCreate(true)}>
              校验 (dryRun)
            </Button>
            <Button size="xs" loading={createBusy} onClick={() => void doCreate(false)}>
              创建
            </Button>
          </Group>
          {previewYaml && (
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" fw={600} c="dimmed">生成的 Deployment YAML</Text>
                <Button size="xs" variant="default" onClick={() => void copyYaml()}>
                  📋 复制
                </Button>
              </Group>
              <Textarea
                value={previewYaml}
                readOnly
                minRows={22}
                className="ks-preview-textarea"
                styles={{ input: { fontFamily: "monospace", fontSize: 12, minHeight: "50vh", height: "50vh" } }}
              />
            </Stack>
          )}
        </Stack>
      </Modal>
      <Modal
        opened={cmOpen}
        onClose={() => setCmOpen(false)}
        title="创建 ConfigMap"
        size="xl"
        centered
      >
        <Stack gap="sm" className="ks-form-modal">
          <SegmentedControl
            value={cmMode}
            onChange={(v) => {
              const next = v as "form" | "yaml";
              setCmMode(next);
              setCmPreview("");
              // 切到 YAML：表单有内容且 YAML 为空时，自动生成，避免空白编辑器
              if (next === "yaml" && !cmYaml.trim() && cmForm.name.trim()) {
                void (async () => {
                  setCmBusy(true);
                  try {
                    const yaml = await invoke<string>("ks_preview_configmap", {
                      namespace,
                      name: cmForm.name.trim(),
                      data: cmForm.data.split("\n").map((l) => l.trim()).filter(Boolean),
                    });
                    setCmYaml(yaml);
                  } catch (e) {
                    notifications.show({ color: "red", title: "生成 YAML 失败", message: String(e) });
                  } finally {
                    setCmBusy(false);
                  }
                })();
              }
            }}
            data={[{ value: "form", label: "表单（必传项）" }, { value: "yaml", label: "YAML" }]}
            size="xs"
          />
          {cmMode === "form" ? (
            <>
              <TextInput
                label="名称"
                description="须小写字母/数字/'-'/'.'（会自动转小写）；若已有 SW_AGENT_NAME 则随名称同步"
                placeholder="my-config"
                value={cmForm.name}
                onChange={(e) => {
                  const name = e.currentTarget.value.toLowerCase();
                  setCmForm((prev) => ({
                    name,
                    data: syncSwAgentNameIfPresent(prev.data, name),
                  }));
                }}
                error={cmForm.name.trim() && !isRfc1123Name(cmForm.name) ? "名称不符合 K8s 规范" : undefined}
                required
              />
              <Textarea
                label="键值对（K=V 每行一个）"
                description="仅当已有 SW_AGENT_NAME 时改名称会同步其值；没有则不会自动创建"
                placeholder={"TZ=Asia/Shanghai\nSPRING_PROFILES_ACTIVE=dev"}
                value={cmForm.data}
                onChange={(e) => setCmForm({ ...cmForm, data: e.currentTarget.value })}
                minRows={14}
                autosize
                maxRows={24}
                styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
                spellCheck={false}
              />
              <Group justify="flex-end">
                <Button size="xs" variant="default" loading={cmBusy} onClick={() => void doCmPreview()}>预览 YAML</Button>
                <Button size="xs" variant="default" loading={cmBusy} onClick={() => void doCmCreate(true)}>校验 (dryRun)</Button>
                <Button size="xs" loading={cmBusy} onClick={() => void doCmCreate(false)}>创建</Button>
              </Group>
              {cmPreview && (
                <Stack>
                  <Group justify="space-between">
                    <Text size="xs" fw={600} c="dimmed">生成的 ConfigMap YAML</Text>
                    <Button size="xs" variant="default" onClick={() => void copyText(cmPreview)}>📋 复制</Button>
                  </Group>
                  <Textarea value={cmPreview} readOnly minRows={10} autosize maxRows={20} className="ks-preview-textarea" styles={{ input: { fontFamily: "monospace", fontSize: 12 } }} />
                </Stack>
              )}
            </>
          ) : (
            <>
              <Text size="xs" c="dimmed">
                {cmBusy ? "正在从表单生成 YAML…" : "编辑完整 ConfigMap YAML（apiVersion: v1 / kind: ConfigMap）"}
              </Text>
              <Textarea
                value={cmYaml}
                onChange={(e) => setCmYaml(e.currentTarget.value)}
                placeholder={"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: my-config\ndata:\n  KEY: value"}
                minRows={16}
                autosize
                maxRows={28}
                styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
                spellCheck={false}
              />
              <Group justify="flex-end">
                <Button size="xs" variant="default" loading={cmBusy} onClick={() => void doCmCreate(true)}>校验 (dryRun)</Button>
                <Button size="xs" loading={cmBusy} onClick={() => void doCmCreate(false)}>创建</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
      <KsBatchConfirmModal
        opened={batchConfirmOpen}
        meta={batchMeta}
        concurrencyPref={batchConcurrencyPref}
        recommendedConcurrency={recommendKsBatchConcurrency({
          itemCount: batchMeta?.deployNames.length ?? selectedDeploys.length,
        })}
        cpuCores={detectCpuCores()}
        onConcurrencyPrefChange={(n) => {
          const pref = (n === 0 || n === 1 || n === 2 || n === 3 || n === 4
            ? n
            : KS_BATCH_CONCURRENCY_AUTO) as KsBatchConcurrencyPref;
          setBatchConcurrencyPref(pref);
          saveKsBatchConcurrencyPref(pref);
        }}
        onClose={() => setBatchConfirmOpen(false)}
        onStart={() => void startBatchPack()}
      />
      <KsBatchProgressModal
        opened={batchOpen}
        meta={batchMeta}
        running={batchRunning}
        progress={batchProgress}
        message={batchMessage}
        log={batchLog}
        summary={batchSummary}
        onClose={() => setBatchOpen(false)}
        onCancelBuild={() => void invoke("cancel_build").catch(() => {})}
      />
    </>
  );
}
