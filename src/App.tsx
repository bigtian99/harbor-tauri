import { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle, ScrollText, Search, X, Download } from "lucide-react";


import { Sidebar } from "./components/Sidebar";
import { UploadPanel } from "./components/UploadPanel";
import { BranchPanel } from "./components/BranchPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LandingPanel } from "./components/LandingPanel";
import { MergePanel } from "./components/MergePanel";
import { PushImagePanel } from "./components/PushImagePanel";
import { ConfigPanel } from "./components/ConfigPanel";
import { SettlementPanel } from "./components/SettlementPanel";
import { PackSpeedPanel } from "./components/PackSpeedPanel";
import { UpdateModal } from "./components/UpdateModal";
import { useLanding } from "./hooks/useLanding";
import { useAppConfig } from "./hooks/useAppConfig";
import { useBuildProgress, useToast } from "./hooks/useBuildProgress";
import { useUploadPush } from "./hooks/useUploadPush";
import { useBranchPack } from "./hooks/useBranchPack";
import "./App.css";

import type { HarborConfig, TabType } from "./types";
import { isTauriRuntime } from "./types";

function App() {
  const [activeTab, setActiveTab] = useState<TabType>("upload");

  const { toast, showToast } = useToast();
  const build = useBuildProgress({ showToast });

  // 配置加载后恢复分支记忆：通过 ref 打破与 useBranchPack 的声明顺序依赖
  const onConfigLoadedRef = useRef<(config: HarborConfig) => void | Promise<void>>(() => {});
  const app = useAppConfig({
    setLog: build.setLog,
    setActiveTab,
    onConfigLoaded: (config) => onConfigLoadedRef.current(config),
  });

  const onDropRepoPathRef = useRef<(path: string) => void>(() => {});
  const upload = useUploadPush({
    config: app.config,
    setActiveTab,
    setLog: build.setLog,
    setIsBuilding: build.setIsBuilding,
    setCopied: build.setCopied,
    setProgress: build.setProgress,
    setProgressMessage: build.setProgressMessage,
    showToast,
    activeTab,
    onDropRepoPath: (path) => onDropRepoPathRef.current(path),
  });

  const branch = useBranchPack({
    config: app.config,
    setConfig: app.setConfig,
    setActiveTab,
    setLog: build.setLog,
    setIsBuilding: build.setIsBuilding,
    setCopied: build.setCopied,
    setProgress: build.setProgress,
    setProgressMessage: build.setProgressMessage,
    showToast,
    loadBuildHistory: app.loadBuildHistory,
    imageName: upload.imageName,
    setImageName: upload.setImageName,
    imageTag: upload.imageTag,
    artifactPath: upload.artifactPath,
    setArtifactPath: upload.setArtifactPath,
  });

  // 保持 ref 指向最新实现
  onConfigLoadedRef.current = (config) => branch.applyRememberedConfig(config);
  onDropRepoPathRef.current = (path) => branch.handleDropRepoPath(path);

  const landing = useLanding({
    activeTab,
    setLog: build.setLog,
    setProgress: build.setProgress,
    setProgressMessage: build.setProgressMessage,
    opsAuthorization: app.config.ops_authorization,
  });

  // 进入历史 tab 时刷新记录
  useEffect(() => {
    if (activeTab === "history" && isTauriRuntime()) {
      app.loadBuildHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openArtifactPath = useCallback(
    (path: string) => app.openArtifactPath(path, showToast),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.openArtifactPath, showToast],
  );

  return (
    <div className="app">
      <Sidebar
        activeTab={activeTab}
        sidebarCollapsed={app.sidebarCollapsed}
        opsMode={app.opsMode}
        onTabChange={app.handleTabChange}
        onToggleCollapse={() => app.setSidebarCollapsed(!app.sidebarCollapsed)}
        onOpenLog={app.openDiagnosticLog}
      />

      <main className="content">
        {activeTab === "upload" && (
          <UploadPanel
            artifactType={upload.artifactType}
            artifactPath={upload.artifactPath}
            imageName={upload.imageName}
            imageTag={upload.imageTag}
            exposePort={upload.uploadExposePort}
            isDragOver={upload.isDragOver}
            isBuilding={build.isBuilding}
            showImageConfig={upload.showImageConfig}
            showBuildLog={build.showBuildLog}
            progress={build.progress}
            progressMessage={build.progressMessage}
            log={build.log}
            fullImage={upload.uploadFullImage}
            copied={build.copied}
            onCopyImage={build.handleCopyImage}
            onArtifactTypeChange={upload.handleArtifactTypeChange}
            onSelectFile={upload.handleSelectFile}
            onBuildAndPush={upload.handleBuildAndPush}
            onCancelBuild={build.handleCancelBuild}
            onDragOver={upload.handleDragEvents}
            onDragLeave={upload.handleDragEvents}
            onDrop={upload.handleDragEvents}
            setImageName={upload.setImageName}
            setImageTag={upload.setImageTag}
            setExposePort={upload.setUploadExposePort}
            setShowImageConfig={upload.setShowImageConfig}
            setShowBuildLog={build.setShowBuildLog}
            renderLog={build.renderLog}
          />
        )}

        {activeTab === "push" && (
          <PushImagePanel
            localImage={upload.pushLocalImage}
            localImageOptions={upload.pushLocalImageOptions}
            isLoadingImages={upload.pushIsLoadingImages}
            imageName={upload.pushImageName}
            imageTag={upload.pushImageTag}
            isBuilding={build.isBuilding}
            showImageConfig={upload.showImageConfig}
            showBuildLog={build.showBuildLog}
            progress={build.progress}
            progressMessage={build.progressMessage}
            log={build.log}
            fullImage={upload.pushFullImage}
            copied={build.copied}
            onCopyImage={build.handleCopyImage}
            onPushImage={upload.handlePushImage}
            onCancelBuild={build.handleCancelBuild}
            onRefreshImages={upload.loadLocalImages}
            setLocalImage={upload.setPushLocalImage}
            setImageName={upload.setPushImageName}
            setImageTag={upload.setPushImageTag}
            setShowImageConfig={upload.setShowImageConfig}
            setShowBuildLog={build.setShowBuildLog}
            renderLog={build.renderLog}
          />
        )}

        {activeTab === "branch" && (
          <BranchPanel
            branchProjectType={branch.branchProjectType}
            repoPath={branch.repoPath}
            branchName={branch.branchName}
            branchOptions={branch.branchOptions}
            isLoadingBranches={branch.loading.branches}
            frontendDir={branch.frontendDir}
            npmScripts={branch.npmScripts}
            selectedBuildScript={branch.selectedBuildScript}
            isLoadingScripts={branch.loading.scripts}
            packageWithBackend={branch.packageWithBackend}
            springProfile={branch.springProfile}
            springProfiles={branch.springProfiles}
            isLoadingProfiles={branch.loading.profiles}
            lastCommit={branch.lastCommit}
            isLoadingCommit={branch.loading.commit}
            commitList={branch.commitList}
            commitListTotal={branch.commitListTotal}
            showCommitListModal={branch.showCommitListModal}
            artifactPath={upload.artifactPath}
            backendArtifactPath={branch.backendArtifactPath}
            worktreePath={branch.worktreePath}
            customDockerfile={branch.customDockerfile}
            branchHasDockerfile={branch.branchHasDockerfile}
            isBuilding={build.isBuilding}
            autoPushImage={branch.autoPushImage}
            branchFullImage={branch.branchFullImage}
            branchImageResults={branch.branchImageResults}
            imageName={upload.imageName}
            imageTag={upload.imageTag}
            exposePort={branch.branchExposePort}
            nginxLocations={branch.nginxLocations}
            showAdvancedSettings={branch.showAdvancedSettings}
            config={app.config}
            progress={build.progress}
            progressMessage={build.progressMessage}
            log={build.log}
            showBuildLog={build.showBuildLog}
            copied={build.copied}
            onBranchProjectTypeChange={branch.handleBranchProjectTypeChange}
            onRepoPathChange={branch.handleRepoPathChange}
            onSelectRepo={branch.handleSelectRepo}
            onRefreshBranches={() => branch.loadGitBranches(branch.repoPath, branch.branchName)}
            onBranchChange={branch.handleBranchChange}
            onFrontendDirChange={(dir) => {
              branch.setFrontendDir(dir);
              if (branch.repoPath) branch.loadNpmScripts(branch.repoPath, dir);
            }}
            onSelectedBuildScriptChange={branch.setSelectedBuildScript}
            onPackageWithBackendChange={branch.setPackageWithBackend}
            onSpringProfileChange={branch.setSpringProfile}
            onAutoPushImageChange={branch.setAutoPushImage}
            onRememberSettingsChange={branch.handleRememberSettingsChange}
            setShowCommitListModal={branch.setShowCommitListModal}
            loadCommitList={branch.loadCommitList}
            loadCommitAuthors={branch.loadCommitAuthors}
            commitAuthors={branch.commitAuthors}
            isLoadingCommitList={branch.loading.commitList}
            commitListPage={branch.commitListPage}
            commitListPageSize={branch.commitListPageSize}
            commitAuthorFilter={branch.commitAuthorFilter}
            commitMessageFilter={branch.commitMessageFilter}
            setCommitAuthorFilter={branch.setCommitAuthorFilter}
            setCommitMessageFilter={branch.setCommitMessageFilter}
            onPackageFromBranch={branch.handlePackageFromBranch}
            onCancelBuild={build.handleCancelBuild}
            onOpenDirectory={openArtifactPath}
            onCopyImage={build.handleCopyImage}
            setImageName={upload.setImageName}
            setImageTag={upload.setImageTag}
            setExposePort={branch.setBranchExposePort}
            onNginxLocationsChange={branch.setNginxLocations}
            setShowAdvancedSettings={branch.setShowAdvancedSettings}
            setShowBuildLog={build.setShowBuildLog}
            renderLog={build.renderLog}
          />
        )}

        {activeTab === "history" && (
          <HistoryPanel
            buildHistory={app.buildHistory}
            isLoadingHistory={app.isLoadingHistory}
            expandedRecordId={null}
            collapsedProjects={new Set()}
            historySearch=""
            onLoadHistory={app.loadBuildHistory}
            onClearHistory={() => app.clearBuildHistory(showToast)}
            onDeleteRecord={(record) => app.deleteBuildRecord(record, showToast)}
            onOpenArtifact={openArtifactPath}
            onCopyImage={build.handleCopyImage}
          />
        )}

        {activeTab === "merge" && (
          <MergePanel
            config={app.config}
            onOpenDirectory={openArtifactPath}
          />
        )}

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
            showPassword={app.showPassword}
            onConfigChange={app.handleConfigChange}
            onSaveConfig={app.handleSaveConfig}
            onTogglePassword={() => app.setShowPassword(!app.showPassword)}
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
