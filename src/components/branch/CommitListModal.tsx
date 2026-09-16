import {
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ExternalLink, Loader2, Search, User } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AuthorInfo, CommitInfo } from "../../types";
import { commitHashButtonStyles } from "../../theme/panelStyles";
import "../Modal.css";

export interface CommitListModalProps {
  opened: boolean;
  repoPath: string;
  branchName: string;
  commitList: CommitInfo[];
  commitListTotal: number;
  commitAuthors: AuthorInfo[];
  isLoadingCommitList: boolean;
  commitListPage: number;
  commitListPageSize: number;
  commitAuthorFilter: string;
  commitMessageFilter: string;
  setShowCommitListModal: (show: boolean) => void;
  setCommitAuthorFilter: (filter: string) => void;
  setCommitMessageFilter: (filter: string) => void;
  loadCommitList: (
    repoPath: string,
    branch: string,
    page: number,
    authorFilter?: string,
    messageFilter?: string,
  ) => void;
}

export function closeCommitModal(
  setShowCommitListModal: (show: boolean) => void,
  setCommitAuthorFilter: (filter: string) => void,
  setCommitMessageFilter: (filter: string) => void,
) {
  setShowCommitListModal(false);
  setCommitAuthorFilter("");
  setCommitMessageFilter("");
}

/** 打开提交列表：始终按当前筛选重载列表/作者（关闭会清空 filter，不能只在 list 为空时加载）。 */
export function openCommitListModal(opts: {
  setShowCommitListModal: (show: boolean) => void;
  repoPath: string;
  branchName: string;
  commitAuthorFilter: string;
  commitMessageFilter: string;
  loadCommitList: CommitListModalProps["loadCommitList"];
  loadCommitAuthors: (repoPath: string, branch: string) => void;
}) {
  opts.setShowCommitListModal(true);
  opts.loadCommitList(
    opts.repoPath,
    opts.branchName,
    1,
    opts.commitAuthorFilter,
    opts.commitMessageFilter,
  );
  opts.loadCommitAuthors(opts.repoPath, opts.branchName);
}

export function CommitListModal({
  opened,
  repoPath,
  branchName,
  commitList,
  commitListTotal,
  commitAuthors,
  isLoadingCommitList,
  commitListPage,
  commitListPageSize,
  commitAuthorFilter,
  commitMessageFilter,
  setShowCommitListModal,
  setCommitAuthorFilter,
  setCommitMessageFilter,
  loadCommitList,
}: CommitListModalProps) {
  const authorSelectData = [
    { value: "", label: "全部作者" },
    ...commitAuthors.map((author) => ({
      value: author.name,
      label: `${author.name} (${author.count})`,
    })),
  ];

  const handleClose = () => {
    closeCommitModal(setShowCommitListModal, setCommitAuthorFilter, setCommitMessageFilter);
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
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
            comboboxProps={{ withinPortal: true }}
          />
          <Button
            variant="default"
            leftSection={<Search size={14} />}
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
  );
}
