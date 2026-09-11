import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import type { HarborConfig, KsEnvironment, KsPublishMap } from "../../types";
import { isTauriRuntime } from "../../types";
import { pickKsEnvironment } from "../../utils/ksEnvironments";
import type {
  KsBatchConfirmValues,
  KsBatchMeta,
  KsBatchSummary,
} from "../KsBatchPackModal";
import type { KsBatchCloneConfirmMeta, KsBatchCloneConfirmValues } from "../KsBatchCloneModal";
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
  collectKsBatchRepoPaths,
  type KsBatchConcurrencyPref,
} from "../../utils/ksBatchPackPublish";
import { mergeKsBatchReposSequential } from "../../utils/ksBatchMerge";
import { runKsBatchCloneToEnv } from "../../utils/ksBatchCloneDeploy";
import {
  loadKsBatchBranchHistory,
  rememberKsBatchBranch,
} from "../../utils/ksBatchBranchHistory";
import {
  buildKsBatchBranchOptionGroups,
  loadKsBatchGitBranches,
} from "../../utils/ksBatchGitBranches";
import {
  appendBuildProgressLog,
  normalizeBatchBranchInput,
  scaleBatchBuildPercent,
} from "../../utils/buildProgressLog";

export function useKsBatchActions({
  config,
  envId,
  namespace,
  selectedEnv,
  envs,
  selectedDeploys,
  getConfigSnapshot,
  onPublishMapsChange,
  connect,
  reloadDeploysSilent,
}: {
  config: HarborConfig;
  envId: string | null;
  namespace: string | null;
  selectedEnv: KsEnvironment | null | undefined;
  envs: KsEnvironment[];
  selectedDeploys: Array<{ name: string; containers: string[] }>;
  getConfigSnapshot?: () => HarborConfig;
  onPublishMapsChange?: (maps: KsPublishMap[]) => void;
  connect: (id?: string | null) => void | Promise<void>;
  reloadDeploysSilent: () => void;
}) {
  const [batchBranch, setBatchBranch] = useState("");
  const [branchHistory, setBranchHistory] = useState(() => loadKsBatchBranchHistory());
  const [batchGitBranches, setBatchGitBranches] = useState<string[]>([]);
  const [batchGitRepoCount, setBatchGitRepoCount] = useState(0);
  const [batchGitBranchesLoading, setBatchGitBranchesLoading] = useState(false);
  const [batchGitBranchesError, setBatchGitBranchesError] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchMeta, setBatchMeta] = useState<KsBatchMeta | null>(null);
  const [batchMergeRepoPaths, setBatchMergeRepoPaths] = useState<string[]>([]);
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
  const batchStepLabelRef = useRef("");
  const batchItemIndexRef = useRef(0);
  const batchItemTotalRef = useRef(1);

  const batchCpuCores = useMemo(() => detectCpuCores(), []);
  const batchRecommendedConcurrency = useMemo(
    () => recommendKsBatchConcurrency({
      itemCount: batchMeta?.deployNames.length ?? selectedDeploys.length,
      cpuCores: batchCpuCores,
    }),
    [batchMeta?.deployNames.length, selectedDeploys.length, batchCpuCores],
  );

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

  const beginBatchPack = () => {
    if (!envId || !namespace || selectedDeploys.length === 0) return;
    if (!isTauriRuntime()) {
      notifications.show({ color: "yellow", message: "请在 Tauri 桌面窗口中操作" });
      return;
    }

    const deployNames = selectedDeploys.map((d) => d.name);
    const deployments = selectedDeploys.map((d) => ({
      name: d.name,
      containers: d.containers,
    }));
    startTransition(() => {
      setBatchMeta({
        branch: batchBranch.trim(),
        namespace,
        envName: selectedEnv?.name ?? envId,
        deployNames,
        deployRoles: resolveKsBatchDeployRoles(config, envId, namespace, deployNames),
      });
      setBatchMergeRepoPaths([]);
      setBatchConfirmOpen(true);
    });
    void collectKsBatchRepoPaths(config, envId, namespace, deployments).then(({ repoPaths }) => {
      setBatchMergeRepoPaths(repoPaths);
    });
  };

  const startBatchPack = async (values: KsBatchConfirmValues) => {
    if (!envId || !namespace || !batchMeta) return;
    const branch = normalizeBatchBranchInput(values.branch);
    if (!branch) {
      notifications.show({ color: "yellow", message: "请填写目标分支" });
      return;
    }
    if (values.mergeBeforePack && !values.sourceBranch.trim()) {
      notifications.show({ color: "yellow", message: "请填写合并源分支" });
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
    setBatchMessage(
      values.mergeBeforePack ? "正在合并分支…" : "正在解析本地仓库…",
    );

    const appendLog = (line: string) =>
      setBatchLog((prev) => (prev ? `${prev}\n${line}` : line));

    try {
      if (values.mergeBeforePack) {
        let repoPaths = batchMergeRepoPaths;
        if (repoPaths.length === 0) {
          const collected = await collectKsBatchRepoPaths(
            config,
            envId,
            namespace,
            selectedDeploys.map((d) => ({ name: d.name, containers: d.containers })),
          );
          repoPaths = collected.repoPaths;
          if (collected.missing.length > 0) {
            appendLog(`仓库解析告警：\n${collected.missing.map((m) => `  - ${m}`).join("\n")}`);
          }
        }
        if (repoPaths.length === 0) {
          notifications.show({
            color: "red",
            title: "无法合并",
            message: "未解析到任何本地仓库，请检查 KS 发布映射",
          });
          setBatchSummary({ success: 0, failed: selectedDeploys.length, skipped: 0 });
          return;
        }

        appendLog(
          `合并 ${values.sourceBranch.trim()} → ${branch}，仓库 ${repoPaths.length} 个`,
        );
        const mergeResult = await mergeKsBatchReposSequential(
          repoPaths,
          values.sourceBranch.trim(),
          branch,
          {
            push: true,
            appendLog,
            onProgress: (pct, msg) => {
              batchStepLabelRef.current = msg;
              setBatchProgress((prev) => Math.max(prev, pct));
              setBatchMessage(msg);
            },
          },
        );
        if (!mergeResult.ok) {
          notifications.show({
            color: "red",
            title: "合并中止",
            message: mergeResult.error ?? "合并失败，已跳过打包发布",
            autoClose: 8000,
          });
          setBatchSummary({ success: 0, failed: selectedDeploys.length, skipped: 0 });
          return;
        }
        setBatchMessage("合并完成，开始打包推送并发布…");
        setBatchProgress((prev) => Math.max(prev, 42));
      }

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
        appendLog,
        onProgress: (pct, msg, ctx) => {
          batchStepLabelRef.current = msg;
          if (ctx) {
            batchItemIndexRef.current = ctx.itemIndex;
            batchItemTotalRef.current = ctx.itemTotal;
          }
          const mapped = values.mergeBeforePack
            ? Math.min(100, Math.round(42 + (pct * 58) / 100))
            : pct;
          setBatchProgress((prev) => Math.max(prev, mapped));
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
      reloadDeploysSilent();
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
        getConfigSnapshot,
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
      reloadDeploysSilent();
    } finally {
      setCloneRunning(false);
    }
  };

  const setConcurrencyPref = (n: number) => {
    const pref = (n === 0 || n === 1 || n === 2 || n === 3 || n === 4
      ? n
      : KS_BATCH_CONCURRENCY_AUTO) as KsBatchConcurrencyPref;
    setBatchConcurrencyPref(pref);
    saveKsBatchConcurrencyPref(pref);
  };

  const batchUiActive =
    batchConfirmOpen || batchOpen || batchRunning || cloneConfirmOpen || cloneOpen || cloneRunning;

  return {
    batchUiActive,
    batchBranch,
    batchOpen,
    setBatchOpen,
    batchConfirmOpen,
    setBatchConfirmOpen,
    batchMeta,
    batchMergeRepoPaths,
    batchSummary,
    batchConcurrencyPref,
    setConcurrencyPref,
    batchNpmScriptPref,
    batchRunning,
    batchLog,
    batchProgress,
    batchMessage,
    batchCpuCores,
    batchRecommendedConcurrency,
    batchBranchOptionGroups,
    batchGitBranchesLoading,
    batchGitBranchesError,
    batchGitRepoCount,
    refreshBatchGitBranches,
    beginBatchPack,
    startBatchPack,
    cloneConfirmOpen,
    cloneMeta,
    closeCloneConfirm,
    startBatchClone,
    beginBatchClone,
    cloneOpen,
    setCloneOpen,
    cloneRunning,
    cloneProgress,
    cloneMessage,
    cloneLog,
    cloneSummary,
    cloneProgressMeta,
  };
}

export type KsBatchActionsApi = ReturnType<typeof useKsBatchActions>;
