import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ArtifactType, HarborConfig, TabType } from "../types";
import {
  isTauriRuntime,
  inferImageName,
  resolveHarborRepository,
  inferImageNameFromRef,
} from "../types";
import { useEffect } from "react";

/** 与后端 list_local_images 对齐 */
export type LocalImageInfo = {
  reference: string;
  in_use: boolean;
};

interface UseUploadPushDeps {
  config: HarborConfig;
  setActiveTab: (tab: TabType) => void;
  setLog: (value: string | ((prev: string) => string)) => void;
  setIsBuilding: (value: boolean) => void;
  setCopied: (value: boolean) => void;
  setProgress: (value: number) => void;
  setProgressMessage: (value: string) => void;
  showToast: (message: string, duration?: number) => void;
  /** 当前 tab（拖拽落点用） */
  activeTab: TabType;
  /** 分支 tab 拖入仓库时的回调，避免 upload hook 依赖 branch 内部状态 */
  onDropRepoPath?: (path: string) => void;
}

/**
 * 上传推送 + 本地镜像推送的状态与逻辑。
 */
export function useUploadPush(deps: UseUploadPushDeps) {
  const {
    config,
    setActiveTab,
    setLog,
    setIsBuilding,
    setCopied,
    setProgress,
    setProgressMessage,
    showToast,
    activeTab,
    onDropRepoPath,
  } = deps;

  // 上传推送
  const [artifactType, setArtifactType] = useState<ArtifactType>("jar");
  const [artifactPath, setArtifactPath] = useState("");
  const [imageName, setImageName] = useState("");
  const [imageTag, setImageTag] = useState("latest");
  const [uploadExposePort, setUploadExposePort] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadFullImage, setUploadFullImage] = useState("");
  const [showImageConfig, setShowImageConfig] = useState(false);

  // 镜像推送
  const [pushLocalImage, setPushLocalImage] = useState("");
  const [pushImageName, setPushImageName] = useState("");
  const [pushImageTag, setPushImageTag] = useState("latest");
  const [pushFullImage, setPushFullImage] = useState("");
  const [pushLocalImageOptions, setPushLocalImageOptions] = useState<LocalImageInfo[]>([]);
  const [pushIsLoadingImages, setPushIsLoadingImages] = useState(false);

  const handleDragEvents = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  function handleArtifactPathSelected(path: string, type = artifactType) {
    setArtifactPath(path);
    const inferred = inferImageName(path, type);
    setImageName(inferred);
    // 从 SQLite 查上次对这个 JAR 用的端口
    if (type === "jar" && isTauriRuntime()) {
      invoke<string | null>("get_jar_port", { jarName: inferred })
        .then((port) => {
          if (port) setUploadExposePort(port);
        })
        .catch(() => {});
    }
  }

  function handleArtifactTypeChange(type: ArtifactType) {
    setArtifactType(type);
    setArtifactPath("");
    setLog("");
  }

  async function handleSelectFile() {
    if (!isTauriRuntime()) {
      setLog("⚠️ 当前是浏览器预览环境，无法打开系统文件选择器；请在 Tauri 桌面窗口中操作");
      return;
    }
    try {
      const selected =
        artifactType === "jar"
          ? await open({
              multiple: false,
              filters: [{ name: "JAR Files", extensions: ["jar"] }],
            })
          : await open({
              multiple: false,
              directory: true,
              recursive: true,
              title: "选择前端 dist 目录",
            });
      if (selected) {
        handleArtifactPathSelected(selected as string);
      }
    } catch (e) {
      console.error("选择产物失败:", e);
      showToast(`选择产物失败: ${e}`);
    }
  }

  async function handleBuildAndPush() {
    if (!isTauriRuntime()) {
      setLog("❌ 当前是浏览器预览环境，构建推送请在 Tauri 桌面窗口中操作");
      return;
    }
    if (!artifactPath) {
      setLog(artifactType === "jar" ? "⚠️ 请先选择JAR文件" : "⚠️ 请先选择前端 dist 目录");
      return;
    }
    if (!imageName) {
      setLog("⚠️ 请输入镜像名称");
      return;
    }
    if (!config.harbor_url || !config.username || !config.password || !config.project) {
      setLog("⚠️ 请先配置Harbor信息");
      setActiveTab("config");
      return;
    }
    setIsBuilding(true);
    setCopied(false);
    setProgress(0);
    setProgressMessage("🚀 开始构建和推送镜像...");
    setLog("");
    setUploadFullImage("");
    const uploadPort = artifactType === "jar" ? (uploadExposePort.trim() || config.expose_port.trim()) : "";
    const uploadImageName = uploadPort ? `${imageName}-${uploadPort}` : imageName;
    const resolvedRepo = resolveHarborRepository(uploadImageName, config.project);
    if (!resolvedRepo.ok) {
      setLog(`⚠️ ${resolvedRepo.error}`);
      setIsBuilding(false);
      return;
    }
    try {
      const result = await invoke<string>("build_and_push", {
        jarPath: artifactPath,
        imageName: uploadImageName,
        imageTag,
        artifactType,
        exposePort: uploadExposePort || null,
        nginxLocations: [],
      });
      const imgMatch = result.match(/完整镜像:\s*(.+)/);
      if (imgMatch) {
        setUploadFullImage(imgMatch[1].trim());
      }
      const logResult = result.replace(/完整镜像:.*(\n|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
      setLog((prev) => (prev ? `${prev}\n\n${logResult}` : logResult));
      setArtifactPath("");
      setImageTag("latest");
      const jarName = artifactType === "jar" ? inferImageName(artifactPath, "jar") : null;
      if (jarName && uploadExposePort && isTauriRuntime()) {
        invoke("save_jar_port", { jarName, port: uploadExposePort }).catch(() => {});
      }
    } catch (e) {
      setLog(`❌ 推送失败:\n${e}`);
    } finally {
      setIsBuilding(false);
    }
  }

  async function loadLocalImages() {
    if (!isTauriRuntime()) return;
    setPushIsLoadingImages(true);
    try {
      const images = await invoke<LocalImageInfo[]>("list_local_images");
      setPushLocalImageOptions(images);
    } catch (e) {
      console.error("加载本地镜像列表失败:", e);
      setPushLocalImageOptions([]);
    } finally {
      setPushIsLoadingImages(false);
    }
  }

  async function removeLocalImage(image: string) {
    if (!isTauriRuntime()) {
      showToast("请在桌面端删除本地镜像");
      return;
    }
    const ref = image.trim();
    if (!ref) return;

    const info = pushLocalImageOptions.find((x) => x.reference === ref);
    if (info?.in_use) {
      showToast("该镜像正被容器使用，无法删除");
      return;
    }

    // 二次确认：误点不可恢复
    if (
      !window.confirm(
        `确认删除本地镜像？\n\n${ref}\n\n将执行 docker rmi，删除后不可恢复。`,
      )
    ) {
      return;
    }

    try {
      await invoke("remove_local_image", { image: ref });
      setPushLocalImageOptions((prev) => prev.filter((x) => x.reference !== ref));
      if (pushLocalImage === ref) {
        setPushLocalImage("");
      }
      showToast(`已删除: ${ref}`);
    } catch (e) {
      const msg = String(e);
      showToast(msg.includes("容器") ? "镜像被容器占用，无法删除" : `删除失败: ${e}`);
      setLog(`❌ 删除本地镜像失败:\n${e}`);
      // 占用状态可能过期，刷新列表
      void loadLocalImages();
    }
  }

  async function handlePushImage() {
    if (!isTauriRuntime()) {
      setLog("❌ 当前是浏览器预览环境，推送请在 Tauri 桌面窗口中操作");
      return;
    }
    if (!pushLocalImage.trim()) {
      setLog("⚠️ 请输入本地镜像引用");
      return;
    }
    if (!pushImageName.trim()) {
      setLog("⚠️ 请输入目标镜像名称");
      return;
    }
    if (!config.harbor_url || !config.username || !config.password || !config.project) {
      setLog("⚠️ 请先配置Harbor信息");
      setActiveTab("config");
      return;
    }
    setIsBuilding(true);
    setCopied(false);
    setProgress(0);
    setProgressMessage("🏷️ 镜像打标签...");
    setLog("");
    setPushFullImage("");
    try {
      const result = await invoke<string>("push_local_image", {
        localImage: pushLocalImage.trim(),
        imageName: pushImageName.trim(),
        imageTag: pushImageTag.trim() || "latest",
      });
      const imgMatch = result.match(/完整镜像:\s*(.+)/);
      if (imgMatch) {
        setPushFullImage(imgMatch[1].trim());
      }
      const logResult = result.replace(/完整镜像:.*(\n|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
      setLog((prev) => (prev ? `${prev}\n\n${logResult}` : logResult));
    } catch (e) {
      setLog(`❌ 推送失败:\n${e}`);
    } finally {
      setIsBuilding(false);
    }
  }

  // 选择本地镜像后自动推断目标镜像名称和标签
  useEffect(() => {
    if (pushLocalImage.trim()) {
      const { name, tag } = inferImageNameFromRef(pushLocalImage);
      if (name) setPushImageName(name);
      if (tag) setPushImageTag(tag);
    }
  }, [pushLocalImage]);

  // 进入推送 tab 时刷新本地镜像列表
  useEffect(() => {
    if (activeTab === "push" && isTauriRuntime()) {
      loadLocalImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 拖拽落点（窗口级）
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    const unlistenDrag = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (activeTab === "branch") {
          if (paths[0]) {
            onDropRepoPath?.(paths[0]);
          } else {
            setLog("⚠️ 请拖入 Git 仓库目录");
          }
        } else if (artifactType === "jar") {
          const jarFile = paths.find((p) => p.toLowerCase().endsWith(".jar"));
          if (jarFile) {
            handleArtifactPathSelected(jarFile, "jar");
          } else {
            setLog("⚠️ 请拖入 .jar 文件");
          }
        } else if (paths[0]) {
          handleArtifactPathSelected(paths[0], "frontend_dist");
        } else {
          setLog("⚠️ 请拖入前端 dist 目录");
        }
      } else {
        setIsDragOver(false);
      }
    });

    return () => {
      unlistenDrag.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, artifactType, onDropRepoPath]);

  return {
    // upload
    artifactType,
    setArtifactType,
    artifactPath,
    setArtifactPath,
    imageName,
    setImageName,
    imageTag,
    setImageTag,
    uploadExposePort,
    setUploadExposePort,
    isDragOver,
    uploadFullImage,
    setUploadFullImage,
    showImageConfig,
    setShowImageConfig,
    handleDragEvents,
    handleSelectFile,
    handleArtifactPathSelected,
    handleArtifactTypeChange,
    handleBuildAndPush,
    // push
    pushLocalImage,
    setPushLocalImage,
    pushImageName,
    setPushImageName,
    pushImageTag,
    setPushImageTag,
    pushFullImage,
    pushLocalImageOptions,
    pushIsLoadingImages,
    loadLocalImages,
    removeLocalImage,
    handlePushImage,
  };
}
