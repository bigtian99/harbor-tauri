import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifications } from "@mantine/notifications";
import type { SubChannelData, LandingPageResult, FtpUploadResult, TabType } from "../types";
import { isTauriRuntime } from "../types";

const LANDING_API_URL = "https://tksyadmin.tiankongshuyu.cn";

export type LandingMode = "sub_channel" | "vest";

interface UseLandingDeps {
  activeTab: TabType;
  setLog: (value: string) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
  opsAuthorization?: string;
}

/**
 * 落地页生成与 FTP 上传的全部状态与逻辑。
 * 支持子渠道 (sub_channel) 和马甲包 (vest) 两种模式。
 */
export function useLanding(deps: UseLandingDeps) {
  const { activeTab, setLog, setProgress, setProgressMessage, opsAuthorization } = deps;

  const [landingTemplateBase, setLandingTemplateBase] = useState("");
  const [landingIds, setLandingIds] = useState("");
  const [landingMode, setLandingMode] = useState<LandingMode>("sub_channel");
  const [vestAuthorization, setVestAuthorization] = useState("");
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

  // 同步 opsAuthorization 到 vestAuthorization
  useEffect(() => {
    if (opsAuthorization && !vestAuthorization) {
      setVestAuthorization(opsAuthorization);
    }
  }, [opsAuthorization]);

  // 拉取子渠道并生成落地页
  async function runSubChannelGeneration(showDoneToast: boolean) {
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
      await runGenerationAndCollect("generate_landing_pages", { templateBase: landingTemplateBase }, showDoneToast);
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

  // 拉取马甲包并生成落地页
  async function runVestGeneration(showDoneToast: boolean) {
    setIsFetchingPreview(true);
    setLandingPreviewData([]);
    setLandingGenerated({});
    setFtpUploadResults({});
    setLog("");
    setProgress(0);
    try {
      await runGenerationAndCollect("generate_vest_landing_pages", {
        templateBase: landingTemplateBase,
        authorization: vestAuthorization.trim(),
      }, showDoneToast);
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

  async function runGenerationAndCollect(
    command: string,
    extraArgs: Record<string, string>,
    showDoneToast: boolean,
  ) {
    setIsGenerating(true);
    const args: Record<string, unknown> = {
      apiUrl: LANDING_API_URL,
      ids: landingIds.trim(),
      outputDir: landingOutputDir.trim(),
      ...extraArgs,
    };
    const results = await invoke<LandingPageResult[]>(command, args);
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
  }

  async function runLandingGeneration(showDoneToast: boolean) {
    if (landingMode === "vest") {
      await runVestGeneration(showDoneToast);
    } else {
      await runSubChannelGeneration(showDoneToast);
    }
  }

  async function handleLandingPreview() {
    if (!isTauriRuntime() || !landingIds.trim()) return;
    if (landingMode === "vest" && !vestAuthorization.trim()) {
      notifications.show({
        title: "请先输入 Authorization",
        message: "马甲包模式需要 Authorization 请求头",
        color: "yellow",
        autoClose: 3000,
      });
      return;
    }
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
            remote_dir: landingMode === "vest"
              ? `vest/${r.id}`
              : `${r.id}/${r.type_code}`,
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
        }).catch(async (e) => {
          let logPath = await invoke<string>("get_templates_diagnostic_log_path").catch(() => "");
          notifications.show({
            title: "模板目录不可用",
            message: logPath
              ? `${String(e)}\n\n诊断日志：${logPath}`
              : String(e),
            color: "red",
            autoClose: 8000,
          });
        });
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
    if (landingMode === "vest" && !vestAuthorization.trim()) return;
    landingDebounceRef.current = window.setTimeout(() => {
      runLandingGeneration(false);
    }, 800);
    return () => {
      if (landingDebounceRef.current !== null) {
        window.clearTimeout(landingDebounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingIds, landingOutputDir, landingTemplateBase, landingMode, vestAuthorization]);

  return {
    landingIds,
    setLandingIds,
    landingMode,
    setLandingMode,
    vestAuthorization,
    setVestAuthorization,
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
