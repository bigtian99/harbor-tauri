import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Card, Title, Text, TextInput, Button, Select, Table, Badge, Modal, Textarea, NumberInput, SegmentedControl, Tooltip,
  Checkbox, Group, Stack, Divider, ScrollArea, Box, Loader, Pagination, SimpleGrid, Tabs, Autocomplete, ActionIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { RefreshCw, Download, Rocket, Search, History, Plus, Copy, Pencil, Package, ScrollText, Maximize2, Minimize2, ChevronDown, ChevronUp } from "lucide-react";
import type { HarborConfig, KsPublishMap } from "../types";
import { isTauriRuntime } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "../utils/ksEnvironments";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { KubeSphereIcon } from "./icons/BrandIcons";
import { panelAccentButtonStyles, panelFieldStyles, panelPaperStyles, panelPrimaryButtonStyles } from "../theme/panelStyles";
import {
  KsBatchConfirmModal,
  KsBatchProgressModal,
  type KsBatchConfirmValues,
  type KsBatchMeta,
  type KsBatchSummary,
} from "./KsBatchPackModal";
import {
  KsBatchCloneConfirmModal,
  type KsBatchCloneConfirmMeta,
  type KsBatchCloneConfirmValues,
} from "./KsBatchCloneModal";
import {
  detectCpuCores,
  KS_BATCH_CONCURRENCY_AUTO,
  loadKsBatchConcurrencyPref,
  loadKsBatchNpmScriptPref,
  prewarmKsBatchRepoIndex,
  recommendKsBatchConcurrency,
  resolveKsBatchDeployRoles,
  runKsBatchPackPublish,
  saveKsBatchConcurrencyPref,
  saveKsBatchNpmScriptPref,
  type KsBatchConcurrencyPref,
} from "../utils/ksBatchPackPublish";
import { runKsBatchCloneToEnv } from "../utils/ksBatchCloneDeploy";
import {
  defaultKsBatchBranch,
  loadKsBatchBranchHistory,
  rememberKsBatchBranch,
} from "../utils/ksBatchBranchHistory";
import {
  buildKsBatchBranchOptionGroups,
  loadKsBatchGitBranches,
} from "../utils/ksBatchGitBranches";
import {
  appendBuildProgressLog,
  normalizeBatchBranchInput,
  scaleBatchBuildPercent,
} from "../utils/buildProgressLog";
import {
  buildPodLogLines,
  findNextLevelIndex,
  findPrevLevelIndex,
  POD_LOG_LEVEL_LABEL,
  POD_LOG_LEVELS,
  type PodLogLevel,
} from "../utils/podLogLevels";
import {
  type DeployInfo,
  type DeployEditInfo,
  type DeployRevision,
  type ConfigMapInfo,
  type UpdateResult,
  EMPTY_DEPLOY_FORM,
  BAD_STATES,
  PAGE_SIZE_OPTIONS,
  REV_PAGE_SIZE_OPTIONS,
  HEALTH_PATH_OPTIONS,
  STATUS_DOT,
  STATUS_COLOR,
} from "./ksPublish/types";
import {
  isRfc1123Name,
  syncSwAgentNameIfPresent,
  fmtTime,
  deployListFingerprint,
  buildRevisionDurationMap,
} from "./ksPublish/utils";
import { DeployRow } from "./ksPublish/DeployRow";

function KsRefreshIcon({ size = 13, spinning }: { size?: number; spinning?: boolean }) {
  return <RefreshCw size={size} className={spinning ? "ks-refresh-spin" : undefined} />;
}

