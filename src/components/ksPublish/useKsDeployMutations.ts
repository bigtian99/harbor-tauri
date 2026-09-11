import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type { ConfirmOptions } from "../../hooks/useConfirmDialog";
import {
  type DeployInfo,
  type DeployEditInfo,
  type DeployRevision,
  type UpdateResult,
  EMPTY_DEPLOY_FORM,
} from "./types";
import { isRfc1123Name, buildRevisionDurationMap } from "./utils";

export function useKsDeployMutations(opts: {
  namespace: string | null;
  connected: boolean;
  sel: DeployInfo | null;
  setSel: Dispatch<SetStateAction<DeployInfo | null>>;
  load: (opts?: { silent?: boolean; withCms?: boolean }) => void | Promise<void>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}) {
  const { namespace, connected, sel, setSel, load, confirm } = opts;

  const [image, setImage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({ ...EMPTY_DEPLOY_FORM });
  const [editPreviewYaml, setEditPreviewYaml] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_DEPLOY_FORM });
  const [previewYaml, setPreviewYaml] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [revisions, setRevisions] = useState<DeployRevision[]>([]);
  const [revsLoading, setRevsLoading] = useState(false);
  const [revPage, setRevPage] = useState(1);
  const [revPageSize, setRevPageSize] = useState(10);

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
  }, [namespace, setSel]);

  return {
    image,
    setImage,
    submitting,
    editOpen,
    setEditOpen,
    editLoading,
    editForm,
    setEditForm,
    editPreviewYaml,
    setEditPreviewYaml,
    createOpen,
    setCreateOpen,
    createForm,
    setCreateForm,
    previewYaml,
    createBusy,
    revisions,
    revsLoading,
    revPage,
    setRevPage,
    revPageSize,
    setRevPageSize,
    revTotalPages,
    revSafePage,
    revPageRows,
    revDurationMap,
    selContainer,
    loadRevisions,
    doCreate,
    doPreview,
    copyYaml,
    copyText,
    submit,
    submitImageOnly,
    doEditPreview,
    rollback,
    beginCreate,
    beginEdit,
  };
}

export type KsDeployMutationsApi = ReturnType<typeof useKsDeployMutations>;
