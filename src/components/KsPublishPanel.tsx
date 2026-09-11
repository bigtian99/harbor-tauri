import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card, Text, Button, Select, Badge, Group, Stack, Loader, Tabs,
} from "@mantine/core";
import { RefreshCw } from "lucide-react";
import type { HarborConfig, KsPublishMap } from "../types";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { PanelPageHeader } from "./PanelPageHeader";
import { panelFieldStyles, panelPaperStyles, panelPrimaryButtonStyles } from "../theme/panelStyles";
import {
  KsBatchConfirmModal,
  KsBatchProgressModal,
} from "./KsBatchPackModal";
import {
  KsBatchCloneConfirmModal,
} from "./KsBatchCloneModal";
import {
  defaultKsBatchBranch,
} from "../utils/ksBatchBranchHistory";
import { KsPodLogModal } from "./ksPublish/KsPodLogModal";
import { KsConfigMapTab } from "./ksPublish/KsConfigMapTab";
import { KsConfigMapModal } from "./ksPublish/KsConfigMapModal";
import { KsDeployTab } from "./ksPublish/KsDeployTab";
import { KsCreateDeployModal } from "./ksPublish/KsCreateDeployModal";
import { KsEditDeployModal } from "./ksPublish/KsEditDeployModal";
import { useKsBatchActions } from "./ksPublish/useKsBatchActions";
import { useKsPodLogs } from "./ksPublish/useKsPodLogs";
import { useKsConfigMaps } from "./ksPublish/useKsConfigMaps";
import { useKsDeployMutations } from "./ksPublish/useKsDeployMutations";
import { useKsConnection } from "./ksPublish/useKsConnection";

