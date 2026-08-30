import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { FolderOpen, Loader2, RefreshCw, Save } from "lucide-react";
import type { HarborConfig, KsPublishMap, KsPublishMapRole } from "../types";
import { isTauriRuntime } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "../utils/ksEnvironments";
import {
  resolveKlcjZtExposePort,
  suggestKlcjZtByGitUrl,
  suggestKlcjZtGit,
} from "../utils/klcjZtGitDefaults";
import { createKsPublishMap } from "../utils/ksPublishMap";
import { showSystemAlert } from "../systemAlert";

const ROLES: { value: KsPublishMapRole; label: string }[] = [
  { value: "backend", label: "后端" },
  { value: "frontend", label: "前端" },
  { value: "any", label: "任意" },
];

const fieldStyles = {
  label: { color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" },
  input: {
    backgroundColor: "var(--color-bg-elevated)",
    borderColor: "var(--color-border)",
    color: "var(--color-text)",
  },
} as const;

const paperStyles = {
  root: {
    background: "var(--color-bg-surface)",
    border: "1px solid var(--color-border)",
  },
} as const;

const compactInputStyles = {
  input: {
    ...fieldStyles.input,
    fontSize: "var(--font-size-sm)",
    minHeight: 32,
    height: 32,
  },
} as const;

interface DeployRow {
  name: string;
  containers: string[];
}

interface GridRow {
  deployment: string;
  container: string;
  role: KsPublishMapRole;
  git_url: string;
  expose_port: string;
  mapId?: string;
}

function roleLabel(role: KsPublishMapRole) {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

function buildGridRows(
  deploys: DeployRow[],
  maps: KsPublishMap[],
  envId: string,
  namespace: string,
): GridRow[] {
  return deploys.map((d) => {
    const existing = maps.find(
      (m) =>
        m.env_id === envId
        && m.namespace === namespace
        && m.deployment === d.name,
    );
    const suggested = suggestKlcjZtGit(d.name);
    const git_url = existing?.git_url?.trim() || suggested?.git_url || "";
    const expose_port = resolveKlcjZtExposePort({
      deployment: d.name,
      gitUrl: git_url,
      existingPort: existing?.expose_port,
    }) || suggested?.expose_port || "";
    return {
      deployment: d.name,
      container: existing?.container?.trim() || d.containers[0]?.trim() || "",
      role: existing?.role ?? suggested?.role ?? "backend",
      git_url,
      expose_port,
      mapId: existing?.id,
    };
  });
}

export function KsPublishMapEditor({
  config,
  onMapsChange,
  onRegisterFlush,
}: {
  config: HarborConfig;
  onMapsChange: (updater: KsPublishMap[] | ((prev: KsPublishMap[]) => KsPublishMap[])) => void;
  /** 注册「把当前命名空间表格写入 config」回调，供底部「保存配置」前自动合并 */
  onRegisterFlush?: (flush: () => void) => void;
}) {
  const ksEnvs = resolveKsEnvironments(config);
  const publishMaps = config.ks_publish_maps ?? [];
  const publishMapsRef = useRef(publishMaps);
  publishMapsRef.current = publishMaps;

  const [envId, setEnvId] = useState(
    () => config.ks_last_env_id || ksEnvs[0]?.id || "",
  );
  const [namespace, setNamespace] = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loadingDeploys, setLoadingDeploys] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [deploys, setDeploys] = useState<DeployRow[]>([]);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [fillLoading, setFillLoading] = useState(false);

  const envNameById = (id: string) => ksEnvs.find((e) => e.id === id)?.name || id;

  const otherMaps = useMemo(
    () =>
      publishMaps.filter(
        (m) => !(m.env_id === envId && m.namespace === namespace && namespace),
      ),
    [publishMaps, envId, namespace],
  );

  const connectSeqRef = useRef(0);

  /** 环境凭证指纹：保存配置或改地址/密码后需重新连接 */
  const envsFp = useMemo(
    () =>
      resolveKsEnvironments(config)
        .map((e) => `${e.id}:${e.console}:${e.username}:${e.password}`)
        .join("|"),
    [config],
  );

  const connect = useCallback(async (targetEnvId?: string) => {
    const id = targetEnvId ?? envId;
    const latestEnvs = resolveKsEnvironments(config);
    const env = latestEnvs.find((e) => e.id === id);
    if (!env) {
      setStatusText("请先添加 KubeSphere 环境");
      setConnected(false);
      setNamespaces([]);
      return;
    }
    if (!isTauriRuntime()) {
      setStatusText("请在 Tauri 桌面窗口中连接");
      setConnected(false);
      return;
    }
    const consoleUrl = env.console?.trim() || "";
    const username = env.username?.trim() || "";
    const password = env.password ?? "";
    if (!consoleUrl || !username || !password) {
      setStatusText(`环境「${env.name}」未配齐地址/账号/密码，请先保存 KubeSphere 配置`);
      setConnected(false);
      setNamespaces([]);
      return;
    }
    const seq = ++connectSeqRef.current;
    setConnecting(true);
    setConnected(false);
    setNamespaces([]);
    setNamespace("");
    setDeploys([]);
    setRows([]);
    setStatusText(`正在连接「${env.name}」…`);
    try {
      await invoke("ks_connect", {
        envId: env.id,
        console: consoleUrl,
        username,
        password,
      });
      if (seq !== connectSeqRef.current) return;
      const ns = await invoke<string[]>("ks_list_namespaces");
      if (seq !== connectSeqRef.current) return;
      if (ns.length === 0) {
        setNamespaces([]);
        setNamespace("");
        setConnected(false);
        setStatusText(`「${env.name}」已连接但未拿到命名空间，请点「重新连接」`);
        return;
      }
      setNamespaces(ns);
      setConnected(true);
      const prefer = ns.includes("klcj-zt-dev") ? "klcj-zt-dev" : ns[0];
      setNamespace(prefer);
      setStatusText(`已连接「${env.name}」，共 ${ns.length} 个命名空间`);
    } catch (e) {
      if (seq !== connectSeqRef.current) return;
      setStatusText(`连接失败：${e}（请检查 KubeSphere 地址/账号/密码）`);
      setConnected(false);
      setNamespaces([]);
    } finally {
      if (seq === connectSeqRef.current) setConnecting(false);
    }
  }, [config, envId]);

  // 配置保存或环境列表变化时自动连接；切换 envId 由下拉 onChange 触发 connect
  useEffect(() => {
    const envs = resolveKsEnvironments(config);
    if (envs.length === 0) {
      setConnected(false);
      setNamespaces([]);
      setStatusText("请先添加 KubeSphere 环境");
      return;
    }
    const validId =
      (envId && envs.some((e) => e.id === envId) ? envId : null)
      ?? pickKsEnvironment(envs, config.ks_last_env_id)?.id
      ?? envs[0]?.id
      ?? "";
    if (validId && validId !== envId) {
      setEnvId(validId);
    }
    if (!validId) return;
    const t = setTimeout(() => {
      void connect(validId);
    }, 40);
    return () => {
      clearTimeout(t);
      connectSeqRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envsFp]);

  const loadDeploys = useCallback(async (ns: string) => {
    if (!connected || !ns) return;
    setLoadingDeploys(true);
    setStatusText(`正在加载 ${ns} 部署列表…`);
    try {
      const list = await invoke<DeployRow[]>("ks_list_deployments", { namespace: ns });
      setDeploys(list);
      // 用 ref，避免 publishMaps 变化触发整表重载、冲掉未保存编辑
      setRows(buildGridRows(list, publishMapsRef.current, envId, ns));
      setStatusText(`已加载 ${list.length} 个部署`);
    } catch (e) {
      setDeploys([]);
      setRows([]);
      setStatusText(`加载部署失败：${e}`);
    } finally {
      setLoadingDeploys(false);
    }
  }, [connected, envId]);

  useEffect(() => {
    if (connected && namespace) {
      void loadDeploys(namespace);
    }
  }, [connected, namespace, loadDeploys]);

  const updateRow = (deployment: string, patch: Partial<GridRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.deployment !== deployment) return r;
        const next = { ...r, ...patch };
        if (patch.git_url === undefined) return next;

        const oldDefault =
          suggestKlcjZtGit(r.deployment)?.expose_port
          || suggestKlcjZtByGitUrl(r.git_url)?.expose_port
          || "";
        const newDefault =
          suggestKlcjZtGit(r.deployment)?.expose_port
          || suggestKlcjZtByGitUrl(next.git_url)?.expose_port
          || "";
        // 端口为空，或仍是旧 Git 对应的默认端口时，随 Git 一起带出新端口
        if (!next.expose_port.trim() || next.expose_port.trim() === oldDefault) {
          if (newDefault) next.expose_port = newDefault;
        }
        return next;
      }),
    );
  };

  const fillGitFromLastRepo = async () => {
    const repoPath = config.last_repo_path?.trim();
    if (!repoPath) {
      await showSystemAlert("无法填入", "请先在分支打包页选择仓库");
      return;
    }
    if (!isTauriRuntime()) return;
    setFillLoading(true);
    try {
      const url = await invoke<string>("get_git_remote_url", {
        repoPath,
        remote: null,
      });
      const git = url.trim();
      const byGit = suggestKlcjZtByGitUrl(git);
      setRows((prev) =>
        prev.map((r) => {
          if (r.git_url.trim()) return r;
          const byDeploy = suggestKlcjZtGit(r.deployment);
          // 仅填「部署名已匹配到同一 Git」或「完全空行且只有一个空部署」时用当前仓库
          const sameGit =
            byDeploy && byGit && byDeploy.git_url === byGit.git_url;
          if (!sameGit && byDeploy) {
            // 部署已有模块默认 Git，不覆盖成当前仓库
            return r;
          }
          const expose_port =
            r.expose_port.trim()
            || byDeploy?.expose_port
            || byGit?.expose_port
            || "";
          return {
            ...r,
            git_url: byDeploy?.git_url || git,
            role: r.role || byDeploy?.role || byGit?.role || "backend",
            expose_port,
          };
        }),
      );
    } catch (e) {
      await showSystemAlert("读取 Git 地址失败", String(e));
    } finally {
      setFillLoading(false);
    }
  };

  const rowToMap = (r: GridRow) =>
    createKsPublishMap({
      id: r.mapId,
      git_url: r.git_url.trim(),
      role: r.role,
      env_id: envId,
      namespace,
      deployment: r.deployment,
      container: r.container.trim() || undefined,
      expose_port: r.expose_port.trim() || undefined,
    });

  const saveNamespaceMaps = async () => {
    if (!envId || !namespace) {
      await showSystemAlert("无法保存", "请先选择环境并连接加载命名空间");
      return;
    }
    const toSave = rows.filter((r) => r.git_url.trim()).map(rowToMap);

    onMapsChange((prev) => {
      const rest = prev.filter(
        (m) => !(m.env_id === envId && m.namespace === namespace),
      );
      const next = [...rest, ...toSave];
      publishMapsRef.current = next;
      return next;
    });
    setRows(buildGridRows(deploys, publishMapsRef.current, envId, namespace));
    await showSystemAlert(
      "已保存到当前配置",
      `本命名空间已保存 ${toSave.length} 条 Git 映射（当前配置共 ${publishMapsRef.current.length} 条）。请点击页面底部「保存配置」写入磁盘。`,
    );
  };

  const flushNamespaceMapsToConfig = useCallback(() => {
    if (!envId || !namespace || rows.length === 0) return;
    const toSave = rows.filter((r) => r.git_url.trim()).map((r) =>
      createKsPublishMap({
        id: r.mapId,
        git_url: r.git_url.trim(),
        role: r.role,
        env_id: envId,
        namespace,
        deployment: r.deployment,
        container: r.container.trim() || undefined,
        expose_port: r.expose_port.trim() || undefined,
      }),
    );
    onMapsChange((prev) => {
      const rest = prev.filter(
        (m) => !(m.env_id === envId && m.namespace === namespace),
      );
      const next = [...rest, ...toSave];
      publishMapsRef.current = next;
      return next;
    });
  }, [envId, namespace, rows, onMapsChange]);

  useEffect(() => {
    onRegisterFlush?.(flushNamespaceMapsToConfig);
  }, [onRegisterFlush, flushNamespaceMapsToConfig]);

  const removeMap = (map: KsPublishMap) => {
    onMapsChange((prev) => prev.filter((m) => m.id !== map.id));
  };

  if (ksEnvs.length === 0) {
    return (
      <Text size="sm" c="var(--color-text-muted)">请先添加 KubeSphere 环境，再配置发布映射</Text>
    );
  }

  return (
    <Stack gap="md" className="ks-publish-maps-section">
      <Text size="sm" c="var(--color-text-muted)">
        选择环境后自动连接 → 再选命名空间列出部署。未保存过的行会按 klcj-zt 模块预填 Git 与端口；输入 Git 或选本地仓库时端口会一起带出。
      </Text>

      <Paper p="md" radius="md" styles={paperStyles}>
        <Stack gap="md">
          <Group align="flex-end" wrap="wrap" gap="md">
            <Select
              label="环境"
              value={envId}
              disabled={connecting}
              onChange={(next) => {
                if (!next) return;
                setEnvId(next);
                setConnected(false);
                setNamespace("");
                setNamespaces([]);
                setDeploys([]);
                setRows([]);
                void connect(next);
              }}
              data={ksEnvs.map((env) => ({
                value: env.id,
                label: env.name || env.id,
              }))}
              styles={fieldStyles}
              style={{ flex: "1 1 160px", minWidth: 160 }}
            />
            <Select
              label="命名空间"
              value={namespace || null}
              disabled={connecting || namespaces.length === 0}
              onChange={(next) => setNamespace(next ?? "")}
              placeholder="选择命名空间"
              data={namespaces.map((ns) => ({ value: ns, label: ns }))}
              styles={fieldStyles}
              style={{ flex: "1 1 160px", minWidth: 160 }}
            />
          </Group>

          <Group gap="sm" wrap="wrap">
            <Button
              variant="light"
              color="cyan"
              size="sm"
              disabled={connecting || !envId}
              onClick={() => void connect()}
              title="连接失败或命名空间过期时手动重连"
              leftSection={
                connecting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />
              }
            >
              {connecting ? "连接中…" : "重新连接"}
            </Button>
            <Button
              variant="light"
              color="cyan"
              size="sm"
              disabled={fillLoading || rows.length === 0}
              onClick={() => void fillGitFromLastRepo()}
              leftSection={
                fillLoading ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />
              }
            >
              空行填入当前仓库
            </Button>
            <Button
              variant="filled"
              color="cyan"
              size="sm"
              disabled={!connected || !namespace || rows.length === 0}
              onClick={() => void saveNamespaceMaps()}
              leftSection={<Save size={14} />}
            >
              保存本命名空间
            </Button>
          </Group>

          {statusText && (
            <Text size="sm" c="var(--color-text-muted)" className="ks-map-status">
              {statusText}
            </Text>
          )}

          {loadingDeploys && (
            <Group gap="xs">
              <Loader2 size={14} className="spin" />
              <Text size="sm" c="var(--color-text-muted)">加载部署中…</Text>
            </Group>
          )}

          {rows.length > 0 && (
            <div className="ks-map-grid-wrap">
              <table className="ks-map-grid">
                <thead>
                  <tr>
                    <th>部署</th>
                    <th>容器</th>
                    <th>角色</th>
                    <th>端口</th>
                    <th>Git 远程地址</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.deployment}>
                      <td className="ks-map-grid-deploy">{row.deployment}</td>
                      <td className="ks-map-grid-container">{row.container || "—"}</td>
                      <td>
                        <Select
                          size="xs"
                          value={row.role}
                          onChange={(value) => {
                            if (value) {
                              updateRow(row.deployment, {
                                role: value as KsPublishMapRole,
                              });
                            }
                          }}
                          data={ROLES.map((r) => ({ value: r.value, label: r.label }))}
                          styles={compactInputStyles}
                          comboboxProps={{ withinPortal: true }}
                        />
                      </td>
                      <td>
                        <TextInput
                          size="xs"
                          value={row.expose_port}
                          placeholder="9613"
                          onChange={(e) =>
                            updateRow(row.deployment, { expose_port: e.currentTarget.value })}
                          styles={compactInputStyles}
                          style={{ width: 72 }}
                        />
                      </td>
                      <td>
                        <TextInput
                          size="xs"
                          value={row.git_url}
                          placeholder="git@host:group/repo.git"
                          onChange={(e) =>
                            updateRow(row.deployment, { git_url: e.currentTarget.value })}
                          styles={compactInputStyles}
                          style={{ minWidth: 200 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {connected && !loadingDeploys && namespace && rows.length === 0 && (
            <Text size="sm" c="var(--color-text-muted)">该命名空间暂无 Deployment</Text>
          )}
        </Stack>
      </Paper>

      {otherMaps.length > 0 && (
        <Stack gap="xs">
          <Text size="sm" c="var(--color-text-muted)" className="ks-map-other-title">
            其他命名空间已保存的映射
          </Text>
          <div className="ks-env-list">
            {otherMaps.map((map) => (
              <div key={map.id} className="ks-env-row">
                <div className="ks-env-row-main">
                  <span className="ks-env-name">
                    <span className="ks-map-role-tag">{roleLabel(map.role)}</span>
                    {map.git_url || map.git_url_key}
                  </span>
                  <span className="ks-env-console">
                    {envNameById(map.env_id)} · {map.namespace}/{map.deployment}
                    {map.expose_port?.trim() ? ` · :${map.expose_port}` : ""}
                  </span>
                </div>
                <div className="ks-env-row-actions">
                  <button
                    type="button"
                    className="danger"
                    title="删除"
                    onClick={() => removeMap(map)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Stack>
      )}
    </Stack>
  );
}
