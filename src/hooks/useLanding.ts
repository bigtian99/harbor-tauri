import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type { SubChannelData, LandingPageResult, FtpUploadResult, TabType } from "../types";
import { isTauriRuntime } from "../types";

const LANDING_API_URL = "https://tksyadmin.tiankongshuyu.cn";

interface UseLandingDeps {
  activeTab: TabType;
  setLog: (value: string) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
}

/**
 * 落地页生成与 FTP 上传的全部状态与逻辑。
 * progress / progressMessage 由 App 持有并传入（构建流程也复用）。
 * 通知使用 Mantine Notifications 系统。
 */
export function useLanding(deps: UseLandingDeps) {
  const { activeTab, setLog, setProgress, setProgressMessage } = deps;

  const [landingTemplateBase, setLandingTemplateBase] = useState("");
  const [landingIds, setLandingIds] = useState("");
  const [landingOutputDir, setLandingOutputDir] = useState("");
  const [previewBaseUrl, setPreviewBaseUrl] = useState("");
  const [landingPreviewData, setLandingPreviewData] = useState<SubChannelData[]>([]);
  const [landingGenerated, setLandingGenerated] = useState<Record<string, LandingPageResult>>({});
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [ftpUploadResults, setFtpUploadResults] = useState<Record<string, FtpUploadResult>>({});
  const [isUploadingToFtp, setIsUploadingToFtp] = useState(false);
  const [templateIndices, setTemplateIndices] = useState<Record<string, number>>({});
  const landingDebounceRef = useRef<number | null>(null);

  // 拉取子渠道并生成落地页（防抖预览与手动预览共用）
  async function runLandingGeneration(showDoneToast: boolean) {
    setIsFetchingPreview(true);
    setLandingPreviewData([]);
    setLandingGenerated({});
    setFtpUploadResults({});
    setLog("");
    setProgress(0);
    try {
      const data = await invoke<SubChannelData[]>("fetch_sub_channels", {
        apiUrl: LANDING_API_URL,
        ids: landingIds.trim(),
      });
      setLandingPreviewData(data);
      setIsGenerating(true);
      const results = await invoke<LandingPageResult[]>("generate_landing_pages", {
        apiUrl: LANDING_API_URL,
        ids: landingIds.trim(),
        templateBase: landingTemplateBase,
        outputDir: landingOutputDir.trim(),
      });
      const map: Record<string, LandingPageResult> = {};
      for (const r of results) { map[r.id] = r; }
      setLandingGenerated(map);
      if (showDoneToast) {
        const success = results.filter((r) => r.status === "success").length;
        const failed = results.length - success;
        notifications.show({
          message: failed > 0
            ? `生成完成: 成功 ${success} 个, 失败 ${failed} 个`
            : `生成完成: 成功 ${success} 个`,
          color: failed > 0 ? "yellow" : "teal",
          autoClose: 3000,
        });
      }
    } catch (e) {
      notifications.show({
        title: "操作失败",
        message: String(e),
        color: "red",
        autoClose: 5000,
      });
    } finally {
      setIsFetchingPreview(false);
      setIsGenerating(false);
    }
  }

  async function handleLandingPreview() {
    if (!isTauriRuntime() || !landingIds.trim()) return;
    await runLandingGeneration(true);
  }

  async function handleFtpUpload() {
    if (!isTauriRuntime()) return;
    setIsUploadingToFtp(true);
    setFtpUploadResults({});
    setProgress(0);
    setProgressMessage("");
    try {
      const items: { id: string; local_dir: string; remote_dir: string }[] = Object.entries(landingGenerated)
        .filter(([, r]) => r.status === "success")
        .map(([key, r]) => {
          const templateIdx = templateIndices[key] || 0;
          const localDir = `${r.output_dir}/template_${templateIdx}`;
          return {
            id: r.id,
            local_dir: localDir,
            remote_dir: `${r.id}/${r.type_code}`,
          };
        });
      if (items.length === 0) {
        notifications.show({
          message: "没有可上传的已成功生成的落地页",
          color: "yellow",
          autoClose: 3000,
        });
        return;
      }
      const results = await invoke<FtpUploadResult[]>("upload_landing_to_ftp", { items });
      const map: Record<string, FtpUploadResult> = {};
      for (const r of results) { map[r.id] = r; }
      setFtpUploadResults(map);
      const success = results.filter((r) => r.status === "success").length;
      notifications.show({
        message: `FTP 上传完成: 成功 ${success} / ${results.length}`,
        color: success === results.length ? "teal" : "yellow",
        autoClose: 3000,
      });
    } catch (e) {
      notifications.show({
        title: "FTP 上传失败",
        message: String(e),
        color: "red",
        autoClose: 5000,
      });
    } finally {
      setIsUploadingToFtp(false);
    }
  }

  async function handleCopyAllLinks() {
    const urls = Object.values(ftpUploadResults)
      .filter((r) => r.status === "success")
      .map((r) => r.url);
    if (urls.length === 0) {
      notifications.show({
        message: "没有可复制的链接",
        color: "yellow",
        autoClose: 3000,
      });
      return;
    }
    await navigator.clipboard.writeText(urls.join("\n"));
    notifications.show({
      message: `已复制 ${urls.length} 个链接`,
      color: "teal",
      autoClose: 2000,
    });
  }

  // 进入落地页标签时获取模板目录、临时输出目录与本地预览服务地址
  useEffect(() => {
    if (activeTab === "landing" && isTauriRuntime()) {
      if (!landingTemplateBase) {
        invoke<string>("get_bundled_templates_dir").then((dir) => {
          setLandingTemplateBase(dir);
        }).catch(() => {});
      }
      if (!landingOutputDir) {
        invoke<string>("get_temp_dir").then((dir) => {
          setLandingOutputDir(dir);
        }).catch(() => {});
      }
      if (!previewBaseUrl) {
        invoke<{ base_url: string }>("get_preview_server_info").then((info) => {
          setPreviewBaseUrl(info.base_url);
        }).catch(() => {});
      }
    }
  }, [activeTab, landingOutputDir, landingTemplateBase, previewBaseUrl]);

  // 输入 IDs 后防抖自动预览
  useEffect(() => {
    if (landingDebounceRef.current !== null) {
      window.clearTimeout(landingDebounceRef.current);
    }
    if (!landingIds.trim() || !isTauriRuntime() || !landingOutputDir) {
      setLandingPreviewData([]);
      setLandingGenerated({});
      setFtpUploadResults({});
      return;
    }
    landingDebounceRef.current = window.setTimeout(() => {
      runLandingGeneration(false);
    }, 800);
    return () => {
      if (landingDebounceRef.current !== null) {
        window.clearTimeout(landingDebounceRef.current);
      }
    };
    // runLandingGeneration 依赖 hook 内状态，闭包捕获即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingIds, landingOutputDir, landingTemplateBase]);

  return {
    landingIds,
    setLandingIds,
    landingPreviewData,
    landingGenerated,
    ftpUploadResults,
    templateIndices,
    setTemplateIndices,
    isFetchingPreview,
    isGenerating,
    isUploadingToFtp,
    landingOutputDir,
    previewBaseUrl,
    handleLandingPreview,
    handleFtpUpload,
    handleCopyAllLinks,
  };
}
