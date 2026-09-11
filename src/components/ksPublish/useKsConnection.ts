import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type { HarborConfig } from "../../types";
import { pickKsEnvironment, resolveKsEnvironments } from "../../utils/ksEnvironments";
import type { DeployInfo } from "./types";
import { deployListFingerprint } from "./utils";

/**
 * KS 连接 + 部署列表加载。
 * loadCms / mainTab / resetCms 由面板注入；自动刷新留在面板（依赖 batchUiActive）。
 */
export function useKsConnection({
  config,
  configReady = true,
  onLastEnvChange,
  mainTab,
  loadCms,
  resetCmsOnNamespaceChange,
}: {
  config: HarborConfig;
  configReady?: boolean;
  onLastEnvChange?: (id: string) => void;
  mainTab: string | null;
  loadCms: () => void | Promise<void>;
  resetCmsOnNamespaceChange: () => void;
}) {
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState("30");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");

  const loadInFlightRef = useRef(false);
  const loadSeqRef = useRef(0);
  const connectGenRef = useRef(0);
  const deploysFpRef = useRef("");
  const loadCmsRef = useRef(loadCms);
  loadCmsRef.current = loadCms;
  const resetCmsRef = useRef(resetCmsOnNamespaceChange);
  resetCmsRef.current = resetCmsOnNamespaceChange;

  const selectedEnv = pickKsEnvironment(envs, envId);
  const envIdsFp = envs.map((e) => e.id).join(",");
  const currentCredFp = selectedEnv
    ? `${selectedEnv.id}:${selectedEnv.console}:${selectedEnv.username}:${selectedEnv.password}`
    : "";

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
    const consoleUrl = env.console || "";
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
  }, [configReady, envIdsFp, currentCredFp]);

  const load = useCallback(async (opts: { silent?: boolean; withCms?: boolean } = {}) => {
    const { silent = false, withCms = false } = opts;
    if (!connected || !namespace) return;
    if (loadInFlightRef.current) {
      if (silent) return;
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
      if (withCms) void loadCmsRef.current();
    } catch (e) {
      if (seq === loadSeqRef.current && !silent) {
        notifications.show({ color: "red", message: String(e) });
      }
    } finally {
      loadInFlightRef.current = false;
      if (seq === loadSeqRef.current && !silent) setLoading(false);
    }
  }, [connected, namespace]);

  const handleRefreshOrReconnect = () => {
    if (!connected) {
      void connect(envId);
      return;
    }
    void load({ silent: false, withCms: mainTab === "config" });
  };

  useEffect(() => {
    resetCmsRef.current();
    if (connected && namespace) void load({ silent: false, withCms: mainTab === "config" });
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

  return {
    envs,
    envId,
    selectedEnv,
    currentCredFp,
    connected,
    connecting,
    namespaces,
    namespace,
    setNamespace,
    deploys,
    loading,
    sel,
    setSel,
    checkedNames,
    setCheckedNames,
    toggleDeployCheck,
    autoRefresh,
    setAutoRefresh,
    refreshSec,
    setRefreshSec,
    lastRefresh,
    statusText,
    connect,
    switchEnv,
    load,
    handleRefreshOrReconnect,
  };
}

export type KsConnectionApi = ReturnType<typeof useKsConnection>;
