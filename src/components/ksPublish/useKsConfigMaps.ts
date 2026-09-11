import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type { ConfigMapInfo } from "./types";
import { syncSwAgentNameIfPresent } from "./utils";

export function useKsConfigMaps(opts: {
  connected: boolean;
  namespace: string | null;
  mainTab: string | null;
  createOpen: boolean;
  editOpen: boolean;
}) {
  const { connected, namespace, mainTab, createOpen, editOpen } = opts;

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
  const cmInFlightRef = useRef(false);

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

  // ConfigMap 页签懒加载：进入时才拉，避免与部署列表抢带宽/主线程
  useEffect(() => {
    if (connected && namespace && mainTab === "config") void loadCms();
  }, [connected, namespace, mainTab, loadCms]);

  // 创建/编辑弹窗打开时刷新 ConfigMap（含切换命名空间后仍保持弹窗打开的场景）
  useEffect(() => {
    if (connected && namespace && (createOpen || editOpen)) void loadCms();
  }, [connected, namespace, createOpen, editOpen, loadCms]);

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

  const cmTotalPages = Math.max(1, Math.ceil(cms.length / cmPageSize));
  const cmSafePage = Math.min(cmPage, cmTotalPages);
  const cmPageRows = cms.slice((cmSafePage - 1) * cmPageSize, cmSafePage * cmPageSize);

  useEffect(() => {
    setCmPage(1);
  }, [cmPageSize, namespace]);

  useEffect(() => {
    if (cmPage !== cmSafePage) setCmPage(cmSafePage);
  }, [cmPage, cmSafePage]);

  const cmSelectPlaceholder = cmLoading
    ? "正在加载 ConfigMap…"
    : cms.length
      ? "选择当前命名空间的 ConfigMap"
      : "当前命名空间暂无 ConfigMap";

  const resetCmsOnNamespaceChange = useCallback(() => {
    setCms([]);
    setCmPage(1);
  }, []);

  const openCmCreate = () => {
    setCmMode("form");
    setCmForm({ name: "", data: "" });
    setCmYaml("");
    setCmPreview("");
    setCmOpen(true);
  };

  return {
    cms,
    setCms,
    cmLoading,
    cmPage,
    setCmPage,
    cmPageSize,
    setCmPageSize,
    cmOpen,
    setCmOpen,
    cmMode,
    setCmMode,
    cmForm,
    setCmForm,
    cmYaml,
    setCmYaml,
    cmPreview,
    setCmPreview,
    cmBusy,
    setCmBusy,
    loadCms,
    doCmCreate,
    doCmPreview,
    copyCmFrom,
    cmTotalPages,
    cmSafePage,
    cmPageRows,
    cmSelectPlaceholder,
    resetCmsOnNamespaceChange,
    openCmCreate,
  };
}

export type KsConfigMapsApi = ReturnType<typeof useKsConfigMaps>;
