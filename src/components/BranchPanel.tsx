import {
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  FileText, CheckCircle, Copy, Loader2, Eye, EyeOff,
  GitBranch, FolderOpen, ExternalLink, List, Pin, XCircle, Search, User, Package
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SearchableDropdown } from "./SearchableDropdown";
import { SpringProfileSection } from "./branch/SpringProfileSection";
import { BranchAdvancedSettings } from "./branch/BranchAdvancedSettings";
import type {
  BranchProjectType, HarborConfig,
  GitBranchOption, LastCommitInfo, CommitInfo, AuthorInfo, NginxLocationBlock
} from "../types";
import type { BranchImageResult } from "../branchImageResults";
import { shouldShowBranchProgress, shouldShowBranchResults } from "../branchImageResults";
import { panelPaperStyles, panelSegmentedStyles, commitHashButtonStyles } from "../theme/panelStyles";
import { isCopyHighlighted, normalizeCopyText } from "../copyImage";

const inputStyles = {
  input: {
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-elevated)",
    color: "var(--color-text)",
  },
  label: { color: "var(--color-text)", fontWeight: 600 },
} as const;

interface BranchPanelProps {
  // 项目类型
  branchProjectType: BranchProjectType;
  // 仓库相关
  repoPath: string;
  branchName: string;
  branchOptions: GitBranchOption[];
  isLoadingBranches: boolean;
  // npm 相关
  frontendDir: string;
  npmScripts: string[];
  selectedBuildScript: string;
  isLoadingScripts: boolean;
  packageWithBackend: boolean;
  // Spring 相关
  springProfile: string;
  springProfiles: string[];
  isLoadingProfiles: boolean;
  // 提交信息
  lastCommit: LastCommitInfo | null;
  isLoadingCommit: boolean;
  commitList: CommitInfo[];
  commitListTotal: number;
  showCommitListModal: boolean;
  // 构建相关
  artifactPath: string;
  backendArtifactPath: string;
  worktreePath: string;
  customDockerfile: string;
  branchHasDockerfile: boolean;
  isBuilding: boolean;
  autoPushImage: boolean;
  autoPublishKs: boolean;
  branchFullImage: string;
  branchImageResults: BranchImageResult[];
  imageName: string;
  imageTag: string;
  exposePort: string;
  nginxLocations: NginxLocationBlock[];
  // 高级设置
  showAdvancedSettings: boolean;
  // 配置
  config: HarborConfig;
  // 日志
  progress: number;
  progressMessage: string;
  log: string;
  showBuildLog: boolean;
  copied: string | null;
  // 回调
  onBranchProjectTypeChange: (type: BranchProjectType) => void;
  onRepoPathChange: (path: string) => void;
  onSelectRepo: () => void;
  onRefreshBranches: () => void;
  onBranchChange: (branch: string) => void;
  onFrontendDirChange: (dir: string) => void;
  onSelectedBuildScriptChange: (script: string) => void;
  onPackageWithBackendChange: (checked: boolean) => void;
  onSpringProfileChange: (profile: string) => void;
  onAutoPushImageChange: (checked: boolean) => void;
  onAutoPublishKsChange: (checked: boolean) => void;
  onRememberSettingsChange: (checked: boolean) => void;
  setShowCommitListModal: (show: boolean) => void;
  loadCommitList: (repoPath: string, branch: string, page: number, authorFilter?: string, messageFilter?: string) => void;
  loadCommitAuthors: (repoPath: string, branch: string) => void;
  commitAuthors: AuthorInfo[];
  isLoadingCommitList: boolean;
  commitListPage: number;
  commitListPageSize: number;
  commitAuthorFilter: string;
  commitMessageFilter: string;
  setCommitAuthorFilter: (filter: string) => void;
  setCommitMessageFilter: (filter: string) => void;
  onPackageFromBranch: () => void;
  onCancelBuild: () => void;
  onOpenDirectory: (path: string) => void;
  onCopyImage: (url: string) => void;
  setImageName: (name: string) => void;
  setImageTag: (tag: string) => void;
  setExposePort: (port: string) => void;
  onNginxLocationsChange: (locations: NginxLocationBlock[]) => void;
  setShowAdvancedSettings: (show: boolean) => void;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => React.ReactNode;
}

