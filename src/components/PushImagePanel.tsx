import { useMemo, useState } from "react";
import {
  Rocket, Loader2, Eye, EyeOff, XCircle, CheckCircle, Copy, RefreshCw, Box, Search, Trash2, Lock, Tag, Package, X, Play, ChevronDown,
} from "lucide-react";
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { LocalImageInfo } from "../hooks/useUploadPush";

interface PushImagePanelProps {
  localImage: string;
  localImageOptions: LocalImageInfo[];
  isLoadingImages: boolean;
  imageName: string;
  imageTag: string;
  isBuilding: boolean;
  showImageConfig: boolean;
  showBuildLog: boolean;
  progress: number;
  progressMessage: string;
  log: string;
  fullImage: string;
  copied: string | null;
  onCopyImage: (imageUrl: string) => void;
  onPushImage: () => void;
  onCancelBuild: () => void;
  onRefreshImages: () => void;
  onRemoveImage: (image: string) => void | Promise<void>;
  setLocalImage: (value: string) => void;
  setImageName: (value: string) => void;
  setImageTag: (value: string) => void;
  setShowImageConfig: (show: boolean) => void;
  setShowBuildLog: (show: boolean) => void;
  renderLog: (text: string) => React.ReactNode;
}

/** 展示用：拆出仓库路径与 tag（不裁成短名） */
function parseImageDisplay(ref: string): { repo: string; tag: string } {
  const t = ref.trim();
  if (!t) return { repo: "", tag: "" };
  if (t.startsWith("sha256:")) {
    return { repo: `${t.slice(0, 19)}…`, tag: "digest" };
  }
  const lastColon = t.lastIndexOf(":");
  const lastSlash = t.lastIndexOf("/");
  if (lastColon > lastSlash && lastColon > 0) {
    return { repo: t.slice(0, lastColon), tag: t.slice(lastColon + 1) || "latest" };
  }
  return { repo: t, tag: "latest" };
}

/** 按名称生成稳定色相，卡片一眼可区分 */
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

const paperStyles = {
  root: {
    background: "var(--color-bg-card)",
    border: "1px solid var(--color-border)",
  },
} as const;

