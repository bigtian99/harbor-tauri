import { useEffect, useRef, useState } from "react";
import {
  Container, Upload, Rocket, Settings, GitBranch, History, Globe, GitMerge,
  ChevronLeft, ChevronRight, FileText, Zap, ScrollText, Shield, Coffee, Code2,
  CloudUpload, ChevronDown,
} from "lucide-react";
import type { TabType } from "../types";
import { isOpsTab } from "../opsNavigation";

interface SidebarProps {
  activeTab: TabType;
  sidebarCollapsed: boolean;
  opsMode: boolean;
  onTabChange: (tab: TabType) => void;
  onToggleCollapse: () => void;
  onOpenLog: () => void;
}

const BT_TABS = ["btJava", "btPhp"] as const satisfies readonly TabType[];

const btSubItems: { tab: (typeof BT_TABS)[number]; icon: React.ReactNode; label: string }[] = [
  { tab: "btJava", icon: <Coffee size={16} />, label: "Java 项目" },
  { tab: "btPhp", icon: <Code2 size={16} />, label: "PHP 项目" },
];

function isBtTab(tab: TabType): tab is (typeof BT_TABS)[number] {
  return (BT_TABS as readonly TabType[]).includes(tab);
}

export function Sidebar({ activeTab, sidebarCollapsed, opsMode, onTabChange, onToggleCollapse, onOpenLog }: SidebarProps) {
  const navBeforeBt: { tab: TabType; icon: React.ReactNode; label: string }[] = [
    { tab: "upload", icon: <Upload size={18} />, label: "上传推送" },
    { tab: "push", icon: <Rocket size={18} />, label: "镜像推送" },
    { tab: "branch", icon: <GitBranch size={18} />, label: "分支打包" },
    { tab: "merge", icon: <GitMerge size={18} />, label: "分支合并" },
    { tab: "history", icon: <History size={18} />, label: "历史记录" },
  ];

  const navAfterBt: { tab: TabType; icon: React.ReactNode; label: string }[] = [
    { tab: "landing", icon: <Globe size={18} />, label: "生成落地页" },
    { tab: "privacy", icon: <Shield size={18} />, label: "隐私协议" },
    { tab: "settlement", icon: <FileText size={18} />, label: "结算单" },
    { tab: "packSpeed", icon: <Zap size={18} />, label: "打包加速" },
    { tab: "ksPublish", icon: <Container size={18} />, label: "KubeSphere 发布" },
  ];

  const filterOps = (items: typeof navBeforeBt) =>
    opsMode ? items.filter((item) => isOpsTab(item.tab)) : items;

  const itemsBeforeBt = filterOps(navBeforeBt);
  const itemsAfterBt = filterOps(navAfterBt);
  const showBtGroup = !opsMode;

  const renderNavItem = ({ tab, icon, label }: { tab: TabType; icon: React.ReactNode; label: string }) => (
    <button
      key={tab}
      className={`sidebar-item ${activeTab === tab ? "active" : ""}`}
      onClick={() => onTabChange(tab)}
      data-label={label}
      onMouseEnter={setTooltipTop}
    >
      {icon}
      {!sidebarCollapsed && <span>{label}</span>}
    </button>
  );

  const [btExpanded, setBtExpanded] = useState(() => isBtTab(activeTab));
  const [btFlyoutOpen, setBtFlyoutOpen] = useState(false);
  const btGroupRef = useRef<HTMLDivElement>(null);

  const isBtActive = isBtTab(activeTab);

  useEffect(() => {
    if (isBtActive) {
      setBtExpanded(true);
    }
  }, [activeTab, isBtActive]);

  useEffect(() => {
    if (!btFlyoutOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!btGroupRef.current?.contains(event.target as Node)) {
        setBtFlyoutOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [btFlyoutOpen]);

  useEffect(() => {
    if (!sidebarCollapsed) {
      setBtFlyoutOpen(false);
    }
  }, [sidebarCollapsed]);

  const setTooltipTop = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    document.documentElement.style.setProperty("--tooltip-top", `${rect.top + rect.height / 2}px`);
  };

  const handleBtHeaderClick = () => {
    if (sidebarCollapsed) {
      setBtFlyoutOpen((open) => !open);
      return;
    }
    if (isBtActive) {
      setBtExpanded((expanded) => !expanded);
      return;
    }
    setBtExpanded(true);
    onTabChange("btJava");
  };

  const handleBtSubClick = (tab: (typeof BT_TABS)[number]) => {
    setBtFlyoutOpen(false);
    onTabChange(tab);
  };

  return (
    <>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-header">
          <Container size={24} className="header-icon" />
          {!sidebarCollapsed && <h1>ShipForge</h1>}
        </div>

        <nav className="sidebar-nav">
          {itemsBeforeBt.map(renderNavItem)}

          {showBtGroup && (
            <div
              ref={btGroupRef}
              className={`sidebar-group ${btExpanded ? "expanded" : ""} ${isBtActive ? "active" : ""}`}
            >
              <button
                type="button"
                className={[
                  "sidebar-item",
                  "sidebar-group-header",
                  sidebarCollapsed && isBtActive ? "active" : "",
                  !sidebarCollapsed && btExpanded ? "sidebar-group-header--open" : "",
                ].filter(Boolean).join(" ")}
                onClick={handleBtHeaderClick}
                data-label="宝塔"
                onMouseEnter={setTooltipTop}
                aria-expanded={sidebarCollapsed ? btFlyoutOpen : btExpanded}
              >
                <CloudUpload size={18} />
                {!sidebarCollapsed && (
                  <>
                    <span className="sidebar-group-label">宝塔</span>
                    <ChevronDown size={14} className="sidebar-group-chevron" />
                  </>
                )}
              </button>

              {!sidebarCollapsed && btExpanded && (
                <div className="sidebar-subnav">
                  {btSubItems.map(({ tab, icon, label }) => (
                    <button
                      key={tab}
                      type="button"
                      className={`sidebar-item sidebar-subitem ${activeTab === tab ? "active" : ""}`}
                      onClick={() => handleBtSubClick(tab)}
                      data-label={label}
                      onMouseEnter={setTooltipTop}
                    >
                      {icon}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}

              {sidebarCollapsed && btFlyoutOpen && (
                <div className="sidebar-flyout" role="menu">
                  {btSubItems.map(({ tab, icon, label }) => (
                    <button
                      key={tab}
                      type="button"
                      role="menuitem"
                      className={`sidebar-flyout-item ${activeTab === tab ? "active" : ""}`}
                      onClick={() => handleBtSubClick(tab)}
                    >
                      {icon}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {itemsAfterBt.map(renderNavItem)}
        </nav>
        {!opsMode && (
          <div className="sidebar-footer">
            <button
              className="sidebar-item"
              onClick={onOpenLog}
              data-label="系统日志"
              onMouseEnter={setTooltipTop}
            >
              <ScrollText size={18} />
              {!sidebarCollapsed && <span>系统日志</span>}
            </button>
            <button
              className={`sidebar-item ${activeTab === "config" ? "active" : ""}`}
              onClick={() => onTabChange("config")}
              data-label="设置"
              onMouseEnter={setTooltipTop}
            >
              <Settings size={18} />
              {!sidebarCollapsed && <span>设置</span>}
            </button>
          </div>
        )}
      </aside>

      <button
        className="sidebar-toggle"
        onClick={onToggleCollapse}
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </>
  );
}