export function KsPublishPanel({
  config,
  configReady = true,
  onLastEnvChange,
  onPublishMapsChange,
  getConfigSnapshot,
}: {
  config: HarborConfig;
  /** 配置已从磁盘加载完成；false 时不要自动连接，避免 reload 后空配置误报「未配置环境」 */
  configReady?: boolean;
  onLastEnvChange?: (id: string) => void;
  /** 批量复制后写回发布映射 */
  onPublishMapsChange?: (maps: KsPublishMap[]) => void;
  /** 局部写盘前取最新整表 */
  getConfigSnapshot?: () => HarborConfig;
}) {
  const { confirm } = useConfirmDialog();
  const [mainTab, setMainTab] = useState<string | null>("deploy");
  const loadCmsRef = useRef<() => void | Promise<void>>(() => {});
  const resetCmsRef = useRef<() => void>(() => {});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const conn = useKsConnection({
    config,
    configReady,
    onLastEnvChange,
    mainTab,
    loadCms: () => loadCmsRef.current(),
    resetCmsOnNamespaceChange: () => resetCmsRef.current(),
  });

  const deploy = useKsDeployMutations({
    namespace: conn.namespace,
    connected: conn.connected,
    sel: conn.sel,
    setSel: conn.setSel,
    load: conn.load,
    confirm,
  });

  const cmsApi = useKsConfigMaps({
    connected: conn.connected,
    namespace: conn.namespace,
    mainTab,
    createOpen: deploy.createOpen,
    editOpen: deploy.editOpen,
  });
  loadCmsRef.current = cmsApi.loadCms;
  resetCmsRef.current = cmsApi.resetCmsOnNamespaceChange;

  const selectedDeploys = useMemo(
    () => conn.deploys.filter((d) => conn.checkedNames.has(d.name)),
    [conn.deploys, conn.checkedNames],
  );

  const batch = useKsBatchActions({
    config,
    envId: conn.envId,
    namespace: conn.namespace,
    selectedEnv: conn.selectedEnv,
    envs: conn.envs,
    selectedDeploys,
    getConfigSnapshot,
    onPublishMapsChange,
    connect: conn.connect,
    reloadDeploysSilent: () => { void conn.load({ silent: true }); },
  });

  const podLogs = useKsPodLogs({
    namespace: conn.namespace,
    defaultContainer: conn.sel?.containers[0] ?? "",
  });

  // 自动刷新：批量弹窗打开或执行中暂停（依赖 batchUiActive，留在组装层）
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (conn.autoRefresh && conn.connected && conn.namespace && !batch.batchUiActive) {
      timerRef.current = setInterval(
        () => { void conn.load({ silent: true }); },
        Number(conn.refreshSec) * 1000,
      );
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [conn.autoRefresh, conn.refreshSec, conn.connected, conn.namespace, conn.load, batch.batchUiActive]);

  return (
    <>
      <Stack gap="md" className="ks-publish-panel">
        <PanelPageHeader
          eyebrow="HARBOR IMAGE → KUBESPHERE"
          title="KubeSphere 发布"
          sub="连接集群环境，选择命名空间与部署，更新镜像并发布"
        >
          {conn.connecting && (
            <Group gap={6}>
              <Loader size={14} />
              <Text size="sm" c="dimmed">{conn.statusText || "正在连接…"}</Text>
            </Group>
          )}
          {conn.connected && conn.selectedEnv && !conn.connecting && (
            <Badge color="green" variant="dot" size="sm">已连接 {conn.selectedEnv.name}</Badge>
          )}
          {!conn.connected && !conn.connecting && conn.statusText && (
            <Text size="sm" c="red">{conn.statusText}</Text>
          )}
        </PanelPageHeader>
        <Card shadow="sm" radius="md" withBorder styles={panelPaperStyles}>
          <Stack gap="md">
            <Group align="flex-end" wrap="wrap" gap="md" className="ks-publish-toolbar">
              <Select
                label="环境"
                data={conn.envs.map((env) => ({ value: env.id, label: env.name || env.id }))}
                value={conn.envId}
                onChange={conn.switchEnv}
                placeholder={conn.envs.length ? "选择环境" : "请先在设置中添加环境"}
                disabled={conn.connecting || conn.envs.length === 0}
                styles={panelFieldStyles}
                style={{ flex: "1 1 200px", minWidth: 200 }}
              />
              <Select
                label="命名空间"
                data={conn.namespaces}
                value={conn.namespace}
                onChange={(v) => conn.setNamespace(v)}
                searchable
                clearable
                placeholder={conn.connected ? "选择命名空间" : "连接后可选"}
                disabled={!conn.connected || conn.connecting}
                styles={panelFieldStyles}
                style={{ flex: "1 1 200px", minWidth: 200 }}
              />
              <Button
                variant={conn.connected ? "light" : "filled"}
                color="blue"
                leftSection={<RefreshCw size={14} />}
                loading={conn.connecting}
                disabled={conn.envs.length === 0 || !conn.envId}
                onClick={() => void conn.connect(conn.envId)}
                title={conn.connected ? "连接失败或会话过期时手动重连" : "连接所选环境"}
                styles={conn.connected ? undefined : panelPrimaryButtonStyles}
                style={{ flex: "0 0 auto" }}
              >
                {conn.connecting ? "连接中…" : conn.connected ? "重新连接" : "连接"}
              </Button>
            </Group>
          </Stack>
        </Card>

        {conn.connected && (
          <Tabs value={mainTab} onChange={setMainTab} keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="deploy">部署与发布</Tabs.Tab>
              <Tabs.Tab value="config">ConfigMap</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="deploy">
              <KsDeployTab
                deploys={conn.deploys}
                sel={conn.sel}
                setSel={conn.setSel}
                checkedNames={conn.checkedNames}
                setCheckedNames={conn.setCheckedNames}
                toggleDeployCheck={conn.toggleDeployCheck}
                connected={conn.connected}
                connecting={conn.connecting}
                namespace={conn.namespace}
                loading={conn.loading}
                lastRefresh={conn.lastRefresh}
                autoRefresh={conn.autoRefresh}
                setAutoRefresh={conn.setAutoRefresh}
                refreshSec={conn.refreshSec}
                setRefreshSec={conn.setRefreshSec}
                handleRefreshOrReconnect={conn.handleRefreshOrReconnect}
                batch={batch}
                deploy={deploy}
                openPodLogs={podLogs.openPodLogs}
              />
            </Tabs.Panel>

            <Tabs.Panel value="config" style={{ minHeight: 400 }}>
              <KsConfigMapTab {...cmsApi} />
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>

      <KsEditDeployModal
        deploy={deploy}
        cms={cmsApi.cms}
        cmLoading={cmsApi.cmLoading}
        cmSelectPlaceholder={cmsApi.cmSelectPlaceholder}
      />
      <KsCreateDeployModal
        deploy={deploy}
        cms={cmsApi.cms}
        cmLoading={cmsApi.cmLoading}
        cmSelectPlaceholder={cmsApi.cmSelectPlaceholder}
      />
      <KsConfigMapModal {...cmsApi} namespace={conn.namespace} />
      {batch.batchConfirmOpen && batch.batchMeta && (
        <KsBatchConfirmModal
          opened={batch.batchConfirmOpen}
          meta={batch.batchMeta}
          initialBranch={batch.batchBranch.trim() || defaultKsBatchBranch()}
          branchOptionGroups={batch.batchBranchOptionGroups}
          gitBranchesLoading={batch.batchGitBranchesLoading}
          gitBranchesError={batch.batchGitBranchesError || undefined}
          gitRepoCount={batch.batchGitRepoCount}
          onRefreshGitBranches={() => void batch.refreshBatchGitBranches()}
          initialNpmScript={batch.batchNpmScriptPref}
          concurrencyPref={batch.batchConcurrencyPref}
          recommendedConcurrency={batch.batchRecommendedConcurrency}
          cpuCores={batch.batchCpuCores}
          onConcurrencyPrefChange={batch.setConcurrencyPref}
          onClose={() => batch.setBatchConfirmOpen(false)}
          onStart={(values) => void batch.startBatchPack(values)}
          mergeRepoPaths={batch.batchMergeRepoPaths}
        />
      )}
      {(batch.batchOpen || batch.batchRunning) && (
        <KsBatchProgressModal
          opened={batch.batchOpen}
          meta={batch.batchMeta}
          running={batch.batchRunning}
          progress={batch.batchProgress}
          message={batch.batchMessage}
          log={batch.batchLog}
          summary={batch.batchSummary}
          onClose={() => batch.setBatchOpen(false)}
          onCancelBuild={() => void invoke("cancel_build").catch(() => {})}
        />
      )}
      {batch.cloneConfirmOpen && batch.cloneMeta && (
        <KsBatchCloneConfirmModal
          opened={batch.cloneConfirmOpen}
          config={config}
          meta={batch.cloneMeta}
          onClose={batch.closeCloneConfirm}
          onStart={(values) => void batch.startBatchClone(values)}
        />
      )}
      {(batch.cloneOpen || batch.cloneRunning) && (
        <KsBatchProgressModal
          opened={batch.cloneOpen}
          meta={batch.cloneProgressMeta}
          running={batch.cloneRunning}
          progress={batch.cloneProgress}
          message={batch.cloneMessage}
          log={batch.cloneLog}
          summary={batch.cloneSummary}
          title="批量复制到其他环境"
          metaLine={
            batch.cloneProgressMeta
              ? `${batch.cloneProgressMeta.branch} · ${batch.cloneProgressMeta.namespace} · ${batch.cloneProgressMeta.deployNames.length} 个部署`
              : null
          }
          onClose={() => batch.setCloneOpen(false)}
          onCancelBuild={() => {}}
          showCancel={false}
        />
      )}
      <KsPodLogModal {...podLogs} containers={conn.sel?.containers ?? []} />
    </>
  );
}
