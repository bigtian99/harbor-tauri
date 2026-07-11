import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { notifications } from "@mantine/notifications";
import { Stack, Box } from "@mantine/core";
import type { TemplateInfo } from "../types";
import { isTauriRuntime } from "../types";
import type { LandingPanelProps, PreviewOverlayState } from "./landing/types";
import { LandingChannelForm } from "./landing/LandingChannelForm";
import { LandingFtpSection } from "./landing/LandingFtpSection";
import { LandingPreview } from "./landing/LandingPreview";
import { LandingTemplateSection } from "./landing/LandingTemplateSection";

export type { LandingPanelProps } from "./landing/types";

export function LandingPanel({
  landingIds, landingMode, vestAuthorization,
  landingPreviewData, landingGenerated, ftpUploadResults,
  templateIndices, setTemplateIndices,
  isFetchingPreview, isGenerating, isUploadingToFtp,
  progress, progressMessage,
  landingOutputDir, previewBaseUrl,
  setLandingIds, setLandingMode, setVestAuthorization,
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
  const [previewOverlay, setPreviewOverlay] = useState<PreviewOverlayState | null>(null);

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
  }, [landingGenerated, setTemplateIndices]);

  const openInAppPreview = useCallback((src: string, title: string) => {
    setPreviewOverlay({ src, title });
  }, []);

  const closePreviewOverlay = useCallback(() => {
    setPreviewOverlay(null);
  }, []);

  const closeTemplateManager = useCallback(() => {
    setShowTemplateManager(false);
  }, []);

  const hasGeneratedResults = Object.keys(landingGenerated).length > 0;
  const hasFtpResults = Object.keys(ftpUploadResults).length > 0;

  return (
    <Box style={{ padding: "32px 40px" }}>
      <Stack gap="md">
        <LandingChannelForm
          landingIds={landingIds}
          landingMode={landingMode}
          vestAuthorization={vestAuthorization}
          isFetchingPreview={isFetchingPreview}
          isGenerating={isGenerating}
          isUploadingToFtp={isUploadingToFtp}
          hasGeneratedResults={hasGeneratedResults}
          hasFtpResults={hasFtpResults}
          setLandingIds={setLandingIds}
          setLandingMode={setLandingMode}
          setVestAuthorization={setVestAuthorization}
          onPreview={onPreview}
          onFtpUpload={onFtpUpload}
          onCopyAllLinks={onCopyAllLinks}
          onOpenTemplateManager={handleOpenTemplateManager}
        />

        <LandingFtpSection
          isUploadingToFtp={isUploadingToFtp}
          progress={progress}
          progressMessage={progressMessage}
        />

        <LandingPreview
          landingMode={landingMode}
          landingPreviewData={landingPreviewData}
          landingGenerated={landingGenerated}
          ftpUploadResults={ftpUploadResults}
          templateIndices={templateIndices}
          animatingCards={animatingCards}
          landingOutputDir={landingOutputDir}
          previewBaseUrl={previewBaseUrl}
          onSwitchTemplate={switchTemplate}
          onOpenPreview={openInAppPreview}
        />
      </Stack>

      <LandingTemplateSection
        showTemplateManager={showTemplateManager}
        onCloseTemplateManager={closeTemplateManager}
        isUploadingTemplate={isUploadingTemplate}
        onUploadTemplateZip={handleUploadTemplateZip}
        templateInfos={templateInfos}
        templateGroups={templateGroups}
        previewBaseUrl={previewBaseUrl}
        templatesBaseDir={templatesBaseDir}
        onDeleteTemplate={handleDeleteTemplate}
        onOpenPreview={openInAppPreview}
        previewOverlay={previewOverlay}
        onClosePreviewOverlay={closePreviewOverlay}
      />
    </Box>
  );
}
