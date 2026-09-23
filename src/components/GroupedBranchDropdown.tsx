import { useEffect, useMemo, useRef, useState } from "react";
import { TreeSelect, type TreeNodeData } from "@mantine/core";
import { ChevronRight, GitBranch, Folder, FolderOpen } from "lucide-react";

interface GroupedBranchDropdownProps {
  value: string;
  branches: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowCustomValue?: boolean;
}

interface BranchTreeNode {
  segment: string;
  path: string;
  leaves: string[];
  children: BranchTreeNode[];
}

function isRemoteSegment(segment: string): boolean {
  return segment === "origin" || segment === "remotes";
}

/** master/main 优先，其余按字母序 */
function compareBranchNames(a: string, b: string): number {
  const aIsMain = a === "master" || a === "main";
  const bIsMain = b === "master" || b === "main";
  if (aIsMain && !bIsMain) return -1;
  if (!aIsMain && bIsMain) return 1;
  return a.localeCompare(b);
}

/**
 * 按 "/" 目录层级构建级联树。
 * `origin/feature/AI-4` → origin > feature > 叶子 AI-4
 * `origin/box`         → origin 下的叶子 box
 */
function buildBranchTree(branches: string[]): BranchTreeNode[] {
  const roots: BranchTreeNode[] = [];
  const findChild = (nodes: BranchTreeNode[], segment: string) =>
    nodes.find((n) => n.segment === segment);

  branches.forEach((branch) => {
    const parts = branch.split("/").filter(Boolean);
    if (parts.length === 0) return;

    const dirSegments = parts.slice(0, -1);
    let level = roots;
    let node: BranchTreeNode | undefined;
    let path = "";

    dirSegments.forEach((segment) => {
      path = path ? `${path}/${segment}` : segment;
      let child = findChild(level, segment);
      if (!child) {
        child = { segment, path, leaves: [], children: [] };
        level.push(child);
      }
      node = child;
      level = child.children;
    });

    if (node) {
      node.leaves.push(branch);
    } else {
      let rootLeaf = findChild(roots, "");
      if (!rootLeaf) {
        rootLeaf = { segment: "", path: "", leaves: [], children: [] };
        roots.push(rootLeaf);
      }
      rootLeaf.leaves.push(branch);
    }
  });

  return roots;
}

function sortTree(nodes: BranchTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.segment === "") return 1;
    if (b.segment === "") return -1;
    const aRemote = isRemoteSegment(a.segment);
    const bRemote = isRemoteSegment(b.segment);
    if (aRemote && !bRemote) return -1;
    if (!aRemote && bRemote) return 1;
    return a.segment.localeCompare(b.segment);
  });
  nodes.forEach((node) => {
    node.leaves.sort((a, b) =>
      compareBranchNames(a.split("/").pop() ?? a, b.split("/").pop() ?? b),
    );
    sortTree(node.children);
  });
}

/** 转成 Mantine TreeSelect 的 TreeNodeData（目录节点带 children，分支为叶子） */
function toTreeData(nodes: BranchTreeNode[]): TreeNodeData[] {
  const out: TreeNodeData[] = [];
  const leafNode = (branch: string): TreeNodeData => ({
    // label 用完整分支名，选中后输入框展示完整路径；下拉中再拆成叶子 + 父级路径。
    label: branch,
    value: branch,
    nodeProps: { title: branch },
  });

  for (const node of nodes) {
    if (!node.segment) {
      out.push(...node.leaves.map(leafNode));
      out.push(...toTreeData(node.children));
      continue;
    }
    out.push({
      // 目录节点 value 加前缀，避免与同名分支冲突
      value: `dir:${node.path}`,
      label: node.segment,
      nodeProps: { title: node.path.split("/").slice(0, -1).join("/") },
      children: [...node.leaves.map(leafNode), ...toTreeData(node.children)],
    });
  }
  return out;
}

/** 搜索匹配：目录按路径匹配，分支按完整分支名匹配 */
function filterBranchNode(query: string, node: TreeNodeData): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const value = String(node.value);
  const target = value.startsWith("dir:") ? value.slice(4) : value;
  return target.toLowerCase().includes(q);
}

export function GroupedBranchDropdown({
  value,
  branches,
  onChange,
  placeholder = "请选择分支...",
  disabled = false,
  loading = false,
  allowCustomValue = false,
}: GroupedBranchDropdownProps) {
  const data = useMemo(() => {
    const tree = buildBranchTree(branches);
    sortTree(tree);
    return toTreeData(tree);
  }, [branches]);
  const firstLevelValues = useMemo(
    () => data.filter((node) => node.children?.length).map((node) => node.value),
    [data],
  );
  const [expandedValues, setExpandedValues] = useState<string[]>(firstLevelValues);
  const searchTermRef = useRef("");

  useEffect(() => {
    setExpandedValues(firstLevelValues);
  }, [firstLevelValues]);

  return (
    <TreeSelect
      data={data}
      value={value || null}
      onChange={(next) => {
        if (typeof next === "string" && next) onChange(next);
      }}
      placeholder={loading ? "加载中..." : placeholder}
      disabled={disabled}
      searchable
      allowDeselect={false}
      clearable={false}
      openOnFocus
      expandOnClick
      withLines={false}
      expandedValues={expandedValues}
      onExpandedChange={setExpandedValues}
      onSearchChange={(query) => {
        searchTermRef.current = query;
      }}
      onKeyDown={(event) => {
        if (allowCustomValue && event.key === "Enter") {
          const query = searchTermRef.current.trim();
          if (query && !branches.includes(query)) {
            event.preventDefault();
            event.stopPropagation();
            onChange(query);
          }
        }
      }}
      maxDropdownHeight={360}
      nothingFoundMessage={loading ? "加载中..." : "暂无匹配分支"}
      filter={filterBranchNode}
      className="branch-tree-select"
      comboboxProps={{
        withinPortal: true,
        shadow: "md",
        classNames: { dropdown: "branch-tree-dropdown", option: "branch-tree-option" },
      }}
      renderNode={({ node, hasChildren, expanded, selected }) => {
        if (hasChildren) {
          return (
            <span className="jp-ts-node jp-ts-node-dir">
              <span className={`jp-ts-chevron${expanded ? " is-open" : ""}`}>
                <ChevronRight size={13} />
              </span>
              <span className="jp-ts-icon" aria-hidden="true">
                {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
              </span>
              <span className="jp-ts-label jp-ts-dir">{node.label}</span>
              {node.nodeProps?.title && node.nodeProps.title !== node.label && (
                <span className="jp-ts-context">{node.nodeProps.title}</span>
              )}
            </span>
          );
        }
        const branch = String(node.label);
        const segments = branch.split("/");
        const leaf = segments.pop() || branch;
        const context = segments.join("/");
        return (
          <span className={`jp-ts-node jp-ts-node-leaf${selected ? " is-selected" : ""}`} title={branch}>
            <span className="jp-ts-icon jp-ts-branch-icon" aria-hidden="true">
              <GitBranch size={14} />
            </span>
            <span className="jp-ts-label jp-ts-leaf">{leaf}</span>
            {context && <span className="jp-ts-context">{context}</span>}
          </span>
        );
      }}
    />
  );
}
