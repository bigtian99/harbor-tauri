export type CommitDiffLineKind = "file" | "hunk" | "addition" | "deletion" | "meta" | "context";
export type CommitDiffCodeLineKind = "addition" | "deletion" | "context";

export interface CommitDiffCodeLine {
  kind: CommitDiffCodeLineKind;
  text: string;
}

export interface CommitDiffFile {
  path: string;
  lines: CommitDiffCodeLine[];
}

export interface CommitDiffChangeRef {
  fileIndex: number;
  lineIndex: number;
}

export interface CommitDiffFileTreeNode {
  name: string;
  path: string;
  fileIndex?: number;
  children?: CommitDiffFileTreeNode[];
}

export interface CommitDiffFileGroup {
  dir: string;
  files: Array<{
    fileIndex: number;
    name: string;
    path: string;
  }>;
}

export function classifyCommitDiffLine(line: string): CommitDiffLineKind {
  if (line.startsWith("diff --git")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("Binary files ") ||
    line.startsWith("+++ ") ||
    line.startsWith("--- ")
  ) {
    return "meta";
  }
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}

export function parseCommitDiffFiles(diff: string): CommitDiffFile[] {
  const files: CommitDiffFile[] = [];
  let current: CommitDiffFile | null = null;
  let inHunk = false;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = { path: match?.[2] || match?.[1] || "变更文件", lines: [] };
      files.push(current);
      inHunk = false;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("+++ ")) {
      const nextPath = line.slice(4).replace(/^b\//, "");
      if (nextPath && nextPath !== "/dev/null") {
        current.path = nextPath;
      }
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk || line === "" || line.startsWith("\\ No newline")) {
      continue;
    }

    if (line.startsWith("+")) {
      current.lines.push({ kind: "addition", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "deletion", text: line.slice(1) });
    } else {
      current.lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }

  return files.filter((file) => file.lines.length > 0);
}

export function getCommitDiffChangeRefs(files: CommitDiffFile[]): CommitDiffChangeRef[] {
  const refs: CommitDiffChangeRef[] = [];
  files.forEach((file, fileIndex) => {
    let previousWasChange = false;
    file.lines.forEach((line, lineIndex) => {
      const isChange = line.kind === "addition" || line.kind === "deletion";
      if (isChange && !previousWasChange) {
        refs.push({ fileIndex, lineIndex });
      }
      previousWasChange = isChange;
    });
  });
  return refs;
}

export function getCommitDiffFileGroups(files: CommitDiffFile[]): CommitDiffFileGroup[] {
  const groups: CommitDiffFileGroup[] = [];
  const byDir = new Map<string, CommitDiffFileGroup>();

  files.forEach((file, fileIndex) => {
    const slash = file.path.indexOf("/");
    const dir = slash >= 0 ? file.path.slice(0, slash) : ".";
    const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
    let group = byDir.get(dir);
    if (!group) {
      group = { dir, files: [] };
      byDir.set(dir, group);
      groups.push(group);
    }
    group.files.push({ fileIndex, name, path: file.path });
  });

  groups.forEach((group) => {
    group.files.sort((a, b) => a.name.localeCompare(b.name));
  });

  return groups;
}

export function getCommitDiffFileTree(files: CommitDiffFile[]): CommitDiffFileTreeNode[] {
  const root: CommitDiffFileTreeNode[] = [];
  const dirs = new Map<string, CommitDiffFileTreeNode>();

  files.forEach((file, fileIndex) => {
    const parts = file.path.split("/").filter(Boolean);
    const fileName = parts.pop() || file.path || "变更文件";
    let children = root;
    const pathParts: string[] = [];

    parts.forEach((part) => {
      pathParts.push(part);
      const path = pathParts.join("/");
      let dir = dirs.get(path);
      if (!dir) {
        dir = { name: part, path, children: [] };
        dirs.set(path, dir);
        children.push(dir);
      }
      children = dir.children || [];
    });

    children.push({ name: fileName, path: file.path, fileIndex });
  });

  const sortTree = (nodes: CommitDiffFileTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => {
      if (node.children) {
        sortTree(node.children);
      }
    });
  };

  sortTree(root);
  return root;
}
