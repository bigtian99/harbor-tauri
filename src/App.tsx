import { useState, useEffect, useRef, useCallback } from "react";
import { CheckCircle } from "lucide-react";

import { Sidebar, getAppShellNavbarConfig } from "./components/Sidebar";
import { AppShell } from "@mantine/core";
import { UploadPanel } from "./components/UploadPanel";
import { BranchPanel } from "./components/BranchPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { LandingPanel } from "./components/LandingPanel";
import { MergePanel } from "./components/MergePanel";
import { PushImagePanel } from "./components/PushImagePanel";
import { ConfigPanel, type ConfigTab } from "./components/ConfigPanel";
import { SettlementPanel } from "./components/SettlementPanel";
import { PackSpeedPanel } from "./components/PackSpeedPanel";
import { PrivacyPanel } from "./components/PrivacyPanel";
import { KsPublishPanel } from "./components/KsPublishPanel";
import { BtJavaProjectsPanel } from "./components/BtJavaProjectsPanel";
import { BtPhpSitesPanel } from "./components/BtPhpSitesPanel";
import { UpdateModal } from "./components/UpdateModal";
import { DiagnosticLogModal } from "./components/DiagnosticLogModal";
import { useLanding } from "./hooks/useLanding";
import { useAppConfig } from "./hooks/useAppConfig";
import { useBuildProgress, useToast } from "./hooks/useBuildProgress";
import { useUploadPush } from "./hooks/useUploadPush";
import { useBranchPack } from "./hooks/useBranchPack";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import "./App.css";

import type { HarborConfig, TabType, BuildRecord } from "./types";
import { isTauriRuntime, resolveHarborRepository } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { resolveHistoryJarPushConfig } from "./historyJarPush.ts";
import { shouldKeepPreviewServer } from "./utils/previewLifecycle";
import { readStoredActiveTab, writeStoredActiveTab } from "./utils/activeTabStorage";

