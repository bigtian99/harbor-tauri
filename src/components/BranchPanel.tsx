import { openUrl } from "@tauri-apps/plugin-opener";
import {
  FileText, Package, CheckCircle, Copy, Loader2, Eye, EyeOff,
  GitBranch, FolderOpen, ExternalLink, List, Pin, XCircle, Search, User
} from "lucide-react";
import { SearchableDropdown } from "./SearchableDropdown";
import "./Modal.css";
import type {
  BranchProjectType, HarborConfig,
  GitBranchOption, LastCommitInfo, CommitInfo, AuthorInfo
} from "../types";

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
  branchFullImage: string;
  imageName: string;
  imageTag: string;
  exposePort: string;
  // 高级设置
  showAdvancedSettings: boolean;
  // 配置
  config: HarborConfig;
  // 日志
  progress: number;
  progressMessage: string;
  log: string;
  showBuildLog: boolean;
  copied: boolean;
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
  setShowAdvancedSettings: (show: boolean) => void;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => React.ReactNode;
}

export function BranchPanel({
  branchProjectType, repoPath, branchName, branchOptions, isLoadingBranches,
  frontendDir, npmScripts, selectedBuildScript, isLoadingScripts, packageWithBackend,
  springProfile, springProfiles, isLoadingProfiles,
  lastCommit, isLoadingCommit, commitList, commitListTotal, showCommitListModal,
  artifactPath, backendArtifactPath, worktreePath, customDockerfile, branchHasDockerfile,
  isBuilding, autoPushImage, branchFullImage, imageName, imageTag, exposePort,
  showAdvancedSettings, config,
  progress, progressMessage, log, showBuildLog, copied,
  onBranchProjectTypeChange, onRepoPathChange, onSelectRepo, onRefreshBranches,
  onBranchChange, onFrontendDirChange, onSelectedBuildScriptChange,
  onPackageWithBackendChange, onSpringProfileChange, onAutoPushImageChange,
  onRememberSettingsChange, setShowCommitListModal, loadCommitList, loadCommitAuthors,
  commitAuthors, isLoadingCommitList, commitListPage, commitListPageSize,
  commitAuthorFilter, commitMessageFilter, setCommitAuthorFilter, setCommitMessageFilter,
  onPackageFromBranch, onCancelBuild, onOpenDirectory, onCopyImage,
  setImageName, setImageTag, setExposePort, setShowAdvancedSettings, setShowBuildLog,
  renderLog,
}: BranchPanelProps) {
  // 分支名映射：显示时去掉 origin/ 前缀，值保持完整 ref
  const branchDisplayMap = Object.fromEntries(
    branchOptions.map((b) => {
      const display = b.name.includes('/') ? b.name.substring(b.name.indexOf('/') + 1) : b.name;
      return [display, b.name];
    })
  );
  const branchDisplayNames = Object.keys(branchDisplayMap);
  const currentBranchDisplay = branchDisplayMap[branchName] || branchName;
  return (
    <div className="branch-panel">
      <div className="artifact-type-selector">
        <button
          type="button"
          className={`artifact-type ${branchProjectType === "maven" ? "active" : ""}`}
          onClick={() => onBranchProjectTypeChange("maven")}
        >
          <FileText size={16} /> Maven 项目
        </button>
        <button
          type="button"
          className={`artifact-type ${branchProjectType === "npm" ? "active" : ""}`}
          onClick={() => onBranchProjectTypeChange("npm")}
        >
          <Package size={16} /> npm 前端
        </button>
      </div>

      <div className="branch-card">
        <div className="form-group">
          <label>Git 仓库</label>
          <div className="path-picker-row">
            <div className="searchable-dropdown-wrapper">
              <SearchableDropdown
                value={repoPath}
                options={config.repo_path_history || []}
                onChange={(value) => {
                  onRepoPathChange(value);
                }}
                placeholder="输入 Git 地址或选择本地目录"
              />
            </div>
            <button type="button" className="path-picker-btn" onClick={onSelectRepo}>
              <FolderOpen size={16} /> 选择
            </button>
            <button
              type="button"
              className="path-picker-btn"
              onClick={onRefreshBranches}
              disabled={!repoPath || isLoadingBranches}
            >
              {isLoadingBranches ? <Loader2 size={16} className="spin" /> : <GitBranch size={16} />} {isLoadingBranches ? "读取中" : "刷新分支"}
            </button>
          </div>
          {repoPath && (
            <p className="template-hint">
              {repoPath.startsWith("http://") || repoPath.startsWith("https://") || repoPath.startsWith("git@")
                ? "远程 Git 地址，打包时自动克隆"
                : "当前选择：" + repoPath}
            </p>
          )}
        </div>

        {branchProjectType === "npm" && (
          <div className="form-group">
            <label>前端子目录（自动检测）</label>
            <input
              type="text"
              value={frontendDir}
              onChange={(e) => onFrontendDirChange(e.target.value)}
              placeholder="自动检测中..."
            />
            <p className="template-hint">
              {frontendDir ? `已检测到前端目录: ${frontendDir}` : "选择仓库后自动检测 package.json 所在目录"}
            </p>
          </div>
        )}

        {branchProjectType === "npm" && npmScripts.length > 0 && (
          <div className="form-group">
            <label>构建命令</label>
            <SearchableDropdown
              value={selectedBuildScript}
              options={npmScripts}
              onChange={onSelectedBuildScriptChange}
              placeholder="选择构建命令..."
              disabled={isLoadingScripts}
              loading={isLoadingScripts}
            />
          </div>
        )}

        {branchProjectType === "npm" && (
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={packageWithBackend}
                onChange={(e) => onPackageWithBackendChange(e.target.checked)}
              />
              <span className="checkbox-toggle"></span>
              <span>同时打包后端（Maven）</span>
            </label>
            <p className="template-hint">
              {packageWithBackend
                ? "前端构建完成后将在仓库根目录执行 mvn clean package -DskipTests"
                : "勾选后会将仓库根目录的 Spring Boot 后端一同打包"}
            </p>
          </div>
        )}

        <div className="form-group">
          <label>目标分支</label>
          <SearchableDropdown
            value={currentBranchDisplay}
            options={branchDisplayNames}
            onChange={(display) => onBranchChange(branchDisplayMap[display] || display)}
            placeholder={isLoadingBranches ? "加载中..." : branchOptions.length === 0 ? "请先选择仓库" : "搜索或选择分支..."}
            disabled={!repoPath || branchOptions.length === 0}
            loading={isLoadingBranches}
          />
          <p className="template-hint">点击打包时会先执行 git fetch --all --prune 更新分支代码</p>
        </div>

        {lastCommit && (
          <div className="commit-info">
            <div className="commit-info-header">
              <span className="commit-info-label"><Pin size={14} /> 最近提交</span>
              {isLoadingCommit && <span className="commit-loading">加载中...</span>}
            </div>
            <div className="commit-info-detail">
              {lastCommit.url ? (
                <button
                  className="commit-hash commit-link"
                  title={`在浏览器中打开: ${lastCommit.hash}`}
                  onClick={() => openUrl(lastCommit.url!)}
                >
                  {lastCommit.short_hash}
                  <ExternalLink size={12} />
                </button>
              ) : (
                <span className="commit-hash" title={lastCommit.hash}>{lastCommit.short_hash}</span>
              )}
              <span className="commit-message">{lastCommit.message}</span>
            </div>
            <div className="commit-info-meta">
              <span className="commit-author">{lastCommit.author}</span>
              <span className="commit-date">{lastCommit.date}</span>
            </div>
          </div>
        )}

        {commitListTotal > 0 && (
          <button
            className="modal-trigger-btn"
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
            <List size={16} />
            查看提交记录 ({commitListTotal})
          </button>
        )}

        {branchProjectType === "maven" && (
          <div className="form-group">
            <label>Spring Profile</label>
            <SearchableDropdown
              value={springProfile}
              options={springProfiles}
              onChange={onSpringProfileChange}
              placeholder={isLoadingProfiles ? "扫描中..." : springProfiles.length === 0 ? "未检测到 profile 配置文件" : "选择 profile..."}
              disabled={isLoadingProfiles}
              loading={isLoadingProfiles}
            />
            <p className="template-hint">
              {springProfile
                ? `将执行: mvn clean package -DskipTests -Dspring.profiles.active=${springProfile}`
                : springProfiles.length > 0
                  ? `检测到 ${springProfiles.length} 个 profile: ${springProfiles.join(", ")}`
                  : "留空则不添加 -Dspring.profiles.active 参数"}
            </p>
          </div>
        )}

        <div className="branch-command-preview">
          固定命令：
          <code>{branchProjectType === "maven"
            ? `mvn clean package -DskipTests${springProfile.trim() ? ` -Dspring.profiles.active=${springProfile.trim()}` : ""}`
            : `npm install && npm run ${selectedBuildScript || "build"}`}</code>
          {branchProjectType === "npm" && packageWithBackend && (
            <>
              <br />
              <span style={{ marginLeft: "2.5em" }}>+</span>{" "}
              <code>mvn clean package -DskipTests</code>
              {" "}<span style={{ color: "var(--muted)", fontSize: "0.8em" }}>(仓库根目录)</span>
            </>
          )}
        </div>

        {(branchProjectType === "maven" || branchProjectType === "npm") && (
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoPushImage}
                onChange={(e) => onAutoPushImageChange(e.target.checked)}
              />
              <span className="checkbox-toggle"></span>
              <span>打包后联动推送镜像到 Harbor</span>
            </label>
            <p className="template-hint">
              {autoPushImage
                ? branchProjectType === "npm" && !packageWithBackend
                  ? "打包成功后将构建前端 nginx 镜像并推送"
                  : "打包成功后将自动构建并推送镜像"
                : "勾选后打包成功会自动推送镜像"}
            </p>
          </div>
        )}

        {(branchProjectType === "maven" || branchProjectType === "npm") && (
          <div className="advanced-settings">
            <div
              className="advanced-settings-header"
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
            >
              <span>{showAdvancedSettings ? '▼' : '▶'}</span>
              <span>高级设置</span>
              <span className="template-hint" style={{ marginLeft: '8px' }}>可选：自定义镜像名称和标签</span>
              {branchHasDockerfile && (
                <span className="dockerfile-badge" title="检测到项目根目录有 Dockerfile，将使用自定义 Dockerfile 构建">
                  <FileText size={12} /> 自定义 Dockerfile
                </span>
              )}
            </div>
            {showAdvancedSettings && (
              <>
                <div className="form-group">
                  <label>镜像名称</label>
                  <input
                    type="text"
                    value={imageName}
                    onChange={(e) => setImageName(e.target.value)}
                    placeholder={branchProjectType === "npm" ? "例如: my-frontend（小写）" : "例如: sdk（小写，不含项目名）"}
                  />
                  <p className="template-hint">留空则自动推断；Harbor 项目名在配置中填写，推送时自动拼接</p>
                </div>
                <div className="form-group">
                  <label>JAR 暴露端口</label>
                  <input
                    type="text"
                    value={exposePort}
                    onChange={(e) => setExposePort(e.target.value)}
                    placeholder={config.expose_port || "例如: 8181"}
                  />
                  <p className="template-hint">留空则使用配置中的默认端口 {config.expose_port || "8181"}</p>
                </div>
                <div className="form-group">
                  <label>镜像标签</label>
                  <input
                    type="text"
                    value={imageTag}
                    onChange={(e) => setImageTag(e.target.value)}
                    placeholder="留空自动生成"
                  />
                  <p className="template-hint">留空则自动生成 分支名-v.YY.MM.DD.HH.MM</p>
                </div>
              </>
            )}
          </div>
        )}

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.remember_branch_settings}
              onChange={(e) => onRememberSettingsChange(e.target.checked)}
            />
            <span className="checkbox-toggle"></span>
            <span>记住本次配置，下次自动带出</span>
          </label>
        </div>
      </div>

      <button
        className="build-btn"
        onClick={onPackageFromBranch}
        disabled={isBuilding || !repoPath || !branchName.trim()}
      >
        {isBuilding ? (
          <>
            <Loader2 size={18} className="spin" /> 分支打包中...
          </>
        ) : (
          <>
            <GitBranch size={18} /> 从指定分支打包
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

      {artifactPath && (
        <div className="path-links">
          {branchFullImage && (
            <div className="path-link-item image-url-row">
              <span className="path-link-label">🐳 完整镜像:</span>
              <span className="image-url-value">
                {branchFullImage.split('\n').map((line, i) => (
                  <span key={i} style={{ display: 'block' }} title={line}>{line}</span>
                ))}
              </span>
              <button
                className={`copy-btn ${copied ? "copied" : ""}`}
                onClick={() => onCopyImage(branchFullImage.replace(/\n/g, '  '))}
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
          )}
          <div className="path-link-item">
            <span className="path-link-label"><FileText size={14} /> 产物目录:</span>
            <button
              type="button"
              className="path-link-btn"
              onClick={() => onOpenDirectory(artifactPath)}
            >
              {artifactPath}
            </button>
          </div>
          {backendArtifactPath && (
            <div className="path-link-item">
              <span className="path-link-label"><FileText size={14} /> 后端产物:</span>
              <button
                type="button"
                className="path-link-btn"
                onClick={() => onOpenDirectory(backendArtifactPath)}
              >
                {backendArtifactPath}
              </button>
            </div>
          )}
          {worktreePath && (
            <div className="path-link-item">
              <span className="path-link-label"><FolderOpen size={14} /> 输出目录:</span>
              <button
                type="button"
                className="path-link-btn"
                onClick={() => onOpenDirectory(worktreePath)}
              >
                {worktreePath}
              </button>
            </div>
          )}
          {customDockerfile && (
            <div className="path-link-item dockerfile-indicator">
              <span className="path-link-label">
                <FileText size={14} /> 使用项目 Dockerfile:
              </span>
              <button
                type="button"
                className="path-link-btn"
                onClick={() => onOpenDirectory(customDockerfile)}
              >
                {customDockerfile}
              </button>
            </div>
          )}
        </div>
      )}

      {isBuilding && (
        <button className="cancel-btn" onClick={onCancelBuild}>
          <XCircle size={16} /> 取消构建
        </button>
      )}

      {log && (
        <div className="log-section">
          <button
            type="button"
            className="log-toggle-btn"
            onClick={() => setShowBuildLog(!showBuildLog)}
            title={showBuildLog ? "隐藏构建日志" : "展开构建日志"}
          >
            {showBuildLog ? <EyeOff size={14} /> : <Eye size={14} />}
            {showBuildLog ? "隐藏构建日志" : "展开构建日志"}
          </button>
          {showBuildLog && (
            <div className={`log-panel ${log.includes("✅") ? "success" : ""}`}>
              {renderLog(log)}
            </div>
          )}
        </div>
      )}

      {/* 提交记录弹窗 */}
      {showCommitListModal && (
        <div className="commit-modal-overlay" onClick={() => {
          setShowCommitListModal(false);
          setCommitAuthorFilter("");
          setCommitMessageFilter("");
        }}>
          <div className="commit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="commit-modal-header">
              <h3>提交记录</h3>
              <button className="commit-modal-close" onClick={() => {
                setShowCommitListModal(false);
                setCommitAuthorFilter("");
                setCommitMessageFilter("");
              }}>✕</button>
            </div>
            <div className="commit-search-bar">
              <div className="commit-search-input-wrapper">
                <Search size={15} className="commit-search-icon" />
                <input
                  type="text"
                  className="commit-search-input"
                  placeholder="搜索提交信息..."
                  value={commitMessageFilter}
                  onChange={(e) => setCommitMessageFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter);
                    }
                  }}
                />
              </div>
              <div className="commit-author-select-wrapper">
                <User size={15} className="commit-author-icon" />
                <select
                  className="commit-author-select"
                  value={commitAuthorFilter}
                  onChange={(e) => {
                    setCommitAuthorFilter(e.target.value);
                    loadCommitList(repoPath, branchName, 1, e.target.value, commitMessageFilter);
                  }}
                >
                  <option value="">全部作者</option>
                  {commitAuthors.map((author) => (
                    <option key={author.name} value={author.name}>
                      {author.name} ({author.count})
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="commit-search-btn"
                onClick={() => loadCommitList(repoPath, branchName, 1, commitAuthorFilter, commitMessageFilter)}
              >
                搜索
              </button>
              {(commitAuthorFilter || commitMessageFilter) && (
                <button
                  className="commit-search-clear"
                  onClick={() => {
                    setCommitAuthorFilter("");
                    setCommitMessageFilter("");
                    loadCommitList(repoPath, branchName, 1, "", "");
                  }}
                >
                  清除
                </button>
              )}
            </div>
            {isLoadingCommitList ? (
              <div className="modal-loading">加载中...</div>
            ) : commitList.length === 0 ? (
              <div className="modal-empty">暂无提交记录</div>
            ) : (
              <div className="modal-list-wrapper">
                <div className="modal-list">
                  {commitList.map((commit) => (
                    <div key={commit.hash} className="modal-list-item">
                      <div className="modal-list-item-main">
                        {commit.url ? (
                          <button
                            className="commit-hash commit-link"
                            title={`在浏览器中打开: ${commit.hash}`}
                            onClick={() => openUrl(commit.url!)}
                          >
                            {commit.short_hash}
                            <ExternalLink size={10} />
                          </button>
                        ) : (
                          <span className="commit-hash" title={commit.hash}>{commit.short_hash}</span>
                        )}
                        <span className="commit-message">{commit.message}</span>
                      </div>
                      <div className="modal-list-item-meta">
                        <span className="commit-author">{commit.author}</span>
                        <span className="commit-date">{commit.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {commitListTotal > 0 && (
              <div className="modal-pagination">
                <button
                  className="pagination-btn"
                  disabled={commitListPage <= 1 || isLoadingCommitList}
                  onClick={() => loadCommitList(repoPath, branchName, commitListPage - 1, commitAuthorFilter, commitMessageFilter)}
                >
                  上一页
                </button>
                <span className="modal-pagination-info">
                  {/* ponytail: 总页数 = 总记录 / 后端 page_size */}
                  第 {commitListPage} / {Math.ceil(commitListTotal / commitListPageSize)} 页
                </span>
                <button
                  className="pagination-btn"
                  disabled={isLoadingCommitList}
                  onClick={() => loadCommitList(repoPath, branchName, commitListPage + 1, commitAuthorFilter, commitMessageFilter)}
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
