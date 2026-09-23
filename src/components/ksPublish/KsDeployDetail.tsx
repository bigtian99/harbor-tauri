import {
  Badge, Box, Button, Card, Divider, Group, Pagination,
  Select, Stack, Table, Text, TextInput, Title,
} from "@mantine/core";
import { Archive, History, Pencil, Rocket, ScrollText, Sparkles } from "lucide-react";
import {
  type DeployInfo,
  REV_PAGE_SIZE_OPTIONS,
  STATUS_DOT,
  STATUS_COLOR,
} from "./types";
import { fmtTime } from "./utils";
import { KsRefreshIcon } from "./KsRefreshIcon";
import type { KsDeployMutationsApi } from "./useKsDeployMutations";

/** 详情面板实际用到的 deploy mutation 字段（避免整 hook 透传） */
export type KsDeployDetailMutations = Pick<
  KsDeployMutationsApi,
  | "beginEdit"
  | "image"
  | "setImage"
  | "submitting"
  | "submitImageOnly"
  | "revisions"
  | "revsLoading"
  | "loadRevisions"
  | "revPageRows"
  | "revDurationMap"
  | "revSafePage"
  | "revPageSize"
  | "setRevPageSize"
  | "setRevPage"
  | "revTotalPages"
  | "rollback"
  | "selContainer"
>;