function App() {
  const [activeTab, setActiveTab] = useState<TabType>(() => readStoredActiveTab("upload"));
  const [configSubTab, setConfigSubTab] = useState<ConfigTab | undefined>();
  const previewStopTimerRef = useRef<number | null>(null);
  const { confirm } = useConfirmDialog();

  // 记住当前菜单：右键 reload / 刷新后回到离开前的页签
  useEffect(() => {
    writeStoredActiveTab(activeTab);
  }, [activeTab]);

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

  const openMavenConfig = useCallback(() => {
    setConfigSubTab("jar");
    setActiveTab("config");
  }, [setActiveTab]);

  const patchHarborConfig = useCallback(
    (patch: Partial<HarborConfig>) => {
      app.setConfig((prev) => ({ ...prev, ...patch }));
    },
    [app.setConfig],
  );

  const setKsLastEnvId = useCallback(
    (id: string) => {
      app.setConfig((prev) => ({ ...prev, ks_last_env_id: id }));
    },
    [app.setConfig],
  );

  const setKsPublishMaps = useCallback(
    (maps: NonNullable<HarborConfig["ks_publish_maps"]>) => {
      app.setConfig((prev) => ({ ...prev, ks_publish_maps: maps }));
    },
    [app.setConfig],
  );

  const branch = useBranchPack({
    config: app.config,
    setConfig: app.setConfig,
    getConfigSnapshot: app.getConfigSnapshot,
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
    onOpenMavenConfig: openMavenConfig,
    confirm,
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

  const openArtifactPath = useCallback(
    (path: string) => app.openArtifactPath(path, showToast),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.openArtifactPath, showToast],
  );

  const [pushingRecordId, setPushingRecordId] = useState<string | null>(null);
  /** 历史页推送会话：推送中及完成后仍显示进度/日志，离开历史 tab 后清除 */
  const [historyPushUi, setHistoryPushUi] = useState(false);

  useEffect(() => {
    if (activeTab !== "history") {
      setHistoryPushUi(false);
      setPushingRecordId(null);
    }
  }, [activeTab]);

  const handleHistoryPushJar = useCallback(
    async (record: BuildRecord) => {
      if (!isTauriRuntime()) {
        showToast("请在桌面端推送 Harbor");
        return;
      }
      if (build.isBuilding) {
        showToast("已有构建任务进行中");
        return;
      }
      const resolved = resolveHistoryJarPushConfig(record, app.config);
      if (!resolved) {
        showToast("该记录没有可推送的 JAR");
        return;
      }
      if (!app.config.harbor_url || !app.config.username || !app.config.password || !app.config.project) {
        showToast("请先完善 Harbor 配置");
        setActiveTab("config");
        return;
      }
      const repoCheck = resolveHarborRepository(resolved.imageName, app.config.project);
      if (!repoCheck.ok) {
        showToast(repoCheck.error);
        return;
      }

      setHistoryPushUi(true);
      setPushingRecordId(record.id);
      build.setIsBuilding(true);
      build.setCopied(null);
      build.setProgress(0);
      build.setProgressMessage("🚀 历史记录推送 Harbor...");
      build.setLog("");
      build.setShowBuildLog(true);
      try {
        const result = await invoke<string>("build_and_push", {
          jarPath: resolved.jarPath,
          imageName: resolved.imageName,
          imageTag: resolved.imageTag,
          artifactType: "jar",
          exposePort: resolved.exposePort || null,
          nginxLocations: [],
        });
        const imgMatch = result.match(/完整镜像:\s*(.+)/);
        const fullImage = imgMatch?.[1]?.trim() || `${resolved.imageName}:${resolved.imageTag}`;
        await invoke("update_build_record_push", {
          recordId: record.id,
          imageName: resolved.imageName,
          imageTag: fullImage,
        });
        await app.loadBuildHistory();
        build.setLog(`✅ 历史 JAR 已推送 Harbor\n\n完整镜像: ${fullImage}`);
        showToast("推送成功");
      } catch (e) {
        build.setLog(`❌ 历史 JAR 推送失败:\n${e}`);
        showToast(`推送失败: ${e}`);
      } finally {
        build.setIsBuilding(false);
        setPushingRecordId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.config, app.loadBuildHistory, build.isBuilding, showToast],
  );

  return (
    <AppShell
      className="app"
      padding={0}
      transitionDuration={250}
      transitionTimingFunction="cubic-bezier(0.4, 0, 0.2, 1)"
      navbar={getAppShellNavbarConfig(app.sidebarCollapsed)}
      styles={{
        root: {
          height: "100vh",
          minHeight: 0,
          background: "var(--color-bg-base)",
          overflow: "visible",
        },
        main: {
          background: "var(--color-bg-base)",
          minHeight: 0,
          height: "100vh",
          overflow: "auto",
          zIndex: 1,
        },
        navbar: {
          background: "var(--color-bg-surface)",
          borderRight: "1px solid var(--color-border-strong)",
          overflow: "visible",
          zIndex: 200,
        },
      }}
    >
      <Sidebar
        activeTab={activeTab}
        sidebarCollapsed={app.sidebarCollapsed}
        opsMode={app.opsMode}
        onTabChange={app.handleTabChange}
        onToggleCollapse={() => app.setSidebarCollapsed(!app.sidebarCollapsed)}
        onOpenLog={app.openDiagnosticLog}
      />

      <AppShell.Main className="content">
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
            onRemoveImage={upload.removeLocalImage}
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
            autoPublishKs={branch.autoPublishKs}
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
              if (branch.repoPath) {
                branch.loadNpmScripts(branch.repoPath, dir, undefined, branch.branchName);
              }
            }}
            onSelectedBuildScriptChange={branch.setSelectedBuildScript}
            onPackageWithBackendChange={branch.setPackageWithBackend}
            onSpringProfileChange={branch.setSpringProfile}
            onAutoPushImageChange={branch.setAutoPushImage}
            onAutoPublishKsChange={branch.setAutoPublishKs}
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
            isBuilding={build.isBuilding}
            showPushProgress={historyPushUi}
            pushingRecordId={pushingRecordId}
            progress={build.progress}
            progressMessage={build.progressMessage}
            log={build.log}
            showBuildLog={build.showBuildLog}
            onLoadHistory={app.loadBuildHistory}
            onClearHistory={() => app.clearBuildHistory(showToast)}
            onDeleteRecord={(record) => app.deleteBuildRecord(record, showToast)}
            onOpenArtifact={openArtifactPath}
            onCopyImage={build.handleCopyImage}
            onPushJar={(record) => { void handleHistoryPushJar(record); }}
            onCancelBuild={build.handleCancelBuild}
            setShowBuildLog={build.setShowBuildLog}
            renderLog={build.renderLog}
          />
        )}

        {activeTab === "btJava" && <BtJavaProjectsPanel />}
        {activeTab === "btPhp" && <BtPhpSitesPanel />}

        {activeTab === "merge" && (
          <MergePanel
            config={app.config}
            onOpenDirectory={openArtifactPath}
            onConfigPatch={patchHarborConfig}
            getConfigSnapshot={app.getConfigSnapshot}
            onPackageAfterMerge={({ repoPath, targetBranch }) => {
              void branch.packageFromMergeTarget(repoPath, targetBranch);
            }}
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

        {activeTab === "ksPublish" && (
          <KsPublishPanel
            config={app.config}
            configReady={app.configLoaded}
            getConfigSnapshot={app.getConfigSnapshot}
            onLastEnvChange={setKsLastEnvId}
            onPublishMapsChange={setKsPublishMaps}
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
            initialSubTab={configSubTab}
            onClearGitRecords={async () => {
              const ok = await app.clearGitRecords(showToast);
              if (ok) branch.resetGitMemoryUi();
              return ok;
            }}
          />
        )}
      </AppShell.Main>

      <DiagnosticLogModal
        opened={app.showLogViewer}
        logContent={app.logContent}
        logSearch={app.logSearch}
        logDay={app.logDay}
        logDates={app.logDates}
        onClose={() => {
          app.setShowLogViewer(false);
          app.setLogSearch("");
        }}
        onSearchChange={app.setLogSearch}
        onSelectDay={(day) => { void app.selectDiagnosticDay(day); }}
        onRevealFile={() => { void app.revealDiagnosticLogFile(showToast); }}
        onDownload={() => { void app.downloadDiagnosticLog(showToast); }}
      />

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
    </AppShell>
  );
}

export default App;
