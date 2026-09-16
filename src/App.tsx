import { useState, useEffect, useRef } from "react";
import { CalendarDays, CheckCircle, ChevronDown, ScrollText, Search, X, Download, FolderOpen } from "lucide-react";

import { Sidebar } from "./components/Sidebar";
import { LandingPanel } from "./components/LandingPanel";
import { SettlementPanel } from "./components/SettlementPanel";
import { PackSpeedPanel } from "./components/PackSpeedPanel";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { UpdateModal } from "./components/UpdateModal";
import { useLanding } from "./hooks/useLanding";
import { useAppConfig, type DiagDateInfo } from "./hooks/useAppConfig";
import { useBuildProgress, useToast } from "./hooks/useBuildProgress";
import "./App.css";

import type { TabType } from "./types";
import { isTauriRuntime } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { shouldKeepPreviewServer } from "./utils/previewLifecycle";
import { readStoredActiveTab, writeStoredActiveTab } from "./utils/activeTabStorage";

/** 系统日志日期 card 选择器（替代原生 select） */
function LogDayPicker({
  logDay,
  logDates,
  onSelect,
}: {
  logDay: string | null;
  logDates: DiagDateInfo[];
  onSelect: (day: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = logDay
    ? (() => {
        const hit = logDates.find((d) => d.date === logDay);
        if (!hit) return logDay;
        return `${hit.date} · ${hit.lines} 行`;
      })()
    : "最近 3 天";

  const pick = (day: string | null) => {
    onSelect(day);
    setOpen(false);
  };

  return (
    <div className="log-day-picker" ref={rootRef}>
      <button
        type="button"
        className={`log-day-trigger${open ? " open" : ""}`}
        title="切换日志日期"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <CalendarDays size={14} className="log-day-trigger-icon" aria-hidden />
        <span className="log-day-trigger-label">{label}</span>
        <ChevronDown size={14} className="log-day-trigger-chevron" aria-hidden />
      </button>
      {open && (
        <div
          className="log-day-panel"
          role="listbox"
          aria-label="日志日期"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="option"
            aria-selected={!logDay}
            className={`log-day-card${!logDay ? " selected" : ""}`}
            onClick={() => pick(null)}
          >
            <span className="log-day-card-date">最近 3 天</span>
            <span className="log-day-card-meta">合并视图 · 新日志在前</span>
            {!logDay && <CheckCircle size={14} className="log-day-card-check" aria-hidden />}
          </button>
          {logDates.map((d) => {
            const selected = logDay === d.date;
            return (
              <button
                key={d.date}
                type="button"
                role="option"
                aria-selected={selected}
                className={`log-day-card${selected ? " selected" : ""}`}
                onClick={() => pick(d.date)}
              >
                <span className="log-day-card-date">{d.date}</span>
                <span className="log-day-card-meta">
                  {d.lines} 行 · {(d.size / 1024).toFixed(1)} KB
                </span>
                {selected && <CheckCircle size={14} className="log-day-card-check" aria-hidden />}
              </button>
            );
          })}
          {logDates.length === 0 && (
            <div className="log-day-empty">暂无按日日志文件</div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>(() => readStoredActiveTab("landing"));
  const previewStopTimerRef = useRef<number | null>(null);

  // 记住当前菜单：右键 reload / 刷新后回到离开前的页签
  useEffect(() => {
    writeStoredActiveTab(activeTab);
  }, [activeTab]);

  const { toast, showToast } = useToast();
  const build = useBuildProgress({ showToast });

  const app = useAppConfig({ setActiveTab });

  const landing = useLanding({
    activeTab,
    setLog: build.setLog,
    setProgress: build.setProgress,
    setProgressMessage: build.setProgressMessage,
    opsAuthorization: app.config.ops_authorization,
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;

    if (previewStopTimerRef.current !== null) {
      window.clearTimeout(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }

    if (shouldKeepPreviewServer(activeTab)) {
      invoke("ensure_preview_server_started").catch(() => {
        /* 预览相关页面会自行提示具体错误 */
      });
      return;
    }

    previewStopTimerRef.current = window.setTimeout(() => {
      invoke<boolean>("stop_preview_server").catch(() => {
        /* 静默回收失败不影响主流程 */
      });
      previewStopTimerRef.current = null;
    }, 15000);

    return () => {
      if (previewStopTimerRef.current !== null) {
        window.clearTimeout(previewStopTimerRef.current);
        previewStopTimerRef.current = null;
      }
    };
  }, [activeTab]);

  return (
    <div className="app">
      <Sidebar
        activeTab={activeTab}
        sidebarCollapsed={app.sidebarCollapsed}
        onTabChange={app.handleTabChange}
        onToggleCollapse={() => app.setSidebarCollapsed(!app.sidebarCollapsed)}
        onOpenLog={app.openDiagnosticLog}
      />

      <main className="content">
        {activeTab === "landing" && (
          <LandingPanel
            landingIds={landing.landingIds}
            landingMode={landing.landingMode}
            vestAuthorization={landing.vestAuthorization}
            landingPreviewData={landing.landingPreviewData}
            landingGenerated={landing.landingGenerated}
            ftpUploadResults={landing.ftpUploadResults}
            templateIndices={landing.templateIndices}
            isFetchingPreview={landing.isFetchingPreview}
            isGenerating={landing.isGenerating}
            isUploadingToFtp={landing.isUploadingToFtp}
            progress={build.progress}
            progressMessage={build.progressMessage}
            landingOutputDir={landing.landingOutputDir}
            previewBaseUrl={landing.previewBaseUrl}
            setLandingIds={landing.setLandingIds}
            setLandingMode={landing.setLandingMode}
            setVestAuthorization={landing.setVestAuthorization}
            setTemplateIndices={landing.setTemplateIndices}
            onPreview={landing.handleLandingPreview}
            onFtpUpload={landing.handleFtpUpload}
            onCopyAllLinks={landing.handleCopyAllLinks}
          />
        )}

        {activeTab === "settlement" && (
          <SettlementPanel />
        )}

        {activeTab === "privacy" && (
          <PrivacyPanel />
        )}

        {activeTab === "packSpeed" && (
          <PackSpeedPanel
            authorization={app.config.ops_authorization ?? ""}
            onAuthorizationChange={(value) => app.setConfig((prev) => ({ ...prev, ops_authorization: value }))}
            onSaveAuthorization={app.handleOpsAuthorizationSave}
          />
        )}

        {activeTab === "config" && (
          <ConfigPanel
            config={app.config}
            configSaved={app.configSaved}
            onConfigChange={app.handleConfigChange}
            onSaveConfig={app.handleSaveConfig}
            appVersion={app.appVersion || app.updateInfo?.current_version}
            onCheckUpdate={app.handleManualCheckUpdate}
          />
        )}
      </main>

      {app.showLogViewer && (
        <div className="log-viewer-overlay" onClick={() => { app.setShowLogViewer(false); app.setLogSearch(""); }}>
          <div className="log-viewer" onClick={(e) => e.stopPropagation()}>
            <div className="log-viewer-header">
              <ScrollText size={18} className="log-viewer-title-icon" />
              <h3>系统诊断日志</h3>
              <LogDayPicker
                logDay={app.logDay}
                logDates={app.logDates}
                onSelect={(day) => { void app.selectDiagnosticDay(day); }}
              />
              <div className="log-viewer-search-wrap">
                <Search size={14} className="log-viewer-search-icon" />
                <input
                  className="log-viewer-search"
                  type="text"
                  placeholder="搜索日志..."
                  value={app.logSearch}
                  onChange={(e) => app.setLogSearch(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  style={{ textTransform: "none" }}
                />
                {app.logSearch && (
                  <button className="log-viewer-search-clear" onClick={() => app.setLogSearch("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="log-viewer-download"
                title="在文件管理器中打开日志文件"
                onClick={() => void app.revealDiagnosticLogFile(showToast)}
              >
                <FolderOpen size={16} />
                目录
              </button>
              <button
                type="button"
                className="log-viewer-download"
                title="下载完整诊断日志"
                onClick={() => void app.downloadDiagnosticLog(showToast)}
              >
                <Download size={16} />
                下载
              </button>
              <button className="log-viewer-close" onClick={() => { app.setShowLogViewer(false); app.setLogSearch(""); }}>
                <X size={18} />
              </button>
            </div>
            <pre
              className="log-viewer-content"
              dangerouslySetInnerHTML={{ __html: (() => {
                const raw = app.logContent || "（无日志内容）";
                if (!app.logSearch.trim()) return raw;
                const lines = raw.split("\n");
                const q = app.logSearch.toLowerCase();
                return lines
                  .map((line) => {
                    const lower = line.toLowerCase();
                    if (!lower.includes(q)) return null;
                    const parts = line.split(new RegExp(`(${app.logSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
                    return parts.map((p) =>
                      p.toLowerCase() === q
                        ? `<mark class="log-highlight">${p}</mark>`
                        : p
                    ).join("");
                  })
                  .filter(Boolean)
                  .join("\n");
              })() }}
            />
          </div>
        </div>
      )}

      {toast.show && (
        <div className="toast">
          <CheckCircle size={16} />
          {toast.message}
        </div>
      )}

      <UpdateModal
        opened={app.updateModalOpen}
        onClose={() => app.setUpdateModalOpen(false)}
        updateInfo={app.updateInfo}
      />
    </div>
  );
}

export default App;
