import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import type { ConfirmOptions } from "../../hooks/useConfirmDialog";
import type { HarborConfig, KsPublishMap, GitBranchOption } from "../../types";
import { isTauriRuntime } from "../../types";
import {
  type DeployInfo,
  type DeployEditInfo,
  type DeployRevision,
  type UpdateResult,
  type KsCreateGitForm,
  type KsImageSource,
  EMPTY_DEPLOY_FORM,
  EMPTY_CREATE_GIT_FORM,
} from "./types";
import { isRfc1123Name, buildRevisionDurationMap, copyText } from "./utils";
import {
  ensureKsConnected,
  packSlotFromDeployment,
  resolveKsBatchTargets,
  type KsBatchNpmScriptPref,
} from "../../utils/ksBatchPackPublish";
import {
  primaryImageForKsRole,
  runBranchPackageAndPush,
} from "../../hooks/branch/branchPackageRun";
import { upsertKsPublishMapForDeployment } from "../../utils/ksPublishMap";
import { appendBuildProgressLog, capLogLines } from "../../utils/buildProgressLog";
import { resolveRepoPathForGitUrl } from "../../utils/resolveRepoPath";
import { fetchGitBranchesForRepoPaths } from "../../utils/ksBatchGitBranches";
import { rememberKsBatchBranch } from "../../utils/ksBatchBranchHistory";
import { listMavenModules, detectModuleServerPort, type MavenModuleInfo, type ModuleServerPort } from "../../utils/ksMavenModules";
import { getRememberedBranchAdvancedSettings } from "../../branchSettings";

/** 诊断日志（模块名遵循 AGENTS.md 约定） */
function ksDiag(module: "kubesphere" | "build" | "git", message: string): void {
  void invoke("write_diagnostic_log", { module, message }).catch(() => {
    /* 诊断写入失败不打断主流程 */
  });
}

/** 健康检查路径：空则默认 /actuator/health，缺前导 / 则补上 */
export function normalizeHealthPath(raw: string): string {
  const path = raw.trim() || "/actuator/health";
  return path.startsWith("/") ? path : `/${path}`;
}

/** 创建 / 预览 / 更新共用的表单 → invoke 载荷（不含 namespace / dryRun / container） */
export function buildCreatePayload(f: typeof EMPTY_DEPLOY_FORM, name: string) {
  return {
    name,
    image: f.image.trim(),
    alias: f.alias.trim() || undefined,
    port: f.port,
    replicas: f.replicas,
    envs: f.envs.split("\n").map((l) => l.trim()).filter(Boolean),
    configMap: f.configMap || undefined,
    healthPath: normalizeHealthPath(f.healthPath),
  };
}

function validateCreateForm(
  f: typeof EMPTY_DEPLOY_FORM,
  requireImage = true,
): string | null {
  const depName = f.name.trim().toLowerCase();
  if (!depName) {
    notifications.show({ color: "yellow", message: "请填写部署名称" });
    return null;
  }
  if (requireImage && !f.image.trim()) {
    notifications.show({ color: "yellow", message: "请填写部署名称与镜像地址" });
    return null;
  }
  if (!isRfc1123Name(depName)) {
    notifications.show({
      color: "yellow",
      title: "部署名称不合法",
      message: "须为小写字母/数字/'-'/'.'，且以字母或数字开头结尾（例：klcj-test-service）",
    });
    return null;
  }
  if (!f.port || f.port < 1 || f.port > 65535) {
    notifications.show({ color: "yellow", message: "请填写有效的容器端口（1–65535）" });
    return null;
  }
  return depName;
}

