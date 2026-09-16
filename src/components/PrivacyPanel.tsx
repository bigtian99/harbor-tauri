import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Copy, Download, ExternalLink, FileUp, Loader2 } from "lucide-react";
import { usePrivacyPanel } from "../hooks/usePrivacyPanel";
import { PanelPageHeader } from "./PanelPageHeader";
import { PrivacyHistoryTable } from "./privacy/PrivacyHistoryTable";
import "../styles/privacy.css";
import "../styles/ops-panel.css";

export type {
  PrivacyUploadRecord,
  PrivacyUploadResult,
} from "./privacy/types";

export function PrivacyPanel() {
  const {
    history,
    lastResults,
    selectedIds,
    isUploading,
    isLoadingHistory,
    targetUrl,
    setTargetUrl,
    parsed,
    parseError,
    ftpPreviewUrl,
    isPreviewing,
    isDownloading,
    isOverwrite,
    allSelected,
    refreshParse,
    handlePreview,
    handleDownload,
    handleUpload,
    copyUrl,
    openPrivacyUrl,
    toggleOne,
    toggleAll,
    handleDeleteSelected,
    handleClear,
  } = usePrivacyPanel();

  return (
    <Stack gap="md" className="privacy-panel">
      <PanelPageHeader
        eyebrow="TEMPLATE → PREVIEW → FTP"
        title="隐私协议"
        sub="不填目标地址为新增；填写访问 URL 可解析目录、预览后覆盖该目录 index.html。历史仅保存在本机。"
      />

      <Paper
        p="md"
        radius="md"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border-strong)",
        }}
      >
        <Stack gap="sm">
          <TextInput
            label="覆盖目标 URL（可空=新增）"
            placeholder="http://common.tiankongshuyu.cn/1785467601raven/"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.currentTarget.value)}
            onBlur={() => {
              void refreshParse();
            }}
          />
          <Group gap="sm" align="center">
            <Badge color={isOverwrite ? "orange" : "blue"} variant="light">
              {isOverwrite ? "覆盖" : "新增"}
            </Badge>
            {parsed && (
              <Text size="sm" c="var(--color-text-muted)" style={{ wordBreak: "break-all" }}>
                目录：{parsed.remote_dir}
              </Text>
            )}
            {parseError && (
              <Text size="sm" c="red.4">
                {parseError}
              </Text>
            )}
          </Group>
          <Group gap="sm" align="center">
            <Button
              leftSection={isUploading ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
              onClick={handleUpload}
              loading={isUploading}
              variant="filled"
              color={isOverwrite ? "orange" : "blue"}
            >
              {isOverwrite ? "覆盖上传" : "新增上传"}
            </Button>
            <Button
              variant="default"
              leftSection={
                isPreviewing ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />
              }
              disabled={!isOverwrite || isPreviewing || isDownloading}
              loading={isPreviewing}
              onClick={handlePreview}
              className="privacy-btn-secondary"
            >
              预览 FTP
            </Button>
            <Button
              variant="default"
              leftSection={
                isDownloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />
              }
              disabled={!isOverwrite || isDownloading || isPreviewing}
              loading={isDownloading}
              onClick={handleDownload}
              className="privacy-btn-secondary"
            >
              下载
            </Button>
            <Text size="xs" c="var(--color-text-muted)" maw={360}>
              {isOverwrite
                ? "预览/下载均从 FTP 拉取 index.html；覆盖仅支持单个 HTML"
                : "新增支持多选；目录 common…/时间戳英文词/"}
            </Text>
          </Group>
          {ftpPreviewUrl && (
            <Stack gap="xs">
              <Text size="sm" c="var(--color-text-muted)">
                FTP 本地预览（非公网链接）
              </Text>
              <iframe
                title="privacy-ftp-preview"
                src={ftpPreviewUrl}
                style={{
                  width: "100%",
                  height: 360,
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: 8,
                  background: "var(--color-preview-paper)",
                }}
              />
            </Stack>
          )}
        </Stack>
      </Paper>

      {lastResults.length > 0 && (
        <Paper
          p="md"
          radius="md"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border-strong)",
          }}
        >
          <Text fw={600} mb="sm" c="var(--color-text)">
            本次结果
          </Text>
          <Table striped highlightOnHover withTableBorder={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>文件</Table.Th>
                <Table.Th>状态</Table.Th>
                <Table.Th>访问地址</Table.Th>
                <Table.Th style={{ width: 64 }}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lastResults.map((r, i) => (
                <Table.Tr key={`${r.source_name}-${i}`}>
                  <Table.Td>
                    <Text size="sm" c="var(--color-text)">
                      {r.source_name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={r.status === "success" ? "teal" : "red"} variant="light">
                      {r.status === "success" ? "成功" : "失败"}
                    </Badge>
                    {r.status !== "success" && (
                      <Text size="xs" c="red.4" mt={4}>
                        {r.message}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.url ? (
                      <Anchor
                        size="sm"
                        c="var(--color-primary-hover)"
                        style={{ wordBreak: "break-all" }}
                        onClick={() => openPrivacyUrl(r.url)}
                      >
                        {r.url}
                      </Anchor>
                    ) : (
                      <Text size="sm" c="var(--color-text-muted)">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {r.url ? (
                      <Tooltip label="复制">
                        <ActionIcon variant="subtle" color="gray" onClick={() => copyUrl(r.url)}>
                          <Copy size={14} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <PrivacyHistoryTable
        history={history}
        selectedIds={selectedIds}
        isLoadingHistory={isLoadingHistory}
        allSelected={allSelected}
        onToggleOne={toggleOne}
        onToggleAll={toggleAll}
        onDeleteSelected={handleDeleteSelected}
        onClear={handleClear}
        onOpenUrl={openPrivacyUrl}
        onCopyUrl={copyUrl}
      />
    </Stack>
  );
}