export function KsDeployDetail({
  sel,
  openPodLogs,
  deploy,
}: {
  sel: DeployInfo;
  openPodLogs: (podName: string) => void;
  deploy: KsDeployDetailMutations;
}) {
  const {
    beginEdit, image, setImage, submitting, submitImageOnly,
    revisions, revsLoading, loadRevisions, revPageRows, revDurationMap,
    revSafePage, revPageSize, setRevPageSize, setRevPage, revTotalPages,
    rollback, selContainer,
  } = deploy;

  return (
    <Card shadow="sm" radius="md" withBorder>
      <Group justify="space-between" mb="xs">
        <Group gap={8}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[sel.status.state] ?? "var(--color-text-muted)", display: "inline-block" }} />
          <Title order={5}>{sel.name}</Title>
          <Badge color={STATUS_COLOR[sel.status.state] ?? "gray"} variant="light">{sel.status.label}</Badge>
          <Text size="sm" c="dimmed">
            {sel.status.detail}{sel.status.old}
          </Text>
        </Group>
        <Button size="xs" variant="light" leftSection={<Pencil size={13} />} onClick={() => beginEdit(sel)}>
          修改镜像
        </Button>
      </Group>
      <Group align="flex-start" gap="lg" wrap="wrap">
        <Box style={{ flex: "1 1 520px", minWidth: 0, maxWidth: "100%" }}>
          <Group gap={6}>
            <Sparkles size={15} color="var(--color-primary-hover)" />
            <Text size="sm" fw={600} c="blue">新版本（当前 revision）</Text>
          </Group>
          {sel.pods.new.length === 0 && <Text size="xs" c="dimmed">暂无</Text>}
          {sel.pods.new.map((p) => (
            <Group key={p.name} gap={8} my={4} wrap="nowrap" justify="space-between">
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.state] ?? "var(--color-text-muted)", display: "inline-block", flexShrink: 0 }} />
                <Text size="xs" style={{ fontFamily: "monospace" }} truncate title={p.name}>{p.name}</Text>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{p.state === "running" ? `就绪 ${p.ready}/${p.total}` : (p.reason ?? p.state ?? p.phase)}{p.restarts ? ` · 重启${p.restarts}次` : ""}</Text>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{fmtTime(p.startTime)}</Text>
              </Group>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<ScrollText size={12} />}
                onClick={() => openPodLogs(p.name)}
              >
                日志
              </Button>
            </Group>
          ))}
          <Group gap={6} mt="sm">
            <Archive size={15} color="var(--color-text-muted)" />
            <Text size="sm" fw={600} c="dimmed">旧版本</Text>
          </Group>
          {sel.pods.old.length === 0 && <Text size="xs" c="dimmed">无</Text>}
          {sel.pods.old.map((p) => (
            <Group key={p.name} gap={8} my={4} wrap="nowrap" justify="space-between" opacity={0.85}>
              <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }} opacity={0.75}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[p.state] ?? "var(--color-text-muted)", display: "inline-block", flexShrink: 0 }} />
                <Text size="xs" style={{ fontFamily: "monospace" }} truncate title={p.name}>{p.name}</Text>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{p.state === "running" ? `就绪 ${p.ready}/${p.total}` : (p.reason ?? p.state ?? p.phase)}{p.restarts ? ` · 重启${p.restarts}次` : ""}</Text>
              </Group>
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<ScrollText size={12} />}
                onClick={() => openPodLogs(p.name)}
              >
                日志
              </Button>
            </Group>
          ))}
          <Group justify="space-between" mt="md" mb={6}>
            <Group gap={6}>
              <History size={14} />
              <Text size="sm" fw={600}>历史版本（ReplicaSet）</Text>
            </Group>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<KsRefreshIcon spinning={revsLoading} />}
              disabled={revsLoading}
              onClick={() => void loadRevisions()}
            >
              刷新历史
            </Button>
          </Group>
          {revisions.length === 0 && !revsLoading && (
            <Text size="xs" c="dimmed">暂无历史版本</Text>
          )}
          {revisions.length > 0 && (
            <Stack gap="xs">
            <Box className="ks-revisions-scroll">
              <Table className="ks-revisions-table" verticalSpacing="xs" stickyHeader stickyHeaderOffset={0}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th className="ks-rev-col-rev">Revision</Table.Th>
                    <Table.Th className="ks-rev-col-image">镜像地址</Table.Th>
                    <Table.Th className="ks-rev-col-ready">就绪</Table.Th>
                    <Table.Th className="ks-rev-col-dur">运行时长</Table.Th>
                    <Table.Th className="ks-rev-col-time">创建时间</Table.Th>
                    <Table.Th className="ks-rev-col-act">操作</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {revPageRows.map((rev) => (
                      <Table.Tr key={rev.revision} className={rev.isCurrent ? "ks-rev-current" : undefined}>
                        <Table.Td className="ks-rev-col-rev">
                          <Group gap={6} wrap="nowrap">
                            <Text size="xs" fw={700} c={rev.isCurrent ? "blue.3" : undefined}>{rev.revision}</Text>
                            {rev.isCurrent && (
                              <Badge size="sm" color="cyan" variant="filled" radius="sm">当前</Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td className="ks-rev-col-image">
                          {rev.isCurrent ? (
                            <span className="ks-rev-current-tag ks-rev-image" title={rev.image || undefined}>
                              {rev.image || "—"}
                            </span>
                          ) : (
                            <span className="ks-rev-image" title={rev.image || undefined}>
                              {rev.image || "—"}
                            </span>
                          )}
                        </Table.Td>
                        <Table.Td className="ks-rev-col-ready">
                          <Text size="xs">{rev.ready}/{rev.replicas}</Text>
                        </Table.Td>
                        <Table.Td className="ks-rev-col-dur">
                          {(() => {
                            const dur = revDurationMap.get(rev.revision);
                            if (!dur) return <Text size="xs" c="dimmed">—</Text>;
                            return (
                              <Text size="xs" c={dur.ongoing ? "blue.3" : "dimmed"} fw={dur.ongoing ? 600 : undefined}>
                                {dur.label}
                                {dur.ongoing ? " · 进行中" : ""}
                              </Text>
                            );
                          })()}
                        </Table.Td>
                        <Table.Td className="ks-rev-col-time">
                          <Text size="xs" c="dimmed">{fmtTime(rev.createdAt)}</Text>
                        </Table.Td>
                        <Table.Td className="ks-rev-col-act">
                          {rev.isCurrent ? (
                            <Text size="xs" c="dimmed">—</Text>
                          ) : (
                            <Group gap={4} wrap="nowrap">
                              <Button
                                size="compact-xs"
                                variant="light"
                                onClick={() => setImage(rev.image)}
                              >
                                填入
                              </Button>
                              <Button
                                size="compact-xs"
                                variant="light"
                                color="orange"
                                loading={submitting}
                                onClick={() => void rollback(rev)}
                              >
                                回滚
                              </Button>
                            </Group>
                          )}
                        </Table.Td>
                      </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
            <div className="ks-list-pager">
              <Text size="xs" c="dimmed">
                共 {revisions.length} 个 revision
                {revisions.length > 0
                  ? ` · 第 ${(revSafePage - 1) * revPageSize + 1}-${Math.min(revSafePage * revPageSize, revisions.length)} 条`
                  : ""}
              </Text>
              <Group gap="sm" wrap="nowrap">
                <Select
                  size="xs"
                  w={96}
                  data={REV_PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: `${n} 条/页` }))}
                  value={String(revPageSize)}
                  onChange={(v) => setRevPageSize(Number(v || 5))}
                  allowDeselect={false}
                />
                <Pagination
                  value={revSafePage}
                  onChange={setRevPage}
                  total={revTotalPages}
                  size="sm"
                  disabled={revisions.length === 0}
                />
              </Group>
            </div>
            </Stack>
          )}
        </Box>
        <Divider orientation="vertical" />
        <Box style={{ flex: 1, minWidth: 280 }}>
          <Group gap={6} mb="xs">
            <Rocket size={16} color="var(--color-primary-hover)" />
            <Title order={6}>修改镜像并发布</Title>
          </Group>
          <Text size="xs" c="dimmed" mb={4}>容器：{selContainer || "-"}</Text>
          <TextInput
            placeholder="dockerhub.kubekey.local/项目/镜像:tag"
            value={image}
            onChange={(e) => setImage(e.currentTarget.value)}
            mb="sm"
          />
          <Button
            fullWidth
            variant="filled"
            color="blue"
            leftSection={<Rocket size={15} />}
            loading={submitting}
            onClick={() => void submitImageOnly()}
          >
            提交变更
          </Button>
        </Box>
      </Group>
    </Card>
  );
}
