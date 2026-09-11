import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Group, Modal, ScrollArea, Stack, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { FileText } from "lucide-react";
import type { MergeConflictDetail } from "../types";
import { isTauriRuntime } from "../types";
import type { KsBatchMergeRow } from "../utils/ksBatchMerge";
import { ConflictDetailModal } from "./merge/ConflictDetailModal";
import { parseChangedLines, parseConflictBlocks } from "./merge/utils";

interface KsBatchMergeConflictFilesModalProps {
  row: KsBatchMergeRow | null;
  sourceBranch: string;
  targetBranch: string;
  onClose: () => void;
}

/** 批量预检：点冲突行查看冲突文件列表，再点文件看左右对比 */
export function KsBatchMergeConflictFilesModal({
  row,
  sourceBranch,
  targetBranch,
  onClose,
}: KsBatchMergeConflictFilesModalProps) {
  const [conflictDetail, setConflictDetail] = useState<MergeConflictDetail | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const [activeConflictBlock, setActiveConflictBlock] = useState(-1);
  const targetLineRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const sourceLineRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    setConflictDetail(null);
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
  }, [row?.repoPath]);

  const conflictChangedLines = useMemo(
    () => (conflictDetail ? parseChangedLines(conflictDetail.diff) : { targetLines: new Set<number>(), sourceLines: new Set<number>() }),
    [conflictDetail],
  );
  const conflictBlocks = useMemo(
    () => (conflictDetail ? parseConflictBlocks(conflictDetail.diff) : []),
    [conflictDetail],
  );

  const loadConflictDiff = useCallback(async (filePath: string) => {
    if (!row || !isTauriRuntime()) return;
    setActiveConflictBlock(-1);
    targetLineRefs.current = {};
    sourceLineRefs.current = {};
    setConflictDetail({
      filePath,
      targetContent: "",
      sourceContent: "",
      diff: "",
    });
    setIsLoadingDiff(true);
    try {
      const detail = await invoke<MergeConflictDetail>("get_merge_conflict_diff", {
        repoPath: row.repoPath,
        source: sourceBranch.trim(),
        target: targetBranch.trim(),
        filePath,
      });
      setConflictDetail(detail);
    } catch (e) {
      setConflictDetail({
        filePath,
        targetContent: `获取失败：${String(e)}`,
        sourceContent: `获取失败：${String(e)}`,
        diff: "",
      });
    } finally {
      setIsLoadingDiff(false);
    }
  }, [row, sourceBranch, targetBranch]);

  const jumpConflictBlock = useCallback((step: -1 | 1) => {
    if (conflictBlocks.length === 0) return;
    setActiveConflictBlock((prev) => {
      const next = prev < 0
        ? (step > 0 ? 0 : conflictBlocks.length - 1)
        : Math.max(0, Math.min(conflictBlocks.length - 1, prev + step));
      const block = conflictBlocks[next];
      if (block) {
        requestAnimationFrame(() => {
          targetLineRefs.current[block.targetLine]?.scrollIntoView({ block: "center", behavior: "smooth" });
          sourceLineRefs.current[block.sourceLine]?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
      }
      return next;
    });
  }, [conflictBlocks]);

  if (!row) return null;

  const files = row.conflictFiles;

  return (
    <>
      <Modal
        opened
        onClose={onClose}
        centered
        size="md"
        title={(
          <Stack gap={2}>
            <Text fw={700} size="sm">冲突文件 · {row.name}</Text>
            <Text size="xs" c="dimmed">
              {sourceBranch.replace(/^origin\//, "")}
              {" → "}
              {targetBranch.replace(/^origin\//, "")}
            </Text>
          </Stack>
        )}
      >
        <Stack gap="sm">
          {files.length === 0 ? (
            <Text size="sm" c="dimmed">
              {row.message.includes("未能解析")
                ? row.message
                : `${row.message || "存在冲突"}。未能列出具体文件，请到「分支合并」页对该仓库再检查一次。`}
            </Text>
          ) : (
            <>
              <Text size="xs" c="dimmed">共 {files.length} 个文件，点击可对比两侧内容</Text>
              <ScrollArea.Autosize mah={320} type="auto" offsetScrollbars>
                <Stack gap={6}>
                  {files.map((f) => (
                    <Button
                      key={f}
                      variant="light"
                      color="yellow"
                      justify="flex-start"
                      leftSection={<FileText size={14} />}
                      onClick={() => void loadConflictDiff(f)}
                      styles={{ label: { overflow: "hidden", textOverflow: "ellipsis" } }}
                      title={f}
                    >
                      {f}
                    </Button>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            </>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>关闭</Button>
          </Group>
        </Stack>
      </Modal>

      {conflictDetail && (
        <ConflictDetailModal
          conflictDetail={conflictDetail}
          isLoading={isLoadingDiff}
          sourceBranch={sourceBranch}
          targetBranch={targetBranch}
          conflictBlocks={conflictBlocks}
          activeConflictBlock={activeConflictBlock}
          conflictChangedLines={conflictChangedLines}
          targetLineRefs={targetLineRefs}
          sourceLineRefs={sourceLineRefs}
          onClose={() => {
            setConflictDetail(null);
            setActiveConflictBlock(-1);
            targetLineRefs.current = {};
            sourceLineRefs.current = {};
          }}
          onJumpBlock={jumpConflictBlock}
        />
      )}
    </>
  );
}
