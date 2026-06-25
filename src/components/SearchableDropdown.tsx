import { useState, useRef, useEffect } from "react";

interface SearchableDropdownProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

export function SearchableDropdown({
  value,
  options,
  onChange,
  onBlur,
  placeholder = "请选择...",
  disabled = false,
  loading = false,
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setSearchTerm("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setSearchTerm(newValue);
    onChange(newValue);
    if (!isOpen) {
      setIsOpen(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchTerm && !options.includes(searchTerm)) {
      onChange(searchTerm);
      setIsOpen(false);
      setSearchTerm("");
    }
  };

  const handleInputFocus = () => {
    if (!disabled) {
      setIsOpen(true);
    }
  };

  // blur 时延迟回调，让下拉项的点击先于 blur 完成（点击会先 onChange 更新值）
  const handleInputBlur = () => {
    window.setTimeout(() => {
      const finalValue = inputRef.current?.value ?? value;
      setIsOpen(false);
      setSearchTerm("");
      if (onBlur) {
        onBlur(finalValue);
      }
    }, 150);
  };

  const displayValue = isOpen ? searchTerm : value || "";

  return (
    <div className="searchable-dropdown">
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
        disabled={disabled || loading}
        autoComplete="off"
      />
      {isOpen && !disabled && !loading && (
        <div ref={listRef} className="searchable-dropdown-list">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <div
                key={option}
                className={`searchable-dropdown-item ${option === value ? "selected" : ""}`}
                onClick={() => handleSelect(option)}
              >
                {option}
              </div>
            ))
          ) : searchTerm ? (
            <div
              className="searchable-dropdown-item searchable-dropdown-custom"
              onClick={() => handleSelect(searchTerm)}
            >
              使用: {searchTerm}
            </div>
          ) : (
            <div className="searchable-dropdown-empty">暂无可用选项</div>
          )}
        </div>
      )}
    </div>
  );
}
