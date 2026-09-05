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
  UnstyledButton,
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
import {
  computeDefaultBuildCommand,
  parseNpmScriptFromCommand,
} from "../branchBuildCommand";

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

function commitNpmBuildScript(value: string, onChange: (script: string) => void) {
  const trimmed = value.trim();
  onChange(parseNpmScriptFromCommand(trimmed) ?? trimmed);
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
  const currentBranchDisplay =
    Object.entries(branchDisplayMap).find(([, full]) => full === branchName)?.[0]
    || (branchName.includes("/") ? branchName.substring(branchName.indexOf("/") + 1) : branchName)
    || branchName;
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
              <Group justify="space-between" mb={6} wrap="nowrap" align="center">
                <Group gap={8} wrap="nowrap">
                  <Pin size={14} color="var(--color-text-muted)" />
                  <Text size="sm" fw={600} c="var(--color-text)">最近提交</Text>
                  {isLoadingCommit && (
                    <Text size="xs" c="var(--color-text-muted)">加载中...</Text>
                  )}
                </Group>
                {commitListTotal > 0 && (
                  <Button
                    variant="light"
                    color="blue"
                    size="compact-sm"
                    className="branch-commit-history-btn"
                    leftSection={<List size={13} />}
                    rightSection={
                      <Badge
                        size="sm"
                        variant="filled"
                        color="blue"
                        className="branch-commit-history-count"
                      >
                        {commitListTotal}
                      </Badge>
                    }
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
                    全部记录
                  </Button>
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

          {!lastCommit && commitListTotal > 0 && (
            <Button
              variant="default"
              size="sm"
              fullWidth
              className="branch-commit-history-btn"
              leftSection={<List size={15} />}
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
                  ? `当前前端子目录: ${frontendDir}（可手改）`
                  : "选择仓库后自动检测，也可直接手输相对路径"
              }
            />
          )}

          {branchProjectType === "npm" && (
            <Stack gap={6}>
              <Text size="sm" fw={600} c="var(--color-text)">构建命令</Text>
              <SearchableDropdown
                value={selectedBuildScript}
                options={npmScripts}
                commitOnInput={false}
                onChange={(value) => commitNpmBuildScript(value, onSelectedBuildScriptChange)}
                onBlur={(value) => commitNpmBuildScript(value, onSelectedBuildScriptChange)}
                placeholder={
                  isLoadingScripts
                    ? "加载脚本中，也可直接手输..."
                    : npmScripts.length > 0
                      ? "选择或手输构建命令..."
                      : "手输 npm script，如 build:prod"
                }
                loading={isLoadingScripts}
              />
              <Text size="xs" c="var(--color-text-muted)">
                {npmScripts.length > 0
                  ? `可从 package.json 脚本中选择，也可手贴完整命令（当前将执行 ${(config.npm_package_manager || "npm").trim() || "npm"} run ${selectedBuildScript || "build"}）`
                  : "未检测到 scripts 时仍可手输；也可粘贴 npm/pnpm run 整段命令"}
              </Text>
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
                {computeDefaultBuildCommand({
                  projectType: branchProjectType,
                  packageManager: config.npm_package_manager,
                  buildScript: selectedBuildScript,
                  springProfile,
                  packageWithBackend,
                })}
              </Code>
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
        <Paper
          p="sm"
          radius="md"
          withBorder
          className="branch-result-card"
          styles={{
            root: {
              background:
                "linear-gradient(155deg, color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-elevated)), var(--color-bg-elevated))",
              borderColor: "color-mix(in srgb, var(--color-primary) 40%, transparent)",
            },
          }}
        >
          <Stack gap="sm">
            {branchImageResults.length > 0
              ? branchImageResults.map((item) => {
                  const isCopied = copied === item.image;
                  return (
                    <Stack key={`${item.role}-${item.image}`} gap={6}>
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Group gap={8} wrap="nowrap">
                          <Package size={14} color="var(--color-primary)" />
                          <Text size="sm" fw={700} c="var(--color-primary-hover)">
                            {item.label}
                          </Text>
                          <Badge size="sm" variant="light" color="blue">
                            已就绪
                          </Badge>
                        </Group>
                        <Button
                          size="compact-sm"
                          variant={isCopied ? "filled" : "light"}
                          color={isCopied ? "teal" : "cyan"}
                          onClick={() => onCopyImage(item.image)}
                          leftSection={isCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                        >
                          {isCopied ? "已复制" : "复制"}
                        </Button>
                      </Group>
                      <Text
                        size="sm"
                        ff="monospace"
                        c="var(--color-text)"
                        style={{ wordBreak: "break-all", lineHeight: 1.45 }}
                        title={item.image}
                      >
                        {item.image}
                      </Text>
                    </Stack>
                  );
                })
              : branchFullImage
                ? (
                  <Stack gap={6}>
                    <Group justify="space-between" wrap="nowrap" gap="sm">
                      <Group gap={8} wrap="nowrap">
                        <Package size={14} color="var(--color-primary)" />
                        <Text size="sm" fw={700} c="var(--color-primary-hover)">
                          完整镜像
                        </Text>
                        <Badge size="sm" variant="light" color="blue">
                          已就绪
                        </Badge>
                      </Group>
                      <Button
                        size="compact-sm"
                        variant={branchFallbackCopied ? "filled" : "light"}
                        color={branchFallbackCopied ? "teal" : "cyan"}
                        onClick={() => onCopyImage(branchFallbackCopyText)}
                        leftSection={branchFallbackCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                      >
                        {branchFallbackCopied ? "已复制" : "复制"}
                      </Button>
                    </Group>
                    <Stack gap={4}>
                      {branchFullImage.split("\n").map((line, i) => (
                        <Text
                          key={i}
                          size="sm"
                          ff="monospace"
                          c="var(--color-text)"
                          style={{ wordBreak: "break-all", lineHeight: 1.45 }}
                          title={line}
                        >
                          {line}
                        </Text>
                      ))}
                    </Stack>
                  </Stack>
                  )
                : null}

            <Stack gap={2} pt={4} style={{ borderTop: "1px dashed var(--color-border-strong)" }}>
              {artifactPath && (
                <UnstyledButton
                  className="branch-result-path"
                  onClick={() => onOpenDirectory(artifactPath)}
                  title={artifactPath}
                >
                  <FileText size={13} />
                  <Text span size="xs" fw={600} w={56}>
                    产物
                  </Text>
                  <Text span size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>
                    {artifactPath}
                  </Text>
                </UnstyledButton>
              )}
              {backendArtifactPath && (
                <UnstyledButton
                  className="branch-result-path"
                  onClick={() => onOpenDirectory(backendArtifactPath)}
                  title={backendArtifactPath}
                >
                  <FileText size={13} />
                  <Text span size="xs" fw={600} w={56}>
                    后端产物
                  </Text>
                  <Text span size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>
                    {backendArtifactPath}
                  </Text>
                </UnstyledButton>
              )}
              {worktreePath && (
                <UnstyledButton
                  className="branch-result-path"
                  onClick={() => onOpenDirectory(worktreePath)}
                  title={worktreePath}
                >
                  <FolderOpen size={13} />
                  <Text span size="xs" fw={600} w={56}>
                    输出
                  </Text>
                  <Text span size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>
                    {worktreePath}
                  </Text>
                </UnstyledButton>
              )}
              {customDockerfile && (
                <UnstyledButton
                  className="branch-result-path"
                  onClick={() => onOpenDirectory(customDockerfile)}
                  title={customDockerfile}
                >
                  <FileText size={13} />
                  <Text span size="xs" fw={600} w={56}>
                    Dockerfile
                  </Text>
                  <Text span size="xs" ff="monospace" style={{ wordBreak: "break-all" }}>
                    {customDockerfile}
                  </Text>
                </UnstyledButton>
              )}
            </Stack>
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

          {isLoadingCommitList && commitList.length === 0 ? (
            <Group justify="center" gap="xs" py="lg" c="var(--color-text-muted)">
              <Loader2 size={16} className="spin" />
              <Text size="sm">加载中...</Text>
            </Group>
          ) : commitList.length === 0 ? (
            <Text ta="center" c="var(--color-text-muted)" py="lg">暂无提交记录</Text>
          ) : (
            <ScrollArea.Autosize
              mah={400}
              type="auto"
              style={{
                opacity: isLoadingCommitList ? 0.55 : 1,
                transition: "opacity 0.15s ease",
                pointerEvents: isLoadingCommitList ? "none" : undefined,
              }}
            >
              <Stack gap="xs">
                {isLoadingCommitList && (
                  <Group justify="center" gap="xs" py={4} c="var(--color-text-muted)">
                    <Loader2 size={14} className="spin" />
                    <Text size="xs">加载中...</Text>
                  </Group>
                )}
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
                disabled={
                  isLoadingCommitList
                  || commitListPage >= Math.ceil(commitListTotal / commitListPageSize)
                }
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
