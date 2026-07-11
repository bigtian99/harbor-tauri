import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Button,
  Group,
  Text,
  Modal,
  Accordion,
  ActionIcon,
  Badge,
  Box,
} from "@mantine/core";
import {
  ExternalLink,
  Loader2,
  ChevronRight,
  FolderOpen,
  Trash2,
  Package,
  Maximize2,
} from "lucide-react";
import type { TemplateInfo } from "../../types";
import type { PreviewOverlayState, TemplateGroup } from "./types";
import { getTemplatePreviewSrc } from "./utils";

interface LandingTemplateSectionProps {
  showTemplateManager: boolean;
  onCloseTemplateManager: () => void;
  isUploadingTemplate: boolean;
  onUploadTemplateZip: () => void;
  templateInfos: TemplateInfo[];
  templateGroups: TemplateGroup[];
  previewBaseUrl: string;
  templatesBaseDir: string;
  onDeleteTemplate: (dirName: string) => void;
  onOpenPreview: (src: string, title: string) => void;
  previewOverlay: PreviewOverlayState | null;
  onClosePreviewOverlay: () => void;
}

export function LandingTemplateSection({
  showTemplateManager,
  onCloseTemplateManager,
  isUploadingTemplate,
  onUploadTemplateZip,
  templateInfos,
  templateGroups,
  previewBaseUrl,
  templatesBaseDir,
  onDeleteTemplate,
  onOpenPreview,
  previewOverlay,
  onClosePreviewOverlay,
}: LandingTemplateSectionProps) {
  return (
    <>
      {/* ========== 模板管理弹窗 ========== */}
      <Modal
        opened={showTemplateManager}
        onClose={onCloseTemplateManager}
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
            onClick={onUploadTemplateZip}
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
                      const previewSrc = getTemplatePreviewSrc(dir, previewBaseUrl, templatesBaseDir);
                      return (
                        <Box
                          key={dir}
                          style={{
                            position: "relative",
                            width: 180,
                            height: 320,
                            overflow: "hidden",
                            borderRadius: 6,
                            border: "1px solid rgba(94,234,212,0.12)",
                            cursor: "pointer",
                            background: "#0a192f",
                          }}
                          className="tpl-root"
                          onClick={() => {
                            if (previewSrc) onOpenPreview(previewSrc, `模板: ${dir}`);
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
                              if (previewSrc) onOpenPreview(previewSrc, `模板: ${dir}`);
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
                              onDeleteTemplate(dir);
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
        onClose={onClosePreviewOverlay}
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
                onClick={() => openUrl(previewOverlay.src)}
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
    </>
  );
}