export function KsPublishPanel({
  config,
  configReady = true,
  onLastEnvChange,
  onPublishMapsChange,
}: {
  config: HarborConfig;
  /** 配置已从磁盘加载完成；false 时不要自动连接，避免 reload 后空配置误报「未配置环境」 */
  configReady?: boolean;
  onLastEnvChange?: (id: string) => void;
  /** 批量复制后写回发布映射 */
  onPublishMapsChange?: (maps: KsPublishMap[]) => void;
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
  const [batchBranch, setBatchBranch] = useState("");
  const [branchHistory, setBranchHistory] = useState(() => loadKsBatchBranchHistory());
  const [batchGitBranches, setBatchGitBranches] = useState<string[]>([]);
  const [batchGitRepoCount, setBatchGitRepoCount] = useState(0);
  const [batchGitBranchesLoading, setBatchGitBranchesLoading] = useState(false);
  const [batchGitBranchesError, setBatchGitBranchesError] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchMeta, setBatchMeta] = useState<KsBatchMeta | null>(null);
  const [batchSummary, setBatchSummary] = useState<KsBatchSummary | null>(null);
  const [batchConcurrencyPref, setBatchConcurrencyPref] = useState<KsBatchConcurrencyPref>(
    () => loadKsBatchConcurrencyPref(),
  );
  const [batchNpmScriptPref, setBatchNpmScriptPref] = useState(() => loadKsBatchNpmScriptPref());
  const [batchRunning, setBatchRunning] = useState(false);
  const [cloneConfirmOpen, setCloneConfirmOpen] = useState(false);
  const [cloneMeta, setCloneMeta] = useState<KsBatchCloneConfirmMeta | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneRunning, setCloneRunning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState(0);
  const [cloneMessage, setCloneMessage] = useState("");
  const [cloneLog, setCloneLog] = useState("");
  const [cloneSummary, setCloneSummary] = useState<KsBatchSummary | null>(null);
  const [cloneProgressMeta, setCloneProgressMeta] = useState<KsBatchMeta | null>(null);
  const [batchLog, setBatchLog] = useState("");
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchMessage, setBatchMessage] = useState("");
  /** 当前批量项标题，用于与 build-progress 子进度拼接 */
  const batchStepLabelRef = useRef("");
  const batchItemIndexRef = useRef(0);
  const batchItemTotalRef = useRef(1);
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
  const [podLogOpen, setPodLogOpen] = useState(false);
  const [podLogPod, setPodLogPod] = useState("");
  const [podLogContainer, setPodLogContainer] = useState<string | null>(null);
  const [podLogPrevious, setPodLogPrevious] = useState(false);
  const [podLogText, setPodLogText] = useState("");
  const [podLogLoading, setPodLogLoading] = useState(false);
  const [podLogAutoRefresh, setPodLogAutoRefresh] = useState(true);
  const [podLogRefreshSec, setPodLogRefreshSec] = useState("5");
  const [podLogFullscreen, setPodLogFullscreen] = useState(false);
  const [podLogQuery, setPodLogQuery] = useState("");
  const [podLogJumpLevel, setPodLogJumpLevel] = useState<PodLogLevel>("error");
  const [podLogActiveIdx, setPodLogActiveIdx] = useState(-1);
  const podLogViewportRef = useRef<HTMLDivElement>(null);
  const podLogStickBottomRef = useRef(true);
  const podLogInFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 防止自动刷新叠加重试把 UI 拖死 */
  const loadInFlightRef = useRef(false);
  const loadSeqRef = useRef(0);
  const cmInFlightRef = useRef(false);
  const connectGenRef = useRef(0);
  const deploysFpRef = useRef("");

  const selectedEnv = pickKsEnvironment(envs, envId);
  /** 环境列表指纹：新增/删除环境后需重新自动连接 */
  const envsFp = envs.map((e) => e.id).join(",");

  const connect = useCallback(async (id?: string | null) => {
    const gen = ++connectGenRef.current;
    const latestEnvs = resolveKsEnvironments(config);
    const env = pickKsEnvironment(latestEnvs, id ?? envId);
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
        setStatusText(`「${env.name}」已连接但未拿到命名空间，会话可能已失效，请点「重新连接」`);
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
  }, [config, envId]);

  const switchEnv = (id: string | null) => {
    setEnvId(id);
    if (id) onLastEnvChange?.(id);
    void connect(id);
  };

  // 配置就绪 + 环境列表变化时自动连接（新建环境后进入本页也能连上）
  useEffect(() => {
    if (!configReady) {
      setStatusText("正在加载配置…");
      return;
    }
    if (envs.length === 0) {
      setEnvId(null);
      setConnected(false);
      setStatusText("未配置环境：请到 系统设置 → KubeSphere 添加环境");
      return;
    }
    const nextId =
      (envId && envs.some((e) => e.id === envId) ? envId : null)
      ?? pickKsEnvironment(envs, config.ks_last_env_id)?.id
      ?? null;
    setEnvId(nextId);
    if (nextId) onLastEnvChange?.(nextId);
    const t = setTimeout(() => {
      void connect(nextId);
    }, 40);
    return () => {
      clearTimeout(t);
      connectGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, envsFp]);

  const loadCms = useCallback(async () => {
    if (!connected || !namespace) return;
    if (cmInFlightRef.current) return;
    cmInFlightRef.current = true;
    setCmLoading(true);
    try {
      setCms(await invoke<ConfigMapInfo[]>("ks_list_configmaps", { namespace }));
    } catch (e) {
      setCms([]);
      notifications.show({ color: "yellow", message: `加载 ConfigMap 列表失败：${e}`, autoClose: 4000 });
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

  /** 未连接时点刷新/重连应走 connect；已连接则拉部署列表 */
  const handleRefreshOrReconnect = () => {
    if (!connected) {
      void connect(envId);
      return;
    }
    void load({ silent: false, withCms: mainTab === "config" });
  };

  // 自动刷新：批量弹窗打开或执行中暂停，避免后台刷新拖死 UI
  const batchUiActive = batchConfirmOpen || batchOpen || batchRunning || cloneConfirmOpen || cloneOpen || cloneRunning;
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh && connected && namespace && !batchUiActive) {
      timerRef.current = setInterval(() => { void load({ silent: true }); }, Number(refreshSec) * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSec, connected, namespace, load, batchUiActive]);

  // 切换命名空间自动加载部署（ConfigMap 等切到对应页签再拉）
  useEffect(() => {
    setCms([]);
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

  const batchCpuCores = useMemo(() => detectCpuCores(), []);
  const batchRecommendedConcurrency = useMemo(
    () => recommendKsBatchConcurrency({
      itemCount: batchMeta?.deployNames.length ?? selectedDeploys.length,
      cpuCores: batchCpuCores,
    }),
    [batchMeta?.deployNames.length, selectedDeploys.length, batchCpuCores],
  );

  // 确认弹窗打开时在后台预热仓库索引，避免点「开始」后长时间无响应
  useEffect(() => {
    if (!batchConfirmOpen || !envId || !namespace || !batchMeta?.deployNames.length) return;
    if (!isTauriRuntime()) return;
    void prewarmKsBatchRepoIndex(
      config,
      envId,
      namespace,
      batchMeta.deployNames.map((name) => ({ name, containers: [] })),
    );
  }, [batchConfirmOpen, envId, namespace, config, batchMeta]);

  const batchBranchOptionGroups = useMemo(
    () => buildKsBatchBranchOptionGroups(batchGitBranches, branchHistory),
    [batchGitBranches, branchHistory],
  );

  const refreshBatchGitBranches = useCallback(async () => {
    if (!envId || !namespace || !batchMeta?.deployNames.length) return;
    if (!isTauriRuntime()) return;
    setBatchGitBranchesLoading(true);
    setBatchGitBranchesError("");
    try {
      const result = await loadKsBatchGitBranches(
        config,
        envId,
        namespace,
        batchMeta.deployNames.map((name) => ({ name, containers: [] })),
      );
      setBatchGitBranches(result.branches);
      setBatchGitRepoCount(result.repoPaths.length);
      if (result.error) {
        setBatchGitBranchesError(result.error);
      } else if (result.missingRepos.length > 0) {
        setBatchGitBranchesError(result.missingRepos.join("；"));
      }
    } catch (e) {
      setBatchGitBranchesError(String(e));
      setBatchGitBranches([]);
      setBatchGitRepoCount(0);
    } finally {
      setBatchGitBranchesLoading(false);
    }
  }, [config, envId, namespace, batchMeta]);

  useEffect(() => {
    if (!batchConfirmOpen) return;
    void refreshBatchGitBranches();
  }, [batchConfirmOpen, refreshBatchGitBranches]);

  // 批量执行期间订阅后端 build-progress（与分支打包页同一事件源）
  useEffect(() => {
    if (!batchRunning || !isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        const { percent, message } = event.payload;
        const step = batchStepLabelRef.current;
        const index = batchItemIndexRef.current;
        const total = batchItemTotalRef.current;
        const scaled = scaleBatchBuildPercent(index, total, percent);
        setBatchProgress((prev) => Math.max(prev, scaled));
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

  // 创建/编辑弹窗打开时刷新 ConfigMap（含切换命名空间后仍保持弹窗打开的场景）
  useEffect(() => {
    if (connected && namespace && (createOpen || editOpen)) void loadCms();
  }, [connected, namespace, createOpen, editOpen, loadCms]);

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

    const deployNames = selectedDeploys.map((d) => d.name);
    startTransition(() => {
      setBatchMeta({
        branch: batchBranch.trim(),
        namespace,
        envName: selectedEnv?.name ?? envId,
        deployNames,
        deployRoles: resolveKsBatchDeployRoles(config, envId, namespace, deployNames),
      });
      setBatchConfirmOpen(true);
    });
  };

  const startBatchPack = async (values: KsBatchConfirmValues) => {
    if (!envId || !namespace || !batchMeta) return;
    const branch = normalizeBatchBranchInput(values.branch);
    if (!branch) {
      notifications.show({ color: "yellow", message: "请填写目标分支" });
      return;
    }

    setBatchBranch(branch);
    setBatchNpmScriptPref(values.npmScript);
    saveKsBatchNpmScriptPref(values.npmScript);
    setBatchMeta({
      ...batchMeta,
      branch,
      npmScript: values.npmScript,
    });

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
        npmScript: values.npmScript,
        deployments: selectedDeploys.map((d) => ({
          name: d.name,
          containers: d.containers,
        })),
        appendLog: (line) => setBatchLog((prev) => (prev ? `${prev}\n${line}` : line)),
        onProgress: (pct, msg, ctx) => {
          batchStepLabelRef.current = msg;
          if (ctx) {
            batchItemIndexRef.current = ctx.itemIndex;
            batchItemTotalRef.current = ctx.itemTotal;
          }
          setBatchProgress((prev) => Math.max(prev, pct));
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

  const beginBatchClone = () => {
    if (!envId || !namespace || selectedDeploys.length === 0) return;
    startTransition(() => {
      setCloneMeta({
        sourceEnvId: envId,
        sourceEnvName: selectedEnv?.name ?? envId,
        sourceNamespace: namespace,
        deployNames: selectedDeploys.map((d) => d.name),
      });
      setCloneConfirmOpen(true);
    });
  };

  const closeCloneConfirm = () => {
    setCloneConfirmOpen(false);
    // 确认弹窗会连目标环境拉命名空间，关闭后切回当前环境
    if (envId) void connect(envId);
  };

  const startBatchClone = async (values: KsBatchCloneConfirmValues) => {
    if (!cloneMeta || !envId || !namespace) return;
    setCloneConfirmOpen(false);
    const targetEnv = pickKsEnvironment(envs, values.targetEnvId);
    setCloneProgressMeta({
      branch: `${cloneMeta.sourceEnvName} → ${targetEnv?.name ?? values.targetEnvId}`,
      namespace: `${cloneMeta.sourceNamespace} → ${values.targetNamespace}`,
      envName: targetEnv?.name ?? values.targetEnvId,
      deployNames: cloneMeta.deployNames,
    });
    setCloneOpen(true);
    setCloneRunning(true);
    setCloneSummary(null);
    setCloneLog("");
    setCloneProgress(0);
    setCloneMessage("准备复制…");

    try {
      const summary = await runKsBatchCloneToEnv({
        config,
        sourceEnvId: cloneMeta.sourceEnvId,
        sourceNamespace: cloneMeta.sourceNamespace,
        targetEnvId: values.targetEnvId,
        targetNamespace: values.targetNamespace,
        deployNames: cloneMeta.deployNames,
        conflict: values.conflict,
        copyConfigMap: values.copyConfigMap,
        copyPublishMaps: values.copyPublishMaps,
        dryRun: values.dryRun,
        appendLog: (line) => setCloneLog((prev) => (prev ? `${prev}\n${line}` : line)),
        onProgress: (pct, msg) => {
          setCloneProgress((prev) => Math.max(prev, pct));
          setCloneMessage(msg);
        },
        onMapsSaved: onPublishMapsChange,
      });
      setCloneSummary({
        success: summary.success,
        failed: summary.failed,
        skipped: summary.skipped,
      });
      notifications.show({
        color: summary.failed > 0 ? "orange" : "green",
        title: values.dryRun ? "预检完成" : "复制完成",
        message: `成功 ${summary.success} · 失败 ${summary.failed} · 跳过 ${summary.skipped}`,
        autoClose: 5000,
      });
      // 已切回源会话；刷新当前列表
      void load({ silent: true });
    } finally {
      setCloneRunning(false);
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

  const loadPodLogs = useCallback(async (
    podName: string,
    container: string | null,
    previous: boolean,
    opts?: { silent?: boolean },
  ) => {
    if (!namespace || !podName.trim()) return;
    if (!isTauriRuntime()) {
      notifications.show({ color: "yellow", message: "请在 Tauri 桌面窗口中操作" });
      return;
    }
    if (podLogInFlightRef.current) return;
    podLogInFlightRef.current = true;
    if (!opts?.silent) setPodLogLoading(true);
    try {
      const text = await invoke<string>("ks_get_pod_logs", {
        namespace,
        pod: podName.trim(),
        container: container?.trim() || null,
        tailLines: 500,
        previous,
      });
      setPodLogText(text || "（无日志内容）");
      podLogStickBottomRef.current = true;
      setPodLogActiveIdx(-1);
    } catch (e) {
      if (!opts?.silent) {
        setPodLogText("");
        notifications.show({
          color: "red",
          title: "拉取日志失败",
          message: String(e),
          autoClose: 8000,
        });
      }
    } finally {
      podLogInFlightRef.current = false;
      if (!opts?.silent) setPodLogLoading(false);
    }
  }, [namespace]);

  const openPodLogs = (podName: string) => {
    const c = sel?.containers[0] ?? null;
    setPodLogPod(podName);
    setPodLogContainer(c);
    setPodLogPrevious(false);
    setPodLogText("");
    setPodLogAutoRefresh(true);
    setPodLogFullscreen(false);
    setPodLogQuery("");
    setPodLogJumpLevel("error");
    setPodLogActiveIdx(-1);
    podLogStickBottomRef.current = true;
    setPodLogOpen(true);
    void loadPodLogs(podName, c, false);
  };

  useEffect(() => {
    if (!podLogOpen || !podLogAutoRefresh || !podLogPod) return;
    const sec = Number(podLogRefreshSec) || 5;
    const id = setInterval(() => {
      void loadPodLogs(podLogPod, podLogContainer, podLogPrevious, { silent: true });
    }, Math.max(3, sec) * 1000);
    return () => clearInterval(id);
  }, [
    podLogOpen,
    podLogAutoRefresh,
    podLogRefreshSec,
    podLogPod,
    podLogContainer,
    podLogPrevious,
    loadPodLogs,
  ]);

  const podLogView = useMemo(
    () => buildPodLogLines(podLogText, podLogQuery),
    [podLogText, podLogQuery],
  );

  useEffect(() => {
    if (!podLogOpen) return;
    const id = window.setTimeout(() => {
      const root = podLogViewportRef.current;
      if (!root) return;
      if (podLogActiveIdx >= 0) {
        const el = root.querySelector(`[data-log-idx="${podLogActiveIdx}"]`) as HTMLElement | null;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (podLogStickBottomRef.current) {
        root.scrollTop = root.scrollHeight;
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [podLogOpen, podLogView.lines, podLogActiveIdx]);

  const jumpPodLogLevel = (dir: "next" | "prev") => {
    const idx = dir === "next"
      ? findNextLevelIndex(podLogView.lines, podLogJumpLevel, podLogActiveIdx)
      : findPrevLevelIndex(podLogView.lines, podLogJumpLevel, podLogActiveIdx);
    if (idx < 0) {
      notifications.show({
        color: "yellow",
        message: `当前没有 ${POD_LOG_LEVEL_LABEL[podLogJumpLevel]} 日志`,
        autoClose: 2000,
      });
      return;
    }
    podLogStickBottomRef.current = false;
    setPodLogActiveIdx(idx);
  };

  const podLogJumpPos = useMemo(() => {
    const total = podLogView.counts[podLogJumpLevel];
    if (total <= 0) return { current: 0, total: 0 };
    const hits = podLogView.lines
      .map((line, i) => (line.level === podLogJumpLevel ? i : -1))
      .filter((i) => i >= 0);
    const at = hits.indexOf(podLogActiveIdx);
    return {
      current: at >= 0 ? at + 1 : 0,
      total,
    };
  }, [podLogView.lines, podLogView.counts, podLogJumpLevel, podLogActiveIdx]);

  const downloadPodLogs = async () => {
    const content = podLogText.trim() ? podLogText : "";
    if (!content) {
      notifications.show({ color: "yellow", message: "暂无日志可下载" });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safePod = (podLogPod || "pod").replace(/[^\w.-]+/g, "_");
    const safeCtr = (podLogContainer || "container").replace(/[^\w.-]+/g, "_");
    const filename = `${safePod}-${safeCtr}-${stamp}.log`;
    try {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notifications.show({ color: "teal", message: `已下载 ${filename}`, autoClose: 2500 });
    } catch (e) {
      notifications.show({ color: "red", message: `下载失败：${String(e)}` });
    }
  };

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

  const exportCsv = async () => {
    if (filtered.length === 0) {
      notifications.show({ color: "yellow", message: "当前无数据可导出" });
      return;
    }
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["状态", "部署", "别名", "容器", "端口", "镜像", "就绪", "版本"].map(esc).join(","),
      ...filtered.map((d) => {
        return [d.status.label, d.name, d.alias ?? "", d.containers.join("/"), (d.ports ?? []).join("/"), d.image, d.status.detail.split(" · ")[0], d.revision].map(esc).join(",");
      }),
    ].join("\r\n");
    const content = `\ufeff${rows}`;
    const defaultName = `deployments-status-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;

    if (!isTauriRuntime()) {
      const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      notifications.show({ color: "teal", message: `已下载 ${defaultName}`, autoClose: 2500 });
      return;
    }

    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;

    try {
      const saved = await invoke<string>("write_text_file", { path, content });
      notifications.show({
        color: "teal",
        title: "导出完成",
        message: saved,
        autoClose: 4000,
        onClick: () => {
          void invoke("open_directory", { path: saved }).catch(() => {});
        },
        style: { cursor: "pointer" },
      });
    } catch (e) {
      notifications.show({ color: "red", title: "导出 CSV 失败", message: String(e) });
    }
  };

  const cmSelectPlaceholder = cmLoading
    ? "正在加载 ConfigMap…"
    : cms.length
      ? "选择当前命名空间的 ConfigMap"
      : "当前命名空间暂无 ConfigMap";

  /** 打开创建弹窗时拉取 ConfigMap 列表（与编辑弹窗一致，不依赖 Config 页签） */
  const beginCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

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
  }, [namespace]);

  return (
    <>
      <Stack gap="md" className="ks-publish-panel">
        <Card shadow="sm" radius="md" withBorder styles={panelPaperStyles}>
          <Stack gap="md">
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Group gap={8}>
                <KubeSphereIcon size={20} color="#329dce" />
                <Title order={4}>KubeSphere 镜像发布</Title>
              </Group>
              {connecting && (
                <Group gap={6}>
                  <Loader size={14} />
                  <Text size="sm" c="dimmed">{statusText || "正在连接…"}</Text>
                </Group>
              )}
              {connected && selectedEnv && !connecting && (
                <Badge color="green" variant="dot" size="sm">已连接 {selectedEnv.name}</Badge>
              )}
              {!connected && !connecting && statusText && (
                <Text size="sm" c="red">{statusText}</Text>
              )}
            </Group>

            <Group align="flex-end" wrap="wrap" gap="md" className="ks-publish-toolbar">
              <Select
                label="环境"
                data={envs.map((env) => ({ value: env.id, label: env.name || env.id }))}
                value={envId}
                onChange={switchEnv}
                placeholder={envs.length ? "选择环境" : "请先在设置中添加环境"}
                disabled={connecting || envs.length === 0}
                styles={panelFieldStyles}
                style={{ flex: "1 1 200px", minWidth: 200 }}
              />
              <Select
                label="命名空间"
                data={namespaces}
                value={namespace}
                onChange={(v) => setNamespace(v)}
                searchable
                clearable
                placeholder={connected ? "选择命名空间" : "连接后可选"}
                disabled={!connected || connecting}
                styles={panelFieldStyles}
                style={{ flex: "1 1 200px", minWidth: 200 }}
              />
              <Button
                variant={connected ? "light" : "filled"}
                color="blue"
                leftSection={<RefreshCw size={14} />}
                loading={connecting}
                disabled={envs.length === 0 || !envId}
                onClick={() => void connect(envId)}
                title={connected ? "连接失败或会话过期时手动重连" : "连接所选环境"}
                styles={connected ? undefined : panelPrimaryButtonStyles}
                style={{ flex: "0 0 auto" }}
              >
                {connecting ? "连接中…" : connected ? "重新连接" : "连接"}
              </Button>
            </Group>
          </Stack>
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
                  <Group gap="sm" wrap="wrap" className="ks-publish-actions">
                    <Group gap={6} wrap="wrap" className="ks-publish-actions-util">
                      <Checkbox label="自动刷新" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} size="xs" />
                      <Select
                        value={refreshSec}
                        onChange={(v) => setRefreshSec(v ?? "30")}
                        data={["10", "30", "60"]}
                        w={76}
                        size="xs"
                        disabled={!autoRefresh}
                      />
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        leftSection={<KsRefreshIcon spinning={loading} />}
                        disabled={loading || connecting}
                        onClick={handleRefreshOrReconnect}
                      >
                        {connected ? "刷新" : "重新连接"}
                      </Button>
                      <Button size="xs" variant="light" color="blue" leftSection={<Plus size={13} />} onClick={beginCreate}>
                        创建部署
                      </Button>
                      <Button size="xs" variant="subtle" color="gray" leftSection={<Download size={13} />} onClick={() => void exportCsv()}>
                        导出 CSV
                      </Button>
                    </Group>
                    <Divider orientation="vertical" className="ks-publish-actions-divider" />
                    <Group gap={6} wrap="wrap" className="ks-publish-actions-batch">
                      <Button
                        size="xs"
                        variant="filled"
                        color="blue"
                        className="ks-btn-batch-primary"
                        leftSection={<Package size={13} />}
                        disabled={
                          checkedNames.size === 0
                          || batchRunning
                          || cloneRunning
                        }
                        loading={batchRunning}
                        onClick={beginBatchPack}
                        styles={panelPrimaryButtonStyles}
                      >
                        批量打包并发布{checkedNames.size > 0 ? ` (${checkedNames.size})` : ""}
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        color="green"
                        className="ks-btn-batch-clone"
                        leftSection={<Copy size={13} />}
                        disabled={
                          !connected
                          || !namespace
                          || checkedNames.size === 0
                          || batchRunning
                          || cloneRunning
                        }
                        loading={cloneRunning}
                        onClick={beginBatchClone}
                        styles={panelAccentButtonStyles}
                      >
                        复制到其他环境{checkedNames.size > 0 ? ` (${checkedNames.size})` : ""}
                      </Button>
                    </Group>
                  </Group>
                </Group>
                {checkedNames.size > 0 && (
                  <Text size="xs" c="blue">
                    已选 {checkedNames.size} 个部署
                    {" · "}
                    点击「批量打包并发布」在弹框中填写分支与构建脚本
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
                      <Group key={p.name} gap={8} my={4} wrap="nowrap" justify="space-between">
                        <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.state] ?? "#9aa5b8", display: "inline-block", flexShrink: 0 }} />
                          <Text size="xs" style={{ fontFamily: "monospace" }} truncate title={p.name}>{p.name}</Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{p.state === "running" ? `就绪 ${p.ready}/${p.total}` : (p.reason ?? p.state ?? p.phase)}{p.restarts ? ` · 重启${p.restarts}次` : ""}</Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{fmtTime(p.startTime)}</Text>
                        </Group>
                        <Button
                          size="compact-xs"
                          variant="light"
                          leftSection={<ScrollText size={12} />}
                          onClick={() => openPodLogs(p.name)}
                        >
                          日志
                        </Button>
                      </Group>
                    ))}
                    <Text size="sm" fw={600} c="dimmed" mt="sm">📦 旧版本</Text>
                    {sel.pods.old.length === 0 && <Text size="xs" c="dimmed">无</Text>}
                    {sel.pods.old.map((p) => (
                      <Group key={p.name} gap={8} my={4} wrap="nowrap" justify="space-between" opacity={0.85}>
                        <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }} opacity={0.75}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.state] ?? "#9aa5b8", display: "inline-block", flexShrink: 0 }} />
                          <Text size="xs" style={{ fontFamily: "monospace" }} truncate title={p.name}>{p.name}</Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{p.state === "running" ? `就绪 ${p.ready}/${p.total}` : (p.reason ?? p.state ?? p.phase)}{p.restarts ? ` · 重启${p.restarts}次` : ""}</Text>
                        </Group>
                        <Button
                          size="compact-xs"
                          variant="default"
                          leftSection={<ScrollText size={12} />}
                          onClick={() => openPodLogs(p.name)}
                        >
                          日志
                        </Button>
                      </Group>
                    ))}
                    <Group justify="space-between" mt="md" mb={6}>
                      <Group gap={6}>
                        <History size={14} />
                        <Text size="sm" fw={600}>历史版本（ReplicaSet）</Text>
                      </Group>
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<KsRefreshIcon spinning={revsLoading} />}
                        disabled={revsLoading}
                        onClick={() => void loadRevisions()}
                      >
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
                      variant="filled"
                      color="blue"
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
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<KsRefreshIcon spinning={cmLoading} />}
                disabled={cmLoading}
                onClick={() => void loadCms()}
              >
                刷新
              </Button>
              <Button size="xs" variant="light" color="blue" leftSection={<Plus size={13} />} onClick={() => { setCmMode("form"); setCmForm({ name: "", data: "" }); setCmYaml(""); setCmPreview(""); setCmOpen(true); }}>
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
            placeholder={cmSelectPlaceholder}
            data={cms.map((cm) => ({
              value: cm.name,
              label: cm.alias ? `${cm.name}（${cm.alias} · ${cm.dataSize} keys）` : `${cm.name}（${cm.dataSize} keys）`,
            }))}
            value={editForm.configMap}
            onChange={(v) => setEditForm({ ...editForm, configMap: v })}
            searchable
            clearable
            disabled={!cmLoading && cms.length === 0}
            rightSection={cmLoading ? <Loader size={16} /> : undefined}
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
              variant="filled"
              color="blue"
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
            placeholder={cmSelectPlaceholder}
            data={cms.map((cm) => ({
              value: cm.name,
              label: cm.alias ? `${cm.name}（${cm.alias} · ${cm.dataSize} keys）` : `${cm.name}（${cm.dataSize} keys）`,
            }))}
            value={createForm.configMap}
            onChange={(v) => setCreateForm({ ...createForm, configMap: v })}
            searchable
            clearable
            disabled={!cmLoading && cms.length === 0}
            rightSection={cmLoading ? <Loader size={16} /> : undefined}
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
            <Button size="xs" variant="filled" color="blue" loading={createBusy} onClick={() => void doCreate(false)}>
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
                <Button size="xs" variant="filled" color="blue" loading={cmBusy} onClick={() => void doCmCreate(false)}>创建</Button>
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
                <Button size="xs" variant="filled" color="blue" loading={cmBusy} onClick={() => void doCmCreate(false)}>创建</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
      {batchConfirmOpen && batchMeta && (
      <KsBatchConfirmModal
        opened={batchConfirmOpen}
        meta={batchMeta}
        initialBranch={batchBranch.trim() || defaultKsBatchBranch()}
        branchOptionGroups={batchBranchOptionGroups}
        gitBranchesLoading={batchGitBranchesLoading}
        gitBranchesError={batchGitBranchesError || undefined}
        gitRepoCount={batchGitRepoCount}
        onRefreshGitBranches={() => void refreshBatchGitBranches()}
        initialNpmScript={batchNpmScriptPref}
        concurrencyPref={batchConcurrencyPref}
        recommendedConcurrency={batchRecommendedConcurrency}
        cpuCores={batchCpuCores}
        onConcurrencyPrefChange={(n) => {
          const pref = (n === 0 || n === 1 || n === 2 || n === 3 || n === 4
            ? n
            : KS_BATCH_CONCURRENCY_AUTO) as KsBatchConcurrencyPref;
          setBatchConcurrencyPref(pref);
          saveKsBatchConcurrencyPref(pref);
        }}
        onClose={() => setBatchConfirmOpen(false)}
        onStart={(values) => void startBatchPack(values)}
      />
      )}
      {(batchOpen || batchRunning) && (
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
      )}
      {cloneConfirmOpen && cloneMeta && (
        <KsBatchCloneConfirmModal
          opened={cloneConfirmOpen}
          config={config}
          meta={cloneMeta}
          onClose={closeCloneConfirm}
          onStart={(values) => void startBatchClone(values)}
        />
      )}
      {(cloneOpen || cloneRunning) && (
        <KsBatchProgressModal
          opened={cloneOpen}
          meta={cloneProgressMeta}
          running={cloneRunning}
          progress={cloneProgress}
          message={cloneMessage}
          log={cloneLog}
          summary={cloneSummary}
          title="批量复制到其他环境"
          metaLine={
            cloneProgressMeta
              ? `${cloneProgressMeta.branch} · ${cloneProgressMeta.namespace} · ${cloneProgressMeta.deployNames.length} 个部署`
              : null
          }
          onClose={() => setCloneOpen(false)}
          onCancelBuild={() => {}}
          showCancel={false}
        />
      )}
      <Modal
        opened={podLogOpen}
        onClose={() => {
          setPodLogOpen(false);
          setPodLogAutoRefresh(false);
          setPodLogFullscreen(false);
          setPodLogQuery("");
        }}
        centered={!podLogFullscreen}
        fullScreen={podLogFullscreen}
        size="xl"
        title={(
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            <ScrollText size={16} />
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={700} size="sm">Pod 日志</Text>
              <Text size="xs" c="dimmed" style={{ fontFamily: "monospace" }} truncate>
                {podLogPod || "—"}
              </Text>
            </Stack>
          </Group>
        )}
        classNames={{
          content: podLogFullscreen ? "ks-pod-log-modal ks-pod-log-modal--full" : "ks-pod-log-modal",
          body: "ks-pod-log-body",
        }}
      >
        <Box className="ks-pod-log-toolbar-wrap">
          <Box className="ks-pod-log-controls">
            <Group gap={8} wrap="wrap" align="center" className="ks-pod-log-controls-row">
              <Text size="xs" c="dimmed" className="ks-pod-log-field-label">容器</Text>
              <Select
                size="xs"
                w={200}
                data={(sel?.containers ?? []).map((c) => ({ value: c, label: c }))}
                value={podLogContainer}
                onChange={(v) => {
                  setPodLogContainer(v);
                  if (podLogPod) void loadPodLogs(podLogPod, v, podLogPrevious);
                }}
                allowDeselect={false}
                searchable
                aria-label="容器"
              />
              <Checkbox
                label="上一崩溃"
                size="xs"
                checked={podLogPrevious}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setPodLogPrevious(on);
                  if (podLogPod) void loadPodLogs(podLogPod, podLogContainer, on);
                }}
              />
              <Divider orientation="vertical" visibleFrom="sm" className="ks-pod-log-vdiv" />
              <Checkbox
                label="定时刷新"
                size="xs"
                checked={podLogAutoRefresh}
                onChange={(e) => setPodLogAutoRefresh(e.currentTarget.checked)}
              />
              <Select
                size="xs"
                w={84}
                data={[
                  { value: "3", label: "3秒" },
                  { value: "5", label: "5秒" },
                  { value: "10", label: "10秒" },
                  { value: "30", label: "30秒" },
                ]}
                value={podLogRefreshSec}
                onChange={(v) => setPodLogRefreshSec(v ?? "5")}
                disabled={!podLogAutoRefresh}
                allowDeselect={false}
                aria-label="刷新间隔"
              />
              <Group gap={6} wrap="nowrap" ml="auto">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<KsRefreshIcon spinning={podLogLoading} />}
                  disabled={podLogLoading}
                  onClick={() => {
                    if (podLogPod) void loadPodLogs(podLogPod, podLogContainer, podLogPrevious);
                  }}
                >
                  刷新
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<Copy size={13} />}
                  disabled={!podLogText}
                  onClick={() => {
                    void navigator.clipboard.writeText(podLogText).then(() => {
                      notifications.show({ color: "teal", message: "日志已复制", autoClose: 2000 });
                    });
                  }}
                >
                  复制
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<Download size={13} />}
                  disabled={!podLogText}
                  onClick={() => void downloadPodLogs()}
                >
                  下载
                </Button>
              </Group>
            </Group>
            <TextInput
              size="xs"
              placeholder="搜索日志内容…"
              leftSection={<Search size={13} />}
              value={podLogQuery}
              onChange={(e) => {
                setPodLogQuery(e.currentTarget.value);
                setPodLogActiveIdx(-1);
              }}
              rightSection={
                podLogQuery ? (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label="清除搜索"
                    onClick={() => {
                      setPodLogQuery("");
                      setPodLogActiveIdx(-1);
                    }}
                  >
                    ×
                  </ActionIcon>
                ) : null
              }
            />
            <Group gap={6} wrap="wrap" align="center" className="ks-pod-log-levels">
              {POD_LOG_LEVELS.map((lv) => {
                const n = podLogView.counts[lv];
                const active = podLogJumpLevel === lv;
                return (
                  <Button
                    key={lv}
                    size="compact-xs"
                    variant={active ? "filled" : "light"}
                    color={
                      lv === "fatal" || lv === "error"
                        ? "red"
                        : lv === "warn"
                          ? "orange"
                          : lv === "info"
                            ? "cyan"
                            : lv === "debug"
                              ? "gray"
                              : "violet"
                    }
                    className={`ks-pod-log-level-chip ks-pod-log-level-chip--${lv}`}
                    disabled={n === 0}
                    onClick={() => {
                      setPodLogJumpLevel(lv);
                      const idx = findNextLevelIndex(podLogView.lines, lv, -1);
                      if (idx >= 0) {
                        podLogStickBottomRef.current = false;
                        setPodLogActiveIdx(idx);
                      }
                    }}
                  >
                    {POD_LOG_LEVEL_LABEL[lv]} {n}
                  </Button>
                );
              })}
              <Group gap={4} wrap="nowrap" ml={4} align="center" className="ks-pod-log-nav">
                <Tooltip label={`上一个 ${POD_LOG_LEVEL_LABEL[podLogJumpLevel]}`}>
                  <ActionIcon
                    size="sm"
                    variant="default"
                    aria-label="上一个级别"
                    disabled={podLogJumpPos.total === 0}
                    onClick={() => jumpPodLogLevel("prev")}
                  >
                    <ChevronUp size={14} />
                  </ActionIcon>
                </Tooltip>
                <Text size="xs" className="ks-pod-log-nav-pos" title={POD_LOG_LEVEL_LABEL[podLogJumpLevel]}>
                  {podLogJumpPos.total === 0
                    ? "0/0"
                    : `${podLogJumpPos.current > 0 ? podLogJumpPos.current : "—"}/${podLogJumpPos.total}`}
                </Text>
                <Tooltip label={`下一个 ${POD_LOG_LEVEL_LABEL[podLogJumpLevel]}`}>
                  <ActionIcon
                    size="sm"
                    variant="default"
                    aria-label="下一个级别"
                    disabled={podLogJumpPos.total === 0}
                    onClick={() => jumpPodLogLevel("next")}
                  >
                    <ChevronDown size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Box>

          <Box className="ks-pod-log-frame">
            <Tooltip label={podLogFullscreen ? "退出全屏" : "全屏"}>
              <ActionIcon
                className="ks-pod-log-fullscreen-btn"
                variant="filled"
                color="dark"
                size="sm"
                radius="sm"
                aria-label={podLogFullscreen ? "退出全屏" : "全屏"}
                onClick={() => setPodLogFullscreen((v) => !v)}
              >
                {podLogFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </ActionIcon>
            </Tooltip>
            <ScrollArea
              type="auto"
              offsetScrollbars={false}
              scrollbarSize={8}
              className="ks-pod-log-scroll"
              viewportRef={podLogViewportRef}
            >
              {podLogLoading && !podLogText ? (
                <Group gap={8} p="md">
                  <Loader size={14} />
                  <Text size="xs" c="dimmed">正在拉取日志…</Text>
                </Group>
              ) : podLogView.lines.length === 0 ? (
                <Text size="xs" c="dimmed" p="md">
                  {podLogQuery.trim() ? "（无匹配行）" : "（暂无内容）"}
                </Text>
              ) : (
                <div className="ks-pod-log-lines">
                  {podLogView.lines.map((line, i) => (
                    <div
                      key={`${line.index}-${i}`}
                      data-log-idx={i}
                      className={[
                        "ks-pod-log-line",
                        line.level ? `ks-pod-log-line--${line.level}` : "ks-pod-log-line--plain",
                        i === podLogActiveIdx ? "is-active" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => {
                        if (line.level) setPodLogJumpLevel(line.level);
                        podLogStickBottomRef.current = false;
                        setPodLogActiveIdx(i);
                      }}
                    >
                      {line.text || " "}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </Box>
          <Group justify="space-between" className="ks-pod-log-footer">
            <Text size="xs" c="dimmed">
              尾部约 500 行 · 共 {podLogView.total} 行
              {podLogQuery.trim()
                ? ` · 搜索命中 ${podLogView.matched}`
                : ""}
              {podLogView.counts[podLogJumpLevel] > 0
                ? ` · ${POD_LOG_LEVEL_LABEL[podLogJumpLevel]} ${podLogJumpPos.current > 0 ? `${podLogJumpPos.current}/` : ""}${podLogView.counts[podLogJumpLevel]}`
                : ""}
              {podLogAutoRefresh ? ` · 每 ${podLogRefreshSec}s 自动刷新` : " · 已关闭定时刷新"}
            </Text>
            {podLogLoading && podLogText ? (
              <Text size="xs" c="dimmed">刷新中…</Text>
            ) : null}
          </Group>
        </Box>
      </Modal>
    </>
  );
}