export function PushImagePanel({
  localImage, localImageOptions, isLoadingImages,
  imageName, imageTag,
  isBuilding, showImageConfig, showBuildLog,
  progress, progressMessage, log,
  fullImage, copied, onCopyImage,
  onPushImage, onCancelBuild, onRefreshImages, onRemoveImage,
  setLocalImage, setImageName, setImageTag,
  setShowImageConfig, setShowBuildLog,
  renderLog,
}: PushImagePanelProps) {
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const filteredImages = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? localImageOptions
      : localImageOptions.filter((img) => img.reference.toLowerCase().includes(q));
    // 可推送 → 仅停止容器引用 → 运行中；选镜像时更直观
    const rank = (img: LocalImageInfo) => (img.running ? 2 : img.in_use ? 1 : 0);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [localImageOptions, query]);

  const readyCount = useMemo(
    () => filteredImages.filter((img) => !img.in_use).length,
    [filteredImages],
  );
  const runningCount = useMemo(
    () => filteredImages.filter((img) => img.running).length,
    [filteredImages],
  );
  const referencedCount = useMemo(
    () => filteredImages.filter((img) => img.in_use && !img.running).length,
    [filteredImages],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
  };

  const commitTypedReference = () => {
    const v = query.trim();
    if (!v) return;
    setLocalImage(v);
    setQuery("");
  };

  const handleSelectCard = (img: string) => {
    setLocalImage(img);
    setQuery("");
  };

  const clearSelection = () => {
    setLocalImage("");
  };

  const handleRemove = async (e: React.MouseEvent, img: LocalImageInfo) => {
    e.stopPropagation();
    e.preventDefault();
    if (img.in_use) return;
    setRemoving(img.reference);
    try {
      await onRemoveImage(img.reference);
    } finally {
      setRemoving(null);
    }
  };

  const searchPlaceholder = isLoadingImages
    ? "加载中..."
    : localImage
      ? "搜索过滤，或输入新引用后回车"
      : localImageOptions.length === 0
        ? "输入镜像引用后回车…"
        : "搜索本地镜像，或手输引用后回车";

  return (
    <Stack gap="md" className="upload-panel push-image-panel">
      {/* 约束列：避免大窗宽下输入/按钮被拉成超宽一条 */}
      <Stack gap="md" className="push-image-column">
        <Group justify="space-between" align="center" wrap="nowrap" gap="sm" className="image-picker-header">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text component="h2" className="image-picker-header-title">
              推送镜像
            </Text>
            {!isLoadingImages && localImageOptions.length > 0 && (
              <Group gap={5} aria-label="镜像统计" wrap="nowrap">
                <Badge
                  color="teal"
                  variant="light"
                  size="xs"
                  leftSection={<Package size={10} />}
                  title="可删除 / 空闲"
                >
                  {readyCount}
                </Badge>
                {referencedCount > 0 && (
                  <Badge
                    color="yellow"
                    variant="light"
                    size="xs"
                    leftSection={<Lock size={10} />}
                    title="有已停止容器引用，不可删除"
                  >
                    {referencedCount}
                  </Badge>
                )}
                {runningCount > 0 && (
                  <Badge
                    color="green"
                    variant="light"
                    size="xs"
                    leftSection={<Play size={10} />}
                    title="有运行中容器"
                  >
                    {runningCount}
                  </Badge>
                )}
                <Badge variant="outline" color="blue" size="xs" title="docker images 数量">
                  {query.trim()
                    ? `${filteredImages.length}/${localImageOptions.length}`
                    : localImageOptions.length}
                </Badge>
              </Group>
            )}
          </Group>
          <ActionIcon
            type="button"
            variant="subtle"
            color="gray"
            size="sm"
            className="image-picker-refresh"
            onClick={onRefreshImages}
            disabled={isLoadingImages}
            title={isLoadingImages ? "加载中" : "刷新本地镜像"}
            aria-label={isLoadingImages ? "加载中" : "刷新本地镜像"}
          >
            {isLoadingImages ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </ActionIcon>
        </Group>

        <Stack gap="xs" className="image-picker">
          <TextInput
            size="sm"
            leftSection={<Search size={14} />}
            rightSection={
              query.trim() ? (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  title="清空搜索"
                  aria-label="清空搜索"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </ActionIcon>
              ) : null
            }
            value={query}
            onChange={(e) => handleQueryChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTypedReference();
              }
            }}
            placeholder={searchPlaceholder}
            disabled={isLoadingImages}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="image-picker-search-input"
          />

          <div className="image-picker-shell">
            {isLoadingImages ? (
              <div className="image-card-empty">
                <span className="image-card-empty-icon" aria-hidden>
                  <Loader2 size={20} className="spin" />
                </span>
                <div className="image-card-empty-copy">
                  <strong>读取本地 Docker</strong>
                  <span>正在拉取镜像列表…</span>
                </div>
              </div>
            ) : filteredImages.length > 0 ? (
              <div className="image-card-grid" role="listbox" aria-label="本地镜像列表">
                {filteredImages.map((img) => {
                  const { repo, tag } = parseImageDisplay(img.reference);
                  const selected = img.reference === localImage;
                  const isRemoving = removing === img.reference;
                  const shortName = repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
                  const repoPath = repo.includes("/") ? repo.slice(0, repo.lastIndexOf("/")) : "";
                  const initial = (shortName || repo || "?").charAt(0).toUpperCase();
                  const hue = nameHue(shortName || repo);
                  return (
                    <Paper
                      key={img.reference}
                      component="div"
                      role="option"
                      aria-selected={selected}
                      className={[
                        "image-card",
                        selected ? "selected" : "",
                        img.running ? "running" : img.in_use ? "in-use" : "",
                        isRemoving ? "removing" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ ["--card-hue" as string]: String(hue) }}
                      onClick={() => !isRemoving && handleSelectCard(img.reference)}
                      title={
                        img.running
                          ? `${img.reference}\n（有运行中容器，不可删除）`
                          : img.in_use
                            ? `${img.reference}\n（有已停止容器引用，不可删除）`
                            : img.reference
                      }
                    >
                      <div className="image-card-main">
                        <span className="image-card-avatar" aria-hidden>
                          <span className="image-card-avatar-letter">{initial}</span>
                          <Box size={12} className="image-card-avatar-glyph" />
                        </span>
                        <div className="image-card-text">
                          {repoPath ? (
                            <span className="image-card-path">{repoPath}/</span>
                          ) : (
                            <span className="image-card-path image-card-path-local">local</span>
                          )}
                          <span className="image-card-name">{shortName || repo}</span>
                          <span className="image-card-meta">
                            <span className="image-card-tag">
                              <Tag size={10} aria-hidden />
                              {tag}
                            </span>
                            {img.running ? (
                              <Badge
                                component="span"
                                className="image-card-badge-running"
                                size="xs"
                                color="green"
                                variant="light"
                                leftSection={<Play size={10} />}
                                title="有运行中容器正在使用此镜像"
                              >
                                运行中
                              </Badge>
                            ) : img.in_use ? (
                              <Badge
                                component="span"
                                className="image-card-badge-in-use"
                                size="xs"
                                color="yellow"
                                variant="light"
                                leftSection={<Lock size={10} />}
                                title="有已停止容器引用此镜像"
                              >
                                有引用
                              </Badge>
                            ) : (
                              <Badge
                                component="span"
                                className="image-card-badge-ready"
                                size="xs"
                                color="teal"
                                variant="light"
                              >
                                可推送
                              </Badge>
                            )}
                          </span>
                        </div>
                        <div className="image-card-actions">
                          {selected && !isRemoving && (
                            <span className="image-card-check" aria-hidden>
                              <CheckCircle size={16} />
                            </span>
                          )}
                          {!img.in_use && (
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              className="image-card-delete"
                              title={`删除 ${img.reference}`}
                              aria-label={`删除镜像 ${img.reference}`}
                              disabled={isRemoving || isBuilding}
                              onClick={(e) => void handleRemove(e, img)}
                            >
                              {isRemoving ? (
                                <Loader2 size={13} className="spin" />
                              ) : (
                                <Trash2 size={13} />
                              )}
                            </ActionIcon>
                          )}
                        </div>
                      </div>
                    </Paper>
                  );
                })}
              </div>
            ) : localImageOptions.length === 0 ? (
              <div className="image-card-empty">
                <span className="image-card-empty-icon" aria-hidden>
                  <Box size={22} />
                </span>
                <div className="image-card-empty-copy">
                  <strong>暂无本地镜像</strong>
                  <span>先构建镜像，或上方输入引用后回车</span>
                </div>
              </div>
            ) : (
              <div className="image-card-empty">
                <span className="image-card-empty-icon" aria-hidden>
                  <Search size={22} />
                </span>
                <div className="image-card-empty-copy">
                  <strong>无匹配结果</strong>
                  <span>调整关键词，或回车用手输引用</span>
                </div>
              </div>
            )}
          </div>

          {localImage ? (
            <Paper
              className="image-selected-bar"
              p="xs"
              px="sm"
              radius="md"
              withBorder
              styles={paperStyles}
              title={localImage}
            >
              <Group gap="sm" wrap="nowrap">
                <span className="image-selected-icon" aria-hidden>
                  <CheckCircle size={14} />
                </span>
                <Stack gap={1} flex={1} className="image-selected-body">
                  <Text size="xs" c="dimmed" className="image-selected-label">当前选中</Text>
                  <Text component="code" size="xs" className="image-selected-ref">{localImage}</Text>
                </Stack>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="image-selected-clear"
                  title="清除选中"
                  aria-label="清除选中镜像"
                  onClick={clearSelection}
                >
                  <X size={14} />
                </ActionIcon>
              </Group>
            </Paper>
          ) : (
            <Text size="xs" c="dimmed" className="image-picker-hint">
              点选卡片推送 · 搜索只过滤 · 手输引用请回车确认
            </Text>
          )}
        </Stack>

        <Paper withBorder p="md" radius="md" className="image-config-panel" styles={paperStyles}>
          <UnstyledButton
            onClick={() => setShowImageConfig(!showImageConfig)}
            w="100%"
            className="image-config-toggle"
          >
            <Group gap="sm" wrap="nowrap" justify="space-between">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <Text size="xs" tt="uppercase" fw={700} c="var(--color-text-muted)" style={{ letterSpacing: "0.06em" }}>
                  镜像配置
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  可选：自定义目标名称与标签
                </Text>
              </Group>
              <ChevronDown
                size={16}
                className={`image-config-chevron${showImageConfig ? " open" : ""}`}
                aria-hidden
              />
            </Group>
          </UnstyledButton>
          <Collapse expanded={showImageConfig}>
            <Stack gap="sm" mt="md" className="image-config-fields">
              <TextInput
                size="sm"
                label="目标镜像名称"
                value={imageName}
                onChange={(e) => setImageName(e.currentTarget.value)}
                placeholder="例如: my-app（不含 Harbor 项目名）"
              />
              <TextInput
                size="sm"
                label="目标镜像标签"
                value={imageTag}
                onChange={(e) => setImageTag(e.currentTarget.value)}
                placeholder="留空则自动生成 v.YY.MM.DD.HH.MM"
              />
            </Stack>
          </Collapse>
        </Paper>

        <Button
          variant="filled"
          color="cyan"
          size="md"
          fullWidth
          className="push-image-cta"
          onClick={onPushImage}
          disabled={isBuilding || !localImage.trim()}
          leftSection={
            isBuilding
              ? <Loader2 size={18} className="spin" />
              : <Rocket size={18} />
          }
        >
          {isBuilding ? "推送中..." : "推送到 Harbor"}
        </Button>

        {isBuilding && (
          <Paper p="sm" withBorder radius="md" className="push-progress-panel" styles={paperStyles}>
            <Group justify="space-between" mb={6}>
              <Text size="xs" c="var(--color-text-muted)">{progressMessage}</Text>
              <Text size="xs" fw={600} c="var(--color-text-muted)">{progress}%</Text>
            </Group>
            <Progress value={progress} />
          </Paper>
        )}

        {isBuilding && (
          <Button
            variant="default"
            color="gray"
            size="sm"
            onClick={onCancelBuild}
            leftSection={<XCircle size={16} />}
          >
            取消推送
          </Button>
        )}

        {fullImage && (
          <div
            className="path-links"
            style={{ marginTop: 4, border: "none", background: "transparent", padding: 0 }}
          >
            <div className={`path-link-item image-url-row image-url-row--primary ${copied === fullImage ? "copied" : ""}`}>
              <div className="image-url-row-head">
                <span className="image-url-title">
                  <Package size={14} className="image-url-title-icon" />
                  完整镜像
                </span>
                <Button
                  size="compact-sm"
                  variant={copied === fullImage ? "filled" : "light"}
                  color={copied === fullImage ? "teal" : "cyan"}
                  className={`copy-btn ${copied === fullImage ? "copied" : ""}`}
                  onClick={() => onCopyImage(fullImage)}
                  title="复制镜像地址"
                  leftSection={
                    copied === fullImage
                      ? <CheckCircle size={14} />
                      : <Copy size={14} />
                  }
                >
                  {copied === fullImage ? "已复制" : "复制"}
                </Button>
              </div>
              <span className="image-url-value">
                <span style={{ display: "block" }} title={fullImage}>{fullImage}</span>
              </span>
            </div>
          </div>
        )}

        {log && (
          <Stack gap="xs" className="log-section push-log-section">
            <Button
              type="button"
              variant="light"
              color="cyan"
              size="sm"
              className="log-toggle-btn"
              onClick={() => setShowBuildLog(!showBuildLog)}
              title={showBuildLog ? "隐藏推送日志" : "展开推送日志"}
              leftSection={showBuildLog ? <EyeOff size={15} /> : <Eye size={15} />}
            >
              {showBuildLog ? "隐藏推送日志" : "展开推送日志"}
            </Button>
            <Collapse expanded={showBuildLog}>
              <Paper
                className={`log-panel ${log.includes("✅") ? "success" : ""}`}
                p="sm"
                radius="md"
              >
                {renderLog(log)}
              </Paper>
            </Collapse>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
