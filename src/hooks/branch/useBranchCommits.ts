import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AuthorInfo, CommitInfo, CommitListResult, LastCommitInfo } from "../../types";
import { isTauriRuntime } from "../../types";

export type BranchLoadingKey =
  | "scripts"
  | "branches"
  | "profiles"
  | "commit"
  | "commitList";

interface UseBranchCommitsDeps {
  updateLoading: (key: BranchLoadingKey, value: boolean) => void;
  isStaleBranchLoad: (requestId?: number) => boolean;
}

/**
 * 分支打包：最近提交、提交列表、作者过滤与弹层状态。
 */
export function useBranchCommits(deps: UseBranchCommitsDeps) {
  const { updateLoading, isStaleBranchLoad } = deps;

  const [lastCommit, setLastCommit] = useState<LastCommitInfo | null>(null);
  const [commitList, setCommitList] = useState<CommitInfo[]>([]);
  const [commitListTotal, setCommitListTotal] = useState(0);
  const [commitListPage, setCommitListPage] = useState(1);
  const [commitListPageSize, setCommitListPageSize] = useState(10);
  const [commitAuthorFilter, setCommitAuthorFilter] = useState("");
  const [commitMessageFilter, setCommitMessageFilter] = useState("");
  const [commitAuthors, setCommitAuthors] = useState<AuthorInfo[]>([]);
  const [showCommitListModal, setShowCommitListModal] = useState(false);

  async function loadLastCommit(
    repoPathArg: string,
    branch: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setLastCommit(null);
      }
      return;
    }
    updateLoading("commit", true);
    try {
      const commit = await invoke<LastCommitInfo>("get_last_commit", {
        repoPath: repoPathArg.trim(),
        branch: branch.trim() || null,
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setLastCommit(commit);
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      console.error("[Last Commit] 获取失败:", e);
      setLastCommit(null);
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading("commit", false);
      }
    }
  }

  async function loadCommitList(
    repoPathArg: string,
    branch: string,
    page: number = 1,
    authorFilter?: string,
    messageFilter?: string,
    branchLoadRequestId?: number,
  ) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        setCommitList([]);
        setCommitListTotal(0);
      }
      return;
    }
    updateLoading("commitList", true);
    try {
      const result = await invoke<CommitListResult>("get_commit_list", {
        repoPath: repoPathArg.trim(),
        branch: branch.trim() || null,
        page,
        pageSize: 10,
        authorFilter: authorFilter || null,
        messageFilter: messageFilter || null,
      });
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      setCommitList(result.commits);
      setCommitListTotal(result.total);
      setCommitListPage(result.page);
      setCommitListPageSize(result.page_size);
    } catch (e) {
      if (isStaleBranchLoad(branchLoadRequestId)) return;
      console.error("[Commit List] 获取失败:", e);
      setCommitList([]);
      setCommitListTotal(0);
    } finally {
      if (!isStaleBranchLoad(branchLoadRequestId)) {
        updateLoading("commitList", false);
      }
    }
  }

  async function loadCommitAuthors(repoPathArg: string, branch: string) {
    if (!repoPathArg.trim() || !isTauriRuntime()) {
      setCommitAuthors([]);
      return;
    }
    try {
      const authors = await invoke<AuthorInfo[]>("get_commit_authors", {
        repoPath: repoPathArg.trim(),
        branch: branch.trim() || null,
      });
      setCommitAuthors(authors);
    } catch (e) {
      console.error("[Commit Authors] 获取失败:", e);
      setCommitAuthors([]);
    }
  }

  function clearCommitState() {
    setLastCommit(null);
    setCommitList([]);
    setCommitListTotal(0);
  }

  return {
    lastCommit,
    setLastCommit,
    commitList,
    setCommitList,
    commitListTotal,
    setCommitListTotal,
    commitListPage,
    commitListPageSize,
    commitAuthorFilter,
    setCommitAuthorFilter,
    commitMessageFilter,
    setCommitMessageFilter,
    commitAuthors,
    showCommitListModal,
    setShowCommitListModal,
    loadLastCommit,
    loadCommitList,
    loadCommitAuthors,
    clearCommitState,
  };
}
