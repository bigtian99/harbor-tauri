import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { notifications } from "@mantine/notifications";
import type { SubChannelData, LandingPageResult, FtpUploadResult, TabType } from "../types";
import { isTauriRuntime } from "../types";

/** 运营后台登录窗捕获到的 token 事件载荷（与打包加速共用同一事件）。 */
interface OpsAuthTokenCapturedPayload {
  token?: string;
}

const LANDING_API_URL = "https://tksyadmin.tiankongshuyu.cn";

export type LandingMode = "sub_channel" | "vest";

interface UseLandingDeps {
  activeTab: TabType;
  setLog: (value: string) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
  opsAuthorization?: string;
  /** 自动获取 Authorization 时同步给应用级配置（打包加速共用同一 token）。 */
  onOpsAuthorizationSave?: (value: string) => Promise<void> | void;
}

/**
 * 落地页生成与 FTP 上传的全部状态与逻辑。
 * 支持子渠道 (sub_channel) 和马甲包 (vest) 两种模式。
 */
export function useLanding(deps: UseLandingDeps) {
  const { activeTab, setLog, setProgress, setProgressMessage, opsAuthorization, onOpsAuthorizationSave } = deps;

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
  const [isOpeningAuthorization, setIsOpeningAuthorization] = useState(false);
  const landingDebounceRef = useRef<number | null>(null);
  const landingGenSeqRef = useRef(0);
  const activeTabRef = useRef(activeTab);
  const onOpsAuthorizationSaveRef = useRef(onOpsAuthorizationSave);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    onOpsAuthorizationSaveRef.current = onOpsAuthorizationSave;
  }, [onOpsAuthorizationSave]);

  // 同步 opsAuthorization 到 vestAuthorization
  useEffect(() => {
    if (opsAuthorization && !vestAuthorization) {
      setVestAuthorization(opsAuthorization);
    }
  }, [opsAuthorization]);

  // 自动获取 Authorization：打开内嵌运营后台登录页，捕获登录 token 后回填。
  // 只处理落地页页签内的捕获，避免与「打包加速」页重复提示与重复关窗。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .listen<OpsAuthTokenCapturedPayload>("ops-auth-token-captured", async (event) => {
        if (activeTabRef.current !== "landing") {
          return;
        }
        const token = event.payload?.token?.trim();
        if (!token) {
          return;
        }

        setVestAuthorization(token);
        try {
          await onOpsAuthorizationSaveRef.current?.(token);
        } catch (e) {
          console.error("[Landing] 同步 Authorization 失败:", e);
        }
        await invoke("close_ops_login_window").catch(() => {
          /* 登录窗可能已被用户关闭 */
        });
        notifications.show({
          title: "Authorization 已获取",
          message: "登录 token 已填入落地页 Authorization",
          color: "cyan",
          autoClose: 3000,
        });
      })
      .then((handler) => {
        if (disposed) {
          handler();
        } else {
          unlisten = handler;
        }
      })
      .catch((e) => {
        notifications.show({
          title: "监听登录 token 失败",
          message: String(e),
          color: "red",
          autoClose: 6000,
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function handleOpenAuthorizationLogin() {
    if (!isTauriRuntime()) {
      notifications.show({
        title: "无法打开登录窗口",
        message: "请在 Tauri 桌面窗口中使用自动获取",
        color: "yellow",
        autoClose: 4000,
      });
      return;
    }

    setIsOpeningAuthorization(true);
    try {
      await invoke("open_ops_login_window");
    } catch (e) {
      notifications.show({
        title: "打开登录窗口失败",
        message: String(e),
        color: "red",
        autoClose: 6000,
      });
    } finally {
      setIsOpeningAuthorization(false);
    }
  }

  // 拉取子渠道并生成落地页
  async function runSubChannelGeneration(showDoneToast: boolean) {
    const seq = ++landingGenSeqRef.current;
    setIsFetchingPreview(true);
    setLandingPreviewData([]);
    setLandingGenerated({});
    setFtpUploadResults({});
    setTemplateIndices({});
    setLog("");
    setProgress(0);
    try {
      const data = await invoke<SubChannelData[]>("fetch_sub_channels", {
        apiUrl: LANDING_API_URL,
        ids: landingIds.trim(),
      });
      if (seq !== landingGenSeqRef.current) return;
      setLandingPreviewData(data);
      await runGenerationAndCollect("generate_landing_pages", { templateBase: landingTemplateBase }, showDoneToast, seq);
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
    const seq = ++landingGenSeqRef.current;
    setIsFetchingPreview(true);
    setLandingPreviewData([]);
    setLandingGenerated({});
    setFtpUploadResults({});
    setTemplateIndices({});
    setLog("");
    setProgress(0);
    try {
      await runGenerationAndCollect("generate_vest_landing_pages", {
        templateBase: landingTemplateBase,
        authorization: vestAuthorization.trim(),
      }, showDoneToast, seq);
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
    seq: number,
  ) {
    setIsGenerating(true);
    const args: Record<string, unknown> = {
      apiUrl: LANDING_API_URL,
      ids: landingIds.trim(),
      outputDir: landingOutputDir.trim(),
      ...extraArgs,
    };
    const results = await invoke<LandingPageResult[]>(command, args);
    if (seq !== landingGenSeqRef.current) return;
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
          const dirs = r.template_dirs?.length ?? 1;
          const templateIdx = Math.min(templateIndices[key] || 0, Math.max(dirs - 1, 0));
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
      color: "blue",
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
        }).catch((e) => {
          notifications.show({
            title: "临时目录不可用",
            message: String(e),
            color: "red",
            autoClose: 5000,
          });
        });
      }
      invoke<{ base_url: string }>("ensure_preview_server_started").then((info) => {
        setPreviewBaseUrl((current) => current === info.base_url ? current : info.base_url);
      }).catch((e) => {
        notifications.show({
          title: "预览服务未启动",
          message: `${String(e)}（将回退资源协议，图片/字体可能空白）`,
          color: "yellow",
          autoClose: 6000,
        });
      });
    }
  }, [activeTab, landingOutputDir, landingTemplateBase]);

  // 输入 IDs 后防抖自动预览
  useEffect(() => {
    if (landingDebounceRef.current !== null) {
      window.clearTimeout(landingDebounceRef.current);
    }
    if (!landingIds.trim() || !isTauriRuntime() || !landingOutputDir) {
      setLandingPreviewData([]);
      setLandingGenerated({});
      setFtpUploadResults({});
      setTemplateIndices({});
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
    isOpeningAuthorization,
    handleOpenAuthorizationLogin,
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
