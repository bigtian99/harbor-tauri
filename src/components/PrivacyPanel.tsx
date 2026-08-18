import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notifications } from "@mantine/notifications";
import {
  Anchor,
  Button,
  Checkbox,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Badge,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { Copy, Download, ExternalLink, FileUp, Loader2, Shield, Trash2 } from "lucide-react";
import { isTauriRuntime } from "../types";
import { useConfirmDialog } from "../hooks/useConfirmDialog";

export interface PrivacyUploadRecord {
  id: string;
  source_name: string;
  remote_dir: string;
  url: string;
  uploaded_at: string;
}

export interface PrivacyUploadResult {
  id: string;
  source_name: string;
  remote_dir: string;
  url: string;
  status: string;
  message: string;
  uploaded_at: string;
}

interface PrivacyTarget {
  remote_dir: string;
  preview_url: string;
}

export function PrivacyPanel() {
  const { confirm } = useConfirmDialog();
  const [history, setHistory] = useState<PrivacyUploadRecord[]>([]);
  const [lastResults, setLastResults] = useState<PrivacyUploadResult[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [parsed, setParsed] = useState<PrivacyTarget | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [ftpPreviewUrl, setFtpPreviewUrl] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const isOverwrite = targetUrl.trim().length > 0;

  const loadHistory = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setIsLoadingHistory(true);
    try {
      const rows = await invoke<PrivacyUploadRecord[]>("list_privacy_uploads");
      setHistory(rows);
      setSelectedIds(new Set());
    } catch (e) {
      notifications.show({ title: "加载历史失败", message: String(e), color: "red" });
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const refreshParse = useCallback(async () => {
    const raw = targetUrl.trim();
    if (!raw) {
      setParsed(null);
      setParseError(null);
      return;
    }
    if (!isTauriRuntime()) return;
    try {
      const t = await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw });
      setParsed(t);
      setParseError(null);
    } catch (e) {
      setParsed(null);
      setParseError(String(e));
    }
  }, [targetUrl]);

  const handlePreview = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端操作", color: "yellow" });
      return;
    }
    const raw = targetUrl.trim();
    if (!raw) {
      notifications.show({ message: "请先填写覆盖目标 URL", color: "orange" });
      return;
    }
    setIsPreviewing(true);
    try {
      // 从 FTP 拉取远端 index.html，经本地预览服务展示（不是打开公网链接）
      const result = await invoke<{ preview_url: string; remote_dir: string }>(
        "preview_privacy_ftp",
        { targetUrl: raw },
      );
      setFtpPreviewUrl(result.preview_url);
      if (!parsed) {
        try {
          const t = await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw });
          setParsed(t);
          setParseError(null);
        } catch {
          /* 预览已成功，解析展示失败可忽略 */
        }
      }
      notifications.show({
        message: `已从 FTP 加载预览：${result.remote_dir}`,
        color: "teal",
        autoClose: 2000,
      });
    } catch (e) {
      setFtpPreviewUrl(null);
      notifications.show({ title: "FTP 预览失败", message: String(e), color: "red" });
    } finally {
      setIsPreviewing(false);
    }
  }, [targetUrl, parsed]);

  const handleDownload = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端操作", color: "yellow" });
      return;
    }
    const raw = targetUrl.trim();
    if (!raw) {
      notifications.show({ message: "请先填写覆盖目标 URL", color: "orange" });
      return;
    }

    let remoteLeaf = "index";
    try {
      const t = parsed ?? (await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw }));
      setParsed(t);
      setParseError(null);
      remoteLeaf = t.remote_dir.split("/").filter(Boolean).pop() || "index";
    } catch (e) {
      const msg = String(e);
      setParseError(msg);
      notifications.show({ title: "目标地址无效", message: msg, color: "red" });
      return;
    }

    const dest = await save({
      defaultPath: `${remoteLeaf}.html`,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!dest) return;

    setIsDownloading(true);
    try {
      const result = await invoke<{ local_path: string; remote_dir: string }>(
        "download_privacy_ftp",
        { targetUrl: raw, localPath: dest },
      );
      notifications.show({
        id: "privacy-ftp-download-done",
        title: "下载完成（点击打开所在目录）",
        message: result.local_path,
        color: "teal",
        autoClose: 8000,
        onClick: () => {
          void invoke("open_directory", { path: result.local_path }).catch((e) => {
            notifications.show({
              title: "打开目录失败",
              message: String(e),
              color: "red",
            });
          });
        },
        style: { cursor: "pointer" },
      });
    } catch (e) {
      notifications.show({ title: "FTP 下载失败", message: String(e), color: "red" });
    } finally {
      setIsDownloading(false);
    }
  }, [targetUrl, parsed]);

  const handleUpload = useCallback(async () => {
    if (!isTauriRuntime()) {
      notifications.show({ message: "请在桌面端操作", color: "yellow" });
      return;
    }
    const raw = targetUrl.trim();
    if (raw) {
      let target = parsed;
      if (!target) {
        try {
          target = await invoke<PrivacyTarget>("parse_privacy_target_url", { url: raw });
          setParsed(target);
          setParseError(null);
        } catch (e) {
          const msg = String(e);
          setParseError(msg);
          notifications.show({ title: "目标地址无效", message: msg, color: "red" });
          return;
        }
      }
      const ok = await confirm({
        title: "覆盖远端目录",
        message: "确认覆盖远端目录？此操作会替换该目录下的 index.html。",
        details: [target.remote_dir],
        variant: "danger",
        confirmLabel: "覆盖",
      });
      if (!ok) return;
    }

    const selected = await open({
      multiple: !raw,
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    if (raw && paths.length !== 1) {
      notifications.show({ message: "覆盖模式仅支持单个 HTML", color: "orange" });
      return;
    }

    setIsUploading(true);
    try {
      const results = await invoke<PrivacyUploadResult[]>("upload_privacy_html", {
        paths,
        targetUrl: raw ? raw : null,
      });
      setLastResults(results);
      const ok = results.filter((r) => r.status === "success").length;
      const fail = results.length - ok;
      notifications.show({
        message: `上传完成：成功 ${ok}，失败 ${fail}`,
        color: fail > 0 ? "orange" : "teal",
      });
      await loadHistory();
    } catch (e) {
      notifications.show({ title: "上传失败", message: String(e), color: "red" });
    } finally {
      setIsUploading(false);
    }
  }, [loadHistory, targetUrl, parsed]);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notifications.show({ message: "已复制链接", color: "teal", autoClose: 1500 });
    } catch {
      notifications.show({ message: "复制失败", color: "red" });
    }
  }, []);

  const openPrivacyUrl = useCallback(async (url: string) => {
    await copyUrl(url);
    try {
      await openUrl(url);
    } catch (e) {
      notifications.show({ title: "打开失败", message: String(e), color: "red" });
    }
  }, [copyUrl]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = history.length > 0 && selectedIds.size === history.length;

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(history.map((r) => r.id)));
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: "删除记录",
      message: `确认删除所选 ${selectedIds.size} 条本地记录？不会删除服务器文件。`,
      variant: "danger",
      confirmLabel: "删除",
    });
    if (!ok) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("delete_privacy_uploads", { ids: Array.from(selectedIds) });
      notifications.show({ message: "已删除所选记录", color: "teal" });
      await loadHistory();
    } catch (e) {
      notifications.show({ title: "删除失败", message: String(e), color: "red" });
    }
  };

  const handleClear = async () => {
    if (history.length === 0) return;
    const ok = await confirm({
      title: "清空记录",
      message: "确认清空全部本地上传记录？不会删除服务器文件。",
      variant: "danger",
      confirmLabel: "清空",
    });
    if (!ok) return;
    if (!isTauriRuntime()) return;
    try {
      await invoke("clear_privacy_uploads");
      notifications.show({ message: "已清空本地记录", color: "teal" });
      await loadHistory();
    } catch (e) {
      notifications.show({ title: "清空失败", message: String(e), color: "red" });
    }
  };

  return (
    <BoxPad>
      <Stack gap="lg">
        <Group gap="sm">
          <Shield size={20} color="#5eead4" />
          <Title order={3} c="gray.1">隐私协议</Title>
        </Group>
        <Text size="sm" c="dimmed">
          不填目标地址为新增；填写访问 URL 可解析目录、预览后覆盖该目录 index.html。历史仅保存在本机。
        </Text>

        <Paper p="md" radius="md" style={{ background: "#111827", border: "1px solid rgba(94,234,212,0.12)" }}>
          <Stack gap="md">
            <TextInput
              label="覆盖目标 URL（可空=新增）"
              placeholder="http://common.tiankongshuyu.cn/1785467601raven/"
              value={targetUrl}
              onChange={(e) => {
                setTargetUrl(e.currentTarget.value);
                setFtpPreviewUrl(null);
              }}
              onBlur={() => {
                void refreshParse();
              }}
            />
            <Group gap="sm" align="center">
              <Badge color={isOverwrite ? "orange" : "teal"} variant="light">
                {isOverwrite ? "覆盖" : "新增"}
              </Badge>
              {parsed && (
                <Text size="sm" c="dimmed" style={{ wordBreak: "break-all" }}>
                  目录：{parsed.remote_dir}
                </Text>
              )}
              {parseError && (
                <Text size="sm" c="red.4">
                  {parseError}
                </Text>
              )}
            </Group>
            <Group>
              <Button
                leftSection={isUploading ? <Loader2 size={16} className="spin" /> : <FileUp size={16} />}
                onClick={handleUpload}
                loading={isUploading}
                color={isOverwrite ? "orange.7" : "teal.7"}
              >
                {isOverwrite ? "覆盖上传" : "新增上传"}
              </Button>
              <Button
                variant="light"
                color="gray"
                leftSection={
                  isPreviewing ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />
                }
                disabled={!isOverwrite || isPreviewing || isDownloading}
                loading={isPreviewing}
                onClick={handlePreview}
              >
                预览 FTP
              </Button>
              <Button
                variant="light"
                color="teal"
                leftSection={
                  isDownloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />
                }
                disabled={!isOverwrite || isDownloading || isPreviewing}
                loading={isDownloading}
                onClick={handleDownload}
              >
                下载
              </Button>
              <Text size="sm" c="dimmed">
                {isOverwrite
                  ? "预览/下载均从 FTP 拉取 index.html；覆盖仅支持单个 HTML"
                  : "新增支持多选；目录 common…/时间戳英文词/"}
              </Text>
            </Group>
            {ftpPreviewUrl && (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  FTP 本地预览（非公网链接）
                </Text>
                <iframe
                  title="privacy-ftp-preview"
                  src={ftpPreviewUrl}
                  style={{
                    width: "100%",
                    height: 420,
                    border: "1px solid rgba(94,234,212,0.2)",
                    borderRadius: 8,
                    background: "#fff",
                  }}
                />
              </Stack>
            )}
          </Stack>
        </Paper>

        {lastResults.length > 0 && (
          <Paper p="md" radius="md" style={{ background: "#111827", border: "1px solid rgba(94,234,212,0.12)" }}>
            <Text fw={600} mb="sm" c="gray.2">本次结果</Text>
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
                    <Table.Td>{r.source_name}</Table.Td>
                    <Table.Td>
                      <Badge color={r.status === "success" ? "teal" : "red"} variant="light">
                        {r.status === "success" ? "成功" : "失败"}
                      </Badge>
                      {r.status !== "success" && (
                        <Text size="xs" c="red.4" mt={4}>{r.message}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {r.url ? (
                        <Anchor size="sm" c="teal.3" style={{ wordBreak: "break-all" }} onClick={() => openPrivacyUrl(r.url)}>
                          {r.url}
                        </Anchor>
                      ) : (
                        <Text size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {r.url ? (
                        <Tooltip label="复制">
                          <ActionIcon variant="subtle" color="teal" onClick={() => copyUrl(r.url)}>
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

        <Paper p="md" radius="md" style={{ background: "#111827", border: "1px solid rgba(94,234,212,0.12)" }}>
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Text fw={600} c="gray.2">上传记录</Text>
              {isLoadingHistory && <Loader2 size={14} className="spin" />}
              <Badge variant="light" color="gray" size="sm">{history.length}</Badge>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<Trash2 size={14} />}
                disabled={selectedIds.size === 0}
                onClick={handleDeleteSelected}
              >
                删除所选
              </Button>
              <Button size="xs" variant="subtle" color="gray" onClick={handleClear} disabled={history.length === 0}>
                清空
              </Button>
            </Group>
          </Group>

          {history.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" py="xl">暂无上传记录</Text>
          ) : (
            <Table striped highlightOnHover withTableBorder={false}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 40 }}>
                    <Checkbox checked={allSelected} indeterminate={selectedIds.size > 0 && !allSelected} onChange={toggleAll} />
                  </Table.Th>
                  <Table.Th>时间</Table.Th>
                  <Table.Th>文件名</Table.Th>
                  <Table.Th>访问地址</Table.Th>
                  <Table.Th style={{ width: 64 }}></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Checkbox checked={selectedIds.has(r.id)} onChange={() => toggleOne(r.id)} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{r.uploaded_at}</Text>
                    </Table.Td>
                    <Table.Td>{r.source_name}</Table.Td>
                    <Table.Td>
                      <Anchor size="sm" c="teal.3" style={{ wordBreak: "break-all" }} onClick={() => openPrivacyUrl(r.url)}>
                        {r.url}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="复制">
                        <ActionIcon variant="subtle" color="teal" onClick={() => copyUrl(r.url)}>
                          <Copy size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
      </Stack>
    </BoxPad>
  );
}

function BoxPad({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "32px 40px" }}>{children}</div>;
}
