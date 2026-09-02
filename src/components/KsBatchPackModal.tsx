import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import type { KsPublishMapRole } from "../types";
import type { KsBatchBranchOptionGroup } from "../utils/ksBatchGitBranches";
import {
  flattenKsBatchBranchOptions,
  normalizeKsBatchBranchOptionGroups,
} from "../utils/ksBatchGitBranches";
import {
  describeKsBatchNpmScriptPref,
  KS_BATCH_NPM_SCRIPT_PRESETS,
  type KsBatchNpmScriptMode,
  type KsBatchNpmScriptPref,
} from "../utils/ksBatchPackPublish";
import {
  CheckCircle2,
  Check,
  GitBranch,
  Layers3,
  Package,
  RefreshCw,
  Rocket,
  Server,
  SkipForward,
  Terminal,
  XCircle,
} from "lucide-react";

function deployRoleLabel(role: KsPublishMapRole | undefined): string {
  if (role === "frontend") return "前端";
  if (role === "backend") return "后端";
  return "任意";
}

function deployRoleColor(role: KsPublishMapRole | undefined): string {
  if (role === "frontend") return "grape";
  if (role === "backend") return "blue";
  return "gray";
}

export interface KsBatchMeta {
  branch: string;
  namespace: string;
  envName: string;
  deployNames: string[];
  deployRoles?: Record<string, KsPublishMapRole>;
  npmScript?: KsBatchNpmScriptPref;
}

export interface KsBatchConfirmValues {
  branch: string;
  npmScript: KsBatchNpmScriptPref;
}

export interface KsBatchSummary {
  success: number;
  failed: number;
  skipped: number;
}

interface KsBatchConfirmModalProps {
  opened: boolean;
  meta: KsBatchMeta | null;
  /** 上次批量成功使用的分支；弹框内可改，不自动混用分支打包页记忆 */
  initialBranch: string;
  branchOptionGroups: KsBatchBranchOptionGroup[];
  gitBranchesLoading: boolean;
  gitBranchesError?: string;
  gitRepoCount: number;
  onRefreshGitBranches: () => void;
  initialNpmScript: KsBatchNpmScriptPref;
  /** 0 = 自动 */
  concurrencyPref: number;
  recommendedConcurrency: number;
  cpuCores: number;
  onConcurrencyPrefChange: (n: number) => void;
  onClose: () => void;
  onStart: (values: KsBatchConfirmValues) => void;
}

