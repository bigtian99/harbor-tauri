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
import {
  Copy,
  Eye,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Maximize2,
} from "lucide-react";
import type { SubChannelData, LandingPageResult, FtpUploadResult } from "../../types";
import type { LandingMode } from "../../hooks/useLanding";
import { TemplatePreviewCard } from "./TemplatePreviewCard";
import { getCarouselIndices, getTemplateIframeSrc } from "./utils";

interface LandingPreviewProps {
  landingMode: LandingMode;
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

export function LandingPreview({
  landingMode,
  landingPreviewData,
  landingGenerated,
  ftpUploadResults,
  templateIndices,
  animatingCards,
  landingOutputDir,
  previewBaseUrl,
  onSwitchTemplate,
  onOpenPreview,
}: LandingPreviewProps) {
  const getTemplateIndex = (id: string) => templateIndices[id] || 0;

  const iframeSrc = (genResult: LandingPageResult, idx: number) =>
    getTemplateIframeSrc(genResult, idx, previewBaseUrl, landingOutputDir);

  return (
    <>
      {/* 数据表格（子渠道） */}
      {landingPreviewData.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Box style={{ overflowX: "auto" }}>
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="sm" style={{ tableLayout: "fixed", minWidth: 1180 }}>
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
                    <span style={{ display: "inline-block", transform: "translateX(-28px)" }}>模板</span>
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
                  const hasMultipleTemplates = genResult?.template_dirs && genResult.template_dirs.length > 1;
                  return (
                    <Table.Tr key={item.id || idx}>
                      {/* Logo */}
                      <Table.Td style={{ textAlign: "center" }}>
                        {item.subChannelLogo ? (
                          <img
                            src={item.subChannelLogo}
                            alt={item.subChannelName || ""}
                            style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover" }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <Box
                            w={36} h={36}
                            style={{
                              borderRadius: 6,
                              background: "rgba(94,234,212,0.15)",
                              color: "#64ffda",
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

                      {/* 名称 */}
                      <Table.Td>
                        <Text size="sm" fw={500} lineClamp={1}>
                          {item.subChannelName || "(未命名)"}
                        </Text>
                      </Table.Td>

                      {/* 类型 */}
                      <Table.Td>
                        <Badge
                          variant="light"
                          color="teal"
                          size="sm"
                          style={{ textTransform: "none" }}
                        >
                          {item.typeCode || "-"}
                        </Badge>
                      </Table.Td>

                      {/* 产品 */}
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

                      {/* 模板（带 iframe 轮播） */}
                      <Table.Td>
                        {genResult?.status === "success" ? (
                          <Group gap={4} justify="center" wrap="nowrap" style={{ height: 104, position: "relative", transform: "translateX(-28px)" }}>
                            {hasMultipleTemplates && (
                              <ActionIcon
                                variant="subtle"
                                color="teal"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); onSwitchTemplate(item.id, "prev"); }}
                                title="上一个模板"
                              >
                                <ChevronLeft size={14} />
                              </ActionIcon>
                            )}

                            {/* 轮播卡片 */}
                            {(() => {
                              const total = genResult.template_dirs.length;
                              const indices = getCarouselIndices(currentTemplateIndex, total);
                              if (total === 1) {
                                const s = iframeSrc(genResult, 0);
                                return (
                                  <TemplatePreviewCard
                                    iframeSrc={s}
                                    animationClass=""
                                    isCenter={true}
                                    onClick={() => onOpenPreview(s, `${item.subChannelName || ""} - 模板`)}
                                  />
                                );
                              }
                              return indices.map((tempIdx, pos) => {
                                const isCenter = pos === 1 || total < 3;
                                const s = iframeSrc(genResult, tempIdx);
                                return (
                                  <TemplatePreviewCard
                                    key={tempIdx}
                                    iframeSrc={s}
                                    animationClass={isCenter ? animatingCards[item.id] || "" : ""}
                                    isCenter={isCenter}
                                    onClick={() => onOpenPreview(s, `${item.subChannelName || ""} - 模板${tempIdx + 1}`)}
                                  />
                                );
                              });
                            })()}

                            {hasMultipleTemplates && (
                              <ActionIcon
                                variant="subtle"
                                color="teal"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); onSwitchTemplate(item.id, "next"); }}
                                title="下一个模板"
                              >
                                <ChevronRight size={14} />
                              </ActionIcon>
                            )}

                            {hasMultipleTemplates && (
                              <Text
                                size="xs"
                                c="dimmed"
                                style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}
                              >
                                {currentTemplateIndex + 1}/{genResult.template_dirs.length}
                              </Text>
                            )}
                          </Group>
                        ) : (
                          <Box
                            w={56} h={72}
                            style={{
                              borderRadius: 6,
                              border: "1px solid rgba(94,234,212,0.08)",
                              background: "rgba(15,52,96,0.3)",
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
                                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            ) : (
                              <Text size="sm" c="dimmed">
                                {(item.subChannelName || "?").charAt(0)}
                              </Text>
                            )}
                          </Box>
                        )}
                      </Table.Td>

                      {/* ID */}
                      <Table.Td>
                        <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
                          {item.id}
                        </Text>
                      </Table.Td>

                      {/* 状态 */}
                      <Table.Td>
                        <Stack gap={2} align="center">
                          {genResult?.status === "success" && (
                            <Group gap={6} wrap="nowrap" style={{ color: "#8ee6b8" }}>
                              <Box w={6} h={6} style={{ borderRadius: 999, background: "#35d07f" }} />
                              <Text size="xs" fw={600}>已生成</Text>
                            </Group>
                          )}
                          {genResult?.status === "error" && (
                            <Tooltip label={genResult.message}>
                              <Group gap={6} wrap="nowrap" style={{ color: "#ff9b9b" }}>
                                <Box w={6} h={6} style={{ borderRadius: 999, background: "#ff5d5d" }} />
                                <Text size="xs" fw={600}>失败</Text>
                              </Group>
                            </Tooltip>
                          )}
                          {ftpResult?.status === "success" && (
                            <Group gap={6} wrap="nowrap" style={{ color: "#8bbdff" }}>
                              <Box w={6} h={6} style={{ borderRadius: 999, background: "#4d8dff" }} />
                              <Text size="xs" fw={600}>已上传</Text>
                            </Group>
                          )}
                        </Stack>
                      </Table.Td>

                      {/* 操作 */}
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
                                      notifications.show({ title: "打开失败", message: String(e), color: "red", autoClose: 3000 });
                                    }
                                  }}
                                >
                                  <FolderOpen size={14} />
                                </ActionIcon>
                              </Tooltip>
                              <Button
                                variant="light"
                                color="teal"
                                size="compact-xs"
                                leftSection={<Eye size={13} />}
                                onClick={() => {
                                  onOpenPreview(
                                    iframeSrc(genResult, currentTemplateIndex),
                                    `${item.subChannelName || ""} - 模板${currentTemplateIndex + 1}`
                                  );
                                }}
                              >
                                预览
                              </Button>
                            </>
                          )}
                          {genResult?.status === "error" && (
                            <Text size="xs" c="red" title={genResult.message}>失败</Text>
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
      )}

      {/* 马甲包生成结果 — 带 iframe 模板预览 */}
      {landingMode === "vest" && Object.keys(landingGenerated).length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Box style={{ overflowX: "auto" }}>
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="sm" style={{ tableLayout: "fixed", minWidth: 900 }}>
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
                    <span style={{ display: "inline-block", transform: "translateX(-28px)" }}>模板</span>
                  </Table.Th>
                  <Table.Th style={{ textAlign: "center" }}>状态</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(landingGenerated).map(([id, genResult]) => {
                  const ftpResult = ftpUploadResults[id];
                  const currentTemplateIndex = getTemplateIndex(id);
                  const hasMultipleTemplates = genResult?.template_dirs && genResult.template_dirs.length > 1;
                  return (
                    <Table.Tr key={id}>
                      <Table.Td>
                        <Text fw={600} size="sm">{genResult?.name || id}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{id}</Text>
                      </Table.Td>

                      {/* 模板（带 iframe 轮播） */}
                      <Table.Td>
                        {genResult?.status === "success" ? (
                          <Group gap={4} justify="center" wrap="nowrap" style={{ height: 104, position: "relative", transform: "translateX(-28px)" }}>
                            {hasMultipleTemplates && (
                              <ActionIcon
                                variant="subtle" color="teal" size="sm"
                                onClick={(e) => { e.stopPropagation(); onSwitchTemplate(id, "prev"); }}
                              >
                                <ChevronLeft size={14} />
                              </ActionIcon>
                            )}
                            {(() => {
                              const total = genResult.template_dirs.length;
                              const indices = getCarouselIndices(currentTemplateIndex, total);
                              if (total === 1) {
                                const s = iframeSrc(genResult, 0);
                                return (
                                  <TemplatePreviewCard
                                    iframeSrc={s}
                                    animationClass=""
                                    isCenter={true}
                                    onClick={() => onOpenPreview(s, `${genResult.name} - 模板`)}
                                  />
                                );
                              }
                              return indices.map((tempIdx, pos) => {
                                const isCenter = pos === 1 || total < 3;
                                const s = iframeSrc(genResult, tempIdx);
                                return (
                                  <TemplatePreviewCard
                                    key={tempIdx}
                                    iframeSrc={s}
                                    animationClass={isCenter ? animatingCards[id] || "" : ""}
                                    isCenter={isCenter}
                                    onClick={() => onOpenPreview(s, `${genResult.name} - 模板${tempIdx + 1}`)}
                                  />
                                );
                              });
                            })()}
                            {hasMultipleTemplates && (
                              <ActionIcon
                                variant="subtle" color="teal" size="sm"
                                onClick={(e) => { e.stopPropagation(); onSwitchTemplate(id, "next"); }}
                              >
                                <ChevronRight size={14} />
                              </ActionIcon>
                            )}
                            {hasMultipleTemplates && (
                              <Text size="xs" c="dimmed" style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}>
                                {currentTemplateIndex + 1}/{genResult.template_dirs.length}
                              </Text>
                            )}
                          </Group>
                        ) : (
                          <Box w={56} h={72} style={{
                            borderRadius: 6, border: "1px solid rgba(94,234,212,0.08)",
                            background: "rgba(15,52,96,0.3)", display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <Text size="sm" c="dimmed">{(genResult?.name || "?").charAt(0)}</Text>
                          </Box>
                        )}
                      </Table.Td>

                      <Table.Td style={{ textAlign: "center" }}>
                        {genResult?.status === "success" ? (
                          <Badge color="teal" variant="light">成功</Badge>
                        ) : genResult?.status === "error" ? (
                          <Badge color="red" variant="light">失败</Badge>
                        ) : (
                          <Badge color="yellow" variant="light">处理中</Badge>
                        )}
                      </Table.Td>

                      <Table.Td style={{ textAlign: "right" }}>
                        <Group gap={4} justify="flex-end">
                          {genResult?.status === "success" && (
                            <>
                              <Tooltip label="打开模板目录">
                                <ActionIcon variant="light" color="gray" size="sm"
                                  onClick={async () => {
                                    try {
                                      await invoke("open_directory", { path: `${genResult.output_dir}/template_${currentTemplateIndex}` });
                                    } catch (e) { notifications.show({ title: "打开失败", message: String(e), color: "red", autoClose: 3000 }); }
                                  }}
                                >
                                  <FolderOpen size={14} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="预览">
                                <ActionIcon variant="light" color="teal" size="sm"
                                  onClick={() => onOpenPreview(
                                    iframeSrc(genResult, currentTemplateIndex),
                                    genResult.name,
                                  )}
                                >
                                  <Maximize2 size={14} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          )}
                          {ftpResult && ftpResult.status === "success" && (
                            <Tooltip label="复制链接">
                              <ActionIcon variant="light" color="teal" size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(ftpResult.url);
                                  notifications.show({ message: "已复制", color: "teal", autoClose: 1500 });
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
      )}
    </>
  );
}
