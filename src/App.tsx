import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Container, Upload, Settings, Rocket, Package, FileText, CheckCircle, Copy, AlertCircle, Loader2, Eye, EyeOff } from "lucide-react";
import "./App.css";

interface HarborConfig {
  harbor_url: string;
  username: string;
  password: string;
  project: string;
  base_image: string;
  expose_port: string;
}

type TabType = "upload" | "config";

function App() {
  const [activeTab, setActiveTab] = useState<TabType>("upload");
  const [config, setConfig] = useState<HarborConfig>({
    harbor_url: "dockerhub.kubekey.local",
    username: "",
    password: "",
    project: "tksy-admin",
    base_image: "eclipse-temurin:21-jre-alpine",
    expose_port: "8181",
  });
  const [jarPath, setJarPath] = useState<string>("");
  const [imageName, setImageName] = useState<string>("");
  const [imageTag, setImageTag] = useState<string>("latest");
  const [log, setLog] = useState<string>("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; message: string }>({ show: false, message: "" });
  const [progressMessage, setProgressMessage] = useState("");

  useEffect(() => {
    loadConfig();

    // 监听构建进度事件
    const appWindow = getCurrentWindow();
    const unlistenProgress = appWindow.listen<{ percent: number; message: string }>(
      "build-progress",
      (event) => {
        setProgress(event.payload.percent);
        setProgressMessage(event.payload.message);
      }
    );

    // 使用Tauri的拖拽事件获取文件路径
    const unlistenDrag = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setIsDragOver(true);
      } else if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        const jarFile = paths.find((p) => p.endsWith(".jar"));
        if (jarFile) {
          setJarPath(jarFile);
          const fileName = jarFile.split("/").pop() || "";
          const nameWithoutExt = fileName.replace(".jar", "");
          // 参考脚本逻辑: basename .jar | sed 's/-[0-9].*//'  去掉版本后缀
          const baseName = nameWithoutExt.replace(/-\d.*/, "").toLowerCase();
          // 拖拽新文件时自动填充镜像名称（如果之前没有手动输入过）
          setImageName(baseName);
        } else {
          setLog("⚠️ 请拖入 .jar 文件");
        }
      } else {
        setIsDragOver(false);
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenDrag.then((fn) => fn());
    };
  }, [imageName]);

  async function loadConfig() {
    try {
      const savedConfig = await invoke<HarborConfig>("load_config");
      setConfig(savedConfig);
    } catch (e) {
      console.error("加载配置失败:", e);
    }
  }

  async function handleSaveConfig() {
    try {
      await invoke("save_config", { config });
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      setLog(`❌ 保存配置失败: ${e}`);
      setActiveTab("upload");
    }
  }

  function handleConfigChange(field: keyof HarborConfig, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  async function handleSelectFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JAR Files", extensions: ["jar"] }],
      });
      if (selected) {
        setJarPath(selected as string);
        const fileName = (selected as string).split("/").pop() || "";
        const nameWithoutExt = fileName.replace(".jar", "");
        // 参考脚本逻辑: basename .jar | sed 's/-[0-9].*//'  去掉版本后缀
        const baseName = nameWithoutExt.replace(/-\d.*/, "").toLowerCase();
        if (!imageName) {
          setImageName(baseName);
        }
      }
    } catch (e) {
      console.error("选择文件失败:", e);
    }
  }

  async function handleBuildAndPush() {
    if (!jarPath) {
      setLog("⚠️ 请先选择JAR文件");
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

    try {
      const result = await invoke<string>("build_and_push", {
        jarPath,
        imageName,
        imageTag,
      });
      setLog(result);
      // 推送成功后重置状态，方便用户拖拽下一个文件
      setJarPath("");
      setImageTag("latest");
    } catch (e) {
      setLog(`❌ 推送失败:\n${e}`);
    } finally {
      setIsBuilding(false);
    }
  }

  async function handleCopyImage(imageUrl: string) {
    try {
      await navigator.clipboard.writeText(imageUrl);
      setCopied(true);
      setToast({ show: true, message: "镜像地址已复制到剪贴板" });
      setTimeout(() => {
        setCopied(false);
        setToast({ show: false, message: "" });
      }, 2000);
    } catch (e) {
      console.error("复制失败:", e);
    }
  }

  function renderLog(text: string) {
    const imageMatch = text.match(/完整镜像:\s*(.+)/);
    if (imageMatch) {
      const imageUrl = imageMatch[1].trim();
      const prefix = text.substring(0, text.indexOf("完整镜像:"));
      return (
        <>
          <pre>{prefix}</pre>
          <div className="image-url-row">
            <span className="image-url-label">完整镜像:</span>
            <span className="image-url-value" title={imageUrl}>{imageUrl}</span>
            <button
              className={`copy-btn ${copied ? "copied" : ""}`}
              onClick={() => handleCopyImage(imageUrl)}
              title="复制镜像地址"
            >
              {copied ? (
                <>
                  <CheckCircle size={14} /> 已复制
                </>
              ) : (
                <>
                  <Copy size={14} /> 复制
                </>
              )}
            </button>
          </div>
        </>
      );
    }
    // 检查是否是成功消息
    if (text.includes("✅")) {
      return (
        <div className="success-message">
          <CheckCircle size={20} className="success-icon" />
          <pre>{text}</pre>
        </div>
      );
    }
    return <pre>{text}</pre>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1><Container className="header-icon" />JarPorter</h1>
        <p className="subtitle">拖拽 JAR 包，一键构建并推送到 Harbor 镜像仓库</p>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === "upload" ? "active" : ""}`}
          onClick={() => setActiveTab("upload")}
        >
          <Upload size={16} /> 上传推送
        </button>
        <button
          className={`tab ${activeTab === "config" ? "active" : ""}`}
          onClick={() => setActiveTab("config")}
        >
          <Settings size={16} /> Harbor配置
        </button>
      </nav>

      <main className="content">
        {activeTab === "upload" ? (
          <div className="upload-panel">
            <div
              className={`drop-zone ${isDragOver ? "drag-over" : ""} ${jarPath ? "has-file" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleSelectFile}
            >
              {jarPath ? (
                <div className="file-info">
                  <FileText size={40} strokeWidth={1.5} className="file-icon" />
                  <span className="file-name">
                    {jarPath.split("/").pop()}
                  </span>
                  <span className="file-path">{jarPath}</span>
                </div>
              ) : (
                <div className="drop-hint">
                  <Package size={64} strokeWidth={1.5} className="drop-icon" />
                  <p>拖拽JAR文件到这里</p>
                  <p className="drop-sub">或点击选择文件</p>
                </div>
              )}
            </div>

            <div className="image-config">
              <div className="form-row">
                <label>镜像名称</label>
                <input
                  type="text"
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  placeholder="例如: my-app"
                />
              </div>
              <div className="form-row">
                <label>镜像标签</label>
                <input
                  type="text"
                  value={imageTag}
                  onChange={(e) => setImageTag(e.target.value)}
                  placeholder="留空则自动生成 v.YY.MM.DD.HH.MM"
                />
              </div>
            </div>

            <button
              className="build-btn"
              onClick={handleBuildAndPush}
              disabled={isBuilding || !jarPath}
            >
              {isBuilding ? (
                <>
                  <Loader2 size={18} className="spin" /> 构建推送中...
                </>
              ) : (
                <>
                  <Rocket size={18} /> 构建并推送到Harbor
                </>
              )}
            </button>

            {isBuilding && (
              <div className="progress-section">
                <div className="progress-info">
                  <span className="progress-message">{progressMessage}</span>
                  <span className="progress-percent">{progress}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-bar"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            {log && (
              <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                {renderLog(log)}
              </div>
            )}
          </div>
        ) : (
          <div className="config-panel">
            <div className="form-group">
              <label>Harbor地址</label>
              <input
                type="text"
                value={config.harbor_url}
                onChange={(e) => handleConfigChange("harbor_url", e.target.value)}
                placeholder="例如: harbor.example.com"
              />
            </div>
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                value={config.username}
                onChange={(e) => handleConfigChange("username", e.target.value)}
                placeholder="Harbor登录用户名"
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.password}
                  onChange={(e) => handleConfigChange("password", e.target.value)}
                  placeholder="Harbor登录密码"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>项目名称</label>
              <input
                type="text"
                value={config.project}
                onChange={(e) => handleConfigChange("project", e.target.value)}
                placeholder="例如: my-project"
              />
            </div>
            <div className="form-group">
              <label>基础镜像</label>
              <input
                type="text"
                value={config.base_image}
                onChange={(e) => handleConfigChange("base_image", e.target.value)}
                placeholder="例如: eclipse-temurin:17-jre"
              />
            </div>
            <div className="form-group">
              <label>暴露端口</label>
              <input
                type="text"
                value={config.expose_port}
                onChange={(e) => handleConfigChange("expose_port", e.target.value)}
                placeholder="例如: 8181"
              />
            </div>

            <button className="save-btn" onClick={handleSaveConfig}>
              {configSaved ? (
                <>
                  <CheckCircle size={18} /> 已保存
                </>
              ) : (
                <>
                  <Settings size={18} /> 保存配置
                </>
              )}
            </button>

            <div className="config-tip">
              <p><AlertCircle size={16} className="inline-icon" /> 配置说明：</p>
              <ul>
                <li>配置保存后无需重复填写</li>
                <li>Harbor地址不需要带 https:// 前缀</li>
                <li>项目名称为Harbor中的项目名</li>
                <li>基础镜像为构建Docker镜像时的FROM镜像</li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {toast.show && (
        <div className="toast">
          <CheckCircle size={16} />
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
