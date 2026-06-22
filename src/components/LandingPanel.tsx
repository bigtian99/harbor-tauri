import { useState, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { notifications } from "@mantine/notifications";
import {
  TextInput,
  Button,
  Group,
  Stack,
  Table,
  Badge,
  Text,
  Title,
  Progress,
  Modal,
  Accordion,
  ActionIcon,
  Tooltip,
  Paper,
  Box,
} from "@mantine/core";
import {
  Globe,
  Rocket,
  ExternalLink,
  Copy,
  Loader2,
  Eye,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Trash2,
  Package,
  Maximize2,
} from "lucide-react";
import type { SubChannelData, LandingPageResult, FtpUploadResult, TemplateInfo } from "../types";
import { isTauriRuntime } from "../types";

interface LandingPanelProps {
  landingIds: string;
  landingPreviewData: SubChannelData[];
  landingGenerated: Record<string, LandingPageResult>;
  ftpUploadResults: Record<string, FtpUploadResult>;
  templateIndices: Record<string, number>;
  isFetchingPreview: boolean;
  isGenerating: boolean;
  isUploadingToFtp: boolean;
  progress: number;
  progressMessage: string;
  landingOutputDir: string;
  previewBaseUrl: string;
  setLandingIds: (value: string) => void;
  setTemplateIndices: (value: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  onPreview: () => void;
  onFtpUpload: () => void;
  onCopyAllLinks: () => void;
}

export function LandingPanel({
  landingIds,
  landingPreviewData, landingGenerated, ftpUploadResults,
  templateIndices, setTemplateIndices,
  isFetchingPreview, isGenerating, isUploadingToFtp,
  progress, progressMessage,
  landingOutputDir, previewBaseUrl,
  setLandingIds,
  onPreview, onFtpUpload, onCopyAllLinks,
}: LandingPanelProps) {
  const [animatingCards, setAnimatingCards] = useState<Record<string, string>>({});
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 模板管理状态
  const [templateInfos, setTemplateInfos] = useState<TemplateInfo[]>([]);
  const [templatesBaseDir, setTemplatesBaseDir] = useState("");
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);

  // 预览浮层状态
  const [previewOverlay, setPreviewOverlay] = useState<{
    src: string;
    title: string;
  } | null>(null);

  // 按中文分类分组
  const templateGroups = (() => {
    const groups: Record<string, string[]> = {};
    for (const info of templateInfos) {
      (groups[info.category] ||= []).push(info.dir);
    }
    return Object.entries(groups)
      .map(([category, dirs]) => ({ category, dirs: dirs.sort() }))
      .sort((a, b) => a.category.localeCompare(b.category, "zh-Hans-CN"));
  })();

  // 模板预览：优先走本地 HTTP 预览服务器
  const getTemplatePreviewSrc = useCallback((dir: string) => {
    if (previewBaseUrl) {
      return `${previewBaseUrl}/__templates__/${encodeURIComponent(dir)}/index.html`;
    }
    if (templatesBaseDir) {
      return convertFileSrc(`${templatesBaseDir}/${dir}/index.html`);
    }
    return "";
  }, [previewBaseUrl, templatesBaseDir]);

  const loadTemplateInfos = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const infos = await invoke<TemplateInfo[]>("list_template_infos");
      setTemplateInfos(infos);
      if (!templatesBaseDir) {
        const base = await invoke<string>("get_bundled_templates_dir");
        setTemplatesBaseDir(base);
      }
    } catch { /* 忽略 */ }
  }, [templatesBaseDir]);

  const handleOpenTemplateManager = useCallback(() => {
    setShowTemplateManager(true);
    loadTemplateInfos();
  }, [loadTemplateInfos]);

  const handleUploadTemplateZip = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "ZIP 文件", extensions: ["zip"] }],
      });
      if (!selected) return;
      setIsUploadingTemplate(true);
      const results = await invoke<{ dir_name: string; file_count: number }[]>("upload_template_zip", {
        zipPath: selected as string,
      });
      const names = results.map((r) => r.dir_name).join(", ");
      notifications.show({ message: `模板上传完成: ${names}`, color: "teal", autoClose: 3000 });
      await loadTemplateInfos();
    } catch (e) {
      notifications.show({ title: "上传失败", message: String(e), color: "red", autoClose: 5000 });
    } finally {
      setIsUploadingTemplate(false);
    }
  }, [loadTemplateInfos]);

  const handleDeleteTemplate = useCallback(async (dirName: string) => {
    if (!window.confirm(`确认删除模板 "${dirName}"？此操作不可撤销。`)) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("delete_template_dir", { dirName });
      notifications.show({ message: `已删除模板: ${dirName}`, color: "teal", autoClose: 3000 });
      await loadTemplateInfos();
    } catch (e) {
      notifications.show({ title: "删除失败", message: String(e), color: "red", autoClose: 5000 });
    }
  }, [loadTemplateInfos]);

  const getTemplateIndex = useCallback((id: string) => {
    return templateIndices[id] || 0;
  }, [templateIndices]);

  const switchTemplate = useCallback((id: string, direction: "prev" | "next") => {
    const result = landingGenerated[id];
    if (!result || !result.template_dirs || result.template_dirs.length <= 1) return;

    if (animationTimerRef.current) {
      clearTimeout(animationTimerRef.current);
    }

    const animClass = direction === "prev" ? "animating-left" : "animating-right";
    setAnimatingCards(prev => ({ ...prev, [id]: animClass }));

    setTemplateIndices(prev => {
      const currentIndex = prev[id] || 0;
      let newIndex: number;
      if (direction === "prev") {
        newIndex = currentIndex > 0 ? currentIndex - 1 : result.template_dirs.length - 1;
      } else {
        newIndex = currentIndex < result.template_dirs.length - 1 ? currentIndex + 1 : 0;
      }
      return { ...prev, [id]: newIndex };
    });

    animationTimerRef.current = setTimeout(() => {
      setAnimatingCards(prev => ({ ...prev, [id]: "" }));
    }, 400);
  }, [landingGenerated]);

  const getTemplateIframeSrc = useCallback((genResult: LandingPageResult, templateIdx: number) => {
    const idx = genResult.template_dirs && genResult.template_dirs.length > 0 ? templateIdx : 0;
    const base = landingOutputDir;
    if (
      previewBaseUrl &&
      base &&
      genResult.output_dir.startsWith(base) &&
      genResult.output_dir[base.length] === "/"
    ) {
      let rel = genResult.output_dir.slice(base.length).replace(/^\/+|\/+$/g, "");
      const file = `${rel}/template_${idx}/index.html`;
      const encoded = file.split("/").map(encodeURIComponent).join("/");
      return `${previewBaseUrl}/${encoded}`;
    }
    return convertFileSrc(`${genResult.output_dir}/template_${idx}/index.html`);
  }, [previewBaseUrl, landingOutputDir]);

  const getCarouselIndices = useCallback((id: string, total: number) => {
    const current = getTemplateIndex(id);
    const indices: number[] = [];

    if (total === 1) {
      indices.push(0);
    } else if (total === 2) {
      indices.push(0, 1);
    } else {
      indices.push(current > 0 ? current - 1 : total - 1);
      indices.push(current);
      indices.push(current < total - 1 ? current + 1 : 0);
    }

    return indices;
  }, [getTemplateIndex]);

  const openInAppPreview = useCallback((src: string, title: string) => {
    setPreviewOverlay({ src, title });
  }, []);

  const closePreviewOverlay = useCallback(() => {
    setPreviewOverlay(null);
  }, []);

  const closeTemplateManager = useCallback(() => {
    setShowTemplateManager(false);
  }, []);

  // 是否有已生成的结果
  const hasGeneratedResults = Object.keys(landingGenerated).length > 0;
  const hasFtpResults = Object.keys(ftpUploadResults).length > 0;

  return (
    <Box style={{ padding: "32px 40px" }}>
        <Stack gap="md">
          {/* 标题 */}
          <Group gap="xs">
            <Globe size={22} />
            <Title order={3}>生成落地页</Title>
          </Group>

          {/* 子渠道 IDs */}
          <TextInput
            value={landingIds}
            onChange={(e) => setLandingIds(e.currentTarget.value)}
            placeholder="例如: 154,155,156"
            label="子渠道 IDs（逗号分隔）"
          />

          {/* 操作按钮 */}
          <Group gap="sm">
            {!hasGeneratedResults && (
              <Button
                leftSection={isFetchingPreview || isGenerating ? <Loader2 size={14} className="spin" /> : <Rocket size={14} />}
                disabled={!landingIds || isFetchingPreview || isGenerating}
                onClick={onPreview}
                variant="gradient"
                gradient={{ from: "teal", to: "cyan" }}
              >
                预览数据
              </Button>
            )}
            {hasGeneratedResults && !isGenerating && (
              <Button
                leftSection={isUploadingToFtp ? <Loader2 size={14} className="spin" /> : <ExternalLink size={14} />}
                disabled={isUploadingToFtp}
                onClick={onFtpUpload}
                color="blue"
              >
                上传到 FTP
              </Button>
            )}
            {hasFtpResults && !isGenerating && (
              <Button
                leftSection={<Copy size={14} />}
                onClick={onCopyAllLinks}
                variant="outline"
                color="gray"
              >
                复制所有链接
              </Button>
            )}
            <Button
              leftSection={<Package size={14} />}
              onClick={handleOpenTemplateManager}
              variant="light"
              color="gray"
              style={{ marginLeft: "auto" }}
            >
              管理模板
            </Button>
          </Group>

          {/* FTP 上传进度 */}
          {isUploadingToFtp && (
            <Paper p="sm" withBorder>
              <Group justify="space-between" mb={4}>
                <Text size="sm">{progressMessage}</Text>
                <Text size="sm" fw={600}>{progress}%</Text>
              </Group>
              <Progress value={progress} animated color="blue" size="sm" />
            </Paper>
          )}

          {/* 数据表格 */}
          {landingPreviewData.length > 0 && (
            <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
              <Box style={{ overflowX: "auto" }}>
                <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="sm" style={{ tableLayout: "fixed", minWidth: 1000 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 46, textAlign: "center" }}></Table.Th>
                      <Table.Th style={{ width: 140 }}>名称</Table.Th>
                      <Table.Th style={{ width: 120 }}>类型</Table.Th>
                      <Table.Th style={{ width: 300 }}>产品</Table.Th>
                      <Table.Th style={{ width: 200, textAlign: "center" }}>模板</Table.Th>
                      <Table.Th style={{ width: 80 }}>ID</Table.Th>
                      <Table.Th style={{ width: 110, textAlign: "center" }}>状态</Table.Th>
                      <Table.Th style={{ width: 100, textAlign: "right" }}>操作</Table.Th>
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
                                  background: "rgba(100,255,218,0.15)",
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
                              <Group gap={4} justify="center" style={{ height: 90, position: "relative" }}>
                                {hasMultipleTemplates && (
                                  <ActionIcon
                                    variant="subtle"
                                    color="teal"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); switchTemplate(item.id, "prev"); }}
                                    title="上一个模板"
                                  >
                                    <ChevronLeft size={14} />
                                  </ActionIcon>
                                )}

                                {/* 轮播卡片 */}
                                {(() => {
                                  const total = genResult.template_dirs.length;
                                  const indices = getCarouselIndices(item.id, total);
                                  if (total === 1) {
                                    const s = getTemplateIframeSrc(genResult, 0);
                                    return (
                                      <TemplatePreviewCard
                                        iframeSrc={s}
                                        animationClass=""
                                        isCenter={true}
                                        onClick={() => openInAppPreview(s, `${item.subChannelName || ""} - 模板`)}
                                      />
                                    );
                                  }
                                  return indices.map((tempIdx, pos) => {
                                    const isCenter = pos === 1 || total < 3;
                                    const s = getTemplateIframeSrc(genResult, tempIdx);
                                    return (
                                      <TemplatePreviewCard
                                        key={tempIdx}
                                        iframeSrc={s}
                                        animationClass={isCenter ? animatingCards[item.id] || "" : ""}
                                        isCenter={isCenter}
                                        onClick={() => openInAppPreview(s, `${item.subChannelName || ""} - 模板${tempIdx + 1}`)}
                                      />
                                    );
                                  });
                                })()}

                                {hasMultipleTemplates && (
                                  <ActionIcon
                                    variant="subtle"
                                    color="teal"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); switchTemplate(item.id, "next"); }}
                                    title="下一个模板"
                                  >
                                    <ChevronRight size={14} />
                                  </ActionIcon>
                                )}

                                {hasMultipleTemplates && (
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                    style={{ position: "absolute", bottom: -2, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}
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
                                  border: "1px solid rgba(100,255,218,0.08)",
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
                            <Group gap={4} justify="center" wrap="nowrap">
                              {genResult?.status === "success" && (
                                <Badge variant="light" color="green" size="sm" radius="xl">✓ 已生成</Badge>
                              )}
                              {genResult?.status === "error" && (
                                <Tooltip label={genResult.message}>
                                  <Badge variant="light" color="red" size="sm" radius="xl">✗ 失败</Badge>
                                </Tooltip>
                              )}
                              {ftpResult?.status === "success" && (
                                <Badge variant="light" color="blue" size="sm" radius="xl">↑ 已上传</Badge>
                              )}
                            </Group>
                          </Table.Td>

                          {/* 操作 */}
                          <Table.Td>
                            <Group gap={4} justify="flex-end">
                              {genResult?.status === "success" && (
                                <Button
                                  variant="light"
                                  color="teal"
                                  size="compact-xs"
                                  leftSection={<Eye size={13} />}
                                  onClick={() => {
                                    openInAppPreview(
                                      getTemplateIframeSrc(genResult, currentTemplateIndex),
                                      `${item.subChannelName || ""} - 模板${currentTemplateIndex + 1}`
                                    );
                                  }}
                                >
                                  预览
                                </Button>
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
        </Stack>

      {/* ========== 模板管理弹窗 ========== */}
      <Modal
        opened={showTemplateManager}
        onClose={closeTemplateManager}
        title={
          <Group gap="xs">
            <Package size={16} />
            <Text fw={600}>管理模板</Text>
          </Group>
        }
        size="lg"
      >
        <Group mb="md">
          <Button
            leftSection={isUploadingTemplate ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
            onClick={handleUploadTemplateZip}
            loading={isUploadingTemplate}
            variant="light"
          >
            上传模板 zip
          </Button>
        </Group>

        {templateInfos.length === 0 ? (
          <Text c="dimmed" size="sm" ta="center" py="xl">暂无模板目录</Text>
        ) : (
          <>
          <style>{`
            .accordion-chevron { transition: transform 0.2s ease; }
            [data-expanded] .accordion-chevron { transform: rotate(90deg) !important; }
          `}</style>
          <Accordion
            variant="separated"
            radius="sm"
            chevron={<ChevronRight size={16} className="accordion-chevron" />}
          >
            {templateGroups.map(({ category, dirs }) => (
              <Accordion.Item key={category} value={category}>
                <Accordion.Control>
                  <Group gap="xs">
                    <Text size="sm" fw={600} style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
                      {category}
                    </Text>
                    <Badge variant="light" color="gray" size="xs">{dirs.length} 个</Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Box
                    style={{
                      overflowX: "auto",
                      padding: "10px 4px",
                    }}
                  >
                    <Box
                      style={{
                        display: "flex",
                        gap: 10,
                        width: "max-content",
                      }}
                    >
                    {dirs.map((dir) => {
                      const previewSrc = getTemplatePreviewSrc(dir);
                      return (
                        <Box
                          key={dir}
                          style={{
                            position: "relative",
                            width: 180,
                            height: 320,
                            overflow: "hidden",
                            borderRadius: 6,
                            border: "1px solid rgba(100,255,218,0.12)",
                            cursor: "pointer",
                            background: "#0a192f",
                          }}
                          className="tpl-root"
                          onClick={() => {
                            if (previewSrc) openInAppPreview(previewSrc, `模板: ${dir}`);
                          }}
                        >
                          {/* iframe 预览 */}
                          <Box style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
                            {previewSrc ? (
                              <Box
                                style={{
                                  width: 375,
                                  height: 667,
                                  transform: "scale(0.48)",
                                  transformOrigin: "top left",
                                  pointerEvents: "none",
                                }}
                              >
                                <iframe
                                  src={previewSrc}
                                  style={{ width: 375, height: 667, border: "none" }}
                                  loading="lazy"
                                  title={dir}
                                />
                              </Box>
                            ) : (
                              <Box style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                                <Text c="dimmed" size="sm">…</Text>
                              </Box>
                            )}
                          </Box>

                          {/* 放大预览按钮 */}
                          <ActionIcon
                            variant="light"
                            color="teal"
                            size="sm"
                            style={{
                              position: "absolute",
                              top: 6,
                              right: 38,
                              zIndex: 2,
                              transition: "opacity 0.18s ease",
                            }}
                            className="tpl-hover-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (previewSrc) openInAppPreview(previewSrc, `模板: ${dir}`);
                            }}
                          >
                            <Maximize2 size={13} />
                          </ActionIcon>

                          {/* 删除按钮 */}
                          <ActionIcon
                            variant="filled"
                            color="red"
                            size="sm"
                            style={{
                              position: "absolute",
                              top: 6,
                              right: 6,
                              zIndex: 2,
                              transition: "opacity 0.18s ease",
                            }}
                            className="tpl-hover-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteTemplate(dir);
                            }}
                          >
                            <Trash2 size={13} />
                          </ActionIcon>

                          <style>{`
                            .tpl-hover-btn { opacity: 0; transition: opacity 0.18s ease; }
                            .tpl-root:hover .tpl-hover-btn { opacity: 1 !important; }
                          `}</style>
                        </Box>
                      );
                    })}
                  </Box>
                  </Box>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
          </>
        )}
      </Modal>

      {/* ========== 全屏预览浮层 ========== */}
      <Modal
        opened={!!previewOverlay}
        onClose={closePreviewOverlay}
        title={
          previewOverlay ? (
            <Group gap="xs">
              <Text size="sm" fw={600} c="teal" lineClamp={1} style={{ flex: 1 }}>
                {previewOverlay.title}
              </Text>
              <Button
                variant="light"
                color="gray"
                size="compact-xs"
                leftSection={<ExternalLink size={14} />}
                onClick={() => window.open(previewOverlay.src, "_blank")}
              >
                外部浏览器
              </Button>
            </Group>
          ) : null
        }
        fullScreen
      >
        {previewOverlay && (
          <iframe
            src={previewOverlay.src}
            style={{
              width: "100%",
              height: "calc(100vh - 60px)",
              border: "none",
              display: "block",
              background: "#fff",
            }}
            title={previewOverlay.title}
          />
        )}
      </Modal>
    </Box>
  );
}

// ========== 模板预览卡片子组件 ==========
function TemplatePreviewCard({
  iframeSrc,
  animationClass,
  isCenter,
  onClick,
}: {
  iframeSrc: string;
  animationClass: string;
  isCenter: boolean;
  onClick: () => void;
}) {
  const cardWidth = isCenter ? 60 : 40;
  const cardHeight = isCenter ? 80 : 56;
  const wrapperScale = isCenter ? 0.16 : 0.107;

  return (
    <Box
      onClick={onClick}
      title="点击放大预览"
      style={{
        position: "relative",
        borderRadius: 8,
        border: `1px solid ${isCenter ? "rgba(100,255,218,0.6)" : "rgba(100,255,218,0.15)"}`,
        overflow: "hidden",
        cursor: "pointer",
        background: "#fff",
        flexShrink: 0,
        width: cardWidth,
        height: cardHeight,
        opacity: isCenter ? 1 : 0.5,
        transform: isCenter ? "scale(1)" : "scale(0.92)",
        boxShadow: isCenter ? "0 4px 20px rgba(100,255,218,0.35)" : "none",
        zIndex: isCenter ? 2 : 1,
        transition: "all 0.4s cubic-bezier(0.25,0.46,0.45,0.94)",
        animation: animationClass === "animating-left"
          ? "slideInFromLeft 0.35s cubic-bezier(0.25,0.46,0.45,0.94) forwards"
          : animationClass === "animating-right"
            ? "slideInFromRight 0.35s cubic-bezier(0.25,0.46,0.45,0.94) forwards"
            : "none",
      }}
      onMouseEnter={(e) => {
        if (isCenter) {
          e.currentTarget.style.borderColor = "rgba(100,255,218,0.8)";
          e.currentTarget.style.boxShadow = "0 6px 24px rgba(100,255,218,0.45)";
          e.currentTarget.style.transform = "scale(1.08)";
        } else {
          e.currentTarget.style.opacity = "0.75";
          e.currentTarget.style.transform = "scale(0.96)";
        }
      }}
      onMouseLeave={(e) => {
        if (isCenter) {
          e.currentTarget.style.borderColor = "rgba(100,255,218,0.6)";
          e.currentTarget.style.boxShadow = "0 4px 20px rgba(100,255,218,0.35)";
          e.currentTarget.style.transform = "scale(1)";
        } else {
          e.currentTarget.style.opacity = "0.5";
          e.currentTarget.style.transform = "scale(0.92)";
        }
      }}
    >
      <Box
        style={{
          width: 375,
          height: 812,
          transform: `scale(${wrapperScale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        <iframe
          src={iframeSrc}
          style={{ width: 375, height: 812, border: "none", pointerEvents: "none" }}
          loading="lazy"
        />
      </Box>
    </Box>
  );
}
