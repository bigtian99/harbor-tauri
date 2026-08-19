import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card, Title, Text, TextInput, Button, Select, Table, Badge,
  Checkbox, Group, Stack, Divider, ScrollArea, Box, Loader, Pagination,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { RefreshCw, Download, Rocket, Container as ContainerIcon, Search, History } from "lucide-react";
import type { HarborConfig } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "../utils/ksEnvironments";
import { useConfirmDialog } from "../hooks/useConfirmDialog";

interface PodInfo {
  name: string; phase: string; state: string; reason: string | null;
  restarts: number; ready: number; total: number; startTime: string; node: string;
}
interface DeployStatus { state: string; label: string; reason: string | null; detail: string; old: string; }
interface DeployInfo {
  name: string; image: string; containers: string[];
  status: DeployStatus; pods: { new: PodInfo[]; old: PodInfo[] }; revision: string;
}
interface UpdateResult { ok: boolean; oldImage: string; newImage: string; revision: string; }
interface DeployRevision {
  revision: string;
  image: string;
  containers: { name: string; image: string }[];
  replicas: number;
  ready: number;
  createdAt: string;
  isCurrent: boolean;
}

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

function deploySearchText(d: DeployInfo): string {
  const tag = d.image.split(":").pop() ?? d.image;
  const pods = [...d.pods.new, ...d.pods.old]
    .map((p) => `${p.name} ${p.reason ?? ""} ${p.state ?? ""} ${p.phase ?? ""}`)
    .join(" ");
  return [
    d.name,
    d.containers.join(" "),
    d.image,
    tag,
    d.status.label,
    d.status.reason ?? "",
    d.revision,
    pods,
  ].join(" ").toLowerCase();
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(/\//g, "-");
}

export function KsPublishPanel({
  config,
  onLastEnvChange,
}: {
  config: HarborConfig;
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
  const [onlyBad, setOnlyBad] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState("30");
  const [image, setImage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [revisions, setRevisions] = useState<DeployRevision[]>([]);
  const [revsLoading, setRevsLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedEnv = pickKsEnvironment(envs, envId);

  const connect = async (id?: string | null) => {
    const env = pickKsEnvironment(envs, id ?? envId);
    if (!env) {
      setStatusText("未配置环境：请到 系统设置 → KubeSphere 添加 dev / test / prod");
      setConnected(false);
      return;
    }
    const consoleUrl = env.console || "http://192.168.31.254:30880";
    const username = env.username || "admin";
    const password = env.password || "";
    if (!consoleUrl.trim() || !username.trim() || !password) {
      setStatusText(`环境「${env.name}」未配齐：请到 系统设置 → KubeSphere 填写地址/账号/密码`);
      setConnected(false);
      return;
    }
    setConnecting(true);
    setConnected(false);
    setNamespaces([]);
    setNamespace(null);
    setDeploys([]);
    setSel(null);
    setStatusText(`正在连接「${env.name}」…`);
    try {
      await invoke("ks_login", { console: consoleUrl.trim(), username: username.trim(), password });
      const ns = await invoke<string[]>("ks_list_namespaces");
      setNamespaces(ns);
      const prefer = ns.includes("klcj-zt-dev") ? "klcj-zt-dev" : ns[0] ?? null;
      setNamespace(prefer);
      setConnected(true);
      setStatusText("");
    } catch (e) {
      setStatusText(`连接「${env.name}」失败：${e}（请到 系统设置 → KubeSphere 检查配置）`);
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  };

  const switchEnv = (id: string | null) => {
    setEnvId(id);
    if (id) onLastEnvChange?.(id);
    void connect(id);
  };

  // 打开面板即自动连接（使用当前选中环境）
  useEffect(() => {
    void connect(envId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (silent = false) => {
    if (!connected || !namespace) return;
    if (!silent) setLoading(true);
    try {
      const list = await invoke<DeployInfo[]>("ks_list_deployments", { namespace });
      setDeploys(list);
      setLastRefresh(new Date().toLocaleTimeString("zh-CN"));
      // 保留选中（若部署仍存在）
      setSel((prev) => (prev && list.find((d) => d.name === prev.name)) || null);
    } catch (e) {
      if (!silent) notifications.show({ color: "red", message: String(e) });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 自动刷新
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh && connected && namespace) {
      timerRef.current = setInterval(() => { void load(true); }, Number(refreshSec) * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshSec, connected, namespace]);

  // 切换命名空间自动加载
  useEffect(() => {
    if (connected && namespace) void load(false);
    setSearch("");
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, connected]);

  const filtered = useMemo(() => {
    let list = onlyBad ? deploys.filter((d) => BAD_STATES.includes(d.status.state)) : deploys;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) => deploySearchText(d).includes(q));
  }, [deploys, onlyBad, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, onlyBad]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

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
    if (!sel || !namespace) return;
    if (!image.trim()) { notifications.show({ color: "yellow", message: "请填写新镜像地址" }); return; }
    setSubmitting(true);
    try {
      const r = await invoke<UpdateResult>("ks_update_image", {
        namespace, deployment: sel.name, container: selContainer, image: image.trim(),
      });
      notifications.show({
        color: r.ok ? "green" : "red",
        title: r.ok ? "🚀 发布成功" : "发布失败",
        message: `${r.newImage}（revision ${r.revision}）`,
      });
      setImage("");
      void load(true);
      void loadRevisions(sel.name);
    } catch (e) {
      notifications.show({ color: "red", title: "变更失败", message: String(e) });
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
      void load(true);
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
      ["状态", "部署", "容器", "镜像", "就绪", "版本", "Pod"].map(esc).join(","),
      ...filtered.map((d) => {
        const podTxt = [...d.pods.new, ...d.pods.old]
          .map((p) => `${p.name}:${p.reason ?? p.state ?? p.phase ?? "-"}${p.restarts ? `(重启${p.restarts})` : ""}`)
          .join("; ");
        return [d.status.label, d.name, d.containers.join("/"), d.image, d.status.detail.split(" · ")[0], d.revision, podTxt].map(esc).join(",");
      }),
    ].join("\r\n");
    const blob = new Blob(["\ufeff" + rows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `deployments-status-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  const rowSelCss = `
    .ks-row-sel td { background: #cfe6f7 !important; color: #0b3a5c !important; }
    .ks-row-sel td:first-child { box-shadow: inset 3px 0 0 #329dce; }
  `;
  return (
    <>
      <style>{rowSelCss}</style>
      <Stack gap="md" className="ks-publish-panel">
        <Card shadow="sm" radius="md" withBorder>
          <Group justify="space-between" mb="sm">
            <Group gap={8}>
              <ContainerIcon size={20} color="#329dce" />
              <Title order={4}>KubeSphere 镜像发布</Title>
              {connecting && <Loader size={15} />}
              {connected && selectedEnv && (
                <Badge color="green" variant="light" size="xs">已连接 {selectedEnv.name}</Badge>
              )}
              {!connected && !connecting && statusText && <Text size="xs" c="red">{statusText}</Text>}
            </Group>
          </Group>
          <Select
            label="环境"
            data={envs.map((env) => ({ value: env.id, label: env.name || env.id }))}
            value={envId}
            onChange={switchEnv}
            placeholder={envs.length ? "选择环境" : "请先在设置中添加环境"}
            disabled={connecting || envs.length === 0}
            style={{ maxWidth: 280, marginBottom: connected ? 12 : 0 }}
          />
          {connected && (
            <Select
              label="命名空间"
              data={namespaces}
              value={namespace}
              onChange={(v) => setNamespace(v)}
              searchable
              clearable
              placeholder="选择命名空间"
              style={{ maxWidth: 420 }}
            />
          )}
        </Card>

        {connected && (
          <>
            <Card shadow="sm" radius="md" withBorder>
              <Group justify="space-between" mb="xs">
                <Group gap={8}>
                  <Title order={5}>📋 全部部署状态</Title>
                  {lastRefresh && <Text size="xs" c="dimmed">最近刷新 {lastRefresh}</Text>}
                </Group>
                <Group gap="sm">
                  <Checkbox label="自动刷新" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} size="xs" />
                  <Select
                    value={refreshSec}
                    onChange={(v) => setRefreshSec(v ?? "30")}
                    data={["10", "30", "60"]}
                    w={76}
                    size="xs"
                    disabled={!autoRefresh}
                  />
                  <Button size="xs" variant="default" leftSection={<RefreshCw size={13} />} loading={loading} onClick={() => void load(false)}>
                    刷新
                  </Button>
                  <Checkbox label="只看异常" checked={onlyBad} onChange={(e) => setOnlyBad(e.currentTarget.checked)} size="xs" />
                  <Button size="xs" variant="default" leftSection={<Download size={13} />} onClick={exportCsv}>
                    导出 CSV
                  </Button>
                </Group>
              </Group>
              <TextInput
                type="search"
                placeholder="搜索部署名 / 容器 / 镜像 / Pod / 状态…"
                leftSection={<Search size={14} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                mb="sm"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              <ScrollArea style={{ maxHeight: 420 }}>
                <Table striped highlightOnHover verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>状态</Table.Th><Table.Th>部署</Table.Th><Table.Th>容器</Table.Th>
                      <Table.Th>镜像Tag</Table.Th><Table.Th>就绪</Table.Th><Table.Th>版本</Table.Th><Table.Th>Pod</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {pageRows.length === 0 && (
                      <Table.Tr><Table.Td colSpan={7} align="center" c="dimmed">没有匹配的部署</Table.Td></Table.Tr>
                    )}
                    {pageRows.map((d) => {
                      const s = d.status;
                      const tag = d.image.split(":").pop() ?? d.image;
                      const newPods = d.pods.new;
                      const podTxt = newPods.length
                        ? `${newPods.length > 1 ? newPods.length + " pods · " : ""}${newPods[0].reason ?? newPods[0].state ?? newPods[0].phase ?? "-"}`
                        : d.pods.old.length
                          ? `旧 ${d.pods.old.length} · ${d.pods.old[0].reason ?? d.pods.old[0].state ?? d.pods.old[0].phase ?? "-"}`
                          : "-";
                      return (
                        <Table.Tr key={d.name} className={sel?.name === d.name ? "ks-row-sel" : undefined} style={{ cursor: "pointer" }} onClick={() => setSel(d)}>
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[s.state] ?? "#9aa5b8", display: "inline-block" }} />
                              <Badge color={STATUS_COLOR[s.state] ?? "gray"} variant="light" size="xs">{s.label}</Badge>
                            </Group>
                          </Table.Td>
                          <Table.Td fw={700}>{d.name}</Table.Td>
                          <Table.Td>{d.containers.join(", ")}</Table.Td>
                          <Table.Td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag}</Table.Td>
                          <Table.Td>{s.detail.split(" · ")[0]}{s.old && <Text span size="xs" c="dimmed">{s.old}</Text>}</Table.Td>
                          <Table.Td>{d.revision}</Table.Td>
                          <Table.Td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{podTxt}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
              <Group justify="space-between" align="center" mt="sm">
                <Text size="sm" c="dimmed">
                  共 {filtered.length} 条
                  {search.trim() || onlyBad ? `（筛选自 ${deploys.length}）` : ""}
                  {filtered.length > 0
                    ? ` · 第 ${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, filtered.length)} 条`
                    : ""}
                </Text>
                <Group gap="sm">
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
              </Group>
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
                </Group>
                <Group align="flex-start" gap="lg">
                  <Box style={{ flex: 1 }}>
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
                      <ScrollArea style={{ maxHeight: 200 }}>
                        <Table verticalSpacing="xs" withTableBorder>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Revision</Table.Th>
                              <Table.Th>镜像</Table.Th>
                              <Table.Th>就绪</Table.Th>
                              <Table.Th>创建时间</Table.Th>
                              <Table.Th>操作</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {revisions.map((rev) => {
                              const tag = rev.image.split(":").pop() ?? rev.image;
                              return (
                                <Table.Tr key={rev.revision} bg={rev.isCurrent ? "rgba(50, 157, 206, 0.08)" : undefined}>
                                  <Table.Td>
                                    <Group gap={6} wrap="nowrap">
                                      <Text size="xs" fw={700}>{rev.revision}</Text>
                                      {rev.isCurrent && <Badge size="xs" color="blue" variant="light">当前</Badge>}
                                    </Group>
                                  </Table.Td>
                                  <Table.Td>
                                    <Text size="xs" style={{ fontFamily: "monospace" }} title={rev.image}>
                                      {tag}
                                    </Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Text size="xs">{rev.ready}/{rev.replicas}</Text>
                                  </Table.Td>
                                  <Table.Td>
                                    <Text size="xs" c="dimmed">{fmtTime(rev.createdAt)}</Text>
                                  </Table.Td>
                                  <Table.Td>
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
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    )}
                  </Box>
                  <Divider orientation="vertical" />
                  <Box style={{ flex: 1, minWidth: 280 }}>
                    <Title order={6} mb="xs">🚀 修改镜像并发布</Title>
                    <Text size="xs" c="dimmed" mb={4}>容器：{selContainer}</Text>
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
                      onClick={submit}
                    >
                      提交变更
                    </Button>
                  </Box>
                </Group>
              </Card>
            )}
          </>
        )}
      </Stack>
    </>
  );
}
