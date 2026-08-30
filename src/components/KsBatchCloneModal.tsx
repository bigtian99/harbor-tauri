import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { Copy, Layers3, Server } from "lucide-react";
import type { HarborConfig } from "../types";
import { isTauriRuntime } from "../types";
import { pickKsEnvironment, resolveKsEnvironments } from "../utils/ksEnvironments";
import type { KsBatchCloneConflict } from "../utils/ksBatchCloneDeploy";

export interface KsBatchCloneConfirmMeta {
  sourceEnvId: string;
  sourceEnvName: string;
  sourceNamespace: string;
  deployNames: string[];
}

export interface KsBatchCloneConfirmValues {
  targetEnvId: string;
  targetNamespace: string;
  conflict: KsBatchCloneConflict;
  copyConfigMap: boolean;
  copyPublishMaps: boolean;
  dryRun: boolean;
}

interface Props {
  opened: boolean;
  config: HarborConfig;
  meta: KsBatchCloneConfirmMeta | null;
  onClose: () => void;
  onStart: (values: KsBatchCloneConfirmValues) => void;
}

export function KsBatchCloneConfirmModal({
  opened,
  config,
  meta,
  onClose,
  onStart,
}: Props) {
  const envs = resolveKsEnvironments(config);
  const [targetEnvId, setTargetEnvId] = useState<string | null>(null);
  const [targetNamespace, setTargetNamespace] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [loadingNs, setLoadingNs] = useState(false);
  const [nsError, setNsError] = useState("");
  const [conflict, setConflict] = useState<KsBatchCloneConflict>("skip");
  const [copyConfigMap, setCopyConfigMap] = useState(true);
  const [copyPublishMaps, setCopyPublishMaps] = useState(true);
  const [dryRun, setDryRun] = useState(false);

  const count = meta?.deployNames.length ?? 0;

  useEffect(() => {
    if (!opened || !meta) return;
    const others = envs.filter((e) => e.id !== meta.sourceEnvId);
    const prefer =
      others[0]?.id
      ?? envs.find((e) => e.id !== meta.sourceEnvId)?.id
      ?? envs[0]?.id
      ?? null;
    setTargetEnvId(prefer);
    setTargetNamespace(null);
    setNamespaces([]);
    setNsError("");
    setConflict("skip");
    setCopyConfigMap(true);
    setCopyPublishMaps(true);
    setDryRun(false);
  }, [opened, meta?.sourceEnvId]);

  useEffect(() => {
    if (!opened || !targetEnvId || !isTauriRuntime()) {
      setNamespaces([]);
      return;
    }
    const env = pickKsEnvironment(envs, targetEnvId);
    if (!env) return;
    let cancelled = false;
    setLoadingNs(true);
    setNsError("");
    setTargetNamespace(null);
    void (async () => {
      try {
        await invoke("ks_connect", {
          envId: env.id,
          console: env.console?.trim() || "",
          username: env.username?.trim() || "",
          password: env.password ?? "",
        });
        const ns = await invoke<string[]>("ks_list_namespaces");
        if (cancelled) return;
        setNamespaces(ns);
        const prefer =
          ns.find((n) => n.includes("test"))
          ?? ns.find((n) => n !== meta?.sourceNamespace)
          ?? ns[0]
          ?? null;
        setTargetNamespace(prefer);
      } catch (e) {
        if (cancelled) return;
        setNamespaces([]);
        setNsError(String(e));
      } finally {
        if (!cancelled) setLoadingNs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, targetEnvId]);

  const sameAsSource =
    !!meta
    && targetEnvId === meta.sourceEnvId
    && targetNamespace === meta.sourceNamespace;

  const canStart =
    !!meta
    && !!targetEnvId
    && !!targetNamespace
    && count > 0
    && !loadingNs
    && !sameAsSource
    && !nsError;

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
          <ThemeIcon size={36} radius="md" variant="light" color="teal">
            <Copy size={18} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text fw={700} size="lg" lh={1.2}>
              复制到其他环境
            </Text>
            <Text size="xs" c="dimmed">
              Deployment + ConfigMap + 发布映射
            </Text>
          </Stack>
        </Group>
      )}
    >
      <Stack gap="md">
        <Paper withBorder radius="md" p="md">
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
            <Stack gap={4}>
              <Group gap={6}>
                <Server size={14} />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  源
                </Text>
              </Group>
              <Text size="sm" fw={600}>
                {meta?.sourceEnvName ?? "—"} / {meta?.sourceNamespace ?? "—"}
              </Text>
              <Text size="xs" c="dimmed">
                已选 {count} 个部署
              </Text>
            </Stack>
            <Stack gap={4}>
              <Group gap={6}>
                <Layers3 size={14} />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  部署列表
                </Text>
              </Group>
              <Text size="xs" style={{ maxHeight: 72, overflow: "auto" }}>
                {(meta?.deployNames ?? []).join(", ") || "—"}
              </Text>
            </Stack>
          </SimpleGrid>
        </Paper>

        <Select
          label="目标环境"
          placeholder="选择环境"
          data={envs.map((e) => ({ value: e.id, label: e.name || e.id }))}
          value={targetEnvId}
          onChange={setTargetEnvId}
          searchable
          allowDeselect={false}
        />
        <Select
          label="目标命名空间"
          placeholder={loadingNs ? "加载中…" : "选择命名空间"}
          data={namespaces.map((n) => ({ value: n, label: n }))}
          value={targetNamespace}
          onChange={setTargetNamespace}
          searchable
          disabled={loadingNs || namespaces.length === 0}
          error={nsError || undefined}
          nothingFoundMessage="无命名空间"
        />

        <Radio.Group
          label="目标已存在同名 Deployment / ConfigMap / 映射时"
          value={conflict}
          onChange={(v) => setConflict(v as KsBatchCloneConflict)}
        >
          <Group mt="xs">
            <Radio value="skip" label="跳过（默认）" />
            <Radio value="overwrite" label="覆盖更新" />
          </Group>
        </Radio.Group>

        <Stack gap={6}>
          <Checkbox
            checked={copyConfigMap}
            onChange={(e) => setCopyConfigMap(e.currentTarget.checked)}
            label="同时复制关联 ConfigMap"
          />
          <Checkbox
            checked={copyPublishMaps}
            onChange={(e) => setCopyPublishMaps(e.currentTarget.checked)}
            label="同时复制发布映射（Git / 角色 / 端口）"
          />
          <Checkbox
            checked={dryRun}
            onChange={(e) => setDryRun(e.currentTarget.checked)}
            label="仅预检（dry-run，不创建资源、不写映射）"
          />
        </Stack>

        {sameAsSource && (
          <Text size="xs" c="orange">
            目标与源相同，请换环境或命名空间
          </Text>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="filled"
            color="teal"
            disabled={!canStart}
            onClick={() => {
              if (!meta || !targetEnvId || !targetNamespace) return;
              onStart({
                targetEnvId,
                targetNamespace,
                conflict,
                copyConfigMap,
                copyPublishMaps,
                dryRun,
              });
            }}
          >
            开始复制 ({count})
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