export function useKsDeployMutations(opts: {
  namespace: string | null;
  connected: boolean;
  sel: DeployInfo | null;
  setSel: Dispatch<SetStateAction<DeployInfo | null>>;
  load: (opts?: { silent?: boolean; withCms?: boolean }) => void | Promise<void>;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** 当前 Harbor 配置（创建部署 Git 构建：解析发布映射 / 记住的构建设置） */
  config: HarborConfig;
  /** 当前 KubeSphere 环境 id（Git 构建后确保连接再创建） */
  envId: string | null;
  /** 创建部署成功后写回发布映射（便于之后批量打包） */
  onPublishMapsChange?: (maps: NonNullable<HarborConfig["ks_publish_maps"]>) => void;
  /** 局部写盘前取最新整表 */
  getConfigSnapshot?: () => HarborConfig;
}) {
  const {
    namespace, connected, sel, setSel, load, confirm,
    config, envId, onPublishMapsChange, getConfigSnapshot,
  } = opts;

  const [image, setImage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({ ...EMPTY_DEPLOY_FORM });
  const [editPreviewYaml, setEditPreviewYaml] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_DEPLOY_FORM });
  const [createSource, setCreateSource] = useState<KsImageSource>("image");
  const [createGit, setCreateGit] = useState<KsCreateGitForm>({ ...EMPTY_CREATE_GIT_FORM });
  const [createGitBranches, setCreateGitBranches] = useState<string[]>([]);
  const [createGitBranchesLoading, setCreateGitBranchesLoading] = useState(false);
  const [createGitBranchesError, setCreateGitBranchesError] = useState("");
  const [createGitRepoPath, setCreateGitRepoPath] = useState<string | null>(null);
  const [createGitModules, setCreateGitModules] = useState<MavenModuleInfo[]>([]);
  const [createGitModulesLoading, setCreateGitModulesLoading] = useState(false);
  const [createGitDetectedPort, setCreateGitDetectedPort] = useState<ModuleServerPort | null>(null);
  const [createGitPortLoading, setCreateGitPortLoading] = useState(false);
  const gitBranchesUrlRef = useRef("");
  /** 当前容器端口 / 上次自动回填的端口：避免覆盖用户手改 */
  const createFormPortRef = useRef(createForm.port);
  createFormPortRef.current = createForm.port;
  const autoPortRef = useRef<number | null>(null);
  const [createProgress, setCreateProgress] = useState({
    running: false,
    percent: 0,
    message: "",
    log: "",
  });
  const [previewYaml, setPreviewYaml] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [revisions, setRevisions] = useState<DeployRevision[]>([]);
  const [revsLoading, setRevsLoading] = useState(false);
  const [revPage, setRevPage] = useState(1);
  const [revPageSize, setRevPageSize] = useState(10);

  const createNpmScriptPref = useMemo<KsBatchNpmScriptPref>(
    () => ({ mode: createGit.npmMode, customScript: createGit.npmCustom.trim() }),
    [createGit.npmMode, createGit.npmCustom],
  );

  // Git 创建：累积 build-progress 日志（与批量发布同一事件源）
  useEffect(() => {
    if (!createProgress.running || !isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        const { percent, message } = event.payload;
        setCreateProgress((prev) => ({
          ...prev,
          percent: Math.max(prev.percent, percent),
          message: message || prev.message,
          log: capLogLines(appendBuildProgressLog(prev.log, message)),
        }));
      },
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [createProgress.running]);

  /** 解析本地仓库的可执行 Maven 模块（供「手选打包模块」下拉） */
  const loadCreateGitModulesForRepo = useCallback(async (repoPath: string | null) => {
    if (!repoPath) {
      setCreateGitModules([]);
      return;
    }
    setCreateGitModulesLoading(true);
    try {
      const mods = await listMavenModules(repoPath);
      setCreateGitModules(mods);
      // 手选模块已不存在（换仓库/换分支）时回退自动匹配
      setCreateGit((prev) =>
        prev.mavenModule && !mods.some((m) => m.relPath === prev.mavenModule)
          ? { ...prev, mavenModule: "" }
          : prev,
      );
    } catch {
      setCreateGitModules([]);
    } finally {
      setCreateGitModulesLoading(false);
    }
  }, []);

  /**
   * 基于填写的 Git 地址拉取分支：优先 `git ls-remote`（无需本地仓库），
   * 失败时回退到本地仓库 `git fetch`。force=false（失焦自动触发）时不重复拉取同一 URL。
   */
  const refreshCreateGitBranches = useCallback(async (force = false) => {
    const gitUrl = createGit.url.trim();
    if (!gitUrl) {
      setCreateGitBranches([]);
      setCreateGitBranchesError("");
      setCreateGitRepoPath(null);
      setCreateGitModules([]);
      gitBranchesUrlRef.current = "";
      return;
    }
    if (!isTauriRuntime()) {
      setCreateGitBranchesError("请在 Tauri 桌面窗口中操作");
      return;
    }
    if (!force && gitUrl === gitBranchesUrlRef.current) return;
    gitBranchesUrlRef.current = gitUrl;
    setCreateGitBranchesLoading(true);
    setCreateGitBranchesError("");
    setCreateGitRepoPath(null);
    ksDiag("git", `创建部署(Git) 拉取分支 git=${gitUrl}`);

    const toNames = (opts: GitBranchOption[]) =>
      opts.map((o) => o.name?.trim()).filter((n): n is string => !!n);

    try {
      let branches: string[] = [];
      let errMsg = "";

      // 本地仓库：分支回退与 Maven 手选模块都要用（会话内缓存，命中很快）
      let repoPath: string | null = null;
      try {
        repoPath = await resolveRepoPathForGitUrl(
          gitUrl,
          config,
          createForm.name.trim() || undefined,
        );
      } catch {
        repoPath = null;
      }
      setCreateGitRepoPath(repoPath);

      // 1) 直接按 Git 地址 ls-remote（无需本地仓库）
      try {
        branches = toNames(
          await invoke<GitBranchOption[]>("list_git_branches_from_url", { url: gitUrl }),
        );
      } catch (e) {
        errMsg = String(e);
      }

      // 2) 回退：解析到本地仓库后 git fetch
      if (branches.length === 0 && repoPath) {
        try {
          branches = await fetchGitBranchesForRepoPaths([repoPath]);
        } catch (e) {
          errMsg = errMsg || String(e);
        }
      }
      if (branches.length === 0 && !repoPath && !errMsg) {
        errMsg = `找不到 Git「${gitUrl}」对应的本地仓库（请先在「分支打包」页打开过该仓库）`;
      }

      setCreateGitBranches(branches);
      if (branches.length === 0) {
        setCreateGitBranchesError(errMsg || "未获取到可用分支");
      } else {
        // 未选分支时默认选中第一个，减少一步操作
        setCreateGit((prev) =>
          prev.branch.trim() ? prev : { ...prev, branch: branches[0] },
        );
      }

      await loadCreateGitModulesForRepo(repoPath);
    } catch (e) {
      setCreateGitBranches([]);
      setCreateGitBranchesError(String(e));
    } finally {
      setCreateGitBranchesLoading(false);
    }
  }, [createGit.url, config, createForm.name, loadCreateGitModulesForRepo]);

  /**
   * 手选 Maven 模块后，从该模块（指定分支）读 `server.port`，回填容器端口。
   * 只在用户没手改过端口时覆盖（默认 8080 或等于上次自动回填值）。
   */
  useEffect(() => {
    if (createSource !== "git" || createGit.role !== "backend") return;
    const repoPath = createGitRepoPath;
    const moduleRel = createGit.mavenModule.trim();
    const branch = createGit.branch.trim();
    if (!repoPath || !moduleRel || !branch) {
      setCreateGitDetectedPort(null);
      return;
    }
    let cancelled = false;
    setCreateGitPortLoading(true);
    void (async () => {
      try {
        const springProfile = getRememberedBranchAdvancedSettings(config, repoPath).springProfile;
        const info = await detectModuleServerPort({
          repoPath,
          branch,
          moduleRelPath: moduleRel,
          springProfile,
        });
        if (cancelled) return;
        setCreateGitDetectedPort(info);
        if (info) {
          const current = createFormPortRef.current;
          const untouched = autoPortRef.current === null
            ? current === 8080
            : current === autoPortRef.current;
          if (untouched && current !== info.port) {
            autoPortRef.current = info.port;
            setCreateForm((prev) => ({ ...prev, port: info.port }));
          }
        }
      } catch {
        if (!cancelled) setCreateGitDetectedPort(null);
      } finally {
        if (!cancelled) setCreateGitPortLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    createSource,
    createGit.role,
    createGit.mavenModule,
    createGit.branch,
    createGitRepoPath,
    config,
    setCreateForm,
  ]);

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

  /** Git 构建模式：先打包推送镜像，再用产物镜像创建 Deployment */
  const createFromGit = async (depName: string) => {
    const gitUrl = createGit.url.trim();
    const branch = createGit.branch.trim();
    if (!envId || !namespace) {
      notifications.show({ color: "yellow", message: "请先连接环境并选择命名空间" });
      return;
    }
    if (!gitUrl) {
      notifications.show({ color: "yellow", message: "请填写 Git 地址" });
      return;
    }
    if (!branch) {
      notifications.show({ color: "yellow", message: "请填写分支" });
      return;
    }
    if (!isTauriRuntime()) {
      notifications.show({ color: "yellow", message: "请在 Tauri 桌面窗口中操作" });
      return;
    }

    const appendLog = (line: string) =>
      setCreateProgress((prev) => ({
        ...prev,
        log: capLogLines(prev.log ? `${prev.log}\n${line}` : line),
      }));

    setCreateBusy(true);
    setCreateProgress({ running: true, percent: 0, message: "正在解析本地仓库…", log: "" });
    ksDiag(
      "kubesphere",
      `创建部署(Git) 解析仓库 deploy=${depName} git=${gitUrl} branch=${branch} role=${createGit.role}`,
    );
    try {
      const { targets, skips } = await resolveKsBatchTargets(
        config,
        envId,
        namespace,
        [{ name: depName, containers: [] }],
        branch,
        createNpmScriptPref,
        {
          [depName]: {
            gitUrl,
            role: createGit.role,
            mavenModule: createGit.mavenModule,
          },
        },
      );
      if (targets.length === 0) {
        throw new Error(
          skips[0]
            ?? `找不到 Git「${gitUrl}」对应的本地仓库（请先在分支打包页打开过该仓库）`,
        );
      }
      const target = targets[0];
      appendLog(
        `目标仓库：${target.repoPath}（${target.projectType === "npm" ? "前端" : "后端"}）`,
      );
      // 后端：镜像以 --server.port=<容器端口> 启动，保证镜像监听端口 = Deployment 容器端口/探针端口
      const effectivePort = target.projectType === "maven"
        ? String(createForm.port)
        : target.exposePort;
      setCreateProgress((prev) => ({
        ...prev,
        message: `正在打包并推送镜像 · ${depName}…`,
      }));

      const packResult = await runBranchPackageAndPush({
        config,
        repoPath: target.repoPath,
        branchName: branch,
        branchProjectType: target.projectType,
        frontendDir: target.frontendDir,
        selectedBuildScript: target.selectedBuildScript,
        packageWithBackend: target.packageWithBackend,
        springProfile: target.springProfile,
        branchExposePort: effectivePort,
        nginxLocations: target.nginxLocations,
        autoPushImage: true,
        progressLabel: depName,
        deploymentHint: depName,
        mavenModule: createGit.mavenModule || undefined,
        packSlot: packSlotFromDeployment(depName),
        skipBtDeploy: true,
      });
      if (!packResult.ok) {
        throw new Error(
          packResult.error
            ?? (packResult.pushErrors.join("；") || "打包或推送失败"),
        );
      }
      const image = primaryImageForKsRole(packResult.images, target.role);
      if (!image) throw new Error("镜像推送成功但未拿到镜像地址");
      appendLog(`✓ 已推送镜像 ${image}`);
      ksDiag("build", `创建部署(Git) 推送成功 image=${image}`);

      setCreateProgress((prev) => ({ ...prev, message: "正在连接 KubeSphere…" }));
      await ensureKsConnected(config, envId);

      setCreateProgress((prev) => ({ ...prev, message: `正在创建 Deployment · ${depName}…` }));
      ksDiag(
        "kubesphere",
        `创建部署(Git) ks_create_deployment ns=${namespace} deploy=${depName} image=${image}`,
      );
      const msg = await invoke<string>("ks_create_deployment", {
        namespace,
        ...buildCreatePayload(createForm, depName),
        image,
        dryRun: false,
      });

      if (onPublishMapsChange) {
        const snapshot = getConfigSnapshot?.() ?? config;
        const baseMaps: KsPublishMap[] = snapshot.ks_publish_maps ?? [];
        const { maps, action } = upsertKsPublishMapForDeployment(baseMaps, {
          git_url: gitUrl,
          role: createGit.role,
          env_id: envId,
          namespace,
          deployment: depName,
          expose_port: effectivePort,
          maven_module: target.mavenModule,
        });
        if (action !== "none") {
          onPublishMapsChange(maps);
          appendLog(`✓ 已${action === "created" ? "写入" : "更新"}发布映射（之后可用于批量打包）`);
        }
      }

      notifications.show({
        color: "green",
        title: "构建并创建成功",
        message: `${msg} · ${image}`,
        autoClose: 6000,
      });
      setCreateOpen(false);
      setCreateForm({ ...EMPTY_DEPLOY_FORM });
      setCreateGit({ ...EMPTY_CREATE_GIT_FORM });
      autoPortRef.current = null;
      setCreateGitDetectedPort(null);
      setPreviewYaml("");
      rememberKsBatchBranch(branch);
      void load({ silent: true });
    } catch (e) {
      ksDiag("kubesphere", `创建部署(Git) 失败 deploy=${depName}: ${String(e)}`);
      notifications.show({
        color: "red",
        title: "构建并创建失败",
        message: String(e),
        autoClose: 8000,
      });
    } finally {
      setCreateBusy(false);
      setCreateProgress((prev) => ({ ...prev, running: false, message: "" }));
    }
  };

  const doCreate = async (dry: boolean) => {
    const f = createForm;
    if (!namespace) {
      notifications.show({ color: "yellow", message: "请先选择命名空间" });
      return;
    }
    const depName = validateCreateForm(f, createSource === "image");
    if (!depName) return;
    if (f.name !== depName) setCreateForm({ ...f, name: depName });

    if (createSource === "git") {
      if (dry) {
        notifications.show({
          color: "yellow",
          message: "Git 构建模式会先打包推送镜像，请直接点「构建并创建」",
        });
        return;
      }
      await createFromGit(depName);
      return;
    }

    setCreateBusy(true);
    try {
      const msg = await invoke<string>("ks_create_deployment", {
        namespace,
        ...buildCreatePayload(f, depName),
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
    const depName = validateCreateForm(f);
    if (!depName) return;
    if (f.name !== depName) setCreateForm({ ...f, name: depName });
    setCreateBusy(true);
    try {
      const yaml = await invoke<string>("ks_preview_deployment", {
        namespace,
        ...buildCreatePayload(f, depName),
      });
      setPreviewYaml(yaml);
    } catch (e) {
      notifications.show({ color: "red", title: "预览失败", message: String(e) });
    } finally {
      setCreateBusy(false);
    }
  };

  const copyYaml = async () => {
    await copyText(previewYaml);
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
    setSubmitting(true);
    try {
      const r = await invoke<UpdateResult>("ks_update_deployment", {
        namespace,
        ...buildCreatePayload(editForm, editForm.name.trim()),
        container: editForm.container || selContainer || undefined,
      });
      notifications.show({
        color: r.ok ? "green" : "red",
        title: r.ok ? "更新成功" : "更新失败",
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
        title: r.ok ? "发布成功" : "发布失败",
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
    setSubmitting(true);
    try {
      const yaml = await invoke<string>("ks_preview_deployment", {
        namespace,
        ...buildCreatePayload(editForm, editForm.name.trim()),
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
    setCreateProgress({ running: false, percent: 0, message: "", log: "" });
    setPreviewYaml("");
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
    createSource,
    setCreateSource,
    createGit,
    setCreateGit,
    createGitBranches,
    createGitBranchesLoading,
    createGitBranchesError,
    createGitRepoPath,
    createGitModules,
    createGitModulesLoading,
    createGitDetectedPort,
    createGitPortLoading,
    refreshCreateGitBranches,
    createProgress,
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
