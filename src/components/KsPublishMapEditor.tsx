import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, FolderOpen, Loader2, RefreshCw, Save } from "lucide-react";
import type { HarborConfig, KsPublishMap, KsPublishMapRole } from "../types";
import { isTauriRuntime } from "../types";
import { resolveKsEnvironments } from "../utils/ksEnvironments";
import { createKsPublishMap } from "../utils/ksPublishMap";
import { showSystemAlert } from "../systemAlert";

const ROLES: { value: KsPublishMapRole; label: string }[] = [
  { value: "backend", label: "后端" },
  { value: "frontend", label: "前端" },
  { value: "any", label: "任意" },
];

interface DeployRow {
  name: string;
  containers: string[];
}

interface GridRow {
  deployment: string;
  container: string;
  role: KsPublishMapRole;
  git_url: string;
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
    return {
      deployment: d.name,
      container: existing?.container?.trim() || d.containers[0]?.trim() || "",
      role: existing?.role ?? "backend",
      git_url: existing?.git_url ?? "",
      mapId: existing?.id,
    };
  });
}

export function KsPublishMapEditor({
  config,
  onMapsChange,
}: {
  config: HarborConfig;
  onMapsChange: (maps: KsPublishMap[]) => void;
}) {
  const ksEnvs = resolveKsEnvironments(config);
  const publishMaps = config.ks_publish_maps ?? [];

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

  const connect = useCallback(async (targetEnvId?: string) => {
    const id = targetEnvId ?? envId;
    const env = ksEnvs.find((e) => e.id === id);
    if (!env) {
      setStatusText("请先添加 KubeSphere 环境");
      setConnected(false);
      return;
    }
    if (!isTauriRuntime()) {
      setStatusText("请在 Tauri 桌面窗口中连接");
      return;
    }
    const consoleUrl = env.console?.trim() || "";
    const username = env.username?.trim() || "";
    const password = env.password ?? "";
    if (!consoleUrl || !username || !password) {
      setStatusText(`环境「${env.name}」未配齐地址/账号/密码`);
      setConnected(false);
      return;
    }
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
      const ns = await invoke<string[]>("ks_list_namespaces");
      if (ns.length === 0) {
        setStatusText(`「${env.name}」未拿到命名空间，请重连`);
        return;
      }
      setNamespaces(ns);
      setConnected(true);
      const prefer = ns.includes("klcj-zt-dev") ? "klcj-zt-dev" : ns[0];
      setNamespace(prefer);
      setStatusText(`已连接「${env.name}」，共 ${ns.length} 个命名空间`);
    } catch (e) {
      setStatusText(`连接失败：${e}`);
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }, [envId, ksEnvs]);

  const loadDeploys = useCallback(async (ns: string) => {
    if (!connected || !ns) return;
    setLoadingDeploys(true);
    setStatusText(`正在加载 ${ns} 部署列表…`);
    try {
      const list = await invoke<DeployRow[]>("ks_list_deployments", { namespace: ns });
      setDeploys(list);
      setRows(buildGridRows(list, publishMaps, envId, ns));
      setStatusText(`已加载 ${list.length} 个部署`);
    } catch (e) {
      setDeploys([]);
      setRows([]);
      setStatusText(`加载部署失败：${e}`);
    } finally {
      setLoadingDeploys(false);
    }
  }, [connected, publishMaps, envId]);

  useEffect(() => {
    if (connected && namespace) {
      void loadDeploys(namespace);
    }
  }, [connected, namespace, loadDeploys]);

  const updateRow = (deployment: string, patch: Partial<GridRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.deployment === deployment ? { ...r, ...patch } : r)),
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
      setRows((prev) => prev.map((r) => (r.git_url.trim() ? r : { ...r, git_url: git })));
    } catch (e) {
      await showSystemAlert("读取 Git 地址失败", String(e));
    } finally {
      setFillLoading(false);
    }
  };

  const saveNamespaceMaps = async () => {
    if (!envId || !namespace) {
      await showSystemAlert("无法保存", "请先选择环境并连接加载命名空间");
      return;
    }
    const toSave = rows
      .filter((r) => r.git_url.trim())
      .map((r) =>
        createKsPublishMap({
          id: r.mapId,
          git_url: r.git_url.trim(),
          role: r.role,
          env_id: envId,
          namespace,
          deployment: r.deployment,
          container: r.container.trim() || undefined,
        }),
      );

    const dup = new Set<string>();
    for (const m of toSave) {
      const key = `${m.git_url_key}\0${m.role}`;
      if (dup.has(key)) {
        await showSystemAlert("重复映射", `同一 Git 地址 + 角色「${roleLabel(m.role)}」出现多次，请检查`);
        return;
      }
      dup.add(key);
    }

    const rest = publishMaps.filter(
      (m) => !(m.env_id === envId && m.namespace === namespace),
    );
    onMapsChange([...rest, ...toSave]);
    setRows(buildGridRows(deploys, [...rest, ...toSave], envId, namespace));
    await showSystemAlert(
      "已保存到当前配置",
      `本命名空间已保存 ${toSave.length} 条 Git 映射。请点击页面底部「保存配置」写入磁盘。`,
    );
  };

  const removeMap = (map: KsPublishMap) => {
    onMapsChange(publishMaps.filter((m) => m.id !== map.id));
  };

  if (ksEnvs.length === 0) {
    return (
      <p className="template-hint">请先添加 KubeSphere 环境，再配置发布映射</p>
    );
  }

  return (
    <div className="ks-publish-maps-section">
      <p className="template-hint" style={{ margin: 0 }}>
        选择环境并连接 → 选命名空间自动列出部署 → 每行填 Git 地址即可（无需手打部署名）
      </p>

      <div className="ks-map-context-bar">
        <div className="ks-map-context-field">
          <label>环境</label>
          <div className="config-select-wrapper">
            <select
              className="config-select"
              value={envId}
              onChange={(e) => {
                setEnvId(e.target.value);
                setConnected(false);
                setNamespace("");
                setDeploys([]);
                setRows([]);
              }}
            >
              {ksEnvs.map((env) => (
                <option key={env.id} value={env.id}>{env.name || env.id}</option>
              ))}
            </select>
            <ChevronDown size={16} className="config-select-icon" aria-hidden />
          </div>
        </div>
        <div className="ks-map-context-field">
          <label>命名空间</label>
          <div className="config-select-wrapper">
            <select
              className="config-select"
              value={namespace}
              disabled={!connected || namespaces.length === 0}
              onChange={(e) => setNamespace(e.target.value)}
            >
              {!namespace && <option value="">选择命名空间</option>}
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
            <ChevronDown size={16} className="config-select-icon" aria-hidden />
          </div>
        </div>
        <button
          type="button"
          className="config-add-env-btn"
          disabled={connecting || !envId}
          onClick={() => void connect()}
        >
          {connecting ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          {connected ? "重新连接" : "连接并加载"}
        </button>
        <button
          type="button"
          className="config-add-env-btn"
          disabled={fillLoading || rows.length === 0}
          onClick={() => void fillGitFromLastRepo()}
        >
          {fillLoading ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
          空行填入当前仓库
        </button>
        <button
          type="button"
          className="config-add-env-btn ks-map-save-btn"
          disabled={!connected || !namespace || rows.length === 0}
          onClick={() => void saveNamespaceMaps()}
        >
          <Save size={14} />
          保存本命名空间
        </button>
      </div>

      {statusText && <p className="template-hint ks-map-status">{statusText}</p>}

      {loadingDeploys && (
        <p className="template-hint"><Loader2 size={14} className="spin" /> 加载部署中…</p>
      )}

      {rows.length > 0 && (
        <div className="ks-map-grid-wrap">
          <table className="ks-map-grid">
            <thead>
              <tr>
                <th>部署</th>
                <th>容器</th>
                <th>角色</th>
                <th>Git 远程地址</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.deployment}>
                  <td className="ks-map-grid-deploy">{row.deployment}</td>
                  <td className="ks-map-grid-container">{row.container || "—"}</td>
                  <td>
                    <div className="config-select-wrapper config-select-wrapper--compact">
                      <select
                        className="config-select config-select--compact"
                        value={row.role}
                        onChange={(e) =>
                          updateRow(row.deployment, {
                            role: e.target.value as KsPublishMapRole,
                          })}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="config-select-icon" aria-hidden />
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="ks-map-git-input"
                      value={row.git_url}
                      placeholder="git@host:group/repo.git"
                      onChange={(e) =>
                        updateRow(row.deployment, { git_url: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {connected && !loadingDeploys && namespace && rows.length === 0 && (
        <p className="template-hint">该命名空间暂无 Deployment</p>
      )}

      {otherMaps.length > 0 && (
        <>
          <p className="template-hint ks-map-other-title">其他命名空间已保存的映射</p>
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
        </>
      )}
    </div>
  );
}
