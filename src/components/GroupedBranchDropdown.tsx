import { useState, useRef, useEffect } from "react";

interface GroupedBranchDropdownProps {
  value: string;
  branches: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

interface BranchGroup {
  prefix: string;
  branches: string[];
}

function groupBranches(branches: string[]): BranchGroup[] {
  const groups = new Map<string, string[]>();

  branches.forEach((branch) => {
    const parts = branch.split("/");
    if (parts.length > 1) {
      // 有路径分隔符，按第一级目录分组
      const prefix = parts[0];
      if (!groups.has(prefix)) {
        groups.set(prefix, []);
      }
      groups.get(prefix)!.push(branch);
    } else {
      // 没有路径分隔符，放到根目录
      if (!groups.has("")) {
        groups.set("", []);
      }
      groups.get("")!.push(branch);
    }
  });

  // 转换为数组并排序：先显示远程分支（origin/remotes），再本地分支，最后根目录
  const result: BranchGroup[] = [];
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    // 根目录（本地分支）放最后
    if (a === "") return 1;
    if (b === "") return -1;
    // origin 和 remotes 开头的放前面
    const aIsRemote = a === "origin" || a === "remotes" || a.startsWith("remotes/");
    const bIsRemote = b === "origin" || b === "remotes" || b.startsWith("remotes/");
    if (aIsRemote && !bIsRemote) return -1;
    if (!aIsRemote && bIsRemote) return 1;
    // 同类型按字母排序
    return a.localeCompare(b);
  });

  sortedKeys.forEach((key) => {
    const sortedBranches = groups.get(key)!.sort((a, b) => {
      // 在同一组内，master/main 优先
      const aIsMain = a.endsWith("/master") || a.endsWith("/main") || a === "master" || a === "main";
      const bIsMain = b.endsWith("/master") || b.endsWith("/main") || b === "master" || b === "main";
      if (aIsMain && !bIsMain) return -1;
      if (!aIsMain && bIsMain) return 1;
      return a.localeCompare(b);
    });
    result.push({
      prefix: key,
      branches: sortedBranches,
    });
  });

  return result;
}

export function GroupedBranchDropdown({
  value,
  branches,
  onChange,
  placeholder = "请选择分支...",
  disabled = false,
  loading = false,
}: GroupedBranchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  // 根据搜索词过滤分支
  const filteredBranches = searchTerm
    ? branches.filter((b) => b.toLowerCase().includes(searchTerm.toLowerCase()))
    : branches;

  const groupedBranches = groupBranches(filteredBranches);

  // 计算所有可选项（用于键盘导航）
  const allOptions = filteredBranches;

  useEffect(() => {
    setHighlightIndex(0);
  }, [searchTerm, branches]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        listRef.current &&
        !listRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (branch: string) => {
    onChange(branch);
    setIsOpen(false);
    setSearchTerm("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightIndex((i) => Math.min(i + 1, Math.max(allOptions.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setIsOpen(false);
      setSearchTerm("");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const picked = allOptions[highlightIndex];
      if (picked) {
        handleSelect(picked);
      }
    }
  };

  const handleInputFocus = () => {
    if (!disabled) {
      setSearchTerm("");
      setIsOpen(true);
    }
  };

  const handleInputBlur = () => {
    window.setTimeout(() => {
      setIsOpen(false);
      setSearchTerm("");
    }, 150);
  };

  const displayValue = isOpen ? searchTerm : value || "";

  return (
    <div className="grouped-branch-dropdown">
      <input
        ref={inputRef}
        type="text"
        className="searchable-dropdown-input"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        placeholder={loading ? "加载中..." : placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {isOpen && !disabled && (
        <div ref={listRef} className="searchable-dropdown-list grouped-branch-list">
          {loading && filteredBranches.length === 0 && !searchTerm ? (
            <div className="searchable-dropdown-empty">加载中...</div>
          ) : filteredBranches.length > 0 ? (
            groupedBranches.map((group) => (
              <div key={group.prefix || "root"} className="branch-group">
                {group.prefix && (
                  <div className="branch-group-header">{group.prefix}/</div>
                )}
                {group.branches.map((branch) => {
                  const globalIndex = allOptions.indexOf(branch);
                  const displayName = group.prefix
                    ? branch.slice(group.prefix.length + 1)
                    : branch;
                  return (
                    <div
                      key={branch}
                      className={`searchable-dropdown-item branch-item ${branch === value ? "selected" : ""} ${globalIndex === highlightIndex ? "highlight" : ""}`}
                      title={branch}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(branch);
                      }}
                      onMouseEnter={() => setHighlightIndex(globalIndex)}
                    >
                      {displayName}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="searchable-dropdown-empty">暂无匹配分支</div>
          )}
        </div>
      )}
    </div>
  );
}
