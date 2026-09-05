import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import {
  Button,
  Group,
  Stack,
  Table,
  Badge,
  Text,
  ActionIcon,
  Tooltip,
  Paper,
  Box,
} from "@mantine/core";
import { Eye, FolderOpen } from "lucide-react";
import type { SubChannelData, LandingPageResult, FtpUploadResult } from "../../types";
import { TemplateCarousel } from "./TemplateCarousel";
import { getTemplateIframeSrc } from "./utils";

interface ChannelPreviewTableProps {
  landingPreviewData: SubChannelData[];
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  templateIndices: Record<string, number>;
  animatingCards: Record<string, string>;
  landingOutputDir: string;
  previewBaseUrl: string;
  onSwitchTemplate: (id: string, direction: "prev" | "next") => void;
  onOpenPreview: (src: string, title: string) => void;
}

export function ChannelPreviewTable({
  landingPreviewData,
  landingGenerated,
  ftpUploadResults,
  templateIndices,
  animatingCards,
  landingOutputDir,
  previewBaseUrl,
  onSwitchTemplate,
  onOpenPreview,
}: ChannelPreviewTableProps) {
  if (landingPreviewData.length === 0) return null;

  const getTemplateIndex = (id: string) => templateIndices[id] || 0;
  const iframeSrcFor =
    (genResult: LandingPageResult) => (idx: number) =>
      getTemplateIframeSrc(genResult, idx, previewBaseUrl, landingOutputDir);

  return (
    <Paper radius="md" style={{ overflow: "hidden" }}>
      <Box style={{ overflowX: "auto" }}>
        <Table
          highlightOnHover
          verticalSpacing="sm"
          horizontalSpacing="sm"
          style={{ tableLayout: "fixed", minWidth: 1180 }}
        >
          <colgroup>
            <col style={{ width: 46 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 160 }} />
            <col />
            <col style={{ width: 80 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 100 }} />
          </colgroup>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ textAlign: "center" }}></Table.Th>
              <Table.Th>名称</Table.Th>
              <Table.Th>类型</Table.Th>
              <Table.Th>产品</Table.Th>
              <Table.Th style={{ textAlign: "center" }}>
                <span style={{ display: "inline-block", transform: "translateX(-28px)" }}>
                  模板
                </span>
              </Table.Th>
              <Table.Th>ID</Table.Th>
              <Table.Th style={{ textAlign: "center" }}>状态</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {landingPreviewData.map((item, idx) => {
              const genResult = landingGenerated[item.id];
              const ftpResult = ftpUploadResults[item.id];
              const currentTemplateIndex = getTemplateIndex(item.id);
              return (
                <Table.Tr key={item.id || idx}>
                  <Table.Td style={{ textAlign: "center" }}>
                    {item.subChannelLogo ? (
                      <img
                        src={item.subChannelLogo}
                        alt={item.subChannelName || ""}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 6,
                          objectFit: "cover",
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Box
                        w={36}
                        h={36}
                        style={{
                          borderRadius: 6,
                          background: "var(--color-primary-muted)",
                          color: "var(--color-primary)",
                          fontSize: 14,
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {(item.subChannelName || "?").charAt(0)}
                      </Box>
                    )}
                  </Table.Td>

                  <Table.Td>
                    <Text size="sm" fw={500} lineClamp={1}>
                      {item.subChannelName || "(未命名)"}
                    </Text>
                  </Table.Td>

                  <Table.Td>
                    <Badge
                      variant="light"
                      color="blue"
                      size="sm"
                      style={{ textTransform: "none" }}
                    >
                      {item.typeCode || "-"}
                    </Badge>
                  </Table.Td>

                  <Table.Td>
                    {item.productName ? (
                      <Badge
                        variant="light"
                        color="yellow"
                        size="sm"
                        style={{ textTransform: "none" }}
                      >
                        {item.productName}
                      </Badge>
                    ) : null}
                  </Table.Td>

                  <Table.Td>
                    {genResult ? (
                      <TemplateCarousel
                        genResult={genResult}
                        currentTemplateIndex={currentTemplateIndex}
                        animationClass={animatingCards[item.id] || ""}
                        titleBase={item.subChannelName || ""}
                        iframeSrc={iframeSrcFor(genResult)}
                        onSwitch={(dir) => onSwitchTemplate(item.id, dir)}
                        onOpenPreview={onOpenPreview}
                        placeholder={
                          <Box
                            w={56}
                            h={72}
                            style={{
                              borderRadius: 6,
                              border: "1px solid var(--color-border)",
                              background: "var(--color-bg-elevated)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              overflow: "hidden",
                            }}
                          >
                            {item.subChannelLogo ? (
                              <img
                                src={item.subChannelLogo}
                                alt=""
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  opacity: 0.4,
                                }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <Text size="sm" c="dimmed">
                                {(item.subChannelName || "?").charAt(0)}
                              </Text>
                            )}
                          </Box>
                        }
                      />
                    ) : (
                      <Box
                        w={56}
                        h={72}
                        style={{
                          borderRadius: 6,
                          border: "1px solid var(--color-border)",
                          background: "var(--color-bg-elevated)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        {item.subChannelLogo ? (
                          <img
                            src={item.subChannelLogo}
                            alt=""
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              opacity: 0.4,
                            }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <Text size="sm" c="dimmed">
                            {(item.subChannelName || "?").charAt(0)}
                          </Text>
                        )}
                      </Box>
                    )}
                  </Table.Td>

                  <Table.Td>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                    >
                      {item.id}
                    </Text>
                  </Table.Td>

                  <Table.Td>
                    <Stack gap={2} align="center">
                      {genResult?.status === "success" && (
                        <Group gap={6} wrap="nowrap" style={{ color: "var(--color-success)" }}>
                          <Box
                            w={6}
                            h={6}
                            style={{ borderRadius: 999, background: "var(--color-success)" }}
                          />
                          <Text size="xs" fw={600}>
                            已生成
                          </Text>
                        </Group>
                      )}
                      {genResult?.status === "error" && (
                        <Tooltip label={genResult.message}>
                          <Group gap={6} wrap="nowrap" style={{ color: "var(--color-error)" }}>
                            <Box
                              w={6}
                              h={6}
                              style={{ borderRadius: 999, background: "var(--color-error)" }}
                            />
                            <Text size="xs" fw={600}>
                              失败
                            </Text>
                          </Group>
                        </Tooltip>
                      )}
                      {ftpResult?.status === "success" && (
                        <Group gap={6} wrap="nowrap" style={{ color: "var(--color-primary-hover)" }}>
                          <Box
                            w={6}
                            h={6}
                            style={{ borderRadius: 999, background: "var(--color-primary)" }}
                          />
                          <Text size="xs" fw={600}>
                            已上传
                          </Text>
                        </Group>
                      )}
                    </Stack>
                  </Table.Td>

                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      {genResult?.status === "success" && (
                        <>
                          <Tooltip label="打开当前模板路径">
                            <ActionIcon
                              variant="light"
                              color="gray"
                              size="sm"
                              onClick={async () => {
                                try {
                                  const templatePath = `${genResult.output_dir}/template_${currentTemplateIndex}`;
                                  await invoke("open_directory", { path: templatePath });
                                } catch (e) {
                                  notifications.show({
                                    title: "打开失败",
                                    message: String(e),
                                    color: "red",
                                    autoClose: 3000,
                                  });
                                }
                              }}
                            >
                              <FolderOpen size={14} />
                            </ActionIcon>
                          </Tooltip>
                          <Button
                            variant="light"
                            color="blue"
                            size="compact-xs"
                            leftSection={<Eye size={13} />}
                            onClick={() => {
                              onOpenPreview(
                                getTemplateIframeSrc(
                                  genResult,
                                  currentTemplateIndex,
                                  previewBaseUrl,
                                  landingOutputDir
                                ),
                                `${item.subChannelName || ""} - 模板${currentTemplateIndex + 1}`
                              );
                            }}
                          >
                            预览
                          </Button>
                        </>
                      )}
                      {genResult?.status === "error" && (
                        <Text size="xs" c="red" title={genResult.message}>
                          失败
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Box>
    </Paper>
  );
}