export function KsBatchConfirmModal({
  opened,
  meta,
  initialBranch,
  branchOptionGroups,
  gitBranchesLoading = false,
  gitBranchesError,
  gitRepoCount = 0,
  onRefreshGitBranches,
  initialNpmScript,
  concurrencyPref,
  recommendedConcurrency,
  cpuCores,
  onConcurrencyPrefChange,
  onClose,
  onStart,
}: KsBatchConfirmModalProps) {
  const [branch, setBranch] = useState(initialBranch);
  const [npmMode, setNpmMode] = useState<KsBatchNpmScriptMode>(initialNpmScript.mode);
  const [npmCustom, setNpmCustom] = useState(initialNpmScript.customScript);

  const safeBranchGroups = useMemo(
    () => normalizeKsBatchBranchOptionGroups(branchOptionGroups),
    [branchOptionGroups],
  );

  const branchSelectData = useMemo(() => {
    if (safeBranchGroups.length > 0) return safeBranchGroups;
    const seed = initialBranch.trim();
    return seed ? [seed] : [];
  }, [safeBranchGroups, initialBranch]);

  const allBranchNames = useMemo(
    () => flattenKsBatchBranchOptions(safeBranchGroups),
    [safeBranchGroups],
  );

  const gitBranchSet = useMemo(() => {
    const gitGroup = safeBranchGroups.find((g) => g.group.includes("仓库分支"));
    return new Set(gitGroup?.items ?? []);
  }, [safeBranchGroups]);

  useEffect(() => {
    if (!opened) return;
    setNpmMode(initialNpmScript.mode);
    setNpmCustom(initialNpmScript.customScript);
    const preferred = initialBranch.trim();
    if (preferred) {
      setBranch(preferred);
      return;
    }
    if (!gitBranchesLoading && allBranchNames.length > 0) {
      setBranch(allBranchNames[0]);
    } else {
      setBranch("");
    }
  }, [opened, initialBranch, initialNpmScript, gitBranchesLoading, allBranchNames]);

  const count = meta?.deployNames.length ?? 0;
  const effective =
    concurrencyPref > 0
      ? Math.min(concurrencyPref, Math.max(1, count))
      : recommendedConcurrency;

  const hasFrontendDeploys = useMemo(
    () => Object.values(meta?.deployRoles ?? {}).some((r) => r === "frontend"),
    [meta?.deployRoles],
  );

  const npmScriptPref = useMemo<KsBatchNpmScriptPref>(
    () => ({ mode: npmMode, customScript: npmCustom }),
    [npmMode, npmCustom],
  );

  const branchReady = branch.trim().length > 0;
  const branchInGitList = !branch.trim() || gitBranchSet.has(branch.trim());
  const npmReady = !hasFrontendDeploys
    || npmMode !== "custom"
    || npmCustom.trim().length > 0;
  const canStart = count > 0 && branchReady && npmReady && !gitBranchesLoading;

  const handleStart = () => {
    if (!canStart) return;
    onStart({
      branch: branch.trim(),
      npmScript: npmScriptPref,
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      padding="lg"
      radius="md"
      overlayProps={{ backgroundOpacity: 0.55 }}
      lockScroll={false}
      transitionProps={{ duration: 120 }}
      title={(
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon size={36} radius="md" variant="light" color="cyan">
            <Package size={18} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text fw={700} size="lg" lh={1.2}>
              批量打包并发布
            </Text>
            <Text size="xs" c="dimmed">
              并行打包 → 推送 Harbor → 更新 K8s 部署镜像
            </Text>
          </Stack>
        </Group>
      )}
      classNames={{ content: "ks-batch-confirm-modal" }}
    >
      <Stack gap="md">
        <Paper withBorder radius="md" p="md" className="ks-batch-meta-panel">
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
            <Stack gap={4}>
              <Group gap={6}>
                <Layers3 size={14} className="ks-batch-meta-icon" />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  命名空间
                </Text>
              </Group>
              <Text size="sm" fw={600} className="ks-batch-meta-value">
                {meta?.namespace ?? "—"}
              </Text>
            </Stack>
            <Stack gap={4}>
              <Group gap={6}>
                <Server size={14} className="ks-batch-meta-icon" />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  环境
                </Text>
              </Group>
              <Text size="sm" fw={600} className="ks-batch-meta-value">
                {meta?.envName ?? "—"}
              </Text>
            </Stack>
          </SimpleGrid>
        </Paper>

        <Stack gap={6}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap={6}>
              <GitBranch size={14} className="ks-batch-meta-icon" />
              <Text size="sm" fw={600}>
                目标分支
              </Text>
            </Group>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={gitBranchesLoading
                ? <Loader size={12} />
                : <RefreshCw size={12} />}
              disabled={gitBranchesLoading}
              onClick={onRefreshGitBranches}
            >
              拉取仓库分支
            </Button>
          </Group>
          <Select
            searchable
            clearable
            withCheckIcon={false}
            classNames={{ root: "ks-batch-branch-select" }}
            placeholder={gitBranchesLoading ? "正在拉取分支…" : "请选择目标分支"}
            data={branchSelectData}
            value={branch || null}
            onChange={(v) => setBranch(v ?? "")}
            disabled={gitBranchesLoading}
            nothingFoundMessage="无匹配分支"
            aria-label="批量打包目标分支"
            comboboxProps={{
              withinPortal: true,
              classNames: { option: "ks-batch-branch-combobox-option" },
            }}
            renderOption={({ option, checked }) => (
              <Group
                flex="1"
                gap="xs"
                justify="space-between"
                wrap="nowrap"
                className={checked ? "ks-batch-branch-option ks-batch-branch-option--selected" : "ks-batch-branch-option"}
              >
                <Text span size="sm" truncate className="ks-batch-branch-option-label">
                  {option.label}
                </Text>
                {checked && <Check size={14} strokeWidth={2.5} className="ks-batch-branch-option-check" />}
              </Group>
            )}
          />
          {gitBranchesError && (
            <Text size="xs" c="red">
              {gitBranchesError}
            </Text>
          )}
          {!gitBranchesLoading && gitRepoCount > 0 && (
            <Text size="xs" c="dimmed">
              已从 {gitRepoCount} 个本地仓库 fetch；下拉含「最近使用」与「仓库分支」
            </Text>
          )}
          {!gitBranchesLoading && branch.trim() && gitBranchSet.size > 0 && !branchInGitList && (
            <Text size="xs" c="orange">
              「{branch.trim()}」来自最近使用记录，请确认仓库存在该引用
            </Text>
          )}
        </Stack>

        {hasFrontendDeploys && (
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              前端 npm 构建脚本
            </Text>
            <SegmentedControl
              fullWidth
              size="xs"
              value={npmMode}
              onChange={(v) => {
                const mode = (
                  v === "prod" || v === "test" || v === "custom" ? v : "auto"
                ) as KsBatchNpmScriptMode;
                setNpmMode(mode);
                if (mode === "prod") setNpmCustom("build:prod");
                if (mode === "test") setNpmCustom("build:test");
              }}
              data={[
                { label: "按分支自动", value: "auto" },
                { label: "build:prod", value: "prod" },
                { label: "build:test", value: "test" },
                { label: "自定义", value: "custom" },
              ]}
            />
            {npmMode === "auto" && (
              <Text size="xs" c="dimmed">
                rc-master 分支 → build:prod，其它分支 → build:test
              </Text>
            )}
            {npmMode === "custom" && (
              <Autocomplete
                placeholder="输入 npm script 名，如 build:prod"
                data={[...KS_BATCH_NPM_SCRIPT_PRESETS]}
                value={npmCustom}
                onChange={setNpmCustom}
                aria-label="自定义 npm 构建脚本"
                comboboxProps={{ withinPortal: true }}
              />
            )}
            <Text size="xs" c="dimmed">
              {describeKsBatchNpmScriptPref(npmScriptPref)}
            </Text>
          </Stack>
        )}

        <Stack gap="xs">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>
              待发布部署
            </Text>
            <Badge variant="light" color="cyan" size="sm">
              {count} 项
            </Badge>
          </Group>
          <ScrollArea mah={180} type="auto" offsetScrollbars className="ks-batch-deploy-scroll">
            <Group gap={8}>
              {(meta?.deployNames ?? []).map((name) => (
                <Badge
                  key={name}
                  variant="outline"
                  color={deployRoleColor(meta?.deployRoles?.[name])}
                  size="md"
                  radius="sm"
                  className="ks-batch-deploy-chip"
                  leftSection={(
                    <Text span size="10px" fw={700} opacity={0.85}>
                      {deployRoleLabel(meta?.deployRoles?.[name])}
                    </Text>
                  )}
                >
                  {name}
                </Badge>
              ))}
            </Group>
          </ScrollArea>
        </Stack>

        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Stack gap={2}>
            <Text size="sm" fw={600}>
              并行数
            </Text>
            <Text size="xs" c="dimmed">
              自动按 CPU≈{cpuCores} 核、选中 {count} 项估算 → {recommendedConcurrency}
              （同仓库仍串行）
            </Text>
          </Stack>
          <SegmentedControl
            size="xs"
            value={String(concurrencyPref)}
            onChange={(v) => onConcurrencyPrefChange(Number(v))}
            data={[
              { label: `自动(${recommendedConcurrency})`, value: "0" },
              { label: "1", value: "1" },
              { label: "2", value: "2" },
              { label: "3", value: "3" },
              { label: "4", value: "4" },
            ]}
          />
        </Group>

        <Text size="xs" c="dimmed" lh={1.55}>
          本次将按并发 {effective} 执行；日志可能交错显示。
        </Text>

        <Group justify="flex-end" gap="sm" mt={4}>
          <Button variant="default" onClick={onClose}>
            取消
          </Button>
          <Button
            leftSection={<Rocket size={16} />}
            variant="filled"
            color="blue"
            onClick={handleStart}
            disabled={!canStart}
          >
            开始执行 ({count})
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

interface KsBatchProgressModalProps {
  opened: boolean;
  meta: KsBatchMeta | null;
  running: boolean;
  progress: number;
  message: string;
  log: string;
  summary: KsBatchSummary | null;
  onClose: () => void;
  onCancelBuild: () => void;
  /** 默认「批量打包并发布」 */
  title?: string;
  /** 副标题行：分支 · 命名空间 · N 个部署；传 null 隐藏 */
  metaLine?: string | null;
  /** 运行中是否显示「取消构建」；默认 true */
  showCancel?: boolean;
}

export function KsBatchProgressModal({
  opened,
  meta,
  running,
  progress,
  message,
  log,
  summary,
  onClose,
  onCancelBuild,
  title = "批量打包并发布",
  metaLine,
  showCancel = true,
}: KsBatchProgressModalProps) {
  const logViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logViewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log]);

  const statusColor = running
    ? "cyan"
    : summary && summary.failed > 0
      ? "orange"
      : "teal";

  const statusLabel = running
    ? "执行中"
    : summary && summary.failed > 0
      ? "已完成（有失败）"
      : "已完成";

  return (
    <Modal
      opened={opened}
      onClose={() => { if (!running) onClose(); }}
      centered
      size="lg"
      padding={0}
      radius="md"
      withCloseButton={!running}
      closeOnClickOutside={!running}
      closeOnEscape={!running}
      overlayProps={{ backgroundOpacity: 0.55 }}
      lockScroll={false}
      transitionProps={{ duration: 120 }}
      classNames={{ content: "ks-batch-progress-modal", body: "ks-batch-progress-body" }}
      title={null}
    >
      <Box className="ks-batch-progress-shell">
        <Box className="ks-batch-progress-header">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={34} radius="md" variant="gradient" gradient={{ from: "blue", to: "cyan", deg: 135 }}>
                <Rocket size={16} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fw={700} size="md" lh={1.2}>
                  {title}
                </Text>
                <Group gap="xs">
                  <Badge variant="dot" color={statusColor} size="sm">
                    {statusLabel}
                  </Badge>
                  {(metaLine !== null) && (metaLine || meta) && (
                    <>
                      <Text size="xs" c="dimmed">
                        {metaLine
                          ?? `${meta?.branch ?? ""} · ${meta?.namespace ?? ""} · ${meta?.deployNames.length ?? 0} 个部署`}
                      </Text>
                    </>
                  )}
                </Group>
              </Stack>
            </Group>

            {!running && summary && (
              <Group gap="xs">
                <Badge
                  leftSection={<CheckCircle2 size={12} />}
                  variant="light"
                  color="teal"
                  size="lg"
                  radius="sm"
                >
                  成功 {summary.success}
                </Badge>
                {summary.failed > 0 && (
                  <Badge
                    leftSection={<XCircle size={12} />}
                    variant="light"
                    color="red"
                    size="lg"
                    radius="sm"
                  >
                    失败 {summary.failed}
                  </Badge>
                )}
                {summary.skipped > 0 && (
                  <Badge
                    leftSection={<SkipForward size={12} />}
                    variant="light"
                    color="yellow"
                    size="lg"
                    radius="sm"
                  >
                    跳过 {summary.skipped}
                  </Badge>
                )}
              </Group>
            )}
          </Group>

          <Stack gap={4} mt="sm">
            <Group justify="space-between" align="center" gap="sm">
              <Text size="xs" fw={500} className="ks-batch-progress-message" lineClamp={1}>
                {message || "等待开始…"}
              </Text>
              <Text size="xs" fw={700} c="cyan" className="ks-batch-progress-pct">
                {Math.round(progress)}%
              </Text>
            </Group>
            <Progress value={progress} />
          </Stack>
        </Box>

        <Box className="ks-batch-log-section">
          <Group gap={6} mb={6} className="ks-batch-log-title">
            <Terminal size={12} />
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              执行日志
            </Text>
          </Group>
          <ScrollArea
            className="ks-batch-log-scroll"
            viewportRef={logViewportRef}
            type="auto"
            offsetScrollbars
            mah={240}
          >
            <pre className="ks-batch-log-pre">
              {log || "（暂无日志，任务启动后将在此显示…）"}
            </pre>
          </ScrollArea>
        </Box>

        <Group justify="flex-end" gap="sm" className="ks-batch-progress-footer">
          {running && showCancel && (
            <Button
              size="sm"
              variant="light"
              color="red"
              onClick={onCancelBuild}
            >
              取消构建
            </Button>
          )}
          <Button
            size="sm"
            variant={running ? "default" : "filled"}
            color={running ? "gray" : "cyan"}
            disabled={running}
            onClick={onClose}
          >
            {running ? "执行中…" : "关闭"}
          </Button>
        </Group>
      </Box>
    </Modal>
  );
}