function closeCommitModal(
  setShowCommitListModal: (show: boolean) => void,
  setCommitAuthorFilter: (filter: string) => void,
  setCommitMessageFilter: (filter: string) => void,
) {
  setShowCommitListModal(false);
  setCommitAuthorFilter("");
  setCommitMessageFilter("");
}

export function BranchPanel({
  branchProjectType, repoPath, branchName, branchOptions, isLoadingBranches,
  frontendDir, npmScripts, selectedBuildScript, isLoadingScripts, packageWithBackend,
  springProfile, springProfiles, isLoadingProfiles,
  lastCommit, isLoadingCommit, commitList, commitListTotal, showCommitListModal,
  artifactPath, backendArtifactPath, worktreePath, customDockerfile, branchHasDockerfile,
  isBuilding, autoPushImage, autoPublishKs, branchFullImage, branchImageResults, imageName, imageTag, exposePort,
  nginxLocations, showAdvancedSettings, config,
  progress, progressMessage, log, showBuildLog, copied,
  onBranchProjectTypeChange, onRepoPathChange, onSelectRepo, onRefreshBranches,
  onBranchChange, onFrontendDirChange, onSelectedBuildScriptChange,
  onPackageWithBackendChange, onSpringProfileChange, onAutoPushImageChange, onAutoPublishKsChange,
  onRememberSettingsChange, setShowCommitListModal, loadCommitList, loadCommitAuthors,
  commitAuthors, isLoadingCommitList, commitListPage, commitListPageSize,
  commitAuthorFilter, commitMessageFilter, setCommitAuthorFilter, setCommitMessageFilter,
  onPackageFromBranch, onCancelBuild, onOpenDirectory, onCopyImage,
  setImageName, setImageTag, setExposePort, onNginxLocationsChange, setShowAdvancedSettings, setShowBuildLog,
  renderLog,
}: BranchPanelProps) {
  const showProgress = shouldShowBranchProgress(isBuilding, log, progress);
  const showResults = shouldShowBranchResults(
    isBuilding,
    artifactPath,
    branchImageResults.length > 0 || !!branchFullImage,
  );

  const branchDisplayMap = Object.fromEntries(
    branchOptions.map((b) => {
      const display = b.name.includes('/') ? b.name.substring(b.name.indexOf('/') + 1) : b.name;
      return [display, b.name];
    })
  );
  const branchDisplayNames = Object.keys(branchDisplayMap);
  const currentBranchDisplay = branchDisplayMap[branchName] || branchName;
  const branchFallbackCopied =
    branchImageResults.length === 0 && branchFullImage
      ? isCopyHighlighted(copied, branchFullImage)
      : false;
  const branchFallbackCopyText = branchFullImage ? normalizeCopyText(branchFullImage) : "";

  const authorSelectData = [
    { value: "", label: "全部作者" },
    ...commitAuthors.map((author) => ({
      value: author.name,
      label: `${author.name} (${author.count})`,
    })),
  ];

  const handleCloseCommitModal = () => {
    closeCommitModal(setShowCommitListModal, setCommitAuthorFilter, setCommitMessageFilter);
  };

  return (
    <Stack gap="sm" className="branch-panel">
      <SegmentedControl
        size="sm"
        value={branchProjectType}
        onChange={(v) => onBranchProjectTypeChange(v as BranchProjectType)}
        data={[
          { value: "maven", label: "Maven 项目" },
          { value: "npm", label: "npm 前端" },
        ]}
        styles={panelSegmentedStyles}
      />

      {/* 仓库与分支 */}
      <Paper p="md" radius="md" withBorder styles={panelPaperStyles} className="branch-card">
        <Stack gap="sm">
          <Text className="branch-section-title">仓库与分支</Text>

          <Stack gap={6}>
            <Text size="sm" fw={600} c="var(--color-text)">Git 仓库</Text>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              <div className="searchable-dropdown-wrapper" style={{ flex: 1, minWidth: 0 }}>
                <SearchableDropdown
                  value={repoPath}
                  options={config.repo_path_history || []}
                  onChange={(value) => {
                    onRepoPathChange(value);
                  }}
                  onBlur={onRepoPathChange}
                  commitOnInput={false}
                  placeholder="输入 Git 地址或选择本地目录"
                />
              </div>
              <Button
                variant="default"
                leftSection={<FolderOpen size={16} />}
                onClick={onSelectRepo}
              >
                选择
              </Button>
              <Button
                variant="default"
                leftSection={isLoadingBranches ? <Loader2 size={16} className="spin" /> : <GitBranch size={16} />}
                onClick={onRefreshBranches}
                disabled={!repoPath || isLoadingBranches}
              >
                {isLoadingBranches ? "读取中" : "刷新分支"}
              </Button>
            </Group>
            {repoPath && (
              <Text size="xs" c="var(--color-text-muted)">
                {repoPath.startsWith("http://") || repoPath.startsWith("https://") || repoPath.startsWith("git@")
                  ? "远程 Git 地址，打包时自动克隆"
                  : `当前选择：${repoPath}`}
              </Text>
            )}
          </Stack>

          <Stack gap={6}>
            <Text size="sm" fw={600} c="var(--color-text)">目标分支</Text>
            <SearchableDropdown
              value={currentBranchDisplay}
              options={branchDisplayNames}
              onChange={(display) => onBranchChange(branchDisplayMap[display] || display)}
              placeholder={isLoadingBranches ? "加载中..." : branchOptions.length === 0 ? "请先选择仓库" : "搜索或选择分支..."}
              disabled={!repoPath || branchOptions.length === 0}
              loading={isLoadingBranches}
            />
            <Text size="xs" c="var(--color-text-muted)">
              点击打包时会先执行 git fetch --all --prune 更新分支代码
            </Text>
          </Stack>

          {lastCommit && (
            <Paper
              p="sm"
              radius="md"
              withBorder
              styles={{
                root: {
                  background: "var(--color-bg-elevated)",
                  borderColor: "var(--color-border)",
                },
              }}
              className="branch-commit-info"
            >
              <Group justify="space-between" mb={4}>
                <Group gap={8}>
                  <Pin size={14} color="var(--color-text-muted)" />
                  <Text size="sm" fw={600} c="var(--color-text)">最近提交</Text>
                </Group>
                {isLoadingCommit && (
                  <Text size="xs" c="var(--color-text-muted)">加载中...</Text>
                )}
              </Group>
              <Group align="flex-start" gap="md" mb={4}>
                {lastCommit.url ? (
                  <Button
                    variant="subtle"
                    color="gray"
                    size="compact-xs"
                    className="commit-hash commit-link"
                    title={`在浏览器中打开: ${lastCommit.hash}`}
                    onClick={() => openUrl(lastCommit.url!)}
                    rightSection={<ExternalLink size={12} />}
                    styles={commitHashButtonStyles}
                  >
                    {lastCommit.short_hash}
                  </Button>
                ) : (
                  <Badge variant="light" color="blue" className="commit-hash" title={lastCommit.hash}>
                    {lastCommit.short_hash}
                  </Badge>
                )}
                <Text size="sm" c="var(--color-text)" style={{ flex: 1, wordBreak: "break-word" }}>
                  {lastCommit.message}
                </Text>
              </Group>
              <Group gap="sm">
                <Text size="xs" c="var(--color-text-muted)">{lastCommit.author}</Text>
                <Text size="xs" c="var(--color-text-muted)">{lastCommit.date}</Text>
              </Group>
            </Paper>
          )}

          {commitListTotal > 0 && (
            <Button
              variant="default"
              size="compact-sm"
              leftSection={<List size={14} />}
              onClick={() => {
                setShowCommitListModal(true);
                if (commitList.length === 0) {
                  loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter);
                }
                if (commitAuthors.length === 0) {
                  loadCommitAuthors(repoPath, branchName);
                }
              }}
            >
              查看提交记录 ({commitListTotal})
            </Button>
          )}
        </Stack>
      </Paper>

      {/* 构建选项 */}
      <Paper p="md" radius="md" withBorder styles={panelPaperStyles} className="branch-card">
        <Stack gap="sm">
          <Text className="branch-section-title">构建选项</Text>

          {branchProjectType === "npm" && (
            <TextInput
              label="前端子目录（自动检测）"
              value={frontendDir}
              onChange={(e) => onFrontendDirChange(e.currentTarget.value)}
              placeholder="自动检测中..."
              styles={{
                ...inputStyles,
                description: { color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" },
              }}
              description={
                frontendDir
                  ? `已检测到前端目录: ${frontendDir}`
                  : "选择仓库后自动检测 package.json 所在目录"
              }
            />
          )}

          {branchProjectType === "npm" && npmScripts.length > 0 && (
            <Stack gap={6}>
              <Text size="sm" fw={600} c="var(--color-text)">构建命令</Text>
              <SearchableDropdown
                value={selectedBuildScript}
                options={npmScripts}
                onChange={onSelectedBuildScriptChange}
                placeholder="选择构建命令..."
                disabled={isLoadingScripts}
                loading={isLoadingScripts}
              />
            </Stack>
          )}

          {branchProjectType === "npm" && (
            <Stack gap={4}>
              <Checkbox
                label="同时打包后端（Maven）"
                checked={packageWithBackend}
                onChange={(e) => onPackageWithBackendChange(e.currentTarget.checked)}
                styles={{ label: { color: "var(--color-text)" } }}
              />
              <Text size="xs" c="var(--color-text-muted)">
                {packageWithBackend
                  ? "前端构建完成后将在仓库根目录执行 mvn clean package -Dmaven.test.skip=true"
                  : "勾选后会将仓库根目录的 Spring Boot 后端一同打包"}
              </Text>
            </Stack>
          )}

          {branchProjectType === "maven" && (
            <SpringProfileSection
              springProfile={springProfile}
              springProfiles={springProfiles}
              isLoadingProfiles={isLoadingProfiles}
              onSpringProfileChange={onSpringProfileChange}
            />
          )}

          <Paper
            p="sm"
            radius="md"
            withBorder
            styles={{
              root: {
                background: "var(--color-bg-elevated)",
                borderColor: "var(--color-border)",
              },
            }}
            className="branch-command-preview"
          >
            <Text size="sm" c="var(--color-text)">
              固定命令：{" "}
              <Code style={{ fontSize: 12, color: "var(--color-text)" }}>
                {branchProjectType === "maven"
                  ? `mvn clean package -Dmaven.test.skip=true${springProfile.trim() ? ` -Dspring.profiles.active=${springProfile.trim()}` : ""}`
                  : `npm install && npm run ${selectedBuildScript || "build"}`}
              </Code>
              {branchProjectType === "npm" && packageWithBackend && (
                <>
                  <br />
                  <Text component="span" ml="2.5em" size="sm" c="var(--color-text)">+ </Text>
                  <Code style={{ fontSize: 12, color: "var(--color-text)" }}>mvn clean package -Dmaven.test.skip=true</Code>
                  <Text component="span" size="xs" c="var(--color-text-muted)" ml={4}>(仓库根目录)</Text>
                </>
              )}
            </Text>
          </Paper>
        </Stack>
      </Paper>

      {/* 推送与发布 */}
      <Paper p="md" radius="md" withBorder styles={panelPaperStyles} className="branch-card">
        <Stack gap="sm">
          <Text className="branch-section-title">推送与发布</Text>

          {(branchProjectType === "maven" || branchProjectType === "npm") && (
            <Stack gap="sm">
              <Stack gap={4}>
                <Checkbox
                  label="打包后联动推送镜像到 Harbor"
                  checked={autoPushImage}
                  onChange={(e) => onAutoPushImageChange(e.currentTarget.checked)}
                  styles={{ label: { color: "var(--color-text)" } }}
                />
                <Text size="xs" c="var(--color-text-muted)">
                  {autoPushImage
                    ? branchProjectType === "npm" && !packageWithBackend
                      ? "打包成功后将构建前端 nginx 镜像并推送"
                      : "打包成功后将自动构建并推送镜像"
                    : springProfile.trim().toLowerCase() === "test"
                      ? "Profile=test 时默认不推 Harbor（可手动开启）"
                      : "勾选后打包成功会自动推送镜像"}
                </Text>
              </Stack>
              <Stack gap={4}>
                <Checkbox
                  label="推送后自动发布到 KubeSphere"
                  checked={autoPublishKs}
                  disabled={!autoPushImage || isBuilding}
                  onChange={(e) => onAutoPublishKsChange(e.currentTarget.checked)}
                  styles={{ label: { color: "var(--color-text)" } }}
                />
                <Text size="xs" c="var(--color-text-muted)">
                  按系统设置中的 Git 地址映射发布；未配置映射则跳过，不影响推送成功
                </Text>
              </Stack>
            </Stack>
          )}

          {(branchProjectType === "maven" || branchProjectType === "npm") && (
            <BranchAdvancedSettings
              branchProjectType={branchProjectType}
              showAdvancedSettings={showAdvancedSettings}
              setShowAdvancedSettings={setShowAdvancedSettings}
              branchHasDockerfile={branchHasDockerfile}
              imageName={imageName}
              setImageName={setImageName}
              exposePort={exposePort}
              setExposePort={setExposePort}
              imageTag={imageTag}
              setImageTag={setImageTag}
              nginxLocations={nginxLocations}
              onNginxLocationsChange={onNginxLocationsChange}
              config={config}
            />
          )}

          <Checkbox
            label="记住本次配置，下次自动带出"
            checked={config.remember_branch_settings}
            onChange={(e) => onRememberSettingsChange(e.currentTarget.checked)}
            styles={{ label: { color: "var(--color-text)" } }}
          />
        </Stack>
      </Paper>

      <Button
        color="cyan"
        variant="filled"
        size="md"
        fullWidth
        className="build-btn upload-primary-cta"
        onClick={onPackageFromBranch}
        disabled={isBuilding || !repoPath || !branchName.trim()}
        leftSection={isBuilding ? <Loader2 size={18} className="spin" /> : <GitBranch size={18} />}
      >
        {isBuilding ? "分支打包中..." : "从指定分支打包"}
      </Button>

      {showProgress && (
        <Stack gap="xs" className="progress-section">
          <Group justify="space-between">
            <Text size="sm" c="var(--color-text)">{progressMessage}</Text>
            <Text size="sm" c="var(--color-primary-hover)" fw={600}>{progress}%</Text>
          </Group>
          <Progress value={progress} />
        </Stack>
      )}

      {showResults && (
        <Paper p="sm" radius="md" withBorder className="path-links" styles={{
          root: {
            background: "var(--color-bg-elevated)",
            borderColor: "var(--color-border)",
          },
        }}>
          <Stack gap={8}>
            {branchImageResults.length > 0 ? (
              branchImageResults.map((item) => {
                const isCopied = copied === item.image;
                return (
                  <Stack
                    key={`${item.role}-${item.image}`}
                    gap={0}
                    className={`path-link-item image-url-row image-url-row--primary ${isCopied ? "copied" : ""}`}
                  >
                    <Group className="image-url-row-head" wrap="nowrap">
                      <Text className="image-url-title">
                        <Package size={14} className="image-url-title-icon" />
                        {item.label}
                      </Text>
                      <Button
                        size="compact-sm"
                        variant={isCopied ? "filled" : "light"}
                        color={isCopied ? "teal" : "cyan"}
                        className={`copy-btn ${isCopied ? "copied" : ""}`}
                        onClick={() => onCopyImage(item.image)}
                        title={item.copyLabel}
                        leftSection={isCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                      >
                        {isCopied ? "已复制" : item.copyLabel}
                      </Button>
                    </Group>
                    <Text
                      size="sm"
                      c="var(--color-text)"
                      className="image-url-value"
                      title={item.image}
                    >
                      {item.image}
                    </Text>
                  </Stack>
                );
              })
            ) : branchFullImage && (
              <Stack
                gap={0}
                className={`path-link-item image-url-row image-url-row--primary ${branchFallbackCopied ? "copied" : ""}`}
              >
                <Group className="image-url-row-head" wrap="nowrap">
                  <Text className="image-url-title">
                    <Package size={14} className="image-url-title-icon" />
                    完整镜像
                  </Text>
                  <Button
                    size="compact-sm"
                    variant={branchFallbackCopied ? "filled" : "light"}
                    color={branchFallbackCopied ? "teal" : "cyan"}
                    className={`copy-btn ${branchFallbackCopied ? "copied" : ""}`}
                    onClick={() => onCopyImage(branchFallbackCopyText)}
                    title="复制镜像地址"
                    leftSection={branchFallbackCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                  >
                    {branchFallbackCopied ? "已复制" : "复制"}
                  </Button>
                </Group>
                <Stack gap={2}>
                  {branchFullImage.split('\n').map((line, i) => (
                    <Text key={i} size="sm" className="image-url-value" c="var(--color-text)" title={line}>
                      {line}
                    </Text>
                  ))}
                </Stack>
              </Stack>
            )}
            <Group gap="xs" wrap="nowrap" className="path-link-item">
              <Group gap={6} className="path-link-label">
                <FileText size={14} />
                <Text size="xs" c="var(--color-text-muted)">产物目录</Text>
              </Group>
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                className="path-link-btn"
                onClick={() => onOpenDirectory(artifactPath)}
                styles={{ root: { fontFamily: "monospace", height: "auto", wordBreak: "break-all", textAlign: "left" } }}
              >
                {artifactPath}
              </Button>
            </Group>
            {backendArtifactPath && (
              <Group gap="xs" wrap="nowrap" className="path-link-item">
                <Group gap={6} className="path-link-label">
                  <FileText size={14} />
                  <Text size="xs" c="var(--color-text-muted)">后端产物</Text>
                </Group>
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  className="path-link-btn"
                  onClick={() => onOpenDirectory(backendArtifactPath)}
                  styles={{ root: { fontFamily: "monospace", height: "auto", wordBreak: "break-all", textAlign: "left" } }}
                >
                  {backendArtifactPath}
                </Button>
              </Group>
            )}
            {worktreePath && (
              <Group gap="xs" wrap="nowrap" className="path-link-item">
                <Group gap={6} className="path-link-label">
                  <FolderOpen size={14} />
                  <Text size="xs" c="var(--color-text-muted)">输出目录</Text>
                </Group>
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  className="path-link-btn"
                  onClick={() => onOpenDirectory(worktreePath)}
                  styles={{ root: { fontFamily: "monospace", height: "auto", wordBreak: "break-all", textAlign: "left" } }}
                >
                  {worktreePath}
                </Button>
              </Group>
            )}
            {customDockerfile && (
              <Group gap="xs" wrap="nowrap" className="path-link-item dockerfile-indicator">
                <Group gap={6} className="path-link-label">
                  <FileText size={14} />
                  <Text size="xs" c="var(--color-text-muted)">使用项目 Dockerfile</Text>
                </Group>
                <Button
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  className="path-link-btn"
                  onClick={() => onOpenDirectory(customDockerfile)}
                  styles={{ root: { fontFamily: "monospace", height: "auto", wordBreak: "break-all", textAlign: "left" } }}
                >
                  {customDockerfile}
                </Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}

      {isBuilding && (
        <Button
          variant="light"
          color="red"
          className="cancel-btn"
          onClick={onCancelBuild}
          leftSection={<XCircle size={16} />}
        >
          取消构建
        </Button>
      )}

      {log && (
        <Stack gap="xs" className="log-section">
          <Button
            variant="light"
            color="cyan"
            size="sm"
            className="log-toggle-btn"
            onClick={() => setShowBuildLog(!showBuildLog)}
            title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
            leftSection={showBuildLog ? <EyeOff size={15} /> : <Eye size={15} />}
          >
            {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
          </Button>
          {showBuildLog && (
            <ScrollArea.Autosize mah={400} type="auto">
              <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
                {renderLog(log)}
              </div>
            </ScrollArea.Autosize>
          )}
        </Stack>
      )}

      <Modal
        opened={showCommitListModal}
        onClose={handleCloseCommitModal}
        title="提交记录"
        size="lg"
        centered
        styles={{
          content: { background: "var(--color-bg-surface)", border: "1px solid var(--color-border)" },
          header: { background: "var(--color-bg-surface)" },
          title: { color: "var(--color-text)", fontWeight: 600 },
        }}
      >
        <Stack gap="sm">
          <Group gap="xs" align="flex-end" wrap="wrap">
            <TextInput
              flex={1}
              miw={180}
              placeholder="搜索提交信息..."
              value={commitMessageFilter}
              onChange={(e) => setCommitMessageFilter(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter);
                }
              }}
              leftSection={<Search size={15} />}
              styles={inputStyles}
            />
            <Select
              miw={160}
              data={authorSelectData}
              value={commitAuthorFilter}
              onChange={(value) => {
                const next = value ?? "";
                setCommitAuthorFilter(next);
                loadCommitList(repoPath, branchName, 1, next, commitMessageFilter);
              }}
              leftSection={<User size={15} />}
              styles={inputStyles}
              comboboxProps={{ withinPortal: true }}
            />
            <Button
              variant="default"
              onClick={() => loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter)}
            >
              搜索
            </Button>
            {(commitAuthorFilter || commitMessageFilter) && (
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  setCommitAuthorFilter("");
                  setCommitMessageFilter("");
                  loadCommitList(repoPath, branchName, 1, "", "");
                }}
              >
                清除
              </Button>
            )}
          </Group>

          {isLoadingCommitList ? (
            <Text ta="center" c="var(--color-text-muted)" py="lg">加载中...</Text>
          ) : commitList.length === 0 ? (
            <Text ta="center" c="var(--color-text-muted)" py="lg">暂无提交记录</Text>
          ) : (
            <ScrollArea.Autosize mah={400} type="auto">
              <Stack gap="xs">
                {commitList.map((commit) => (
                  <Paper
                    key={commit.hash}
                    p="sm"
                    radius="sm"
                    styles={{
                      root: {
                        background: "var(--color-bg-elevated)",
                        border: "1px solid var(--color-border)",
                      },
                    }}
                    className="modal-list-item"
                  >
                    <Group align="flex-start" gap="sm" mb={4}>
                      {commit.url ? (
                        <Button
                          variant="subtle"
                          color="gray"
                          size="compact-xs"
                          className="commit-hash commit-link"
                          title={`在浏览器中打开: ${commit.hash}`}
                          onClick={() => openUrl(commit.url!)}
                          rightSection={<ExternalLink size={10} />}
                          styles={commitHashButtonStyles}
                        >
                          {commit.short_hash}
                        </Button>
                      ) : (
                        <Badge variant="light" color="blue" className="commit-hash" title={commit.hash}>
                          {commit.short_hash}
                        </Badge>
                      )}
                      <Text size="sm" c="var(--color-text)" style={{ flex: 1, wordBreak: "break-word" }}>
                        {commit.message}
                      </Text>
                    </Group>
                    <Group gap="md">
                      <Text size="xs" c="var(--color-text-muted)">{commit.author}</Text>
                      <Text size="xs" c="var(--color-text-muted)">{commit.date}</Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}

          {commitListTotal > 0 && (
            <Group justify="center" gap="md">
              <Button
                variant="default"
                disabled={commitListPage <= 1 || isLoadingCommitList}
                onClick={() => loadCommitList(repoPath, branchName, commitListPage - 1, commitAuthorFilter, commitMessageFilter)}
              >
                上一页
              </Button>
              <Text size="sm" c="var(--color-text-muted)">
                第 {commitListPage} / {Math.ceil(commitListTotal / commitListPageSize)} 页
              </Text>
              <Button
                variant="default"
                disabled={isLoadingCommitList}
                onClick={() => loadCommitList(repoPath, branchName, commitListPage + 1, commitAuthorFilter, commitMessageFilter)}
              >
                下一页
              </Button>
            </Group>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
