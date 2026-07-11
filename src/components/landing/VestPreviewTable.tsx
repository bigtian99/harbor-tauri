import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import {
  Group,
  Table,
  Badge,
  Text,
  ActionIcon,
  Tooltip,
  Paper,
  Box,
} from "@mantine/core";
import { Copy, FolderOpen, Maximize2 } from "lucide-react";
import type { LandingPageResult, FtpUploadResult } from "../../types";
import { TemplateCarousel } from "./TemplateCarousel";
import { getTemplateIframeSrc } from "./utils";

interface VestPreviewTableProps {
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  templateIndices: Record<string, number>;
  animatingCards: Record<string, string>;
  landingOutputDir: string;
  previewBaseUrl: string;
  onSwitchTemplate: (id: string, direction: "prev" | "next") => void;
  onOpenPreview: (src: string, title: string) => void;
}

export function VestPreviewTable({
  landingGenerated,
  ftpUploadResults,
  templateIndices,
  animatingCards,
  landingOutputDir,
  previewBaseUrl,
  onSwitchTemplate,
  onOpenPreview,
}: VestPreviewTableProps) {
  if (Object.keys(landingGenerated).length === 0) return null;

  const getTemplateIndex = (id: string) => templateIndices[id] || 0;

  return (
    <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
      <Box style={{ overflowX: "auto" }}>
        <Table
          highlightOnHover
          verticalSpacing="sm"
          horizontalSpacing="sm"
          style={{ tableLayout: "fixed", minWidth: 900 }}
        >
          <colgroup>
            <col style={{ width: 140 }} />
            <col style={{ width: 80 }} />
            <col />
            <col style={{ width: 80 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>名称</Table.Th>
              <Table.Th>ID</Table.Th>
              <Table.Th style={{ textAlign: "center" }}>
                <span style={{ display: "inline-block", transform: "translateX(-28px)" }}>
                  模板
                </span>
              </Table.Th>
              <Table.Th style={{ textAlign: "center" }}>状态</Table.Th>
              <Table.Th style={{ textAlign: "right" }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(landingGenerated).map(([id, genResult]) => {
              const ftpResult = ftpUploadResults[id];
              const currentTemplateIndex = getTemplateIndex(id);
              return (
                <Table.Tr key={id}>
                  <Table.Td>
                    <Text fw={600} size="sm">
                      {genResult?.name || id}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ fontFamily: "var(--mantine-font-family-monospace)" }}
                    >
                      {id}
                    </Text>
                  </Table.Td>

                  <Table.Td>
                    <TemplateCarousel
                      genResult={genResult}
                      currentTemplateIndex={currentTemplateIndex}
                      animationClass={animatingCards[id] || ""}
                      titleBase={genResult.name}
                      iframeSrc={(idx) =>
                        getTemplateIframeSrc(
                          genResult,
                          idx,
                          previewBaseUrl,
                          landingOutputDir
                        )
                      }
                      onSwitch={(dir) => onSwitchTemplate(id, dir)}
                      onOpenPreview={onOpenPreview}
                    />
                  </Table.Td>

                  <Table.Td style={{ textAlign: "center" }}>
                    {genResult?.status === "success" ? (
                      <Badge color="teal" variant="light">
                        成功
                      </Badge>
                    ) : genResult?.status === "error" ? (
                      <Badge color="red" variant="light">
                        失败
                      </Badge>
                    ) : (
                      <Badge color="yellow" variant="light">
                        处理中
                      </Badge>
                    )}
                  </Table.Td>

                  <Table.Td style={{ textAlign: "right" }}>
                    <Group gap={4} justify="flex-end">
                      {genResult?.status === "success" && (
                        <>
                          <Tooltip label="打开模板目录">
                            <ActionIcon
                              variant="light"
                              color="gray"
                              size="sm"
                              onClick={async () => {
                                try {
                                  await invoke("open_directory", {
                                    path: `${genResult.output_dir}/template_${currentTemplateIndex}`,
                                  });
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
                          <Tooltip label="预览">
                            <ActionIcon
                              variant="light"
                              color="teal"
                              size="sm"
                              onClick={() =>
                                onOpenPreview(
                                  getTemplateIframeSrc(
                                    genResult,
                                    currentTemplateIndex,
                                    previewBaseUrl,
                                    landingOutputDir
                                  ),
                                  genResult.name
                                )
                              }
                            >
                              <Maximize2 size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </>
                      )}
                      {ftpResult && ftpResult.status === "success" && (
                        <Tooltip label="复制链接">
                          <ActionIcon
                            variant="light"
                            color="teal"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(ftpResult.url);
                              notifications.show({
                                message: "已复制",
                                color: "teal",
                                autoClose: 1500,
                              });
                            }}
                          >
                            <Copy size={14} />
                          </ActionIcon>
                        </Tooltip>
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
